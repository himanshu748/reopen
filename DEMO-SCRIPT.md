# Reopen MCP demo script (2:40)

Record actual running app/client footage. The demo uses the clearly labeled fictional **The demo room** notebook. It is not Bee data, a physical Echo conversation or an Alexa+ console session. Keep grant tokens and account credentials out of the recording. Upload and submit manually.

| Time | Live shot | Narration |
| --- | --- | --- |
| 0:00–0:15 | Reopen notebook with its illustrative-data label | A project lead needs to preserve why a decision was made and govern what happens when its assumption changes. |
| 0:15–0:35 | Assistant creates a scoped connection; conceal the secret | This is a real self-hosted MCP server. Access expires and belongs to this notebook. |
| 0:35–0:55 | Real client initializes, lists tools, reads overview/rationale | The server negotiates 2025-11-25 over Streamable HTTP. The read returns the preserved reason and exact source quote. |
| 0:55–1:15 | Read later evidence and distinguish the hypothetical from the explicit no-Wi-Fi report | Later speech is evidence for review, not an instruction to the assistant. |
| 1:15–1:35 | Owner reopens the decision with a reason in Evidence | Only the owner can decide to reopen. |
| 1:35–1:55 | Reconnect assistant, refresh version and draft the offline walkthrough change | The actual MCP tool saves an exact unapproved replacement. It cannot approve it. |
| 1:55–2:15 | Owner refreshes, inspects before/after and approves separately | Version checks prevent stale changes. Approval remains an explicit owner action. |
| 2:15–2:30 | History and revoked connection denial | The earlier rationale stays intact; revoked assistant access stops working. |
| 2:30–2:40 | HTTPS client receipt and honest boundaries | Local Docker/Caddy HTTPS is reproducible. Bee is optional and unverified; there is no AWS model call. |

Before filming, run `npm run judge:https` and [the UI judge path](JUDGE-GUIDE.md). The terminal receipt may show metadata only, never the secret. Keep total edited runtime below three minutes and preserve actual failures if they occur. If a new recording replaces the submitted video, update the README and Devpost links together.
