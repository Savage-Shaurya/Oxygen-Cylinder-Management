# Security and API audit resolution

This tracks the server, persistence, and API items in `Findings.md`. Verification used temporary synthetic databases and test servers; existing `data/` databases were not modified by this work.

| Finding | Resolution | Remaining limit |
| --- | --- | --- |
| H1, shared-IP login lockout | The shared IP ceiling is 100 failures per 15 minutes, a successful login clears both IP and email/IP counters, and 429 has a distinct message. `CTMS_TRUST_PROXY_CIDRS` explicitly lists proxy networks whose forwarded client IP and scheme are trusted. | Five failures for the same email from one client IP still pause that pair for 15 minutes. Deployment must set the proxy network correctly. |
| H6, missing money audit | Receipt IDs are scoped through their customer branch, so payment, deposit, and refund events appear in audit and JSON export for authorized auditors/admins. | Historical receipt events remain tied to the receipt's current party branch; branch migration policy is separate. |
| M3, global revision and large action responses | The server supports `Prefer: return=delta`, returning changed and removed scoped records plus base/new revisions. The client checks the base revision and fetches a fresh bootstrap on a gap. Routine create/transition forms no longer send a company revision; party and settings overwrite forms now use their own entity versions. A stale edit of the same entity returns 409 and the form can reload current values. | State persistence still rewrites the full JSON state and server delta computation scans collections. This is a wire-size and conflict-frequency improvement, not entity-level database concurrency. |
| M7, final organization admin | A user update cannot remove the last active admin who covers every branch. | An organization with no such admin before this change still needs administrative repair. |
| M8, reserved demo email | Creation and provisioning reject `@batra.demo` regardless of case, with an email length limit of 254 characters. | Existing invalid accounts are not rewritten automatically. |
| M16, replay after user edit | No-op edits and additive branch grants preserve idempotent replay. Role changes, deactivation, branch removal, and password changes/reset advance the authorization epoch and revoke sessions, so a stale privileged replay stays blocked. | A delivery queued before authorization is reduced still requires a new authorized submission. |
| Prototype-named actions | The domain permission registry checks own properties before lookup; names such as `constructor` receive a validation response. | — |
| Live secure defaults | Explicit live mode enables Secure cookies and CSP even when `NODE_ENV` is unset. | HTTPS termination requires the trusted proxy network setting above. |
| Backup of an empty source | The backup script verifies the existing source is an initialized CTMS database using a read-only connection before opening the Store. | — |
| Private database files | New database, backup, and restored snapshot files are created with mode `0600`. | Pre-existing files retain their current permissions; operators should review those separately. |
| Password and email rules | Whitespace-only passwords are rejected; user email is bounded. Users can change their password with `POST /api/password` (current and new password). An admin can reset another in-scope user's password with `POST /api/users/:id/password`. Both revoke the target's sessions and add a secret-free audit event. | Password reset is an administrator action; there is no email recovery service. Account-screen controls expose change and administrator reset in the current working tree. |
| Empty-ID audit leakage | Organization-wide events without an entity ID are visible only to an admin or auditor who covers every branch. | — |
| Foreign-ID disclosure | Branch-scoped lookups use the same 404 response for missing and out-of-scope IDs. | — |
| Origin scheme | State-changing requests compare both host and scheme with the effective request origin. | Reverse proxies must be explicitly trusted to supply the HTTPS scheme. |
| Session lifetime | Sessions expire after 30 minutes idle, retain the 12-hour absolute lifetime, and expired rows are deleted when a new session is made. | Idle expiry is checked on access; old rows are collected on new sign-in. |
| Financial field visibility | Operations, quality, and driver views redact `freeDays` alongside rental and deposit values. | Admins, finance, and auditors retain financial visibility. |
| CSV formula prefix | The cylinder CSV exporter neutralizes ASCII and full-width formula-leading characters. | — |

Focused verification: `npx tsx --test tests/api-client.test.ts tests/api.test.ts` passed 39 tests; `npm run typecheck` and `git diff --check` passed. The empty-backup preflight is covered against a zero-byte synthetic source and exits without creating a backup or demo accounts.
