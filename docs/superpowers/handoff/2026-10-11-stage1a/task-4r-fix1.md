# Task 4R — Fix round 1 (controller rulings + review findings)

Migration 0001 is still unapplied anywhere real: keep rewriting it in place. Every item below is required. Update tests first (RED), then implement (GREEN) on PGlite AND Postgres. Append a fix report to task-4r-report.md.

## C1 — Movements keep recall traceability, fully typed
Only `batch.recall` reads movement snapshots (`m.before?.batchId` on deliveries). Change `movements` to:
- add `batch_id_before text`, `batch_id_after text` (nullable; the batch the cylinder carried before/after this movement), with `FOREIGN KEY (org_id, batch_id_before) REFERENCES batches(org_id,id)` and the same for `batch_id_after` (both `DEFERRABLE INITIALLY DEFERRED`);
- add index `movements_delivery_batch_idx ON movements(org_id, batch_id_before) WHERE action = 'delivery'`.
`movement_changes`: keep, but `before_value`/`after_value` stay text and `field` is constrained:
`CHECK (field IN ('serial','tag','manufacturer','gas','size','owner_party_id','branch_id','custody','custodian_id','condition','contents','test_due','last_test','certificate','batch_id','fill_count','incident_kind','incident_at','incident_notes','written_off_at'))` — scalar fields only; a retag is recorded as `tag` before/after; an incident as the three `incident_*` fields. No arrays, no objects, no JSON-in-text.
Test: a delivery movement row with `batch_id_before='b1'` is found by `WHERE action='delivery' AND batch_id_before='b1'`; inserting a `movement_changes` row with field `'previous_tags'` is rejected (check constraint).

## I1 — Row-level security policies for the runtime role (no BYPASSRLS anywhere)
In `migrate()`'s runtime-role step, for the given role (must NOT be `current_user`: throw `Error('Runtime role must differ from the migrating role')`):
- For every table in the schema that has an `org_id` column (query `information_schema.columns`): `DROP POLICY IF EXISTS runtime_org ON <t>; CREATE POLICY runtime_org ON <t> TO <role> USING (org_id = current_setting('cylvero.org_id', true)) WITH CHECK (org_id = current_setting('cylvero.org_id', true));`
- `orgs`: `CREATE POLICY runtime_org ON orgs TO <role> USING (id = current_setting('cylvero.org_id', true)) WITH CHECK (id = current_setting('cylvero.org_id', true));`
- `users`: sign-in looks a user up by email before the org is known, so: `CREATE POLICY runtime_read ON users FOR SELECT TO <role> USING (true);` and `CREATE POLICY runtime_write ON users FOR ALL TO <role> USING (org_id = current_setting('cylvero.org_id', true)) WITH CHECK (org_id = current_setting('cylvero.org_id', true));` (users has org_id, so exclude it from the generic loop).
- `sessions`, `login_attempts`, `user_auth_epoch` (no org_id): `CREATE POLICY runtime_all ON <t> TO <role> USING (true) WITH CHECK (true);`
- `schema_migrations`: no policy, and revoke ALL from the role.
- Keep the existing revokes: no UPDATE/DELETE on `movements`, `movement_changes`, `audit_log`; never TRUNCATE. Derive the append-only table list from tables that have a trigger calling `append_only` (query `pg_trigger` joined to `pg_proc`), not a hard-coded list.
- Pass `schema` (unquoted) into helpers instead of slicing the quoted identifier.
Test (Postgres, using the admin URL to create role `cylvero_runtime_test` WITH LOGIN NOBYPASSRLS if missing, and `ALTER ROLE ... NOBYPASSRLS` if it exists): on the **core** schema with orgs `o1` and `o2` and one branch each:
- as the runtime role with `SET cylvero.org_id='o1'`: SELECT on branches returns only o1's row; INSERT of an o2 branch is rejected (`/row-level security/`); UPDATE of movements is denied; TRUNCATE of cylinders is denied; INSERT into schema_migrations is denied;
- with `cylvero.org_id` unset: SELECT on branches returns 0 rows;
- `SELECT rolbypassrls FROM pg_roles WHERE rolname='cylvero_runtime_test'` is false.
- `migrate(..., { runtimeRole: <current_user> })` rejects with the message above.

## I2 — No crash when a connection dies mid-transaction
`pg-adapter.ts` `transaction`: right after `pool.connect()`, attach `const onError = (e: Error) => { broken = e; }; client.on('error', onError);`; in `finally` remove the listener and `client.release(broken)` (where `broken` is also set if ROLLBACK fails). Test (Postgres): inside `transaction`, run `SELECT pg_terminate_backend(pg_backend_pid())` via the admin pool on that backend's pid (fetch the pid with `SELECT pg_backend_pid()` inside the work first); the transaction must reject (not crash the process) and a following `db.query('SELECT 1')` must succeed. Give the test pool `connectionTimeoutMillis: 2000` so leaks fail instead of hanging.

## I3 — Org consistency for user-linked rows
`users`: add `UNIQUE (org_id, id)`. `user_branches` and `idempotency`: add `FOREIGN KEY (org_id, user_id) REFERENCES users(org_id, id)`. Also `CHECK (email = lower(email))` on users. Test: a user in o1 linked to an o2 branch is rejected.

## I4 — Demo reset (ruling, no schema change)
History is append-only, so a demo reset will create a **fresh organization** (new org id), seed it, and move the demo users to it in Plan 1B. The old org's rows stay as immutable history. Record this in the spec (section 8, one paragraph "Demo reset").

