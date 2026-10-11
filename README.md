# Reopen

[Try the Alexa+ track MCP workflow](JUDGE-GUIDE.md).

A private decision notebook: preserve a decision’s rationale, review later evidence against its assumptions, and approve an exact downstream checklist change. React/TypeScript UI; Node 22 SQLite backend. A notebook-scoped MCP connection lets an assistant read the original reasoning and later evidence, then save an unapproved checklist proposal after the owner reopens the decision.

## Run

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:4333. Create an account and a notebook. Start with your own records, or deliberately choose the labeled illustrative example. The default database is `data/reopen.sqlite`; restart retains accounts, decisions, transcripts and audit history.

```sh
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

The optional `node tests/browser-walkthrough.mjs` runs a real fresh-account workflow against `TEST_URL` (default port 4433). Use a disposable database because it creates fictional test records.

## What works

- Private accounts, password hashing, HttpOnly session cookies, expiration, logout and account deletion.
- Up to 20 private notebooks per account, persistent SQLite storage and owner-scoped API queries.
- Draft decisions with rationale, assumptions, review condition, exact original quote and optional checklist anchor. Explicit confirmation activates watching; revisions preserve history and need confirmation again.
- Text/JSON transcript import, occurrence and import timestamps, external references, original content digest and immutable manual-import provenance. Content duplicates are skipped.
- Conservative local triage separates explicit change reports, questions/hypotheticals, uncertainty, corrections, context and other project references. Original rationale and exact later quote are paired for review.
- Exact manual evidence links; owner reopen, dismiss or clarification decisions with reasons. Clarification records a request locally and sends no external message.
- Checklist replacement draft, exact before/after preview, then separate approval. Stale decisions or checklist versions cannot overwrite newer work.
- Audit trail, JSON export, notebook and account deletion.

## Deliberate limits

The Bee connector is implemented, but **no real Bee connection or device data has been verified in this workspace**. AWS remains disconnected. Every manual upload keeps manual provenance even if its filename, label or JSON says Bee. Contract-test records are explicitly marked as fixtures. A successful API retrieval records transport provenance; it does not independently certify recording hardware or hackathon compliance.

Triage uses lexical rules, not a language model. It keeps conditional statements, uncertain reports such as “not confirmed,” and explicitly unchanged premises out of the change-report queue. Comparison normalizes curly apostrophes and matches topic aliases as whole words; saved source quotes keep their original wording. Mixed statements and unfamiliar phrasing can still be missed or misclassified. A report is a speaker’s assertion, not independently verified reality. Review the exact quote before reopening. No automatic repository edits, external messages or checklist changes occur.

Accounts currently have no email verification or password recovery. Do not claim a verified identity from an email address. Deploy behind HTTPS with a persistent volume and database backups. SQLite is appropriate for one application server; multi-instance deployments need a shared transactional store. Local files and backups are not application-level encrypted. Deletion removes active database rows; previously exported files and operator backups must be handled separately. There is no collaboration sharing.

## Production deployment

```sh
npm ci
npm run build
NODE_ENV=production APP_ORIGIN=https://reopen.example.com HOST=0.0.0.0 PORT=4333 DATA_PATH=/var/lib/reopen/reopen.sqlite node server/index.mjs
```

`APP_ORIGIN` must be the exact public origin with no trailing slash. The HTTPS reverse proxy must forward to the server without changing the original `Origin`. Production cookies use Secure, HttpOnly and SameSite=Strict; session tokens are hashed at rest. JSON mutations require the matching Origin and session CSRF token. Authentication is rate limited per direct socket address, so proxy-wide limits need operator configuration. Apply body-size and request-rate limits at the proxy too.

The production entrypoint refuses to start without `APP_ORIGIN`. Bind public traffic only behind TLS. Grant the application user write access only to the database directory. Persist the SQLite database and its WAL/SHM side files on the same local volume. Use SQLite’s online backup API or stop the server before copying the full database; do not copy a live database file alone. Check `/api/health` for process health without exposing user data.

Docker configuration is supplied, but Docker is not installed in this workspace, so the image has not been built here.

Docker example:

```sh
docker build -t reopen .
docker run --rm -p 4333:4333 -e APP_ORIGIN=https://reopen.example.com -v reopen-data:/app/data reopen
```

Run this behind an HTTPS reverse proxy. The source is public; no hosted deployment or real Bee-device demonstration has been verified. No third-party integration credentials are included.

## Import JSON

```json
[{"title":"Room check","text":"Your original words here.","occurredAt":"2026-09-08T10:30:00Z","provenance":"Manual notes; recorded with permission","externalId":"optional-reference","projectLabel":"Optional project name"}]
```

An object with a `sources` array is also accepted. Maximum 20 sources per import, 100,000 characters per transcript, 200 sources and 2 MB per notebook. The request body limit is 256 KB. The full notebook export is a portable record, not a supported overwrite/import command.

## Source layout

- `server/domain.mjs`: pure notebook commands and conservative triage.
- `server/index.mjs`: SQLite, authentication, owner isolation, HTTP and production static serving.
- `server/adapters.mjs`: bounded official Bee proxy reads and processed conversation normalization.
- `server/mcp-routes.mjs`: scoped assistant access and Streamable HTTP MCP tools.
- `src/AssistantConnection.tsx`: connection consent, actual browser MCP client and revocation.
- `server/bee-routes.mjs`: private connection consent, selected imports, status, and disconnect lifecycle.
- `src/App.tsx`, `src/style.css`: accessible forms, private workspace and responsive decision journal.
- `tests/`: domain/API regressions and the optional browser walkthrough.

Fonts are self-hosted DM Sans and Newsreader under their included OFL licenses. No remote fonts or tracking scripts load.

## Follow a decision’s history

Use **Follow this decision’s history** beneath a decision, or **View decision history** from its paired evidence. Select a saved version to read its exact reasoning and review trail. Left/Right and Home/End navigate the version rail. **What changed since v…?** compares the stored fields side by side. Approved checklist changes retain their original before/after text and approval timestamp.

Only recorded versions appear. Older partial records are marked when wording was not saved; Reopen never reconstructs them from the current decision. The reader respects reduced motion and loads no 3D dependency. `node tests/browser-interactions.mjs` verifies a fresh UI-saved workflow including imports, confirmation, reopening, checklist approval, revision, historical/current selection, keyboard and mobile/reduced-motion behavior against a disposable server on port 4433. Set `HMR_PORT=24433` for that dev server to avoid another local Vite websocket; production does not use HMR.


Unapproved checklist proposals show a recovery notice when the linked decision or checklist item version changes. Their saved before/after text remains historical evidence; approval controls return only for a fresh review. `node tests/browser-proposal-recovery.mjs` uses an isolated in-memory server and fictional examples to check both stale paths, the full revision/confirmation/reopening/approval recovery, historical approved changes and mobile layout. Run `npm run build` first; use the existing Playwright Chromium cache. Set `SCREENSHOT_PATH` optionally to save the changed review screen.

## Connect real Bee conversations

The integration uses the official [Bee CLI loopback proxy](https://docs.bee.computer/docs/proxy). Authenticate the CLI on the same trusted machine as this Node process, then run `bee proxy --port 8787`. Keep that unauthenticated proxy bound to loopback. Reopen uses fixed read endpoints only; it never forwards browser-provided URLs or writes to Bee.

1. Create your Reopen account. Open a notebook → Sources → **Set up a private connection** and copy your Reopen account ID.
2. Set `BEE_PROXY_URL=http://127.0.0.1:8787` and `REOPEN_BEE_OWNER_ID=<that account ID>` in the Node server environment, then restart Reopen. `.env.example` is documentation; the server does not automatically load `.env` files. The proxy is available only to that exact account ID, never an unverified email or every registered user.
3. In Sources, grant permission to read titles and summaries, then choose **Connect and browse**. This performs the first provider request. Browse pages of up to 20 conversations and select at most five. Only processed conversations with finalized transcripts and generated context can be imported.
4. Confirm permission to save the selected records. Import them into the active notebook. Record a decision with one as its original source, compare Bee’s context with the transcript, and explicitly check the wording before confirmation. Later selected conversations feed the existing review queue.
5. Select an already saved conversation and import again to check for updates. Unchanged content is skipped; changed content creates an immutable revision. Existing decision quotes and review snapshots retain their original source. Repeated unchanged quotes do not create duplicate alerts for the same decision version.

