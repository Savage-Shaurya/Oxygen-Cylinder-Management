# Production acceptance register

This register distinguishes functioning software from company-specific verification. Local examples are synthetic. A successful software test does not certify a physical cylinder, oxygen quality, licences or tax treatment.

| Gate | Evidence required | Responsible party |
|---|---|---|
| Opening inventory | Physical serial count, owners, test records and customer/supplier balances reconciled against import | Client operations |
| Cylinder rules | Approved inspection/retest/condemnation procedures and competent authorizations; validated physical label fitment | Client quality/safety |
| Medical production | Licensed product/grade and approved batch/release records, certificates, recall SOP and authorized quality users | Client quality |
| Pricing and tax | Written rental free-day/cutoff rules, taxes, invoice format/numbering, deposits and refund approvals | Client accountant |
| Accounting interface | Selected installed product/version, mappings, credentials, provider sandbox, duplicate/reversal reconciliation | Integration owner |
| Statutory documents | Applicable IRN/e-way obligations, authorized provider and end-to-end official response evidence | Accountant/integration owner |
| Messaging/payments | Provider contract/consent/templates, verified callbacks and settlement reconciliation | Client/integration owner |
| Devices | Actual driver phone, camera/barcode reader, printer, durable labels and offline-conflict drill | Operations |
| Access | Named users, branch scope, separation of duties, stronger production authentication/MFA decision, access review | Client administrator |
| Privacy | Minimum necessary data, retention, notices and processor/hosting terms; no clinical patient records by default | Client/privacy owner |
| Availability | TLS hosting, volume/backup protection, offsite retention, monitored jobs, defined recovery targets, restore rehearsal | Hosting owner |
| Security | Independent review including authorization, exported data, attachment handling, session controls and infrastructure | Security reviewer |
| Rollout | One branch/route trial with daily stock and money reconciliation, training, escalation contact and rollback procedure | Client sponsor |

The implemented database is a transactional SQLite aggregate for a single server deployment. Load testing and storage migration should precede horizontal scaling. SQLite files are not encrypted by this application; production requires encrypted host volumes and encrypted backup handling. Browser-held offline evidence is protected with a profile-local non-extractable key, but a compromised browser origin or unlocked device remains a risk. Offline capture does not override current server safety rules.

External accounting, WhatsApp, payment gateway, e-invoice/e-way-bill submission, RFID reader SDKs and GPS telemetry are not represented as connected until a real provider/hardware connection is configured and tested. Printouts and CSV/JSON exports are available independently of those integrations. Real production deployment is a separate acceptance step after this register is closed.

## Decisions deliberately left for company validation

Recovered recalled cylinders remain held until a client-approved remediation/release workflow is specified; the demo does not invent safety release criteria. Credit limits are reference values and do not automatically block dispatch. Rental closes at warehouse receipt (not driver collection), uses whole date-based days and supports the documented free-day rule rather than unconfirmed commercial slabs. Multi-line mixed-gas orders, partial credit/payment reversals and document attachments require further scope. These limits must be resolved before applying the demo to real daily operations.
