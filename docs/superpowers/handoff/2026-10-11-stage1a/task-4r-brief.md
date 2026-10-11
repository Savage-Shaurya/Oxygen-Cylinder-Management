# Task 4R: Fully typed relational schema + all review fixes (replaces Task 4's schema)

## Why
Product-owner directive: **no JSON copies of records anywhere**. Every field is a typed column; every list inside a record is a child table. Also: **no deferred minors** — every finding from the Task 1–4 reviews is fixed here. Migration 0001 has never been applied to a real database, so it is rewritten in place (same version 1, name `core`).

## Files
- Rewrite: `server/migrations/0001_core.ts`
- Modify: `server/db/sql.ts` (add `textKey`), `server/db/pg-adapter.ts`, `server/db/migrate.ts`, `tests/helpers/test-db.ts`, `tests/db-adapters.test.ts`, `tests/db-migrate.test.ts`, `tests/db-schema.test.ts`, `docs/superpowers/spikes/2026-10-11-platform-spike.md`, `docs/superpowers/specs/2026-10-11-scalable-foundation-design.md` (section 4 table only, see step 9)

## Interfaces
- Consumes: `Db`, `Queryable`, `assertSchemaName`, `normalizeCode` (sql.ts); `migrate`, `Migration` (migrate.ts); `forEachDb`, `freshSchema` (test helper).
- Produces (Plan 1B depends on these exact names):
  - `textKey(value: string): string` in `server/db/sql.ts` — NFKC, collapse whitespace, trim, `toLowerCase()`; throws `Error('Text is empty')` if the result is empty and `Error('Text contains control characters')` for U+0000–U+001F/U+007F. Used for every case-insensitive uniqueness key.
  - `migrate(db, schema, migrations = MIGRATIONS, options: { runtimeRole?: string } = {})` — unchanged result; with `runtimeRole` (validated by the same regex as schema names) grants that role least privilege (see step 5).
  - The schema in step 3 — exact table and column names.

## Step 1: Fix the database adapter (review findings, Task 2)
In `server/db/pg-adapter.ts`:
- In `transaction`, if `ROLLBACK` itself fails, pass that error to `client.release(err)` so the broken connection is evicted from the pool (otherwise `client.release()`).
- In `pgDb`, register `pool.on('error', (error) => console.error('Idle database connection error:', error.message))` once, so an idle-client error can never crash the process. Never log connection strings.

## Step 2: Add `textKey` to `server/db/sql.ts`
```ts
/** Case-insensitive uniqueness key computed in the app, so PGlite and hosted Postgres agree
 * regardless of database collation. */
export function textKey(value: string): string {
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error('Text contains control characters');
  const out = value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!out) throw new Error('Text is empty');
  return out;
}
```

## Step 3: Rewrite `server/migrations/0001_core.ts`
Keep the same export shape (`{ version: 1, name: 'core', sql }`). Replace the SQL with exactly this:

