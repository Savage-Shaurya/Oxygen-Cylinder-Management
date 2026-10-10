// LS-03: one immutable command envelope from the first send, through the device queue, to sync.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { indexedDB } from 'fake-indexeddb';
import type { ActionRequest } from '../shared/types';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.defineProperty(globalThis, 'sessionStorage', {
  value: dom.window.sessionStorage,
  configurable: true,
});
Object.assign(globalThis, { indexedDB, window: new EventTarget() });

const api = await import('../src/api');
const offline = await import('../src/offline');

const USER = 'envelope-user';
const deliverPayload = (orderId: string) => ({
  orderId,
  cylinderIds: ['c-1', 'c-2'],
  recipient: 'Sister Rekha',
  notes: '',
});

/** The server's idempotency hash: JSON.stringify of type, payload and expected revision. */
const serverHash = (action: ActionRequest) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        type: action.type,
        payload: action.payload,
        expectedRevision: action.expectedRevision,
      }),
    )
    .digest('hex');

/** A fake server that commits once per key and replays the saved result for the same key. */
function server(options: { loseFirstResponse?: boolean } = {}) {
  const seen: ActionRequest[] = [];
  const committed = new Map<string, string>();
  let effects = 0;
  let lose = !!options.loseFirstResponse;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === '/api/bootstrap')
      return Response.json({
        user: { id: USER, name: 'Envelope', role: 'driver', branchIds: [] },
        csrfToken: 'csrf',
        state: { revision: 1 },
        users: [],
      });
    const action = JSON.parse(String(init?.body)) as ActionRequest;
    seen.push(action);
    const prior = committed.get(action.idempotencyKey);
    if (prior !== undefined && prior !== serverHash(action))
      return Response.json(
        { error: 'Idempotency key reused with different request' },
        { status: 409 },
      );
    if (prior === undefined) {
      committed.set(action.idempotencyKey, serverHash(action));
      effects++;
    }
    if (lose) {
      lose = false;
      throw new TypeError('Failed to fetch');
    }
    return Response.json({ state: { revision: 2 }, message: 'Delivered' });
  };
  return { seen, effects: () => effects };
}

const originalFetch = globalThis.fetch;
server();
await api.bootstrap();

test('a lost response leaves an ambiguous error that exposes the exact envelope it sent', async () => {
  const fake = server({ loseFirstResponse: true });
  try {
    const error = await api.act('order.deliver', deliverPayload('o-exposed')).then(
      () => assert.fail('the lost response must not resolve'),
      (failure: unknown) => failure,
    );
    assert.ok(error instanceof api.ApiError);
    assert.equal(error.status, 0);
    assert.doesNotMatch(error.message, /have not been posted/, 'a lost response may have posted');
    assert.match(error.message, /Connection unavailable/);
    assert.match(error.message, /confirm/i);
    assert.equal(api.isUncertain(error), true);
    assert.deepEqual(api.actionEnvelope(error), fake.seen[0]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the queue stores and replays the very key and payload of the first send', async () => {
  const fake = server({ loseFirstResponse: true });
  try {
    await offline.clearQueuedDeliveries(USER);
    const error = await api.act('order.deliver', deliverPayload('o-replayed')).catch((e) => e);
    const envelope = api.actionEnvelope(error)!;
    assert.ok(envelope, 'the ambiguous failure carries its envelope');

    const record = await offline.queueDelivery(USER, envelope.payload, envelope);
    assert.equal(record.id, fake.seen[0].idempotencyKey);
    assert.deepEqual(record.action, fake.seen[0], 'nothing in the envelope changes in the queue');

    // Saving the same evidence again (a retry tap) keeps the one record.
    const again = await offline.queueDelivery(USER, envelope.payload, envelope);
    assert.equal(again.id, record.id);
    assert.equal((await offline.listQueuedDeliveries(USER)).length, 1);

    assert.deepEqual(await offline.syncQueuedDeliveries(USER), { accepted: 1, conflicts: 0 });
    assert.equal(fake.seen.length, 2);
    assert.equal(fake.seen[1].idempotencyKey, fake.seen[0].idempotencyKey);
    assert.equal(serverHash(fake.seen[1]), serverHash(fake.seen[0]), 'same server fingerprint');
    assert.equal(fake.effects(), 1, 'the committed delivery is reconciled, not repeated');
    assert.deepEqual(await offline.listQueuedDeliveries(USER), []);
  } finally {
    globalThis.fetch = originalFetch;
    await offline.clearQueuedDeliveries(USER);
  }
});

test('evidence saved on the device after an unconfirmed send reuses that send key', async () => {
  const fake = server({ loseFirstResponse: true });
  try {
    await offline.clearQueuedDeliveries(USER);
    await api.act('order.deliver', deliverPayload('o-office-alt')).catch(() => undefined);
    // The office form's "Save evidence on device" passes only the same field values.
    const record = await offline.queueDelivery(USER, deliverPayload('o-office-alt'));
    assert.equal(record.id, fake.seen[0].idempotencyKey);
    assert.equal(serverHash(record.action), serverHash(fake.seen[0]));
  } finally {
    globalThis.fetch = originalFetch;
    await offline.clearQueuedDeliveries(USER);
  }
});

test('a retried act after an unconfirmed send replays the same key once', async () => {
  const fake = server({ loseFirstResponse: true });
  try {
    await assert.rejects(api.act('order.deliver', deliverPayload('o-retry')), api.ApiError);
    const result = await api.act('order.deliver', deliverPayload('o-retry'));
    assert.equal(result.message, 'Delivered');
    assert.equal(fake.seen[1].idempotencyKey, fake.seen[0].idempotencyKey);
    assert.equal(fake.effects(), 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a fresh device-only delivery still records its handover time', async () => {
  try {
    await offline.clearQueuedDeliveries(USER);
    const record = await offline.queueDelivery(USER, deliverPayload('o-fresh'));
    assert.equal(record.action.payload.occurredAt, record.createdAt);
    assert.equal(record.id, record.action.idempotencyKey);
  } finally {
    await offline.clearQueuedDeliveries(USER);
  }
});
