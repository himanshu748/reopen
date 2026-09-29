import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { scryptSync } from "node:crypto";
import { createApp } from "../server/index.mjs";
import { createBeeAdapter } from "../server/adapters.mjs";
import { baseline, later, conversation, fixtureFetch } from "./bee-fixtures.mjs";
const ORIGIN = "http://localhost";
const PASSWORD = "Fixture-private-bee-2026";
async function setup(t, override) {
  const calls = [],
    records = new Map([
      [101, conversation(101)],
      [102, conversation(102, later)],
    ]);
  const app = await createApp({
    dbPath: ":memory:",
    noVite: true,
    origin: ORIGIN,
    beeProxyUrl: "http://127.0.0.1:8787",
    beeOwnerId: "fixture-owner",
    beeFetch: override || fixtureFetch(records, calls),
  });
  app.db
    .prepare("INSERT INTO users VALUES(?,?,?,?,?,?)")
    .run(
      "fixture-owner",
      "bee@example.test",
      "Bee Fixture Owner",
      "fixture-salt",
      scryptSync(PASSWORD, "fixture-salt", 64).toString("hex"),
      new Date().toISOString(),
    );
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let cookie = "",
    csrf = "",
    project;
  async function request(path, body, method = body ? "POST" : "GET") {
    const res = await fetch(base + "/api" + path, {
      method,
      headers: {
        Origin: ORIGIN,
        "Content-Type": "application/json",
        Cookie: cookie,
        "X-CSRF-Token": csrf,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, data: await res.json(), headers: res.headers };
  }
  const login = await request("/login", { email: "bee@example.test", password: PASSWORD });
  cookie = login.headers.get("set-cookie").split(";")[0];
  csrf = login.data.csrf;
  project = (await request("/projects", { title: "Fixture launch notebook" })).data.project;
  return {
    app,
    request,
    calls,
    records,
    get p() {
      return project;
    },
    async connect() {
      return request("/bee/connect", { consent: true });
    },
    async run(type, payload) {
      const r = await request(`/projects/${project.id}/commands`, {
        type,
        payload,
        expectedVersion: project.version,
      });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      project = r.data.project;
      return project;
    },
    async import(ids = [101], version = project.version) {
      const r = await request("/bee/import", {
        ids,
        projectId: project.id,
        expectedVersion: version,
        consent: true,
      });
      if (r.status === 200) project = r.data.project;
      return r;
    },
  };
}
test("Bee connector requires consent and owner binding before provider access", async (t) => {
  const n = await setup(t);
  assert.equal((await n.request("/bee/status")).data.status.connected, false);
  assert.equal(n.calls.length, 0);
  assert.equal((await n.request("/bee/connect", { consent: false })).status, 400);
  assert.equal((await n.import()).status, 409);
  assert.equal(n.calls.length, 0);
  const other = await n.request("/register", {
    email: "other@example.test",
    name: "Other Owner",
    password: PASSWORD,
  });
  const base = `http://127.0.0.1:${n.app.server.address().port}`;
  const forbidden = await fetch(base + "/api/bee/connect", {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/json",
      Cookie: other.headers.get("set-cookie").split(";")[0],
      "X-CSRF-Token": other.data.csrf,
    },
    body: JSON.stringify({ consent: true }),
  });
  assert.equal(forbidden.status, 403);
  assert.equal(n.calls.length, 0);
  assert.equal((await n.connect()).status, 200);
  assert.deepEqual(n.calls[0], {
    path: "/v1/conversations",
    search: "?limit=20",
    method: "GET",
    redirect: "error",
  });
});
test("selected processed Bee contract data flows into confirmed decisions and later evidence; fixtures remain marked", async (t) => {
  const n = await setup(t);
  await n.connect();
  const imported = await n.import();
  assert.equal(imported.status, 200);
  const source = n.p.sources[0];
  assert.equal(source.origin, "bee_fixture");
  assert.equal(source.beeVerified, false);
  assert.equal(source.text, baseline);
  assert.equal(source.provider.utterances.length, 1);
  assert.match(source.provider.summary, /Explicit fixture/);
  await n.run("add_decision", {
    title: "Keep the walkthrough online",
    rationale: "Use the working online flow at the venue.",
    assumptions: ["The venue has reliable internet"],
    reviewCondition: "Review if the venue internet becomes unavailable.",
    sourceId: source.id,
    quote: baseline,
  });
  assert.equal(
    (
      await n.request(`/projects/${n.p.id}/commands`, {
        type: "confirm_decision",
        payload: { id: n.p.decisions[0].id },
        expectedVersion: n.p.version,
      })
    ).status,
    400,
  );
  await n.run("confirm_decision", { id: n.p.decisions[0].id, sourceChecked: true });
  assert.equal((await n.import([102])).status, 200);
  const candidate = n.p.candidates.find((c) => c.kind === "reported_change");
  assert.ok(candidate);
  assert.equal(candidate.quote, later);
  assert.equal(candidate.decisionSnapshot.quote, baseline);
  assert.equal(n.calls.filter((c) => c.path === "/v1/conversations/101").length, 1);
  const before = n.p.sources.length;
  const repeated = await n.import([102]);
  assert.equal(repeated.data.receipt.unchanged, 1);
  assert.equal(n.p.sources.length, before);
  assert.equal(n.p.candidates.filter((c) => c.sourceId === candidate.sourceId).length, 1);
  const count = n.p.candidates.length;
  n.records.get(102).conversation.summary += " Additional fixture context.";
  assert.equal((await n.import([102])).data.receipt.revised, 1);
  assert.equal(
    n.p.candidates.length,
    count,
    "unchanged quote in a provider revision is not a second change report",
  );
});
test("changed provider content creates immutable source revisions; stale imports do not call provider", async (t) => {
  const n = await setup(t);
  await n.connect();
  await n.import();
  const original = structuredClone(n.p.sources[0]);
  n.records.set(101, conversation(101, "Correction: venue internet is now unavailable."));
  const revised = await n.import();
  assert.equal(revised.data.receipt.revised, 1);
  assert.deepEqual(n.p.sources[0], original);
  assert.equal(n.p.sources[1].supersedesSourceId, original.id);
  const calls = n.calls.length;
  assert.equal((await n.import([101], 1)).status, 409);
  assert.equal(n.calls.length, calls);
  const bad = await n.request("/bee/import", {
    projectId: n.p.id,
    expectedVersion: n.p.version,
    consent: false,
    ids: [101],
  });
  assert.equal(bad.status, 400);
});
test("manual JSON cannot forge provider origin, device verification, or receipts", async (t) => {
  const n = await setup(t);
  await n.run("import_sources", {
    sources: [
      {
        title: "Bee label is not evidence",
        text: baseline,
        occurredAt: "2026-09-05T12:00:00Z",
        origin: "bee_api",
        beeVerified: true,
        provider: { conversationId: 101, transport: "official_cli_proxy" },
      },
    ],
  });
  assert.equal(n.p.sources[0].origin, "manual_import");
  assert.equal(n.p.sources[0].beeVerified, false);
  assert.equal(n.p.sources[0].provider, undefined);
  assert.equal(
    (
      await n.request(`/projects/${n.p.id}/commands`, {
        expectedVersion: n.p.version,
        type: "import_bee_sources",
        payload: {},
      })
    ).status,
    400,
  );
});
test("incomplete processing and unavailable records fail atomically and preserve useful status", async (t) => {
  const n = await setup(t);
  await n.connect();
  const initial = structuredClone(n.p);
  n.records.get(102).conversation.state = "processing";
  assert.equal((await n.import([101, 102])).status, 409);
  assert.deepEqual(n.p, initial);
  n.records.delete(102);
  assert.equal((await n.import([101, 102])).status, 404);
  assert.deepEqual(n.p, initial);
  const status = (await n.request("/bee/status")).data.status;
  assert.ok(status.lastChecked);
  assert.match(status.lastError, /no longer available/);
  n.records.get(101).conversation.summary = "";
  assert.equal((await n.import()).status, 409);
});
test("disconnect during import invalidates the pending request and preserves old local evidence", async (t) => {
  let release, started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const n = await setup(t, async (url) => {
    if (url.pathname === "/v1/conversations")
      return Response.json({ conversations: [], next_cursor: null });
    started();
    await new Promise((resolve) => {
      release = resolve;
    });
    return Response.json(conversation());
  });
  await n.connect();
  const pending = n.import();
  await ready;
  assert.equal((await n.request("/bee/disconnect", {})).status, 200);
  release();
  assert.equal((await pending).status, 409);
  assert.equal(n.p.sources.length, 0);
  assert.equal((await n.request("/bee/status")).data.status.connected, false);
});
test("adapter restricts proxy origins, handles authorization failures, malformed data and bounded responses", async () => {
  for (const url of [
    "https://example.com",
    "http://localhost:8787",
    "http://127.0.0.1:8787/path",
    "http://user:password@127.0.0.1:8787",
    "file:///etc/passwd",
  ])
    assert.throws(() => createBeeAdapter({ proxyUrl: url }));
  const make = (response) =>
    createBeeAdapter({ proxyUrl: "http://127.0.0.1:8787", fetchImpl: async () => response });
  await assert.rejects(
    () => make(new Response("secret-provider-body", { status: 401 })).list(),
    /authorization expired/,
  );
  await assert.rejects(
    () => make(Response.json({ conversations: "bad" })).list(),
    /unexpected conversation list/,
  );
  await assert.rejects(() => make(new Response("x".repeat(1500001))).list(), /too large/);
  await assert.rejects(
    () => make(Response.json(conversation())).detail("../not-an-id"),
    /valid Bee conversation ID/,
  );
});

test("malformed Bee pages and detail records return actionable provider errors", async () => {
  const make = (data) => createBeeAdapter({
    proxyUrl: "http://127.0.0.1:8787",
    fetchImpl: async () => Response.json(data),
  });
  for (const conversations of [[null], [{ id: "101" }], [conversation().conversation, conversation().conversation]]) {
    await assert.rejects(() => make({ conversations }).list(), (error) =>
      error.status === 502 && /unexpected conversation list/.test(error.message));
  }
  for (const next_cursor of [{ secret: "never display provider contents" }, "x".repeat(1001), "same-page"]) {
    await assert.rejects(() => make({ conversations: [], next_cursor }).list("same-page"), (error) =>
      error.status === 502 && /pagination/.test(error.message));
  }
  await assert.rejects(() => make(null).detail(101), (error) =>
    error.status === 502 && /unexpected conversation record/.test(error.message));
  const malformed = conversation();
  malformed.conversation.transcriptions[1].utterances = [null];
  await assert.rejects(() => make(malformed).detail(101), (error) =>
    error.status === 502 && /invalid transcript segment/.test(error.message));
});

test("Bee utterance tie ordering is stable across repeated provider retrievals", async () => {
  const source = conversation();
  source.conversation.transcriptions[1].utterances = [
    { id: 2, text: "Second clause", spoken_at: source.conversation.start_time },
    { id: 1, text: "First clause", spoken_at: source.conversation.start_time },
  ];
  const adapter = createBeeAdapter({
    proxyUrl: "http://127.0.0.1:8787",
    fetchImpl: async () => Response.json(source),
  });
  const first = await adapter.detail(101);
  source.conversation.transcriptions[1].utterances.reverse();
  const second = await adapter.detail(101);
  assert.equal(first.text, "First clause\nSecond clause");
  assert.equal(first.digest, second.digest, "An ordering-only response change must not create new evidence");
});

test("Bee detail uses the same creation-time fallback as its list", async () => {
  const source = conversation();
  source.conversation.created_at = source.conversation.start_time;
  source.conversation.start_time = null;
  const adapter = createBeeAdapter({
    proxyUrl: "http://127.0.0.1:8787",
    fetchImpl: async (url) => Response.json(url.pathname === "/v1/conversations"
      ? { conversations: [source.conversation] }
      : source),
  });
  const listed = (await adapter.list()).conversations[0];
  const imported = await adapter.detail(101);
  assert.equal(imported.occurredAt, listed.occurredAt);
  assert.equal(imported.occurredAt, new Date(source.conversation.created_at).toISOString());
});

test("Bee ordering remains deterministic with mixed or missing IDs and equal text", async () => {
  const source = conversation();
  const segments = [
    { id: 20, text: "Identified later", spoken_at: source.conversation.start_time },
    { text: "Unidentified beta", spoken_at: source.conversation.start_time },
    { id: 10, text: "Identified earlier", spoken_at: source.conversation.start_time },
    { text: "Unidentified alpha", speaker: "second", spoken_at: source.conversation.start_time },
    { text: "Unidentified alpha", speaker: "first", spoken_at: source.conversation.start_time },
  ];
  const adapter = createBeeAdapter({
    proxyUrl: "http://127.0.0.1:8787",
    fetchImpl: async () => Response.json(source),
  });
  let digest;
  for (let offset = 0; offset < segments.length; offset++) {
    for (const reverse of [false, true]) {
      const order = [...segments.slice(offset), ...segments.slice(0, offset)];
      source.conversation.transcriptions[1].utterances = reverse ? order.reverse() : order;
      const result = await adapter.detail(101);
      digest ??= result.digest;
      assert.equal(result.digest, digest, "Provider order alone must not produce a source revision");
      assert.deepEqual(result.provider.utterances.map((u) => u.text), [
        "Identified earlier", "Identified later", "Unidentified alpha", "Unidentified alpha", "Unidentified beta",
      ]);
    }
  }
});

test("Bee distinguishes oversized processed transcripts from unavailable ones", async () => {
  const source = conversation();
  source.conversation.transcriptions[1].utterances = Array.from({ length: 3001 }, (_, id) => ({ id, text: "One" }));
  const adapter = createBeeAdapter({
    proxyUrl: "http://127.0.0.1:8787",
    fetchImpl: async () => Response.json(source),
  });
  await assert.rejects(() => adapter.detail(101), (error) =>
    error.status === 413 && /3,000|too large/.test(error.message));
});