The official [conversation resource implementation](https://github.com/bee-computer/bee-cli/blob/main/sources/resources/conversations/index.ts) defines list pagination, conversation timestamps, processed transcript groups and utterance fields. Reopen stores returned IDs, available utterance timestamps, provider-reported device type, processed context, a content digest and retrieval time. It excludes location coordinates and unrelated account data. It chooses a finalized transcript instead of combining it with a duplicate live transcription. Device type remains provider-reported; missing source detail is never fabricated.

Each request is explicit, time bounded and size limited. Last-checked time, sanitized errors and import counts persist privately. A missing/deleted upstream conversation produces an error without erasing local evidence. A failed selection batch writes no source records. A notebook edited during retrieval rejects the stale import. Disconnect invalidates in-flight work, stops future reads and retains previous notebook copies. Deleting the notebook or account deletes active local copies; original Bee records, prior exports and operator backups remain separate.

This connector is for one operator’s Bee account on a trusted local host. It is **not** a multi-user Bee OAuth service. A generic Docker container cannot reach a host-side loopback proxy through `127.0.0.1`; run Node beside the official CLI for the integration, or design a separate authenticated deployment transport. Do not expose the proxy or relax the loopback restriction. No Bee token is stored by Reopen or sent to the browser.

## Alexa+ track: a real MCP client, no device required

Reopen targets the **Alexa+ self-hosted MCP route**, using Streamable HTTP at `/mcp` and protocol `2025-11-25`. The Assistant view is a real web MCP client: it initializes the connection, discovers tools and calls them against this running server. It is not connected to a physical Echo or Amazon's gated Alexa+ developer console. Its structured controls are not presented as an LLM conversation.

The [official FAQ](https://amazonappdev2026.devpost.com/details/faqs) permits a locally runnable public repository plus a demo video and explicitly accepts a web page making real MCP initialize, tools-list and tools-call requests. No Bee device is required for this track. The optional Bee connector remains separate and has no real-device verification claim.

### Connect an assistant

Open a notebook's **Assistant** view. Create a read-only connection, or explicitly allow unapproved checklist drafts. Copy the one-time secret to your own temporary secure location before leaving the view; navigation and refresh clear the browser client, so paste it again to reconnect. Access is scoped to that one notebook, expires after one hour, can be revoked, and is displayed only once. The server stores a token hash. Keep the credential private; never put it in a URL, repository or recording.

The web client keeps its credential only in memory. An external compatible MCP client can use the displayed endpoint with an `Authorization: Bearer <token>` header. Cookie login alone cannot authorize MCP requests. Remote deployment requires HTTPS; local judging uses loopback. Without an explicit `APP_ORIGIN`, development MCP requests accept only `localhost` and `127.0.0.1` on the configured port. For a LAN/custom hostname, explicitly configure its exact `APP_ORIGIN`; the request Host header is never used to widen access.

Available tools:

| Tool | Purpose |
| --- | --- |
| `reopen_notebook_overview` | List the selected notebook's decisions, reviews and current version. |
| `reopen_explain_decision` | Read the original reasoning, source quote and saved history. |
| `reopen_review_evidence` | Compare later evidence with the preserved decision snapshot. |
| `reopen_draft_checklist_change` | Save an exact unapproved replacement after the owner has reopened the decision, if explicitly allowed. |

There is no MCP tool to reopen a decision, approve a checklist change, import a source or run arbitrary commands. Reopen remains the owner's approval surface. Quotes are untrusted evidence, not assistant instructions. Concurrent changes reject stale writes instead of overwriting newer work.

### Runtime demonstration

1. Choose the clearly labeled illustrative example, **The demo room**. This is fictional manual data, not Bee data.
2. In Assistant, connect and load the notebook overview. Ask for the online-only decision's rationale and its original reliable-internet assumption using the real tool controls.
3. Read the later evidence. The hypothetical question and explicit no-Wi-Fi report remain separate, with exact quotes and provenance.
4. In Evidence, record your judgment and reopen the reported change. Return to Assistant, refresh the notebook version if needed, paste the copied secret and reconnect, then draft: **Prepare an offline product walkthrough before the venue demo**.
5. Refresh the notebook after the MCP draft, then review the exact before/after in Evidence and approve separately. Open history to see the preserved original reasoning and approved consequence.
6. Revoke the assistant connection. Further tool calls must fail.

Reopen is distinct from Understudy: Reopen preserves a decision across time and governs a change to its downstream checklist; Understudy rehearses equipment-lending requests against policy gaps. The sponsor makes the final determination on substantially different entries.

For optional future Bee verification, see [BEE-VERIFICATION.md](BEE-VERIFICATION.md). It is not a prerequisite for the Alexa+ workflow.

## Connector verification and delayed responses

`node tests/browser-bee.mjs` starts its own disposable in-memory server and uses a visibly labeled fixture transport. Its workflow covers consent, selected import, context and wording confirmation, later evidence, separate checklist approval, repeated-source deduplication, mobile layout, reduced motion and disconnect persistence. It also holds a completed import response across a notebook switch and across logout/login to a second account; neither response may restore the old view. Callback guards include component lifetime, account/session identity, notebook identity, navigation generation and returned version. These are application checks, not proof of real Bee recordings. The completed local receipt and screenshots are in `.impeccable/review/bee-*`.

`node tests/browser-save-race.mjs` exercises delayed manual saves and failures while switching notebooks and opening a new editor. The save stays in its original notebook without replacing the selected notebook or closing an unrelated draft. `node tests/browser-operation-race.mjs` holds two example requests and checks that an older completion cannot clear the newer request's busy state or replace its feedback. These browser scripts serve the production build in an isolated server: run `npm run build` first. They need Playwright Chromium (`npx playwright install chromium --only-shell`). An optional `PLAYWRIGHT_BROWSERS_PATH` may point to a separate test cache; `.cache/` is excluded from source and Docker packaging.

Bee list and detail responses are validated before use and share the same start-time/creation-time fallback. Malformed records, duplicate list IDs and invalid or repeated page cursors produce a sanitized provider error. Transcripts over 3,000 segments return a size error. Transcript segments with equal timestamps follow Bee's ID ordering; missing or duplicate IDs use a stable text and metadata tie-break. That fallback does not infer speaking order, but keeps a reordered provider response from creating a false source revision.
