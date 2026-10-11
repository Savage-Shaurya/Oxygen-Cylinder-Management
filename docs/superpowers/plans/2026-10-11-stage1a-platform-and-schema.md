# Stage 1A — Platform proof and database tables — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the risky platform pieces (Cloudflare Workers, Hyperdrive, PGlite) and create the new relational Postgres schema, with its migration runner and a database layer that runs the same on real Postgres and on in-process PGlite.

**Architecture:** A small `Db` interface (`server/db/sql.ts`) with two adapters: `pg.Pool` for real Postgres/Hyperdrive and PGlite for zero-install local use. Schema changes are numbered TypeScript modules holding SQL (so they bundle for Cloudflare too), applied by `server/db/migrate.ts` under an advisory lock, then locked down (RLS on, no grants to PUBLIC/API roles). This plan does not change how the running app stores data; Plan 1B switches saving onto these tables.

**Tech Stack:** Node 22, TypeScript, `pg` 8, `@electric-sql/pglite` 0.5.x, `node:test` via `tsx --test`, Wrangler 4 (spike only).

**Spec:** `docs/superpowers/specs/2026-10-11-scalable-foundation-design.md`

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

---

## File Structure

| File | Responsibility |
|---|---|
| `server/db/sql.ts` | `Db` / `Queryable` interfaces, schema-name validation, code normalization helper |
| `server/db/pg-adapter.ts` | `Db` over `pg.Pool` (real Postgres, Hyperdrive) |
| `server/db/pglite-adapter.ts` | `Db` over PGlite (in-process, local) |
| `server/db/migrate.ts` | Migration runner, checksums, advisory lock, lock-down |
| `server/migrations/0001_core.ts` | The Stage 1 core schema |
| `server/migrations/index.ts` | Ordered list of all migrations |
| `server/db/connect.ts` | Chooses Postgres (`DATABASE_URL`) or PGlite (`CTMS_PGLITE_DIR`, default `data/pglite`) |
| `tests/helpers/test-db.ts` | Runs a test against PGlite always, plus real Postgres when `CTMS_TEST_PG_URL` is set |
| `tests/db-adapters.test.ts`, `tests/db-migrate.test.ts`, `tests/db-schema.test.ts`, `tests/db-connect.test.ts` | Tests for the above |
| `docs/superpowers/spikes/2026-10-11-platform-spike.md` | Spike findings (Task 1) |

---

### Task 1: Platform spike — Workers, scrypt, Hyperdrive, PGlite (throwaway code)

Answers four questions before anything is built on them. **All spike code lives in `/private/tmp/claude-501/cf-spike` and is not committed**; only the findings document is.

**Files:**
- Create (throwaway): `/private/tmp/claude-501/cf-spike/{package.json,wrangler.toml,worker.mjs,pglite-check.mjs}`
- Create: `docs/superpowers/spikes/2026-10-11-platform-spike.md`

**Interfaces:**
- Consumes: nothing
- Produces: findings that decide Plan 1D's adapter: `EXPRESS_ON_WORKERS: yes|no`, `SCRYPT_MS_P50`, `HYPERDRIVE_TX_FOR_UPDATE: ok|fails`, `PGLITE_LOCKS: ok|fails`

- [ ] **Step 1: Create the spike project**

```bash
mkdir -p /private/tmp/claude-501/cf-spike && cd /private/tmp/claude-501/cf-spike
cat > package.json <<'EOF'
{ "name": "cf-spike", "private": true, "type": "module",
  "dependencies": { "express": "^5.1.0", "pg": "^8.23.0", "@electric-sql/pglite": "^0.5.8" },
  "devDependencies": { "wrangler": "^4.149.0" } }
EOF
npm install --no-audit --no-fund
```

