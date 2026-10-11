import type { Migration } from '../db/migrate.js';

// Stage 1 core schema: fully typed and relational. No JSON columns; lists inside a record are child tables.
const sql = `
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
`;

const migration: Migration = { version: 1, name: 'core', sql };
export default migration;
