import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/index.mjs";

// Throwaway private accounts and SQLite files. No external provider or default app data is used.
test("HTTP notebooks preserve owner isolation, atomic versions, sessions, exports and deletion across restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reopen-api-"));
  const origin = "http://reopen.test";
  const dbPath = join(dir, "fixture.sqlite");
  let app, base;
  async function start() {
    app = await createApp({ dbPath, origin, noVite: true, production: false });
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${app.server.address().port}`;
  }
  async function request(
    path,
    {
      method = "GET",
      body,
      account,
      csrf = account?.csrf,
      requestOrigin = origin,
      expected = 200,
    } = {},
  ) {
    const headers = { "Content-Type": "application/json" };
    if (account?.cookie) headers.Cookie = account.cookie;
    if (csrf) headers["X-CSRF-Token"] = csrf;
    if (method !== "GET" && requestOrigin) headers.Origin = requestOrigin;
    const res = await fetch(base + "/api" + path, {
      method,
      headers,
      signal: AbortSignal.timeout(10000),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await res.json();
    assert.equal(res.status, expected, value.error || path);
    return { value, cookie: res.headers.get("set-cookie")?.split(";")[0] };
  }
  const credentials = {
    name: "API fixture",
    email: "owner@fixture.example",
    password: "Only-a-local-test-123!",
  };
  try {
    await start();
    await request("/projects", { expected: 401 });
    const registered = await request("/register", { method: "POST", body: credentials });
    const owner = { csrf: registered.value.csrf, cookie: registered.cookie };
    const second = await request("/register", {
      method: "POST",
      body: { ...credentials, email: "other@fixture.example" },
    });
    const other = { csrf: second.value.csrf, cookie: second.cookie };
    await request("/projects", {
      method: "POST",
      body: { title: "Private notebook" },
      account: owner,
      csrf: "incorrect",
      expected: 403,
    });
    await request("/projects", {
      method: "POST",
      body: { title: "Private notebook" },
      account: owner,
      requestOrigin: "",
      expected: 403,
    });
    let project = (
      await request("/projects", {
        method: "POST",
        body: { title: "Private notebook", description: "Disposable verification records" },
        account: owner,
        expected: 201,
      })
    ).value.project;
    assert.equal(project.sources.length, 0);
    assert.equal(project.decisions.length, 0);
    for (const suffix of ["", "/export"])
      await request(`/projects/${project.id}${suffix}`, { account: other, expected: 404 });
    assert.equal((await request("/projects", { account: other })).value.projects.length, 0);
    const endpoint = `/projects/${project.id}/commands`;
    const body = {
      type: "add_checklist",
      expectedVersion: project.version,
      payload: { text: "Verify the actual venue connection" },
    };
    // Both requests start at the same revision; only one may append its item.
    const attempts = await Promise.all(
      [0, 1].map(async () => {
        const res = await fetch(base + "/api" + endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: origin,
            Cookie: owner.cookie,
            "X-CSRF-Token": owner.csrf,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000),
        });
        await res.arrayBuffer();
        return res.status;
      }),
    );
    assert.deepEqual(attempts.sort(), [200, 409]);
    project = (await request(`/projects/${project.id}`, { account: owner })).value.project;
    assert.equal(project.checklist.length, 1);
    assert.equal(project.version, body.expectedVersion + 1);
    await request(`/projects/${project.id}`, {
      method: "DELETE",
      body: { expectedVersion: body.expectedVersion },
      account: owner,
      expected: 409,
    });
    await app.close();
    app = null;
    await start();
    const session = (await request("/session", { account: owner })).value;
    assert.equal(session.user.email, credentials.email);
    const exported = (await request(`/projects/${project.id}/export`, { account: owner })).value;
    assert.equal(exported.project.checklist.length, 1);
    assert.equal(exported.project.version, project.version);
    assert.equal(exported.integrations.bee.connected, false);
    await request("/account", {
      method: "DELETE",
      account: owner,
      body: { password: credentials.password },
    });
    assert.equal((await request("/session", { account: owner })).value.user, null);
    assert.equal(
      app.db.prepare("SELECT COUNT(*) AS n FROM projects WHERE id=?").get(project.id).n,
      0,
    );
    await request("/login", { method: "POST", body: credentials, expected: 401 });
    assert.equal(
      (await request("/session", { account: other })).value.user.email,
      "other@fixture.example",
    );
  } finally {
    if (app) await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
