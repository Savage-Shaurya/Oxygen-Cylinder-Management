# Validation record — 28 September 2026

This is a tested local demonstration, not a production certification or exhaustive proof of all possible edge cases.

## Automated checks

- `npm test`: **45 passed, 0 failed** on Node 22.14.0.
- `npm run build`: TypeScript strict checking and Vite production build passed.
- `npm audit --audit-level=low`: **0 known vulnerabilities** at the time of the check. This is a dependency advisory check, not a penetration test.
- Fresh demonstration creation succeeded with 84 synthetic cylinders and two branches, without replacing the earlier QA files.

Coverage includes physical custody transitions; inspection, retirement and recall holds; independent quality release; supplier and purchase intake; partial delivery and terminal short closure; ownership/rental rules; exact money/tax rounding; immutable invoice identities; duplicate payment references, overpayment and excess refund rejection; branch/role authorization; CSRF, session revocation and login limits; live provisioning and real live-mode mutation; append-only audit; idempotency after permission changes; WAL-aware backup/restore; current-route return collection; offline evidence scoping and expiry. Parallel HTTP writes tested one revision winner and a single commit for simultaneous retries.

## Independent review corrections

Specification and API/security agents reviewed implementation independently of the initial implementers. Findings corrected include a hardcoded demo organization blocking live writes, historical-route collection authorization, cross-branch user/audit exposure, restore dropping committed WAL pages, stale-privilege idempotency replay, unsafe global settings permission, overwritten delivery evidence, lost manifest quantity on unload, tag reuse, test evidence coherence, exact tax arithmetic, mutable invoice identity and contradictory seed batch branches.

## Browser checks

Using the running interface and synthetic data:

- Signed in as Operations, Quality, Finance and Administrator.
- Created a two-cylinder hospital order, dispatched two exact tags, recorded one accepted cylinder and unloaded the other. Verified manifest, quantities, recipient evidence and stock-position changes. Short-closure status was subsequently added and covered by domain tests.
- Recorded the accepted cylinder's warehouse return; persisted data confirms plant custody, empty contents, inspection hold and closed rental interval.
- Independently released a seeded batch as Quality and verified certificate reference, release timestamp and saved status.
- Allocated a synthetic ₹3,248 payment to a saved invoice; verified paid status, zero invoice balance, receipt reference and reduced outstanding total.
- Verified guide navigation opens the real Orders screen.
- Inspected desktop and 390 × 844 phone layouts, including the guided walkthrough. Restored default desktop viewport.
- Corrected nested action dialog layering, misleading restricted-role zero financial values, credit-note receivable totals, guide spacing, and server-outage login presentation.

Screenshots: [overview](screenshots/overview.png) and [walkthrough](screenshots/walkthrough.png).

## Presentation workspace

The running preview uses `data/client-demo.sqlite`, a fresh dataset at revision 1. Browser QA records are preserved separately in `data/ctms.sqlite` and `data/presentation.sqlite`; database files are ignored by Git. The preview is local at http://127.0.0.1:5173. Use `CTMS_DB_PATH=data/client-demo.sqlite npm run dev` to resume it after stopping.

## Not validated by this pass

Physical scanner/camera/printer hardware; actual offline network interruption and IndexedDB recovery on client phones; real cylinder/patient records; statutory document formats; accounting/payment/messaging/GPS/RFID provider integrations; Docker runtime; public TLS deployment; external security assessment; high-volume/load/soak tests; offsite encrypted backup operations and disaster recovery targets. The [production acceptance register](planning/production-acceptance.md) records client decisions and remaining scope, including recalled-cylinder remediation and commercial policy variants.
