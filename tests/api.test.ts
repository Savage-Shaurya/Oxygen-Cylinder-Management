import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { spawnSync } from 'node:child_process';
import { createApp } from '../server/app.js';
import type { Store } from '../server/store.js';
import { createHttpApp } from '../server/http-app.js';
import { PgStore } from '../server/pg-store.js';

// Set CTMS_TEST_PG_URL to run this suite against Postgres (the hosted storage) instead of SQLite.
const pgUrl = process.env.CTMS_TEST_PG_URL;
const sqliteOnly = pgUrl ? { skip: 'inspects the local SQLite file' } : {};
let pgSchemaCounter = 0;
async function pgFixture(connectionString: string) {
  const schema = `t_${process.pid}_${++pgSchemaCounter}_${Date.now() % 100000}`;
  const open = () => PgStore.open({ connectionString, schema, demoMode: true, ssl: false });
  let pgStore = await open();
  let app = createHttpApp(pgStore, { production: false });
  let server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  let base = `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
  const closeServer = () => new Promise<void>((resolve) => server.close(() => resolve()));
  const request = async (path: string, init: RequestInit = {}) => fetch(base + path, init);
  const login = async (email = 'admin@batra.demo') => {
    const r = await request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ email, password: 'OxygenDemo!2026' }),
    });
    assert.equal(r.status, 200, await r.clone().text());
    const cookie = r.headers.get('set-cookie')!.split(';')[0];
    const body = await r.json();
    return { cookie, csrf: body.csrfToken as string, body };
  };
  const restart = async () => {
    await closeServer();
    await pgStore.close();
    pgStore = await open();
    app = createHttpApp(pgStore, { production: false });
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
  };
  const dispose = async () => {
    await closeServer();
    await pgStore.close();
    const pg = (await import('pg')).default;
    const admin = new pg.Client({ connectionString });
    await admin.connect();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  };
  return {
    request,
    login,
    restart,
    dispose,
    dbPath: '',
    get store(): Store {
      throw new Error('SQLite store is not available in the Postgres suite');
    },
    get base() {
      return base;
    },
  };
}

async function fixture() {
  if (pgUrl) return pgFixture(pgUrl);
  const dir = mkdtempSync(join(tmpdir(), 'batra-api-'));
  const dbPath = join(dir, 'store.sqlite');
  let app = createApp({ dbPath, demoMode: true });
  let server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  let base = `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
  const closeServer = () => new Promise<void>((resolve) => server.close(() => resolve()));
  const request = async (path: string, init: RequestInit = {}) => fetch(base + path, init);
  const login = async (email = 'admin@batra.demo') => {
    const r = await request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ email, password: 'OxygenDemo!2026' }),
    });
    assert.equal(r.status, 200, await r.clone().text());
    const cookie = r.headers.get('set-cookie')!.split(';')[0];
    const body = await r.json();
    return { cookie, csrf: body.csrfToken as string, body };
  };
  const restart = async () => {
    await closeServer();
    app.locals.store.close();
    app = createApp({ dbPath, demoMode: true });
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
  };
  const dispose = async () => {
    await closeServer();
    app.locals.store.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return {
    request,
    login,
    restart,
    dispose,
    dbPath,
    get store() {
      return app.locals.store as Store;
    },
    get base() {
      return base;
    },
  };
}

test('login protects sessions, CSRF, and revocation', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/api/bootstrap')).status, 401);
    assert.equal(
      (
        await f.request('/api/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'admin@batra.demo', password: 'wrong' }),
        })
      ).status,
      401,
    );
    const { cookie, csrf } = await f.login();
    const refreshed = await f.request('/api/bootstrap', { headers: { cookie } });
    assert.equal(refreshed.status, 200);
    const currentCsrf = (await refreshed.json()).csrfToken as string;
    assert.equal(currentCsrf, csrf);
    assert.equal(
      (await f.request('/api/logout', { method: 'POST', headers: { cookie } })).status,
      403,
    );
    assert.equal(
      (
        await f.request('/api/logout', {
          method: 'POST',
          headers: { cookie, 'x-csrf-token': currentCsrf, origin: f.base },
        })
      ).status,
      200,
    );
    assert.equal((await f.request('/api/bootstrap', { headers: { cookie } })).status, 401);
    if (f.dbPath) {
      const dbBytes = readFileSync(f.dbPath);
      assert.equal(dbBytes.includes(Buffer.from('OxygenDemo!2026')), false);
    }
  } finally {
    await f.dispose();
  }
});

test('actions persist across restart and idempotency rejects altered payload', async () => {
  const f = await fixture();
  try {
    const { cookie, csrf } = await f.login();
    const action = {
      type: 'party.create',
      payload: {
        name: 'New Clinic',
        type: 'hospital',
        contact: 'A',
        phone: '123',
        address: 'Lane',
        city: 'Delhi',
        gstin: '',
        branchId: 'b-delhi',
        creditLimitPaise: 0,
        dailyRentalPaise: 0,
        freeDays: 0,
        depositPaise: 0,
      },
      idempotencyKey: 'same-key',
    };
    const post = (body: unknown) =>
      f.request('/api/actions', {
        method: 'POST',
        headers: {
          cookie,
          'x-csrf-token': csrf,
          origin: f.base,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    const first = await post(action);
    assert.equal(first.status, 200, await first.clone().text());
    await f.restart();
    const second = await post({
      ...action,
      idempotencyKey: 'second-key',
      payload: { ...action.payload, name: 'Later Clinic' },
    });
    assert.equal(second.status, 200, await second.clone().text());
    const replay = await post(action);
    assert.equal(replay.status, 200, await replay.clone().text());
    const replayState = (await replay.json()).state;
    assert.equal(
      replayState.parties.some((p: { name: string }) => p.name === 'Later Clinic'),
      true,
    );
    const conflict = await post({
      ...action,
      payload: { ...action.payload, name: 'Other Clinic' },
    });
    assert.equal(conflict.status, 409);
    const bootstrap = await f.request('/api/bootstrap', { headers: { cookie } });
    assert.equal(bootstrap.status, 200);
    assert.equal(
      ((await bootstrap.json()).state.parties as { name: string }[]).filter(
        (x) => x.name === 'New Clinic',
      ).length,
      1,
    );
  } finally {
    await f.dispose();
  }
});

test('branch and driver views restrict records and finance', async () => {
  const f = await fixture();
  try {
    const { cookie, csrf, body } = await f.login('driver@batra.demo');
    assert.equal(body.state.invoices.length, 0);
    assert.equal(body.state.receipts.length, 0);
    assert.equal(body.users.length, 0);
    // Names only, so the driver sees "Driver" rather than an internal ID.
    assert.ok(body.people.some((p: { id: string; name: string }) => p.id === 'u-driver'));
    for (const person of body.people) assert.deepEqual(Object.keys(person).sort(), ['id', 'name']);
    const r = await f.request('/api/actions', {
      method: 'POST',
      headers: { cookie, 'x-csrf-token': csrf, origin: f.base, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'party.create', payload: {}, idempotencyKey: 'forbidden' }),
    });
    assert.equal(r.status, 403);
    assert.equal((await f.request('/api/export', { headers: { cookie } })).status, 403);
  } finally {
    await f.dispose();
  }
});

test('admin changes revoke sessions and preserve final administrator', async () => {
  const f = await fixture();
  try {
    const admin = await f.login();
    const driver = await f.login('driver@batra.demo');
    const headers = {
      cookie: admin.cookie,
      'x-csrf-token': admin.csrf,
      origin: f.base,
      'content-type': 'application/json',
    };
    const self = await f.request('/api/users/u-admin', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ active: false }),
    });
    assert.equal(self.status, 400);
    const update = await f.request('/api/users/u-driver', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ active: false }),
    });
    assert.equal(update.status, 200, await update.clone().text());
    assert.equal(
      (await f.request('/api/bootstrap', { headers: { cookie: driver.cookie } })).status,
      401,
    );
    const create = await f.request('/api/users', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Scoped',
        email: 'scoped@example.test',
        password: 'VeryStrongSecret123!',
        role: 'operations',
        branchIds: ['b-delhi'],
      }),
    });
    assert.equal(create.status, 201, await create.clone().text());
    const created = await create.json();
    assert.equal(created.passwordHash, undefined);
    const after = await f.request('/api/bootstrap', { headers: { cookie: admin.cookie } });
    assert.equal(
      (await after.json()).state.audit.some((e: { action: string }) => e.action === 'user.create'),
      true,
    );
  } finally {
    await f.dispose();
  }
});

