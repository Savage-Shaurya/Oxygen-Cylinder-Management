# SDD ledger — plan: docs/superpowers/plans/2026-10-11-stage1a-platform-and-schema.md
Spec: docs/superpowers/specs/2026-10-11-scalable-foundation-design.md
Branch: stage1/foundation (from main 9e78394)

## Pre-flight scan
| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1 spike | findings doc; no code interfaces | self-consistent; uses scratch Postgres on 127.0.0.1:55432 |
| T2 → T3 | Db.transaction, Queryable.exec, assertSchemaName | consistent (exec present on tx) |
| T2 → T4/T5 | forEachDb, freshSchema helpers | consistent |
| T3 → T4 | Migration {version,name,sql}, `{{schema}}`, MIGRATIONS in server/migrations/index.ts | consistent; T4 rewrites index.ts |
| T4 tests vs T4 SQL | table list incl. vehicle_slots; FK order orgs→branches→parties/cylinders→codes | consistent; alphabetical order holds under C and en_US collation |
| T3 → T5 | migrate(db, schema) | consistent |
| existing pg-store → T5 | pgPoolConfig(PgStoreOptions) requires connectionString, demoMode; ssl=false only for local hosts | consistent (tests use 127.0.0.1) |
| T5 self | test 'refuses a PGlite folder inside the legacy data files' points at data/client-demo.sqlite | CONFLICT with Global Constraint (never touch data/ files) and non-portable (on a machine without that file PGlite would create a folder there) |

