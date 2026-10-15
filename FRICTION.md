# Observed friction

15 October 2026; observations from this repair pass only.

| Task | Steps | Expected | Actual | Severity | Workaround | Suggestion |
| --- | --- | --- | --- | --- | --- | --- |
| Deploy local HTTPS | Run Docker info, then the Compose judge command | Engine and Compose available | Docker Engine 29.5.2 worked, but the CLI lacked the Compose plugin | Medium, local tooling | Verified official standalone Compose v5.6.0 in task scratch space; runner supports an explicit executable and clear preflight | Ship a separate Compose availability check with setup instructions |
| Configure Bee credentials | Follow the old proxy link and compare official API guide | Current documented environment-token route | Guide now documents a fixed public HTTPS/Bearer endpoint in addition to loopback proxy; app supported only proxy | Medium, integration | Added fixed-host environment-only BEE_TOKEN route while retaining proxy | Keep public/proxy authentication and device-evidence limits adjacent |
| Verify real Bee data | Check current credential environment and prior evidence | Authorized real conversation available | No Bee credential/device input available to this process | Blocking Bee-only evidence | Keep connector unverified; provide explicit-ID import and counts-only receipt script | Separate transport success from recording-hardware provenance |

| Scan staged source | Scan the changed Bee test file before commit | No credential-shaped constants | Scanner flagged an existing synthetic test-account password | Low, fixture | Replaced that fixed test password with an ephemeral random value and reran the affected tests | Distinguish test fixture findings from real credential leaks |

Owner confirmation required: real Bee/Apple Watch recordings and personal product opinions. Contract fixtures, fictional notebooks and local HTTPS never establish those facts.
