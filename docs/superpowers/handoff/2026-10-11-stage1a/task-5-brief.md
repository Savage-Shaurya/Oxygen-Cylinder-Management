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
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
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

test('refuses a PGlite folder that is actually an existing database file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cylvero-file-'));
  const file = join(dir, 'legacy.sqlite');
  writeFileSync(file, 'not a folder');
  try {
    await assert.rejects(connectDb({ CTMS_PGLITE_DIR: file }), /must not point at an existing database file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects an unsafe schema name from configuration', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cylvero-schema-'));
  try {
    await assert.rejects(connectDb({ CTMS_PGLITE_DIR: dir, CTMS_DB_SCHEMA: 'Bad;Name' }), /Invalid schema name/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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


> Controller ruling applied to this brief: the legacy-file test uses a temporary file instead of data/client-demo.sqlite (never touch data/), and every test removes its temporary folder.
