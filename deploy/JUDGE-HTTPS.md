# Local HTTPS deployment and real MCP judge check

Requires Docker Engine/Desktop, Docker Compose (plugin or standalone), Node 22.14+ and npm. The stack binds **only** `127.0.0.1:8443`, runs one production Node container with persistent SQLite, and places Caddy in front of its unexposed backend port. It creates no paid resource. This is a locally deployed server, not public hosting.

From a clean clone:

```sh
npm ci
```

Set `REOPEN_JUDGE_PASSWORD` in the process environment to a private value of at least 12 characters. It is used only for an ephemeral fictional judge account which is removed after the check. Do not type the value in a command argument or commit it. The script does not load `.env` files.

```sh
npm run judge:https
```

If the Docker CLI has no Compose plugin, install Docker's official Compose distribution, or set `REOPEN_COMPOSE_BIN` to a verified official standalone executable. No global dependency or shell-profile change is required by this project. The runner supports both forms and fails clearly if neither exists.

The command builds the image, starts the actual containers, copies Caddy's **public root certificate** to ignored `.judge/root.crt`, verifies HTTPS health with `curl --cacert`, then runs the official SDK MCP client with `NODE_EXTRA_CA_CERTS`. It never uses `curl -k` or `NODE_TLS_REJECT_UNAUTHORIZED=0`, and does not install a CA in the system trust store. The client registers a disposable local account, opts into the explicitly fictional notebook, mints a read-only grant, negotiates 2025-11-25, discovers all four tools, reads actual notebook/rationale data, checks Origin/GET handling, revokes the grant and verifies denial, then deletes the account.

Inspect `.judge/mcp-receipt.json` and `.judge/https-health.json`. A failed receipt is a failed run, not configuration proof. Neither receipt contains credentials or notebook content. CI repeats the same HTTPS deployment on a clean runner and retains only these sanitized receipts. The existing MCP suite separately covers guarded drafts, owner approval, scope isolation, concurrent versions, expiry and protocol negotiation.

## UI judging without the hosted owner's login

Open https://localhost:8443 using a browser that trusts this stack's local CA. The certificate is issued only by the local Caddy CA. Add `.judge/root.crt` to your own browser/OS trust store only after inspecting it; this optional trust step is manual. Do not publish the Caddy private CA volume. Alternatively use the existing `npm run dev` at http://127.0.0.1:4333 for the UI walkthrough, while the CLI independently checks HTTPS.

Create your own account and deliberately choose **The demo room**, which is labeled fictional. Then follow [JUDGE-GUIDE.md](../JUDGE-GUIDE.md): real MCP overview/rationale/evidence, owner reopens, unapproved draft, separate owner approval and revoke. No shared owner credential is needed. Bee remains disconnected by default.

The containers stay running for local judging. To stop them while preserving notebooks and CA:

```sh
docker compose -f compose.judge.yaml down
```

Use the standalone binary for that same command if you selected it. Removing named volumes also deletes notebook data and local CA; do that only for your disposable judge instance after you are finished. Do not apply this configuration as a public deployment without configuring an actual domain, public CA and operational storage/backups.

## Verified local run (15 October 2026)

The Docker production build and actual Caddy HTTPS stack ran on this Mac. The external official SDK client passed at https://localhost:8443 with protocol 2025-11-25, four discovered tools, notebook/rationale calls, Origin/GET checks, revocation denial and disposable-account cleanup. Certificate validation remained enabled and used the copied local CA. The containers remain available for local judging; this is not an internet-hosted endpoint. The clean-runner CI repeats the same command on the committed source.

## Verification status

The receipt, exact source and CI run are the execution evidence. A local CA is not a public CA and localhost is not a public demo. No Alexa+ console, physical Echo, real Bee recording or AWS inference use is implied by this deployment.
