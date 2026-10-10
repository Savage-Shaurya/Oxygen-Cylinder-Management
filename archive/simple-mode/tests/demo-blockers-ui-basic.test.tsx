// Simple mode: honest save outcomes, honest undo, and a next step on every failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { indexedDB } from 'fake-indexeddb';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyAction, DomainError } from '../server/domain';
import { createSeedState } from '../server/seed';
import type { ActionRequest, ActionResult, AppState, Bootstrap, User } from '../shared/types';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
});
for (const key of [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'location',
  'sessionStorage',
  'history',
  'Event',
] as const)
  Object.defineProperty(globalThis, key, {
    value: key === 'window' ? dom.window : dom.window[key],
    configurable: true,
  });
Object.defineProperty(globalThis, 'indexedDB', { value: indexedDB, configurable: true });

const React = await import('react');
const { render, fireEvent, screen, waitFor, cleanup, within } =
  await import('@testing-library/react');
const { listQueuedDeliveries, discardQueuedDelivery } = await import('../src/offline');
// The App bundle has its own copy of the offline module with a cached encryption key, so
// tests remove records but keep the device key (clearing it would desync the two copies).
async function clearQueuedDeliveries(userId: string) {
  for (const record of await listQueuedDeliveries(userId))
    await discardQueuedDelivery(userId, record.id);
}
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/App.tsx', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  loader: { '.css': 'empty' },
  write: false,
});
const bundleDir = mkdtempSync(join(fileURLToPath(new URL('.', import.meta.url)), '.app-test-'));
const bundlePath = join(bundleDir, 'app.mjs');
writeFileSync(bundlePath, bundle.outputFiles[0].contents);
const { default: App } = await import(pathToFileURL(bundlePath).href);
rmSync(bundleDir, { recursive: true, force: true });

const COMMIT_WAIT = { timeout: 8000 };
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

function dispatchToDriver(state: AppState) {
  const order = state.orders.find((o) => o.id === 'o-open-1')!;
  const ids = state.cylinders
    .filter((c) => {
      const batch = state.batches.find((b) => b.id === c.batchId);
      return (
        c.branchId === order.branchId &&
        c.gas === order.gas &&
        c.size === order.size &&
        c.ownerId === 'company' &&
        c.custody === 'plant' &&
        c.condition === 'serviceable' &&
        c.contents === 'full' &&
        !!c.certificate &&
        c.testDue >= today &&
        c.lastTest <= today &&
        batch?.status === 'released' &&
        batch.branchId === order.branchId
      );
    })
    .slice(0, order.quantity)
    .map((c) => c.id);
  const admin: User = {
    id: 'u-admin',
    name: 'Seed Admin',
    email: 'admin@example.test',
    role: 'admin',
    branchIds: state.branches.map((b) => b.id),
    orgId: 'batra',
    active: true,
  };
  const result = applyAction(
    state,
    {
      type: 'order.dispatch',
      payload: { orderId: order.id, cylinderIds: ids, vehicle: 'DL 09 TEST', driverId: 'u-driver' },
      idempotencyKey: 'dispatch-for-driver',
      expectedRevision: state.revision,
    },
    { user: admin, now: new Date().toISOString(), id: () => `dispatch-${Math.random()}` },
  );
  return { state: result.state, orderId: order.id, ids };
}

const hash = (a: ActionRequest) =>
  createHash('sha256')
    .update(
      JSON.stringify({ type: a.type, payload: a.payload, expectedRevision: a.expectedRevision }),
    )
    .digest('hex');

/**
 * A fake server with real domain rules and real idempotency: a key commits once and its
 * saved result is replayed. `lose` drops the response after commit; `refuse` answers an error.
 */
