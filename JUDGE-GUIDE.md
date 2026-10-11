# Try Reopen: decisions that can change without losing their reasons

Reopen's Alexa+ track entry adds a real Streamable HTTP MCP server and browser client to a private decision notebook. No Bee device, Echo, hosted account or paid AI key is needed to run the core demo.

## Start locally

Use Node 22.14 or newer. Run `npm ci`, `npm run build`, then `npm run dev`. Open http://127.0.0.1:4333, create a local account and choose **Explore an illustrative example**. Every example statement is fictional. Your local account and records persist in `data/reopen.sqlite`.

## Follow the new workflow

1. Open **Assistant**. Create notebook-scoped access with permission to save unapproved drafts, then connect the real MCP client. Copy the one-time secret to your own temporary secure location before leaving this view; it is needed when reconnecting. Keep it out of screenshots.
2. Load the overview and read **Keep the demo online-only**. The tool returns the original rationale, reliable-internet assumption and exact planning quote.
3. Inspect later evidence. A hypothetical question is separate from the report that the room will have no Wi-Fi. Review the quote yourself; the statement is not independently verified reality.
4. Open **Evidence**, select the explicit report, enter a reason and choose to reopen. This owner action is not available to the assistant.
5. Return to **Assistant**, refresh the notebook if its version is stale, paste the copied secret and reconnect. Draft **Prepare an offline product walkthrough before the venue demo** for that review. The MCP call saves a proposal; it does not change the checklist.
6. Refresh the notebook after the MCP draft, then open **Evidence**, inspect the before/after, and approve separately. Read decision history to see the original reasoning and approved checklist change.
7. Revoke the assistant access. Further tool calls must fail. Reload to check that approved notebook history persists.

## What this demonstrates

The browser performs actual MCP initialization, tool discovery and tool calls over Streamable HTTP, using protocol `2025-11-25`. Compatible external MCP clients may connect using the displayed endpoint and private bearer token. Read-only access is the default, credentials expire after one hour, and writes use version checks.

The [official FAQ](https://amazonappdev2026.devpost.com/details/faqs) permits a local runnable repository and a web MCP client demonstration. This is not a claim of live Alexa+ distribution or an Echo connection. Reopen's significant update is the scoped MCP read-and-draft workflow; its existing source, owner review and immutable history underpin that workflow.

## Evidence boundaries

The optional Bee connector remains implemented and fixture-tested. No Bee or Apple Watch recording has been available, so this entry does not seek the Bee track. Manual and illustrative data retain their original provenance. Triage is conservative lexical matching, not an LLM or fact checker. Mixed language may be missed or misclassified. There has been no customer usefulness study.

The UI remains the final approval surface. No tool can approve a change, reopen a decision, import conversations, edit a repository or send a message. See [README](README.md) for setup, deployment limits and the tool contract.
