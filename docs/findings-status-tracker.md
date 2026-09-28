# Findings.md status tracker

Status reflects the current working tree on 28 September 2026. “Implemented” means the relevant code and focused tests are present; it does not claim a production deployment or migration. The original audit evidence is in `Findings.md`.

| ID | Status | Current behavior and remaining limit |
| --- | --- | --- |
| C1 | Implemented | Quality records explicit emptying; intact sealed vehicle returns can preserve a released batch. See `tests/domain-audit.test.ts`. |
| H1 | Implemented | Authentication now has account and higher IP limits, resets counters on successful sign-in, and uses explicit trusted proxy CIDRs. See `server/app.ts` and API security tests. Deployment must configure the proxy list. |
| H2 | Implemented | Scanner commits exact tags on Enter/camera result and clears input afterward. See `src/ScannerInput.tsx` and form tests. |
| H3 | Implemented | Authentication expiry and CSRF failures leave offline deliveries retryable after sign-in. See `src/offline-rules.ts` and offline tests. |
| H4 | Implemented | Quality rejects individual awaiting-batch members. A one-member batch can be recalled while awaiting release. |
| H5 | Implemented with legacy limit | Recall holds only gas currently tied to that batch and exposes a recipient trace from movement snapshots. Older delivery rows without batch snapshots cannot be attributed safely. |
| H6 | Implemented | Receipt, deposit and refund audit events are scoped through their customer branch. See `server/app.ts` and API tests. |
| H7 | Implemented | Supplier receipt records service and actual contents. Test-only returns create no filled batch; empty expired stock may be sent for testing. |
| M1 | Implemented | The offline integration fixture compiles; typecheck passed in the current working tree. |
| M2 | Implemented for new and seed documents | Invoice and dispatch challan identities are captured at issuance/dispatch. Legacy stored documents without snapshots still use the print fallback and need migration if immutable historical identity is required. |
| M3 | Implemented for demo workflow | Routine actions use delta responses; party and settings edits use entity versions, so unrelated actions do not stale those forms. Full-state SQLite persistence and initial bootstrap remain architecture limits. |
| M4 | Implemented | A 409 offers Reload latest form; the form rebuilds current options and cylinder versions, clears unavailable selections, and requires review before saving. Party/settings edits reload saved values rather than silently overwriting another edit. |
| M5 | Implemented | Creation actions navigate to their destination and clear search/filter state. |
| M6 | Implemented | The receipts ledger displays all receipts in reverse insertion order, newest first. |
| M7 | Implemented | User administration guards against removing the last full-branch active admin. See `server/store.ts` and API tests. |
| M8 | Implemented | Email normalization and validation are enforced before saving users. See `server/store.ts` and API tests. |
| M9 | Implemented | Recall recovery exceptions require the cylinder at the plant before resolution. |
| M10 | Implemented as demo policy | Offsite loss/damage keeps actual custody and opens an exception. An admin may stop rent at an explicit unbilled date; unrecovered lost stock may be written off with an approved date and reason. Third-party-owned writeoff requires owner authorization. |
| M11 | Implemented | Rental billing accepts closed Kolkata days only, excluding today; same-day delivery/return cannot be prematurely billed. |
| M12 | Implemented | Credited gas deliveries reappear in the ready-to-bill UI. |
| M13 | Implemented | Finance enters an approved invoice unit price; a zero-price order cannot issue a zero-value gas invoice. |
| M14 | Implemented | Offline handover occurrence time is preserved and validated within 12 hours and after dispatch; server audit time remains separate. |
| M15 | Implemented | A delivery can be saved to the device while the browser reports online. See the alternate action in `src/App.tsx`. |
| M16 | Implemented | Accepted offline delivery replays survive no-op edits and added branch access. Revoking authorization still blocks privileged replay intentionally. See offline integration tests. |
| M17 | Implemented | Changing gas in the supplier receive form no longer clears already selected cylinders when still eligible. |
| M18 | Implemented | Form error focus is placed in the dialog and keyboard navigation remains in the modal. |
| M19 | Implemented as demo policy | Cross-customer dispatch remains barred; owner authorization is recorded for supplier-owned dispatch, supplier transfer, non-company retirement, and writeoff. Supplier-owned rental has an explicit charge/no-charge setting. Company-owned cross-branch returns and pickup reversals preserve custody history; third-party-owned stock returns to its owner branch. Production commercial policy still needs specialist sign-off. |
| M20 | Implemented and browser verified | At 375 × 667, order actions open from the first-column order number; Cancel, Save evidence on device and Record acceptance fit inside the dialog. See `docs/screenshots/findings-mobile-delivery.png`. |

