import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { forEachDb, freshSchema } from './helpers/test-db.js';
import { migrate, type Migration } from '../server/db/migrate.js';
import { pgDb } from '../server/db/pg-adapter.js';

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
  assert.deepEqual(
    cols.rows.map((r) => r.column_name),
    ['id', 'org_id', 'label'],
  );
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
  const bad: Migration = {
    version: 2,
    name: 'bad',
    sql: 'ALTER TABLE {{schema}}.nope ADD COLUMN x int;',
  };
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

test(
  'two servers starting together apply each migration exactly once',
  { skip: process.env.CTMS_TEST_PG_URL ? false : 'set CTMS_TEST_PG_URL' },
  async () => {
    const s = freshSchema('race');
    const dbs = [1, 2, 3].map(() =>
      pgDb(new pg.Pool({ connectionString: process.env.CTMS_TEST_PG_URL, max: 2 })),
    );
    try {
      const runs = await Promise.all(dbs.map((db) => migrate(db, s, [one, two])));
      assert.deepEqual(runs.flat().sort(), [1, 2]);
    } finally {
      await dbs[0].exec(`DROP SCHEMA IF EXISTS "${s}" CASCADE`);
      await Promise.all(dbs.map((db) => db.close()));
    }
  },
);

forEachDb('duplicate migration versions are rejected before anything is created', async (db) => {
  const s = freshSchema();
  await assert.rejects(
    migrate(db, s, [one, { ...two, version: 1 }]),
    /Duplicate migration version 1/,
  );
  const tables = await db.query(`SELECT 1 FROM information_schema.tables WHERE table_schema=$1`, [
    s,
  ]);
  assert.equal(tables.rowCount, 0);
});

forEachDb('an unknown runtime role is rejected', async (db) => {
  await assert.rejects(
    migrate(db, freshSchema(), [one], { runtimeRole: 'nope_role' }),
    /Runtime role nope_role does not exist/,
  );
  await assert.rejects(
    migrate(db, freshSchema(), [one], { runtimeRole: 'Bad-Role' }),
    /Invalid role name/,
  );
});

test(
  'the runtime role gets least privilege',
  {
    skip:
      process.env.CTMS_TEST_PG_URL && process.env.CTMS_TEST_PG_ADMIN_URL
        ? false
        : 'set CTMS_TEST_PG_URL and CTMS_TEST_PG_ADMIN_URL',
  },
  async () => {
    const role = 'cylvero_runtime_test';
    const admin = new pg.Client({ connectionString: process.env.CTMS_TEST_PG_ADMIN_URL });
    await admin.connect();
    const owner = pgDb(new pg.Pool({ connectionString: process.env.CTMS_TEST_PG_URL }));
    const s = freshSchema('rt');
    try {
      const exists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role]);
      if (!exists.rowCount) await admin.query(`CREATE ROLE ${role} NOLOGIN`);
      // The runtime role bypasses row-level security (tables have RLS and no policies).
      await admin.query(`ALTER ROLE ${role} BYPASSRLS`);
      await migrate(owner, s, [one], { runtimeRole: role });
      await admin.query(`SET ROLE ${role}`);
      await admin.query(`INSERT INTO "${s}".widgets(id, org_id) VALUES (1,'o')`);
      await assert.rejects(
        admin.query(`UPDATE "${s}".schema_migrations SET name='x'`),
        /permission denied/,
      );
      await assert.rejects(admin.query(`TRUNCATE "${s}".widgets`), /permission denied/);
      await assert.rejects(admin.query(`CREATE TABLE "${s}".nope(id int)`), /permission denied/);
    } finally {
      await admin.query('RESET ROLE').catch(() => undefined);
      await admin.end();
      await owner.exec(`DROP SCHEMA IF EXISTS "${s}" CASCADE`);
      await owner.close();
    }
  },
);