test('audit is append only and backup restores a consistent snapshot', sqliteOnly, async () => {
  const f = await fixture();
  try {
    const { cookie, csrf } = await f.login();
    const action = {
      type: 'party.create',
      payload: {
        name: 'Snapshot Clinic',
        type: 'hospital',
        contact: 'A',
        phone: '123',
        address: 'Lane',
        city: 'Delhi',
        gstin: '',
        branchId: 'b-delhi',
        creditLimitPaise: 0,
        dailyRentalPaise: 0,
        freeDays: 0,
        depositPaise: 0,
      },
      idempotencyKey: 'backup-action',
    };
    const r = await f.request('/api/actions', {
      method: 'POST',
      headers: { cookie, 'x-csrf-token': csrf, origin: f.base, 'content-type': 'application/json' },
      body: JSON.stringify(action),
    });
    assert.equal(r.status, 200, await r.clone().text());
    const backup = join(f.dbPath + '-backup.sqlite');
    const store = (await import('../server/store.js')).Store;
    const source = new store({ dbPath: f.dbPath, demoMode: true });
    source.backup(backup);
    source.close();
    const { restoreSnapshot } = await import('../server/store.js');
    const restorePath = f.dbPath + '-restored.sqlite';
    restoreSnapshot(backup, restorePath);
    const restored = new store({ dbPath: restorePath, demoMode: true });
    assert.equal(
      restored
        .getState('batra')
        .parties.filter((p: { name: string }) => p.name === 'Snapshot Clinic').length,
      1,
    );
    assert.throws(() => restored.db.prepare('DELETE FROM audit_log').run(), /audit append only/);
    restored.close();
  } finally {
    await f.dispose();
  }
});

test('single branch staff cannot read or create records in another branch', async () => {
  const f = await fixture();
  try {
    const admin = await f.login();
    const create = await f.request('/api/users', {
      method: 'POST',
      headers: {
        cookie: admin.cookie,
        'x-csrf-token': admin.csrf,
        origin: f.base,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Delhi Operator',
        email: 'delhi@example.test',
        password: 'VeryStrongSecret123!',
        role: 'operations',
        branchIds: ['b-delhi'],
      }),
    });
    assert.equal(create.status, 201, await create.clone().text());
    const r = await f.request('/api/login', {
      method: 'POST',
      headers: { origin: f.base, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'delhi@example.test', password: 'VeryStrongSecret123!' }),
    });
    assert.equal(r.status, 200, await r.clone().text());
    const { csrfToken, state } = await r.json();
    const cookie = r.headers.get('set-cookie')!.split(';')[0];
    assert.deepEqual(
      state.branches.map((x: { id: string }) => x.id),
      ['b-delhi'],
    );
    assert.equal(
      state.parties.some((x: { id: string }) => x.id === 'p-hospital-2'),
      false,
    );
    assert.equal(
      state.invoices.some((x: { id: string }) => x.id === 'inv-seed-3'),
      false,
    );
    assert.equal(
      (await (await f.request('/api/bootstrap', { headers: { cookie } })).json()).users.some(
        (u: { id: string; email: string }) => u.id === 'u-driver' && u.email === '',
      ),
      true,
    );
    const foreign = await f.request('/api/actions', {
      method: 'POST',
      headers: {
        cookie,
        'x-csrf-token': csrfToken,
        origin: f.base,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        type: 'party.create',
        payload: {
          name: 'Foreign Clinic',
          type: 'hospital',
          contact: 'A',
          phone: '123',
          address: 'Lane',
          city: 'Delhi',
          gstin: '',
          branchId: 'b-faridabad',
          creditLimitPaise: 0,
          dailyRentalPaise: 0,
          freeDays: 0,
          depositPaise: 0,
        },
        idempotencyKey: 'cross-branch',
      }),
    });
    assert.equal(foreign.status, 404);
  } finally {
    await f.dispose();
  }
});

test('quality view hides financial fields and driver sees only active assigned work', async () => {
  const f = await fixture();
  try {
    const quality = await f.login('quality@batra.demo');
    assert.deepEqual(quality.body.state.invoices, []);
    assert.deepEqual(quality.body.state.receipts, []);
    assert.equal(
      quality.body.state.parties.every(
        (p: { creditLimitPaise: number; dailyRentalPaise: number; depositPaise: number }) =>
          p.creditLimitPaise === 0 && p.dailyRentalPaise === 0 && p.depositPaise === 0,
      ),
      true,
    );
    const driver = await f.login('driver@batra.demo');
    assert.equal(
      driver.body.state.orders.every(
        (o: { status: string; driverId: string; unitPricePaise: number }) =>
          o.driverId === 'u-driver' &&
          ['dispatched', 'partial'].includes(o.status) &&
          o.unitPricePaise === 0,
      ),
      true,
    );
    assert.equal(
      driver.body.state.orders.some((o: { id: string }) => o.id === 'o-delivered-1'),
      false,
    );
  } finally {
    await f.dispose();
  }
});

test('origin guard and CSV formula escaping protect downloads', async () => {
  const f = await fixture();
  try {
    const admin = await f.login();
    const blocked = await f.request('/api/logout', {
      method: 'POST',
      headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf, origin: 'https://evil.example' },
    });
    assert.equal(blocked.status, 403);
    const wrongScheme = await f.request('/api/logout', {
      method: 'POST',
      headers: {
        cookie: admin.cookie,
        'x-csrf-token': admin.csrf,
        origin: f.base.replace('http:', 'https:'),
      },
    });
    assert.equal(wrongScheme.status, 403);
    const row = {
      serial: 'CSV-TEST-1',
      tag: 'CSV-TEST-1',
      manufacturer: '＝2+2',
      gas: 'Medical oxygen',
      size: 'B',
      ownerId: 'company',
      branchId: 'b-delhi',
      testDue: '2030-01-01',
      lastTest: '2026-01-01',
      certificate: 'CERT',
      contents: 'empty',
    };
    const posted = await f.request('/api/actions', {
      method: 'POST',
      headers: {
        cookie: admin.cookie,
        'x-csrf-token': admin.csrf,
        origin: f.base,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        type: 'cylinder.register',
        payload: row,
        idempotencyKey: 'csv-formula',
      }),
    });
    assert.equal(posted.status, 200, await posted.clone().text());
    const csv = await f.request('/api/cylinders.csv', { headers: { cookie: admin.cookie } });
    assert.equal(csv.status, 200);
    assert.match(await csv.text(), /"'＝2\+2"/);
    assert.equal(
      (await f.request('/api/nonexistent', { headers: { cookie: admin.cookie } })).status,
      404,
    );
  } finally {
    await f.dispose();
  }
});

