import assert from 'node:assert/strict';
import { test } from 'node:test';
import { forEachDb, freshSchema } from './helpers/test-db.js';
import pg from 'pg';
import { pgDb } from '../server/db/pg-adapter.js';
import { assertSchemaName, normalizeCode, textKey } from '../server/db/sql.js';

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
  assert.deepEqual(
    sel.rows.map((r) => [Number(r.id), r.v]),
    [
      [1, 'a'],
      [2, 'b'],
    ],
  );
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

forEachDb('an error thrown after a write propagates and rolls the write back', async (db) => {
  const s = freshSchema();
  await db.exec(`CREATE SCHEMA ${s}; CREATE TABLE ${s}.t(id int PRIMARY KEY);`);
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.query(`INSERT INTO ${s}.t VALUES (1)`);
      throw new Error('stop');
    }),
    /^Error: stop$/,
  );
  assert.equal((await db.query(`SELECT * FROM ${s}.t`)).rowCount, 0);
});

test(
  'failed transactions release their connection back to the pool',
  { skip: process.env.CTMS_TEST_PG_URL ? false : 'set CTMS_TEST_PG_URL' },
  async () => {
    const db = pgDb(new pg.Pool({ connectionString: process.env.CTMS_TEST_PG_URL, max: 1 }));
    try {
      for (let i = 0; i < 5; i++)
        await assert.rejects(
          db.transaction(async () => {
            throw new Error('stop');
          }),
        );
      const started = Date.now();
      await db.query('SELECT 1');
      assert.ok(Date.now() - started < 2000);
    } finally {
      await db.close();
    }
  },
);

test('text keys fold case, width and whitespace', () => {
  assert.equal(textKey(' Demo  Clinic '), 'demo clinic');
  assert.equal(textKey('ＤＥＭＯ'), 'demo');
  assert.throws(() => textKey('   '), /Text is empty/);
  assert.throws(() => textKey('a\u0000b'), /Text contains control characters/);
});
