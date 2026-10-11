import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { mkdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Problem, str, fail, newProject, illustrativeProject, applyCommand } from "./domain.mjs";
import { integrationStatus } from "./adapters.mjs";
import { createBeeRoutes } from "./bee-routes.mjs";
import { createMcpRoutes } from "./mcp-routes.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const token = () => randomBytes(32).toString("base64url");
const digest = (x) => createHash("sha256").update(x).digest("hex");
const safeEqual = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const passwordHash = (password, salt) => scryptSync(password, salt, 64).toString("hex");
export async function createApp(options = {}) {
  const production = options.production ?? process.env.NODE_ENV === "production";
  const dataPath = options.dbPath || process.env.DATA_PATH || resolve(root, "data/reopen.sqlite");
  if (dataPath !== ":memory:") mkdirSync(dirname(dataPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dataPath);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  db.exec(
    `CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,salt TEXT NOT NULL,password TEXT NOT NULL,created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,csrf TEXT NOT NULL,expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,version INTEGER NOT NULL,document TEXT NOT NULL); CREATE INDEX IF NOT EXISTS projects_owner ON projects(owner_id);`,
  );
  const beeRoutes = createBeeRoutes({
    db,
    proxyUrl: options.beeProxyUrl ?? process.env.BEE_PROXY_URL,
    ownerId: options.beeOwnerId ?? process.env.REOPEN_BEE_OWNER_ID,
    fetchImpl: options.beeFetch,
  });
  const listenHost = process.env.HOST || "127.0.0.1";
  const advertisedHost = ["0.0.0.0", "::"].includes(listenHost) ? "127.0.0.1" : listenHost;
  const configuredOrigin = options.origin || process.env.APP_ORIGIN;
  const port = Number(process.env.PORT || 4333);
  const mcpRoutes = createMcpRoutes({
    db,
    origin: configuredOrigin || `http://${advertisedHost}:${port}`,
    alternateOrigins: !production && !configuredOrigin
      ? [`http://127.0.0.1:${port}`, `http://localhost:${port}`]
      : [],
  });
  const attempts = new Map();
  let vite = null;
  if (!production && !options.noVite) {
    const { createServer } = await import("vite");
    vite = await createServer({
      root,
      server: { middlewareMode: true, hmr: { port: Number(process.env.HMR_PORT || 24678) } },
      appType: "spa",
    });
  }
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(body));
    };
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (production)
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      );
    try {
      const url = new URL(req.url, "http://localhost");
      const route = url.pathname;
      if (route === "/mcp") return await mcpRoutes.mcpRoute(req, res);
      if (route === "/api/health")
        return send(200, { ok: true, storage: "sqlite", integrations: integrationStatus });
      if (!route.startsWith("/api/")) {
        if (vite)
          return vite.middlewares(req, res, () => {
            res.writeHead(404);
            res.end("Not found");
          });
        let file = resolve(root, "dist", `.${decodeURIComponent(route)}`);
        const base = resolve(root, "dist");
        if (!file.startsWith(base + "/")) file = resolve(base, "index.html");
        if (!existsSync(file) || !statSync(file).isFile()) file = resolve(base, "index.html");
        if (!existsSync(file)) {
          res.writeHead(503);
          return res.end("Build Reopen before starting production.");
        }
        const mime = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".svg": "image/svg+xml",
          ".ttf": "font/ttf",
          ".png": "image/png",
        };
        res.writeHead(200, {
          "Content-Type": mime[extname(file)] || "application/octet-stream",
          "Cache-Control": file.includes("/assets/")
            ? "public,max-age=31536000,immutable"
            : "no-cache",
        });
        return res.end(readFileSync(file));
      }
      let body = {};
      const writes = !["GET", "HEAD"].includes(req.method);
      if (writes) {
        const origin = options.origin || process.env.APP_ORIGIN || `http://${req.headers.host}`;
        if (!req.headers.origin || req.headers.origin !== origin)
          fail("This request did not come from this Reopen site.", 403);
        if (!req.headers["content-type"]?.startsWith("application/json"))
          fail("Use application/json.", 415);
        let text = "";
        for await (const chunk of req) {
          text += chunk.toString();
          if (Buffer.byteLength(text) > 256000) fail("The request exceeds 256 KB.", 413);
        }
        try {
          body = JSON.parse(text || "{}");
        } catch {
          fail("The request is not valid JSON.");
        }
        if (!body || Array.isArray(body) || typeof body !== "object") fail("Send a JSON object.");
      }
      const sessionCookie =
        req.headers.cookie
          ?.split(";")
          .map((x) => x.trim())
          .find((x) => x.startsWith("reopen_session="))
          ?.slice(15) || "";
      const session = sessionCookie
        ? db
            .prepare(
              "SELECT s.*,u.email,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?",
            )
            .get(digest(sessionCookie), Date.now())
        : null;
      const currentUser = () => {
        if (!session) fail("Sign in to open your private notebooks.", 401);
        if (writes && !safeEqual(req.headers["x-csrf-token"], session.csrf))
          fail("Your session security token changed. Refresh and try again.", 403);
        return session;
      };
      const setCookie = (value, maxAge) =>
        res.setHeader(
          "Set-Cookie",
          `reopen_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${production ? "; Secure" : ""}`,
        );
      if (route === "/api/session" && req.method === "GET")
        return send(200, {
          user: session ? { id: session.user_id, email: session.email, name: session.name } : null,
          csrf: session?.csrf || null,
          integrations: integrationStatus,
        });
      if (["/api/register", "/api/login"].includes(route) && req.method === "POST") {
        const remote = req.socket.remoteAddress || "unknown";
        const time = Date.now();
        let limit = attempts.get(remote);
        if (!limit || time - limit.since > 600000) limit = { since: time, count: 0 };
        limit.count++;
        attempts.set(remote, limit);
        if (attempts.size > 5000)
          for (const [k, v] of attempts) if (time - v.since > 600000) attempts.delete(k);
        if (limit.count > 20) fail("Too many sign-in attempts. Try again in 10 minutes.", 429);
        const email = str(body.email, "Email", 254).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Enter a valid email address.");
        const password = str(body.password, "Password", 200, 12);
        let user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
        if (route === "/api/register") {
          if (user) fail("An account with this email already exists. Sign in instead.", 409);
          const salt = token();
          user = {
            id: token(),
            email,
            name: str(body.name, "Name", 80, 2),
            salt,
            password: passwordHash(password, salt),
          };
          db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?)").run(
            user.id,
            email,
            user.name,
            salt,
            user.password,
            new Date().toISOString(),
          );
        } else {
          const calculated = passwordHash(password, user?.salt || "constant-time-dummy-salt");
          if (!user || !safeEqual(calculated, user.password))
            fail("Email or password is incorrect.", 401);
        }
        const sid = token(),
          csrf = token();
        db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
        db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
          digest(sid),
          user.id,
          csrf,
          Date.now() + 7 * 86400000,
        );
        setCookie(sid, 7 * 86400);
        return send(200, { user: { id: user.id, email: user.email, name: user.name }, csrf });
      }
      const user = currentUser();
      if (mcpRoutes.accessRoute(route, req, body, user, send)) return;
      if (await beeRoutes(route, req, body, user, send)) return;
      if (route === "/api/logout" && req.method === "POST") {
        db.prepare("DELETE FROM sessions WHERE token=?").run(digest(sessionCookie));
        setCookie("", 0);
        return send(200, { ok: true });
      }
      if (route === "/api/account" && req.method === "DELETE") {
        const u = db.prepare("SELECT * FROM users WHERE id=?").get(user.user_id);
        const supplied = str(body.password, "Password", 200, 12);
        if (!safeEqual(passwordHash(supplied, u.salt), u.password))
          fail("The password is incorrect.", 401);
        db.prepare("DELETE FROM users WHERE id=?").run(u.id);
        setCookie("", 0);
        return send(200, { ok: true });
      }
      if (route === "/api/projects" && req.method === "GET") {
        const projects = db
          .prepare("SELECT document FROM projects WHERE owner_id=?")
          .all(user.user_id)
          .map((x) => {
            const p = JSON.parse(x.document);
            return {
              id: p.id,
              title: p.title,
              description: p.description,
              version: p.version,
              updatedAt: p.updatedAt,
              decisions: p.decisions.length,
              reviews: p.candidates.filter(
                (c) =>
                  c.status === "pending" &&
                  ["reported_change", "correction", "manual"].includes(c.kind),
              ).length,
            };
          });
        return send(200, { projects });
      }
      if (route === "/api/projects" && req.method === "POST") {
        if (
          db.prepare("SELECT count(*) AS count FROM projects WHERE owner_id=?").get(user.user_id)
            .count >= 20
        )
          fail("You have reached 20 notebooks. Export and delete one before adding another.");
        const p =
          body.illustrative === true
            ? illustrativeProject()
            : newProject(body.title, body.description || "");
        db.prepare("INSERT INTO projects VALUES(?,?,?,?)").run(
          p.id,
          user.user_id,
          p.version,
          JSON.stringify(p),
        );
        return send(201, { project: p });
      }
      const match = route.match(/^\/api\/projects\/([a-zA-Z0-9-]+)(\/commands|\/export)?$/);
      if (match) {
        const row = db
          .prepare("SELECT * FROM projects WHERE id=? AND owner_id=?")
          .get(match[1], user.user_id);
        if (!row) fail("Notebook was not found.", 404);
        const p = JSON.parse(row.document);
        if (req.method === "GET") {
          if (match[2] === "/export")
            res.setHeader("Content-Disposition", `attachment; filename="reopen-${p.id}.json"`);
          return send(
            200,
            match[2] === "/export"
              ? {
                  format: "reopen-notebook-v1",
                  exportedAt: new Date().toISOString(),
                  integrations: integrationStatus,
                  project: p,
                }
              : { project: p },
          );
        }
        if (req.method === "DELETE" && !match[2]) {
          if (body.expectedVersion !== p.version)
            fail("The notebook changed. Refresh before deleting.", 409);
          db.prepare("DELETE FROM projects WHERE id=? AND owner_id=? AND version=?").run(
            p.id,
            user.user_id,
            p.version,
          );
          return send(200, { ok: true });
        }
        if (req.method === "POST" && match[2] === "/commands") {
          const updated = applyCommand(p, body);
          const result = db
            .prepare(
              "UPDATE projects SET version=?,document=? WHERE id=? AND owner_id=? AND version=?",
            )
            .run(updated.version, JSON.stringify(updated), p.id, user.user_id, p.version);
          if (!result.changes)
            fail("This notebook changed in another session. Refresh before retrying.", 409);
          return send(200, { project: updated });
        }
      }
      fail("This endpoint was not found.", 404);
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (!(error instanceof Problem)) console.error("Reopen server error:", error.message);
      send(error instanceof Problem ? error.status : 500, {
        error:
          error instanceof Problem ? error.message : "Something went wrong. Refresh and try again.",
      });
    }
  });
  return {
    server,
    db,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await vite?.close();
      db.close();
    },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.env.NODE_ENV === "production" && !process.env.APP_ORIGIN)
    throw new Error("Set APP_ORIGIN to the public HTTPS origin in production.");
  const app = await createApp();
  const port = Number(process.env.PORT || 4333);
  app.server.listen(port, process.env.HOST || "127.0.0.1", () =>
    console.log(`Reopen is listening on http://${process.env.HOST || "127.0.0.1"}:${port}`),
  );
  for (const sig of ["SIGINT", "SIGTERM"])
    process.once(sig, () => app.close().then(() => process.exit(0)));
}
