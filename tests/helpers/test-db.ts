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
