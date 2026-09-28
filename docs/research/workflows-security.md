# Cylinder operations: proposed workflows, exceptions, and security requirements

Status: research and requirements proposal, 28 September 2026. This is planning input, not an approved product specification or a statement of Indian legal obligations.

## Evidence and confidence

| Observation | Evidence | Confidence / limit |
| --- | --- | --- |
| CTMS presents itself as a cylinder tracking ERP with QR and UHF RFID tracking, rental billing, deliveries, and Tally integration. Its page metadata also mentions a driver mobile app and WhatsApp integration. | [CTMS public site](https://ctmsgas.com/) HTML title, description, and social metadata, accessed 28 September 2026. | High confidence in what CTMS advertises; no evidence that every advertised feature works in a particular way or meets a compliance standard. The site is a competitor reference, not the requirements authority for this business. |
| CTMS's public Android listing describes stock and rental reports, WhatsApp sharing and alerts, and Tally sync for invoices and product masters. | [CTMS Google Play listing](https://play.google.com/store/apps/details?id=com.spwebconnect.ctms). | Medium: vendor-authored listing, and its features may change. |
| TallyPrime supports XML exchange over HTTP and file import/export; JSON support depends on the TallyPrime release. | [Tally XML integration](https://help.tallysolutions.com/xml-integration/), [Tally JSON integration](https://help.tallysolutions.com/tally-prime-integration-using-json-1/), [import formats](https://help.tallysolutions.com/import-data-from-xml-or-json/). | High for documented capability; unknown whether this business uses Tally, which version, or which vouchers and ledgers are configured. |
| OWASP ASVS 5.0 is a current source for verifiable web application security requirements, including business logic, authorization, logging, and service configuration. | [OWASP ASVS project](https://owasp.org/projects/asvs), [ASVS 5.0 catalogue](https://cornucopia.owasp.org/taxonomy/asvs-5.0). | High for security guidance; it does not define this business's roles, approvals, retention periods, or legal compliance. |

**Assumption:** The intended system supports an Indian distributor or operator handling oxygen cylinders, possibly other gases and both owned and third-party cylinders. Medical, industrial, and rental flows may differ. Validate that distinction before implementation. No assumed statute, certification interval, tax rate, invoice format, or WhatsApp API is embedded here.

## Core operating model

Track each serialized cylinder as a physical asset, separate from the gas inventory and financial records. Its identity includes an immutable internal ID and one or more identifiers (stamped serial, QR label, RFID tag). Identifiers can be replaced or retired, but history and aliases stay linked to the same asset. Duplicate or uncertain identifiers enter a review queue, never an automatic merge.

The cylinder record has independent dimensions:

- **Owner:** legal or contractual owner, including our company, a customer, or another supplier. Ownership changes only through an explicit ownership transaction with evidence and approval.
- **Custodian:** party physically responsible now: branch, driver, customer, filling partner, or another party. A pending handover is distinct from accepted custody.
- **Location:** last verified site, vehicle, partner, or customer site, with observed time and source. A planned destination is never silently presented as verified location.
- **Condition:** serviceable, inspection due/hold, damaged/quarantined, lost/unverified, retired, with condition observations and evidence. Do not infer safety from a billing or fill status.
- **Gas content:** empty, residual/unknown, filled with gas grade/product, or in fill/quality review. Full/empty is an inventory state, not an asset type; contents may change with controlled fill events.
- **Commercial state:** sale, customer-owned handling, returnable loan/rental, deposit exposure, or other contract terms. This is separate from physical custody.

Each change is an append-only business event with actor, role, device, server receipt time, claimed event time, source document, prior state, resulting state, and reason where relevant. Current views are projections of those events. Financial balances come from a ledger of charges, credits, deposits, receipts, and allocations, not an editable running total. Use quantities by product and cylinder size only for untagged legacy stock; clearly label those as aggregate and exclude them from claims of item-level traceability.

## Proposed lifecycle and operator experience

| Stage | Normal path | Operator screen and required evidence | Exception path |
| --- | --- | --- | --- |
| Intake and registration | Receive owned/third-party cylinder; scan or enter serial; verify owner, gas family, size, condition, and starting custody/location. | One scan-first screen, recent customer and product defaults, photo/condition prompt only where required. Show any prior match before creating a record. | Unknown owner, unreadable serial, duplicate tag, disputed count, or damaged item goes to intake hold with provisional identity. No outbound allocation until resolved. |
| Customer order | Capture requested gas/product, quantity, delivery site/date, commercial terms, and account. Reserve eligible cylinders. | Simple order summary with availability and credit/hold warnings before dispatch. | Partial supply, substitution, blocked account, or price override is explicit, visible to customer-facing staff, and approval-gated where policy requires. |
| Fill/production | Move empty cylinders to fill queue; record filling at own plant or partner; record batch/job, gas/product, operator/partner, and quality release. | Batch scan, discrepancy counter, clear `awaiting release` status. | Underfill, wrong gas, failed check, cylinder not eligible, or batch count mismatch enters quarantine/rework; no dispatch as filled. Define actual quality checks with the business. |
| Outsourced filling | Issue transfer to filling partner; partner receipt or internal acknowledgment records custody; receive filled/empty/rejected items against original transfer. | Partner manifest with scan-by-scan issue/receipt and variance resolution. | Missing, substituted, returned damaged, wrong product, or unmatched cylinder stays as a variance linked to the partner transfer. Never mark it as in-house stock by editing the original issue. |
| Dispatch | Select order, scan each eligible cylinder, verify loaded vehicle/driver and customer destination, issue numbered delivery document. | Large scan targets, green/amber/red feedback, count and product reconciliation, draft review before commit. | Wrong customer, duplicate scan, conflicting location, inspection hold, or unapproved substitution blocks commit and offers a clearly named resolution action. |
| Delivery and handover | Driver records actual handover, item scans/count, recipient evidence, time/location, and accepted/refused items. Custody changes on accepted handover. | Driver sees only today's assigned stops, minimal fields, readable document, and offline pending badge. | Partial delivery, refusal, absent recipient, damaged in transit, or lost cylinder creates a linked exception; undelivered items remain with driver/vehicle until returned or reallocated. |
| Return and exchange | Scan incoming empties/filled returns, inspect condition, match customer and original deployment where possible; record custody at receipt. | Show expected outstanding items, allow unexpected returns with reason, show provisional financial impact before posting. | Wrong owner, unknown cylinder, mismatch in returned count, damage, or gas residue uses quarantine/dispute queue. Do not auto-credit deposit or stop rental until policy-defined acceptance point. |
| Rental/deposit cycle | Accrue rental from contract start/stop events, produce period charges, hold deposits as liabilities/exposure, apply approved adjustments. | Account timeline explains each charge and credit by cylinder/period and source event. | Disputed days, waived fees, missing cylinder, or damaged unit uses reversible adjustment with reason and approval. Avoid re-dating handovers to make billing fit. |
| Invoice and collection | Review charges, issue invoice, record receipts and allocation to invoices/deposits, reconcile bank/cash records. | Separate `draft`, `issued`, `sent`, `paid/part-paid`, and `reconciled` labels. | Failed send does not cancel invoice; bounced or reversed payment creates reversal. Unallocated receipts remain visible. Refund requires its own authorization and ledger posting. |
| Closure and retirement | Immediately block an unsafe or condemned cylinder from operational use; reconcile outstanding custody, rental and deposit implications separately before closing its commercial account. | A closure checklist distinguishes the immediate safety restriction from unresolved financial balances. | Lost/write-off, ownership transfer, and scrap require separate approval and immutable reason/history. Financial disputes must never delay a safety hold or permit dispatch. |

### Cross-cutting exception rules

Every operational exception needs a named owner, severity, due date or SLA, visible status (`open`, `awaiting evidence`, `approved resolution`, `closed`), linked documents, and a resolution event. A supervisor can resolve exceptions by approved compensating events; ordinary staff cannot erase history. Show the next allowed action and why a blocked action is blocked. Provide a daily queue for unmatched cylinders, overdue customer returns, partner variances, unposted financial exports, and failed notifications.

## High-risk invariants

1. A serialized cylinder has one active physical custodian at a time. `In transit` is custody of an identified driver/vehicle or carrier, not an owner change. A transfer requires an issue and an acceptance or a documented exception.
2. A cylinder cannot be in two committed dispatches or fill jobs simultaneously. Reservations expire or release explicitly. Server-side transactions and locking enforce this even if two operators act at once.
3. A cylinder on condition hold, unreleased fill, or prohibited gas/product mismatch cannot be offered as dispatchable. Overrides, if the business permits any, require defined authority and a separately recorded decision; safety holds should default to no override.
4. No quantity is silently created or lost: each serialized movement balances source and destination, and batch quantities reconcile scanned accepted, rejected, missing, and unexpected items.
5. Ownership, custody, location, condition, gas content, and commercial state change through their respective events. Updating one does not imply another. A GPS observation or document send is not proof of handover.
6. A posted invoice, receipt, deposit movement, or export cannot be deleted or silently edited. Corrections use a linked reversal/credit/debit transaction; document numbering and tax treatment are to be confirmed with the accountant.
7. Retried, delayed, or duplicated scans and integrations cannot produce duplicate transfers, charges, invoices, receipts, or outbound messages. Each business operation has a stable idempotency key.
8. A customer or branch user cannot view or mutate another tenant/branch's records merely by changing a URL, request ID, QR value, or import file. Authorization is checked on every server operation and export.
9. An offline action is `pending` until the server accepts it. The UI must distinguish observed local events from committed shared state, preserve the original claim, and present conflicts for resolution.
10. Every privileged change has a traceable human or service identity. No shared admin login; background integration accounts have scoped rights and auditable runs.

## Offline and conflict handling

Drivers and scanning teams may need offline capture. The offline client should cache only assigned work and the minimum data needed, encrypt local storage using platform facilities, require device unlock, and expire/revoke access. The queue stores immutable local event IDs, client time, device ID, expected record version, and evidence; server receipt time is separate. Sync retries are idempotent and display `pending`, `accepted`, or `needs review`. Never claim a delivered or received event is globally final before acknowledgement.

Conflicts must be resolved by business meaning, not last-write-wins. Examples: if a branch dispatches a cylinder after a driver's offline return, place both events in review and block further allocation; if two drivers claim delivery of the same cylinder, preserve both evidence sets and require supervisor determination; if a price changed while a draft order was offline, request renewed review before invoice. Permit nonconflicting observations (photo, note) to merge while withholding state transition. Notify the initiating user of rejection and retain a local export path for evidence if sync cannot complete.

## Roles and separation of duties (proposed)

`A` approve/post, `W` create/update within assigned scope, `R` read, `—` denied. All access is further limited by company, branch, customer/partner assignment, and record state. The business must validate staffing and delegated approvals; a small team may need named dual control for only the highest-risk actions.

| Capability | Owner/admin | Operations supervisor | Store/fill operator | Driver | Sales/service | Finance | Auditor |
| --- | --- | --- | --- | --- | --- | --- | --- |
| User/role policy and integration credentials | A | — | — | — | — | — | R (policy, no secrets) |
| Cylinder master and identifier merge/retire | A | A | W (intake only) | — | R | R | R |
| Intake, condition observation, quarantine | R | A | W | W (on route) | R | — | R |
| Fill job and release | R | A | W (record work) | — | R | — | R |
| Order and price/credit override | A | A (policy-limited) | R | R (assigned) | W (order), request override | R | R |
| Dispatch and partner transfer | R | A | W | R (assigned) | R | — | R |
| Delivery/return evidence | R | A (exception) | W (receipt) | W (assigned stop) | R | R | R |
| Rental/deposit rule changes and write-offs | A | request | — | — | request | A (posting) | R |
| Invoice, credit, receipt, refund, reconciliation | R | R | — | — | R (assigned accounts) | W; A for posting/refund per limits | R |
| Import, export, audit trail, backup restore | A (authorize) | R (operations export) | — | — | — | A (finance export) | R (audit export); restore denied |

System owner and finance approver should not be the sole actor on their own high-value write-off/refund; define threshold and second approver. Permission changes, exports of customer lists, and emergency access merit alerting. Driver access ends when assignment or employment ends; device sessions can be revoked.

## Security and resilience requirements

- Use centrally enforced, deny-by-default authorization at tenant, branch, record, field, and operation levels. Treat hidden UI controls as usability only; verify server access, including scanned IDs and bulk APIs. This follows [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) and [ASVS authorization catalogue](https://cornucopia.owasp.org/taxonomy/asvs-5.0/08-authorization).
- Require individual accounts, strong authentication, and MFA for admins and finance approvers. Use session expiry and revocation, secure reset/invitation, and device management for mobile users. Choose exact authentication methods after deployment constraints are known. Reference [OWASP authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) and [ASVS session management](https://cornucopia.owasp.org/taxonomy/asvs-5.0/07-session-management).
- Validate all transition preconditions in a trusted service, including combined facts such as cylinder state, customer, order, and branch. Use transactional commits and concurrency control for movements and financial postings. See [ASVS input validation](https://cornucopia.owasp.org/taxonomy/asvs-5.0/02-validation-and-business-logic/02-input-validation) and [ASVS Level 2 business-logic controls](https://cornucopia.owasp.org/taxonomy/asvs-5.0/level-2-controls).
- Encrypt transport and sensitive data at rest; hold integration secrets outside source and client apps; use dedicated service identities with least privilege. Set retention and deletion periods only after contractual and legal review. See [ASVS backend communication](https://cornucopia.owasp.org/taxonomy/asvs-5.0/13-configuration/02-backend-communication-configuration) and [secrets management](https://cornucopia.owasp.org/taxonomy/asvs-5.0/13-configuration/03-secret-management).
- Keep two related logs: a durable business event trail (every state/financial transition with before/after or event payload) and a protected security log (login, failed authorization, role change, export, integration credential use, backup/restore). Do not log passwords, tokens, full payment data, or unnecessary personal data. Synchronize timestamps, record original offline time and server receipt separately, and monitor missing/tampered logs. See [ASVS security events](https://cornucopia.owasp.org/taxonomy/asvs-5.0/16-security-logging-and-error-handling/03-security-events) and [OWASP logging guidance](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).
- Run automated encrypted backups with access separated from day-to-day admins; retain a tested restore path, defined recovery time/data-loss targets, and periodic restore drills. Include event logs, attachments, integration mappings, and keys needed to decrypt them. A backup success message alone is not proof of recoverability. See [OWASP secrets backup/restore guidance](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) for the general control principle.
- Rate-limit authentication and expensive bulk operations; scan/validate uploaded files; sanitize exported spreadsheet cells to prevent formula execution; restrict attachment visibility; protect webhook endpoints and replay prevention. Security tests should include cross-tenant and cross-branch ID manipulation, concurrent scans, offline replay, duplicate integrations, and role escalation.

## External systems and imports

**Tally (conditional):** First identify installed product/release, company setup, vouchers, ledgers, taxes, inventory masters, and source of truth. Tally's documented XML capability and release-dependent JSON are integration options, not a promise of plug-and-play sync. Use an outbox of approved financial events, immutable external reference IDs, mapping validation, a dry-run preview, batch acknowledgment, retry without duplicate posting, and daily reconciliation of count and value. Store external voucher ID and error details; never mark an invoice `posted to Tally` merely because a request was sent. Protect the Tally endpoint/network and dedicated credentials. Reversals must map to appropriate accounting documents after accountant review.

**WhatsApp (conditional):** Decide whether sharing is manual via the user's WhatsApp app or automated via an approved business integration. Record recipient, consent/communication preference where applicable, message/template version, document link expiry, send attempt and delivery result. Do not equate a delivery receipt with customer acceptance of goods or invoice. Confirm current Meta provider terms, templates, webhook design, and data-handling requirements before implementation; this research does not assert a specific API behavior.

**Legacy data:** Import customers, products, opening balances, and cylinders through staged upload with schema validation, duplicate candidates, ownership ambiguity review, dry-run totals, and signed approval of opening snapshot. Preserve source file and row-level provenance. A rollback applies only before go-live posting; afterward corrections use balancing transactions. Aggregate legacy counts must remain distinguishable from verified serialized cylinders.

## Acceptance scenarios for an eventual specification

1. A clerk scans a full oxygen cylinder that is already on an active truck. The dispatch cannot commit; the screen shows current custodian and a link to the conflicting transfer. No second stock deduction occurs.
2. A partner manifest issues ten empties; eight filled and one rejected return. The ninth accepted/rejected total leaves one outstanding variance against that partner, and available filled stock increases only by eight.
3. A driver records delivery offline and later another user scans the same cylinder into branch stock. Sync preserves both claims, blocks reuse, and asks a supervisor to resolve; no last-write-wins overwrite occurs.
4. A customer returns a cylinder with a different owner and damaged valve. Intake is recorded under hold, customer outstanding and deposit treatment remain visible, and release requires an approved resolution.
5. A rental billing job runs twice for the same account and period. It produces one charge set; an approved retrospective correction creates a linked credit/debit rather than altering the original issued invoice.
6. A receipt is captured but the bank reconciliation later rejects it. The original receipt remains in history, a reversal reopens the balance, and the customer timeline explains both.
7. A driver modifies a request ID to retrieve another driver's deliveries; the service denies it and logs the denied access. A finance user cannot edit cylinder condition by direct API call.
8. A Tally export times out after Tally accepted a voucher. Retry checks the stable external reference and reconciles to one voucher instead of creating a duplicate.
9. A backup is restored in an isolated environment; asset custody, financial ledger, attachments, and audit events reconcile to the recovery checkpoint, and the elapsed recovery time is recorded.
10. A manager replaces a damaged QR label. The old QR no longer authorizes new scans, but historical events still resolve to the same cylinder ID.

## Decisions and evidence still needed

1. Which business entity and sites are in scope? Are cylinders owned, leased, customer-owned, supplier-owned, or all four? Are industrial and medical oxygen governed by different internal procedures?
2. Are cylinders individually serialized today? Which identifiers exist, what is the duplicate rate, and what proportion of legacy stock is only counted by size/product?
3. What exactly marks custody transfer for branch-to-driver, driver-to-customer, partner issue/return, and customer return: scan, signature, document, or supervisor confirmation?
4. What are the actual fill, inspection, and quality-release steps and stop-ship conditions? Which records/certificates must be retained? Seek qualified operations/legal review for regulated requirements.
5. Which rental, deposit, credit, damage, loss, and tax policies are contractual? What are start/stop times, grace periods, rates, and approval thresholds?
6. What does finance use now (Tally release/configuration, spreadsheets, bank feeds)? Which system owns invoice numbering and customer balance? Is WhatsApp sharing manual or automated?
7. What are daily volumes, offline duration, supported devices, network conditions, languages, and barcode/RFID hardware? Who resolves sync conflicts and by when?
8. What is the branch/tenant boundary, and can one employee work across branches? Who grants access, reviews it, and revokes a lost device?
9. What are retention, recovery, hosting/data residency, and contractual security requirements? Obtain professional advice before translating these into legal claims.

## Suggested prioritization

First establish identity, custody, condition/hold, scan-based dispatch/return, event history, roles, and discrepancy queues. Then add fill/partner workflows and rental/deposit ledger using the same event model. Add invoicing and external sync only after source-of-truth and reconciliation rules are signed off. Offline operation should be included in the first release only if field connectivity makes it essential; if so, conflict review is part of that release, not a later enhancement.
