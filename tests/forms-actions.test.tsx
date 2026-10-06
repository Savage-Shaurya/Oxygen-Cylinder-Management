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

function setup(role: User['role'] = 'admin') {
  let state: AppState = createSeedState();
  state.settings.mode = 'live';
  const user: User = {
    id: 'u-admin',
    name: 'Test Admin',
    email: 'admin@example.test',
    role,
    branchIds: state.branches.map((branch) => branch.id),
    orgId: 'batra',
    active: true,
  };
  const bootstrap: Bootstrap = { user, csrfToken: 'test-csrf', state, users: [user] };
  const actions: ActionRequest[] = [];
  const userRequests: { path: string; body: Record<string, unknown> }[] = [];
  const originalFetch = globalThis.fetch;
  let sequence = 0;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === '/api/bootstrap') return Response.json(bootstrap);
    if (path === '/api/health') return Response.json({ mode: 'live' });
    if (path === '/api/actions') {
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
    if (path === '/api/users' || path.startsWith('/api/users/')) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      userRequests.push({ path, body });
      if (path === '/api/users') {
        bootstrap.users.push({
          id: `u-rendered-${++sequence}`,
          name: String(body.name),
          email: String(body.email),
          role: body.role as User['role'],
          branchIds: body.branchIds as string[],
          orgId: user.orgId,
          active: true,
        });
      } else {
        const target = bootstrap.users.find((item) => item.id === path.split('/').at(-1));
        if (target) Object.assign(target, body);
      }
      return Response.json({ ok: true }, { status: path === '/api/users' ? 201 : 200 });
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const dispose = () => {
    cleanup();
    globalThis.fetch = originalFetch;
  };
  const externalAction = (type: string, payload: Record<string, unknown>) => {
    const result = applyAction(state, {
      type,
      payload,
      idempotencyKey: `external-${++sequence}`,
      expectedRevision: state.revision,
    }, {
      user,
      now: new Date().toISOString(),
      id: () => `external-record-${++sequence}`,
    });
    state = result.state;
    bootstrap.state = state;
  };
  return { state: () => state, bootstrap, actions, userRequests, externalAction, dispose };
}

function set(label: string, value: string) {
  const prefix = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  fireEvent.change(screen.getByLabelText(new RegExp(`^${prefix}`)), { target: { value } });
}
function openButton(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }));
}
// Less-used header actions live in the page's "More" menu (simplification plan 5.3).
function openMenuItem(label: string) {
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  fireEvent.click(screen.getByRole('menuitem', { name: label }));
}
function submit() {
  const form = screen.getByRole('dialog').querySelector('form');
  assert.ok(form);
  fireEvent.submit(form);
}
async function actionCount(actions: ActionRequest[], count: number) {
  await waitFor(() => assert.equal(actions.length, count));
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
}

test('supplier creation and customer edit send correctly classified, priced payloads', async () => {
  const h = setup();
  try {
    render(React.createElement(App));
    await screen.findByRole('button', { name: 'Add customer' });
    openButton('Suppliers & purchases');
    openButton('Add supplier');
    assert.equal((screen.getByLabelText('Party type *') as HTMLSelectElement).value, 'supplier');
    assert.equal(screen.queryByRole('option', { name: 'Hospital' }), null);
    set('Supplier business name *', 'Rendered Supplier');
    set('Contact person *', 'Owner');
    set('Phone *', '1234567890');
    set('Address *', 'Supplier Road');
    set('City *', 'Delhi');
    set('Branch *', 'b-delhi');
    set('Credit limit *', '123.45');
    set('Daily rental per cylinder *', '1.25');
    set('Standard deposit *', '50.50');
    submit();
    await actionCount(h.actions, 1);
    assert.equal(h.actions[0].type, 'party.create');
    assert.equal(h.actions[0].payload.type, 'supplier');
    assert.equal(h.actions[0].payload.creditLimitPaise, 12345);
    assert.equal(h.actions[0].payload.dailyRentalPaise, 125);
    assert.equal(h.actions[0].payload.depositPaise, 5050);
    assert.equal('cylinderIds' in h.actions[0].payload, false);
    assert.ok(screen.getByRole('button', { name: 'Rendered Supplier' }));
    openButton('Customers');
    assert.equal(screen.queryByRole('button', { name: 'Rendered Supplier' }), null);
    const row = screen.getByRole('button', { name: 'Demo North Care Hospital' }).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    set('Business / customer name *', 'Demo North Care Edited');
    submit();
    await actionCount(h.actions, 2);
    assert.equal(h.actions[1].type, 'party.update');
    assert.equal(h.actions[1].payload.type, 'hospital');
    assert.equal(h.actions[1].payload.partyId, 'p-hospital-1');
    assert.ok(screen.getByRole('button', { name: 'Demo North Care Edited' }));
  } finally {
    h.dispose();
  }
});

