import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AppState } from '../shared/types.js';
import { act, login } from '../src/api.js';

const item = (id: string, at = '2026-09-28T10:00:00.000Z') => ({ id, at });
function state(revision: number): AppState {
  return {
    revision,
    settings: { companyName: 'Test', address: '', gstin: '', defaultTaxBps: 0, mode: 'demo' },
    branches: [],
    cylinders: [],
    parties: [],
    orders: [],
    batches: [],
    movements: [item('old-movement')],
    rentals: [],
    invoices: [],
    pickups: [item('old-pickup')],
    receipts: [],
    audit: [item('old-audit')],
    exceptions: [],
  } as unknown as AppState;
}

test('client applies ordered deltas, removal-only collections, replay and revision gaps', async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const cells = new Map<string, string>();
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => cells.get(key) ?? null,
      setItem: (key: string, value: string) => {
        cells.set(key, value);
      },
      removeItem: (key: string) => {
        cells.delete(key);
      },
    },
  });
  const responses: Array<{ path: string; body: unknown } | { path: string; fail: true }> = [];
  const actionBodies: Array<{ idempotencyKey: string }> = [];
  globalThis.fetch = async (url, init) => {
    const path = String(url);
    if (path === '/api/actions') actionBodies.push(JSON.parse(String(init?.body)));
    const next = responses.shift();
    assert.ok(next, `Unexpected request ${path}`);
    assert.equal(path, next.path);
    if ('fail' in next) throw new Error('network lost');
    return new Response(JSON.stringify(next.body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    responses.push({
      path: '/api/login',
      body: { user: { id: 'test-user' }, csrfToken: 'csrf', state: state(5), users: [] },
    });
    await login('user@example.test', 'Secret123456!');

    responses.push({
      path: '/api/actions',
      body: {
        message: 'Saved',
        entityId: 'new',
        delta: {
          baseRevision: 5,
          revision: 6,
          changed: { audit: [item('new-audit')], movements: [item('new-movement')] },
          removed: { pickups: ['old-pickup'] },
        },
      },
    });
    const first = await act('test.action', { sequence: 1 }, undefined, state(5));
    assert.deepEqual(
      first.state.audit.map((event) => event.id),
      ['new-audit', 'old-audit'],
    );
    assert.deepEqual(
      first.state.movements.map((event) => event.id),
      ['new-movement', 'old-movement'],
    );
    assert.deepEqual(first.state.pickups, []);
    assert.equal(first.state.revision, 6);

    responses.push({
      path: '/api/actions',
      body: {
        message: 'Saved',
        entityId: 'new',
        delta: { baseRevision: 6, revision: 6, changed: {}, removed: {} },
      },
    });
    const replay = await act('test.action', { sequence: 2 }, undefined, first.state);
    assert.deepEqual(
      replay.state.audit.map((event) => event.id),
      ['new-audit', 'old-audit'],
    );
    assert.equal(replay.state.revision, 6);

    responses.push(
      {
        path: '/api/actions',
        body: {
          message: 'Saved',
          entityId: 'another',
          delta: { baseRevision: 7, revision: 8, changed: {}, removed: {} },
        },
      },
      {
        path: '/api/bootstrap',
        body: { user: { id: 'test-user' }, csrfToken: 'csrf', state: state(8), users: [] },
      },
    );
    const gap = await act('test.action', { sequence: 3 }, undefined, first.state);
    assert.equal(gap.state.revision, 8);

    responses.push({ path: '/api/actions', fail: true });
    await assert.rejects(act('test.action', { sequence: 4 }, undefined, gap.state));
    responses.push({
      path: '/api/actions',
      body: {
        message: 'Saved',
        entityId: 'retry',
        delta: { baseRevision: 8, revision: 8, changed: {}, removed: {} },
      },
    });
    await act('test.action', { sequence: 4 }, undefined, gap.state);
    assert.equal(actionBodies.at(-1)?.idempotencyKey, actionBodies.at(-2)?.idempotencyKey);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, 'sessionStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});
