import { randomUUID } from "node:crypto";
import { createBeeAdapter, conversationId } from "./adapters.mjs";
import { fail, importBeeSources, Problem } from "./domain.mjs";

export function createBeeRoutes({ db, proxyUrl, ownerId, fetchImpl }) {
  const adapter = createBeeAdapter({ proxyUrl, fetchImpl, fixture: Boolean(fetchImpl) });
  db.exec(
    "CREATE TABLE IF NOT EXISTS bee_connections (owner_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, document TEXT NOT NULL)",
  );
  const busy = new Set();
  const read = (id) =>
    JSON.parse(
      db.prepare("SELECT document FROM bee_connections WHERE owner_id=?").get(id)?.document || "{}",
    );
  const write = (id, value) =>
    db
      .prepare(
        "INSERT INTO bee_connections VALUES(?,?) ON CONFLICT(owner_id) DO UPDATE SET document=excluded.document",
      )
      .run(id, JSON.stringify(value));
  const allowed = (id) => adapter.configured && Boolean(ownerId) && ownerId === id;
  function status(id) {
    const s = read(id),
      configured = allowed(id);
    return {
      configured,
      connected: configured && s.enabled === true,
      lastChecked: s.lastChecked || null,
      lastError: s.lastError || "",
      lastImport: s.lastImport || null,
      fixture: adapter.fixture,
      reason: configured
        ? "The official Bee CLI handles authorization on this server."
        : "The operator must configure the official Bee proxy and bind it to your Reopen account ID.",
      accountId: id,
    };
  }
  return async function handle(route, req, body, user, send) {
    if (!route.startsWith("/api/bee/")) return false;
    const uid = user.user_id;
    if (route === "/api/bee/status" && req.method === "GET") {
      send(200, { status: status(uid) });
      return true;
    }
    if (!allowed(uid)) fail("No Bee connection is configured for this account.", 403);
    if (req.method !== "POST") fail("This Bee action requires POST.", 405);
    if (route === "/api/bee/disconnect") {
      write(uid, {
        ...read(uid),
        enabled: false,
        generation: randomUUID(),
        disconnectedAt: new Date().toISOString(),
      });
      send(200, { status: status(uid) });
      return true;
    }
    if (!["/api/bee/connect", "/api/bee/conversations", "/api/bee/import"].includes(route))
      fail("This Bee action was not found.", 404);
    if (busy.has(uid)) fail("A Bee request is already running. Wait for it to finish.", 409);
    let connection = read(uid);
    if (route === "/api/bee/connect") {
      if (body.consent !== true)
        fail("Confirm permission to read conversation titles and summaries from Bee.");
      connection = {
        ...connection,
        enabled: false,
        generation: randomUUID(),
        consentAt: new Date().toISOString(),
      };
      write(uid, connection);
    } else if (!connection.enabled) fail("Connect Bee before reading conversations.", 409);
    const generation = connection.generation;
    const stillAuthorized = () => {
      if (
        !db.prepare("SELECT id FROM users WHERE id=?").get(uid) ||
        read(uid).generation !== generation
      )
        fail(
          "The Bee connection changed while this request was running. Nothing was imported.",
          409,
        );
    };
    busy.add(uid);
    try {
      let result;
      if (route === "/api/bee/import") {
        if (body.consent !== true)
          fail("Confirm that selected transcripts may be saved in this notebook.");
        if (
          !Array.isArray(body.ids) ||
          !body.ids.length ||
          body.ids.length > 5 ||
          new Set(body.ids).size !== body.ids.length
        )
          fail("Choose 1–5 distinct conversations.");
        body.ids.forEach(conversationId);
        if (
          typeof body.projectId !== "string" ||
          !/^[a-zA-Z0-9-]{1,100}$/.test(body.projectId) ||
          !Number.isSafeInteger(body.expectedVersion)
        )
          fail("Choose a valid notebook and version before importing.");
        const row = db
          .prepare("SELECT * FROM projects WHERE id=? AND owner_id=?")
          .get(body.projectId, uid);
        if (!row) fail("Notebook was not found.", 404);
        if (row.version !== body.expectedVersion)
          fail("The notebook changed. Refresh it before importing.", 409);
        const sources = await Promise.all(body.ids.map((id) => adapter.detail(id)));
        stillAuthorized();
        const { project, receipt } = importBeeSources(
          JSON.parse(row.document),
          sources,
          body.expectedVersion,
        );
        const changed = db
          .prepare(
            "UPDATE projects SET version=?,document=? WHERE id=? AND owner_id=? AND version=?",
          )
          .run(project.version, JSON.stringify(project), row.id, uid, row.version);
        if (!changed.changes)
          fail(
            "The notebook changed during the Bee request. Refresh and retry; nothing was imported.",
            409,
          );
        connection.lastImport = { ...receipt, at: new Date().toISOString() };
        result = { project, receipt };
      } else result = await adapter.list(body.cursor || "");
      stillAuthorized();
      write(uid, {
        ...connection,
        enabled: true,
        lastChecked: new Date().toISOString(),
        lastError: "",
      });
      send(200, { ...result, status: status(uid) });
    } catch (error) {
      if (
        db.prepare("SELECT id FROM users WHERE id=?").get(uid) &&
        read(uid).generation === generation
      )
        write(uid, {
          ...connection,
          lastChecked: new Date().toISOString(),
          lastError:
            error instanceof Problem ? error.message : "Bee could not complete the request.",
        });
      throw error;
    } finally {
      busy.delete(uid);
    }
    return true;
  };
}