- [ ] **Step 2: Write the Worker (Express via Cloudflare's Node HTTP server support, scrypt, pg through a Hyperdrive binding)**

```bash
cat > wrangler.toml <<'EOF'
name = "cf-spike"
main = "worker.mjs"
compatibility_date = "2026-10-01"
compatibility_flags = ["nodejs_compat"]
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "00000000000000000000000000000000"
localConnectionString = "postgresql://app_owner@127.0.0.1:55432/cylvero_test"
EOF
cat > worker.mjs <<'EOF'
import { httpServerHandler } from 'cloudflare:node';
import { env } from 'cloudflare:workers';
import express from 'express';
import { scryptSync, randomBytes } from 'node:crypto';
import pg from 'pg';
const app = express();
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/scrypt', (_req, res) => { scryptSync('OxygenDemo!2026', randomBytes(16), 64); res.json({ ok: true }); });
app.get('/pg', async (_req, res) => {
  const client = new pg.Client({ connectionString: env.HYPERDRIVE.connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE IF NOT EXISTS spike(id int primary key) ON COMMIT DROP');
    await client.query('INSERT INTO spike VALUES (1)');
    const r = await client.query('SELECT id FROM spike WHERE id = 1 FOR UPDATE');
    await client.query('COMMIT');
    res.json({ ok: true, locked: r.rowCount });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); res.status(500).json({ error: String(e.message) }); }
  finally { await client.end(); }
});
app.listen(3000);
export default httpServerHandler({ port: 3000 });
EOF
```

- [ ] **Step 3: Start the local Postgres used by all Postgres checks** (the disposable cluster from earlier audits; recreate it if missing)

```bash
S=/private/tmp/claude-501/-Applications-CTMS-Batra/bdd3749c-7b6d-4af3-acd7-94708c2d797e/scratchpad
P=/opt/homebrew/opt/postgresql@16/bin; K=/private/tmp/claude-501/cvpg; mkdir -p $K $S/pg
[ -d $S/pg/data ] || $P/initdb -D $S/pg/data -U superuser --auth=trust >/dev/null
$P/pg_ctl -D $S/pg/data -o "-p 55432 -k $K -c listen_addresses=127.0.0.1" -l $S/pg/log.txt start
$P/psql -h 127.0.0.1 -p 55432 -U superuser -d postgres -c "DO \$\$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_owner') THEN CREATE ROLE app_owner LOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE api_probe LOGIN; GRANT anon, authenticated TO api_probe; END IF; END\$\$;"
$P/psql -h 127.0.0.1 -p 55432 -U superuser -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='cylvero_test'" | grep -q 1 || $P/psql -h 127.0.0.1 -p 55432 -U superuser -d postgres -c "CREATE DATABASE cylvero_test OWNER app_owner"
```
Expected: `server started`, no errors.

- [ ] **Step 4: Run the Worker locally and measure**

```bash
cd /private/tmp/claude-501/cf-spike
(npx wrangler dev --port 8799 > wrangler.log 2>&1 &) ; sleep 12
curl -s http://127.0.0.1:8799/health
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{time_total}\n" http://127.0.0.1:8799/scrypt; done
curl -s http://127.0.0.1:8799/pg
pkill -f "wrangler dev --port 8799"
```
Expected: `/health` → `{"ok":true}`; five scrypt timings (record the median in ms); `/pg` → `{"ok":true,"locked":1}`. If `cloudflare:node`'s `httpServerHandler` is unavailable, record `EXPRESS_ON_WORKERS: no` and the exact error from `wrangler.log`.

- [ ] **Step 5: Check PGlite transactions, row locks and advisory locks**

```bash
cat > pglite-check.mjs <<'EOF'
import { PGlite } from '@electric-sql/pglite';
const db = await PGlite.create();
await db.exec('CREATE TABLE t(id int primary key, v int)');
await db.query('INSERT INTO t VALUES (1, 0)');
const a = db.transaction(async (tx) => { await tx.query('SELECT pg_advisory_xact_lock(42)'); await tx.query('SELECT * FROM t WHERE id=1 FOR UPDATE'); await tx.query('UPDATE t SET v = v + 1 WHERE id=1'); });
const b = db.transaction(async (tx) => { await tx.query('SELECT * FROM t WHERE id=1 FOR UPDATE'); await tx.query('UPDATE t SET v = v + 1 WHERE id=1'); });
await Promise.all([a, b]);
const failed = await db.transaction(async (tx) => { await tx.query('UPDATE t SET v = 99 WHERE id=1'); throw new Error('boom'); }).catch((e) => e.message);
console.log(JSON.stringify({ v: (await db.query('SELECT v FROM t')).rows[0].v, failed }));
await db.close();
EOF
node pglite-check.mjs
```
Expected: `{"v":2,"failed":"boom"}` (both transactions applied serially; the failed one rolled back).

- [ ] **Step 6: Write the findings document**

Create `docs/superpowers/spikes/2026-10-11-platform-spike.md` with exactly these headings, filled with the measured values and any error text:

```markdown
# Platform spike — 11 October 2026

| Question | Result | Evidence |
|---|---|---|
| Express runs on Workers via `cloudflare:node` httpServerHandler | yes / no | /health response or wrangler.log error |
| scrypt (N=16384, 64-byte key) median time per request in `wrangler dev` | <n> ms | five curl timings |
| `pg` through a Hyperdrive binding: BEGIN / SELECT … FOR UPDATE / COMMIT | ok / fails | /pg response |
| PGlite: serialized transactions, FOR UPDATE, advisory locks, rollback | ok / fails | pglite-check output |

## Decisions for Plan 1D
- Adapter: <Express via httpServerHandler | fetch-handler router>
- Password hashing: <keep scrypt | change, and why>
```

- [ ] **Step 7: Commit the findings only**

```bash
cd /Applications/CTMS-Batra
git add docs/superpowers/spikes/2026-10-11-platform-spike.md
git commit -m "Record Cloudflare, Hyperdrive and PGlite platform spike findings"
```

---

### Task 2: Database interface with Postgres and PGlite adapters

**Files:**
- Create: `server/db/sql.ts`, `server/db/pg-adapter.ts`, `server/db/pglite-adapter.ts`, `tests/helpers/test-db.ts`, `tests/db-adapters.test.ts`
- Modify: `package.json` (add `@electric-sql/pglite` dependency)

**Interfaces:**
- Consumes: `pgPoolConfig(options: PgStoreOptions): pg.PoolConfig` from `server/pg-store.ts` (existing export)
- Produces:
  - `interface Queryable { query<T extends Row = Row>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>; exec(script: string): Promise<void> }`
  - `interface Db extends Queryable { readonly kind: 'postgres' | 'pglite'; transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T>; close(): Promise<void> }`
  - `type Row = Record<string, unknown>`
  - `assertSchemaName(name: string): string` (returns the quoted identifier `"name"`)
  - `normalizeCode(code: string): string`
  - `pgDb(pool: pg.Pool): Db`
  - `pgliteDb(dataDir?: string): Promise<Db>`
  - test helper `forEachDb(title: string, body: (db: Db) => Promise<void>): void`

- [ ] **Step 1: Add PGlite**

```bash
cd /Applications/CTMS-Batra && npm install @electric-sql/pglite@^0.5.8 --no-fund
```
Expected: `package.json` dependencies include `"@electric-sql/pglite"`; `npm audit` still reports 0 vulnerabilities.

- [ ] **Step 2: Write the failing tests**

`tests/helpers/test-db.ts`:
```ts
import { test } from 'node:test';
import pg from 'pg';
import { pgDb } from '../../server/db/pg-adapter.js';
import { pgliteDb } from '../../server/db/pglite-adapter.js';
import type { Db } from '../../server/db/sql.js';

/** Runs `body` on an in-memory PGlite database, and also on real Postgres when CTMS_TEST_PG_URL is set. */
export function forEachDb(title: string, body: (db: Db) => Promise<void>) {
  test(`${title} [pglite]`, async () => {
    const db = await pgliteDb();
    try {
      await body(db);
    } finally {
      await db.close();
    }
  });
  const url = process.env.CTMS_TEST_PG_URL;
  test(`${title} [postgres]`, { skip: url ? false : 'set CTMS_TEST_PG_URL' }, async () => {
    const pool = new pg.Pool({ connectionString: url, max: 4 });
    const db = pgDb(pool);
    try {
      await body(db);
    } finally {
      await db.close();
    }
  });
}

let counter = 0;
/** A unique, valid schema name per test so tests never share tables. */
export const freshSchema = (prefix = 't') =>
  `${prefix}_${process.pid}_${Date.now() % 100000}_${++counter}`;
```

`tests/db-adapters.test.ts`:
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { forEachDb, freshSchema } from './helpers/test-db.js';
import { assertSchemaName, normalizeCode } from '../server/db/sql.js';

test('schema names are validated and quoted', () => {
  assert.equal(assertSchemaName('cylvero'), '"cylvero"');
  for (const bad of ['', 'Cylvero', '1abc', 'a-b', 'a"b', 'x'.repeat(42), 'a; drop'])
    assert.throws(() => assertSchemaName(bad), /Invalid schema name/);
});

test('codes normalize case, spaces and look-alike dashes', () => {
  assert.equal(normalizeCode(' ab-12 '), 'AB-12');
  assert.equal(normalizeCode('ab‑12'), 'AB-12');
  assert.equal(normalizeCode('ab – 12'), 'AB-12');
  assert.equal(normalizeCode('a  b'), 'A B');
  assert.throws(() => normalizeCode('   '), /Code is empty/);
  assert.throws(() => normalizeCode('a\u0000b'), /Code contains control characters/);
});

forEachDb('query returns rows and counts', async (db) => {
  const s = freshSchema();
  await db.exec(`CREATE SCHEMA ${s}; CREATE TABLE ${s}.t(id int PRIMARY KEY, v text);`);
  const ins = await db.query(`INSERT INTO ${s}.t VALUES ($1,$2),($3,$4)`, [1, 'a', 2, 'b']);
  assert.equal(ins.rowCount, 2);
  const sel = await db.query<{ id: number; v: string }>(`SELECT id, v FROM ${s}.t ORDER BY id`);
  assert.deepEqual(sel.rows.map((r) => [Number(r.id), r.v]), [[1, 'a'], [2, 'b']]);
  assert.equal(sel.rowCount, 2);
});

forEachDb('a failing transaction leaves no partial rows', async (db) => {
  const s = freshSchema();
  await db.exec(`CREATE SCHEMA ${s}; CREATE TABLE ${s}.t(id int PRIMARY KEY);`);
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.query(`INSERT INTO ${s}.t VALUES (1)`);
      await tx.query(`INSERT INTO ${s}.t VALUES (1)`);
    }),
  );
  assert.equal((await db.query(`SELECT * FROM ${s}.t`)).rowCount, 0);
});