## I5 — Prove the batch FK is deferred
In the deferred test: inside `db.transaction`, insert the cylinder with a missing `batch_id`, then `SELECT 1 FROM cylinders WHERE id=...` inside the same transaction must return the row; then the transaction (commit) must reject with `/violates foreign key/`. Use `assert` on both.

## I6 + M7 — One source of truth for tag, serial and vehicle
- Drop `cylinders.tag`. The current tag lives only in `cylinder_codes` (`kind='tag'`). Add a **deferred constraint trigger** `cylinders_have_one_tag` (plpgsql, `SET search_path = ''`, `CREATE CONSTRAINT TRIGGER ... AFTER INSERT OR UPDATE ON cylinders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW` plus one `AFTER UPDATE OR DELETE ON cylinder_codes` that checks the affected cylinder) that raises `'cylinder % must have exactly one current tag'` unless exactly one `kind='tag'` row exists for the cylinder.
- Serials: remove `kind='serial'` from `cylinder_codes` (kinds become `'tag','previous_tag','external'`; drop the serial CHECKs). Serial lookups use `cylinders(org_id, serial_key)`: add index `cylinders_serial_lookup_idx ON cylinders(org_id, serial_key)`. `serial_key` is now produced by `normalizeCode` (same rule as scanning), still unique with `manufacturer_key` (which stays `textKey`).
- Drop the `vehicle_slots` table. The cylinder row is the single source of truth for where it is. Add a **deferred constraint trigger** on `order_cylinders` and `pickup_cylinders` (AFTER INSERT OR UPDATE): when `state='on_vehicle'`, the cylinder must have `custody='vehicle'` and `custodian_id` equal to that order/pickup id, else raise `'cylinder % is not on vehicle %'`. Keep the per-table partial unique indexes.
- Custodian integrity: deferred constraint trigger on `cylinders` (AFTER INSERT OR UPDATE OF custody, custodian_id): `plant` → a branch with that id in the same org; `vehicle` → an order or pickup with that id in the same org; `customer` → a party of type ≠ 'supplier'; `supplier` → a party of type 'supplier'. Raise `'cylinder % custodian % is not a valid %'`.
- `orders.driver_id`: make it `text NULL` (no `''` default) with `FOREIGN KEY (driver_id) REFERENCES users(id)`; same for `pickups.driver_id` (NOT NULL, FK users). Plan 1B maps the domain's `''` to NULL.
Tests: second tag row rejected (unique); a cylinder with no tag row fails at commit; deleting a cylinder's only tag fails at commit; an `on_vehicle` order_cylinders row whose cylinder custody is `plant` fails at commit; a cylinder with custody `customer` and a supplier party as custodian fails at commit; a correct full dispatch (cylinder custody vehicle/order id + on_vehicle row in one transaction) commits.

## M1 — Keep list order
- `order_cylinders`: add `event_seq integer` (NULL while on_vehicle; the order in which the cylinder was delivered or unloaded, starting at 1 per order) with `UNIQUE (org_id, order_id, event_seq)`.
- `pickup_cylinders`: same `event_seq` for received/reversed.
- `batch_cylinders`: add `rejected_seq integer` (NULL unless rejected) with `UNIQUE (org_id, batch_id, rejected_seq)` and `CHECK ((rejected_seq IS NULL) = (NOT rejected))`.
- `order_delivery_proof_cylinders` and `batch_recipient_trace`: add `position integer NOT NULL CHECK (position >= 0)`.
- `cylinder_codes`: previous-tag order is `id` order (bigserial, insertion order) — document this in a SQL comment.

## M2 — Snapshots are all-or-nothing
Replace the pair checks with full checks: challan (all 7 columns NULL or all NOT NULL), bill_to (4), issuer (3).

## M3 — Done above (current_user check, schema param, derived append-only list).

## M4 — Tests to add
incident triple check (one field set alone rejected); exception `resolved` without resolution rejected; receipt `reversed_at` without reason rejected; snapshot partial rejected (one per snapshot); settings `mode='x'` and `default_tax_bps=10001` rejected; users `role='x'` rejected; separate TRUNCATE tests per append-only table (truncate `movement_changes` alone; for `movements` use `TRUNCATE ... CASCADE` is NOT allowed — instead assert `TRUNCATE movements, movement_changes` fails with `/append only/` and that each trigger exists in `pg_trigger`); runtime role INSERT into schema_migrations denied (in I1 test).

## M5 — Normalization
`textKey`: fold `\t`, `\r`, `\n` into spaces before collapsing; still reject other control characters. Test: `'Demo\tClinic\n'` → `'demo clinic'`.

## M6 — Spec corrections
Section 4 table and the storage paragraph must list exactly the tables in the final schema (no `vehicle_slots`, no `server/repo/` claim beyond "Plan 1B adds the repository layer", no "stop reason"), include `order_cylinders`, `pickup_cylinders`, `order_delivery_proof_cylinders`, `movement_changes` with its field list, `batch_id_before/after`, and the triggers above.

## Verify
`npx tsx --test tests/db-*.test.ts` (PGlite); with `CTMS_TEST_PG_URL`, `CTMS_TEST_PG_PROBE_URL`, `CTMS_TEST_PG_ADMIN_URL` (values in your original dispatch); `npm run typecheck`; `npm test`; `npm audit`. Commit: `Harden core schema: recall traceability, org row policies, single sources of truth`.
