# Reopen MCP verification and integration notes

Verified locally on 11 October 2026. The source is runnable without Bee hardware, an Echo, Amazon's gated Alexa+ tools, a paid model key or cloud hosting. The [event FAQ](https://amazonappdev2026.devpost.com/details/faqs) permits a local repository and actual web MCP client demonstration.

## Reproduce

Run `npm ci`, `npm test`, `npm run build`, then `node tests/browser-assistant.mjs`. Install Playwright Chromium if needed (`npx playwright install chromium --only-shell`). The browser test starts a disposable in-memory server, uses fictional records and requires no external provider.

Observed checks:

- 35 Node tests passed, including actual official SDK Client initialization, tool discovery and calls over HTTP.
- The server negotiates `2025-11-25` during initialization and requires that protocol header afterward. Unsupported versions are not silently used for tool calls.
- Cookie login cannot authorize MCP. Missing, expired and revoked credentials fail. Other accounts' real decision/review IDs are inaccessible.
- Read-only credentials cannot draft. Owner reopening is required before a draft. Concurrent/stale versions fail. Drafting preserves checklist text until separate owner approval.
- UTF-8 characters split across request chunks retain their exact text. Review evidence keeps the proposal's original checklist anchor even after a later decision revision.
- The browser uses real initialize, tools/list and tools/call requests. Owner reopening and final approval happen through visible UI controls.
- Delayed replies cannot restore an old connection after token replacement. Revoking an older grant preserves an unrelated newly created secret. Review links survive sign-in and are consumed once. Notebook switches clear credentials.
- Desktop and 390px mobile layouts have no horizontal overflow; the browser workflow reports no page errors.
- Existing Bee fixture, mobile navigation, save-race, operation-race and load-recovery browser regressions also passed. These are fixture tests, not real Bee-device evidence.
- Production build passed. `npm audit --omit=dev` reported zero known production dependency vulnerabilities at this check.

Independent Astra review and an actual Claude source-only audit found issues that were fixed before publication. Claude's final source verdict was READY with no remaining blockers. That review did not run tests; the test outcomes above come from separate local execution. No live Alexa+ connection, customer study or production deployment is claimed.

## Friction log

These are observed application integration problems, not claims of provider outages.

| Task and steps | Expected / observed | Severity | Resolution / actionable suggestion |
| --- | --- | --- | --- |
| Open the development app on 127.0.0.1 with a custom port; connect its browser MCP client. | Expected same-site requests. An initially fixed localhost endpoint caused Origin rejection. | Important | Derive the advertised endpoint from configuration, use relative `/mcp` in the page, allow only fixed local aliases in development. A reference browser client should explicitly demonstrate this. |
| Initialize with an older/newer requested protocol, then call tools. | Expected server negotiation to its supported version. An initial strict rejection prevented compatible clients from negotiating. | Important | Follow MCP lifecycle negotiation and validate the subsequent protocol header. Include negotiation tests, not only one successful handshake. |
| Revoke an older grant while another connection has an outstanding tool call. | Expected usable current connection. Early UI code left its pending state stuck or erased the unrelated shown-once secret. | Important | Track the credential generation and grant identity; cancel stale feedback and preserve unrelated credentials. Document scoped revocation UX in examples. |
| Open a returned review link, then refresh from Assistant. | Expected one-time handoff. The query initially redirected the owner repeatedly and discarded the transient client. | Important | Consume the validated link after handoff. Test signed-in and signed-out flows plus subsequent refresh. |
| Use Alexa+ track tools without a partner account or physical device. | Gated tools were unavailable. | Important onboarding constraint | The official FAQ explicitly supports a local runnable repo and actual web MCP client. Keep this alternative beside each gated-tool setup guide. |

## Limits

The browser client is structured MCP controls, not an LLM chat. Conservative lexical triage can misclassify unfamiliar wording; source statements are not independently verified facts. Tokens are kept transient in the browser, so copying and reconnecting after navigation is an explicit part of the judge guide. Remote operators must configure exact origins and TLS; development loopback allowances do not enable arbitrary LAN origins.
