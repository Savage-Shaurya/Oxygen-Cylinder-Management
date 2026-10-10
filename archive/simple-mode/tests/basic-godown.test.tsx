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

function setup(role: User['role']) {
  dom.window.localStorage.clear();
  let state: AppState = createSeedState();
  state.settings.mode = 'live';
  const user: User = {
    id: 'u-admin',
    name: 'Test Helper',
    email: 'helper@example.test',
    role,
    branchIds: state.branches.map((branch) => branch.id),
    orgId: 'batra',
    active: true,
  };
  const driver: User = {
    id: 'u-driver',
    name: 'Ramesh Driver',
    email: 'driver@example.test',
    role: 'driver',
    branchIds: ['b-delhi'],
    orgId: 'batra',
    active: true,
  };
  // Quality starts in Office mode; this phone has chosen Basic.
  if (role === 'quality') dom.window.localStorage.setItem(`cylvero-mode:${user.id}`, 'basic');
  const bootstrap: Bootstrap = { user, csrfToken: 'test-csrf', state, users: [user, driver] };
  const actions: ActionRequest[] = [];
  const failOnce = new Set<string>();
  const originalFetch = globalThis.fetch;
  let sequence = 0;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === '/api/bootstrap') return Response.json(bootstrap);
    if (path === '/api/health') return Response.json({ mode: 'live' });
    if (path === '/api/actions') {
      const action = JSON.parse(String(init?.body)) as ActionRequest;
      actions.push(action);
      if (failOnce.delete(action.type))
        return Response.json({ error: 'Simulated failure' }, { status: 500 });
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
  return { state: () => state, actions, failOnce, dispose };
}

/** Renders the app, answers the first-use language picker, and opens a home tile. */
async function openJob(tile: string) {
  render(React.createElement(App));
  await waitFor(() =>
    assert.ok(
      screen.queryByRole('button', { name: 'English' }) || document.querySelector('.b-tile'),
    ),
  );
  const english = screen.queryByRole('button', { name: 'English' });
  if (english) fireEvent.click(english);
  const label = await screen.findByText(tile, { selector: '.b-tile-label' });
  fireEvent.click(label.closest('button')!);
}

function pick(...tags: string[]) {
  fireEvent.click(screen.getByRole('button', { name: 'Pick from list' }));
  const sheet = screen.getByRole('dialog', { name: 'Pick from list' });
  for (const tag of tags) fireEvent.click(within(sheet).getByText(tag).closest('button')!);
  fireEvent.click(within(sheet.parentElement!).getAllByRole('button', { name: 'Close' })[0]);
}

function typeCode(code: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Type code' }));
  const sheet = screen.getByRole('dialog', { name: 'Type code' });
  fireEvent.change(within(sheet).getByRole('textbox'), { target: { value: code } });
  fireEvent.submit(sheet.querySelector('form')!);
}

const done = () => fireEvent.click(screen.getByRole('button', { name: /^Done/ }));