test('production provisioning starts empty with one secure admin and refuses repeat', sqliteOnly, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'batra-live-'));
  const dbPath = join(dir, 'live.sqlite');
  try {
    const { provisionDatabase, Store } = await import('../server/store.js');
    const config = {
      companyName: 'Example Oxygen',
      address: 'Delhi',
      gstin: 'GST',
      defaultTaxBps: 1200,
      branches: [{ id: 'north', name: 'North', city: 'Delhi' }],
      admin: { name: 'Owner', email: 'owner@example.test' },
    };
    provisionDatabase(dbPath, config, 'VeryStrongSecret123!');
    const live = new Store({ dbPath, production: true });
    assert.equal(live.getState('default').settings.mode, 'live');
    assert.equal(live.getState('default').cylinders.length, 0);
    assert.equal(live.getUsers('default').length, 1);
    assert.equal(readFileSync(dbPath).includes(Buffer.from('VeryStrongSecret123!')), false);
    live.close();
    assert.throws(
      () => provisionDatabase(dbPath, config, 'VeryStrongSecret123!'),
      /already initialized/i,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scoped admin cannot grant branches they do not hold', async () => {
  const f = await fixture();
  try {
    const root = await f.login();
    const rootHeaders = {
      cookie: root.cookie,
      'x-csrf-token': root.csrf,
      origin: f.base,
      'content-type': 'application/json',
    };
    const created = await f.request('/api/users', {
      method: 'POST',
      headers: rootHeaders,
      body: JSON.stringify({
        name: 'Branch Admin',
        email: 'branchadmin@example.test',
        password: 'VeryStrongSecret123!',
        role: 'admin',
        branchIds: ['b-delhi'],
      }),
    });
    assert.equal(created.status, 201, await created.clone().text());
    const scoped = await created.json();
    const login = await f.request('/api/login', {
      method: 'POST',
      headers: { origin: f.base, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'branchadmin@example.test', password: 'VeryStrongSecret123!' }),
    });
    const auth = await login.json();
    const headers = {
      cookie: login.headers.get('set-cookie')!.split(';')[0],
      'x-csrf-token': auth.csrfToken,
      origin: f.base,
      'content-type': 'application/json',
    };
    const elevate = await f.request(`/api/users/${scoped.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ branchIds: ['b-delhi', 'b-faridabad'] }),
    });
    assert.equal(elevate.status, 403);
    const create = await f.request('/api/users', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Wide',
        email: 'wide@example.test',
        password: 'VeryStrongSecret123!',
        role: 'operations',
        branchIds: ['b-faridabad'],
      }),
    });
    assert.equal(create.status, 403);
  } finally {
    await f.dispose();
  }
});

test('dispatch rejects users without an active driver assignment', async () => {
  const f = await fixture();
  try {
    const admin = await f.login();
    const headers = {
      cookie: admin.cookie,
      'x-csrf-token': admin.csrf,
      origin: f.base,
      'content-type': 'application/json',
    };
    const r = await f.request('/api/actions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'order.dispatch',
        payload: {
          orderId: 'o-open-1',
          cylinderIds: ['c-005'],
          vehicle: 'Van',
          driverId: 'u-finance',
        },
        idempotencyKey: 'bad-driver',
      }),
    });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /driver/i);
  } finally {
    await f.dispose();
  }
});

test('API responses are not cached and missing routes return JSON', async () => {
  const f = await fixture();
  try {
    const health = await f.request('/api/health');
    assert.match(health.headers.get('cache-control') ?? '', /no-store/);
    const missing = await f.request('/api/does-not-exist');
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get('content-type') ?? '', /json/);
  } finally {
    await f.dispose();
  }
});

test('login rate limit counts password spray across different emails', async () => {
  const f = await fixture();
  try {
    let last = 0;
    for (let i = 0; i < 101; i++) {
      const r = await f.request('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: f.base },
        body: JSON.stringify({ email: `unknown-${i}@example.test`, password: 'wrong' }),
      });
      last = r.status;
    }
    assert.equal(last, 429);
  } finally {
    await f.dispose();
  }
});

test('driver sees assigned pending pickups and current-day customer stock only', sqliteOnly, async () => {
  const f = await fixture();
  try {
    const { Store } = await import('../server/store.js');
    const store = new Store({ dbPath: f.dbPath, demoMode: true });
    const state = store.getState('batra');
    const today = new Date().toISOString();
    state.orders.find((o: { id: string }) => o.id === 'o-delivered-1')!.deliveredAt = today;
    state.pickups = [
      {
        id: 'pick-1',
        partyId: 'p-hospital-1',
        branchId: 'b-delhi',
        driverId: 'u-driver',
        vehicle: 'Van',
        cylinderIds: ['c-001', 'c-002'],
        receivedIds: ['c-002'],
        createdAt: today,
        notes: 'Return route',
      },
    ];
    state.exceptions.push({
      id: 'ex-unmatched',
      at: today,
      type: 'serial',
      summary: 'Unknown tag',
      entityId: 'missing-serial',
      status: 'open',
      branchId: 'b-delhi',
    });
    store.db
      .prepare('UPDATE org_state SET state_json=? WHERE org_id=?')
      .run(JSON.stringify(state), 'batra');
    store.close();
    const driver = await f.login('driver@batra.demo');
    assert.equal(
      driver.body.state.orders.some((o: { id: string }) => o.id === 'o-delivered-1'),
      true,
    );
    assert.deepEqual(driver.body.state.pickups[0].cylinderIds, ['c-001']);
    assert.equal(
      driver.body.state.cylinders.some((c: { id: string }) => c.id === 'c-002'),
      false,
    );
    const admin = await f.login();
    assert.equal(
      admin.body.state.exceptions.some((e: { id: string }) => e.id === 'ex-unmatched'),
      true,
    );
  } finally {
    await f.dispose();
  }
});

test('scoped admin cannot see other-branch user identities or management audit', async () => {
  const f = await fixture();
  try {
    const root = await f.login();
    const headers = {
      cookie: root.cookie,
      'x-csrf-token': root.csrf,
      origin: f.base,
      'content-type': 'application/json',
    };
    for (const [email, branches] of [
      ['northadmin@example.test', ['b-delhi']],
      ['south@example.test', ['b-faridabad']],
    ] as const) {
      const r = await f.request('/api/users', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: email,
          email,
          password: 'VeryStrongSecret123!',
          role: email.startsWith('north') ? 'admin' : 'operations',
          branchIds: branches,
        }),
      });
      assert.equal(r.status, 201, await r.clone().text());
    }
    const login = await f.request('/api/login', {
      method: 'POST',
      headers: { origin: f.base, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'northadmin@example.test', password: 'VeryStrongSecret123!' }),
    });
    const body = await login.json();
    assert.equal(
      body.users.some((u: { email: string }) => u.email === 'south@example.test'),
      false,
    );
    assert.equal(
      body.state.audit.some((e: { summary: string }) => e.summary.includes('south@example.test')),
      false,
    );
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const audit = await f.request('/api/audit', { headers: { cookie } });
    assert.equal(
      (await audit.json()).some((e: { summary: string }) =>
        e.summary.includes('south@example.test'),
      ),
      false,
    );
  } finally {
    await f.dispose();
  }
});

test('driver cannot collect historical party cylinders without current assigned work', async () => {
  const f = await fixture();
  try {
    const driver = await f.login('driver@batra.demo');
    const r = await f.request('/api/actions', {
      method: 'POST',
      headers: {
        cookie: driver.cookie,
        'x-csrf-token': driver.csrf,
        origin: f.base,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        type: 'cylinder.collect',
        payload: {
          partyId: 'p-hospital-1',
          cylinderIds: ['c-001'],
          vehicle: 'Van',
          driverId: 'u-driver',
          notes: 'Pickup',
        },
        idempotencyKey: 'old-party-pickup',
      }),
    });
    assert.equal(r.status, 403);
  } finally {
    await f.dispose();
  }
});

test('restore includes committed pages still in the WAL', sqliteOnly, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'batra-wal-'));
  const dbPath = join(dir, 'source.sqlite'),
    restoredPath = join(dir, 'restored.sqlite');
  try {
    const { Store, restoreSnapshot } = await import('../server/store.js');
    const writer = new Store({ dbPath, demoMode: true });
    writer.db.exec('PRAGMA wal_autocheckpoint=0');
    const state = writer.getState('batra');
    state.revision = 77;
    writer.db
      .prepare('UPDATE org_state SET revision=?,state_json=? WHERE org_id=?')
      .run(77, JSON.stringify(state), 'batra');
    restoreSnapshot(dbPath, restoredPath);
    const restored = new Store({ dbPath: restoredPath, demoMode: true });
    assert.equal(restored.getState('batra').revision, 77);
    restored.close();
    writer.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('driver can collect a customer cylinder on an active assigned route', async () => {
  const f = await fixture();
  try {
    const driver = await f.login('driver@batra.demo');
    const r = await f.request('/api/actions', {
      method: 'POST',
      headers: {
        cookie: driver.cookie,
        'x-csrf-token': driver.csrf,
        origin: f.base,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        type: 'cylinder.collect',
        payload: {
          partyId: 'p-home-1',
          cylinderIds: ['c-003'],
          vehicle: 'Van',
          driverId: 'u-driver',
          notes: 'Pickup',
        },
        idempotencyKey: 'active-party-pickup',
      }),
    });
    assert.equal(r.status, 200, await r.clone().text());
  } finally {
    await f.dispose();
  }
});

test('provisioned live administrator can commit an operational action', sqliteOnly, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'batra-live-http-'));
  const dbPath = join(dir, 'live.sqlite');
  let server: Server | undefined;
  try {
    const { provisionDatabase } = await import('../server/store.js');
    provisionDatabase(
      dbPath,
      {
        companyName: 'Live Oxygen',
        address: 'Delhi',
        gstin: 'GST',
        defaultTaxBps: 1200,
        branches: [{ id: 'north', name: 'North', city: 'Delhi' }],
        admin: { name: 'Owner', email: 'owner@example.test' },
      },
      'VeryStrongSecret123!',
    );
    const app = createApp({ dbPath, demoMode: false });
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const base = `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
    const login = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.test', password: 'VeryStrongSecret123!' }),
    });
    assert.equal(login.status, 200, await login.clone().text());
    assert.match(login.headers.get('set-cookie') ?? '', /; Secure/i);
    assert.match(login.headers.get('content-security-policy') ?? '', /default-src/);
    const body = await login.json();
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const r = await fetch(base + '/api/actions', {
      method: 'POST',
      headers: {
        origin: base,
        cookie,
        'x-csrf-token': body.csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        type: 'party.create',
        payload: {
          name: 'Live Clinic',
          type: 'hospital',
          contact: 'A',
          phone: '123',
          address: 'Lane',
          city: 'Delhi',
          gstin: '',
          branchId: 'north',
          creditLimitPaise: 0,
          dailyRentalPaise: 0,
          freeDays: 0,
          depositPaise: 0,
        },
        idempotencyKey: 'live-create',
      }),
    });
    assert.equal(r.status, 200, await r.clone().text());
    app.locals.store.close();
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('role downgrade denies replay of an earlier privileged action', async () => {
  const f = await fixture();
  try {
    const root = await f.login();
    const rootHeaders = {
      cookie: root.cookie,
      'x-csrf-token': root.csrf,
      origin: f.base,
      'content-type': 'application/json',
    };
    const created = await f.request('/api/users', {
      method: 'POST',
      headers: rootHeaders,
      body: JSON.stringify({
        name: 'Temporary Admin',
        email: 'temporary@example.test',
        password: 'VeryStrongSecret123!',
        role: 'admin',
        branchIds: ['b-delhi'],
      }),
    });
    assert.equal(created.status, 201);
    const user = await created.json();
    const login = async () => {
      const r = await f.request('/api/login', {
        method: 'POST',
        headers: { origin: f.base, 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'temporary@example.test', password: 'VeryStrongSecret123!' }),
      });
      assert.equal(r.status, 200);
      return { cookie: r.headers.get('set-cookie')!.split(';')[0], body: await r.json() };
    };
    const before = await login();
    const action = {
      type: 'party.create',
      payload: {
        name: 'Privileged Party',
        type: 'hospital',
        contact: 'A',
        phone: '123',
        address: 'Lane',
        city: 'Delhi',
        gstin: '',
        branchId: 'b-delhi',
        creditLimitPaise: 0,
        dailyRentalPaise: 0,
        freeDays: 0,
        depositPaise: 0,
      },
      idempotencyKey: 'privileged-action',
    };
    const post = (cookie: string, csrf: string) =>
      f.request('/api/actions', {
        method: 'POST',
        headers: {
          cookie,
          'x-csrf-token': csrf,
          origin: f.base,
          'content-type': 'application/json',
        },
        body: JSON.stringify(action),
      });
    assert.equal((await post(before.cookie, before.body.csrfToken)).status, 200);
    const downgraded = await f.request(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: rootHeaders,
      body: JSON.stringify({ role: 'driver' }),
    });
    assert.equal(downgraded.status, 200);
    assert.equal(
      (await f.request('/api/bootstrap', { headers: { cookie: before.cookie } })).status,
      401,
    );
    const after = await login();
    assert.equal((await post(after.cookie, after.body.csrfToken)).status, 403);
    const restored = await f.request(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: rootHeaders,
      body: JSON.stringify({ role: 'admin' }),
    });
    assert.equal(restored.status, 200);
    const reenabled = await login();
    assert.equal((await post(reenabled.cookie, reenabled.body.csrfToken)).status, 403);
  } finally {
    await f.dispose();
  }
});

