# Real Bee verification

Reopen is ready for a local rehearsal using explicitly labeled fixtures. Real Bee or Apple Watch recording and processing have **not** been verified. A manual upload, an API fixture or a provider-reported device label does not close that gap.

**Local readiness status — 29 September 2026:** the user confirmed they have no Bee device or Apple Watch access. Reopen therefore cannot currently satisfy the track's real-device-data requirement. Keep it as a tested local prototype; do not submit it as a verified Bee entry. The steps below apply only if access becomes available.

## Before connecting

1. Record two short, consenting conversations with a Bee device or the Bee Apple Watch app. The first should contain a decision and its assumption; the later one should clearly revise that assumption. It is fine to stage a demo if the video says so. Avoid names or private details that are not needed for the demonstration.
2. Let Bee process both recordings. Confirm in Bee that each has a finalized transcript and generated context. Keep a short capture of the actual recording/processing path to establish how these records were produced.
3. On the same trusted machine as Reopen, authenticate the official Bee CLI and run `bee proxy --port 8787`. Follow the [official proxy instructions](https://docs.bee.computer/docs/proxy). Keep the proxy on loopback; never publish it.
4. Create a Reopen account, open Sources → Set up a private connection, and copy that account ID. Start Reopen with `BEE_PROXY_URL=http://127.0.0.1:8787` and `REOPEN_BEE_OWNER_ID` set to that ID. The server does not read `.env` automatically. Do not put credentials in the browser, repository or demo recording.

## Verify the complete decision flow

1. Create a notebook and a checklist item. In Sources, grant the browsing consent and connect. Select only the first real conversation, then approve saving it.
2. Open the saved source. Compare Bee's context with the original transcript, note its conversation ID and retrieval time, then create a decision anchored to the checklist item. Confirm the wording and explicitly activate the decision.
3. Import the later conversation. Open its evidence next to the original rationale. Record the owner's judgment, reopen the decision, draft an exact checklist replacement, and approve that replacement separately.
4. Re-import the same later conversation. An unchanged record should report `0 new · 0 revised · 1 unchanged`. Open decision history and verify the original wording and the approved before/after checklist record.
5. Disconnect and refresh the page. The private notebook keeps both imported sources and its audit history. Record the completed flow in a public demo under the event's video limit; publish only consented, sanitized content.

If Bee is still processing, wait and refresh. If authorization expires, sign in again through the official CLI. An unavailable conversation or failed selection batch must leave existing evidence intact. Do not replace a failed live step with fixtures without labeling that change.

## Evidence to retain privately

- Date, device/app used, and the user's confirmation that both selected recordings were made and processed through Bee.
- The two returned conversation IDs and retrieval timestamps, plus the unchanged-import receipt.
- A capture of original rationale, later evidence, owner judgment, separate checklist approval and decision history.
- The source commit and test results used for the recording.

An exported notebook contains private transcripts. Keep the full export private unless everyone represented has agreed to publication. Reopen's transport receipt proves what the connector retrieved; the recording/processing capture establishes the device workflow separately. Eligibility and submission acceptance remain organizer decisions.
