# Domain findings resolution

This note records the server-side decisions made against `Findings.md`. It describes behavior in the working tree, not a production data migration. All action changes are audited through the existing action log; cylinder transitions also write movement snapshots.

| Finding | Resolution |
| --- | --- |
| C1, stranded nonempty stock | `cylinder.empty` records quality-controlled venting or evacuation with a cylinder version and required notes. It is limited to plant custody and leaves the inspection condition intact. An awaiting batch member must be rejected first. `order.unload` also accepts an explicit `sealIntact` assertion; a released, full, serviceable, test-valid cylinder then keeps its gas and batch. The default unload path remains unknown contents and inspection. |
| H4, unsafe member blocks batch | Quality can `batch.reject` one member of an awaiting batch with a reason. That member becomes quarantined with unknown contents and its batch assignment is cleared; the remaining members may be released. For the final member, recall the awaiting batch. |
| H5, incorrect recall scope | Recall quarantines only cylinders whose **current** `batchId` is the recalled batch. It stores `recipientTrace` for delivery movements whose captured `before.batchId` matches, including customers who have since returned the cylinder. Historical movement rows without a batch snapshot are not guessed into the trace. Seeded delivery movements now include the snapshot. |
| H7, supplier test returns marked full | `supplier.receive` requires `service` and actual `contents`. A fill must return full and creates a batch awaiting release. A test-only return can be empty, partial, or unknown and creates no fill batch. `supplier.send` accepts a `test` purpose for empty plant stock in serviceable, inspection-due, or testing condition, including expired test dates; quarantined and retired stock is refused. Fill transfers retain the prior serviceable/test-valid check. |
| M9, recovery exception closed early | Recall recovery and offsite loss/damage exceptions cannot be resolved while their cylinder remains away from the plant. |
| M10, offsite loss/damage | `cylinder.offsiteIncident` records a versioned, noted loss or damage in customer or collection-vehicle custody. It quarantines the cylinder and opens a scoped exception. Rental continues until plant return or an administrator supplies an approved, unbilled stop date. An unrecovered lost cylinder can be written off under the dated approval and owner-consent rules below. |
| M11, same-day rental ambiguity | Rental invoices now accept only periods ending before the current Kolkata business day. This prevents a current-day invoice from billing a cylinder before its return or blocking a later delivery that day. |
| M13, price control | Finance can supply `unitPricePaise` when issuing a gas invoice. A zero-price order requires a positive finance-entered price before invoice issue. The posted invoice line preserves that approved price without rewriting the order. |
| M14, offline time | Delivery accepts optional `occurredAt` with an offset. It must be no more than 12 hours old, no later than server time, and no earlier than each selected cylinder's dispatch. The occurrence time drives proof, movement, delivery time and rental start; the audit event remains at server acceptance time. |
| M2, mutable document identity | Dispatch freezes issuer and recipient details in `order.challanSnapshot`. Seeded dispatched orders and invoices now have identity snapshots. |
| Low lifecycle | Named fill operator is retained separately from the logged-in actor. Purchase receipt notes are retained and supplier purchase references cannot be duplicated. Driver return discrepancies require current assigned work in that branch. New order requested dates cannot be in the past, and cylinder/order sizes are normalized to uppercase at creation. Seed owner branches align with their cylinders, and released industrial oxygen stock exists in both branches. |
| Low finance | Gas and rental invoice due dates cannot precede issue day. Payment references are unique across customers for each method, including cash. Customer deposits cannot be posted to suppliers. |
| Low security in domain | Foreign and missing branch-scoped records return the same 404. Action type lookup accepts only own keys of the permission registry. |

## Action payloads

- `cylinder.empty`: `{ cylinderId, version, method: 'vent' | 'evacuate', notes }` (admin/quality).
- `order.unload`: existing fields plus optional `sealIntact: boolean`, default `false`.
- `batch.reject`: `{ batchId, cylinderId, reason }` (admin/quality).
- `supplier.send`: existing fields plus optional `service: 'fill' | 'test'`, default `fill`.
- `supplier.receive`: existing fields plus required `service: 'fill' | 'test'` and `contents: 'empty' | 'full' | 'partial' | 'unknown'`.
- `cylinder.offsiteIncident`: `{ cylinderId, version, kind: 'lost' | 'damaged', notes }` (admin/operations).
- `finance.invoice`: existing fields plus optional `unitPricePaise`.
- `order.deliver`: existing fields plus optional ISO `occurredAt`.

## Limits requiring external decisions or historical evidence

- GST treatment, HSN, place of supply, e-invoicing, statutory credit notes, and replacement/deposit charges for a lost cylinder require specialist decisions. The accounting and numbering behavior below is a demo policy, not a compliance claim.
- Quarantined cylinders remain ineligible for supplier testing transfer. Allowing that would need a separate transport authorization and safety procedure.
- Legacy delivery movements without `before.batchId` cannot establish which gas batch a past customer received. They are omitted from `recipientTrace` until independently verified. Legacy document identity snapshots are also not inferred.

## Additional conservative demo workflows (28 September 2026)

- An administrator can stop an incident rental with `rental.stopIncident` only at a supplied date no later than today, no earlier than rental start and outside already invoiced rental periods. The cylinder remains with its actual customer or pickup vehicle. An administrator can instead write off unrecovered **lost** stock with `cylinder.writeoff`: the same dated rent check applies, the stock becomes retired, actual custody is retained, and the loss exception closes with a reason. A third-party owner requires an authorization reference. A prior incident rental stop may be followed by writeoff at that same date. Neither action chooses the incident report date automatically.
- A company-owned return may name `receivingBranchId`; the actor needs access to both the source and receiving branches. The cylinder's inventory branch and plant custodian become the receiving branch, while the customer, pickup and rental history retain their source branch. Third-party-owned stock must return to its owning branch so it is not stranded under a foreign owner record. A `collection.reverse` action restores customer custody and keeps rent open only while selected stock is still on its pickup vehicle. The pickup retains `reversedIds` as evidence.
- Supplier transfer and supplier-owned customer dispatch require a recorded owner authorization reference. Plant retirement requires the same for every non-company owner. Supplier-owned rental follows the explicit `supplierOwnedRental` setting (`charge` by default for legacy states, or `no_charge`); customer-owned stock remains zero-rate.
- Gross credit corrections can be partial and can follow payment. A credit offsets the source invoice's unpaid amount first; only excess becomes customer credit. The original invoice and payments remain in the ledger. Customer credit can be allocated to another invoice or refunded, each with a linked receipt and reason. An allocation must be unallocated before correcting its target invoice, avoiding duplicate value. Credit notes retain proportional net and tax amounts; all partial notes sum exactly to the original when fully corrected. These are demo accounting rules, not a GST or statutory credit-note determination.
- Deposit refunds are blocked while cylinders remain out or invoices remain unpaid unless an administrator records an override reason. Positive credit limits are checked when issuing gas or rental invoices; an administrator may override with a reason stored on the invoice. Document numbers use separate type and April–March fiscal-year series for newly created records; this is a demo numbering policy, not a legal assertion. Existing document numbers are preserved.
- Party and settings edits may carry `expectedVersion`; a stale version is rejected for that entity only. Legacy records start at version 1 without a rewrite. Every successful edit increments its version.

## Verification

`npx tsx --test tests/domain-remaining.test.ts tests/domain-audit.test.ts tests/domain.test.ts` passed 63 domain tests. `npm run typecheck` and `git diff --check` passed. Tests used synthetic in-memory state and did not mutate user data or running servers.
