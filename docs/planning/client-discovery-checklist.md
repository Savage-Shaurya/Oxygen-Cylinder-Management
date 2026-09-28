# Client discovery and demonstration checklist

Status: interview guide, 28 September 2026. Ask in small groups; this is a completeness checklist, not a demand to answer everything at once.

## First answer

Does the business fill/manufacture oxygen, distribute purchased filled cylinders, supply medical oxygen, or combine these activities? Who are its customers: factories, hospitals, dealers, home-care patients, or several groups?

## Priority 1 — Establish the actual operating loop

1. Company name, operating states, branches/plants/godowns, and legal/GST entities.
2. Company-owned versus customer/vendor-owned fleet, approximate counts, gas types/sizes and accessories.
3. Daily deliveries/returns and peak hourly scanning; number of office staff/drivers; languages and device models.
4. Who fills cylinders, who performs tests/repairs, and who approves quality/eligibility?
5. Show one real order through dispatch, delivery, empty pickup, refill, invoice and payment.
6. Which existing records are trusted when stock or customer balances disagree?
7. Current software, spreadsheets, paper documents, printers and accounting version.
8. Where does connectivity fail? How long may staff work disconnected?
9. Top three recurring losses, delays or disputes; approximate monthly impact.
10. Single-client internal product or reusable SaaS intended for unrelated companies?

## Priority 2 — Commercial rules that must be calculated exactly

- Gas sold by cylinder, pressure, mass, volume or another contractual unit? Who approves conversion rules?
- Rate contracts by customer, site, cylinder type and effective period; taxes and delivery charges.
- Rental starts at dispatch or acceptance? Ends at pickup, receipt or inspection? Which day is inclusive?
- Free days, calendar versus rolling periods, slabs, minimum charges, holidays, monthly cutoff, rounding.
- Is rental tracked per cylinder or a fungible agreed balance? How are substitutions and partial returns handled?
- Deposits by cylinder or customer, refunds, deductions, damage/loss charge approval.
- Credit limits, overdue holds and urgent supply exception authority.
- Invoice issuance ownership, document numbering and allowed corrections; tax applicability confirmed by accountant.
- Partial payments, advances, unallocated receipts, UPI references, cash handover, cheques and reconciliation.
- Which masters/vouchers synchronize with accounting, in which direction, and how conflicts are settled?

## Priority 3 — Safety, access and continuity

- Applicable licences and approved SOPs for the actual operations and locations; expiry and renewal owners.
- Cylinder eligibility evidence, inspection/test schedule basis, quality release and recall records.
- Who can place/release a hold, approve a refund, change a rate, edit opening balances or export data?
- Staff turnover, shared devices, temporary workers and account revocation process.
- Personal information actually needed; whether patient linkage is needed at all.
- Hosting and retention constraints, backup ownership and maximum tolerable data loss/outage.
- Manual contingency during outage and reconciliation after recovery.
- Named operational, accounting, quality and acceptance decision makers.

## Sanitized sample pack

Provide representative examples with unnecessary personal/payment details removed:

1. Cylinder register including owner, gas/size, identifier and test-date fields.
2. Delivery challan, empty return receipt and each document locally called DC/ECR/FRC/ETM.
3. Customer holding statement and one disputed balance example.
4. Gas invoice, rental invoice, credit/debit note and receipt.
5. Rental agreement with one worked example crossing a month boundary.
6. Deposit receipt/refund and loss/damage settlement.
7. Supplier filling challan/receipt and partial return example.
8. Test certificate and inspection/repair form; batch release/recall records if applicable.
9. Trip sheet, driver collection sheet and end-of-day reconciliation.
10. Sanitized export from the current software or spreadsheet with field explanations.

Samples establish real business rules. We do not need production passwords, OTPs, complete bank statements or patient histories for discovery.

## Reference-product demo script

Use an authorized demonstration account with synthetic data. Record observation, screenshot/reference, outcome and unanswered question for each item.

| Test | What to observe |
|---|---|
| Sign in as each role | Default screen, visible actions and actual access restrictions |
| Add and import assets | Required fields, duplicates, ownership, serial identity, validation |
| Replace tag | History preservation and old-tag behavior |
| Full dispatch and return | Fields, scans, documents, custody and stock updates |
| Partial/rejected delivery | Vehicle balance, customer acceptance, invoice treatment |
| Wrong/foreign return | Owner/custodian distinction and resolution |
| Overdue test/quarantine | Hard blocks, release authority, audit evidence |
| Offline operations | Saved-versus-posted labels, persistence, conflict and duplicate handling |
| Rental example | Input events, effective rates, free days, rounding and correction |
| Deposit and payment | Separate balances, allocations, refunds and collection reconciliation |
| Tally disconnected | Retry behavior, idempotency and conflict ownership |
| WhatsApp delivery failure | Queue, recipient control, evidence and re-send behavior |
| Change permissions | Existing sessions, direct record access and export restrictions |
| Correct finalized transaction | Original preserved, reversal and dependent events |
| Export and restore | Complete machine-readable data, attachments, documented recovery |
| Mobile on client hardware | Scanning speed, legibility, low-network behavior and printer support |

Ask for commercial terms separately: licence basis, hardware ownership, onboarding, migration, support, API access, data export, termination assistance, retention/deletion and third-party message costs. Do not infer these from a free app download.

## Decisions required before implementation

Operating model; initial branch/route; launch scope; accounting authority; medically relevant records and responsibilities; staff languages/devices; offline permitted actions; migration cutover approach; integration versions/provider; hosting/support budget; acceptance owners and launch gates.

Anything undecided must have an explicit assumption, owner, impact and review date in the eventual specification. It must not become an invisible implementation default.