test('branch-limited admin cannot change organization-wide settings', async () => {
  const f = await fixture();
  try {
    const root = await f.login();
    const created = await f.request('/api/users', {
      method: 'POST',
      headers: {
        cookie: root.cookie,
        'x-csrf-token': root.csrf,
        origin: f.base,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Branch Admin',
        email: 'branch-settings@example.test',
        password: 'VeryStrongSecret123!',
        role: 'admin',
        branchIds: ['b-delhi'],
      }),
    });
    assert.equal(created.status, 201);
    const login = await f.request('/api/login', {
      method: 'POST',
      headers: { origin: f.base, 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'branch-settings@example.test',
        password: 'VeryStrongSecret123!',
      }),
    });
    const body = await login.json();
    const r = await f.request('/api/actions', {
      method: 'POST',
      headers: {
        cookie: login.headers.get('set-cookie')!.split(';')[0],
        'x-csrf-token': body.csrfToken,
        origin: f.base,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        type: 'settings.update',
        payload: {
          companyName: 'Changed Everywhere',
          address: 'Delhi',
          gstin: '',
          defaultTaxBps: 0,
        },
        idempotencyKey: 'global-settings',
      }),
    });
    assert.equal(r.status, 403);
  } finally {
    await f.dispose();
  }
});

test('audit includes resolved branchless exceptions linked to an allowed cylinder', async () => {
  const f = await fixture();
  try {
    const admin = await f.login();
    const r = await f.request('/api/actions', {
      method: 'POST',
      headers: {
        cookie: admin.cookie,
        'x-csrf-token': admin.csrf,
        origin: f.base,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        type: 'exception.resolve',
        payload: { exceptionId: 'ex-seed-1', resolution: 'Inspected' },
        idempotencyKey: 'resolve-seeded-exception',
      }),
    });
    assert.equal(r.status, 200, await r.clone().text());
    const audit = await f.request('/api/audit', { headers: { cookie: admin.cookie } });
    const events = await audit.json();
    assert.equal(
      events.some(
        (e: { action: string; entityId: string }) =>
          e.action === 'exception.resolve' && e.entityId === 'ex-seed-1',
      ),
      true,
    );
  } finally {
    await f.dispose();
  }
});

