# Stage 1 — Scalable foundation (design)

Status: draft for review · Date: 11 October 2026 · Owner: Cylvero

## 1. Why

Cylvero must track about **50,000 cylinders at launch and grow beyond that**, each with a lifelong history (fills, dispatches, deliveries, transfers, returns). Today every organization's data is one JSON document: each save rewrites it, each page load downloads it, and one lock serializes all writers. At 5,000 cylinders a single save already returned 5.6 MB. This does not scale to 50,000 cylinders and millions of history rows.

Stage 1 rebuilds storage, saving and loading on **plain Postgres tables** while keeping the business rules, screens and security behaviour. Later stages add the new tracking features on this foundation.

## 2. Decisions already made (with the product owner)

| Topic | Decision |
|---|---|
| Plan | Four stages; Stage 1 first. Stage 2 outside-code identity, Stage 3 lifeline/holdings/transfers, Stage 4 field app + load/security proof. |
| Database | **Postgres, provider-neutral**: standard Postgres connection only, no provider-specific features. Host chosen later (AWS RDS, DigitalOcean, Neon, Supabase); switching means changing one connection setting. MongoDB was considered and rejected (weaker for strict uniqueness, multi-record transactions and money reporting). |
| Hosting | **Cloudflare Workers** (server + static site) with **Cloudflare Hyperdrive** pooling the Postgres connection. A plain Node server build is kept for other hosts and local use. Vercel support is retired once Cloudflare works. |
| Storage approach | **Approach A**: relational tables for current state + an append-only movements (lifeline) table, written in the same transaction. |
| Scale | 50,000 cylinders at launch, designed and load-tested to 500,000. |
| Outside codes (Stage 2) | Format unknown: QR/barcode, stamped number or RFID must all work (scan or type; RFID readers that type like a keyboard). |
| Ownership (Stage 2) | Cylinders with an outside code become **company owned**; the outside code is an extra identifier for search and reporting to the issuer. |
| Returns (Stage 3) | A customer may hand back a cylinder last delivered to someone else: **accept, record the swap as an exception with a required explanation**, stop the previous holder's rent, alert the office. |
| Transfers (Stage 3) | Every move between customers is recorded on the cylinder's lifeline with reason, person and time, whether discovered at collection or reported in advance (office-recorded customer-to-customer transfer). |
| Rent | Unchanged: per cylinder per day after free days, until the cylinder comes back. |

## 3. Goals and non-goals

**Goals**
1. Saves touch only the rows involved; their cost does not grow with the number of cylinders.
2. Screens load pages, single records and server-computed counts; nothing downloads the whole organization.
3. Every current business rule, role and branch restriction and security property is preserved, proven by the existing test suites plus a side-by-side comparison with the current storage.
4. The database itself enforces the critical invariants (unique codes, one place per cylinder, append-only history, organization isolation).
5. Runs on Cloudflare Workers + Hyperdrive + any Postgres host, and locally with no extra installs.

**Non-goals for Stage 1** (planned for later stages): outside-code intake screens, holdings/"sent vs returned" views, customer-to-customer transfers, installable offline app, RFID hardware support. Stage 1 only creates the tables those need.

## 4. Data model

**Storage detail:** each business table has typed columns for everything the database must search, sort, join or constrain, plus a `doc jsonb` column holding the full record exactly as the domain code models it today (`shared/types.ts`). Loaders read `doc` and writers update the typed columns and `doc` together in one statement, so the existing domain rules run unchanged while every invariant is still enforced by real columns. Child tables (`order_cylinders`, `batch_cylinders`, `pickup_cylinders`, `cylinder_codes`) are kept in sync on every write.

All tables live in a private schema (`cylvero`), carry `org_id`, use random UUID primary keys (except history sequences), have row-level security enabled with no policies, and grant nothing to `PUBLIC` or API roles. Times are `timestamptz`; calendar dates are `date` in India time; money is integer paise (`bigint`).