Ruling: T5 legacy-file test uses a temp file created by the test (mkdtemp + writeFileSync) instead of data/client-demo.sqlite — keeps the guard tested without reading data/ and works on every machine — cost if wrong: none (same code path).
Ruling: T5 'unsafe schema' test must clean up its temp dir — hygiene — cost if wrong: stray temp folders.
Ruling: Work happens on branch stage1/foundation in /Applications/CTMS-Batra (not a separate worktree) — keeps data/, node_modules and the local Postgres setup shared; main stays untouched until review — cost if wrong: branch switch affects the user's working folder while work runs.
Task 1: dispatched (base 826ddd9)
Task 1: review — spec ❌ (extra Notes heading; /health body only in report), 2 Important (Hyperdrive row overstates: local passthrough only; PGlite row overstates: contention not exercised)
Ruling: keep the extra "## Notes" section in the spike doc — it records the password deviation and limits, which the spec values over template purity — cost if wrong: one extra heading.
Task 1: minor (deferred → Plan 1D): scrypt 26 ms wall time exceeds Workers free-plan CPU (~10 ms); paid plan required; doc should state tier assumption.
Task 1: minor (deferred): Date.now() side-fact unbacked in doc.
Task 1: fix round 1/5 (2 addressed, 0 open; commits 2cc513e..873a44f)
Task 1: minor (deferred): "~10 ms" free-plan CPU figure is from Cloudflare docs, not measured — cite in Plan 1D.
Task 1: complete (commits 826ddd9..873a44f, review clean after 1 fix round)
Task 2: dispatched (base 873a44f)
Task 2: review clean (spec ✅, approved)
Task 2: minor (deferred): pgDb should release(err) when ROLLBACK fails (evict broken connection)
Task 2: minor (deferred): pgDb pool has no on('error') handler (idle-client error could crash process) — must fix before production use
Task 2: minor (deferred): rollback test only covers SQL constraint failure; add JS-throw + pool-release test
Task 2: minor (deferred): forEachDb never drops per-test schemas on real Postgres
Task 2: minor (deferred): package-lock peer-flag churn (no version drift)
Task 2: complete (commits 873a44f..c6f2913, review clean)
Task 3: dispatched (base c6f2913)
Task 3: review clean (spec ✅, approved)
Task 3: minor (deferred): table-name quoting strips '"' instead of doubling it (migrate.ts:75)
Task 3: minor (deferred): duplicate migration versions in the input array not detected (safe: PK rollback)
Task 3: complete (commits c6f2913..427b11f, review clean)
Task 4: dispatched (base 427b11f)
Ruling (product owner directive, 11 Oct): NO jsonb `doc` columns — fully typed relational columns plus child tables for every array (invoice_lines, order_delivery_proofs, batch rejected members, recall recipient trace, previous tags via cylinder_codes); a repository/mapping layer translates rows <-> domain objects; domain rules stay. Migration 0001 is rewritten in place (never applied to any real database). — why: owner requires a proper scalable relational design with no JSON shortcuts — cost if wrong: more mapping code in Plan 1B.
Ruling (product owner directive): no deferred minors — every minor finding is fixed in a dedicated task before Plan 1A closes. — why: owner directive "no low-risk leftovers" — cost: extra fix task.
Task 4: review — Needs fixes (4 Important: serial/tag code namespace clash; receipt reference index per-party vs today's org-wide rule; missing per-table in-transit unique indexes; missing composite FKs) + minors (indexes, receipts number/checks, codes PK, collation, probe write check, owner-role triggers)
Ruling: Task 4 findings + directive (no JSON, no deferred minors) are resolved by new Task 4R (brief task-4r-brief.md) rewriting 0001 in place — 0001 never applied to a real DB — cost if wrong: none (no deployed data).
Ruling: receipts reference uniqueness = today's code rule: org-wide per method, cash included (receipts_reference_uq(org_id, method, reference_key)); shared/commands.md wording is stale and is corrected in Plan 1B — cost if wrong: cash slips with repeated references rejected (same as today).
Ruling: keep text ids carried over from today's data (not random UUIDs); branches unique by name (no branch code exists in the domain) — spec updated — cost if wrong: none functional.
Ruling: case-insensitive uniqueness uses app-computed *_key columns via textKey() so PGlite (C locale) and hosted Postgres behave identically — cost if wrong: keys must be written on every insert/update (Plan 1B repository).
Ruling: append-only bypass by table owner addressed now with a least-privilege runtime role option in migrate() (no UPDATE/DELETE/TRUNCATE on history tables) — the app switches to it in Plan 1D — cost if wrong: hosting must create the role.
Ruling: package-lock peer-flag churn from Task 2 is npm metadata with no version drift; accepted — cost if wrong: noisy diff only.
Task 4R: dispatched (base a15e5ff)
Task 4R: review (opus) — Needs fixes: C1 recall traceability lost in movement_changes; I1 RLS blocks runtime role (BYPASSRLS used in test); I2 crash on mid-transaction connection error; I3 user_branches/idempotency org not tied to user; I4 demo reset vs append-only; I5 deferred-FK test weak; I6 tag/serial dual records; M1-M7 (ordering, snapshot all-or-nothing, migrate details, test gaps, textKey tabs, spec errors, vehicle_slots dual truth)
Ruling: C1 — movements get typed batch_id_before/after (+ delivery index); movement_changes field limited to scalar cylinder columns — only recall consumes snapshots (grep: domain.ts:1466) — cost if wrong: any future feature needing other historic fields must add a typed column.
Ruling: I1 — per-org RLS policies for the runtime role via current_setting('cylvero.org_id'); users readable for sign-in, writable only in-org; no BYPASSRLS anywhere — cost if wrong: app must SET LOCAL cylvero.org_id in every transaction (Plan 1B/1D).
Ruling: I4 — demo reset creates a fresh org and moves demo users; history stays immutable — cost if wrong: old demo orgs accumulate (small).
Ruling: I6/M7 — drop cylinders.tag (tag only in cylinder_codes, deferred trigger requires exactly one); serial lookups via cylinders(serial_key) with normalizeCode; drop vehicle_slots (cylinder row is the source of truth, deferred triggers keep order/pickup rows consistent); custodian integrity trigger; driver_id FKs to users — cost if wrong: more trigger logic to maintain.
Task 4R: fix round 1 dispatched (brief task-4r-fix1.md)
Task 4R: fix round 1 PAUSED before any edits (agent stopped; no uncommitted changes) — resume by dispatching task-4r-fix1.md