test('concurrent stale writes have one winner and parallel retries commit only once', async () => {
  const f = await fixture();
  try {
    const { cookie, csrf, body } = await f.login();
    const post = (action: unknown) =>
      f.request('/api/actions', {
        method: 'POST',
        headers: {
          cookie,
          'x-csrf-token': csrf,
          origin: f.base,
          'content-type': 'application/json',
        },
        body: JSON.stringify(action),
      });
    const payload = {
      name: 'Concurrent demonstration clinic',
      type: 'hospital',
      contact: 'Demo',
      phone: '00000',
      address: 'Sample address',
      city: 'Delhi',
      gstin: '',
      branchId: 'b-delhi',
      creditLimitPaise: 0,
      dailyRentalPaise: 0,
      freeDays: 0,
      depositPaise: 0,
    };
    const action = { type: 'party.create', payload, expectedRevision: body.state.revision };
    const responses = await Promise.all([
      post({ ...action, idempotencyKey: 'concurrent-a' }),
      post({ ...action, idempotencyKey: 'concurrent-b' }),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    const current = await (await f.request('/api/bootstrap', { headers: { cookie } })).json();
    assert.equal(current.state.revision, body.state.revision + 1);
    const retry = {
      ...action,
      payload: { ...payload, name: 'One committed retry' },
      expectedRevision: current.state.revision,
      idempotencyKey: 'parallel-retry',
    };
    const retries = await Promise.all([post(retry), post(retry), post(retry)]);
    assert.deepEqual(
      retries.map((r) => r.status),
      [200, 200, 200],
    );
    const after = await (await f.request('/api/bootstrap', { headers: { cookie } })).json();
    assert.equal(after.state.revision, current.state.revision + 1);
    assert.equal(
      after.state.parties.filter((p: { name: string }) => p.name === 'One committed retry').length,
      1,
    );
  } finally {
    await f.dispose();
  }
});

test('party and settings overwrite versions ignore unrelated organization changes', async () => {
  const f = await fixture();
  try {
    const { cookie, csrf, body } = await f.login();
    const post = (type: string, payload: Record<string, unknown>, key: string) =>
      f.request('/api/actions', {
        method: 'POST',
        headers: {
          cookie,
          'x-csrf-token': csrf,
          origin: f.base,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ type, payload, idempotencyKey: key }),
      });
    const party = body.state.parties.find((item: { id: string }) => item.id === 'p-hospital-1');
    assert.ok(party);
    const expectedVersion = party.version ?? 1;
    const { id: _id, version: _version, ...partyFields } = party;
    const unversioned = await post('party.update', {
      ...partyFields,
      partyId: party.id,
      name: 'Unsafe overwrite',
    }, 'unversioned-party');
    assert.equal(unversioned.status, 400);
    const unrelated = await post('party.create', {
      ...partyFields,
      name: 'Unrelated version clinic',
      type: 'hospital',
    }, 'unrelated-party-version');
    assert.equal(unrelated.status, 200, await unrelated.clone().text());
    const updated = await post('party.update', {
      ...partyFields,
      partyId: party.id,
      name: 'Versioned hospital name',
      expectedVersion,
    }, 'first-party-version');
    assert.equal(updated.status, 200, await updated.clone().text());
    const stale = await post('party.update', {
      ...partyFields,
      partyId: party.id,
      name: 'Stale hospital name',
      expectedVersion,
    }, 'stale-party-version');
    assert.equal(stale.status, 409);
    const settings = body.state.settings;
    const settingsVersion = settings.version ?? 1;
    const unrelatedAgain = await post('party.create', {
      ...partyFields,
      name: 'Second unrelated version clinic',
      type: 'hospital',
    }, 'unrelated-settings-version');
    assert.equal(unrelatedAgain.status, 200, await unrelatedAgain.clone().text());
    const settingsUpdated = await post('settings.update', {
      companyName: settings.companyName,
      address: 'New address after unrelated work',
      gstin: settings.gstin,
      defaultTaxBps: settings.defaultTaxBps,
      expectedVersion: settingsVersion,
    }, 'first-settings-version');
    assert.equal(settingsUpdated.status, 200, await settingsUpdated.clone().text());
    const staleSettings = await post('settings.update', {
      companyName: settings.companyName,
      address: 'Stale address',
      gstin: settings.gstin,
      defaultTaxBps: settings.defaultTaxBps,
      expectedVersion: settingsVersion,
    }, 'stale-settings-version');
    assert.equal(staleSettings.status, 409);
    const after = await (await f.request('/api/bootstrap', { headers: { cookie } })).json();
    assert.equal(after.state.parties.find((item: { id: string }) => item.id === party.id).name,
      'Versioned hospital name');
    assert.equal(after.state.settings.address, 'New address after unrelated work');
  } finally {
    await f.dispose();
  }
});

test('credit correction commands enforce role, branch and available balance', async () => {
  const f = await fixture();
  try {
    const admin = await f.login();
    const operations = await f.login('operations@batra.demo');
    const finance = await f.login('finance@batra.demo');
    const post = (
      actor: { cookie: string; csrf: string },
      type: string,
      payload: Record<string, unknown>,
      key: string,
    ) => f.request('/api/actions', {
      method: 'POST',
      headers: {
        cookie: actor.cookie,
        'x-csrf-token': actor.csrf,
        origin: f.base,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ type, payload, idempotencyKey: key }),
    });
    const creditPayload = { invoiceId: 'inv-seed-3', amountPaise: 179200, reason: 'Correction' };
    for (const type of [
      'finance.credit', 'finance.creditAllocate', 'finance.creditRefund', 'finance.creditUnallocate',
    ]) {
      const r = await post(operations, type, creditPayload, `operations-${type}`);
      assert.equal(r.status, 403, type);
    }
    for (const type of ['constructor', 'toString', '__proto__']) {
      const r = await post(admin, type, {}, `prototype-${type}`);
      assert.equal(r.status, 403, type);
    }
    const noteResponse = await post(finance, 'finance.credit', creditPayload, 'finance-credit-paid');
    assert.equal(noteResponse.status, 200, await noteResponse.clone().text());
    const note = await noteResponse.json();
    const creditInvoiceId = note.entityId as string;
    assert.ok(creditInvoiceId);
    const create = await f.request('/api/users', {
      method: 'POST',
      headers: {
        cookie: admin.cookie,
        'x-csrf-token': admin.csrf,
        origin: f.base,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Delhi Finance',
        email: 'delhi-finance@example.test',
        password: 'VeryStrongSecret123!',
        role: 'finance',
        branchIds: ['b-delhi'],
      }),
    });
    assert.equal(create.status, 201);
    const branchLogin = await f.request('/api/login', {
      method: 'POST',
      headers: { origin: f.base, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'delhi-finance@example.test', password: 'VeryStrongSecret123!' }),
    });
    assert.equal(branchLogin.status, 200);
    const branchBody = await branchLogin.json();
    const branchFinance = {
      cookie: branchLogin.headers.get('set-cookie')!.split(';')[0],
      csrf: branchBody.csrfToken as string,
    };
    const foreignCredit = await post(branchFinance, 'finance.credit', creditPayload, 'foreign-credit');
    assert.equal(foreignCredit.status, 404);
    const foreignRefund = await post(branchFinance, 'finance.creditRefund', {
      partyId: 'p-hospital-2', creditInvoiceId, amountPaise: 100,
      method: 'bank', reference: 'Foreign credit refund', reason: 'Correction',
    }, 'foreign-refund');
    assert.equal(foreignRefund.status, 404);
    const foreignAllocation = await post(branchFinance, 'finance.creditAllocate', {
      creditInvoiceId, invoiceId: 'inv-seed-1', amountPaise: 100,
      reason: 'Foreign allocation',
    }, 'foreign-allocation');
    assert.equal(foreignAllocation.status, 404);
    const refundPayload = {
      partyId: 'p-hospital-2', creditInvoiceId, amountPaise: 179200,
      method: 'bank', reference: 'Full correction refund', reason: 'Correction',
    };
    const refund = await post(finance, 'finance.creditRefund', refundPayload, 'valid-credit-refund');
    assert.equal(refund.status, 200, await refund.clone().text());
    const second = await post(finance, 'finance.creditRefund', {
      ...refundPayload, reference: 'Excess correction refund', amountPaise: 1,
    }, 'excess-credit-refund');
    assert.equal(second.status, 400);
  } finally {
    await f.dispose();
  }
});

