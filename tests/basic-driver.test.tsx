import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { indexedDB } from 'fake-indexeddb';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyAction, DomainError } from '../server/domain';
import { createSeedState } from '../server/seed';
import type { ActionRequest, AppState, Bootstrap, User } from '../shared/types';
import en from '../src/i18n/en';
import hi from '../src/i18n/hi';

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
const { listQueuedDeliveries, clearQueuedDeliveries } = await import('../src/offline');
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

/** Dispatches the open Delhi order to the seed driver, as an admin would in the office. */
function dispatchToDriver(state: AppState): { state: AppState; orderId: string; ids: string[] } {
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
  assert.equal(ids.length, order.quantity, 'seed needs enough dispatchable cylinders');
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

function setup(role: User['role'] = 'driver', options: { offline?: boolean } = {}) {
  let state: AppState = createSeedState();
  state.settings.mode = 'live';
  let dispatched = { orderId: '', ids: [] as string[] };
  if (role === 'driver') {
    const result = dispatchToDriver(state);
    state = result.state;
    dispatched = result;
  }
  const delhi = state.branches.find((b) => b.id === 'b-delhi')!;
  const user: User =
    role === 'driver'
      ? {
          id: 'u-driver',
          name: 'Demo Driver',
          email: 'driver@example.test',
          role,
          branchIds: [delhi.id],
          orgId: 'batra',
          active: true,
        }
      : {
          id: `u-${role}-${Math.random().toString(36).slice(2)}`,
          name: `Test ${role}`,
          email: `${role}@example.test`,
          role,
          branchIds: state.branches.map((b) => b.id),
          orgId: 'batra',
          active: true,
        };
  const bootstrap: Bootstrap = { user, csrfToken: 'test-csrf', state, users: [] };
  const actions: ActionRequest[] = [];
  const originalFetch = globalThis.fetch;
  let sequence = 0;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === '/api/bootstrap') return Response.json(bootstrap);
    if (path === '/api/health') return Response.json({ mode: 'live' });
    if (path === '/api/actions') {
      if (options.offline) throw new TypeError('Failed to fetch');
      const action = JSON.parse(String(init?.body)) as ActionRequest;
      actions.push(action);
      try {
        const result = applyAction(state, action, {
          user,
          now: new Date().toISOString(),
          id: () => `rendered-${++sequence}`,
        });
        state = result.state;
        bootstrap.state = state;
        return Response.json(result);
      } catch (error) {
        const failure = error as DomainError;
        return Response.json({ error: failure.message }, { status: failure.status || 400 });
      }
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const dispose = () => {
    cleanup();
    globalThis.fetch = originalFetch;
  };
  return { state: () => state, user, actions, dispatched, dispose };
}

/** Renders the app and answers the first-use language picker if it is showing. */
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
  const button = screen.getByText(label, { selector: '.b-tile-label' }).closest('button');
  assert.ok(button, `tile ${label}`);
  return button;
}

/** Opens Give and the dispatched order, and returns the cylinder tags on it. */
async function openGive(h: ReturnType<typeof setup>) {
  fireEvent.click(tile('Give'));
  const party = h
    .state()
    .parties.find(
      (p) => p.id === h.state().orders.find((o) => o.id === h.dispatched.orderId)!.partyId,
    )!;
  fireEvent.click(await screen.findByRole('button', { name: `${party.name}, 3 left` }));
  await screen.findByText('Type code');
  return {
    party,
    tags: h.dispatched.ids.map((id) => h.state().cylinders.find((c) => c.id === id)!.tag),
  };
}

function typeCode(code: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Type code' }));
  const sheet = screen.getByRole('dialog', { name: 'Type code' });
  fireEvent.change(within(sheet).getByLabelText('Cylinder code'), { target: { value: code } });
  fireEvent.submit(sheet.querySelector('form')!);
}

function pickFromList(code: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Pick from list' }));
  const sheet = screen.getByRole('dialog', { name: 'Pick from list' });
  fireEvent.click(within(sheet).getByText(code).closest('button')!);
  fireEvent.click(within(sheet).getAllByRole('button', { name: 'Close' })[0]);
}

function tally() {
  return document.querySelector('.b-tally-number')!.firstChild!.textContent;
}

async function scanAndName(tags: string[], recipient: string) {
  typeCode(tags[0]);
  await waitFor(() => assert.equal(tally(), '1'));
  pickFromList(tags[1]);
  await waitFor(() => assert.equal(tally(), '2'));
  fireEvent.click(screen.getByRole('button', { name: 'Done 2' }));
  await screen.findByText('Who took them?');
  fireEvent.click(screen.getByRole('button', { name: 'New name' }));
  const sheet = screen.getByRole('dialog', { name: 'New name' });
  fireEvent.change(within(sheet).getByLabelText('Name'), { target: { value: recipient } });
  fireEvent.submit(sheet.querySelector('form')!);
  await screen.findByRole('button', { name: /Undo/ });
}

