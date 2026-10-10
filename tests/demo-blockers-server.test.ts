// Demo-blocker regressions for the server: database TLS policy (LS-02)
// health versus readiness, and field-level redaction (LS-07).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import pg from 'pg';
import { pgPoolConfig } from '../server/pg-store.js';
import { Store } from '../server/store.js';
import { sqliteDataStore, type DataStore } from '../server/data-store.js';
import { createHttpApp } from '../server/http-app.js';
import type { AppState } from '../shared/types.ts';

const CA = '-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----';
const remote = 'postgresql://u:p@db.example.com:6543/postgres';

// ---------- LS-02: remote Postgres TLS fails closed ----------

test('remote database without a CA verifies the certificate against system CAs', () => {
  const config = pgPoolConfig({ connectionString: remote, demoMode: true });
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test('remote database with a CA verifies against that CA', () => {
  const config = pgPoolConfig({ connectionString: remote, demoMode: true, caCert: CA });
  assert.deepEqual(config.ssl, { ca: CA, rejectUnauthorized: true });
});

test('URL TLS parameters cannot weaken verification of a remote database', () => {
  for (const query of [
    'sslmode=require',
    'sslmode=no-verify',
    'sslmode=disable',
    'ssl=0',
    'ssl=false',
    'sslrootcert=/tmp/x.pem',
    'uselibpqcompat=true&sslmode=require',
  ]) {
    const config = pgPoolConfig({ connectionString: `${remote}?${query}`, demoMode: true });
    assert.equal(/ssl|libpq/i.test(String(config.connectionString)), false, query);
    // What the pg driver will actually use after merging the URL into the config.
    const effective = new pg.Client(config) as unknown as { ssl: unknown };
    assert.deepEqual(effective.ssl, { rejectUnauthorized: true }, query);
  }
});

test('plaintext is refused for a remote database, even when asked for', () => {
  assert.throws(
    () => pgPoolConfig({ connectionString: remote, demoMode: true, ssl: false }),
    /unencrypted.*local/i,
  );
  assert.throws(
    () =>
      pgPoolConfig({
        connectionString: 'postgresql://u:p@10.0.0.5:5432/db',
        demoMode: true,
        ssl: false,
      }),
    /unencrypted.*local/i,
  );
});

test('plaintext is allowed only for a loopback test stand-in database', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]'])
    assert.equal(
      pgPoolConfig({
        connectionString: `postgresql://u:p@${host}:5432/db`,
        demoMode: true,
        ssl: false,
      }).ssl,
      false,
      host,
    );
});

test('a configured TLS opt-out never turns into an unverified remote connection', () => {
  for (const config of [
    pgPoolConfig({ connectionString: remote, demoMode: true }),
    pgPoolConfig({ connectionString: remote, demoMode: true, ssl: true }),
    pgPoolConfig({ connectionString: remote, demoMode: true, caCert: CA }),
  ])
    assert.notEqual((config.ssl as { rejectUnauthorized?: boolean }).rejectUnauthorized, false);
});

// ---------- Health and readiness ----------

async function serve(dataStore: DataStore) {
  const app = createHttpApp(dataStore, { production: false });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { base, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test('health stays shallow with its existing shape; readiness checks the database', async () => {
  const store = new Store({ dbPath: ':memory:', demoMode: true, production: false });
  const s = await serve(sqliteDataStore(store));
  try {
    const health = await fetch(s.base + '/api/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, mode: 'demo' });
    const ready = await fetch(s.base + '/api/ready');
    assert.equal(ready.status, 200);
    assert.equal(ready.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await ready.json(), { ok: true, database: 'ok' });
  } finally {
    await s.close();
    store.close();
  }
});

test('readiness reports an unavailable database without leaking details', async () => {
  const store = new Store({ dbPath: ':memory:', demoMode: true, production: false });
  const inner = sqliteDataStore(store);
  const broken = new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'ping')
        return async () => {
          throw new Error('connect failed for postgres://admin:hunter2-secret@db.internal');
        };
      return Reflect.get(target, prop, receiver);
    },
  });
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => logged.push(args.map(String).join(' '));
  const s = await serve(broken);
  try {
    const ready = await fetch(s.base + '/api/ready');
    assert.equal(ready.status, 503);
    const text = await ready.text();
    assert.deepEqual(JSON.parse(text), { ok: false, database: 'unavailable' });
    assert.equal(text.includes('hunter2'), false);
    assert.equal(logged.join('\n').includes('hunter2'), false);
    // Liveness is unaffected by the database.
    assert.equal((await fetch(s.base + '/api/health')).status, 200);
  } finally {
    console.error = original;
    await s.close();
    store.close();
  }
});

// ---------- LS-07: field-level redaction ----------