test('credit allocation and refund share one spendable note balance', sqliteOnly, async () => {
  const f = await fixture();
  try {
    const state = f.store.getState('batra');
    const template = state.invoices.find((invoice) => invoice.id === 'inv-seed-3')!;
    state.invoices.push({
      ...template,
      id: 'synthetic-target-invoice',
      number: 'SYNTHETIC-TARGET',
      sourceId: 'synthetic-target',
      totalPaise: 10000,
      subtotalPaise: 10000,
      taxBps: 0,
      taxPaise: 0,
      paidPaise: 0,
      status: 'issued',
      lines: [{ description: 'Synthetic target', quantity: 1, unitPricePaise: 10000, amountPaise: 10000 }],
    });
    f.store.db.prepare('UPDATE org_state SET state_json=? WHERE org_id=?')
      .run(JSON.stringify(state), 'batra');
    const actor = await f.login('finance@batra.demo');
    const post = (type: string, payload: Record<string, unknown>, key: string) =>
      f.request('/api/actions', {
        method: 'POST',
        headers: {
          cookie: actor.cookie,
          'x-csrf-token': actor.csrf,
          origin: f.base,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ type, payload, idempotencyKey: key }),
      });
    const credit = await post('finance.credit', {
      invoiceId: 'inv-seed-3', amountPaise: 10000, reason: 'Synthetic correction',
    }, 'allocate-credit-note');
    assert.equal(credit.status, 200, await credit.clone().text());
    const creditInvoiceId = (await credit.json()).entityId as string;
    const differentCustomer = await post('finance.creditAllocate', {
      creditInvoiceId, invoiceId: 'inv-seed-1', amountPaise: 100,
      reason: 'Different customer',
    }, 'cross-customer-allocation');
    assert.equal(differentCustomer.status, 400);
    const allocated = await post('finance.creditAllocate', {
      creditInvoiceId, invoiceId: 'synthetic-target-invoice', amountPaise: 7000,
      reason: 'Apply correction',
    }, 'allocate-seven-thousand');
    assert.equal(allocated.status, 200, await allocated.clone().text());
    const allocationId = (await allocated.json()).entityId as string;
    const excess = await post('finance.creditAllocate', {
      creditInvoiceId, invoiceId: 'synthetic-target-invoice', amountPaise: 4000,
      reason: 'Excess allocation',
    }, 'allocate-too-much');
    assert.equal(excess.status, 400);
    const refunded = await post('finance.creditRefund', {
      partyId: 'p-hospital-2', creditInvoiceId, amountPaise: 3000,
      method: 'bank', reference: 'Remainder refund', reason: 'Return unused credit',
    }, 'refund-remainder');
    assert.equal(refunded.status, 200, await refunded.clone().text());
    const paidTooMuch = await post('finance.receipt', {
      invoiceId: 'synthetic-target-invoice', amountPaise: 3001,
      method: 'bank', reference: 'Excess cash payment',
    }, 'payment-after-credit');
    assert.equal(paidTooMuch.status, 400);
    const after = (await (await f.request('/api/bootstrap', {
      headers: { cookie: actor.cookie },
    })).json()).state;
    assert.equal(after.invoices.find((invoice: { id: string }) =>
      invoice.id === 'synthetic-target-invoice').appliedCreditPaise, 7000);
    assert.equal(after.receipts.filter((receipt: { creditInvoiceId?: string }) =>
      receipt.creditInvoiceId === creditInvoiceId).length, 2);
    const reversed = await post('finance.creditUnallocate', {
      receiptId: allocationId, reason: 'Reverse mistaken allocation',
    }, 'reverse-credit-allocation');
    assert.equal(reversed.status, 200, await reversed.clone().text());
    const reversedAgain = await post('finance.creditUnallocate', {
      receiptId: allocationId, reason: 'Repeat reversal',
    }, 'repeat-credit-allocation-reversal');
    assert.equal(reversedAgain.status, 409);
    const afterReverse = (await (await f.request('/api/bootstrap', {
      headers: { cookie: actor.cookie },
    })).json()).state;
    assert.equal(afterReverse.invoices.find((invoice: { id: string }) =>
      invoice.id === 'synthetic-target-invoice').appliedCreditPaise, 0);
    assert.equal(afterReverse.receipts.find((receipt: { id: string }) =>
      receipt.id === allocationId).reversalReason, 'Reverse mistaken allocation');
  } finally {
    await f.dispose();
  }
});

test('invalid new-user password returns a validation error without creating the user', async () => {
  const f = await fixture();
  try {
    const admin = await f.login();
    const response = await f.request('/api/users', {
      method: 'POST',
      headers: {
        cookie: admin.cookie,
        'x-csrf-token': admin.csrf,
        origin: f.base,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Short Password User',
        email: 'short-password@example.test',
        password: 'short',
        role: 'operations',
        branchIds: ['b-delhi'],
      }),
    });
    assert.equal(response.status, 400);
    const current = await f.request('/api/bootstrap', { headers: { cookie: admin.cookie } });
    assert.equal(
      (await current.json()).users.some(
        (u: { email: string }) => u.email === 'short-password@example.test',
      ),
      false,
    );
  } finally {
    await f.dispose();
  }
});