| Table | Purpose | Key constraints / indexes |
|---|---|---|
| `orgs`, `settings` | Organization and company profile (name, address, GSTIN, tax, rent policy), with `version`. | — |
| `branches` | Plants/branches. | unique (`org_id`, `code`) |
| `parties` | Customers and suppliers (type, contact, GSTIN, rent rate, free days, deposit, credit limit), `version`. | unique (`org_id`, `branch_id`, lower(`name`)) |
| `cylinders` | **Current state only**: serial, manufacturer, gas, size, `owner_id`, `branch_id`, custody kind + holder id, condition, contents, test dates, certificate, current `batch_id`, `fill_count`, incident, written-off time, `version`. | unique (`org_id`, lower(`manufacturer`), lower(`serial`)); indexes on (`org_id`, custody, holder), (`org_id`, `branch_id`, condition), (`org_id`, `test_due`) |
| `cylinder_codes` | Every code that identifies a cylinder: current tag, previous tags, serial, and (Stage 2) outside codes with issuer. `kind`, `issuer`, `code`, `normalized_code`, `active`. | **unique (`org_id`, `issuer`, `normalized_code`)**: one code → one cylinder; index on `normalized_code` for scanning |
| `movements` | **Append-only lifeline**: `seq` (bigserial), cylinder, action, from (kind, id), to (kind, id), time, actor, reference, notes, changed fields only. | triggers block UPDATE/DELETE/TRUNCATE; index (`org_id`, `cylinder_id`, `seq`), (`org_id`, `at`) |
| `orders` | Order header: customer, branch, gas, size, quantity, priority, due date, price, status, vehicle, driver, delivery proofs, `version`. | index (`org_id`, `status`), (`org_id`, `party_id`) |
| `order_cylinders` | Each cylinder on an order and its state: manifest / delivered / unloaded, proof reference. | unique (`order_id`, `cylinder_id`); **partial unique index: a cylinder can be on only one order in transit** |
| `batches`, `batch_cylinders` | Filling, supplier and purchase batches; members and rejected members; release and recall data; recipient trace. | unique (`batch_id`, `cylinder_id`) |
| `pickups`, `pickup_cylinders` | Collection trips and their cylinders (collected / received / reversed). | unique (`pickup_id`, `cylinder_id`) |
| `rentals` | Holding periods per cylinder/customer (start, end, rate, free days, stop reason). | **partial unique: one open rental per cylinder**; index (`org_id`, `party_id`) where open |
| `invoices`, `invoice_lines` | Gas, rental and credit documents with issuer and bill-to snapshots, tax, totals, paid, credited, applied credit, `version`. | unique (`org_id`, `series`, `number`) |
| `receipts` | Payments, deposits, refunds, credit allocations/refunds (with reversal fields). | unique (`org_id`, `party_id`, `method`, lower(`reference`)) for non-cash |
| `exceptions` | Safety and reconciliation alerts (recall recovery, loss, unknown/swapped returns), status, resolution. | index (`org_id`, `status`) |
| `document_counters` | Next number per series and Indian fiscal year. | primary key (`org_id`, `series`, `fiscal_year`) |
| `users`, `sessions`, `idempotency`, `user_auth_epoch`, `login_attempts`, `audit_log`, `schema_migrations` | As today (sessions store token hashes; audit log append-only). | as today |

## 5. Saving (write path)

Every action keeps the existing request contract (`POST /api/actions` with type, payload, idempotency key) and follows these steps in **one transaction**:

1. **Authorize** role and branch (unchanged rules, checked first).
2. **Idempotency**: if the key was already used by this user, return the stored result (or 409 if the payload differs); unchanged behaviour.
3. **Load the working set** with a per-action loader. It is a small `AppState`-shaped object holding only the rows this action needs (for example, dispatch: the order, the named cylinders, their batches, the customer, the driver). Rows that will change are read with `SELECT … FOR UPDATE`, in a fixed order (by table, then id) to avoid deadlocks.
4. **Run the existing domain function** (`applyAction`) on the working set. Rules that today scan whole collections are replaced by loader-supplied facts or database checks:
   - "is this tag used anywhere": a `cylinder_codes` lookup, plus the unique index as a backstop;
   - document numbers: `document_counters` updated in the same transaction;
   - "does this party have history", recall recipient trace, rent billing: indexed queries in the loader.
