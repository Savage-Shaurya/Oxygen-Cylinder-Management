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
      await Promise.all(dbs.map((db) => db.close()));
    }
  },
);
