// Demo-blocker regressions that need a real store: session issuance racing a password reset
// (LS-06), in-flight commands after revocation (AUTH-02), and the presenter reset.
// Runs on SQLite always, and on Postgres too when CTMS_TEST_PG_URL is set. Postgres runs use
// a fresh temporary schema each and drop only that schema; they never use the live schema.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import pg from 'pg';
import { Store, provisionDatabase } from '../server/store.js';
import { sqliteDataStore, type DataStore } from '../server/data-store.js';
import { PgStore, pgPoolConfig } from '../server/pg-store.js';
import { createHttpApp } from '../server/http-app.js';
import { createSeedState } from '../server/seed.js';
import type { AppState } from '../shared/types.ts';

const PASSWORD = 'OxygenDemo!2026';
const pgUrl = process.env.CTMS_TEST_PG_URL;
const pgCa = (process.env.CTMS_TEST_PG_CA ?? process.env.DATABASE_CA_CERT)?.replaceAll('\\n', '\n');
const pgLocal = !!pgUrl && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(pgUrl).hostname);
const pgTls = { caCert: pgCa || undefined, ssl: !pgLocal };

interface Backend {
  name: string;
  dataStore: DataStore;
  close(): Promise<void>;
}
let counter = 0;
const backends: Array<{ name: string; open(): Promise<Backend> }> = [
  {
    name: 'sqlite',
    async open() {
      const store = new Store({ dbPath: ':memory:', demoMode: true, production: false });
      return {
        name: 'sqlite',
        dataStore: sqliteDataStore(store),
        close: async () => store.close(),
      };
    },
  },
];
if (pgUrl)
  backends.push({
    name: 'postgres',
    async open() {
      const schema = `dbs_${process.pid}_${++counter}_${Date.now() % 100000}`;
      assert.notEqual(schema, 'cylvero');
      const store = await PgStore.open({
        connectionString: pgUrl,
        schema,
        demoMode: true,
        ...pgTls,
      });
      return {
        name: 'postgres',
        dataStore: store,
        async close() {
          await store.close();
          const admin = new pg.Client(
            pgPoolConfig({ connectionString: pgUrl, demoMode: true, ...pgTls }),
          );
          await admin.connect();
          try {
            assert.match(schema, /^dbs_/);
            await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
          } finally {
            await admin.end();
          }
        },
      };
    },
  });

/** A gate that pauses one intercepted store call until the test releases it. */
function gate() {
  let reached!: () => void;
  let release!: () => void;
  const atGate = new Promise<void>((r) => (reached = r));
  const open = new Promise<void>((r) => (release = r));
  return { atGate, release, pause: async () => (reached(), open) };
}

