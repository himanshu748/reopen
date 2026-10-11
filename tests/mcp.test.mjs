import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createNetServer } from "node:net";
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../server/index.mjs";

test("assistant grants expose only scoped MCP review and owner-approved checklist drafts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reopen-mcp-"));
  const origin = "http://reopen.test";
  const app = await createApp({ dbPath: join(dir, "reopen.sqlite"), origin, noVite: true, production: false });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const clients = [];
  async function api(path, { method = "GET", body, account, expected = 200 } = {}) {
    const response = await fetch(base + "/api" + path, { method,
      headers: { "Content-Type": "application/json", Origin: origin,
        ...(account ? { Cookie: account.cookie, "X-CSRF-Token": account.csrf } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const json = await response.json();
    assert.equal(response.status, expected, JSON.stringify(json));
    return { json, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }
  async function clientFor(token) {
    const client = new Client({ name: "reopen-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(base + "/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);
    clients.push(client);
    return client;
  }
  async function call(client, name, args) {
    const result = await client.callTool({ name, arguments: args });
    return result.isError ? result : result.structuredContent || JSON.parse(result.content[0].text);
  }
  try {
    const first = await api("/register", { method: "POST", body: {
      name: "Owner", email: "owner@example.test", password: "Only-test-password-123!" } });
    const owner = { cookie: first.cookie, csrf: first.json.csrf };
    const second = await api("/register", { method: "POST", body: {
      name: "Other", email: "other@example.test", password: "Only-test-password-123!" } });
    const other = { cookie: second.cookie, csrf: second.json.csrf };
    let p = (await api("/projects", { method: "POST", account: owner,
      body: { illustrative: true } , expected: 201 })).json.project;
    const review = p.candidates.find(c => c.kind === "reported_change");
    assert.ok(review);
    await api(`/projects/${p.id}/assistant-access`, { account: other, expected: 404 });
    let grantResponse = await api(`/projects/${p.id}/assistant-access`, { method: "POST", account: owner,
      body: { expectedVersion: p.version, label: "Alexa", allowDrafts: false }, expected: 201 });
    const readGrant = grantResponse.json;
    assert.equal(readGrant.endpoint, origin + "/mcp");
    assert.equal(readGrant.grant.allowDrafts, false);
    assert.equal((await api(`/projects/${p.id}/assistant-access`, { account: owner })).json.protocolVersion, "2025-11-25");
    const unauth = await fetch(base + "/mcp", { method: "POST", headers: { Cookie: owner.cookie,
      "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    assert.equal(unauth.status, 401);
    const wrongOrigin = await fetch(base + "/mcp", { method: "POST", headers: { Authorization: `Bearer ${readGrant.token}`,
      Origin: "http://attacker.test", "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    assert.equal(wrongOrigin.status, 403);
    const reader = await clientFor(readGrant.token);
    assert.equal(reader.getServerVersion()?.name, "reopen");
    const otherProject = (await api("/projects", { method: "POST", account: other,
      body: { illustrative: true }, expected: 201 })).json.project;
    assert.notEqual(otherProject.id, p.id);
    assert.equal((await call(reader, "reopen_notebook_overview", {})).projectId, p.id);
    assert.equal((await call(reader, "reopen_explain_decision", { decisionId: otherProject.decisions[0].id })).isError, true);
    assert.equal((await call(reader, "reopen_review_evidence", { candidateId: otherProject.candidates[0].id })).isError, true);
    const listedTools = (await reader.listTools()).tools;
    assert.deepEqual(listedTools.map(x => x.name).sort(), [
      "reopen_draft_checklist_change", "reopen_explain_decision", "reopen_notebook_overview", "reopen_review_evidence" ]);
    assert.equal(listedTools.find(x => x.name === "reopen_notebook_overview").annotations.readOnlyHint, true);
    assert.equal(listedTools.find(x => x.name === "reopen_draft_checklist_change").annotations.readOnlyHint, false);
    const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "wire-test", version: "1" } } };
    const wireHeaders = { Authorization: `Bearer ${readGrant.token}`, "Content-Type": "application/json",
      Accept: "application/json, text/event-stream" };
    const wire = await fetch(base + "/mcp", { method: "POST", headers: wireHeaders, body: JSON.stringify(initialize) });
    assert.equal(wire.status, 200);
    assert.equal((await wire.json()).result.protocolVersion, "2025-11-25");
    const oldWire = await fetch(base + "/mcp", { method: "POST", headers: wireHeaders,
      body: JSON.stringify({ ...initialize, params: { ...initialize.params, protocolVersion: "2024-11-05" } }) });
    assert.equal(oldWire.status, 200);
    assert.equal((await oldWire.json()).result.protocolVersion, "2025-11-25");
    const newerWire = await fetch(base + "/mcp", { method: "POST", headers: wireHeaders,
      body: JSON.stringify({ ...initialize, params: { ...initialize.params, protocolVersion: "2026-07-28" } }) });
    assert.equal(newerWire.status, 200);
    assert.equal((await newerWire.json()).result.protocolVersion, "2025-11-25");
    const conflictingHeader = await fetch(base + "/mcp", { method: "POST", headers: {
      ...wireHeaders, "MCP-Protocol-Version": "2024-11-05" }, body: JSON.stringify(initialize) });
    assert.equal(conflictingHeader.status, 400);
    const oldCall = await fetch(base + "/mcp", { method: "POST", headers: {
      ...wireHeaders, "MCP-Protocol-Version": "2025-03-26" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) });
    assert.equal(oldCall.status, 400);
    const overview = await call(reader, "reopen_notebook_overview", {});
    assert.equal(overview.version, p.version);
    assert.equal(overview.projectId, p.id);
    const explanation = await call(reader, "reopen_explain_decision", { decisionId: p.decisions[0].id });
    assert.equal(explanation.rationale, p.decisions[0].rationale);
    assert.equal(explanation.source.provenance, p.sources[0].provenance);
    const evidence = await call(reader, "reopen_review_evidence", { candidateId: review.id });
    assert.equal(evidence.decisionSnapshot.rationale, p.decisions[0].rationale);
    assert.equal(evidence.source.provenance, p.sources[1].provenance);
    assert.equal(evidence.kind, "reported_change");
    let rejected = await call(reader, "reopen_draft_checklist_change", {
      candidateId: review.id, expectedVersion: p.version, replacement: "Prepare offline demo" });
    assert.equal(rejected.isError, true);
    grantResponse = await api(`/projects/${p.id}/assistant-access`, { method: "POST", account: owner,
      body: { expectedVersion: p.version, label: "Writer", allowDrafts: true }, expected: 201 });
    const draftGrant = grantResponse.json;
    const writer = await clientFor(draftGrant.token);
    rejected = await call(writer, "reopen_draft_checklist_change", {
      candidateId: review.id, expectedVersion: p.version, replacement: "Prepare offline demo" });
    assert.equal(rejected.isError, true);
    p = (await api(`/projects/${p.id}/commands`, { method: "POST", account: owner,
      body: { type: "disposition", expectedVersion: p.version,
        payload: { id: review.id, action: "reopen", confirmedChange: true, reason: "Checked organizer report." } } })).json.project;
    const oldText = p.checklist[0].text;
    rejected = await call(writer, "reopen_draft_checklist_change", {
      candidateId: review.id, expectedVersion: p.version - 1, replacement: "Prepare offline demo" });
    assert.equal(rejected.isError, true);
    const draft = await call(writer, "reopen_draft_checklist_change", {
      candidateId: review.id, expectedVersion: p.version, replacement: "Prepare offline demo" });
    assert.equal(draft.approvalRequired, true);
    assert.equal(draft.proposal.status, "pending_approval");
    assert.equal(draft.proposal.before, oldText);
    assert.equal(draft.projectVersion, p.version + 1);
    const unicodeReplacement = "Prepare ☃ offline demo";
    const unicodeBody = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call",
      params: { name: "reopen_draft_checklist_change", arguments: {
        candidateId: review.id, expectedVersion: draft.projectVersion, replacement: unicodeReplacement } } }));
    const splitAt = unicodeBody.indexOf(Buffer.from("☃")) + 1;
    const splitResponse = await new Promise((resolve, reject) => {
      const request = http.request(base + "/mcp", { method: "POST", headers: {
        Authorization: `Bearer ${draftGrant.token}`, "Content-Type": "application/json",
        Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" } }, response => {
        const chunks = [];
        response.on("data", chunk => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
      });
      request.on("error", reject);
      request.write(unicodeBody.subarray(0, splitAt));
      setTimeout(() => request.end(unicodeBody.subarray(splitAt)), 5);
    });
    assert.equal(splitResponse.status, 200);
    assert.equal(splitResponse.body.result.structuredContent.proposal.after, unicodeReplacement);
    p = (await api(`/projects/${p.id}`, { account: owner })).json.project;
    assert.equal(p.checklist[0].text, oldText);
    const race = await Promise.all([0, 1].map(i => call(writer, "reopen_draft_checklist_change", {
      candidateId: review.id, expectedVersion: p.version, replacement: `Offline demo ${i}` })));
    assert.equal(race.filter(x => x.isError).length, 1);
    p = (await api(`/projects/${p.id}`, { account: owner })).json.project;
    assert.equal(p.checklist[0].text, oldText);
    await api(`/projects/${p.id}/commands`, { method: "POST", account: owner,
      body: { type: "approve_checklist_change", expectedVersion: p.version, payload: { id: review.id } } });
    p = (await api(`/projects/${p.id}`, { account: owner })).json.project;
    assert.match(p.checklist[0].text, /^Offline demo [01]$/);
    assert.equal(p.candidates.find(x => x.id === review.id).proposal.status, "approved");
    p = (await api(`/projects/${p.id}/commands`, { method: "POST", account: owner,
      body: { type: "add_checklist", expectedVersion: p.version,
        payload: { text: "New anchor for a later decision revision" } } })).json.project;
    const decision = p.decisions[0];
    p = (await api(`/projects/${p.id}/commands`, { method: "POST", account: owner,
      body: { type: "revise_decision", expectedVersion: p.version,
        payload: { id: decision.id, title: decision.title, rationale: decision.rationale,
          assumptions: decision.assumptions, reviewCondition: decision.reviewCondition,
          sourceId: decision.sourceId, quote: decision.quote, anchorId: p.checklist[1].id } } })).json.project;
    const afterReanchor = await call(reader, "reopen_review_evidence", { candidateId: review.id });
    assert.equal(afterReanchor.currentDecision.status, "draft");
    assert.equal(afterReanchor.checklistItem.id, p.candidates.find(x => x.id === review.id).proposal.itemId);
    assert.notEqual(afterReanchor.checklistItem.id, p.decisions[0].anchorId);
    rejected = await call(writer, "reopen_draft_checklist_change", {
      candidateId: review.id, expectedVersion: p.version, replacement: "Replay" });
    assert.equal(rejected.isError, true);
    await api(`/projects/${p.id}/assistant-access/${draftGrant.grant.id}`, { method: "DELETE", account: owner });
    const revoked = await fetch(base + "/mcp", { method: "POST", headers: {
      Authorization: `Bearer ${draftGrant.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    assert.equal(revoked.status, 401);
    app.db.prepare("UPDATE assistant_grants SET expires_at=? WHERE id=?").run(Date.now() - 1, readGrant.grant.id);
    const expired = await fetch(base + "/mcp", { method: "POST", headers: {
      Authorization: `Bearer ${readGrant.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    assert.equal(expired.status, 401);
    await api(`/projects/${p.id}`, { method: "DELETE", account: owner,
      body: { expectedVersion: p.version } });
    assert.equal(app.db.prepare("SELECT count(*) AS n FROM assistant_grants WHERE project_id=?").get(p.id).n, 0);
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("development endpoint uses configured host and port for browser Origin", async () => {
  const reservation = createNetServer();
  await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const previousPort = process.env.PORT;
  const previousHost = process.env.HOST;
  process.env.PORT = String(port);
  process.env.HOST = "127.0.0.1";
  const app = await createApp({ dbPath: ":memory:", noVite: true, production: false });
  await new Promise(resolve => app.server.listen(port, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${port}`;
  try {
    const registration = await fetch(base + "/api/register", { method: "POST", headers: {
      "Content-Type": "application/json", Origin: base }, body: JSON.stringify({
      name: "Browser", email: "browser@example.test", password: "Only-test-password-123!" }) });
    assert.equal(registration.status, 200);
    const cookie = registration.headers.get("set-cookie").split(";")[0];
    const csrf = (await registration.json()).csrf;
    const headers = { "Content-Type": "application/json", Origin: base, Cookie: cookie, "X-CSRF-Token": csrf };
    const creation = await fetch(base + "/api/projects", { method: "POST", headers,
      body: JSON.stringify({ title: "Browser notebook" }) });
    assert.equal(creation.status, 201);
    const project = (await creation.json()).project;
    const grantRequest = await fetch(base + `/api/projects/${project.id}/assistant-access`, {
      method: "POST", headers, body: JSON.stringify({ expectedVersion: project.version,
        label: "Browser assistant", allowDrafts: false }) });
    assert.equal(grantRequest.status, 201);
    const grant = await grantRequest.json();
    assert.equal(grant.endpoint, base + "/mcp");
    const aliasProbe = await fetch(base + "/mcp", { method: "POST", headers: {
      Authorization: `Bearer ${grant.token}`, Origin: `http://localhost:${port}`,
      "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "initialize", params: {
        protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "alias", version: "1" } } }) });
    assert.equal(aliasProbe.status, 200);
    const client = new Client({ name: "browser-test", version: "1.0.0" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(grant.endpoint), {
        requestInit: { headers: { Authorization: `Bearer ${grant.token}`, Origin: base } },
      }));
      assert.equal((await client.listTools()).tools.length, 4);
    } finally { await client.close(); }
  } finally {
    await app.close();
    if (previousPort === undefined) delete process.env.PORT; else process.env.PORT = previousPort;
    if (previousHost === undefined) delete process.env.HOST; else process.env.HOST = previousHost;
  }
});
