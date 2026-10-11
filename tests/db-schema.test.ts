import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { forEachDb, freshSchema } from './helpers/test-db.js';
import { migrate } from '../server/db/migrate.js';
import { pgDb } from '../server/db/pg-adapter.js';
import type { Db } from '../server/db/sql.js';

const CYL_COLS = `org_id, id, serial, serial_key, tag, manufacturer, manufacturer_key, gas, size, branch_id, custody, custodian_id, condition, contents, test_due, last_test, certificate, created_at`;
const cylRow = (id: string, serial: string, tag: string, extra = '') =>
  `('o1','${id}','${serial}','${serial.toLowerCase()}','${tag}','Works','works','Medical oxygen','B','b1','plant','b1','serviceable','empty','2030-01-01','2026-01-01','CERT-1',now()${extra})`;

async function setup(db: Db) {
  const s = freshSchema('core');
  await migrate(db, s);
  const q = `"${s}"`;
  await db.exec(`
    INSERT INTO ${q}.orgs(id) VALUES ('o1'), ('o2');
    INSERT INTO ${q}.branches(org_id, id, name, name_key, city) VALUES ('o1','b1','Main','main','Pune');
    INSERT INTO ${q}.parties(org_id, id, branch_id, type, name, name_key, contact, phone, address, city)
      VALUES ('o1','p1','b1','hospital','Demo Clinic','demo clinic','C','1','A','Pune');
    INSERT INTO ${q}.parties(org_id, id, branch_id, type, name, name_key, contact, phone, address, city)
      VALUES ('o1','p2','b1','hospital','Other Clinic','other clinic','C','1','A','Pune');
    INSERT INTO ${q}.cylinders(${CYL_COLS}) VALUES ${cylRow('c1', 'S-1', 'T-1')}, ${cylRow('c2', 'S-2', 'T-2')};`);
  return q;
}

const insOrder = (q: string, id: string, extra = { qty: 1, price: 100 }) =>
  `INSERT INTO ${q}.orders(org_id, id, number, party_id, branch_id, gas, size, quantity, priority, due_date, unit_price_paise, status, created_at)
   VALUES ('o1','${id}','N-${id}','p1','b1','Medical oxygen','B',${extra.qty},'normal','2026-11-01',${extra.price},'open',now())`;

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
      'batch_recipient_trace',
      'batches',
      'branches',
      'cylinder_codes',
      'cylinders',
      'document_counters',
      'exceptions',
      'idempotency',
      'invoice_lines',
      'invoices',
      'login_attempts',
      'movement_changes',
      'movements',
      'order_cylinders',
      'order_delivery_proof_cylinders',
      'order_delivery_proofs',
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
      'user_branches',
      'users',
      'vehicle_slots',
    ],
  );
});