forEachDb('transaction returns the work result and commits', async (db) => {
  const s = freshSchema();
  await db.exec(`CREATE SCHEMA ${s}; CREATE TABLE ${s}.t(id int PRIMARY KEY);`);
  const out = await db.transaction(async (tx) => {
    await tx.query(`INSERT INTO ${s}.t VALUES (7)`);
    await tx.exec(`INSERT INTO ${s}.t VALUES (8); INSERT INTO ${s}.t VALUES (9);`);
    return 'done';
  });
  assert.equal(out, 'done');
  assert.equal((await db.query(`SELECT * FROM ${s}.t`)).rowCount, 3);
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx tsx --test tests/db-adapters.test.ts`
Expected: FAIL — `Cannot find module '../server/db/sql.js'`.

- [ ] **Step 4: Implement**

`server/db/sql.ts`:
```ts
// Storage-neutral database access used by the relational stores. Two adapters implement
// it: real Postgres (pg-adapter.ts) and in-process PGlite (pglite-adapter.ts).
export type Row = Record<string, unknown>;
export interface Queryable {
  query<T extends Row = Row>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
  /** Runs a multi-statement script without parameters (schema migrations only). */
  exec(script: string): Promise<void>;
}
export interface Db extends Queryable {
  readonly kind: 'postgres' | 'pglite';
  /** Runs `work` in one transaction; any thrown error rolls everything back. */
  transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Validates a schema name before it is placed in SQL text, and returns it quoted. */
export function assertSchemaName(name: string): string {
  if (!/^[a-z_][a-z0-9_]{0,40}$/.test(name)) throw new Error('Invalid schema name');
  return `"${name}"`;
}

/** Canonical form of a scanned or typed cylinder code, so look-alike entries collide. */
export function normalizeCode(code: string): string {
  if (/[\u0000-\u001f\u007f]/.test(code)) throw new Error('Code contains control characters');
  const out = code
    .normalize('NFKC')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  if (!out) throw new Error('Code is empty');
  return out;
}
```

`server/db/pg-adapter.ts`:
```ts
import type pg from 'pg';
import type { Db, Queryable, Row } from './sql.js';

const wrap =
  (client: pg.Pool | pg.PoolClient) =>
  async <T extends Row = Row>(text: string, params: unknown[] = []) => {
    const r = await client.query(text, params);
    return { rows: r.rows as T[], rowCount: r.rowCount ?? r.rows.length };
  };

/** Db over a pg pool (direct Postgres or Cloudflare Hyperdrive). */
export function pgDb(pool: pg.Pool): Db {
  return {
    kind: 'postgres',
    query: wrap(pool),
    exec: async (script) => {
      await pool.query(script);
    },
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const tx: Queryable = {
          query: wrap(client),
          exec: async (script) => {
            await client.query(script);
          },
        };
        const out = await work(tx);
        await client.query('COMMIT');
        return out;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
```

`server/db/pglite-adapter.ts`:
```ts
import { PGlite, type Transaction } from '@electric-sql/pglite';
import type { Db, Row } from './sql.js';

const wrap =
  (q: PGlite | Transaction) =>
  async <T extends Row = Row>(text: string, params: unknown[] = []) => {
    const r = await q.query<T>(text, params as never[]);
    return { rows: r.rows, rowCount: r.affectedRows || r.rows.length };
  };

/** Db over in-process PGlite. `dataDir` persists to disk; omit it for an in-memory database. */
export async function pgliteDb(dataDir?: string): Promise<Db> {
  const lite = await PGlite.create(dataDir);
  return {
    kind: 'pglite',
    query: wrap(lite),
    exec: async (script) => {
      await lite.exec(script);
    },
    transaction: (work) =>
      lite.transaction((tx) =>
        work({
          query: wrap(tx),
          exec: async (script) => {
            await tx.exec(script);
          },
        }),
      ),
    close: () => lite.close(),
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx tsx --test tests/db-adapters.test.ts`
Expected: all `[pglite]` tests PASS, `[postgres]` tests SKIP.
Run: `CTMS_TEST_PG_URL=postgresql://app_owner@127.0.0.1:55432/cylvero_test npx tsx --test tests/db-adapters.test.ts`
Expected: all PASS.

- [ ] **Step 6: Confirm nothing else broke**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; previous totals plus the new tests, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json server/db/sql.ts server/db/pg-adapter.ts server/db/pglite-adapter.ts tests/helpers/test-db.ts tests/db-adapters.test.ts
git commit -m "Add storage-neutral database interface with Postgres and PGlite adapters"
```

---

### Task 3: Migration runner with checksums, advisory lock and lock-down

**Files:**
- Create: `server/db/migrate.ts`, `server/migrations/index.ts`, `tests/db-migrate.test.ts`

**Interfaces:**
- Consumes: `Db`, `Queryable`, `assertSchemaName` (Task 2)
- Produces:
  - `interface Migration { version: number; name: string; sql: string }` (SQL uses `{{schema}}` for the quoted schema)
  - `migrate(db: Db, schema: string, migrations?: Migration[]): Promise<number[]>` returns the versions applied in this run
  - `migrationChecksum(sql: string): string`
  - `MIGRATIONS: Migration[]` from `server/migrations/index.ts` (empty until Task 4)

- [ ] **Step 1: Write the failing tests**

`tests/db-migrate.test.ts`:
```ts
import assert from 'node:assert/strict';
import { forEachDb, freshSchema } from './helpers/test-db.js';
import { migrate, type Migration } from '../server/db/migrate.js';

const one: Migration = {
  version: 1,
  name: 'first',
  sql: 'CREATE TABLE {{schema}}.widgets(id int PRIMARY KEY, org_id text NOT NULL);',
};
const two: Migration = {
  version: 2,
  name: 'second',
  sql: 'ALTER TABLE {{schema}}.widgets ADD COLUMN label text;',
};

forEachDb('applies pending migrations once, in order', async (db) => {
  const s = freshSchema();
  assert.deepEqual(await migrate(db, s, [two, one]), [1, 2]);
  assert.deepEqual(await migrate(db, s, [one, two]), []);
  const cols = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='widgets' ORDER BY ordinal_position`,
    [s],
  );
  assert.deepEqual(cols.rows.map((r) => r.column_name), ['id', 'org_id', 'label']);
});

forEachDb('refuses to run when an applied migration was edited', async (db) => {
  const s = freshSchema();
  await migrate(db, s, [one]);
  await assert.rejects(
    migrate(db, s, [{ ...one, sql: one.sql + ' -- edited' }]),
    /Migration 1 \(first\) was changed after it was applied/,
  );
});

forEachDb('a failing migration applies nothing from that run', async (db) => {
  const s = freshSchema();
  const bad: Migration = { version: 2, name: 'bad', sql: 'ALTER TABLE {{schema}}.nope ADD COLUMN x int;' };
  await assert.rejects(migrate(db, s, [one, bad]));
  const tables = await db.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name='widgets'`,
    [s],
  );
  assert.equal(tables.rowCount, 0);
});

forEachDb('every table ends up with row-level security and no PUBLIC grants', async (db) => {
  const s = freshSchema();
  await migrate(db, s, [one]);
  const rls = await db.query<{ relrowsecurity: boolean }>(
    `SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='r'`,
    [s],
  );
  assert.ok(rls.rowCount >= 2);
  for (const row of rls.rows) assert.equal(row.relrowsecurity, true);
  const grants = await db.query(
    `SELECT 1 FROM information_schema.role_table_grants WHERE table_schema=$1 AND grantee IN ('PUBLIC','anon','authenticated')`,
    [s],
  );
  assert.equal(grants.rowCount, 0);
});

forEachDb('rejects an unsafe schema name before touching the database', async (db) => {
  await assert.rejects(migrate(db, 'bad-name', [one]), /Invalid schema name/);
});
```

Add the concurrent-start test (Review Focus 2), real Postgres only:

```ts
import { test } from 'node:test';
import pg from 'pg';
import { pgDb } from '../server/db/pg-adapter.js';

test(
  'two servers starting together apply each migration exactly once',
  { skip: process.env.CTMS_TEST_PG_URL ? false : 'set CTMS_TEST_PG_URL' },
  async () => {
    const s = freshSchema('race');
    const dbs = [1, 2, 3].map(() => pgDb(new pg.Pool({ connectionString: process.env.CTMS_TEST_PG_URL, max: 2 })));
    try {
      const runs = await Promise.all(dbs.map((db) => migrate(db, s, [one, two])));
      assert.deepEqual(runs.flat().sort(), [1, 2]);
    } finally {
      await Promise.all(dbs.map((db) => db.close()));
    }
  },
);
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsx --test tests/db-migrate.test.ts`
Expected: FAIL — `Cannot find module '../server/db/migrate.js'`.

- [ ] **Step 3: Implement**

`server/migrations/index.ts`:
```ts
import type { Migration } from '../db/migrate.js';

/** Every schema migration, in version order. Never edit one after it has been applied. */
export const MIGRATIONS: Migration[] = [];
```

`server/db/migrate.ts`:
```ts
import { createHash } from 'node:crypto';
import { assertSchemaName, type Db, type Queryable } from './sql.js';
import { MIGRATIONS } from '../migrations/index.js';

export interface Migration {
  version: number;
  name: string;
  /** SQL text; `{{schema}}` is replaced by the quoted schema name. */
  sql: string;
}
// Supabase's API-facing roles; other providers do not have them.
const API_ROLES = ['anon', 'authenticated'];

export const migrationChecksum = (sql: string) => createHash('sha256').update(sql).digest('hex');

/** Applies pending migrations once, under a lock, then locks the schema down. */
export async function migrate(db: Db, schema: string, migrations: Migration[] = MIGRATIONS) {
  const s = assertSchemaName(schema);
  return db.transaction(async (tx) => {
    // One migrator at a time, even when several server instances start together.
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`cylvero-migrate:${schema}`]);
    await tx.exec(`CREATE SCHEMA IF NOT EXISTS ${s};
      CREATE TABLE IF NOT EXISTS ${s}.schema_migrations(
        version integer PRIMARY KEY, name text NOT NULL, checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now());`);
    const { rows } = await tx.query<{ version: number; checksum: string }>(
      `SELECT version, checksum FROM ${s}.schema_migrations`,
    );
    const applied = new Map(rows.map((r) => [Number(r.version), r.checksum]));
    const ran: number[] = [];
    for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
      const sum = migrationChecksum(m.sql);
      if (applied.has(m.version)) {
        if (applied.get(m.version) !== sum)
          throw new Error(`Migration ${m.version} (${m.name}) was changed after it was applied`);
        continue;
      }
      await tx.exec(m.sql.replaceAll('{{schema}}', s));
      await tx.query(`INSERT INTO ${s}.schema_migrations(version, name, checksum) VALUES ($1,$2,$3)`, [
        m.version,
        m.name,
        sum,
      ]);
      ran.push(m.version);
    }
    await lockDown(tx, schema, s);
    return ran;
  });
}

/** Row-level security on every table (no policies) and no rights for PUBLIC or API roles. */
async function lockDown(tx: Queryable, schema: string, s: string) {
  const { rows: tables } = await tx.query<{ tablename: string }>(
    'SELECT tablename FROM pg_tables WHERE schemaname = $1',
    [schema],
  );
  for (const { tablename } of tables)
    await tx.exec(`ALTER TABLE ${s}."${tablename.replaceAll('"', '')}" ENABLE ROW LEVEL SECURITY;`);
  const { rows: roles } = await tx.query<{ rolname: string }>(
    'SELECT rolname FROM pg_roles WHERE rolname = ANY($1)',
    [API_ROLES],
  );
  const grantees = ['PUBLIC', ...roles.map((r) => `"${r.rolname}"`)].join(', ');
  await tx.exec(`
    REVOKE ALL ON SCHEMA ${s} FROM ${grantees};
    REVOKE ALL ON ALL TABLES IN SCHEMA ${s} FROM ${grantees};
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${s} FROM ${grantees};
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${s} FROM ${grantees};
    ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} REVOKE ALL ON TABLES FROM ${grantees};
    ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} REVOKE ALL ON SEQUENCES FROM ${grantees};
    ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} REVOKE ALL ON FUNCTIONS FROM ${grantees};`);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx tsx --test tests/db-migrate.test.ts` → all `[pglite]` PASS.
Run with `CTMS_TEST_PG_URL=postgresql://app_owner@127.0.0.1:55432/cylvero_test` → all PASS, including the race test.

- [ ] **Step 5: Commit**

```bash
git add server/db/migrate.ts server/migrations/index.ts tests/db-migrate.test.ts
git commit -m "Add schema migration runner with checksums, advisory lock and lock-down"
```

---

### Task 4: Core schema (migration 0001)

**Files:**
- Create: `server/migrations/0001_core.ts`, `tests/db-schema.test.ts`
- Modify: `server/migrations/index.ts`

**Interfaces:**
- Consumes: `migrate`, `Migration` (Task 3); `forEachDb`, `freshSchema` (Task 2)
- Produces: tables `orgs, settings, branches, parties, cylinders, cylinder_codes, movements, orders, order_cylinders, vehicle_slots, batches, batch_cylinders, pickups, pickup_cylinders, rentals, invoices, receipts, exceptions, document_counters, users, sessions, idempotency, user_auth_epoch, login_attempts, audit_log`, with the columns, constraints and indexes below. Plan 1B relies on these exact table and column names.

- [ ] **Step 1: Write the failing tests**

`tests/db-schema.test.ts`:
```ts
import assert from 'node:assert/strict';
import { forEachDb, freshSchema } from './helpers/test-db.js';
import { migrate } from '../server/db/migrate.js';
import type { Db } from '../server/db/sql.js';

async function setup(db: Db) {
  const s = freshSchema('core');
  await migrate(db, s);
  const q = `"${s}"`;
  await db.exec(`
    INSERT INTO ${q}.orgs(id) VALUES ('o1');
    INSERT INTO ${q}.branches(org_id, id, doc) VALUES ('o1','b1','{}');
    INSERT INTO ${q}.parties(org_id, id, branch_id, type, name, doc) VALUES ('o1','p1','b1','hospital','Demo Clinic','{}');
    INSERT INTO ${q}.cylinders(org_id, id, branch_id, owner_id, custody, custodian_id, condition, contents, gas, size, tag, serial, manufacturer, test_due, doc)
      VALUES ('o1','c1','b1','company','plant','b1','serviceable','empty','Medical oxygen','B','T-1','S-1','Works','2030-01-01','{}'),
             ('o1','c2','b1','company','plant','b1','serviceable','empty','Medical oxygen','B','T-2','S-2','Works','2030-01-01','{}');`);
  return q;
}

forEachDb('all core tables exist', async (db) => {
  const q = await setup(db);
  const s = q.slice(1, -1);
  const { rows } = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema=$1 ORDER BY table_name`,
    [s],
  );
  assert.deepEqual(
    rows.map((r) => r.table_name),
    [
      'audit_log', 'batch_cylinders', 'batches', 'branches', 'cylinder_codes', 'cylinders',
      'document_counters', 'exceptions', 'idempotency', 'invoices', 'login_attempts', 'movements',
      'order_cylinders', 'orders', 'orgs', 'parties', 'pickup_cylinders', 'pickups', 'receipts',
      'rentals', 'schema_migrations', 'sessions', 'settings', 'user_auth_epoch', 'users',
      'vehicle_slots',
    ],
  );
});

forEachDb('a code can belong to only one cylinder per issuer', async (db) => {
  const q = await setup(db);
  await db.query(`INSERT INTO ${q}.cylinder_codes(org_id, cylinder_id, kind, issuer, code, normalized_code) VALUES ('o1','c1','tag','','T-1','T-1')`);
  await assert.rejects(
    db.query(`INSERT INTO ${q}.cylinder_codes(org_id, cylinder_id, kind, issuer, code, normalized_code) VALUES ('o1','c2','previous_tag','','t-1','T-1')`),
    /duplicate key/,
  );
  // Same code from a different issuer is a different identity.
  await db.query(`INSERT INTO ${q}.cylinder_codes(org_id, cylinder_id, kind, issuer, code, normalized_code) VALUES ('o1','c2','external','STATE-HEALTH','T-1','T-1')`);
});

forEachDb('manufacturer and serial are unique ignoring case', async (db) => {
  const q = await setup(db);
  await assert.rejects(
    db.query(`INSERT INTO ${q}.cylinders(org_id, id, branch_id, owner_id, custody, custodian_id, condition, contents, gas, size, tag, serial, manufacturer, test_due, doc)
      VALUES ('o1','c3','b1','company','plant','b1','serviceable','empty','Medical oxygen','B','T-3','s-1','WORKS','2030-01-01','{}')`),
    /duplicate key/,
  );
});

forEachDb('party names are unique per branch ignoring case', async (db) => {
  const q = await setup(db);
  await assert.rejects(
    db.query(`INSERT INTO ${q}.parties(org_id, id, branch_id, type, name, doc) VALUES ('o1','p2','b1','hospital','demo clinic','{}')`),
    /duplicate key/,
  );
});

forEachDb('a cylinder has at most one open rental', async (db) => {
  const q = await setup(db);
  await db.query(`INSERT INTO ${q}.rentals(org_id, id, cylinder_id, party_id, order_id, start_date, doc) VALUES ('o1','r1','c1','p1','x','2026-10-01','{}')`);
  await assert.rejects(
    db.query(`INSERT INTO ${q}.rentals(org_id, id, cylinder_id, party_id, order_id, start_date, doc) VALUES ('o1','r2','c1','p1','y','2026-10-02','{}')`),
    /duplicate key/,
  );
  await db.query(`UPDATE ${q}.rentals SET end_date='2026-10-05' WHERE id='r1'`);
  await db.query(`INSERT INTO ${q}.rentals(org_id, id, cylinder_id, party_id, order_id, start_date, doc) VALUES ('o1','r2','c1','p1','y','2026-10-06','{}')`);
});

forEachDb('a cylinder can be on only one vehicle (order or pickup) at a time', async (db) => {
  const q = await setup(db);
  await db.query(`INSERT INTO ${q}.vehicle_slots(org_id, cylinder_id, source, source_id) VALUES ('o1','c1','order','o-a')`);
  await assert.rejects(
    db.query(`INSERT INTO ${q}.vehicle_slots(org_id, cylinder_id, source, source_id) VALUES ('o1','c1','pickup','pk-1')`),
    /duplicate key/,
  );
  await db.query(`DELETE FROM ${q}.vehicle_slots WHERE cylinder_id='c1'`);
  await db.query(`INSERT INTO ${q}.vehicle_slots(org_id, cylinder_id, source, source_id) VALUES ('o1','c1','pickup','pk-1')`);
});

forEachDb('movements and audit log are append-only', async (db) => {
  const q = await setup(db);
  await db.query(`INSERT INTO ${q}.movements(org_id, id, cylinder_id, action, from_ref, to_ref, at, actor_id, actor_name, reference, notes) VALUES ('o1','m1','c1','fill','plant:b1','plant:b1',now(),'u','U','','')`);
  await db.query(`INSERT INTO ${q}.audit_log(org_id, id, at, actor_id, actor_name, action, entity_id, summary) VALUES ('o1','a1',now(),'u','U','x','c1','s')`);
  for (const table of ['movements', 'audit_log']) {
    await assert.rejects(db.query(`UPDATE ${q}.${table} SET actor_name='Z'`), /append only/);
    await assert.rejects(db.query(`DELETE FROM ${q}.${table}`), /append only/);
    await assert.rejects(db.query(`TRUNCATE ${q}.${table}`), /append only/);
  }
});

forEachDb('non-cash payment references are unique per customer and method; cash may repeat', async (db) => {
  const q = await setup(db);
  const ins = (id: string, method: string, ref: string) =>
    db.query(`INSERT INTO ${q}.receipts(org_id, id, party_id, kind, method, reference, at, doc) VALUES ('o1',$1,'p1','payment',$2,$3,now(),'{}')`, [id, method, ref]);
  await ins('r1', 'upi', 'UTR-9');
  await assert.rejects(ins('r2', 'upi', 'utr-9'), /duplicate key/);
  await ins('r3', 'cash', 'counter');
  await ins('r4', 'cash', 'counter');
});

forEachDb('invoice numbers are unique per organization', async (db) => {
  const q = await setup(db);
  const ins = (id: string) =>
    db.query(`INSERT INTO ${q}.invoices(org_id, id, party_id, branch_id, type, status, number, issued_at, due_date, doc) VALUES ('o1',$1,'p1','b1','gas','issued','GINV-2026-27-00001',now(),'2026-11-01','{}')`, [id]);
  await ins('i1');
  await assert.rejects(ins('i2'), /duplicate key/);
});

forEachDb('a failed multi-row write leaves nothing behind', async (db) => {
  const q = await setup(db);
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.query(`INSERT INTO ${q}.cylinder_codes(org_id, cylinder_id, kind, issuer, code, normalized_code) VALUES ('o1','c1','tag','','T-9','T-9')`);
      await tx.query(`INSERT INTO ${q}.cylinder_codes(org_id, cylinder_id, kind, issuer, code, normalized_code) VALUES ('o1','c2','tag','','T-9','T-9')`);
    }),
  );
  assert.equal((await db.query(`SELECT 1 FROM ${q}.cylinder_codes WHERE normalized_code='T-9'`)).rowCount, 0);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsx --test tests/db-schema.test.ts`
Expected: FAIL — tables missing (`relation ... does not exist`).

- [ ] **Step 3: Write the migration**

`server/migrations/0001_core.ts`:
```ts
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
```

Update `server/migrations/index.ts`:
```ts
import type { Migration } from '../db/migrate.js';
import core from './0001_core.js';

