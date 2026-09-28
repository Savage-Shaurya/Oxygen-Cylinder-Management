import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { Store } from '../server/store.js';
import { sqliteDataStore } from '../server/data-store.js';
import { createHttpApp, type HttpAppOptions } from '../server/http-app.js';

async function serve(options: HttpAppOptions) {
  const store = new Store({ dbPath: ':memory:', demoMode: true, production: false });
  const app = createHttpApp(sqliteDataStore(store), options);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    base,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    },
  };
}
const login = (
  base: string,
  email: string,
  password: string,
  headers: Record<string, string> = {},
) =>
  fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, ...headers },
    body: JSON.stringify({ email, password }),
  });

test('rotating forwarded addresses cannot brute-force one account behind a proxy', async () => {
  const s = await serve({ production: false, trustProxy: 1 });
  try {
    for (let i = 0; i < 20; i++) {
      const r = await login(s.base, 'finance@batra.demo', 'wrong-password-123', {
        'x-forwarded-for': `203.0.113.${i + 1}`,
      });
      assert.equal(r.status, 401);
    }
    const blocked = await login(s.base, 'finance@batra.demo', 'OxygenDemo!2026', {
      'x-forwarded-for': '198.51.100.99',
    });
    assert.equal(blocked.status, 429);
    // Other accounts are unaffected.
    assert.equal((await login(s.base, 'admin@batra.demo', 'OxygenDemo!2026')).status, 200);
  } finally {
    await s.close();
  }
});

test('control characters are rejected cleanly instead of causing server errors', async () => {
  const s = await serve({ production: false });
  try {
    assert.equal((await login(s.base, 'admin@batra.demo\u0000', 'OxygenDemo!2026')).status, 401);
    const ok = await login(s.base, 'admin@batra.demo', 'OxygenDemo!2026');
    const cookie = ok.headers.get('set-cookie')!.split(';')[0];
    const { csrfToken } = await ok.json();
    const headers = {
      cookie,
      'x-csrf-token': csrfToken,
      origin: s.base,
      'content-type': 'application/json',
    };
    const action = await fetch(s.base + '/api/actions', {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'party.create', payload: {}, idempotencyKey: 'a\u0000b' }),
    });
    assert.equal(action.status, 400);
    const user = await fetch(s.base + '/api/users/u-ops%00', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ active: true }),
    });
    assert.equal(user.status, 404);
    const created = await fetch(s.base + '/api/users', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Bad\u0000Name',
        email: 'bad@example.com',
        password: 'LongTestPass123',
        role: 'finance',
        branchIds: ['b-delhi'],
      }),
    });
    assert.equal(created.status, 400);
  } finally {
    await s.close();
  }
});

test('production API responses carry the strict framing and transport headers', async () => {
  const s = await serve({ production: true, serveDist: false });
  try {
    const r = await fetch(s.base + '/api/health');
    assert.match(r.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.match(
      r.headers.get('strict-transport-security')!,
      /max-age=63072000; includeSubDomains/,
    );
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(r.headers.get('cache-control'), 'no-store');
  } finally {
    await s.close();
  }
});