Low-severity domain fixes and remaining specialist decisions are detailed in `docs/findings-domain-resolution.md`. Final aggregate verification for this working tree passed; see below.

## Verification and limits

- Production build (`npm run build`) passed; dependency audit reported 0 vulnerabilities; `git diff --check` passed.
- Final integrated suite: **149/149 tests passed**. The production build passed, dependency audit reported **0 vulnerabilities**, and diff checks passed.
- Browser checks on a new isolated synthetic database at port 3003: held unknown cylinder → recorded evacuation → serviceable inspection → new fill batch, retained physical operator; deposit visible newest-first and in the audit tab; phone delivery actions at 375 × 667. No real cylinder operation or financial transaction was performed.
- Latest browser checks on isolated port 3005: paid-invoice credit ₹100 → refund ₹40 → available credit ₹60; two-tab stale customer edit rejected with 409 → Reload latest form restores newer fields → reviewed edit saves. Practice workspace at localhost:3004 remains separate and ready for the guide.
- Latest screenshots: `docs/screenshots/remaining-credit-refund.png` and `docs/screenshots/remaining-customer-recovery.png`.
- Earlier screenshots: `docs/screenshots/findings-stock-recovery.png`, `docs/screenshots/findings-payment-audit.png`, `docs/screenshots/findings-mobile-delivery.png`.
- The original `Findings.md` is preserved. Existing user databases were not migrated, reseeded or used for testing. Existing legacy records do not acquire invented historical document or gas-batch snapshots.
- Hardware scanners/cameras, physical printing, real mobile network failures, deployed TLS/proxy configuration and statutory document correctness remain outside these checks.

## Remaining low-severity scope and business decisions

The code now retains the physical filler and purchase notes; rejects duplicate purchase/payment references; normalizes sizes; constrains past order/due dates; scopes discrepancy reporting; fixes driver export controls, supplier receipt counts, return customer switching, inspection eligibility, optional-looking required test fields, old-tag search, dialog navigation, phone actions, financial document balances, invoice GSTIN fallback, and rental defaults. Security-specific and domain-specific details are linked above.

These are not silently enabled:

- Demo rules now cover company-owned cross-branch returns, pickup reversal, explicit incident rental stops and loss writeoff, owner authorization, supplier-owned rent, deposit refund controls, credit limits, partial/paid invoice corrections, customer credit allocation/refund, and fiscal-year document series. These are operational demo policies pending commercial and accounting sign-off.
- Tax splits, HSN, place of supply, e-invoicing, and statutory credit-note/document rules still need specialist decisions; no compliance certification is claimed.
- Exported stock reports are reports, not import templates. Import rejects unsupported/duplicate columns with a clear error.
- Offline storage uses a same-origin device key, not protection against a compromised browser or XSS. The UI describes this limit. There is no cold-start offline application guarantee or office conflict-resolution editor.
- Password recovery is via an authorized administrator, with no email recovery service or MFA integration.
- Persistence remains a single SQLite JSON state; delta responses reduce network size, but do not replace it with an entity-oriented database or paginated initial loading.
- Legacy snapshots, legacy invalid account configurations and existing file permissions require an explicit migration/operational review; this fix did not rewrite existing user data.
