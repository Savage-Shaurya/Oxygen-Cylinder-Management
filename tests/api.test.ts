import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createApp } from '../server/app.js';

async function fixture() {
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
    const dbBytes = readFileSync(f.dbPath);
    assert.equal(dbBytes.includes(Buffer.from('OxygenDemo!2026')), false);
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

test('audit is append only and backup restores a consistent snapshot', async () => {
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
    assert.equal(foreign.status, 403);
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
    const row = {
      serial: 'CSV-TEST-1',
      tag: 'CSV-TEST-1',
      manufacturer: '=2+2',
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
    assert.match(await csv.text(), /"'=2\+2"/);
    assert.equal(
      (await f.request('/api/nonexistent', { headers: { cookie: admin.cookie } })).status,
      404,
    );
  } finally {
    await f.dispose();
  }
});

test('production provisioning starts empty with one secure admin and refuses repeat', async () => {
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
    for (let i = 0; i < 21; i++) {
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

test('driver sees assigned pending pickups and current-day customer stock only', async () => {
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

test('restore includes committed pages still in the WAL', async () => {
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

test('provisioned live administrator can commit an operational action', async () => {
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
    const app = createApp({ dbPath, production: true });
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