/** Every schema migration, in version order. Never edit one after it has been applied. */
export const MIGRATIONS: Migration[] = [core];
```

- [ ] **Step 4: Run the schema tests**

Run: `npx tsx --test tests/db-schema.test.ts` → all `[pglite]` PASS.
Run: `CTMS_TEST_PG_URL=postgresql://app_owner@127.0.0.1:55432/cylvero_test npx tsx --test tests/db-schema.test.ts tests/db-migrate.test.ts` → all PASS.

- [ ] **Step 5: Prove the Supabase API roles see nothing (real Postgres)**

Add to `tests/db-schema.test.ts`:
```ts
import { test } from 'node:test';
import pg from 'pg';
import { pgDb } from '../server/db/pg-adapter.js';

test(
  'API roles cannot read or write any core table',
  { skip: process.env.CTMS_TEST_PG_URL && process.env.CTMS_TEST_PG_PROBE_URL ? false : 'set CTMS_TEST_PG_URL and CTMS_TEST_PG_PROBE_URL' },
  async () => {
    const owner = pgDb(new pg.Pool({ connectionString: process.env.CTMS_TEST_PG_URL }));
    const s = freshSchema('probe');
    try {
      await migrate(owner, s);
      const tables = (await owner.query<{ tablename: string }>('SELECT tablename FROM pg_tables WHERE schemaname=$1', [s])).rows;
      const probe = new pg.Client({ connectionString: process.env.CTMS_TEST_PG_PROBE_URL });
      await probe.connect();
      try {
        for (const role of ['anon', 'authenticated']) {
          await probe.query(`SET ROLE ${role}`);
          for (const { tablename } of tables)
            await assert.rejects(probe.query(`SELECT 1 FROM "${s}"."${tablename}" LIMIT 1`), /permission denied/);
          await probe.query('RESET ROLE');
        }
      } finally {
        await probe.end();
      }
    } finally {
      await owner.close();
    }
  },
);
```
Run: `CTMS_TEST_PG_URL=postgresql://app_owner@127.0.0.1:55432/cylvero_test CTMS_TEST_PG_PROBE_URL=postgresql://api_probe@127.0.0.1:55432/cylvero_test npx tsx --test tests/db-schema.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add server/migrations/0001_core.ts server/migrations/index.ts tests/db-schema.test.ts
git commit -m "Add Stage 1 core relational schema with database-enforced invariants"
```