test('a driver sees the Basic home tiles and not the office sidebar', async () => {
  const h = setup('driver');
  try {
    await start();
    for (const label of ['Give', 'Take back', 'My truck', 'Scan']) assert.ok(tile(label));
    assert.equal(screen.queryByRole('navigation', { name: 'Main navigation' }), null);
    assert.equal(screen.queryByRole('button', { name: 'Office mode' }), null);
    assert.equal(screen.queryByText('Suppliers & purchases'), null);
  } finally {
    h.dispose();
  }
});

test('Give posts exactly one order.deliver with the scanned cylinders after the wait', async () => {
  const h = setup('driver');
  try {
    await start();
    const { tags } = await openGive(h);
    await scanAndName(tags, 'Sister Rekha');
    assert.equal(h.actions.length, 0, 'nothing is sent during the undo wait');
    await waitFor(() => assert.equal(h.actions.length, 1), COMMIT_WAIT);
    await screen.findByText('2 cylinders given to', { exact: false });
    const [action] = h.actions;
    assert.equal(action.type, 'order.deliver');
    assert.equal(action.payload.orderId, h.dispatched.orderId);
    assert.deepEqual(action.payload.cylinderIds, h.dispatched.ids.slice(0, 2));
    assert.equal(action.payload.recipient, 'Sister Rekha');
    const order = h.state().orders.find((o) => o.id === h.dispatched.orderId)!;
    assert.deepEqual(order.deliveredIds, h.dispatched.ids.slice(0, 2));
    assert.equal(order.status, 'partial');
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(h.actions.length, 1, 'the delivery is sent once');
  } finally {
    h.dispose();
  }
});

test('Undo during the wait sends nothing', async () => {
  const h = setup('driver');
  try {
    await start();
    const { tags } = await openGive(h);
    await scanAndName(tags, 'Ward Clerk');
    fireEvent.click(screen.getByRole('button', { name: /Undo/ }));
    await screen.findByText('Type code');
    assert.equal(tally(), '2', 'the same cylinders stay scanned');
    await new Promise((resolve) => setTimeout(resolve, 6000));
    assert.equal(h.actions.length, 0);
  } finally {
    h.dispose();
  }
});

test('a cylinder that is not on the order is rejected and not counted', async () => {
  const h = setup('driver');
  try {
    await start();
    const { tags } = await openGive(h);
    const other = h
      .state()
      .cylinders.find((c) => !h.dispatched.ids.includes(c.id) && c.custody === 'plant')!;
    typeCode(other.tag);
    await screen.findByText('Not on this order.');
    assert.equal(tally(), '0');
    assert.equal(screen.queryByRole('button', { name: /^Done/ }), null);
    typeCode('NO-SUCH-CODE');
    await screen.findByText('This code is not known.');
    assert.equal(tally(), '0');
    typeCode(tags[2]);
    await waitFor(() => assert.equal(tally(), '1'));
    assert.equal(h.actions.length, 0);
  } finally {
    h.dispose();
  }
});

test('Give saves to the phone queue when the network is down', async () => {
  const h = setup('driver', { offline: true });
  try {
    await clearQueuedDeliveries('u-driver');
    await start();
    const { tags } = await openGive(h);
    await scanAndName(tags, 'Night Nurse');
    await screen.findByText('Saved on phone. It will send later.', {}, COMMIT_WAIT);
    const queued = await listQueuedDeliveries('u-driver');
    assert.equal(queued.length, 1);
    assert.equal(queued[0].action.type, 'order.deliver');
    assert.equal(queued[0].action.payload.orderId, h.dispatched.orderId);
    assert.deepEqual(queued[0].action.payload.cylinderIds, h.dispatched.ids.slice(0, 2));
    assert.equal(queued[0].action.payload.recipient, 'Night Nurse');
    assert.equal(h.actions.length, 0);
  } finally {
    await clearQueuedDeliveries('u-driver');
    h.dispose();
  }
});

test('every English phrase has a Hindi translation', () => {
  const hindi = hi as Record<string, unknown>;
  for (const key of Object.keys(en)) {
    assert.equal(typeof hindi[key], 'string', `hi.ts is missing ${key}`);
    assert.ok(String(hindi[key]).trim(), `hi.ts has an empty ${key}`);
  }
});

test('operations users can switch from Basic mode to the office shell', async () => {
  const h = setup('operations');
  try {
    await start();
    assert.equal(screen.queryByRole('navigation', { name: 'Main navigation' }), null);
    fireEvent.click(screen.getAllByRole('button', { name: 'Office mode' })[0]);
    await screen.findByRole('navigation', { name: 'Main navigation' });
    assert.ok(screen.getByRole('button', { name: 'Simple mode' }));
  } finally {
    h.dispose();
  }
});
