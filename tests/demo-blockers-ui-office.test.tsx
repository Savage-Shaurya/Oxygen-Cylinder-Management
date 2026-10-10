// Office: stale responses after sign-out, exact drill-downs, and the presenter's demo reset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { indexedDB } from 'fake-indexeddb';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSeedState } from '../server/seed';
import type { AppState, Bootstrap, Party, User } from '../shared/types';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/#overview',
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
// New code must never fall back to the browser's blocking dialogs.
dom.window.confirm = () => assert.fail('window.confirm must not be used');
dom.window.alert = () => assert.fail('window.alert must not be used');

const React = await import('react');
const { render, fireEvent, screen, waitFor, cleanup, within } =
  await import('@testing-library/react');
const { queueDelivery, listQueuedDeliveries, clearQueuedDeliveries } =
  await import('../src/offline');
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

const person = (role: User['role'], state: AppState, name: string): User => ({
  id: `u-${role}`,
  name,
  email: `${role}@batra.demo`,
  role,
  branchIds: state.branches.map((b) => b.id),
  orgId: 'batra',
  active: true,
});

function go(hash: string) {
  location.hash = hash;
  dom.window.dispatchEvent(new dom.window.HashChangeEvent('hashchange'));
}

const originalFetch = globalThis.fetch;

test('a late action response from a signed-out account never brings its screen or data back', async () => {
  const stateA = createSeedState();
  stateA.settings.mode = 'demo';
  const stateB = createSeedState();
  stateB.settings.mode = 'demo';
  stateB.settings.companyName = 'Second Account Company';
  const admin = person('admin', stateA, 'First Admin');
  const finance = person('finance', stateB, 'Second Finance');
  let release: (response: Response) => void = () => {};
  const late = new Promise<Response>((resolve) => (release = resolve));
  let posted = 0;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === '/api/bootstrap')
      return Response.json({ error: 'Authentication required' }, { status: 401 });
    if (path === '/api/health') return Response.json({ mode: 'demo' });
    if (path === '/api/login') {
      const { email } = JSON.parse(String(init?.body));
      const user = email === admin.email ? admin : finance;
      const state = user === admin ? stateA : stateB;
      return Response.json({ user, csrfToken: 'csrf', state, users: [user] } satisfies Bootstrap);
    }
    if (path === '/api/logout') return Response.json({ ok: true });
    if (path === '/api/actions') {
      posted++;
      return late;
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  try {
    go('customers');
    render(React.createElement(App));
    fireEvent.click(await screen.findByRole('button', { name: /admin@batra\.demo/ }));
    fireEvent.click((await screen.findAllByRole('button', { name: 'Add customer' }))[0]);
    fireEvent.change(screen.getByLabelText('Business / customer name *'), {
      target: { value: 'Private First Clinic' },
    });
    fireEvent.change(screen.getByLabelText('Party type *'), { target: { value: 'hospital' } });
    fireEvent.change(screen.getByLabelText('Contact person *'), { target: { value: 'Manager' } });
    fireEvent.change(screen.getByLabelText('Phone *'), { target: { value: '1234567890' } });
    fireEvent.change(screen.getByLabelText('Address *'), { target: { value: 'Sample Road' } });
    fireEvent.change(screen.getByLabelText('City *'), { target: { value: 'Delhi' } });
    fireEvent.change(screen.getByLabelText('Branch *'), { target: { value: 'b-delhi' } });
    fireEvent.submit(screen.getByRole('dialog', { name: 'Add customer' }).querySelector('form')!);
    await waitFor(() => assert.equal(posted, 1));

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    fireEvent.click(await screen.findByRole('button', { name: /finance@batra\.demo/ }));
    await screen.findByText('Second Finance');

    const party: Party = {
      ...stateA.parties.find((p) => p.type !== 'supplier')!,
      id: 'p-private',
      name: 'Private First Clinic',
    };
    const lateState = { ...stateA, parties: [...stateA.parties, party] };
    release(Response.json({ state: lateState, message: 'Customer created' }));
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.ok(screen.getByText('Second Finance'), 'the second account stays on screen');
    assert.equal(screen.queryByText('First Admin'), null);
    assert.equal(screen.queryByText('Private First Clinic'), null);
    assert.equal(screen.queryByText('Customer created'), null, 'no stale success toast');
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
  }
});

function officeSession(mutate?: (state: AppState) => void, role: User['role'] = 'admin') {
  const state = createSeedState();
  state.settings.mode = 'demo';
  mutate?.(state);
  const user = person(role, state, 'Presenter Admin');
  const bootstrap: Bootstrap = { user, csrfToken: 'csrf-demo', state, users: [user] };
  const calls: { path: string; method: string; csrf: string | null }[] = [];
  let reset: () => Response = () => Response.json({ ok: true, revision: 1 });
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    calls.push({
      path,
      method: init?.method ?? 'GET',
      csrf: new Headers(init?.headers).get('X-CSRF-Token'),
    });
    if (path === '/api/bootstrap') return Response.json(bootstrap);
    if (path === '/api/health') return Response.json({ mode: 'demo' });
    if (path === '/api/demo/reset') return reset();
    throw new Error(`Unexpected request: ${path}`);
  };
  return {
    state,
    user,
    calls,
    bootstraps: () => calls.filter((c) => c.path === '/api/bootstrap').length,
    onReset(next: () => Response) {
      reset = next;
    },
  };
}

