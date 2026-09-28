import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { JSDOM } from 'jsdom';
import { createElement } from 'react';
import type { AppState, Order, User } from '../shared/types';
import {
  queueDelivery,
  listQueuedDeliveries,
  syncQueuedDeliveries,
  discardQueuedDelivery,
  clearQueuedDeliveries,
} from '../src/offline';

Object.assign(globalThis, {
  indexedDB,
  window: new EventTarget(),
});

const payload = (orderId: string) => ({
  orderId,
  cylinderIds: ['c-1'],
  recipient: 'Receiving staff',
  notes: '',
});

test('encrypted records are scoped to their owner and discard is owner only', async () => {
  const record = await queueDelivery('scope-owner', payload('scope-order'));
  assert.deepEqual(await listQueuedDeliveries('scope-other'), []);
  assert.deepEqual(
    (await listQueuedDeliveries('scope-owner')).map((row) => row.id),
    [record.id],
  );
  await assert.rejects(discardQueuedDelivery('scope-other', record.id), /another user/);
  assert.equal((await listQueuedDeliveries('scope-owner')).length, 1);
  await clearQueuedDeliveries('scope-owner');
});

test('concurrent saves for the same order retain only one queued delivery', async () => {
  const userId = 'parallel-owner';
  const results = await Promise.allSettled([
    queueDelivery(userId, payload('parallel-order')),
    queueDelivery(userId, payload('parallel-order')),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal((await listQueuedDeliveries(userId)).length, 1);
  await clearQueuedDeliveries(userId);
});

test('ambiguous network failure keeps the same idempotency key for retry', async () => {
  const userId = 'retry-owner';
  const record = await queueDelivery(userId, payload('retry-order'));
  const submitted: string[] = [];
  let attempt = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const action = JSON.parse(String(options?.body));
    submitted.push(action.idempotencyKey);
    attempt++;
    if (attempt === 1) throw new Error('connection lost after server accepted request');
    return new Response(JSON.stringify({ state: {}, message: 'Delivered' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    await assert.rejects(syncQueuedDeliveries(userId), /Connection unavailable/);
    assert.equal((await listQueuedDeliveries(userId)).length, 1);
    assert.deepEqual(await syncQueuedDeliveries(userId), { accepted: 1, conflicts: 0 });
    assert.deepEqual(submitted, [record.id, record.id]);
    assert.deepEqual(await listQueuedDeliveries(userId), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('independent offline deliveries from one snapshot both synchronize', async () => {
  const userId = 'multi-owner';
  await queueDelivery(userId, payload('multi-order-1'));
  await queueDelivery(userId, payload('multi-order-2'));
  let serverRevision = 4;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const action = JSON.parse(String(options?.body));
    if (action.expectedRevision !== undefined && action.expectedRevision !== serverRevision)
      return new Response(JSON.stringify({ error: 'State changed; refresh and retry' }), {
        status: 409,
      });
    serverRevision++;
    return new Response(JSON.stringify({ state: {}, message: 'Delivered' }), { status: 200 });
  };
  try {
    assert.deepEqual(await syncQueuedDeliveries(userId), { accepted: 2, conflicts: 0 });
    assert.equal(serverRevision, 6);
    assert.deepEqual(await listQueuedDeliveries(userId), []);
  } finally {
    globalThis.fetch = originalFetch;
    await clearQueuedDeliveries(userId);
  }
});

test('a server conflict keeps evidence for office review without replaying it', async () => {
  const userId = 'conflict-owner';
  const record = await queueDelivery(userId, payload('conflict-order'));
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ error: 'Cylinder is not pending in manifest' }), {
      status: 409,
    });
  };
  try {
    assert.deepEqual(await syncQueuedDeliveries(userId), { accepted: 0, conflicts: 1 });
    const [saved] = await listQueuedDeliveries(userId);
    assert.equal(saved.id, record.id);
    assert.equal(saved.status, 'conflict');
    assert.match(saved.error!, /not pending/);
    assert.deepEqual(await syncQueuedDeliveries(userId), { accepted: 0, conflicts: 1 });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await clearQueuedDeliveries(userId);
  }
});

test('expired sign-in leaves evidence pending for retry with the same key', async () => {
  const userId = 'auth-retry-owner';
  const record = await queueDelivery(userId, payload('auth-retry-order'));
  const originalFetch = globalThis.fetch;
  const submitted: string[] = [];
  let attempt = 0;
  globalThis.fetch = async (_url, options) => {
    submitted.push(JSON.parse(String(options?.body)).idempotencyKey);
    attempt++;
    return attempt === 1
      ? new Response(JSON.stringify({ error: 'Sign in required' }), { status: 401 })
      : new Response(JSON.stringify({ state: {}, message: 'Delivered' }), { status: 200 });
  };
  try {
    await assert.rejects(syncQueuedDeliveries(userId), /Sign in again/);
    assert.equal((await listQueuedDeliveries(userId))[0].status, 'pending');
    assert.deepEqual(await syncQueuedDeliveries(userId), { accepted: 1, conflicts: 0 });
    assert.deepEqual(submitted, [record.id, record.id]);
  } finally {
    globalThis.fetch = originalFetch;
    await clearQueuedDeliveries(userId);
  }
});

test('CSRF rejection is retryable while an authorization 403 remains a conflict', async () => {
  const userId = 'csrf-retry-owner';
  await queueDelivery(userId, payload('csrf-retry-order'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'Invalid CSRF token' }), { status: 403 });
  try {
    await assert.rejects(syncQueuedDeliveries(userId), /Sign in again/);
    assert.equal((await listQueuedDeliveries(userId))[0].status, 'pending');
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: 'Driver is not assigned' }), { status: 403 });
    assert.deepEqual(await syncQueuedDeliveries(userId), { accepted: 0, conflicts: 1 });
    assert.equal((await listQueuedDeliveries(userId))[0].status, 'conflict');
  } finally {
    globalThis.fetch = originalFetch;
    await clearQueuedDeliveries(userId);
  }
});