---

### Task 5: Connection chooser for local PGlite and hosted Postgres

**Files:**
- Create: `server/db/connect.ts`, `tests/db-connect.test.ts`
- Modify: `package.json` (add `test:db` script), `README.md` (one paragraph under "Run locally")

**Interfaces:**
- Consumes: `pgDb`, `pgliteDb`, `migrate`, `pgPoolConfig` (existing in `server/pg-store.ts`)
- Produces: `connectDb(env?: Record<string, string | undefined>): Promise<{ db: Db; schema: string }>` which connects, applies migrations and returns the schema in use (`CTMS_DB_SCHEMA`, default `cylvero`)

- [ ] **Step 1: Write the failing test**

`tests/db-connect.test.ts`:
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectDb } from '../server/db/connect.js';

test('without DATABASE_URL a persistent local PGlite database is used and migrated', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cylvero-pglite-'));
  try {
    const first = await connectDb({ CTMS_PGLITE_DIR: dir });
    assert.equal(first.db.kind, 'pglite');
    assert.equal(first.schema, 'cylvero');
    await first.db.query(`INSERT INTO "cylvero".orgs(id) VALUES ('o1')`);
    await first.db.close();
    assert.ok(existsSync(dir));
    const second = await connectDb({ CTMS_PGLITE_DIR: dir });
    assert.equal((await second.db.query(`SELECT id FROM "cylvero".orgs`)).rowCount, 1);
    await second.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses a PGlite folder inside the legacy data files', async () => {
  await assert.rejects(connectDb({ CTMS_PGLITE_DIR: 'data/client-demo.sqlite' }), /must not point at an existing database file/);
});