const FINANCE_NUMBERS = [
  'creditLimitPaise',
  'dailyRentalPaise',
  'depositPaise',
  'unitPricePaise',
  'freeDays',
  'defaultTaxBps',
];
/** Every gstin value and finance number anywhere in a response tree. */
function financeLeaks(tree: unknown, path = '$'): string[] {
  if (Array.isArray(tree)) return tree.flatMap((item, i) => financeLeaks(item, `${path}[${i}]`));
  if (!tree || typeof tree !== 'object') return [];
  const leaks: string[] = [];
  for (const [key, value] of Object.entries(tree)) {
    const here = `${path}.${key}`;
    if (/gstin/i.test(key) && value !== '' && value !== undefined) leaks.push(here);
    else if (FINANCE_NUMBERS.includes(key) && value !== 0) leaks.push(here);
    else if (key === 'email' && value !== '') leaks.push(here);
    else leaks.push(...financeLeaks(value, here));
  }
  return leaks;
}

async function redactionFixture() {
  const store = new Store({ dbPath: ':memory:', demoMode: true, production: false });
  const state = store.getState('batra') as AppState;
  // Make every nested finance carrier present, so the assertions cannot pass vacuously.
  for (const order of state.orders)
    order.challanSnapshot = {
      issuer: { companyName: 'Batra Gases', address: 'Plant road', gstin: 'ISSUER-GSTIN' },
      recipient: { name: 'Recipient', address: 'Ward 2', city: 'Delhi', gstin: 'RECIPIENT-GSTIN' },
    };
  for (const invoice of state.invoices) {
    invoice.billTo = { name: 'Recipient', address: 'Ward 2', city: 'Delhi', gstin: 'BILL-GSTIN' };
    invoice.issuer = { companyName: 'Batra Gases', address: 'Plant road', gstin: 'ISSUER-GSTIN' };
  }
  state.settings.gstin = 'COMPANY-GSTIN';
  store.db
    .prepare('UPDATE org_state SET state_json=? WHERE org_id=?')
    .run(JSON.stringify(state), 'batra');
  // An inactive staff member in another branch who appears in no visible record.
  store.db
    .prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)')
    .run(
      'u-elsewhere',
      'batra',
      'Elsewhere Person',
      'elsewhere@example.test',
      'operations',
      JSON.stringify(['b-elsewhere']),
      0,
      'x:y',
    );
  const s = await serve(sqliteDataStore(store));
  const login = async (email: string) => {
    const r = await fetch(s.base + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: s.base },
      body: JSON.stringify({ email, password: 'OxygenDemo!2026' }),
    });
    assert.equal(r.status, 200);
    return r.json();
  };
  return {
    login,
    close: async () => {
      await s.close();
      store.close();
    },
  };
}

test('driver, operations and quality receive no GSTIN or finance field at any depth', async () => {
  const f = await redactionFixture();
  try {
    for (const role of ['driver', 'operations', 'quality']) {
      const body = await f.login(`${role}@batra.demo`);
      const { users: _users, ...rest } = body;
      assert.deepEqual(financeLeaks({ ...rest, user: undefined }), [], role);
      // Users listed for assignment carry no email address either.
      assert.deepEqual(financeLeaks(body.users), [], `${role} users`);
      assert.deepEqual(body.state.invoices, [], role);
      assert.deepEqual(body.state.receipts, [], role);
      assert.deepEqual(body.state.rentals, [], role);
      assert.ok(
        body.state.orders.every(
          (o: { challanSnapshot?: { recipient: { name: string } } }) =>
            !o.challanSnapshot || o.challanSnapshot.recipient.name === 'Recipient',
        ),
        `${role} keeps delivery names and addresses`,
      );
      for (const person of body.people)
        assert.deepEqual(Object.keys(person).sort(), ['id', 'name'], role);
      assert.equal(
        body.people.some((p: { id: string }) => p.id === 'u-elsewhere'),
        false,
        `${role} sees no unrelated inactive staff`,
      );
      assert.ok(
        body.people.some(
          (p: { id: string }) => p.id === `u-${role === 'operations' ? 'ops' : role}`,
        ),
        `${role} sees own name`,
      );
    }
    const driver = await f.login('driver@batra.demo');
    assert.ok(driver.state.orders.length > 0, 'driver sees assigned work, so the check is real');
    assert.ok(
      driver.state.orders.every((o: { challanSnapshot?: unknown }) => o.challanSnapshot),
      'driver orders carry their (redacted) challan',
    );
    assert.ok(
      driver.people.some((p: { id: string }) => p.id === 'u-driver'),
      'driver sees own name',
    );
  } finally {
    await f.close();
  }
});

test('finance still receives GSTIN on challans, invoices and settings', async () => {
  const f = await redactionFixture();
  try {
    const body = await f.login('finance@batra.demo');
    assert.equal(body.state.settings.gstin, 'COMPANY-GSTIN');
    assert.ok(
      body.state.orders.some(
        (o: { challanSnapshot?: { recipient: { gstin: string } } }) =>
          o.challanSnapshot?.recipient.gstin === 'RECIPIENT-GSTIN',
      ),
    );
    if (body.state.invoices.length) assert.equal(body.state.invoices[0].billTo.gstin, 'BILL-GSTIN');
  } finally {
    await f.close();
  }
});
