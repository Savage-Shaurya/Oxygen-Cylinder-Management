import type { Migration } from '../db/migrate.js';

// Stage 1 core schema. Each business table has typed columns for everything the database must
// search, join or constrain, plus `doc` holding the full record as modelled in shared/types.ts.
const sql = `
CREATE TABLE {{schema}}.orgs(id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE {{schema}}.settings(
  org_id text PRIMARY KEY REFERENCES {{schema}}.orgs(id), version integer NOT NULL DEFAULT 1, doc jsonb NOT NULL);

CREATE TABLE {{schema}}.branches(
  org_id text NOT NULL REFERENCES {{schema}}.orgs(id), id text NOT NULL, doc jsonb NOT NULL,
  PRIMARY KEY (org_id, id));

CREATE TABLE {{schema}}.parties(
  org_id text NOT NULL, id text NOT NULL, branch_id text NOT NULL,
  type text NOT NULL CHECK (type IN ('hospital','homecare','industrial','supplier')),
  name text NOT NULL, version integer NOT NULL DEFAULT 1, doc jsonb NOT NULL,
  PRIMARY KEY (org_id, id), FOREIGN KEY (org_id, branch_id) REFERENCES {{schema}}.branches(org_id, id));
CREATE UNIQUE INDEX parties_name_uq ON {{schema}}.parties(org_id, branch_id, lower(name));

CREATE TABLE {{schema}}.cylinders(
  org_id text NOT NULL, id text NOT NULL, branch_id text NOT NULL, owner_id text NOT NULL,
  custody text NOT NULL CHECK (custody IN ('plant','vehicle','customer','supplier')),
  custodian_id text NOT NULL,
  condition text NOT NULL CHECK (condition IN ('serviceable','inspection_due','quarantine','testing','retired')),
  contents text NOT NULL CHECK (contents IN ('empty','full','partial','unknown')),
  gas text NOT NULL, size text NOT NULL, tag text NOT NULL, serial text NOT NULL, manufacturer text NOT NULL,
  test_due date NOT NULL, batch_id text, fill_count integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), doc jsonb NOT NULL,
  PRIMARY KEY (org_id, id), FOREIGN KEY (org_id, branch_id) REFERENCES {{schema}}.branches(org_id, id));
CREATE UNIQUE INDEX cylinders_serial_uq ON {{schema}}.cylinders(org_id, lower(manufacturer), lower(serial));
CREATE INDEX cylinders_holder_idx ON {{schema}}.cylinders(org_id, custody, custodian_id);
CREATE INDEX cylinders_branch_condition_idx ON {{schema}}.cylinders(org_id, branch_id, condition);
CREATE INDEX cylinders_test_due_idx ON {{schema}}.cylinders(org_id, test_due);
CREATE INDEX cylinders_batch_idx ON {{schema}}.cylinders(org_id, batch_id);

CREATE TABLE {{schema}}.cylinder_codes(
  org_id text NOT NULL, cylinder_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('tag','previous_tag','serial','external')),
  issuer text NOT NULL DEFAULT '', code text NOT NULL, normalized_code text NOT NULL,
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, cylinder_id) REFERENCES {{schema}}.cylinders(org_id, id));
CREATE UNIQUE INDEX cylinder_codes_uq ON {{schema}}.cylinder_codes(org_id, issuer, normalized_code);
CREATE INDEX cylinder_codes_lookup_idx ON {{schema}}.cylinder_codes(org_id, normalized_code);
CREATE INDEX cylinder_codes_cylinder_idx ON {{schema}}.cylinder_codes(org_id, cylinder_id);

CREATE TABLE {{schema}}.movements(
  seq bigserial PRIMARY KEY, org_id text NOT NULL, id text NOT NULL, cylinder_id text NOT NULL,
  action text NOT NULL, from_ref text NOT NULL, to_ref text NOT NULL, at timestamptz NOT NULL,
  actor_id text NOT NULL, actor_name text NOT NULL, reference text NOT NULL, notes text NOT NULL,
  changes jsonb);
CREATE UNIQUE INDEX movements_id_uq ON {{schema}}.movements(org_id, id);
CREATE INDEX movements_cylinder_idx ON {{schema}}.movements(org_id, cylinder_id, seq DESC);
CREATE INDEX movements_at_idx ON {{schema}}.movements(org_id, at DESC);

CREATE TABLE {{schema}}.orders(
  org_id text NOT NULL, id text NOT NULL, branch_id text NOT NULL, party_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('open','dispatched','partial','delivered','closed_short','cancelled')),
  number text NOT NULL, driver_id text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1, doc jsonb NOT NULL, PRIMARY KEY (org_id, id));
CREATE UNIQUE INDEX orders_number_uq ON {{schema}}.orders(org_id, number);
CREATE INDEX orders_status_idx ON {{schema}}.orders(org_id, status);
CREATE INDEX orders_party_idx ON {{schema}}.orders(org_id, party_id);
CREATE INDEX orders_driver_idx ON {{schema}}.orders(org_id, driver_id, status);

CREATE TABLE {{schema}}.order_cylinders(
  org_id text NOT NULL, order_id text NOT NULL, cylinder_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('on_vehicle','delivered','unloaded')),
  PRIMARY KEY (org_id, order_id, cylinder_id));
CREATE INDEX order_cylinders_cylinder_idx ON {{schema}}.order_cylinders(org_id, cylinder_id);

CREATE TABLE {{schema}}.pickups(
  org_id text NOT NULL, id text NOT NULL, branch_id text NOT NULL, party_id text NOT NULL,
  driver_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1, doc jsonb NOT NULL, PRIMARY KEY (org_id, id));
CREATE INDEX pickups_party_idx ON {{schema}}.pickups(org_id, party_id);

CREATE TABLE {{schema}}.pickup_cylinders(
  org_id text NOT NULL, pickup_id text NOT NULL, cylinder_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('on_vehicle','received','reversed')),
  PRIMARY KEY (org_id, pickup_id, cylinder_id));

-- A cylinder can sit on only one vehicle at a time, whether an order truck or a collection.
CREATE TABLE {{schema}}.vehicle_slots(
  org_id text NOT NULL, cylinder_id text NOT NULL, source text NOT NULL CHECK (source IN ('order','pickup')),
  source_id text NOT NULL, PRIMARY KEY (org_id, cylinder_id));

CREATE TABLE {{schema}}.batches(
  org_id text NOT NULL, id text NOT NULL, branch_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('awaiting_release','released','recalled')),
  number text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1, doc jsonb NOT NULL, PRIMARY KEY (org_id, id));
CREATE UNIQUE INDEX batches_number_uq ON {{schema}}.batches(org_id, number);
CREATE INDEX batches_status_idx ON {{schema}}.batches(org_id, status);

CREATE TABLE {{schema}}.batch_cylinders(
  org_id text NOT NULL, batch_id text NOT NULL, cylinder_id text NOT NULL,
  rejected boolean NOT NULL DEFAULT false, PRIMARY KEY (org_id, batch_id, cylinder_id));
CREATE INDEX batch_cylinders_cylinder_idx ON {{schema}}.batch_cylinders(org_id, cylinder_id);

CREATE TABLE {{schema}}.rentals(
  org_id text NOT NULL, id text NOT NULL, cylinder_id text NOT NULL, party_id text NOT NULL,
  order_id text NOT NULL, start_date date NOT NULL, end_date date,
  version integer NOT NULL DEFAULT 1, doc jsonb NOT NULL, PRIMARY KEY (org_id, id));
CREATE UNIQUE INDEX rentals_one_open_uq ON {{schema}}.rentals(org_id, cylinder_id) WHERE end_date IS NULL;
CREATE INDEX rentals_party_open_idx ON {{schema}}.rentals(org_id, party_id) WHERE end_date IS NULL;
CREATE INDEX rentals_party_idx ON {{schema}}.rentals(org_id, party_id, start_date);

CREATE TABLE {{schema}}.invoices(
  org_id text NOT NULL, id text NOT NULL, party_id text NOT NULL, branch_id text NOT NULL,
  type text NOT NULL CHECK (type IN ('gas','rental','credit')),
  status text NOT NULL CHECK (status IN ('issued','partial','paid','credited')),
  number text NOT NULL, issued_at timestamptz NOT NULL, due_date date NOT NULL,
  version integer NOT NULL DEFAULT 1, doc jsonb NOT NULL, PRIMARY KEY (org_id, id));
CREATE UNIQUE INDEX invoices_number_uq ON {{schema}}.invoices(org_id, number);
CREATE INDEX invoices_party_idx ON {{schema}}.invoices(org_id, party_id, status);

CREATE TABLE {{schema}}.receipts(
  org_id text NOT NULL, id text NOT NULL, party_id text NOT NULL, invoice_id text,
  kind text NOT NULL, method text NOT NULL, reference text NOT NULL, at timestamptz NOT NULL,
  doc jsonb NOT NULL, PRIMARY KEY (org_id, id));
CREATE UNIQUE INDEX receipts_reference_uq ON {{schema}}.receipts(org_id, party_id, method, lower(reference)) WHERE method <> 'cash';
CREATE INDEX receipts_party_idx ON {{schema}}.receipts(org_id, party_id, at DESC);

CREATE TABLE {{schema}}.exceptions(
  org_id text NOT NULL, id text NOT NULL, type text NOT NULL,
  status text NOT NULL CHECK (status IN ('open','resolved')),
  branch_id text, entity_id text NOT NULL, at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1, doc jsonb NOT NULL, PRIMARY KEY (org_id, id));
CREATE INDEX exceptions_open_idx ON {{schema}}.exceptions(org_id, status, at DESC);
CREATE INDEX exceptions_entity_idx ON {{schema}}.exceptions(org_id, entity_id);

CREATE TABLE {{schema}}.document_counters(
  org_id text NOT NULL, series text NOT NULL, fiscal_year text NOT NULL, next_value bigint NOT NULL,
  PRIMARY KEY (org_id, series, fiscal_year));

CREATE TABLE {{schema}}.users(
  id text PRIMARY KEY, org_id text NOT NULL, name text NOT NULL, email text NOT NULL UNIQUE,
  role text NOT NULL, branch_ids text NOT NULL, active boolean NOT NULL, password_hash text NOT NULL);
CREATE TABLE {{schema}}.sessions(
  token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES {{schema}}.users(id),
  csrf_token text NOT NULL, expires_at bigint NOT NULL, last_seen_at bigint NOT NULL);
CREATE INDEX sessions_user_idx ON {{schema}}.sessions(user_id);
CREATE TABLE {{schema}}.idempotency(
  org_id text NOT NULL, user_id text NOT NULL, idem_key text NOT NULL, request_hash text NOT NULL,
  result_json text NOT NULL, PRIMARY KEY (org_id, user_id, idem_key));
CREATE TABLE {{schema}}.user_auth_epoch(user_id text PRIMARY KEY REFERENCES {{schema}}.users(id), epoch integer NOT NULL);
CREATE TABLE {{schema}}.login_attempts(key text PRIMARY KEY, count integer NOT NULL, until bigint NOT NULL);
CREATE TABLE {{schema}}.audit_log(
  sequence bigserial PRIMARY KEY, org_id text NOT NULL, id text NOT NULL, at timestamptz NOT NULL,
  actor_id text NOT NULL, actor_name text NOT NULL, action text NOT NULL, entity_id text NOT NULL,
  summary text NOT NULL);
CREATE INDEX audit_org_idx ON {{schema}}.audit_log(org_id, sequence DESC);

CREATE FUNCTION {{schema}}.append_only() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'append only'; END $$;
CREATE TRIGGER movements_no_change BEFORE UPDATE OR DELETE ON {{schema}}.movements
  FOR EACH ROW EXECUTE FUNCTION {{schema}}.append_only();
CREATE TRIGGER movements_no_truncate BEFORE TRUNCATE ON {{schema}}.movements
  FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.append_only();
CREATE TRIGGER audit_no_change BEFORE UPDATE OR DELETE ON {{schema}}.audit_log
  FOR EACH ROW EXECUTE FUNCTION {{schema}}.append_only();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON {{schema}}.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.append_only();
`;

const migration: Migration = { version: 1, name: 'core', sql };
export default migration;