test('rejects an unsafe schema name from configuration', async () => {
  await assert.rejects(connectDb({ CTMS_PGLITE_DIR: mkdtempSync(join(tmpdir(), 'x-')), CTMS_DB_SCHEMA: 'Bad;Name' }), /Invalid schema name/);
});

test(
  'with DATABASE_URL real Postgres is used',
  { skip: process.env.CTMS_TEST_PG_URL ? false : 'set CTMS_TEST_PG_URL' },
  async () => {
    const { db, schema } = await connectDb({ DATABASE_URL: process.env.CTMS_TEST_PG_URL, DATABASE_SSL: 'disable', CTMS_DB_SCHEMA: `conn_${process.pid}` });
    try {
      assert.equal(db.kind, 'postgres');
      assert.equal(schema, `conn_${process.pid}`);
    } finally {
      await db.query(`DROP SCHEMA "${schema}" CASCADE`);
      await db.close();
    }
  },
);
```

- [ ] **Step 2: Run to see it fail**

Run: `npx tsx --test tests/db-connect.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`server/db/connect.ts`:
```ts
import { existsSync, statSync } from 'node:fs';
import pg from 'pg';
import { pgDb } from './pg-adapter.js';
import { pgliteDb } from './pglite-adapter.js';
import { migrate } from './migrate.js';
import { assertSchemaName, type Db } from './sql.js';
import { pgPoolConfig } from '../pg-store.js';

type Env = Record<string, string | undefined>;

/**
 * Hosted: DATABASE_URL (Postgres or Cloudflare Hyperdrive). Local: PGlite in CTMS_PGLITE_DIR
 * (default data/pglite), so the app runs with no database install. Migrations are applied.
 */
export async function connectDb(env: Env = process.env): Promise<{ db: Db; schema: string }> {
  const schema = env.CTMS_DB_SCHEMA ?? 'cylvero';
  assertSchemaName(schema);
  let db: Db;
  if (env.DATABASE_URL) {
    db = pgDb(
      new pg.Pool(
        pgPoolConfig({
          connectionString: env.DATABASE_URL,
          demoMode: true,
          caCert: env.DATABASE_CA_CERT?.replaceAll('\\n', '\n') || undefined,
          ssl: env.DATABASE_SSL !== 'disable',
          poolMax: Number(env.PG_POOL_MAX ?? 5),
        }),
      ),
    );
  } else {
    const dir = env.CTMS_PGLITE_DIR ?? 'data/pglite';
    if (existsSync(dir) && statSync(dir).isFile())
      throw new Error('CTMS_PGLITE_DIR must not point at an existing database file');
    db = await pgliteDb(dir);
  }
  try {
    await migrate(db, schema);
  } catch (error) {
    await db.close();
    throw error;
  }
  return { db, schema };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx tsx --test tests/db-connect.test.ts` → PASS (Postgres case skipped).