test('a conflicted customer edit reloads the latest saved values before another submission', async () => {
  const h = setup();
  try {
    render(React.createElement(App));
    const customer = await screen.findByRole('button', { name: 'Demo North Care Hospital' });
    fireEvent.click(within(customer.closest('tr')!).getByRole('button', { name: 'Edit' }));
    set('Business / customer name *', 'Unsaved draft name');
    const current = h.state().parties.find((party) => party.id === 'p-hospital-1')!;
    const { id, version: _version, ...fields } = current;
    h.externalAction('party.update', { partyId: id, ...fields, contact: 'Changed in another tab' });
    submit();
    await screen.findByRole('button', { name: 'Reload latest form' });
    assert.equal(h.state().parties.find((party) => party.id === id)?.name, current.name);
    assert.equal((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled, true);
    openButton('Reload latest form');
    await waitFor(() => assert.equal((screen.getByLabelText('Contact person *') as HTMLInputElement).value, 'Changed in another tab'));
    assert.equal((screen.getByLabelText('Business / customer name *') as HTMLInputElement).value, 'Demo North Care Hospital');
    assert.equal(h.actions.length, 1);
  } finally {
    h.dispose();
  }
});

test('registration, new order, and cylinder import submit real domain-valid commands', async () => {
  const h = setup();
  try {
    render(React.createElement(App));
    await screen.findByRole('button', { name: 'Customers' });
    openButton('Cylinders');
    const cylinderSearch = screen.getByLabelText('Search tag, serial, owner…') as HTMLInputElement;
    fireEvent.change(cylinderSearch, { target: { value: 'missing-register-tag' } });
    openButton('Register cylinder');
    set('Manufacturer serial *', 'RENDER-SERIAL-1');
    set('Scan tag / QR code *', 'RENDER-TAG-1');
    set('Manufacturer *', 'Test Works');
    set('Gas service *', 'Medical oxygen');
    set('Cylinder size *', 'B');
    set('Owner *', 'company');
    set('Branch *', 'b-delhi');
    set('Last test date *', '2026-01-01');
    set('Next test due *', '2031-01-01');
    set('Certificate reference *', 'CERT-1');
    submit();
    await actionCount(h.actions, 1);
    assert.equal(h.actions[0].type, 'cylinder.register');
    assert.equal('cylinderIds' in h.actions[0].payload, false);
    assert.ok(h.state().cylinders.some((cylinder) => cylinder.tag === 'RENDER-TAG-1'));
    assert.equal(cylinderSearch.value, '');
    openButton('Orders & delivery');
    const orderSearch = screen.getByLabelText(
      'Search order, customer, vehicle…',
    ) as HTMLInputElement;
    fireEvent.change(orderSearch, { target: { value: 'missing-order' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'New order' })[0]);
    set('Customer *', 'p-hospital-1');
    set('Branch *', 'b-delhi');
    set('Gas *', 'Medical oxygen');
    set('Cylinder size *', 'B');
    set('Quantity *', '2');
    set('Gas price per cylinder *', '1499.75');
    submit();
    await actionCount(h.actions, 2);
    assert.equal(h.actions[1].type, 'order.create');
    assert.equal(h.actions[1].payload.quantity, 2);
    assert.equal(h.actions[1].payload.unitPricePaise, 149975);
    assert.equal(orderSearch.value, '');
    openButton('Cylinders');
    openMenuItem('Import CSV');
    set(
      'Or paste CSV data',
      'serial,tag,manufacturer,gas,size,ownerId,branchId,testDue,lastTest,certificate\nRENDER-SERIAL-2,RENDER-TAG-2,"Works, Ltd",Medical oxygen,B,company,b-delhi,2031-01-01,2026-01-01,CERT-2',
    );
    submit();
    await actionCount(h.actions, 3);
    assert.equal(h.actions[2].type, 'cylinders.import');
    const rows = h.actions[2].payload.rows as Record<string, unknown>[];
    assert.equal(rows[0].manufacturer, 'Works, Ltd');
  } finally {
    h.dispose();
  }
});

test('purchase CSV checks its header before posting and preserves quoted commas', async () => {
  const h = setup();
  try {
    render(React.createElement(App));
    await screen.findByRole('button', { name: 'Customers' });
    openButton('Suppliers & purchases');
    openButton('Receive purchase');
    set('Supplier *', 'p-supplier-1');
    set('Branch *', 'b-delhi');
    set('Gas *', 'Medical oxygen');
    set('Purchase / delivery reference *', 'PO-123');
    set('Or paste cylinder CSV', 'wrong,header\na,b');
    submit();
    await screen.findByRole('alert');
    assert.equal(h.actions.length, 0);
    set(
      'Or paste cylinder CSV',
      'serial,tag,manufacturer,size,ownerId,lastTest,testDue,certificate\nRENDER-PURCHASE-1,RENDER-PURCHASE-TAG,"New, Works",B,company,2026-01-01,2031-01-01,CERT-P',
    );
    submit();
    await actionCount(h.actions, 1);
    assert.equal(h.actions[0].type, 'purchase.receive');
    assert.equal(
      (h.actions[0].payload.cylinders as Record<string, unknown>[])[0].manufacturer,
      'New, Works',
    );
  } finally {
    h.dispose();
  }
});

test('invoice, payment, deposit, and refund forms convert percentages and rupees correctly', async () => {
  const h = setup();
  h.state().invoices = h.state().invoices.filter((invoice) => invoice.sourceId !== 'o-delivered-1');
  try {
    render(React.createElement(App));
    await screen.findByRole('button', { name: 'Customers' });
    openButton('Billing & rentals');
    const invoiceSearch = screen.getByLabelText('Search invoice or customer…') as HTMLInputElement;
    fireEvent.change(invoiceSearch, { target: { value: 'missing-invoice' } });
    openButton('Issue invoice');
    set('Approved gas price per cylinder *', '1999.00');
    set('Tax rate (%) *', '18.50');
    submit();
    await actionCount(h.actions, 1);
    assert.equal(h.actions[0].type, 'finance.invoice');
    assert.equal(h.actions[0].payload.taxBps, 1850);
    assert.equal(h.actions[0].payload.orderId, 'o-delivered-1');
    assert.equal(h.actions[0].payload.unitPricePaise, 199900);
    assert.equal(invoiceSearch.value, '');
    openButton('Record payment');
    set('Invoice *', 'inv-seed-2');
    set('Amount received *', '12.34');
    set('Method *', 'upi');
    set('Payment reference *', 'UPI-1');
    submit();
    await actionCount(h.actions, 2);
    assert.equal(h.actions[1].type, 'finance.receipt');
    assert.equal(h.actions[1].payload.amountPaise, 1234);
    openMenuItem('Record deposit');
    set('Customer *', 'p-hospital-1');
    set('Amount *', '100.25');
    set('Method *', 'bank');
    set('Transaction reference *', 'DEP-1');
    submit();
    await actionCount(h.actions, 3);
    assert.equal(h.actions[2].type, 'finance.deposit');
    assert.equal(h.actions[2].payload.amountPaise, 10025);
    openMenuItem('Refund deposit');
    set('Liability exception approval', 'Approved synthetic liability test');
    set('Customer *', 'p-hospital-1');
    set('Amount *', '10.25');
    set('Method *', 'bank');
    set('Transaction reference *', 'REF-1');
    set('Refund reason *', 'Adjustment');
    submit();
    await actionCount(h.actions, 4);
    assert.equal(h.actions[3].type, 'finance.refund');
    assert.equal(h.actions[3].payload.amountPaise, 1025);
    assert.equal(h.actions[3].payload.overrideReason, 'Approved synthetic liability test');
  } finally {
    h.dispose();
  }
});

test('a credited delivery can be invoiced again with the current approved price', async () => {
  const h = setup();
  h.state().invoices.find((invoice) => invoice.id === 'inv-seed-1')!.status = 'credited';
  h.state().settings.gstin = '';
  try {
    render(React.createElement(App));
    await screen.findByRole('button', { name: 'Customers' });
    openButton('Billing & rentals');
    assert.match(screen.getByText('DEMO-ORD-001').textContent || '', /DEMO-ORD-001/);
    openButton('Issue invoice');
    set('Approved gas price per cylinder *', '1500.00');
    submit();
    await actionCount(h.actions, 1);
    assert.equal(h.actions[0].type, 'finance.invoice');
    assert.equal(h.actions[0].payload.orderId, 'o-delivered-1');
    assert.equal(h.actions[0].payload.unitPricePaise, 150000);
    const issued = h
      .state()
      .invoices.find(
        (invoice) => invoice.id !== 'inv-seed-1' && invoice.sourceId === 'o-delivered-1',
      );
    assert.ok(issued);
    assert.equal(issued.issuer?.gstin, '');
    h.state().settings.gstin = 'ADDED-LATER';
    assert.equal(issued.issuer?.gstin, '');
  } finally {
    h.dispose();
  }
});

test('partial and paid credits expose only spendable customer credit for refund', async () => {
  const h = setup('finance');
  try {
    render(React.createElement(App));
    await screen.findByRole('button', { name: 'Customers' });
    openButton('Billing & rentals');
    const unpaid = screen.getByRole('button', { name: 'DEMO-INV-001' }).closest('tr')!;
    fireEvent.click(within(unpaid).getByRole('button', { name: 'Credit' }));
    set('Credit amount *', '100.00');
    set('Reason for credit *', 'Synthetic partial correction');
    submit();
    await actionCount(h.actions, 1);
    assert.equal(h.actions[0].type, 'finance.credit');
    assert.equal(h.actions[0].payload.amountPaise, 10000);
    assert.equal(h.state().invoices.find((invoice) => invoice.id === 'inv-seed-1')?.creditedPaise, 10000);
    openMenuItem('Refund credit');
    assert.equal(screen.queryByRole('option', { name: /Demo North Care Hospital/ }), null);
    openButton('Cancel');

    const paid = screen.getByRole('button', { name: 'DEMO-INV-003' }).closest('tr')!;
    fireEvent.click(within(paid).getByRole('button', { name: 'Credit' }));
    set('Credit amount *', '50.00');
    set('Reason for credit *', 'Synthetic paid correction');
    submit();
    await actionCount(h.actions, 2);
    const note = h.state().invoices.find((invoice) => invoice.type === 'credit' && invoice.sourceId === 'inv-seed-3');
    assert.ok(note);
    openMenuItem('Refund credit');
    set('Customer *', 'p-hospital-2');
    set('Credit note to refund *', note.id);
    set('Refund amount *', '10.00');
    set('Method *', 'bank');
    set('Refund transaction reference *', 'PAID-CREDIT-REFUND');
    set('Refund reason *', 'Synthetic refund');
    submit();
    await actionCount(h.actions, 3);
    assert.equal(h.actions[2].type, 'finance.creditRefund');
    assert.equal(h.actions[2].payload.creditInvoiceId, note.id);
    assert.equal(h.actions[2].payload.amountPaise, 1000);
  } finally {
    h.dispose();
  }
});

test('an applied customer credit can be undone through the billing form', async () => {
  const h = setup('finance');
  const original = h.state().invoices.find((invoice) => invoice.id === 'inv-seed-1')!;
  original.paidPaise = original.totalPaise;
  original.status = 'paid';
  h.state().invoices.push({
    ...original,
    id: 'inv-rendered-target',
    number: 'TEST-INV-TARGET',
    sourceId: 'test-target',
    paidPaise: 0,
    status: 'issued',
    creditedPaise: 0,
    appliedCreditPaise: 0,
  });
  try {
    render(React.createElement(App));
    await screen.findByRole('button', { name: 'Customers' });
    openButton('Billing & rentals');
    const paid = screen.getByRole('button', { name: 'DEMO-INV-001' }).closest('tr')!;
    fireEvent.click(within(paid).getByRole('button', { name: 'Credit' }));
    set('Credit amount *', '50.00');
    set('Reason for credit *', 'Synthetic correction');
    submit();
    await actionCount(h.actions, 1);
    const note = h.state().invoices.find((invoice) => invoice.type === 'credit' && invoice.sourceId === original.id)!;
    assert.ok(note);
    openMenuItem('Apply credit');
    set('Credit note *', note.id);
    set('Invoice to settle *', 'inv-rendered-target');
    set('Amount to apply *', '10.00');
    set('Allocation reason *', 'Synthetic application');
    submit();
    await actionCount(h.actions, 2);
    assert.equal(h.actions[1].type, 'finance.creditAllocate');
    assert.equal(h.state().invoices.find((invoice) => invoice.id === 'inv-rendered-target')?.appliedCreditPaise, 1000);
    const allocation = h.state().receipts.find((receipt) => receipt.kind === 'credit_allocation')!;
    assert.ok(allocation);
    openMenuItem('Undo credit allocation');
    set('Credit allocation *', allocation.id);
    set('Reversal reason *', 'Applied to the wrong invoice');
    submit();
    await actionCount(h.actions, 3);
    assert.equal(h.actions[2].type, 'finance.creditUnallocate');
    assert.equal(h.state().invoices.find((invoice) => invoice.id === 'inv-rendered-target')?.appliedCreditPaise, 0);
    assert.ok(h.state().receipts.find((receipt) => receipt.id === allocation.id)?.reversedAt);
  } finally {
    h.dispose();
  }
});

test('finance has no Return action and switching customer refreshes eligible return tags', async () => {
  const finance = setup('finance');
  try {
    render(React.createElement(App));
    await screen.findByRole('button', { name: 'Customers' });
    openButton('Customers');
    const customer = await screen.findByRole('button', { name: 'Demo North Care Hospital' });
    assert.equal(within(customer.closest('tr')!).queryByRole('button', { name: 'Return' }), null);
  } finally {
    finance.dispose();
  }

  const operations = setup('operations');
  try {
    render(React.createElement(App));
    // Operations opens in the picture-based Basic mode; customer work lives in Office mode.
    fireEvent.click(await screen.findByRole('button', { name: 'Office mode' }));
    await screen.findByRole('button', { name: 'Customers' });
    openButton('Customers');
    const customer = await screen.findByRole('button', { name: 'Demo North Care Hospital' });
    fireEvent.click(within(customer.closest('tr')!).getByRole('button', { name: 'Return' }));
    const tags = screen.getByRole('group', { name: 'Returned cylinder tags' });
    const firstTag = operations.state().cylinders.find((cylinder) => cylinder.id === 'c-001')!.tag;
    const otherTag = operations.state().cylinders.find((cylinder) => cylinder.id === 'c-003')!.tag;
    assert.match(tags.textContent || '', new RegExp(firstTag));
    set('Customer *', 'p-home-1');
    assert.match(tags.textContent || '', new RegExp(otherTag));
    assert.doesNotMatch(tags.textContent || '', new RegExp(firstTag));
  } finally {
    operations.dispose();
  }
});

test('settings and team forms submit correctly shaped commands and account requests', async () => {
  const h = setup();
  try {
    render(React.createElement(App));
    await screen.findByRole('button', { name: 'Customers' });
    openButton('Settings');
    openButton('Edit profile');
    set('Company name *', 'Rendered Company');
    set('Default tax rate (%) *', '18.25');
    submit();
    await actionCount(h.actions, 1);
    assert.equal(h.actions[0].type, 'settings.update');
    assert.equal(h.actions[0].payload.defaultTaxBps, 1825);
    assert.equal(h.state().settings.companyName, 'Rendered Company');
    openButton('Add member');
    set('Full name *', 'Rendered Operator');
    set('Email *', 'rendered@example.test');
    set('Temporary password *', 'SecurePassword123!');
    set('Role *', 'operations');
    const branchCheckbox = screen.getByRole('dialog').querySelector('input[type="checkbox"]');
    assert.ok(branchCheckbox);
    fireEvent.click(branchCheckbox);
    submit();
    await waitFor(() => assert.equal(h.userRequests.length, 1));
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
    assert.equal(h.userRequests[0].path, '/api/users');
    assert.deepEqual(h.userRequests[0].body.branchIds, ['b-delhi']);
    assert.equal('cylinderIds' in h.userRequests[0].body, false);
    const row = screen.getByText('Rendered Operator').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Edit access' }));
    set('Account status *', 'false');
    submit();
    await waitFor(() => assert.equal(h.userRequests.length, 2));
    assert.deepEqual(h.userRequests[1].body, {
      role: 'operations',
      branchIds: ['b-delhi'],
      active: false,
    });
  } finally {
    h.dispose();
  }
});

test('only roles that receive audit records see the Audit trail tab', async () => {
  const admin = setup();
  try {
    render(React.createElement(App));
    await screen.findByRole('button', { name: 'Customers' });
    openButton('Reports & audit');
    assert.ok(screen.getByRole('tab', { name: 'Audit trail' }));
  } finally {
    admin.dispose();
  }

  const operations = setup('operations');
  try {
    render(React.createElement(App));
    // Operations opens in Basic mode unless an earlier test already chose Office mode for
    // this test user, which is remembered on the device.
    await waitFor(() =>
      assert.ok(
        screen.queryByRole('button', { name: 'Office mode' }) ||
          screen.queryByRole('button', { name: 'Customers' }),
      ),
    );
    const toOffice = screen.queryByRole('button', { name: 'Office mode' });
    if (toOffice) fireEvent.click(toOffice);
    await screen.findByRole('button', { name: 'Customers' });
    openButton('Reports & audit');
    assert.ok(screen.getByRole('tab', { name: 'Stock position' }));
    assert.ok(screen.getByRole('tab', { name: 'Movement ledger' }));
    assert.equal(screen.queryByRole('tab', { name: 'Audit trail' }), null);
    openButton('Settings');
    assert.ok(screen.getByRole('button', { name: 'Change my password' }));
    assert.equal(screen.queryByRole('button', { name: 'Edit profile' }), null);
    assert.equal(screen.queryByRole('button', { name: 'Add member' }), null);
  } finally {
    operations.dispose();
  }
});
