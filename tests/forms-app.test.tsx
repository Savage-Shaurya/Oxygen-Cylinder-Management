import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { indexedDB } from 'fake-indexeddb';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSeedState } from '../server/seed';
import type { ActionRequest, AppState, Bootstrap, Party } from '../shared/types';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/#customers',
});
for (const key of [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'location',
  'sessionStorage',
] as const)
  Object.defineProperty(globalThis, key, {
    value: key === 'window' ? dom.window : dom.window[key],
    configurable: true,
  });
Object.defineProperty(globalThis, 'indexedDB', { value: indexedDB, configurable: true });

const React = await import('react');
const { render, fireEvent, screen, waitFor, cleanup } = await import('@testing-library/react');
const bundle = await build({
  entryPoints: [new URL('../src/App.tsx', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  loader: { '.css': 'empty' },
  write: false,
});
const bundleDir = mkdtempSync(join(new URL('.', import.meta.url).pathname, '.app-test-'));
const bundlePath = join(bundleDir, 'app.mjs');
writeFileSync(bundlePath, bundle.outputFiles[0].contents);
const { default: App } = await import(pathToFileURL(bundlePath).href);
rmSync(bundleDir, { recursive: true, force: true });

test('a customer created under an active search becomes visible only in Customers', async () => {
  let state: AppState = createSeedState();
  state.settings.mode = 'live';
  const user = {
    id: 'u-admin',
    name: 'Test Admin',
    email: 'admin@example.test',
    role: 'admin' as const,
    branchIds: state.branches.map((branch) => branch.id),
    orgId: 'o-demo',
    active: true,
  };
  const bootstrap: Bootstrap = { user, csrfToken: 'test-csrf', state, users: [user] };
  const posted: ActionRequest[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === '/api/bootstrap') return Response.json(bootstrap);
    if (path === '/api/health') return Response.json({ mode: 'live' });
    if (path === '/api/actions') {
      const action = JSON.parse(String(init?.body)) as ActionRequest;
      posted.push(action);
      assert.equal(action.type, 'party.create');
      const party: Party = { id: 'p-test-new', ...action.payload } as Party;
      state = { ...state, revision: state.revision + 1, parties: [...state.parties, party] };
      bootstrap.state = state;
      return Response.json({ state, message: 'Customer created', entityId: party.id });
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  try {
    render(React.createElement(App));
    const search = await screen.findByLabelText('Search name, phone, city…');
    fireEvent.change(search, { target: { value: 'name-that-does-not-exist' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add customer' })[0]);
    fireEvent.change(screen.getByLabelText('Business / customer name *'), {
      target: { value: 'New Test Clinic' },
    });
    fireEvent.change(screen.getByLabelText('Party type *'), { target: { value: 'hospital' } });
    fireEvent.change(screen.getByLabelText('Contact person *'), { target: { value: 'Manager' } });
    fireEvent.change(screen.getByLabelText('Phone *'), { target: { value: '1234567890' } });
    fireEvent.change(screen.getByLabelText('Address *'), { target: { value: 'Sample Road' } });
    fireEvent.change(screen.getByLabelText('City *'), { target: { value: 'Delhi' } });
    fireEvent.change(screen.getByLabelText('Branch *'), { target: { value: 'b-delhi' } });
    const form = screen.getByRole('dialog', { name: 'Add customer' }).querySelector('form')!;
    fireEvent.submit(form);
    await waitFor(() => assert.equal(posted.length, 1));
    await waitFor(() => assert.ok(screen.getByRole('button', { name: 'New Test Clinic' })));
    assert.equal((search as HTMLInputElement).value, '');
    assert.equal(posted[0].payload.type, 'hospital');
    assert.equal('cylinderIds' in posted[0].payload, false);
    fireEvent.click(screen.getByRole('button', { name: 'Suppliers & purchases' }));
    assert.equal(screen.queryByRole('button', { name: 'New Test Clinic' }), null);
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
  }
});