test('live database refuses to start in demo mode', sqliteOnly, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'batra-mode-'));
  const dbPath = join(dir, 'live.sqlite');
  try {
    const { Store, provisionDatabase } = await import('../server/store.js');
    provisionDatabase(
      dbPath,
      {
        companyName: 'Live Oxygen',
        address: 'Delhi',
        gstin: '',
        defaultTaxBps: 1200,
        branches: [{ id: 'north', name: 'North', city: 'Delhi' }],
        admin: { name: 'Owner', email: 'owner@example.test' },
      },
      'VeryStrongSecret123!',
    );
    assert.throws(
      () => new Store({ dbPath, demoMode: true }),
      /Live state cannot run in demo mode/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('operations customer creation is visible immediately and after server restart', async () => {
  const f = await fixture();
  try {
    const operations = await f.login('operations@batra.demo');
    const response = await f.request('/api/actions', {
      method: 'POST',
      headers: {
        cookie: operations.cookie,
        'x-csrf-token': operations.csrf,
        origin: f.base,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        type: 'party.create',
        payload: {
          name: 'Visible Customer',
          type: 'hospital',
          contact: 'Front desk',
          phone: '12345',
          address: 'Delhi',
          city: 'Delhi',
          gstin: '',
          branchId: 'b-delhi',
          creditLimitPaise: 0,
          dailyRentalPaise: 0,
          freeDays: 0,
          depositPaise: 0,
        },
        expectedRevision: operations.body.state.revision,
        idempotencyKey: 'visible-customer',
      }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const created = await response.json();
    assert.equal(
      created.state.parties.some((p: { id: string }) => p.id === created.entityId),
      true,
    );
    await f.restart();
    const reloaded = await f.request('/api/bootstrap', { headers: { cookie: operations.cookie } });
    assert.equal(reloaded.status, 200);
    assert.equal(
      (await reloaded.json()).state.parties.some((p: { id: string }) => p.id === created.entityId),
      true,
    );
  } finally {
    await f.dispose();
  }
});

test('restoring a snapshot invalidates sessions captured in that snapshot', sqliteOnly, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'batra-restore-session-'));
  const dbPath = join(dir, 'source.sqlite');
  const backupPath = join(dir, 'backup.sqlite');
  const restoredPath = join(dir, 'restored.sqlite');
  try {
    const { Store, restoreSnapshot } = await import('../server/store.js');
    const source = new Store({ dbPath, demoMode: true });
    const user = source.getUser('u-admin')!;
    source.createSession(user, 'captured-session-token', 'captured-csrf');
    assert.ok(source.session('captured-session-token'));
    source.backup(backupPath);
    source.close();
    restoreSnapshot(backupPath, restoredPath);
    const restored = new Store({ dbPath: restoredPath, demoMode: true });
    assert.equal(restored.session('captured-session-token'), undefined);
    restored.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('demo startup does not seed into a partially initialized live database', sqliteOnly, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'batra-partial-live-'));
  const dbPath = join(dir, 'live.sqlite');
  try {
    const { Store, provisionDatabase } = await import('../server/store.js');
    provisionDatabase(
      dbPath,
      {
        companyName: 'Live Oxygen',
        address: 'Delhi',
        gstin: '',
        defaultTaxBps: 1200,
        branches: [{ id: 'north', name: 'North', city: 'Delhi' }],
        admin: { name: 'Owner', email: 'owner@example.test' },
      },
      'VeryStrongSecret123!',
    );
    const partial = new Store({ dbPath, production: true });
    partial.db.prepare('DELETE FROM users').run();
    partial.close();
    assert.throws(() => new Store({ dbPath, demoMode: true }), /Existing state cannot be seeded/);
    const inspect = new Store({ dbPath, demoMode: false, provisioning: true });
    assert.equal(inspect.db.prepare('SELECT COUNT(*) AS n FROM users').get()?.n, 0);
    assert.equal(inspect.db.prepare('SELECT COUNT(*) AS n FROM org_state').get()?.n, 1);
    inspect.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('wrong passwords on one IP do not lock out a correct company login', async () => {
  const f = await fixture();
  try {
    for (let index = 0; index < 20; index++) {
      const response = await f.request('/api/login', {
        method: 'POST',
        headers: { origin: f.base, 'content-type': 'application/json' },
        body: JSON.stringify({ email: `unknown-${index}@example.test`, password: 'wrong' }),
      });
      assert.equal(response.status, 401);
    }
    assert.equal(
      (
        await f.request('/api/login', {
          method: 'POST',
          headers: { origin: f.base, 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'admin@batra.demo', password: 'OxygenDemo!2026' }),
        })
      ).status,
      200,
    );
  } finally {
    await f.dispose();
  }
});

test('audit includes branch receipts but hides organization-wide events from branch admin', async () => {
  const f = await fixture();
  try {
    const root = await f.login();
    const headers = {
      cookie: root.cookie,
      'x-csrf-token': root.csrf,
      origin: f.base,
      'content-type': 'application/json',
    };
    const deposit = await f.request('/api/actions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'finance.deposit',
        payload: {
          partyId: 'p-home-1',
          amountPaise: 1000,
          method: 'cash',
          reference: 'audit-deposit',
        },
        idempotencyKey: 'audit-deposit',
      }),
    });
    assert.equal(deposit.status, 200, await deposit.clone().text());
    const receiptId = (await deposit.json()).entityId;
    const created = await f.request('/api/users', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Branch auditor',
        email: 'branch-auditor@example.test',
        password: 'VeryStrongSecret123!',
        role: 'auditor',
        branchIds: ['b-delhi'],
      }),
    });
    assert.equal(created.status, 201);
    const login = await f.request('/api/login', {
      method: 'POST',
      headers: { origin: f.base, 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'branch-auditor@example.test',
        password: 'VeryStrongSecret123!',
      }),
    });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const events = await (await f.request('/api/audit', { headers: { cookie } })).json();
    assert.equal(
      events.some((event: { entityId: string }) => event.entityId === receiptId),
      true,
    );
    assert.equal(
      events.some((event: { entityId: string }) => event.entityId === ''),
      false,
    );
  } finally {
    await f.dispose();
  }
});

test('final organization administrator retains access to every branch', async () => {
  const f = await fixture();
  try {
    const root = await f.login();
    const response = await f.request('/api/users/u-admin', {
      method: 'PATCH',
      headers: {
        cookie: root.cookie,
        'x-csrf-token': root.csrf,
        origin: f.base,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ branchIds: ['b-delhi'] }),
    });
    assert.equal(response.status, 400);
    assert.equal(
      (await f.request('/api/bootstrap', { headers: { cookie: root.cookie } })).status,
      200,
    );
  } finally {
    await f.dispose();
  }
});

test('demo-address user creation is rejected before it can poison live startup', async () => {
  const f = await fixture();
  try {
    const root = await f.login();
    const response = await f.request('/api/users', {
      method: 'POST',
      headers: {
        cookie: root.cookie,
        'x-csrf-token': root.csrf,
        origin: f.base,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Bad account',
        email: 'bad@Batra.Demo',
        password: 'VeryStrongSecret123!',
        role: 'admin',
        branchIds: ['b-delhi'],
      }),
    });
    assert.equal(response.status, 400);
  } finally {
    await f.dispose();
  }
});

test('no-op user edit preserves a safely repeatable action', async () => {
  const f = await fixture();
  try {
    const root = await f.login();
    const headers = {
      cookie: root.cookie,
      'x-csrf-token': root.csrf,
      origin: f.base,
      'content-type': 'application/json',
    };
    const action = {
      type: 'finance.deposit',
      payload: {
        partyId: 'p-home-1',
        amountPaise: 1000,
        method: 'cash',
        reference: 'replay-deposit',
      },
      idempotencyKey: 'replay-deposit',
    };
    const post = () =>
      f.request('/api/actions', { method: 'POST', headers, body: JSON.stringify(action) });
    assert.equal((await post()).status, 200);
    assert.equal(
      (
        await f.request('/api/users/u-admin', {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ branchIds: ['b-delhi', 'b-faridabad'] }),
        })
      ).status,
      200,
    );
    assert.equal((await post()).status, 200);
    const state = (
      await (await f.request('/api/bootstrap', { headers: { cookie: root.cookie } })).json()
    ).state;
    assert.equal(
      state.receipts.filter(
        (receipt: { reference: string }) => receipt.reference === 'replay-deposit',
      ).length,
      1,
    );
  } finally {
    await f.dispose();
  }
});