const statValue = (button: HTMLElement) =>
  Number(button.querySelector('.stat-value, .hero-number, strong')!.textContent);

test('every headline number on Overview opens exactly the records it counts', async () => {
  officeSession();
  try {
    go('overview');
    render(React.createElement(App));
    await screen.findByText('Daily command center');

    const drills: [RegExp, string, string][] = [
      [/^Ready to dispatch/, 'cylinders', 'Ready to dispatch'],
      [/^Customer holdings/, 'cylinders', 'Customer'],
      [/^\d+ With customers$/, 'cylinders', 'Customer'],
      [/^\d+ At plant$/, 'cylinders', 'At plant'],
      [/^\d+ On vehicle$/, 'cylinders', 'Vehicle'],
      [/^\d+ With suppliers$/, 'cylinders', 'Supplier'],
      [/^\d+ cylinders tracked/, 'cylinders', 'All'],
      [/^Open orders/, 'orders', 'Active'],
    ];
    for (const [name, page, pill] of drills) {
      go('overview');
      const button = await screen.findByRole('button', { name });
      const expected = statValue(button);
      fireEvent.click(button);
      await waitFor(() => assert.equal(location.hash, `#${page}`));
      const selected = screen.getByRole('button', { name: pill, pressed: true });
      assert.ok(selected, `${pill} filter is selected`);
      const shown = Number(document.querySelector('.results-count')!.textContent!.split(' ')[0]);
      assert.equal(shown, expected, `${name} count matches its list`);
    }

    go('overview');
    const safety = await screen.findByRole('button', { name: /^Safety attention/ });
    const expected = statValue(safety);
    fireEvent.click(safety);
    await waitFor(() => assert.equal(location.hash, '#safety'));
    const rows =
      document.querySelectorAll('table tbody tr').length +
      document.querySelectorAll('.exception-row').length;
    assert.equal(rows, expected, 'Safety attention equals review rows plus open exceptions');
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
  }
});

test('Overview exceptions and Safety recall and exception rows open the exact record', async () => {
  const session = officeSession((state) => {
    state.batches[0].status = 'recalled';
  });
  const batch = session.state.batches[0];
  const exception = session.state.exceptions.find((e) => e.status === 'open')!;
  const target = session.state.cylinders.find((c) => c.id === exception.entityId);
  try {
    go('overview');
    render(React.createElement(App));
    await screen.findByText('Daily command center');
    if (target) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(exception.summary) }));
      await screen.findByRole('dialog', { name: target.tag });
      fireEvent.keyDown(screen.getByRole('dialog', { name: target.tag }), { key: 'Escape' });
    }

    go('safety');
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(batch.number) }));
    await screen.findByRole('dialog', { name: batch.number });
    fireEvent.keyDown(screen.getByRole('dialog', { name: batch.number }), { key: 'Escape' });
    if (target) {
      const row = document.querySelector('.exception-row') as HTMLElement;
      fireEvent.click(within(row).getByRole('button', { name: 'Open record' }));
      await screen.findByRole('dialog', { name: target.tag });
    }
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
  }
});

test('an admin resets demo data from Settings after an in-page confirmation', async () => {
  const session = officeSession();
  try {
    await clearQueuedDeliveries(session.user.id);
    await queueDelivery(session.user.id, {
      orderId: 'o-before-reset',
      cylinderIds: ['c-001'],
      recipient: 'Old story',
      notes: '',
    });
    go('settings');
    render(React.createElement(App));
    const reset = await screen.findByRole('button', { name: 'Reset demo data' });
    const before = session.bootstraps();
    fireEvent.click(reset);
    assert.equal(session.calls.filter((c) => c.path === '/api/demo/reset').length, 0);
    const confirm = screen.getByRole('button', { name: 'Yes, reset demo data' });
    assert.ok(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(confirm);

    await screen.findByText('Demo data reset to the starting story');
    const call = session.calls.find((c) => c.path === '/api/demo/reset')!;
    assert.equal(call.method, 'POST');
    assert.equal(call.csrf, 'csrf-demo');
    assert.ok(session.bootstraps() > before, 'the workspace is loaded again');
    assert.equal(location.hash, '#overview');
    await screen.findByText('Daily command center');
    assert.deepEqual(await listQueuedDeliveries(session.user.id), []);
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
    await clearQueuedDeliveries(session.user.id);
  }
});

test('a refused demo reset shows a friendly message and changes nothing', async () => {
  const session = officeSession();
  session.onReset(() => Response.json({ error: 'Forbidden' }, { status: 403 }));
  try {
    go('settings');
    render(React.createElement(App));
    fireEvent.click(await screen.findByRole('button', { name: 'Reset demo data' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, reset demo data' }));
    const alert = await screen.findByRole('alert');
    assert.match(alert.textContent ?? '', /Only an administrator can reset the demo/);
    assert.equal(location.hash, '#settings');
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
  }
});

test('the reset control is shown only to an admin in a demo workspace', async () => {
  for (const [mode, role] of [
    ['live', 'admin'],
    ['demo', 'quality'],
  ] as const) {
    officeSession((state) => {
      state.settings.mode = mode;
    }, role);
    try {
      go('settings');
      render(React.createElement(App));
      await screen.findByRole('heading', { name: 'Settings' });
      assert.equal(screen.queryByRole('button', { name: 'Reset demo data' }), null);
    } finally {
      cleanup();
      globalThis.fetch = originalFetch;
    }
  }
});