test('offline panel clears the previous account’s evidence on user switch', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
  });
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  const oldEvent = globalThis.Event;
  const oldNavigator = globalThis.navigator;
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Event: dom.window.Event,
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: dom.window.navigator,
  });
  const { render, waitFor, cleanup } = await import('@testing-library/react');
  const { default: OfflinePanel } = await import('../src/OfflinePanel');
  const owner = { id: 'panel-owner' } as User;
  const other = { id: 'panel-other' } as User;
  try {
    await queueDelivery(owner.id, payload('private-order'));
    const state = {
      orders: [{ id: 'private-order', number: 'DC-123', partyId: 'party-1' }],
      parties: [{ id: 'party-1', name: 'Clinic' }],
      cylinders: [{ id: 'c-1', tag: 'TAG-1' }],
    } as unknown as AppState;
    const view = render(createElement(OfflinePanel, { user: owner, onSynced: () => {}, state }));
    await waitFor(() =>
      assert.equal(view.container.querySelector('strong')?.textContent, '1 saved delivery'),
    );
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.click(view.getByRole('button', { name: 'Review evidence' }));
    assert.match(view.container.textContent || '', /DC-123 · Clinic/);
    assert.match(view.container.textContent || '', /TAG-1/);
    assert.doesNotMatch(view.container.textContent || '', /private-order|c-1/);
    assert.match(view.container.textContent || '', /Sign out requires a connection/);
    view.rerender(createElement(OfflinePanel, { user: other, onSynced: () => {} }));
    assert.equal(view.container.querySelector('strong'), null);
  } finally {
    cleanup();
    await clearQueuedDeliveries(owner.id);
    Object.assign(globalThis, { window: oldWindow, document: oldDocument, Event: oldEvent });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: oldNavigator });
    dom.window.close();
  }
});

