import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { forEachDb, freshSchema } from './helpers/test-db.js';
import { migrate } from '../server/db/migrate.js';
import { pgDb } from '../server/db/pg-adapter.js';
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
      'audit_log',
      'batch_cylinders',
      'batches',
      'branches',
      'cylinder_codes',
      'cylinders',
      'document_counters',
      'exceptions',
      'idempotency',
      'invoices',
      'login_attempts',
      'movements',
      'order_cylinders',
      'orders',
      'orgs',
      'parties',
      'pickup_cylinders',
      'pickups',
      'receipts',
      'rentals',
      'schema_migrations',
      'sessions',
      'settings',
      'user_auth_epoch',
      'users',
      'vehicle_slots',
    ],
  );
});

forEachDb('a code can belong to only one cylinder per issuer', async (db) => {
  const q = await setup(db);
  await db.query(
    `INSERT INTO ${q}.cylinder_codes(org_id, cylinder_id, kind, issuer, code, normalized_code) VALUES ('o1','c1','tag','','T-1','T-1')`,
  );
  await assert.rejects(
    db.query(
      `INSERT INTO ${q}.cylinder_codes(org_id, cylinder_id, kind, issuer, code, normalized_code) VALUES ('o1','c2','previous_tag','','t-1','T-1')`,
    ),
    /duplicate key/,
  );
  // Same code from a different issuer is a different identity.
  await db.query(
    `INSERT INTO ${q}.cylinder_codes(org_id, cylinder_id, kind, issuer, code, normalized_code) VALUES ('o1','c2','external','STATE-HEALTH','T-1','T-1')`,
  );
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
    db.query(
      `INSERT INTO ${q}.parties(org_id, id, branch_id, type, name, doc) VALUES ('o1','p2','b1','hospital','demo clinic','{}')`,
    ),
    /duplicate key/,
  );
});

forEachDb('a cylinder has at most one open rental', async (db) => {
  const q = await setup(db);
  await db.query(
    `INSERT INTO ${q}.rentals(org_id, id, cylinder_id, party_id, order_id, start_date, doc) VALUES ('o1','r1','c1','p1','x','2026-10-01','{}')`,
  );
  await assert.rejects(
    db.query(
      `INSERT INTO ${q}.rentals(org_id, id, cylinder_id, party_id, order_id, start_date, doc) VALUES ('o1','r2','c1','p1','y','2026-10-02','{}')`,
    ),
    /duplicate key/,
  );
  await db.query(`UPDATE ${q}.rentals SET end_date='2026-10-05' WHERE id='r1'`);
  await db.query(
    `INSERT INTO ${q}.rentals(org_id, id, cylinder_id, party_id, order_id, start_date, doc) VALUES ('o1','r2','c1','p1','y','2026-10-06','{}')`,
  );
});

forEachDb('a cylinder can be on only one vehicle (order or pickup) at a time', async (db) => {
  const q = await setup(db);
  await db.query(
    `INSERT INTO ${q}.vehicle_slots(org_id, cylinder_id, source, source_id) VALUES ('o1','c1','order','o-a')`,
  );
  await assert.rejects(
    db.query(
      `INSERT INTO ${q}.vehicle_slots(org_id, cylinder_id, source, source_id) VALUES ('o1','c1','pickup','pk-1')`,
    ),
    /duplicate key/,
  );
  await db.query(`DELETE FROM ${q}.vehicle_slots WHERE cylinder_id='c1'`);
  await db.query(
    `INSERT INTO ${q}.vehicle_slots(org_id, cylinder_id, source, source_id) VALUES ('o1','c1','pickup','pk-1')`,
  );
});

forEachDb('movements and audit log are append-only', async (db) => {
  const q = await setup(db);
  await db.query(
    `INSERT INTO ${q}.movements(org_id, id, cylinder_id, action, from_ref, to_ref, at, actor_id, actor_name, reference, notes) VALUES ('o1','m1','c1','fill','plant:b1','plant:b1',now(),'u','U','','')`,
  );
  await db.query(
    `INSERT INTO ${q}.audit_log(org_id, id, at, actor_id, actor_name, action, entity_id, summary) VALUES ('o1','a1',now(),'u','U','x','c1','s')`,
  );
  for (const table of ['movements', 'audit_log']) {
    await assert.rejects(db.query(`UPDATE ${q}.${table} SET actor_name='Z'`), /append only/);
    await assert.rejects(db.query(`DELETE FROM ${q}.${table}`), /append only/);
    await assert.rejects(db.query(`TRUNCATE ${q}.${table}`), /append only/);
  }
});

forEachDb(
  'non-cash payment references are unique per customer and method; cash may repeat',
  async (db) => {
    const q = await setup(db);
    const ins = (id: string, method: string, ref: string) =>
      db.query(
        `INSERT INTO ${q}.receipts(org_id, id, party_id, kind, method, reference, at, doc) VALUES ('o1',$1,'p1','payment',$2,$3,now(),'{}')`,
        [id, method, ref],
      );
    await ins('r1', 'upi', 'UTR-9');
    await assert.rejects(ins('r2', 'upi', 'utr-9'), /duplicate key/);
    await ins('r3', 'cash', 'counter');
    await ins('r4', 'cash', 'counter');
  },
);

forEachDb('invoice numbers are unique per organization', async (db) => {
  const q = await setup(db);
  const ins = (id: string) =>
    db.query(
      `INSERT INTO ${q}.invoices(org_id, id, party_id, branch_id, type, status, number, issued_at, due_date, doc) VALUES ('o1',$1,'p1','b1','gas','issued','GINV-2026-27-00001',now(),'2026-11-01','{}')`,
      [id],
    );
  await ins('i1');
  await assert.rejects(ins('i2'), /duplicate key/);
});

forEachDb('a failed multi-row write leaves nothing behind', async (db) => {
  const q = await setup(db);
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO ${q}.cylinder_codes(org_id, cylinder_id, kind, issuer, code, normalized_code) VALUES ('o1','c1','tag','','T-9','T-9')`,
      );
      await tx.query(
        `INSERT INTO ${q}.cylinder_codes(org_id, cylinder_id, kind, issuer, code, normalized_code) VALUES ('o1','c2','tag','','T-9','T-9')`,
      );
    }),
  );
  assert.equal(
    (await db.query(`SELECT 1 FROM ${q}.cylinder_codes WHERE normalized_code='T-9'`)).rowCount,
    0,
  );
});

test(
  'API roles cannot read or write any core table',
  {
    skip:
      process.env.CTMS_TEST_PG_URL && process.env.CTMS_TEST_PG_PROBE_URL
        ? false
        : 'set CTMS_TEST_PG_URL and CTMS_TEST_PG_PROBE_URL',
  },
  async () => {
    const owner = pgDb(new pg.Pool({ connectionString: process.env.CTMS_TEST_PG_URL }));
    const s = freshSchema('probe');
    try {
      await migrate(owner, s);
      const tables = (
        await owner.query<{ tablename: string }>(
          'SELECT tablename FROM pg_tables WHERE schemaname=$1',
          [s],
        )
      ).rows;
      const probe = new pg.Client({ connectionString: process.env.CTMS_TEST_PG_PROBE_URL });
      await probe.connect();
      try {
        for (const role of ['anon', 'authenticated']) {
          await probe.query(`SET ROLE ${role}`);
          for (const { tablename } of tables)
            await assert.rejects(
              probe.query(`SELECT 1 FROM "${s}"."${tablename}" LIMIT 1`),
              /permission denied/,
            );
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