```sql
CREATE TABLE {{schema}}.orgs(id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE {{schema}}.settings(
  org_id text PRIMARY KEY REFERENCES {{schema}}.orgs(id),
  company_name text NOT NULL, address text NOT NULL, gstin text NOT NULL DEFAULT '',
  default_tax_bps integer NOT NULL CHECK (default_tax_bps BETWEEN 0 AND 10000),
  supplier_owned_rental text NOT NULL DEFAULT 'charge' CHECK (supplier_owned_rental IN ('charge','no_charge')),
  mode text NOT NULL CHECK (mode IN ('demo','live')),
  version integer NOT NULL DEFAULT 1);

CREATE TABLE {{schema}}.branches(
  org_id text NOT NULL REFERENCES {{schema}}.orgs(id), id text NOT NULL,
  name text NOT NULL, name_key text NOT NULL CHECK (name_key <> ''), city text NOT NULL,
  PRIMARY KEY (org_id, id));
CREATE UNIQUE INDEX branches_name_uq ON {{schema}}.branches(org_id, name_key);

CREATE TABLE {{schema}}.parties(
  org_id text NOT NULL, id text NOT NULL, branch_id text NOT NULL,
  type text NOT NULL CHECK (type IN ('hospital','homecare','industrial','supplier')),
  name text NOT NULL, name_key text NOT NULL CHECK (name_key <> ''),
  contact text NOT NULL, phone text NOT NULL, address text NOT NULL, city text NOT NULL,
  gstin text NOT NULL DEFAULT '',
  credit_limit_paise bigint NOT NULL DEFAULT 0 CHECK (credit_limit_paise >= 0),
  daily_rental_paise bigint NOT NULL DEFAULT 0 CHECK (daily_rental_paise >= 0),
  free_days integer NOT NULL DEFAULT 0 CHECK (free_days >= 0),
  deposit_paise bigint NOT NULL DEFAULT 0 CHECK (deposit_paise >= 0),
  version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, branch_id) REFERENCES {{schema}}.branches(org_id, id));
CREATE UNIQUE INDEX parties_name_uq ON {{schema}}.parties(org_id, branch_id, name_key);
CREATE INDEX parties_type_idx ON {{schema}}.parties(org_id, type, branch_id);

CREATE TABLE {{schema}}.batches(
  org_id text NOT NULL, id text NOT NULL, number text NOT NULL, branch_id text NOT NULL,
  gas text NOT NULL CHECK (gas IN ('Medical oxygen','Industrial oxygen')),
  supplier_id text, source text NOT NULL, operator text NOT NULL, fill_operator text,
  notes text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('awaiting_release','released','recalled')),
  created_at timestamptz NOT NULL, released_at timestamptz, released_by text,
  certificate text, quality_notes text, version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, branch_id) REFERENCES {{schema}}.branches(org_id, id),
  FOREIGN KEY (org_id, supplier_id) REFERENCES {{schema}}.parties(org_id, id));
CREATE UNIQUE INDEX batches_number_uq ON {{schema}}.batches(org_id, number);
CREATE INDEX batches_status_idx ON {{schema}}.batches(org_id, status);
CREATE INDEX batches_branch_list_idx ON {{schema}}.batches(org_id, branch_id, created_at DESC, id);

CREATE TABLE {{schema}}.cylinders(
  org_id text NOT NULL, id text NOT NULL,
  serial text NOT NULL, serial_key text NOT NULL CHECK (serial_key <> ''),
  tag text NOT NULL, manufacturer text NOT NULL, manufacturer_key text NOT NULL CHECK (manufacturer_key <> ''),
  gas text NOT NULL CHECK (gas IN ('Medical oxygen','Industrial oxygen')), size text NOT NULL,
  owner_party_id text, branch_id text NOT NULL,
  custody text NOT NULL CHECK (custody IN ('plant','vehicle','customer','supplier')),
  custodian_id text NOT NULL,
  condition text NOT NULL CHECK (condition IN ('serviceable','inspection_due','quarantine','testing','retired')),
  contents text NOT NULL CHECK (contents IN ('empty','full','partial','unknown')),
  test_due date NOT NULL, last_test date NOT NULL, certificate text NOT NULL,
  batch_id text, fill_count integer NOT NULL DEFAULT 0 CHECK (fill_count >= 0),
  incident_kind text CHECK (incident_kind IN ('lost','damaged')), incident_at timestamptz, incident_notes text,
  written_off_at timestamptz, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL,
  CHECK ((incident_kind IS NULL) = (incident_at IS NULL) AND (incident_kind IS NULL) = (incident_notes IS NULL)),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, branch_id) REFERENCES {{schema}}.branches(org_id, id),
  FOREIGN KEY (org_id, owner_party_id) REFERENCES {{schema}}.parties(org_id, id),
  -- purchase.receive creates cylinders before their batch, so this check waits for commit.
  FOREIGN KEY (org_id, batch_id) REFERENCES {{schema}}.batches(org_id, id) DEFERRABLE INITIALLY DEFERRED);
CREATE UNIQUE INDEX cylinders_serial_uq ON {{schema}}.cylinders(org_id, manufacturer_key, serial_key);
CREATE INDEX cylinders_holder_idx ON {{schema}}.cylinders(org_id, custody, custodian_id);
CREATE INDEX cylinders_branch_condition_idx ON {{schema}}.cylinders(org_id, branch_id, condition);
CREATE INDEX cylinders_test_due_idx ON {{schema}}.cylinders(org_id, test_due);
CREATE INDEX cylinders_batch_idx ON {{schema}}.cylinders(org_id, batch_id);
CREATE INDEX cylinders_owner_idx ON {{schema}}.cylinders(org_id, owner_party_id);
CREATE INDEX cylinders_branch_list_idx ON {{schema}}.cylinders(org_id, branch_id, created_at DESC, id);

-- Every identifier on a cylinder. Tags (current and previous) share issuer ''; serials live in
-- the manufacturer's namespace 'serial:<manufacturer_key>'; outside codes use their issuer.
CREATE TABLE {{schema}}.cylinder_codes(
  id bigserial PRIMARY KEY, org_id text NOT NULL, cylinder_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('tag','previous_tag','serial','external')),
  issuer text NOT NULL, code text NOT NULL, normalized_code text NOT NULL CHECK (normalized_code <> ''),
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'serial') = (issuer LIKE 'serial:%')),
  CHECK (kind NOT IN ('tag','previous_tag') OR issuer = ''),
  CHECK (kind <> 'external' OR issuer <> ''),
  FOREIGN KEY (org_id, cylinder_id) REFERENCES {{schema}}.cylinders(org_id, id));
CREATE UNIQUE INDEX cylinder_codes_uq ON {{schema}}.cylinder_codes(org_id, issuer, normalized_code);
CREATE UNIQUE INDEX cylinder_codes_one_tag_uq ON {{schema}}.cylinder_codes(org_id, cylinder_id) WHERE kind = 'tag';
CREATE INDEX cylinder_codes_lookup_idx ON {{schema}}.cylinder_codes(org_id, normalized_code);
CREATE INDEX cylinder_codes_cylinder_idx ON {{schema}}.cylinder_codes(org_id, cylinder_id);

CREATE TABLE {{schema}}.movements(
  seq bigserial PRIMARY KEY, org_id text NOT NULL, id text NOT NULL, cylinder_id text NOT NULL,
  action text NOT NULL, from_ref text NOT NULL, to_ref text NOT NULL, at timestamptz NOT NULL,
  actor_id text NOT NULL, actor_name text NOT NULL, reference text NOT NULL, notes text NOT NULL,
  FOREIGN KEY (org_id, cylinder_id) REFERENCES {{schema}}.cylinders(org_id, id));
CREATE UNIQUE INDEX movements_id_uq ON {{schema}}.movements(org_id, id);
CREATE INDEX movements_cylinder_idx ON {{schema}}.movements(org_id, cylinder_id, seq DESC);
CREATE INDEX movements_at_idx ON {{schema}}.movements(org_id, at DESC);
CREATE INDEX movements_to_idx ON {{schema}}.movements(org_id, to_ref);
CREATE INDEX movements_from_idx ON {{schema}}.movements(org_id, from_ref);

-- One row per cylinder field a movement changed (replaces before/after snapshots).
CREATE TABLE {{schema}}.movement_changes(
  org_id text NOT NULL, movement_id text NOT NULL, field text NOT NULL,
  before_value text, after_value text,
  PRIMARY KEY (org_id, movement_id, field),
  FOREIGN KEY (org_id, movement_id) REFERENCES {{schema}}.movements(org_id, id));

CREATE TABLE {{schema}}.orders(
  org_id text NOT NULL, id text NOT NULL, number text NOT NULL,
  party_id text NOT NULL, branch_id text NOT NULL,
  gas text NOT NULL CHECK (gas IN ('Medical oxygen','Industrial oxygen')), size text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  priority text NOT NULL CHECK (priority IN ('normal','urgent')),
  due_date date NOT NULL, notes text NOT NULL DEFAULT '',
  unit_price_paise bigint NOT NULL CHECK (unit_price_paise >= 0),
  status text NOT NULL CHECK (status IN ('open','dispatched','partial','delivered','closed_short','cancelled')),
  cancel_reason text, vehicle text NOT NULL DEFAULT '', driver_id text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL, recipient text, delivered_at timestamptz,
  challan_issuer_company_name text, challan_issuer_address text, challan_issuer_gstin text,
  challan_recipient_name text, challan_recipient_address text, challan_recipient_city text,
  challan_recipient_gstin text,
  version integer NOT NULL DEFAULT 1,
  CHECK ((challan_issuer_company_name IS NULL) = (challan_recipient_name IS NULL)),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, party_id) REFERENCES {{schema}}.parties(org_id, id),
  FOREIGN KEY (org_id, branch_id) REFERENCES {{schema}}.branches(org_id, id));
CREATE UNIQUE INDEX orders_number_uq ON {{schema}}.orders(org_id, number);
CREATE INDEX orders_status_idx ON {{schema}}.orders(org_id, status);
CREATE INDEX orders_party_idx ON {{schema}}.orders(org_id, party_id);
CREATE INDEX orders_driver_idx ON {{schema}}.orders(org_id, driver_id, status);
CREATE INDEX orders_branch_list_idx ON {{schema}}.orders(org_id, branch_id, created_at DESC, id);

CREATE TABLE {{schema}}.order_cylinders(
  org_id text NOT NULL, order_id text NOT NULL, cylinder_id text NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  state text NOT NULL CHECK (state IN ('on_vehicle','delivered','unloaded')),
  PRIMARY KEY (org_id, order_id, cylinder_id),
  FOREIGN KEY (org_id, order_id) REFERENCES {{schema}}.orders(org_id, id),
  FOREIGN KEY (org_id, cylinder_id) REFERENCES {{schema}}.cylinders(org_id, id));
CREATE UNIQUE INDEX order_cylinders_in_transit_uq ON {{schema}}.order_cylinders(org_id, cylinder_id) WHERE state = 'on_vehicle';
CREATE INDEX order_cylinders_cylinder_idx ON {{schema}}.order_cylinders(org_id, cylinder_id);

CREATE TABLE {{schema}}.order_delivery_proofs(
  org_id text NOT NULL, id text NOT NULL, order_id text NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  recipient text NOT NULL, at timestamptz NOT NULL, actor_id text NOT NULL, notes text NOT NULL DEFAULT '',
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, order_id) REFERENCES {{schema}}.orders(org_id, id));
CREATE UNIQUE INDEX order_delivery_proofs_position_uq ON {{schema}}.order_delivery_proofs(org_id, order_id, position);

CREATE TABLE {{schema}}.order_delivery_proof_cylinders(
  org_id text NOT NULL, proof_id text NOT NULL, cylinder_id text NOT NULL,
  PRIMARY KEY (org_id, proof_id, cylinder_id),
  FOREIGN KEY (org_id, proof_id) REFERENCES {{schema}}.order_delivery_proofs(org_id, id),
  FOREIGN KEY (org_id, cylinder_id) REFERENCES {{schema}}.cylinders(org_id, id));

CREATE TABLE {{schema}}.pickups(
  org_id text NOT NULL, id text NOT NULL, party_id text NOT NULL, branch_id text NOT NULL,
  driver_id text NOT NULL, vehicle text NOT NULL, created_at timestamptz NOT NULL,
  notes text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, party_id) REFERENCES {{schema}}.parties(org_id, id),
  FOREIGN KEY (org_id, branch_id) REFERENCES {{schema}}.branches(org_id, id));
CREATE INDEX pickups_party_idx ON {{schema}}.pickups(org_id, party_id);
CREATE INDEX pickups_driver_idx ON {{schema}}.pickups(org_id, driver_id);
CREATE INDEX pickups_branch_list_idx ON {{schema}}.pickups(org_id, branch_id, created_at DESC, id);

CREATE TABLE {{schema}}.pickup_cylinders(
  org_id text NOT NULL, pickup_id text NOT NULL, cylinder_id text NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  state text NOT NULL CHECK (state IN ('on_vehicle','received','reversed')),
  PRIMARY KEY (org_id, pickup_id, cylinder_id),
  FOREIGN KEY (org_id, pickup_id) REFERENCES {{schema}}.pickups(org_id, id),
  FOREIGN KEY (org_id, cylinder_id) REFERENCES {{schema}}.cylinders(org_id, id));
CREATE UNIQUE INDEX pickup_cylinders_in_transit_uq ON {{schema}}.pickup_cylinders(org_id, cylinder_id) WHERE state = 'on_vehicle';
CREATE INDEX pickup_cylinders_cylinder_idx ON {{schema}}.pickup_cylinders(org_id, cylinder_id);

-- Cross-guard: a cylinder is on at most one vehicle, whether an order truck or a collection.
CREATE TABLE {{schema}}.vehicle_slots(
  org_id text NOT NULL, cylinder_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('order','pickup')), source_id text NOT NULL,
  PRIMARY KEY (org_id, cylinder_id),
  FOREIGN KEY (org_id, cylinder_id) REFERENCES {{schema}}.cylinders(org_id, id));

CREATE TABLE {{schema}}.batch_cylinders(
  org_id text NOT NULL, batch_id text NOT NULL, cylinder_id text NOT NULL,
  position integer NOT NULL CHECK (position >= 0), rejected boolean NOT NULL DEFAULT false,
  PRIMARY KEY (org_id, batch_id, cylinder_id),
  FOREIGN KEY (org_id, batch_id) REFERENCES {{schema}}.batches(org_id, id),
  FOREIGN KEY (org_id, cylinder_id) REFERENCES {{schema}}.cylinders(org_id, id));
CREATE INDEX batch_cylinders_cylinder_idx ON {{schema}}.batch_cylinders(org_id, cylinder_id);

CREATE TABLE {{schema}}.batch_recipient_trace(
  org_id text NOT NULL, batch_id text NOT NULL, cylinder_id text NOT NULL,
  party_id text NOT NULL, order_id text NOT NULL, at timestamptz NOT NULL,
  PRIMARY KEY (org_id, batch_id, cylinder_id, order_id),
  FOREIGN KEY (org_id, batch_id) REFERENCES {{schema}}.batches(org_id, id),
  FOREIGN KEY (org_id, cylinder_id) REFERENCES {{schema}}.cylinders(org_id, id),
  FOREIGN KEY (org_id, party_id) REFERENCES {{schema}}.parties(org_id, id),
  FOREIGN KEY (org_id, order_id) REFERENCES {{schema}}.orders(org_id, id));

CREATE TABLE {{schema}}.rentals(
  org_id text NOT NULL, id text NOT NULL, cylinder_id text NOT NULL, party_id text NOT NULL,
  order_id text NOT NULL, start_date date NOT NULL, end_date date,
  daily_rate_paise bigint NOT NULL CHECK (daily_rate_paise >= 0),
  free_days integer NOT NULL CHECK (free_days >= 0),
  version integer NOT NULL DEFAULT 1,
  CHECK (end_date IS NULL OR end_date >= start_date),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, cylinder_id) REFERENCES {{schema}}.cylinders(org_id, id),
  FOREIGN KEY (org_id, party_id) REFERENCES {{schema}}.parties(org_id, id),
  FOREIGN KEY (org_id, order_id) REFERENCES {{schema}}.orders(org_id, id));
CREATE UNIQUE INDEX rentals_one_open_uq ON {{schema}}.rentals(org_id, cylinder_id) WHERE end_date IS NULL;
CREATE INDEX rentals_party_open_idx ON {{schema}}.rentals(org_id, party_id) WHERE end_date IS NULL;
CREATE INDEX rentals_party_idx ON {{schema}}.rentals(org_id, party_id, start_date);
CREATE INDEX rentals_cylinder_idx ON {{schema}}.rentals(org_id, cylinder_id, start_date);

CREATE TABLE {{schema}}.invoices(
  org_id text NOT NULL, id text NOT NULL, number text NOT NULL,
  party_id text NOT NULL, branch_id text NOT NULL,
  type text NOT NULL CHECK (type IN ('gas','rental','credit')), source_id text NOT NULL,
  issued_at timestamptz NOT NULL, due_date date NOT NULL,
  subtotal_paise bigint NOT NULL CHECK (subtotal_paise >= 0),
  tax_bps integer NOT NULL CHECK (tax_bps BETWEEN 0 AND 10000),
  tax_paise bigint NOT NULL CHECK (tax_paise >= 0),
  total_paise bigint NOT NULL CHECK (total_paise >= 0),
  paid_paise bigint NOT NULL DEFAULT 0 CHECK (paid_paise >= 0),
  credited_paise bigint NOT NULL DEFAULT 0 CHECK (credited_paise >= 0),
  applied_credit_paise bigint NOT NULL DEFAULT 0 CHECK (applied_credit_paise >= 0),
  credit_offset_paise bigint NOT NULL DEFAULT 0 CHECK (credit_offset_paise >= 0),
  status text NOT NULL CHECK (status IN ('issued','partial','paid','credited')),
  notes text NOT NULL DEFAULT '', credited_invoice_id text,
  bill_to_name text, bill_to_address text, bill_to_city text, bill_to_gstin text,
  issuer_company_name text, issuer_address text, issuer_gstin text,
  version integer NOT NULL DEFAULT 1,
  CHECK ((bill_to_name IS NULL) = (bill_to_address IS NULL)),
  CHECK ((issuer_company_name IS NULL) = (issuer_address IS NULL)),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, party_id) REFERENCES {{schema}}.parties(org_id, id),
  FOREIGN KEY (org_id, branch_id) REFERENCES {{schema}}.branches(org_id, id),
  FOREIGN KEY (org_id, credited_invoice_id) REFERENCES {{schema}}.invoices(org_id, id));
CREATE UNIQUE INDEX invoices_number_uq ON {{schema}}.invoices(org_id, number);
CREATE INDEX invoices_party_idx ON {{schema}}.invoices(org_id, party_id, status);
CREATE INDEX invoices_source_idx ON {{schema}}.invoices(org_id, source_id);
CREATE INDEX invoices_branch_list_idx ON {{schema}}.invoices(org_id, branch_id, issued_at DESC, id);

CREATE TABLE {{schema}}.invoice_lines(
  org_id text NOT NULL, invoice_id text NOT NULL, position integer NOT NULL CHECK (position >= 0),
  description text NOT NULL, quantity integer NOT NULL CHECK (quantity >= 0),
  unit_price_paise bigint NOT NULL CHECK (unit_price_paise >= 0),
  amount_paise bigint NOT NULL CHECK (amount_paise >= 0),
  PRIMARY KEY (org_id, invoice_id, position),
  FOREIGN KEY (org_id, invoice_id) REFERENCES {{schema}}.invoices(org_id, id));

CREATE TABLE {{schema}}.receipts(
  org_id text NOT NULL, id text NOT NULL, number text NOT NULL,
  party_id text NOT NULL, invoice_id text,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  method text NOT NULL CHECK (method IN ('cash','upi','bank','credit')),
  reference text NOT NULL, reference_key text NOT NULL CHECK (reference_key <> ''),
  at timestamptz NOT NULL, actor_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('payment','deposit','refund','credit_refund','credit_allocation')),
  credit_invoice_id text, reason text, reversed_at timestamptz, reversal_reason text,
  target_credited_paise bigint CHECK (target_credited_paise IS NULL OR target_credited_paise >= 0),
  CHECK ((reversed_at IS NULL) = (reversal_reason IS NULL)),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, party_id) REFERENCES {{schema}}.parties(org_id, id),
  FOREIGN KEY (org_id, invoice_id) REFERENCES {{schema}}.invoices(org_id, id),
  FOREIGN KEY (org_id, credit_invoice_id) REFERENCES {{schema}}.invoices(org_id, id));
CREATE UNIQUE INDEX receipts_number_uq ON {{schema}}.receipts(org_id, number);
-- Today's rule (server/domain.ts receiptReference): a reference may be used once per method across the whole organization, cash included.
CREATE UNIQUE INDEX receipts_reference_uq ON {{schema}}.receipts(org_id, method, reference_key);
CREATE INDEX receipts_party_idx ON {{schema}}.receipts(org_id, party_id, at DESC);
CREATE INDEX receipts_invoice_idx ON {{schema}}.receipts(org_id, invoice_id);

CREATE TABLE {{schema}}.exceptions(
  org_id text NOT NULL, id text NOT NULL, at timestamptz NOT NULL, type text NOT NULL,
  summary text NOT NULL, entity_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('open','resolved')),
  resolution text, branch_id text, version integer NOT NULL DEFAULT 1,
  CHECK (status = 'open' OR resolution IS NOT NULL),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, branch_id) REFERENCES {{schema}}.branches(org_id, id));
CREATE INDEX exceptions_open_idx ON {{schema}}.exceptions(org_id, status, at DESC);
CREATE INDEX exceptions_entity_idx ON {{schema}}.exceptions(org_id, entity_id);
CREATE INDEX exceptions_branch_list_idx ON {{schema}}.exceptions(org_id, branch_id, at DESC, id);

CREATE TABLE {{schema}}.document_counters(
  org_id text NOT NULL REFERENCES {{schema}}.orgs(id), series text NOT NULL, fiscal_year text NOT NULL,
  next_value bigint NOT NULL CHECK (next_value >= 1),
  PRIMARY KEY (org_id, series, fiscal_year));

CREATE TABLE {{schema}}.users(
  id text PRIMARY KEY, org_id text NOT NULL REFERENCES {{schema}}.orgs(id),
  name text NOT NULL, email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('admin','operations','quality','finance','driver','auditor')),
  active boolean NOT NULL, password_hash text NOT NULL);
CREATE TABLE {{schema}}.user_branches(
  user_id text NOT NULL REFERENCES {{schema}}.users(id), org_id text NOT NULL, branch_id text NOT NULL,
  PRIMARY KEY (user_id, branch_id),
  FOREIGN KEY (org_id, branch_id) REFERENCES {{schema}}.branches(org_id, id));
CREATE TABLE {{schema}}.sessions(
  token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES {{schema}}.users(id),
  csrf_token text NOT NULL, expires_at bigint NOT NULL, last_seen_at bigint NOT NULL);
CREATE INDEX sessions_user_idx ON {{schema}}.sessions(user_id);
CREATE TABLE {{schema}}.idempotency(
  org_id text NOT NULL, user_id text NOT NULL REFERENCES {{schema}}.users(id), idem_key text NOT NULL,
  request_hash text NOT NULL, result_message text NOT NULL, result_entity_id text,
  auth_epoch integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id, idem_key));
CREATE TABLE {{schema}}.user_auth_epoch(user_id text PRIMARY KEY REFERENCES {{schema}}.users(id), epoch integer NOT NULL);
CREATE TABLE {{schema}}.login_attempts(key text PRIMARY KEY, count integer NOT NULL, until bigint NOT NULL);
CREATE TABLE {{schema}}.audit_log(
  sequence bigserial PRIMARY KEY, org_id text NOT NULL, id text NOT NULL, at timestamptz NOT NULL,
  actor_id text NOT NULL, actor_name text NOT NULL, action text NOT NULL, entity_id text NOT NULL,
  summary text NOT NULL);
CREATE UNIQUE INDEX audit_id_uq ON {{schema}}.audit_log(org_id, id);
CREATE INDEX audit_org_idx ON {{schema}}.audit_log(org_id, sequence DESC);
CREATE INDEX audit_entity_idx ON {{schema}}.audit_log(org_id, entity_id);

CREATE FUNCTION {{schema}}.append_only() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'append only'; END $$;
CREATE TRIGGER movements_no_change BEFORE UPDATE OR DELETE ON {{schema}}.movements
  FOR EACH ROW EXECUTE FUNCTION {{schema}}.append_only();
CREATE TRIGGER movements_no_truncate BEFORE TRUNCATE ON {{schema}}.movements
  FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.append_only();
CREATE TRIGGER movement_changes_no_change BEFORE UPDATE OR DELETE ON {{schema}}.movement_changes
  FOR EACH ROW EXECUTE FUNCTION {{schema}}.append_only();
CREATE TRIGGER movement_changes_no_truncate BEFORE TRUNCATE ON {{schema}}.movement_changes
  FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.append_only();
CREATE TRIGGER audit_no_change BEFORE UPDATE OR DELETE ON {{schema}}.audit_log
  FOR EACH ROW EXECUTE FUNCTION {{schema}}.append_only();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON {{schema}}.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.append_only();
```