5. **Diff and write**: compare the working set before and after; update changed rows (checking `version`), insert new rows, append movements and audit events.
6. **Commit**; store the idempotency result; return only the changed records (delta).

**Concurrency**: the single organization-wide revision is replaced by row locks plus per-record `version`. Two users changing different cylinders never block each other. Conflicting edits return a clear 409, and forms keep the existing "Reload latest form" recovery. The client keeps `expectedRevision` semantics through per-record versions.

## 6. Loading (read path)

New read endpoints. All of them authenticate, apply role and branch scoping in SQL, cap page size at 100, and use opaque cursors:

| Endpoint | Returns |
|---|---|
| `GET /api/session` | Signed-in user, CSRF token, company profile, branches, names-only staff list, role permissions. Small and fixed size. |
| `GET /api/cylinders?q=&filter=&branch=&cursor=` | One page of cylinders; `q` matches tag, serial, any code, owner name. |
| `GET /api/cylinders/:id` | One cylinder, its codes, open rental, current order/pickup. |
| `GET /api/cylinders/:id/lifeline?cursor=` | Movements newest first, paged; plus summary (fills, trips, customers, days out). |
| `GET /api/scan?code=&context=` | Resolves any code to a cylinder; with a context (e.g. an order) also says whether it is eligible and why not. |
| `GET /api/orders`, `/api/orders/:id`, `/api/batches…`, `/api/parties…`, `/api/invoices…`, `/api/receipts…`, `/api/exceptions…`, `/api/pickups…` | Paged lists and single records with the same scoping and money-field hiding as today. |
| `GET /api/options/:form?…` | Search-as-you-type option lists for forms (e.g. eligible cylinders for a dispatch). |
| `GET /api/dashboard` | Counts computed by the database. |
| `GET /api/reports/…` | Stock position (grouped counts), movement ledger (paged), audit trail (paged, admin/auditor). |
| Exports (`/api/export`, `/api/cylinders.csv`, `/api/export/tally`) | Streamed in chunks; formula-safe CSV; every export recorded in the audit log. |

**Client**: a small data layer in `src/` replaces "whole state in memory": per-page queries with caching, refetch after a save (using the returned delta), on window focus, and every 30 seconds on open lists. Screens keep their current look and wording; `Rundown.md` stays valid. The driver's offline evidence keeps working (the driver's own assigned orders are cached on the device).

## 7. Hosting

- **Cloudflare Workers** serve both the API and the built frontend, with `nodejs_compat`. The Express app is adapted to the Workers runtime through Cloudflare's Node HTTP server support. The adapter is isolated in `server/cloudflare.ts`.
- **Hyperdrive** pools Postgres connections; the app uses the standard `pg` driver. Connection details live in Cloudflare secrets, never in code.
- **Node server build** (`server/index.ts`) remains for local use and any non-Cloudflare host.
- **Security headers and routing** (now in `vercel.json`) move to Worker code, keeping the same Content-Security-Policy and HSTS. Login throttling stays in the database, so it holds across Worker instances.

## 8. Migration and local development

- **Schema changes** are numbered, forward-only SQL files in `server/migrations/`, applied once in order under an advisory lock and recorded in `schema_migrations`.
- **Data migration tool** (`scripts/migrate-json-to-tables.ts`) reads an existing JSON-state database (SQLite file or the current Postgres JSON schema) and writes the new tables into a **separate target**. It then verifies counts, custody, open rentals, invoice totals and balances, and refuses to finish on any mismatch. Sources are opened read-only and are never modified; `data/client-demo.sqlite` is never written.
- **Local use without installs**: the demo and practice server (`npm run dev`, `npm run demo:test`) uses **PGlite** (Postgres compiled to run inside Node) with data in a local folder. A real local Postgres or a hosted one is used when `DATABASE_URL` is set.
- The old JSON storage (`server/store.ts`, JSON parts of `server/pg-store.ts`) is removed only after all tests in section 9 pass on the new storage.

