## Global Constraints

- Postgres must stay provider-neutral: only standard Postgres SQL and the standard `pg` driver; no Supabase-specific features.
- Every business table: private schema, `org_id` column, row-level security enabled with no policies, nothing granted to `PUBLIC`, `anon` or `authenticated`.
- `movements` and `audit_log` are append-only: UPDATE, DELETE and TRUNCATE must fail.
- One code (`issuer`, normalized code) maps to exactly one cylinder; one open rental per cylinder; one in-transit order per cylinder; manufacturer + serial unique per org.
- Money is integer paise; calendar dates are `date`; instants are `timestamptz`.
- Never read, modify, copy or migrate anything under `data/` except the new `data/pglite/` folder; never touch `data/client-demo.sqlite`.
- Never commit secrets; `third-party-skills/` and `.claude/` stay ignored.
- Schema names must match `^[a-z_][a-z0-9_]{0,40}$` before being placed in SQL.
- Existing suites keep passing: `npm test` (currently 248 tests, 242 pass, 6 skip), `npm run typecheck`, `npm run bundle:api -- --check`.

## Review Focus

1. A migration edited after it was applied: the runner must refuse to start (checksum mismatch), not silently skip it.
2. Two processes starting at once (two Workers instances or two Node servers): migrations must apply exactly once (advisory lock), never half-applied.
3. Code normalization: `" ab-12 "`, `"AB-12"` and `"ab‑12"` (non-breaking hyphen) typed or scanned must collide as the same code, or duplicates slip in.
4. Case-variant duplicates: `"Demo Clinic"` vs `"demo clinic"` in the same branch, and serials differing only in case, must be rejected by the database itself.
5. A failure in the middle of a transaction (e.g. the second insert violates a constraint) must leave no partial rows on both PGlite and real Postgres.