Notes for the implementer:
- `user_branches` replaces the JSON `branch_ids` text column; `idempotency` stores typed result fields instead of `result_json`.
- `cylinders.owner_party_id IS NULL` means company owned (the domain's `ownerId: 'company'`).
- If PGlite rejects any statement, keep the semantics and the tests, make the minimal compatible change, and report it.

## Step 4: Migration runner fixes (review findings, Task 3)
In `server/db/migrate.ts`:
- Before applying, throw `Error('Duplicate migration version <n>')` if two migrations share a version.
- Quote table names by doubling embedded quotes: `"${tablename.replaceAll('"', '""')}"` (instead of stripping).

## Step 5: Least-privilege runtime role
Extend `migrate` with `options: { runtimeRole?: string } = {}`. When `runtimeRole` is given: validate it with the schema-name regex (`assertSchemaName` semantics, throw `Error('Invalid role name')`), and if the role exists in `pg_roles`, after `lockDown` run:
```sql
GRANT USAGE ON SCHEMA <s> TO <role>;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA <s> TO <role>;
REVOKE UPDATE, DELETE ON <s>.movements, <s>.movement_changes, <s>.audit_log, <s>.schema_migrations FROM <role>;
REVOKE INSERT ON <s>.schema_migrations FROM <role>;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA <s> TO <role>;
```
(never TRUNCATE, never CREATE). If the role does not exist, throw `Error('Runtime role <name> does not exist')`. The migrating (owner) connection keeps DDL; the app will later connect as the runtime role.

## Step 6: Test helper and adapter tests (review findings, Task 2)
- `tests/helpers/test-db.ts`: `freshSchema` records every name it returns; after each `[postgres]` test body, `forEachDb` drops every recorded schema with `DROP SCHEMA IF EXISTS "<name>" CASCADE` and clears the record (PGlite in-memory needs no cleanup).
- `tests/db-adapters.test.ts`: add
  - a test where `transaction` work inserts a row, then throws `new Error('stop')`; assert the error propagates and the row is absent (both engines);
  - a Postgres-only test: pool with `max: 1`, run 5 transactions in a row where every one throws; then a successful `SELECT 1` must complete within 2 s (proves clients are released).
  - `textKey` cases: `' Demo  Clinic '` → `'demo clinic'`; `'ＤＥＭＯ'` (full-width) → `'demo'`; `'   '` throws `Text is empty`; `'a\u0000b'` throws `Text contains control characters`.

## Step 7: Migration tests (review findings)
`tests/db-migrate.test.ts`: add
- duplicate versions rejected: `migrate(db, s, [one, { ...two, version: 1 }])` rejects `/Duplicate migration version 1/` and creates nothing;
- runtime role (Postgres only, needs `CTMS_TEST_PG_ADMIN_URL=postgresql://superuser@127.0.0.1:55432/cylvero_test` to create role `cylvero_runtime_test` if missing, `GRANT cylvero_runtime_test TO app_owner` not required): after `migrate(..., { runtimeRole: 'cylvero_runtime_test' })`, connecting as superuser with `SET ROLE cylvero_runtime_test`: INSERT into `widgets` works; on the core schema later tasks verify movements; here assert `UPDATE` on `schema_migrations` is denied (`/permission denied/`) and `TRUNCATE widgets` is denied.
- unknown runtime role rejected: `/Runtime role nope_role does not exist/`.

## Step 8: Schema tests rewritten for typed columns
Rewrite `tests/db-schema.test.ts` setup and every test to the typed columns (no `doc`). Keep every existing test's intent and add:
- table list (alphabetical): `audit_log, batch_cylinders, batch_recipient_trace, batches, branches, cylinder_codes, cylinders, document_counters, exceptions, idempotency, invoice_lines, invoices, login_attempts, movement_changes, movements, order_cylinders, order_delivery_proof_cylinders, order_delivery_proofs, orders, orgs, parties, pickup_cylinders, pickups, receipts, rentals, schema_migrations, sessions, settings, user_auth_epoch, user_branches, users, vehicle_slots`;
- **no `doc` or other json/jsonb column anywhere**: `SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND data_type IN ('json','jsonb')` returns 0 rows;
- serial namespace: a tag `'S-1'` on cylinder c1 (issuer `''`) and serial `'S-1'` on c2 (issuer `'serial:works'`) both insert; a serial row with issuer `''` is rejected (check constraint); an external row with issuer `''` is rejected;
- one current tag per cylinder: a second `kind='tag'` row for c1 is rejected;
- one order in transit per cylinder **within `order_cylinders` itself** (partial unique index), and the same within `pickup_cylinders`; plus the existing `vehicle_slots` cross-guard test;
- foreign keys with org isolation: inserting a party whose branch belongs to another org is rejected (`/violates foreign key/`); inserting `order_cylinders` for a non-existent order is rejected; a cylinder with a non-existent `batch_id` is rejected **at commit** (deferred: the insert succeeds inside a transaction, the transaction's commit fails);
- receipts: the same reference_key for two **different parties** with the same method is rejected; the same reference with a different method is accepted; cash duplicates are rejected (today's rule);
- money checks: negative `amount_paise` on receipts, negative `unit_price_paise` on orders, `quantity = 0` on orders are rejected (`/violates check constraint/`);
- rentals: `end_date < start_date` rejected;
- movement_changes is append-only (UPDATE/DELETE/TRUNCATE fail with `/append only/`).
- API-role probe test: also assert `INSERT` into `orgs` as `anon` is denied.

## Step 9: Documents
- `docs/superpowers/spikes/2026-10-11-platform-spike.md`: on the CPU line, cite the source ("Cloudflare Workers documented free-plan CPU limit, ~10 ms per request; not measured in this spike"); remove or source the unbacked `Date.now()` statement (say: "Cloudflare documents that Date.now() does not advance during request execution").
- Spec `docs/superpowers/specs/2026-10-11-scalable-foundation-design.md` section 4 table: replace the rows so they match this schema (typed columns, child tables listed, receipts reference unique org-wide per method incl. cash, `user_branches`, `movement_changes`, text ids carried over from today's data instead of random UUIDs, branches unique by name — there is no branch code in the domain).

## Step 10: Verify and commit
Run, and paste outputs into the report:
- `npx tsx --test tests/db-*.test.ts` (PGlite)
- `CTMS_TEST_PG_URL=postgresql://app_owner@127.0.0.1:55432/cylvero_test CTMS_TEST_PG_PROBE_URL=postgresql://api_probe@127.0.0.1:55432/cylvero_test CTMS_TEST_PG_ADMIN_URL=postgresql://superuser@127.0.0.1:55432/cylvero_test npx tsx --test tests/db-*.test.ts`
- `npm run typecheck`, `npm test`, `npm audit`
Commit: `Make the core schema fully typed and relational; fix all review findings`
