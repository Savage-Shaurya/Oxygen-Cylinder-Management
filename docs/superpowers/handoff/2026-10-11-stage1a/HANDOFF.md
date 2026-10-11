# Handoff — Stage 1A paused (11 October 2026)

## Where things stand

**Goal:** rebuild Cylvero's storage for 50,000+ cylinders on plain Postgres (provider-neutral), hosted on Cloudflare Workers + Hyperdrive. Fully typed relational tables, **no JSON columns, no deferred minor issues** (product-owner directives).

- **Spec:** `docs/superpowers/specs/2026-10-11-scalable-foundation-design.md`
- **Plan (Stage 1A):** `docs/superpowers/plans/2026-10-11-stage1a-platform-and-schema.md`
- **Branch:** `stage1/foundation`, pushed to GitHub. `main` is untouched by this work.
- **Ledger:** `ledger.md` in this folder. It holds every decision ("Ruling:") and every task's status. Read it first.

| Task | Status |
|---|---|
| 1. Platform spike (Workers, scrypt, Hyperdrive, PGlite) | ✅ complete (`docs/superpowers/spikes/2026-10-11-platform-spike.md`) |
| 2. `Db` interface + Postgres/PGlite adapters | ✅ complete |
| 3. Migration runner (checksums, advisory lock, lock-down) | ✅ complete |
| 4. Core schema (first version, with JSON `doc` columns) | superseded by 4R |
| 4R. Fully typed schema + all review fixes | ⏸ commit `540eee8` done; **review found 1 Critical + 6 Important**; fix round 1 written but **not started** |
| 5. Connection chooser (local PGlite / hosted Postgres) | ⏳ not started (brief: `task-5-brief.md`, ruling already applied) |
| Final whole-branch review | ⏳ |

## Resume in 7 steps

1. **Get the code:**
   ```bash
   git fetch origin && git checkout stage1/foundation && npm ci
   ```
2. **Start a local test Postgres** (any Postgres 15+). Create the roles that mimic Supabase:
   ```sql
   CREATE ROLE app_owner LOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
   CREATE ROLE api_probe LOGIN; GRANT anon, authenticated TO api_probe;
   CREATE DATABASE cylvero_test OWNER app_owner;
   ```
   Test URLs (adjust host/port):
   - `CTMS_TEST_PG_URL=postgresql://app_owner@127.0.0.1:5432/cylvero_test`
   - `CTMS_TEST_PG_PROBE_URL=postgresql://api_probe@127.0.0.1:5432/cylvero_test`
   - `CTMS_TEST_PG_ADMIN_URL=postgresql://<superuser>@127.0.0.1:5432/cylvero_test`

   The earlier setup used trust authentication on port 55432.
3. **Check the baseline:**
   - `npx tsx --test tests/db-*.test.ts` passes on PGlite.
   - With the three URLs set, all 67 db tests pass.
   - `npm test`, `npm run typecheck` and `npm audit` are green.
4. **Continue Task 4R, fix round 1:** give an implementer agent `task-4r-fix1.md` (complete instructions), `task-4r-brief.md` and `task-4r-report.md` (append the fix report there). Rules:
   - Tests first, then code, on both PGlite and Postgres.
   - Never use BYPASSRLS.
   - Never touch `data/`.
   - Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
5. **Scoped re-review** of the fix diff against each finding in `task-4r-fix1.md` (C1, I1–I6, M1–M7). Use the most capable model, because this schema is the foundation. Repeat fix and re-review until every finding is addressed.
6. **Task 5** from `task-5-brief.md`, then review it.
7. **Final whole-branch review** of `stage1/foundation`, using the most capable model. Then write **Plan 1B (saving: repository layer, per-action loaders, row locks, `SET LOCAL cylvero.org_id`, demo reset = fresh org)** from the spec.

## Key decisions already made (details in the ledger)

- **Storage:** Postgres everywhere: PGlite (in-process) locally, any managed Postgres via `DATABASE_URL` / Hyperdrive in production.
- **No JSON:** every field is a typed column; lists are child tables; movement history is typed (`batch_id_before`/`after`, scalar-only `movement_changes`).
- **Uniqueness keys:** computed in the app (`textKey`, `normalizeCode`) so local and hosted databases agree.
- **Payment references:** unique per method across the whole company, cash included (today's rule).
- **Running app login:** a least-privilege runtime role with per-organization row-level security (`current_setting('cylvero.org_id')`), and no ability to edit or delete history.
- **Demo reset:** creates a fresh organization; old history stays immutable.
- **Single sources of truth:** the tag lives only in `cylinder_codes`; the cylinder row is the truth for vehicle custody; deferred triggers enforce consistency.

## Already established before this stage
- The GitHub repo is `Savage-Shaurya/Oxygen-Cylinder-Management`. Commits are authored as `ShAuRyA-Noodle <paneermomos10@gmail.com>`.
- Third-party skill repos were cloned locally into `third-party-skills/` and installed as project skills in `.claude/skills/`. Both folders are git-ignored, so on a new laptop clone or install the skills again if wanted.
- Later stages (from the spec): Stage 2 outside-code identity, Stage 3 lifeline/holdings/transfers, Stage 4 field app + load and security proof.
