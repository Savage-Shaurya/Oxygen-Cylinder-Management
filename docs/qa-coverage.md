# QA coverage and current limits

This is a regression map for the local demonstration, not proof that every input, device or production condition has been tested. All tests use synthetic data or temporary databases. The presentation database at `data/client-demo.sqlite` is not a test target.

## Domain action coverage

The table maps every action exposed by `server/domain.ts` to an exercised path. Test names identify the evidence in [`tests/domain.test.ts`](../tests/domain.test.ts), except where the API test is named. An action appearing here does not mean every field permutation or business policy has been certified.

| Actions | Exercised behavior |
| --- | --- |
| `cylinder.register`, `cylinders.import`, `cylinder.inspect`, `cylinder.retag` | Registration starts on inspection hold; invalid imports leave the input unchanged; dated test evidence and version checks; retired-cylinder immutability; tag aliases and plant-only retagging. See “registration, inspection, fill…”, “imports reject…”, “retired cylinders…”, “manufacturer scoped serials…”, “physical retag…”, and “test evidence changes…”. |
| `party.create`, `party.update` | API creation survives restart (“operations customer creation…” in [`tests/api.test.ts`](../tests/api.test.ts)); unused classification correction, linked-history rejection, immutable branch, duplicate-name rejection and invoice identity snapshots in domain tests. |
| `order.create`, `order.cancel`, `order.dispatch` | Customer and branch validation; cancellation reason and dispatch rejection after cancellation; exact manifest, released stock, ownership and assigned-driver guards. See “registration, inspection, fill…”, “cancelled order…”, “dispatch rejects another customer’s cylinder”, and “dispatch rejects users without an active driver assignment” in the API tests. |
| `order.deliver`, `order.unload` | Partial delivery, duplicate rejection, proof accumulation, unchanged original manifest and quantity, terminal short closure, and unloading to inspection hold. See “partial delivery…”, “unload preserves…”, and “gas invoice waits…”. |
| `cylinder.collect`, `cylinder.return`, `return.discrepancy`, `exception.resolve` | Current-route driver collection, pickup-to-warehouse separation, wrong-customer rejection, rental closure at warehouse receipt, discrepancy without custody mutation, branch-scoped one-time resolution. See “pickup separates…”, “return discrepancy can…”, and current-route tests in the API suite. |
| `batch.create`, `batch.release`, `batch.recall` | Safe empty fill, independent quality release, unsafe stock rejection, recall hold for customer stock and hold preserved on return. See “registration, inspection, fill…”, “supplier route…”, and “recall quarantines…”. |
| `supplier.send`, `supplier.receive`, `purchase.receive` | Empty-stock supplier transfer, supplier return and purchase intake needing inspection and quality release, batch supplier identity, and correction guard after supplier history. See “supplier route…”, “purchase receipt…”, and “supplier route history…”. |
| `finance.invoice`, `finance.rental`, `finance.receipt`, `finance.deposit`, `finance.refund`, `finance.credit` | Gas invoice only after delivered or short-closed status; rental day boundaries and free days; exact integer tax; duplicate reference, overpayment and excess-refund rejection; deposit/refund balance; preserved invoice identities and full credit note. See “gas invoice waits…”, “rental billing…”, “financial postings…”, “deposit and partial refund…”, “issued invoices…”, and “large paise tax…”. |
| `settings.update` | Company identity edits leave previously issued invoice and credit-note snapshots intact (“issued invoices and credit notes…”). Organization-wide permission is also checked by “branch-limited admin cannot change organization-wide settings” in the API suite. |

## API, interface and recovery checks

[`tests/api.test.ts`](../tests/api.test.ts) exercises session and CSRF protection, role and branch visibility, active driver assignment, idempotent saves and replay after role changes, revision conflict handling, live provisioning, append-only audit, WAL-aware backup/restore, and startup safeguards. It also checks that a customer created through the API is visible immediately and after server restart.

The interface tests in [`tests/forms-app.test.tsx`](../tests/forms-app.test.tsx), [`tests/forms-render.test.tsx`](../tests/forms-render.test.tsx), and [`tests/party-options.test.ts`](../tests/party-options.test.ts) cover customer visibility under an active search, customer/supplier classification choices, branch-dependent fields, retained values after failed saves, and the disabled submit button while saving. Offline tests in [`tests/offline.test.ts`](../tests/offline.test.ts) and [`tests/offline-integration.test.ts`](../tests/offline-integration.test.ts) cover owner scoping, retry identity, conflict handling and independent delivery evidence from one snapshot.

## Defects fixed during this audit

- A newly created party saved with the wrong classification can be corrected if it has no stock or transaction history. A correction keeps its ID and adds an explicit audit summary. Linked records remain protected.
- Supplier receipt and purchase batches now store the supplier ID for later traceability and classification guards. Historic batches without that field remain readable.
- Party edits reject a duplicate name in the same branch; a physical retag requires plant custody; cancellation retains its reason.
- Dispatch refuses a cylinder owned by a different customer. The synthetic partial-order fixture was corrected to satisfy that rule.
- Gas billing waits for a delivered or short-closed order. The remaining manifest must be delivered or unloaded before an invoice is issued.

## Boundaries

These checks do not exercise physical scanner, camera or printer hardware, actual mobile network loss, external accounting/payment/messaging providers, statutory tax submissions, public deployment, sustained load, or real inventory. The [validation record](validation.md) and [production acceptance register](planning/production-acceptance.md) list the needed operational decisions and external verification. In particular, recalled-cylinder remediation and some commercial billing policies remain client decisions. Legacy purchase batches recorded before supplier IDs were stored cannot be attributed reliably from a free-text reference, so the audit does not infer a supplier for them.