test('Load truck refuses a wrong cylinder and dispatches exactly the order quantity', async () => {
  const h = setup('operations');
  try {
    await openJob('Load truck');
    // Urgent order first.
    const cards = document.querySelectorAll('.b-list .b-card');
    assert.match(cards[0].getAttribute('aria-label') ?? '', /Demo City General Hospital.*Urgent/);
    fireEvent.click(screen.getByRole('button', { name: /^Demo North Care Hospital/ }));

    typeCode('DEMO-TAG-00010'); // Size D: wrong for a size B order.
    await screen.findByText('Wrong size or gas.');
    typeCode('DEMO-TAG-00011'); // Owned by a customer: only the office may load it.
    await screen.findByText('Ask office to load this one.');
    assert.equal(screen.queryByRole('button', { name: /^Done/ }), null);

    pick('DEMO-TAG-00006', 'DEMO-TAG-00008');
    assert.equal(screen.queryByRole('button', { name: /^Done/ }), null, 'Done waits for 3 of 3');
    pick('DEMO-TAG-00009');
    done();

    // The driver's last truck is guessed; change it.
    assert.ok(screen.getByRole('button', { name: 'Ramesh Driver, DL 02 DEMO' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change Ramesh Driver' }));
    const sheet = screen.getByRole('dialog', { name: 'Truck number' });
    fireEvent.change(within(sheet).getByRole('textbox'), { target: { value: 'dl 09 xy 1111' } });
    fireEvent.submit(sheet.querySelector('form')!);
    fireEvent.click(screen.getByRole('button', { name: 'Ramesh Driver, DL 09 XY 1111' }));

    await waitFor(() => assert.equal(h.actions.length, 1), COMMIT_WAIT);
    const action = h.actions[0];
    assert.equal(action.type, 'order.dispatch');
    assert.deepEqual(action.payload, {
      orderId: 'o-open-1',
      cylinderIds: ['c-006', 'c-008', 'c-009'],
      vehicle: 'DL 09 XY 1111',
      driverId: 'u-driver',
    });
    assert.equal(h.state().orders.find((o) => o.id === 'o-open-1')?.status, 'dispatched');
    await screen.findByText('3 cylinders loaded for Demo North Care Hospital.', {
      selector: '.b-result-text',
    });
    assert.equal(
      dom.window.localStorage.getItem('cylvero-driver-vehicle:u-driver'),
      'DL 09 XY 1111',
    );
  } finally {
    h.dispose();
  }
});

test('Came back sorts scans, returns customer empties and unloads truck stock, retrying only failed groups', async () => {
  const h = setup('operations');
  try {
    await openJob('Came back');
    typeCode('DEMO-TAG-00006'); // Already at the godown.
    await screen.findByText('Already in the godown.');
    pick('DEMO-TAG-00001', 'DEMO-TAG-00002', 'DEMO-TAG-00004');

    const empties = screen.getByText('Empty from customers').nextElementSibling as HTMLElement;
    assert.ok(within(empties).getByText('Demo North Care Hospital'));
    const fulls = screen.getByText('Full, back from truck').nextElementSibling as HTMLElement;
    assert.ok(within(fulls).getByText('Demo Home Oxygen Service A'));

    done();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, seals OK' }));
    fireEvent.click(screen.getByRole('button', { name: 'All empty' }));

    h.failOnce.add('order.unload');
    await waitFor(() => assert.equal(h.actions.length, 2), COMMIT_WAIT);
    const [returned, unloaded] = h.actions;
    assert.equal(returned.type, 'cylinder.return');
    assert.deepEqual(returned.payload, {
      partyId: 'p-hospital-1',
      cylinderIds: ['c-001', 'c-002'],
      contents: 'empty',
      receivingBranchId: 'b-delhi',
      notes: 'Received by scan in simple mode. Helper said: all empty.',
    });
    assert.equal(unloaded.type, 'order.unload');

    // One group worked, one failed: the result says which.
    await screen.findByText('Some were not saved. Try again.');
    assert.ok(screen.getByText(/Demo North Care Hospital, empty 2/).closest('li.ok'));
    assert.ok(screen.getByText(/Demo Home Oxygen Service A, full 1/).closest('li.bad'));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => assert.equal(h.actions.length, 3), COMMIT_WAIT);
    assert.equal(h.actions[2].type, 'order.unload', 'only the failed group is sent again');
    assert.deepEqual(h.actions[2].payload, {
      orderId: 'o-partial-1',
      cylinderIds: ['c-004'],
      sealIntact: true,
      notes: 'Unloaded by scan in simple mode. Helper said: seals OK.',
    });
    await screen.findByText('3 cylinders back in the godown.', { selector: '.b-result-text' });
    const c004 = h.state().cylinders.find((c) => c.id === 'c-004')!;
    assert.equal(c004.custody, 'plant');
    assert.equal(c004.condition, 'serviceable');
    assert.equal(h.state().cylinders.find((c) => c.id === 'c-001')?.contents, 'empty');
  } finally {
    h.dispose();
  }
});

test('Filled creates a fill batch from scanned empties and the chosen tank', async () => {
  const h = setup('operations');
  try {
    await openJob('Filled');
    pick('DEMO-TAG-00030');
    typeCode('DEMO-TAG-00035'); // Industrial oxygen after a medical one.
    await screen.findByText('Different gas.');
    typeCode('DEMO-TAG-00006'); // Already full.
    await screen.findByText('Not empty.');
    pick('DEMO-TAG-00031');
    done();

    fireEvent.click(screen.getByRole('button', { name: 'New tank' }));
    const sheet = screen.getByRole('dialog', { name: 'New tank' });
    fireEvent.change(within(sheet).getByRole('textbox'), { target: { value: 'Tank 7' } });
    fireEvent.submit(sheet.querySelector('form')!);

    await waitFor(() => assert.equal(h.actions.length, 1), COMMIT_WAIT);
    assert.equal(h.actions[0].type, 'batch.create');
    assert.deepEqual(h.actions[0].payload, {
      gas: 'Medical oxygen',
      branchId: 'b-delhi',
      cylinderIds: ['c-030', 'c-031'],
      source: 'Tank 7',
      operator: 'Test Helper',
    });
    assert.equal(h.state().cylinders.find((c) => c.id === 'c-030')?.contents, 'full');
    // Basic mode saves quietly, so the worker stays on the result and sees the tick.
    await screen.findByText(/filled\. Waiting for check\./);
    assert.notEqual(location.hash, '#production');
    await waitFor(() =>
      assert.equal(dom.window.localStorage.getItem('cylvero-lots'), JSON.stringify(['Tank 7'])),
    );
  } finally {
    h.dispose();
  }
});

test('Check blocks Good for an expired test and records an inspection with no test fields', async () => {
  const h = setup('quality');
  try {
    await openJob('Check');
    typeCode('DEMO-TAG-00047'); // Owned by a customer.
    await screen.findByText('Ask office to check this one.');

    pick('DEMO-TAG-00063'); // Test date expired.
    await screen.findByText('Test date is over. Office must update it.');
    assert.equal(
      (screen.getByRole('button', { name: 'Good' }) as HTMLButtonElement).disabled,
      true,
    );
    assert.equal(
      (screen.getByRole('button', { name: 'Hold' }) as HTMLButtonElement).disabled,
      false,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Scan next' }));

    pick('DEMO-TAG-00048');
    fireEvent.click(await screen.findByRole('button', { name: 'Good' }));
    await waitFor(() => assert.equal(h.actions.length, 1), COMMIT_WAIT);
    assert.equal(h.actions[0].type, 'cylinder.inspect');
    assert.deepEqual(h.actions[0].payload, {
      cylinderId: 'c-048',
      version: 1,
      condition: 'serviceable',
      notes: 'Checked in simple mode: looks good, marked serviceable.',
    });
    assert.equal(h.state().cylinders.find((c) => c.id === 'c-048')?.condition, 'serviceable');
    await screen.findByText('Marked good.', { selector: '.b-result-text' });
    fireEvent.click(screen.getByRole('button', { name: 'Scan next' }));
    assert.ok(screen.getByRole('button', { name: 'Pick from list' }));
  } finally {
    h.dispose();
  }
});
