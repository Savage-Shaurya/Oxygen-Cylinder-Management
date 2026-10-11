# Task 4R report

## Steps done
1 adapter: ROLLBACK failure evicts the client (`release(err)`), `pool.on('error')` registered once. 2 `textKey` added. 3 `0001_core.ts` rewritten verbatim from the brief (32 tables, no json/jsonb). 4 duplicate-version check and quote-doubling of table names. 5 `runtimeRole` option (grants; unknown role throws). 6 test helper drops recorded schemas after each [postgres] test; adapter tests added. 7 migrate tests added. 8 schema tests rewritten plus every new case. 9 spike and spec docs updated.

## RED (before implementation)
`npx tsx --test tests/db-*.test.ts` against old code: `# tests 56 / # pass 5 / # fail 22 / # skipped 29` (textKey import missing, `migrate` options ignored, old `doc` schema vs typed tests).

## GREEN
PGlite: `# tests 67 / # pass 33 / # fail 0 / # skipped 34`
Postgres (CTMS_TEST_PG_URL, PROBE, ADMIN set): `# tests 67 / # pass 67 / # fail 0 / # skipped 0`; zero test schemas left behind afterwards.
`npm run typecheck` clean; `npm test` (no PG env): 326 tests, 316 pass, 0 fail, 10 skipped; `npm audit`: found 0 vulnerabilities.

## Deviations / concerns
- Tables have RLS enabled with no policies, so a non-owner runtime role is denied INSERT ("new row violates row-level security policy") unless it has BYPASSRLS. The test creates/alters `cylvero_runtime_test` with BYPASSRLS. Production runtime role needs BYPASSRLS (or the app connects as owner); decide in a later task.
- Append-only TRUNCATE test for `movements` truncates it together with `movement_changes`: a lone TRUNCATE of a table referenced by an FK fails with an FK error before the append-only trigger runs (still rejected, different message). Same on PGlite and Postgres.
- `grantRuntime` revokes UPDATE/DELETE on movements/movement_changes/audit_log only when those tables exist (so the minimal test migration works); schema_migrations revokes are unconditional.
- The spec's earlier uncommitted "Storage detail" edit was kept and corrected (it named a non-existent `batch_rejections` table and `server/repo/`).
- PGlite accepted every statement unchanged.

## Files
server/db/sql.ts, pg-adapter.ts, migrate.ts; server/migrations/0001_core.ts; tests/helpers/test-db.ts, tests/db-adapters.test.ts, db-migrate.test.ts, db-schema.test.ts; docs spike and spec.