function setup() {
  let state: AppState = createSeedState();
  state.settings.mode = 'live';
  const dispatched = dispatchToDriver(state);
  state = dispatched.state;
  const user: User = {
    id: 'u-driver',
    name: 'Demo Driver',
    email: 'driver@example.test',
    role: 'driver',
    branchIds: ['b-delhi'],
    orgId: 'batra',
    active: true,
  };
  const bootstrap: Bootstrap = { user, csrfToken: 'test-csrf', state, users: [] };
  const actions: ActionRequest[] = [];
  const committed = new Map<string, { hash: string; result: ActionResult }>();
  const lose = new Set<string>();
  const refuse = new Map<string, number>();
  let effects = 0;
  let sequence = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === '/api/bootstrap') return Response.json(bootstrap);
    if (path === '/api/health') return Response.json({ mode: 'live' });
    if (path === '/api/actions') {
      const action = JSON.parse(String(init?.body)) as ActionRequest;
      actions.push(action);
      const status = refuse.get(action.type);
      if (status) {
        refuse.delete(action.type);
        return Response.json({ error: 'Cylinder is not pending in manifest' }, { status });
      }
      const prior = committed.get(action.idempotencyKey);
      if (prior) {
        if (prior.hash !== hash(action))
          return Response.json({ error: 'Idempotency key reused' }, { status: 409 });
        return Response.json({ ...prior.result, state });
      }
      let result: ActionResult;
      try {
        result = applyAction(state, action, {
          user,
          now: new Date().toISOString(),
          id: () => `rendered-${++sequence}`,
        });
      } catch (error) {
        const failure = error as DomainError;
        return Response.json({ error: failure.message }, { status: failure.status || 400 });
      }
      effects++;
      state = result.state;
      bootstrap.state = state;
      committed.set(action.idempotencyKey, { hash: hash(action), result });
      if (lose.delete(action.type)) throw new TypeError('Failed to fetch');
      return Response.json(result);
    }
    if (path.startsWith('/voice/') || path === '/api/voice')
      return new Response(null, { status: 404 });
    throw new Error(`Unexpected request: ${path}`);
  };
  const dispose = () => {
    cleanup();
    globalThis.fetch = originalFetch;
  };
  return {
    state: () => state,
    actions,
    lose,
    refuse,
    effects: () => effects,
    dispatched,
    dispose,
  };
}

async function start() {
  render(React.createElement(App));
  await waitFor(() =>
    assert.ok(
      screen.queryByRole('button', { name: 'English' }) || document.querySelector('.b-tile'),
    ),
  );
  const english = screen.queryByRole('button', { name: 'English' });
  if (english) fireEvent.click(english);
  await waitFor(() => assert.ok(document.querySelector('.b-tile')));
}

function tile(label: string) {
  return screen.getByText(label, { selector: '.b-tile-label' }).closest('button')!;
}

async function openGive(h: ReturnType<typeof setup>) {
  fireEvent.click(tile('Give'));
  const party = h
    .state()
    .parties.find(
      (p) => p.id === h.state().orders.find((o) => o.id === h.dispatched.orderId)!.partyId,
    )!;
  fireEvent.click(await screen.findByRole('button', { name: `${party.name}, 3 left` }));
  await screen.findByText('Type code');
  return h.dispatched.ids.map((id) => h.state().cylinders.find((c) => c.id === id)!.tag);
}

function typeCode(code: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Type code' }));
  const sheet = screen.getByRole('dialog', { name: 'Type code' });
  fireEvent.change(within(sheet).getByLabelText('Cylinder code'), { target: { value: code } });
  fireEvent.submit(sheet.querySelector('form')!);
}

const tally = () => document.querySelector('.b-tally-number')!.firstChild!.textContent;

async function scanAndName(tags: string[], recipient: string) {
  typeCode(tags[0]);
  await waitFor(() => assert.equal(tally(), '1'));
  typeCode(tags[1]);
  await waitFor(() => assert.equal(tally(), '2'));
  fireEvent.click(screen.getByRole('button', { name: 'Done 2' }));
  await screen.findByText('Who took them?');
  fireEvent.click(screen.getByRole('button', { name: 'New name' }));
  const sheet = screen.getByRole('dialog', { name: 'New name' });
  fireEvent.change(within(sheet).getByLabelText('Name'), { target: { value: recipient } });
  fireEvent.submit(sheet.querySelector('form')!);
  await screen.findByRole('button', { name: /Undo/ });
}