forEachDb('no json or jsonb column exists anywhere', async (db) => {
  const q = await setup(db);
  const r = await db.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND data_type IN ('json','jsonb')`,
    [q.slice(1, -1)],
  );
  assert.equal(r.rowCount, 0);
});

const code = (db: Db, q: string, cyl: string, kind: string, issuer: string, c: string) =>
  db.query(
    `INSERT INTO ${q}.cylinder_codes(org_id, cylinder_id, kind, issuer, code, normalized_code) VALUES ('o1',$1,$2,$3,$4,$4)`,
    [cyl, kind, issuer, c],
  );

forEachDb('a code can belong to only one cylinder per issuer', async (db) => {
  const q = await setup(db);
  await code(db, q, 'c1', 'tag', '', 'T-1');
  await assert.rejects(code(db, q, 'c2', 'previous_tag', '', 'T-1'), /duplicate key/);
  // Same code from a different issuer is a different identity.
  await code(db, q, 'c2', 'external', 'STATE-HEALTH', 'T-1');
});

forEachDb('serials live in the manufacturer namespace, apart from tags', async (db) => {
  const q = await setup(db);
  await code(db, q, 'c1', 'tag', '', 'S-1');
  await code(db, q, 'c2', 'serial', 'serial:works', 'S-1');
  await assert.rejects(code(db, q, 'c1', 'serial', '', 'S-9'), /violates check constraint/);
  await assert.rejects(code(db, q, 'c1', 'external', '', 'X-9'), /violates check constraint/);
});

forEachDb('a cylinder has only one current tag', async (db) => {
  const q = await setup(db);
  await code(db, q, 'c1', 'tag', '', 'T-1');
  await assert.rejects(code(db, q, 'c1', 'tag', '', 'T-1B'), /duplicate key/);
  await code(db, q, 'c1', 'previous_tag', '', 'T-0');
});

forEachDb('manufacturer and serial are unique by key', async (db) => {
  const q = await setup(db);
  await assert.rejects(
    db.query(`INSERT INTO ${q}.cylinders(${CYL_COLS}) VALUES ${cylRow('c3', 'S-1', 'T-3')}`),
    /duplicate key/,
  );
});

forEachDb('party names are unique per branch by key', async (db) => {
  const q = await setup(db);
  await assert.rejects(
    db.query(
      `INSERT INTO ${q}.parties(org_id, id, branch_id, type, name, name_key, contact, phone, address, city) VALUES ('o1','p3','b1','hospital','demo clinic','demo clinic','C','1','A','Pune')`,
    ),
    /duplicate key/,
  );
});

forEachDb('branches are unique by name key within an organization', async (db) => {
  const q = await setup(db);
  await assert.rejects(
    db.query(
      `INSERT INTO ${q}.branches(org_id, id, name, name_key, city) VALUES ('o1','b2','MAIN','main','Pune')`,
    ),
    /duplicate key/,
  );
  await db.query(
    `INSERT INTO ${q}.branches(org_id, id, name, name_key, city) VALUES ('o2','b1','Main','main','Pune')`,
  );
});

forEachDb('a cylinder has at most one open rental', async (db) => {
  const q = await setup(db);
  await db.query(insOrder(q, 'x'));
  await db.query(insOrder(q, 'y'));
  const ins = (id: string, order: string, start: string) =>
    db.query(
      `INSERT INTO ${q}.rentals(org_id, id, cylinder_id, party_id, order_id, start_date, daily_rate_paise, free_days) VALUES ('o1',$1,'c1','p1',$2,$3,100,0)`,
      [id, order, start],
    );
  await ins('r1', 'x', '2026-10-01');
  await assert.rejects(ins('r2', 'y', '2026-10-02'), /duplicate key/);
  await db.query(`UPDATE ${q}.rentals SET end_date='2026-10-05' WHERE id='r1'`);
  await ins('r2', 'y', '2026-10-06');
});

forEachDb('a rental cannot end before it starts', async (db) => {
  const q = await setup(db);
  await db.query(insOrder(q, 'x'));
  await assert.rejects(
    db.query(
      `INSERT INTO ${q}.rentals(org_id, id, cylinder_id, party_id, order_id, start_date, end_date, daily_rate_paise, free_days) VALUES ('o1','r1','c1','p1','x','2026-10-05','2026-10-01',100,0)`,
    ),
    /violates check constraint/,
  );
});

forEachDb('a cylinder is in transit on at most one order and one pickup', async (db) => {
  const q = await setup(db);
  await db.query(insOrder(q, 'a'));
  await db.query(insOrder(q, 'b'));
  const oc = (order: string, state = 'on_vehicle') =>
    db.query(
      `INSERT INTO ${q}.order_cylinders(org_id, order_id, cylinder_id, position, state) VALUES ('o1',$1,'c1',0,$2)`,
      [order, state],
    );
  await oc('a');
  await assert.rejects(oc('b'), /duplicate key/);
  await oc('b', 'delivered');
  for (const id of ['k1', 'k2'])
    await db.query(
      `INSERT INTO ${q}.pickups(org_id, id, party_id, branch_id, driver_id, vehicle, created_at) VALUES ('o1','${id}','p1','b1','d','V',now())`,
    );
  const pc = (pk: string) =>
    db.query(
      `INSERT INTO ${q}.pickup_cylinders(org_id, pickup_id, cylinder_id, position, state) VALUES ('o1',$1,'c1',0,'on_vehicle')`,
      [pk],
    );
  await pc('k1');
  await assert.rejects(pc('k2'), /duplicate key/);
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

forEachDb('foreign keys keep organizations apart', async (db) => {
  const q = await setup(db);
  await assert.rejects(
    db.query(
      `INSERT INTO ${q}.parties(org_id, id, branch_id, type, name, name_key, contact, phone, address, city) VALUES ('o2','px','b1','hospital','X','x','C','1','A','Pune')`,
    ),
    /violates foreign key/,
  );
  await assert.rejects(
    db.query(
      `INSERT INTO ${q}.order_cylinders(org_id, order_id, cylinder_id, position, state) VALUES ('o1','ghost','c1',0,'delivered')`,
    ),
    /violates foreign key/,
  );
});

forEachDb('a cylinder with an unknown batch is rejected at commit', async (db) => {
  const q = await setup(db);
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO ${q}.cylinders(${CYL_COLS}, batch_id) VALUES ${cylRow('c9', 'S-9', 'T-9', ",'ghost'")}`,
      );
    }),
    /violates foreign key/,
  );
  assert.equal((await db.query(`SELECT 1 FROM ${q}.cylinders WHERE id='c9'`)).rowCount, 0);
});

