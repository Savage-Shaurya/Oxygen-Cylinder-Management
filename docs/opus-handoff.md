# Opus handoff — 28 September 2026

The user asked to pause feature work after the current pass. This working tree contains the original `Findings.md` audit repairs and the later conservative demo policies. Do not treat it as deployed or migrated. Preserve every existing user database and uncommitted file. The original audit is retained unchanged; `docs/findings-status-tracker.md` maps C1, H1–H7, and M1–M20 to their current implementation and limits. Domain, security, and API details are in the adjacent resolution notes. `docs/testing-baby-steps.md` is the hands-on guide for a separate synthetic workspace.

## Latest implementation

- Offsite incidents preserve physical custody. An admin supplies a dated, unbilled rent stop; unrecovered lost stock can then be written off with a reason, and third-party-owned stock requires an owner authorization reference. No incident date is chosen automatically.
- Company-owned cylinders may be returned at another branch when the actor has both branch scopes. Third-party-owned cylinders return to their owner branch. Pickup reversal works only while selected cylinders remain on the pickup vehicle and retains the original pickup history.
- Supplier transfer, supplier-owned customer dispatch, non-company plant retirement, and writeoff record owner consent. Supplier-owned rental has an explicit charge/no-charge setting with the earlier charge policy as the legacy default.
- Partial and paid invoice corrections retain the original invoice and payment ledger. Credit offsets unpaid debt first; only the excess can be allocated or refunded. An allocation must be unallocated before its target invoice is corrected. Credit limits and deposit refunds have reasoned admin overrides. New document numbers use separate type and April–March fiscal-year series as a demo convention. This does not establish statutory tax or credit-note correctness.
- Party and settings edits use entity versions. Forms can reload fresh values and choices after a conflict. The server still stores one organization JSON state in SQLite; action deltas reduce routine response size but do not paginate initial loading or provide entity-oriented persistence.
- The UI now exposes these demo actions, displays customer credit separately from receivables, and provides a dated owner/branch/pickup audit trail. Browser checks by the main agent included paid-credit/refund and stale party-edit recovery on an isolated synthetic database.

## Verification at pause

- Domain regression run: 63 tests passed (`tests/domain-remaining.test.ts`, `tests/domain-audit.test.ts`, `tests/domain.test.ts`). `npm run typecheck` and `git diff --check` passed after the domain changes.
- Final combined verification: **149/149 tests passed**, production build passed (TypeScript + Vite), dependency audit reported **0 vulnerabilities**, and `git diff --check` passed. Focused rendered-form tests include credit allocation/undo, partial/paid credit refund, and stale customer reload.
- Earlier browser evidence is in `docs/screenshots/findings-*.png`; newer credit/refund and recovery captures are in `docs/screenshots/remaining-*.png`. No physical cylinder operation or real financial posting was used.
- Existing user databases were not opened for mutation, reseeded, migrated, or used for these tests. The maintenance review command is read-only by default; it reports legacy identity/batch gaps and file permissions without fabricating historical facts.

## Genuine remaining limits and decisions

- Commercial and legal sign-off is needed for deposit recovery, replacement charges, supplier/customer ownership contracts, tax splits, HSN, place of supply, e-invoicing, credit notes, and document series. The current rules are labeled demo policy. Third-party-owned cross-branch returns remain intentionally disallowed until an owner-approved branch transfer workflow exists.
- Legacy delivery movements without batch snapshots cannot yield a reliable prior gas recipient. Legacy invoices/challans without identity snapshots cannot acquire immutable historical identity by inference. The maintenance report identifies affected records for a separate evidence-led migration. Legacy invalid admin configurations and existing file permissions also need operational review.
- A live deployment still needs HTTPS/proxy configuration with explicit trusted CIDRs and real scanner/camera, printer, and network checks. The same-origin offline device key does not protect against compromised browser code, and there is no cold-start offline application or office conflict-resolution editor. Password recovery is through an authorized administrator, with no email recovery or MFA integration.
- Initial bootstrap and JSON export still read a full scoped state. Persistence is a single SQLite JSON state. A paginated, entity-oriented architecture would be separate work.
- Stock CSV exports are reports, not import templates. The import path rejects unsupported/duplicate columns rather than silently guessing mappings.

The persistent practice demo is running at `http://localhost:3004`, using `data/testing-demo.sqlite`; restart it with `npm run demo:test` if needed. The original `data/client-demo.sqlite` workspace was preserved. Disposable browser QA on port 3005 is stopped. Changes remain uncommitted.

Next step after the user's pause: review the guide and genuine remaining limits, then decide whether a production policy/migration project is authorized. Do not infer or modify historical user records during this handoff.