test('a lost Give response says "not sure", keeps the same key on the phone, then shows the real result', async () => {
  const h = setup();
  try {
    await clearQueuedDeliveries('u-driver');
    await start();
    const tags = await openGive(h);
    await scanAndName(tags, 'Sister Rekha');
    h.lose.add('order.deliver');

    const unsure = await screen.findByText(
      'Not sure if it was saved. It will be checked.',
      {},
      COMMIT_WAIT,
    );
    const result = unsure.closest('.b-result')!;
    assert.equal(result.getAttribute('role'), 'status');
    assert.equal(document.querySelector('.b-tick'), null, 'no green tick without the server');
    assert.equal(screen.queryByText(/given to/, { selector: '.b-result-text' }), null);
    assert.equal(screen.queryByText(/not saved|No network/i), null, 'never "not saved"');
    assert.equal(document.activeElement, unsure, 'focus moves to the result heading');

    const queued = await listQueuedDeliveries('u-driver');
    assert.equal(queued.length, 1);
    assert.equal(queued[0].id, h.actions[0].idempotencyKey, 'the queue keeps the sent key');
    assert.equal(hash(queued[0].action), hash(h.actions[0]), 'and the sent payload');

    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    await screen.findByText('2 cylinders given to', { exact: false, selector: '.b-result-text' });
    assert.ok(document.querySelector('.b-tick'), 'the tick comes with the server answer');
    assert.equal(h.actions.length, 2);
    assert.equal(h.actions[1].idempotencyKey, h.actions[0].idempotencyKey);
    assert.equal(h.effects(), 1, 'delivered once');
    const order = h.state().orders.find((o) => o.id === h.dispatched.orderId)!;
    assert.deepEqual(order.deliveredIds, h.dispatched.ids.slice(0, 2));
    await waitFor(async () => assert.deepEqual(await listQueuedDeliveries('u-driver'), []));
  } finally {
    await clearQueuedDeliveries('u-driver');
    h.dispose();
  }
});

test('the countdown says leaving sends it, and leaving early reports the real result', async () => {
  const h = setup();
  try {
    await start();
    const tags = await openGive(h);
    await scanAndName(tags, 'Ward Clerk');
    assert.ok(screen.getByText('Leaving this screen sends it now.'));
    assert.equal(h.actions.length, 0);

    dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
    await waitFor(() => assert.ok(document.querySelector('.b-tile')));
    const toast = await screen.findByText(/Sent when you left the screen/, {}, COMMIT_WAIT);
    assert.match(toast.textContent ?? '', /2 cylinders given to/);
    assert.equal(toast.closest('[role="status"]') !== null, true);
    assert.equal(h.actions.length, 1, 'sent once, not dropped');
    assert.equal(h.effects(), 1);
  } finally {
    h.dispose();
  }
});

test('a refused Give focuses an alert and goes back to scan with the valid cylinders kept', async () => {
  const h = setup();
  try {
    await start();
    const tags = await openGive(h);
    await scanAndName(tags, 'Night Nurse');
    h.refuse.set('order.deliver', 409);

    const message = await screen.findByText(
      'Something changed. Check again.',
      { selector: '.b-result-text' },
      COMMIT_WAIT,
    );
    assert.equal(message.closest('.b-result')!.getAttribute('role'), 'alert');
    assert.equal(document.activeElement, message, 'focus moves to the result heading');
    assert.ok(screen.getByRole('button', { name: 'Home' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to scan' }));
    await screen.findByText('Type code');
    assert.equal(tally(), '2', 'still-valid cylinders stay scanned');
  } finally {
    h.dispose();
  }
});

test('a refused problem report offers Back to scan and Home', async () => {
  const h = setup();
  try {
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Problem' }));
    h.refuse.set('return.discrepancy', 500);
    fireEvent.click(await screen.findByRole('button', { name: 'No label' }));
    const message = await screen.findByText(
      'Problem. Call the office.',
      { selector: '.b-result-text' },
      COMMIT_WAIT,
    );
    assert.equal(document.activeElement, message);
    assert.ok(screen.getByRole('button', { name: 'Home' }));
    assert.ok(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to scan' }));
    await screen.findByRole('button', { name: 'No label' });
  } finally {
    h.dispose();
  }
});

test('a driver can open deliveries that need the office from the phone badge', async () => {
  const h = setup();
  try {
    await clearQueuedDeliveries('u-driver');
    const { queueDelivery } = await import('../src/offline');
    await queueDelivery('u-driver', {
      orderId: h.dispatched.orderId,
      cylinderIds: [h.dispatched.ids[2]],
      recipient: 'Old claim',
      notes: '',
    });
    h.refuse.set('order.deliver', 409);
    await start();
    const badge = await screen.findByRole('button', { name: /1 waiting/ });
    fireEvent.click(badge);
    // The server refused it, so it now needs the office and must stay reachable.
    const review = await screen.findByRole('button', { name: /need the office/ });
    assert.equal((review as HTMLButtonElement).disabled, false);
    fireEvent.click(review);
    const sheet = await screen.findByRole('dialog', { name: 'Deliveries kept on this phone' });
    assert.ok(await within(sheet).findByRole('button', { name: 'Review evidence' }));
  } finally {
    await clearQueuedDeliveries('u-driver');
    h.dispose();
  }
});