Run with `CTMS_TEST_PG_URL=postgresql://app_owner@127.0.0.1:55432/cylvero_test` → all PASS.

- [ ] **Step 5: Add the script and README note**

In `package.json` `scripts` add:
```json
"test:db": "tsx --test tests/db-*.test.ts"
```
In `README.md`, under "Run locally", add:
```markdown
**New storage (in progress, Stage 1).** The relational schema lives in `server/migrations/` and is applied automatically. Without `DATABASE_URL`, a local Postgres (PGlite) is created in `data/pglite/` — nothing to install. Run its tests with `npm run test:db`; add `CTMS_TEST_PG_URL=postgresql://…` to also run them on a real Postgres.
```

- [ ] **Step 6: Full verification**

Run: `npm run typecheck && npm test && npm run test:db && npm run bundle:api -- --check && npm audit`
Expected: typecheck clean; `npm test` 0 failures; `test:db` all PASS on PGlite; bundle up to date; 0 vulnerabilities.
Run: `CTMS_TEST_PG_URL=postgresql://app_owner@127.0.0.1:55432/cylvero_test CTMS_TEST_PG_PROBE_URL=postgresql://api_probe@127.0.0.1:55432/cylvero_test npm run test:db`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add server/db/connect.ts tests/db-connect.test.ts package.json README.md
git commit -m "Choose local PGlite or hosted Postgres and apply migrations on connect"
```

---

## Plan 1A done when

- Spike findings are committed and answer all four questions.
- `npm run test:db` passes on PGlite and on real Postgres (including API-role denial and the concurrent-migration race).
- `npm test`, `npm run typecheck`, `npm run bundle:api -- --check` and `npm audit` are unchanged and green.
- The running app still uses the existing storage (no behaviour change for users yet).