test('granting a user another branch preserves an already authorized replay', async () => {
  const f = await fixture();
  try {
    const root = await f.login();
    const rootHeaders = {
      cookie: root.cookie,
      'x-csrf-token': root.csrf,
      origin: f.base,
      'content-type': 'application/json',
    };
    const created = await f.request('/api/users', {
      method: 'POST',
      headers: rootHeaders,
      body: JSON.stringify({
        name: 'Branch finance',
        email: 'branch-finance@example.test',
        password: 'VeryStrongSecret123!',
        role: 'finance',
        branchIds: ['b-delhi'],
      }),
    });
    assert.equal(created.status, 201);
    const userId = (await created.json()).id;
    const login = await f.request('/api/login', {
      method: 'POST',
      headers: { origin: f.base, 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'branch-finance@example.test',
        password: 'VeryStrongSecret123!',
      }),
    });
    const body = await login.json();
    const headers = {
      cookie: login.headers.get('set-cookie')!.split(';')[0],
      'x-csrf-token': body.csrfToken,
      origin: f.base,
      'content-type': 'application/json',
    };
    const action = {
      type: 'finance.deposit',
      payload: {
        partyId: 'p-home-1',
        amountPaise: 1000,
        method: 'cash',
        reference: 'grant-replay',
      },
      idempotencyKey: 'grant-replay',
    };
    const post = () =>
      f.request('/api/actions', { method: 'POST', headers, body: JSON.stringify(action) });
    assert.equal((await post()).status, 200);
    assert.equal(
      (
        await f.request(`/api/users/${userId}`, {
          method: 'PATCH',
          headers: rootHeaders,
          body: JSON.stringify({ branchIds: ['b-delhi', 'b-faridabad'] }),
        })
      ).status,
      200,
    );
    assert.equal((await post()).status, 200);
  } finally {
    await f.dispose();
  }
});

test('delta action response contains scoped changes and a revision base', async () => {
  const f = await fixture();
  try {
    const root = await f.login();
    const response = await f.request('/api/actions', {
      method: 'POST',
      headers: {
        cookie: root.cookie,
        'x-csrf-token': root.csrf,
        origin: f.base,
        'content-type': 'application/json',
        prefer: 'return=delta',
      },
      body: JSON.stringify({
        type: 'finance.deposit',
        payload: {
          partyId: 'p-home-1',
          amountPaise: 1000,
          method: 'cash',
          reference: 'delta-deposit',
        },
        idempotencyKey: 'delta-deposit',
      }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    assert.equal(result.state, undefined);
    assert.equal(result.delta.baseRevision, root.body.state.revision);
    assert.equal(result.delta.revision, root.body.state.revision + 1);
    assert.equal(
      result.delta.changed.receipts.some(
        (receipt: { id: string }) => receipt.id === result.entityId,
      ),
      true,
    );
  } finally {
    await f.dispose();
  }
});

test('new database and snapshots are private, and idle sessions expire', sqliteOnly, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'batra-private-'));
  const dbPath = join(dir, 'source.sqlite');
  const backupPath = join(dir, 'backup.sqlite');
  const restoredPath = join(dir, 'restored.sqlite');
  try {
    const { Store, restoreSnapshot } = await import('../server/store.js');
    const store = new Store({ dbPath, demoMode: true });
    assert.equal(statSync(dbPath).mode & 0o777, 0o600);
    const user = store.getUser('u-admin')!;
    store.createSession(user, 'idle-token', 'csrf');
    store.db
      .prepare('UPDATE sessions SET last_seen_at=? WHERE token_hash=?')
      .run(Date.now() - 31 * 60_000, (await import('../server/auth.js')).tokenHash('idle-token'));
    assert.equal(store.session('idle-token'), undefined);
    store.backup(backupPath);
    assert.equal(statSync(backupPath).mode & 0o777, 0o600);
    store.close();
    restoreSnapshot(backupPath, restoredPath);
    assert.equal(statSync(restoredPath).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('password change and admin reset revoke existing sessions without logging secrets', async () => {
  const f = await fixture();
  try {
    const root = await f.login();
    const rootHeaders = {
      cookie: root.cookie,
      'x-csrf-token': root.csrf,
      origin: f.base,
      'content-type': 'application/json',
    };
    const created = await f.request('/api/users', {
      method: 'POST',
      headers: rootHeaders,
      body: JSON.stringify({
        name: 'Password user',
        email: 'password-user@example.test',
        password: 'InitialSecret123!',
        role: 'operations',
        branchIds: ['b-delhi'],
      }),
    });
    assert.equal(created.status, 201);
    const id = (await created.json()).id;
    const login = await f.request('/api/login', {
      method: 'POST',
      headers: { origin: f.base, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'password-user@example.test', password: 'InitialSecret123!' }),
    });
    const body = await login.json();
    const ownHeaders = {
      cookie: login.headers.get('set-cookie')!.split(';')[0],
      'x-csrf-token': body.csrfToken,
      origin: f.base,
      'content-type': 'application/json',
    };
    const wrong = await f.request('/api/password', {
      method: 'POST',
      headers: ownHeaders,
      body: JSON.stringify({ currentPassword: 'wrong', newPassword: 'NewSecretValue123!' }),
    });
    assert.equal(wrong.status, 403);
    const changed = await f.request('/api/password', {
      method: 'POST',
      headers: ownHeaders,
      body: JSON.stringify({
        currentPassword: 'InitialSecret123!',
        newPassword: 'NewSecretValue123!',
      }),
    });
    assert.equal(changed.status, 200);
    assert.equal(
      (await f.request('/api/bootstrap', { headers: { cookie: ownHeaders.cookie } })).status,
      401,
    );
    const fresh = await f.request('/api/login', {
      method: 'POST',
      headers: { origin: f.base, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'password-user@example.test', password: 'NewSecretValue123!' }),
    });
    assert.equal(fresh.status, 200);
    const freshCookie = fresh.headers.get('set-cookie')!.split(';')[0];
    const reset = await f.request(`/api/users/${id}/password`, {
      method: 'POST',
      headers: rootHeaders,
      body: JSON.stringify({ newPassword: 'ResetSecretValue123!' }),
    });
    assert.equal(reset.status, 200);
    assert.equal(
      (await f.request('/api/bootstrap', { headers: { cookie: freshCookie } })).status,
      401,
    );
    assert.equal(
      (
        await f.request('/api/login', {
          method: 'POST',
          headers: { origin: f.base, 'content-type': 'application/json' },
          body: JSON.stringify({
            email: 'password-user@example.test',
            password: 'ResetSecretValue123!',
          }),
        })
      ).status,
      200,
    );
    const audit = await (
      await f.request('/api/audit', { headers: { cookie: root.cookie } })
    ).json();
    const passwordEvents = audit.filter((event: { action: string }) =>
      event.action.startsWith('user.password_'),
    );
    assert.equal(passwordEvents.length, 2);
    assert.equal(JSON.stringify(passwordEvents).includes('ResetSecretValue123!'), false);
  } finally {
    await f.dispose();
  }
});

test('backup command refuses an existing empty source without seeding it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'batra-empty-backup-'));
  const source = join(dir, 'empty.sqlite');
  const destination = join(dir, 'backup.sqlite');
  try {
    writeFileSync(source, '');
    const result = spawnSync('node_modules/.bin/tsx', ['scripts/backup.ts', destination], {
      cwd: process.cwd(),
      env: { ...process.env, CTMS_DB_PATH: source },
      encoding: 'utf8',
    });
    assert.equal(result.status, 2);
    assert.equal(statSync(source).size, 0);
    assert.equal(existsSync(destination), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