test('queued delivery retains the device handover time through synchronization', async () => {
  const userId = 'handover-time-owner';
  const record = await queueDelivery(userId, payload('handover-order'));
  const originalFetch = globalThis.fetch;
  let receivedAt = '';
  globalThis.fetch = async (_url, options) => {
    receivedAt = JSON.parse(String(options?.body)).payload.occurredAt;
    return new Response(JSON.stringify({ state: {}, message: 'Delivered' }), { status: 200 });
  };
  try {
    assert.equal(record.action.payload.occurredAt, record.createdAt);
    assert.deepEqual(await syncQueuedDeliveries(userId), { accepted: 1, conflicts: 0 });
    assert.equal(receivedAt, record.createdAt);
  } finally {
    globalThis.fetch = originalFetch;
    await clearQueuedDeliveries(userId);
  }
});

test('printed challan shows recorded movement by cylinder identifier safely', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
  });
  const printDom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  const oldEvent = globalThis.Event;
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Event: dom.window.Event,
  });
  let prints = 0;
  Object.assign(printDom.window, { focus: () => {}, print: () => prints++ });
  dom.window.open = () => printDom.window as unknown as Window;
  const { render, fireEvent, cleanup } = await import('@testing-library/react');
  const { default: PrintChallan } = await import('../src/PrintChallan');
  const order = {
    number: 'DC-001',
    partyId: 'party-1',
    gas: 'Medical oxygen',
    size: 'B',
    vehicle: 'Truck 1',
    recipient: 'Ravi',
    status: 'partial',
    quantity: 3,
    cylinderIds: ['c-1', 'c-2', 'c-3'],
    deliveredIds: ['c-1'],
    unloadedIds: ['c-2'],
    challanSnapshot: {
      issuer: { companyName: 'Original Batra', address: 'Original Delhi', gstin: 'OLD-GST' },
      recipient: {
        name: 'Original Hospital',
        address: 'Original Street',
        city: 'Delhi',
        gstin: 'PARTY-GST',
      },
    },
  } as unknown as Order;
  const state = {
    settings: { companyName: 'Batra', address: 'Delhi', mode: 'demo' },
    parties: [{ id: 'party-1', name: 'Hospital', address: 'Street', city: 'Delhi' }],
    cylinders: [
      { id: 'c-1', serial: 'SER-1', tag: 'TAG-1' },
      { id: 'c-2', serial: 'SER-2', tag: 'TAG-2' },
      { id: 'c-3', serial: '<script>unsafe</script>', tag: 'TAG-3' },
    ],
  } as unknown as AppState;
  try {
    const view = render(createElement(PrintChallan, { order, state }));
    fireEvent.click(view.getByRole('button', { name: /Print challan/ }));
    const rows = [...printDom.window.document.querySelectorAll('tr')].slice(1);
    assert.deepEqual(
      rows.map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent)),
      [
        ['1', 'SER-1', 'TAG-1', 'Accepted'],
        ['2', 'SER-2', 'TAG-2', 'Unloaded at plant'],
        ['3', '<script>unsafe</script>', 'TAG-3', 'On vehicle'],
      ],
    );
    assert.equal(printDom.window.document.querySelector('script'), null);
    assert.match(printDom.window.document.body.textContent || '', /Original Batra/);
    assert.match(printDom.window.document.body.textContent || '', /Original Hospital/);
    assert.match(printDom.window.document.body.textContent || '', /OLD-GST/);
    assert.match(printDom.window.document.body.textContent || '', /PARTY-GST/);
    assert.equal(prints, 1);
    printDom.window.document.body.replaceChildren();
    view.rerender(createElement(PrintChallan, { order: { ...order, challanSnapshot: undefined }, state }));
    fireEvent.click(view.getByRole('button', { name: /Print challan/ }));
    const legacy = printDom.window.document.body.textContent || '';
    assert.match(legacy, /Historical identity snapshot unavailable/);
    assert.match(legacy, /Historical issuer unavailable/);
    assert.match(legacy, /Historical customer unavailable/);
    assert.doesNotMatch(legacy, /Batra|Hospital|OLD-GST|PARTY-GST/);
  } finally {
    cleanup();
    Object.assign(globalThis, { window: oldWindow, document: oldDocument, Event: oldEvent });
    dom.window.close();
    printDom.window.close();
  }
});