async function serve(
  backend: Backend,
  intercept: (prop: string, args: unknown[]) => Promise<void> | void = () => undefined,
) {
  const inner = backend.dataStore;
  const wrapped = new Proxy(inner, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        await intercept(String(prop), args);
        return value.apply(target, args);
      };
    },
  }) as DataStore;
  const app = createHttpApp(wrapped, { production: false });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const loginRaw = (email: string, password = PASSWORD) =>
    fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ email, password }),
    });
  const login = async (email: string, password = PASSWORD) => {
    const r = await loginRaw(email, password);
    assert.equal(r.status, 200, (await r.clone().text()).slice(0, 300));
    const body = await r.json();
    return {
      cookie: r.headers.get('set-cookie')!.split(';')[0],
      csrf: body.csrfToken as string,
      body,
    };
  };
  type Session = Awaited<ReturnType<typeof login>>;
  const send = (session: Session, method: string, path: string, body?: unknown, csrf = true) =>
    fetch(base + path, {
      method,
      headers: {
        cookie: session.cookie,
        origin: base,
        'content-type': 'application/json',
        ...(csrf ? { 'x-csrf-token': session.csrf } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const bootstrap = (session: Session) =>
    fetch(base + '/api/bootstrap', { headers: { cookie: session.cookie } });
  return {
    base,
    loginRaw,
    login,
    send,
    bootstrap,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

const partyAction = (name: string, idempotencyKey: string) => ({
  type: 'party.create',
  payload: {
    name,
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
  idempotencyKey,
});

for (const kind of backends) {
  // ---------- LS-06: a login that verified the old password cannot get a session ----------
  for (const [label, revoke] of [
    [
      'password reset',
      {
        path: '/api/users/u-finance/password',
        method: 'POST',
        body: { newPassword: 'BrandNewSecret123!' },
      },
    ],
    ['deactivation', { path: '/api/users/u-finance', method: 'PATCH', body: { active: false } }],
    ['role change', { path: '/api/users/u-finance', method: 'PATCH', body: { role: 'auditor' } }],
  ] as const) {
    test(`${kind.name}: login paused after password check gets no session after ${label}`, async () => {
      const backend = await kind.open();
      const paused = gate();
      let armed = false;
      const s = await serve(backend, async (prop, args) => {
        // clearLoginAttempt runs after the password check and before the session is issued.
        if (armed && prop === 'clearLoginAttempt' && args[0] === 'account:finance@batra.demo') {
          armed = false;
          await paused.pause();
        }
      });
      try {
        const admin = await s.login('admin@batra.demo');
        armed = true;
        const pending = s.loginRaw('finance@batra.demo');
        await paused.atGate;
        const r = await s.send(admin, revoke.method, revoke.path, revoke.body);
        assert.equal(r.status, 200, (await r.clone().text()).slice(0, 300));
        paused.release();
        const late = await pending;
        assert.equal(late.status, 401, (await late.clone().text()).slice(0, 300));
        const cookie = late.headers.get('set-cookie')?.split(';')[0];
        if (cookie)
          assert.equal(
            (await fetch(s.base + '/api/bootstrap', { headers: { cookie } })).status,
            401,
          );
        // The revocation itself stands, and its audit record is intact.
        const audit = await (await s.send(admin, 'GET', '/api/audit')).json();
        assert.ok(audit.some((e: { entityId: string }) => e.entityId === 'u-finance'));
      } finally {
        paused.release();
        await s.close();
        await backend.close();
      }
    });
  }

  test(`${kind.name}: an ordinary login and a login after reset still work`, async () => {
    const backend = await kind.open();
    const s = await serve(backend);
    try {
      const admin = await s.login('admin@batra.demo');
      await s.login('finance@batra.demo');
      const reset = await s.send(admin, 'POST', '/api/users/u-finance/password', {
        newPassword: 'BrandNewSecret123!',
      });
      assert.equal(reset.status, 200);
      assert.equal((await s.loginRaw('finance@batra.demo')).status, 401);
      const fresh = await s.login('finance@batra.demo', 'BrandNewSecret123!');
      assert.equal((await s.bootstrap(fresh)).status, 200);
    } finally {
      await s.close();
      await backend.close();
    }
  });

  // ---------- AUTH-02: commands re-check membership and auth epoch when they commit ----------
  for (const [label, revoke] of [
    ['deactivation', { path: '/api/users/u-ops', method: 'PATCH', body: { active: false } }],
    ['role change', { path: '/api/users/u-ops', method: 'PATCH', body: { role: 'quality' } }],
    [
      'branch removal',
      { path: '/api/users/u-ops', method: 'PATCH', body: { branchIds: ['b-faridabad'] } },
    ],
    [
      'password reset',
      {
        path: '/api/users/u-ops/password',
        method: 'POST',
        body: { newPassword: 'BrandNewSecret123!' },
      },
    ],
  ] as const) {
    test(`${kind.name}: an in-flight command fails after ${label} commits first`, async () => {
      const backend = await kind.open();
      const paused = gate();
      let armed = false;
      const s = await serve(backend, async (prop, args) => {
        if (armed && prop === 'apply' && (args[0] as { id: string }).id === 'u-ops') {
          armed = false;
          await paused.pause();
        }
      });
      try {
        const admin = await s.login('admin@batra.demo');
        const ops = await s.login('operations@batra.demo');
        const before = (await (await s.bootstrap(admin)).json()).state as AppState;
        armed = true;
        const pending = s.send(ops, 'POST', '/api/actions', partyAction('Late Party', 'late-1'));
        await paused.atGate;
        const r = await s.send(admin, revoke.method, revoke.path, revoke.body);
        assert.equal(r.status, 200, (await r.clone().text()).slice(0, 300));
        paused.release();
        const late = await pending;
        assert.equal(late.status, 401, (await late.clone().text()).slice(0, 300));
        const after = (await (await s.bootstrap(admin)).json()).state as AppState;
        assert.equal(after.parties.length, before.parties.length);
        assert.equal(
          after.parties.some((p) => p.name === 'Late Party'),
          false,
        );
        const audit = await (await s.send(admin, 'GET', '/api/audit')).json();
        assert.equal(
          audit.some(
            (e: { actorId: string; action: string }) =>
              e.actorId === 'u-ops' && e.action === 'party.create',
          ),
          false,
        );
      } finally {
        paused.release();
        await s.close();
        await backend.close();
      }
    });
  }

  test(`${kind.name}: an admin demoted mid-request cannot finish a user change`, async () => {
    const backend = await kind.open();
    const paused = gate();
    let armed = false;
    const s = await serve(backend, async (prop, args) => {
      if (
        armed &&
        prop === 'createUser' &&
        (args[0] as { email: string }).email === 'second@example.test'
      ) {
        armed = false;
        await paused.pause();
      }
    });
    try {
      const root = await s.login('admin@batra.demo');
      const created = await s.send(root, 'POST', '/api/users', {
        name: 'Second Admin',
        email: 'second@example.test',
        password: 'VeryStrongSecret123!',
        role: 'admin',
        branchIds: ['b-delhi', 'b-faridabad'],
      });
      assert.equal(created.status, 201);
      const second = await s.login('second@example.test', 'VeryStrongSecret123!');
      armed = true;
      const pending = s.send(second, 'POST', '/api/users', {
        name: 'Planted',
        email: 'planted@example.test',
        password: 'VeryStrongSecret123!',
        role: 'admin',
        branchIds: ['b-delhi'],
      });
      await paused.atGate;
      const demote = await s.send(root, 'PATCH', `/api/users/${second.body.user.id}`, {
        role: 'driver',
      });
      assert.equal(demote.status, 200, (await demote.clone().text()).slice(0, 300));
      paused.release();
      const late = await pending;
      assert.equal(late.status, 401, (await late.clone().text()).slice(0, 300));
      const users = (await (await s.bootstrap(root)).json()).users as Array<{ email: string }>;
      assert.equal(
        users.some((u) => u.email === 'planted@example.test'),
        false,
      );
    } finally {
      paused.release();
      await s.close();
      await backend.close();
    }
  });

  // ---------- Presenter reset: POST /api/demo/reset ----------
  test(`${kind.name}: admin resets the demo workspace to the seed story`, async () => {
    const backend = await kind.open();
    const s = await serve(backend);
    try {
      const admin = await s.login('admin@batra.demo');
      const ops = await s.login('operations@batra.demo');
      const usersBefore = (await (await s.bootstrap(admin)).json()).users.length;
      const first = await s.send(ops, 'POST', '/api/actions', partyAction('Run One Party', 'k-1'));
      assert.equal(first.status, 200);
      const firstEntity = (await first.json()).entityId;
      const dirty = (await (await s.bootstrap(admin)).json()).state as AppState;
      assert.ok(dirty.parties.some((p) => p.name === 'Run One Party'));

      const reset = await s.send(admin, 'POST', '/api/demo/reset', {});
      assert.equal(reset.status, 200, (await reset.clone().text()).slice(0, 300));
      const body = await reset.json();
      assert.deepEqual(Object.keys(body).sort(), ['ok', 'revision']);
      assert.equal(body.ok, true);
      assert.ok(Number.isInteger(body.revision) && body.revision > dirty.revision);

      // Business state is the seed story again; users and sessions are kept.
      const seed = createSeedState();
      const after = await (await s.bootstrap(admin)).json();
      const state = after.state as AppState;
      assert.equal(state.revision, body.revision);
      for (const name of [
        'branches',
        'cylinders',
        'parties',
        'orders',
        'batches',
        'movements',
        'rentals',
        'invoices',
        'receipts',
        'exceptions',
      ] as const)
        assert.equal(state[name].length, seed[name].length, name);
      assert.equal((state.pickups ?? []).length, (seed.pickups ?? []).length);
      assert.equal(
        state.parties.some((p) => p.name === 'Run One Party'),
        false,
      );
      assert.equal(state.settings.mode, 'demo');
      assert.equal(after.users.length, usersBefore);
      assert.equal((await s.bootstrap(ops)).status, 200, 'other sessions are kept');

      // The audit log is append-only: the old run stays and the reset is recorded.
      const audit = await (await s.send(admin, 'GET', '/api/audit')).json();
      const resetEvent = audit.find((e: { action: string }) => e.action === 'demo.reset');
      assert.ok(resetEvent, 'demo.reset audited');
      assert.equal(resetEvent.actorId, 'u-admin');
      assert.equal(resetEvent.actorName, 'Admin');
      // /api/audit is scoped to records that still exist, so read the permanent log itself.
      const permanent = await backend.dataStore.getAudit('batra');
      assert.ok(
        permanent.some((e) => e.entityId === firstEntity),
        'old run stays in the log',
      );
      assert.equal(permanent.filter((e) => e.action === 'demo.reset').length, 1);
      assert.ok(state.audit.some((e) => e.action === 'demo.reset'));

      // An old retry does not replay the previous run's result.
      const retry = await s.send(ops, 'POST', '/api/actions', partyAction('Run One Party', 'k-1'));
      assert.equal(retry.status, 200, (await retry.clone().text()).slice(0, 300));
      const retried = await retry.json();
      assert.notEqual(retried.entityId, firstEntity, 'not a replay of the old run');
      assert.ok(retried.state.parties.some((p: { id: string }) => p.id === retried.entityId));
    } finally {
      await s.close();
      await backend.close();
    }
  });

  test(`${kind.name}: demo reset requires an organization admin and a CSRF token`, async () => {
    const backend = await kind.open();
    const s = await serve(backend);
    try {
      const admin = await s.login('admin@batra.demo');
      const before = (await (await s.bootstrap(admin)).json()).state.revision;
      for (const role of ['operations', 'quality', 'finance', 'driver', 'auditor']) {
        const user = await s.login(`${role}@batra.demo`);
        assert.equal((await s.send(user, 'POST', '/api/demo/reset', {})).status, 403, role);
      }
      assert.equal((await s.send(admin, 'POST', '/api/demo/reset', {}, false)).status, 403);
      const noAuth = await fetch(s.base + '/api/demo/reset', {
        method: 'POST',
        headers: { origin: s.base, 'content-type': 'application/json' },
        body: '{}',
      });
      assert.equal(noAuth.status, 401);
      const crossSite = await fetch(s.base + '/api/demo/reset', {
        method: 'POST',
        headers: {
          cookie: admin.cookie,
          'x-csrf-token': admin.csrf,
          origin: 'https://evil.example',
          'content-type': 'application/json',
        },
        body: '{}',
      });
      assert.equal(crossSite.status, 403);
      // A branch-limited admin cannot reset the whole organization.
      const created = await s.send(admin, 'POST', '/api/users', {
        name: 'Branch Admin',
        email: 'branchadmin@example.test',
        password: 'VeryStrongSecret123!',
        role: 'admin',
        branchIds: ['b-delhi'],
      });
      assert.equal(created.status, 201);
      const branchAdmin = await s.login('branchadmin@example.test', 'VeryStrongSecret123!');
      assert.equal((await s.send(branchAdmin, 'POST', '/api/demo/reset', {})).status, 403);
      const audit = await (await s.send(admin, 'GET', '/api/audit')).json();
      assert.equal(
        audit.some((e: { action: string }) => e.action === 'demo.reset'),
        false,
      );
      const now = (await (await s.bootstrap(admin)).json()).state.revision;
      assert.equal(now, before + 1, 'only the user creation changed the revision');
    } finally {
      await s.close();
      await backend.close();
    }
  });
}

test('demo reset does not exist outside demo mode', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'cylvero-live-'));
  const dbPath = join(dir, 'live.sqlite');
  provisionDatabase(
    dbPath,
    {
      companyName: 'Live Co',
      address: 'Road 1',
      gstin: '',
      defaultTaxBps: 1800,
      branches: [{ id: 'b-main', name: 'Main', city: 'Delhi' }],
      admin: { name: 'Owner', email: 'owner@example.test' },
    },
    'VeryStrongSecret123!',
  );
  const store = new Store({ dbPath, demoMode: false, production: false });
  const backend: Backend = {
    name: 'live',
    dataStore: sqliteDataStore(store),
    close: async () => store.close(),
  };
  const s = await serve(backend);
  try {
    const owner = await s.login('owner@example.test', 'VeryStrongSecret123!');
    const before = (await (await s.bootstrap(owner)).json()).state;
    assert.equal((await s.send(owner, 'POST', '/api/demo/reset', {})).status, 404);
    assert.equal((await s.send(owner, 'POST', '/api/demo/reset', {}, false)).status, 404);
    const after = (await (await s.bootstrap(owner)).json()).state;
    assert.deepEqual(after, before);
  } finally {
    await s.close();
    store.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