## 9. Verification (all must pass before Stage 1 is called done)

1. Existing domain, UI and offline tests pass unchanged.
2. API suites run against **PGlite and real Postgres**, covering roles, branches, CSRF, sessions, lockout, idempotency, concurrency, stale forms and restart persistence.
3. **Side-by-side check**: a scripted scenario covering every action and role runs through the current storage and the new one; normalized results must be identical.
4. **Security suite** on the new schema: private schema, RLS on with no policies, no grants to `PUBLIC`/API roles, append-only movements and audit, no cross-branch or cross-role data through any list, search, cursor or export parameter, no secrets or stack traces in responses, security headers on pages and API under Cloudflare.
5. **Load test**: 50,000 cylinders, 2 million movements, realistic orders/invoices. p95 under 300 ms for scan, search, cylinder detail and dispatch/delivery/return saves; under 1 s for dashboard counts; exports stream. Repeat at 500,000 cylinders and report the numbers.
6. **Concurrency test**: 20 parallel users dispatching, delivering and returning overlapping cylinders. No double allocation, no lost update, no deadlock left unhandled.
7. **Browser walk-through** of all 97 `Rundown.md` steps against the Cloudflare build (local Workers runtime) with Postgres.

## 10. Risks to settle early (first tasks of the plan)

| Risk | Early check |
|---|---|
| Express on Workers (Cloudflare's Node HTTP server support) behaves differently from Node | Spike: run the current API under `wrangler dev` with `nodejs_compat`; fall back to a thin fetch-handler router if needed. |
| Password hashing (`scrypt`) CPU time and availability on Workers | Measure in `wrangler dev`; if too slow, raise Workers CPU limit (paid plan) or switch to a Workers-native hash with migration on next login. |
| `pg` over Hyperdrive inside transactions with row locks | Spike with a local Hyperdrive-equivalent (direct connection) and confirm transaction-mode pooling behaviour. |
| PGlite compatibility (locks, advisory locks, triggers) for local use | Run the API suite on PGlite in week one; anything unsupported uses real Postgres in tests. |
| Domain rules that scan whole collections | Inventory all such reads (about 90) and give each an explicit loader query or database check before migrating actions. |

## 11. What the product owner provides (only before real use)

| Item | Why |
|---|---|
| **Cloudflare Workers paid plan** (about $5/month) | The free plan's per-request compute (≈10 ms) is too small for secure sign-in. |
| A **managed Postgres** in or near India (AWS RDS Mumbai, DigitalOcean Bangalore, Neon or Supabase Pro) with daily backups | 50,000 cylinders plus history exceed free tiers; backups are mandatory. |
| *(Optional)* an error-monitoring account (e.g. Sentry) | Server error alerts without personal data. |

No keys or passwords are needed during building; development uses local databases only.

## 12. Later stages (captured requirements)

- **Stage 2, outside-code identity**: intake by scanning or typing the outside code (any format) plus issuer; the app creates our ID and prints our QR; any code (outside, ours, old tag, serial) finds the cylinder everywhere; uniqueness per issuer; reporting by issuer.
- **Stage 3, lifeline and holdings**: refill count and current location shown prominently; per-customer and per-order holdings ("sent 10, returned 7, still out 3: these three"); overdue alerts; swapped returns accepted with a required explanation and an office alert; office-recorded customer-to-customer transfers moving holdings and rent; every move visible on the lifeline with reason, person and time.
- **Stage 4, field and proof**: installable phone app with offline start and bulk scanning; load tests at 500,000+ cylinders; an independent security audit of the deployed system.
