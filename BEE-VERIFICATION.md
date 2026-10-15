# Real Bee import and evidence boundary

**Unverified:** no real Bee account/device data was available for this repair pass. The connector remains optional for the Alexa+ MCP entry. Manual/illustrative sources never count as Bee data, and importing official API data does not independently certify a recording device.

The current [official API guide](https://docs.bee.computer/docs/api) documents the public HTTPS endpoint `https://api.developer.bee.amazon.dev` with Bearer authentication, plus the CLI loopback proxy. Reopen supports both. It fixes the public host in server code, follows no redirects, bounds responses and reads only conversation endpoints. Never expose the unauthenticated loopback proxy to the internet.

## Owner steps (about 15–30 minutes)

1. Record an authorized real conversation using a Bee device or an Apple Watch running Bee. Wait for processing; keep a separate device/app recording or screenshot establishing the recording source. Do not import other people's private conversations without permission.
2. Authenticate through Bee yourself. If using the [official CLI](https://docs.bee.computer/docs/cli), use `bee login` or its documented token-stdin flow. For direct API access, provide the authorized token as `BEE_TOKEN` in the environment. For proxy mode, run `bee proxy --port 8787` and set `BEE_PROXY_URL=http://127.0.0.1:8787`. Never configure both.
3. Create your own local Reopen account/notebook. Sources shows your account ID; the selected notebook ID is in its URL. Choose 1–5 actual processed conversation IDs from Bee. Keep all content private.
4. Set these environment variables in your own terminal: `DATA_PATH` (absolute path to that existing SQLite database), `REOPEN_BEE_OWNER_ID`, `REOPEN_BEE_PROJECT_ID`, `BEE_CONVERSATION_IDS` (comma-separated positive IDs), and either `BEE_TOKEN` or `BEE_PROXY_URL`. The script does not read credentials from a file or command argument. Review consent and the selected IDs before invoking it.

```sh
npm run bee:import-real
```

The script retrieves the selected conversations through native fetch and the production adapter, checks processed context/transcripts, imports actual sources into the owner-scoped notebook with an atomic version precondition, and saves `.impeccable/review/bee-receipts/<UTC>.json` with **date, IDs and counts only**. It logs no transcript, title, summary, token, signed URL or account credentials. Repeating unchanged content is deduplicated; changed content becomes a preserved source revision. If the notebook changes while retrieval is running, the update is rejected.

5. Inspect the private notebook and receipt. Review the exact original source quote, create/confirm a decision, import actual later evidence, reopen and approve a checklist consequence. Keep a separate truthful hardware-origin record; `beeVerified` remains false and device type is only provider-reported. Publish a sanitized receipt or footage only after your own review.

For the UI connection, set the same Bee transport and `REOPEN_BEE_OWNER_ID` in the running Node server environment before startup; import permission remains explicit in Sources. The Docker HTTPS judging stack leaves Bee unconfigured by default, so it never silently receives credentials from the host.

No real import receipt is bundled, because no real import has been run. Contract tests use explicit synthetic fixtures and retain `bee_fixture` provenance. After two identical blocking failures, stop, record the cause/owner action in FRICTION.md and resolve the account/provider prerequisite before retrying.