forEachDb('movements, movement changes and audit log are append-only', async (db) => {
  const q = await setup(db);
  await db.query(
    `INSERT INTO ${q}.movements(org_id, id, cylinder_id, action, from_ref, to_ref, at, actor_id, actor_name, reference, notes) VALUES ('o1','m1','c1','fill','plant:b1','plant:b1',now(),'u','U','','')`,
  );
  await db.query(
    `INSERT INTO ${q}.movement_changes(org_id, movement_id, field, before_value, after_value) VALUES ('o1','m1','contents','empty','full')`,
  );
  await db.query(
    `INSERT INTO ${q}.audit_log(org_id, id, at, actor_id, actor_name, action, entity_id, summary) VALUES ('o1','a1',now(),'u','U','x','c1','s')`,
  );
  for (const table of ['movements', 'movement_changes', 'audit_log']) {
    await assert.rejects(db.query(`UPDATE ${q}.${table} SET org_id='o1'`), /append only/);
    await assert.rejects(db.query(`DELETE FROM ${q}.${table}`), /append only/);
    // movements is referenced by movement_changes, so truncate the pair together.
    const targets =
      table === 'movements' ? `${q}.movements, ${q}.movement_changes` : `${q}.${table}`;
    await assert.rejects(db.query(`TRUNCATE ${targets}`), /append only/);
  }
});

forEachDb('payment references are unique per method across the organization', async (db) => {
  const q = await setup(db);
  const ins = (id: string, party: string, method: string, ref: string) =>
    db.query(
      `INSERT INTO ${q}.receipts(org_id, id, number, party_id, amount_paise, method, reference, reference_key, at, actor_id, kind)
       VALUES ('o1',$1,'R-'||$1,$2,100,$3,$4,lower($4),now(),'u','payment')`,
      [id, party, method, ref],
    );
  await ins('r1', 'p1', 'upi', 'UTR-9');
  await assert.rejects(ins('r2', 'p1', 'upi', 'utr-9'), /duplicate key/);
  await assert.rejects(ins('r3', 'p2', 'upi', 'utr-9'), /duplicate key/);
  await ins('r4', 'p2', 'bank', 'utr-9');
  await ins('r5', 'p1', 'cash', 'counter');
  await assert.rejects(ins('r6', 'p2', 'cash', 'counter'), /duplicate key/);
});

forEachDb('money and quantity checks reject bad values', async (db) => {
  const q = await setup(db);
  await assert.rejects(
    db.query(
      `INSERT INTO ${q}.receipts(org_id, id, number, party_id, amount_paise, method, reference, reference_key, at, actor_id, kind) VALUES ('o1','r1','R1','p1',-5,'upi','a','a',now(),'u','payment')`,
    ),
    /violates check constraint/,
  );
  await assert.rejects(
    db.query(insOrder(q, 'n1', { qty: 1, price: -1 })),
    /violates check constraint/,
  );
  await assert.rejects(
    db.query(insOrder(q, 'n2', { qty: 0, price: 1 })),
    /violates check constraint/,
  );
  await db.query(insOrder(q, 'ok'));
});

forEachDb('invoice numbers are unique per organization', async (db) => {
  const q = await setup(db);
  const ins = (id: string) =>
    db.query(
      `INSERT INTO ${q}.invoices(org_id, id, number, party_id, branch_id, type, source_id, issued_at, due_date, subtotal_paise, tax_bps, tax_paise, total_paise, status)
       VALUES ('o1',$1,'GINV-2026-27-00001','p1','b1','gas','s',now(),'2026-11-01',100,500,5,105,'issued')`,
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
          await assert.rejects(
            probe.query(`INSERT INTO "${s}".orgs(id) VALUES ('x')`),
            /permission denied/,
          );
          await probe.query('RESET ROLE');
        }
      } finally {
        await probe.end();
      }
    } finally {
      await owner.query(`DROP SCHEMA IF EXISTS "${s}" CASCADE`);
      await owner.close();
    }
  },
);
