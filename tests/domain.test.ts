import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAction, DomainError } from '../server/domain.js';
import { createSeedState } from '../server/seed.js';
import type { ActionRequest, AppState, Role, User } from '../shared/types.js';

let sequence = 0;
const user = (role: Role, branchIds = ['b-delhi', 'b-faridabad']): User => ({
  id: `u-${role}`,
  name: role,
  email: `${role}@batra.demo`,
  role,
  branchIds,
  orgId: 'batra',
  active: true,
});
function act(
  state: AppState,
  type: string,
  payload: Record<string, unknown>,
  role: Role = 'admin',
  branchIds?: string[],
) {
  const request: ActionRequest = {
    type,
    payload,
    idempotencyKey: `test-${++sequence}`,
    expectedRevision: state.revision,
  };
  return applyAction(state, request, {
    user: user(role, branchIds),
    now: '2026-09-28T12:00:00.000Z',
    id: () => `test-id-${++sequence}`,
  }).state;
}
function denied(fn: () => unknown, status?: number) {
  assert.throws(
    fn,
    (error: unknown) =>
      error instanceof DomainError && (status === undefined || error.status === status),
  );
}

test('seed is rich, synthetic, and balances references', () => {
  const state = createSeedState('2026-09-28T12:00:00.000Z');
  assert.ok(state.cylinders.length >= 60 && state.cylinders.length <= 100);
  assert.ok(state.parties.some((p) => p.type === 'hospital'));
  assert.ok(state.parties.some((p) => p.type === 'homecare'));
  assert.ok(state.parties.some((p) => p.type === 'supplier'));
  assert.ok(
    state.orders.length &&
      state.batches.length &&
      state.invoices.length &&
      state.rentals.length &&
      state.audit.length,
  );
  assert.equal(new Set(state.cylinders.map((c) => c.serial)).size, state.cylinders.length);
  for (const batch of state.batches) {
    for (const id of batch.cylinderIds) {
      const cylinder = state.cylinders.find((c) => c.id === id);
      assert.ok(cylinder, `Missing cylinder ${id} in ${batch.number}`);
      assert.equal(cylinder.branchId, batch.branchId, `${batch.number} branch mismatch`);
      assert.equal(cylinder.gas, batch.gas, `${batch.number} gas mismatch`);
    }
  }
  for (const order of state.orders) {
    for (const id of order.cylinderIds) {
      const cylinder = state.cylinders.find((c) => c.id === id)!;
      assert.ok(
        cylinder.ownerId === 'company' ||
          state.parties.find((p) => p.id === cylinder.ownerId)?.type === 'supplier' ||
          cylinder.ownerId === order.partyId,
        `${order.number} contains another customer's cylinder ${id}`,
      );
    }
  }
});

test('dispatch rejects another customer’s cylinder', () => {
  let state = createSeedState();
  const c = state.cylinders.find((c) => c.id === 'c-005')!;
  assert.equal(c.ownerId, 'p-home-1');
  state = act(
    state,
    'order.create',
    {
      partyId: 'p-hospital-1',
      branchId: c.branchId,
      gas: c.gas,
      size: c.size,
      quantity: 1,
      priority: 'normal',
      dueDate: '2026-09-28',
      notes: '',
      unitPricePaise: 100,
    },
    'operations',
  );
  const order = state.orders.at(-1)!;
  denied(() =>
    act(
      state,
      'order.dispatch',
      {
        orderId: order.id,
        cylinderIds: [c.id],
        vehicle: 'DEMO',
        driverId: 'u-driver',
      },
      'operations',
    ),
  );
});

test('gas invoice waits until every vehicle cylinder is delivered or unloaded', () => {
  let state = createSeedState();
  denied(() =>
    act(
      state,
      'finance.invoice',
      {
        orderId: 'o-partial-1',
        taxBps: 1200,
        dueDate: '2026-10-28',
        notes: '',
      },
      'finance',
    ),
  );
  state = act(
    state,
    'order.unload',
    {
      orderId: 'o-partial-1',
      cylinderIds: ['c-004'],
      notes: 'Route ended',
    },
    'operations',
  );
  state = act(
    state,
    'finance.invoice',
    {
      orderId: 'o-partial-1',
      taxBps: 1200,
      dueDate: '2026-10-28',
      notes: '',
    },
    'finance',
  );
  assert.equal(state.invoices.at(-1)?.lines[0].quantity, 1);
});

test('cancelled order retains its reason and cannot be dispatched', () => {
  let state = createSeedState();
  state = act(
    state,
    'order.cancel',
    {
      orderId: 'o-open-1',
      reason: 'Customer withdrew request',
    },
    'operations',
  );
  const order = state.orders.find((o) => o.id === 'o-open-1')!;
  assert.equal(order.status, 'cancelled');
  assert.equal(order.cancelReason, 'Customer withdrew request');
  denied(() =>
    act(
      state,
      'order.dispatch',
      {
        orderId: order.id,
        cylinderIds: ['c-005', 'c-006', 'c-007'],
        vehicle: 'DEMO',
        driverId: 'u-driver',
      },
      'operations',
    ),
  );
});

test('registration, inspection, fill, independent release, dispatch and partial delivery', () => {
  let state = createSeedState();
  state = act(
    state,
    'cylinder.register',
    {
      serial: 'TEST-X-100',
      tag: 'TEST-X-100',
      manufacturer: 'Demo Works',
      gas: 'Medical oxygen',
      size: 'B',
      ownerId: 'company',
      branchId: 'b-delhi',
      testDue: '2027-09-01',
      lastTest: '2026-09-01',
      certificate: 'CERT-T-1',
    },
    'operations',
  );
  let c = state.cylinders.find((x) => x.serial === 'TEST-X-100')!;
  assert.equal(c.condition, 'inspection_due');
  denied(() =>
    act(
      state,
      'batch.create',
      {
        gas: c.gas,
        branchId: c.branchId,
        cylinderIds: [c.id],
        source: 'Plant',
        operator: 'u-ops',
      },
      'operations',
    ),
  );
  state = act(
    state,
    'cylinder.inspect',
    {
      cylinderId: c.id,
      version: c.version,
      condition: 'serviceable',
      notes: 'Passed inspection',
    },
    'quality',
  );
  c = state.cylinders.find((x) => x.id === c.id)!;
  state = act(
    state,
    'batch.create',
    {
      gas: c.gas,
      branchId: c.branchId,
      cylinderIds: [c.id],
      source: 'Plant',
      operator: 'u-ops',
    },
    'operations',
  );
  const batch = state.batches.find((b) => b.cylinderIds.includes(c.id))!;
  denied(() =>
    act(
      state,
      'batch.release',
      { batchId: batch.id, certificate: 'QC-1', qualityNotes: 'Passed' },
      'operations',
    ),
  );
  state = act(
    state,
    'batch.release',
    { batchId: batch.id, certificate: 'QC-1', qualityNotes: 'Passed' },
    'quality',
  );
  state = act(
    state,
    'order.create',
    {
      partyId: 'p-hospital-1',
      branchId: 'b-delhi',
      gas: c.gas,
      size: c.size,
      quantity: 1,
      priority: 'normal',
      dueDate: '2026-09-28',
      notes: 'Test',
      unitPricePaise: 120000,
    },
    'operations',
  );
  const order = state.orders.find(
    (o) => o.status === 'open' && o.quantity === 1 && o.createdAt === '2026-09-28T12:00:00.000Z',
  )!;
  state = act(
    state,
    'order.dispatch',
    {
      orderId: order.id,
      cylinderIds: [c.id],
      vehicle: 'DL 01 DEMO',
      driverId: 'u-driver',
    },
    'operations',
  );
  denied(
    () =>
      act(
        state,
        'order.deliver',
        {
          orderId: order.id,
          cylinderIds: [c.id],
          recipient: 'Receiver',
          notes: '',
        },
        'driver',
        ['b-faridabad'],
      ),
    404,
  );
  state = act(
    state,
    'order.deliver',
    {
      orderId: order.id,
      cylinderIds: [c.id],
      recipient: 'Receiver',
      notes: '',
    },
    'driver',
  );
  assert.equal(state.orders.find((o) => o.id === order.id)?.status, 'delivered');
  denied(() =>
    act(
      state,
      'order.deliver',
      {
        orderId: order.id,
        cylinderIds: [c.id],
        recipient: 'Receiver',
        notes: '',
      },
      'driver',
    ),
  );
  assert.equal(state.rentals.filter((r) => r.orderId === order.id).length, 1);
});

test('retired cylinders are permanent and branch scope applies to admin', () => {
  let state = createSeedState();
  const c = state.cylinders.find(
    (c) => c.branchId === 'b-delhi' && c.custody === 'plant' && c.condition !== 'retired',
  )!;
  denied(
    () =>
      act(
        state,
        'cylinder.inspect',
        {
          cylinderId: c.id,
          version: c.version,
          condition: 'retired',
          notes: 'Scrapped',
        },
        'admin',
        ['b-faridabad'],
      ),
    404,
  );
  state = act(state, 'cylinder.inspect', {
    cylinderId: c.id,
    version: c.version,
    condition: 'retired',
    notes: 'Scrapped',
    ownerAuthorizationRef: 'OWNER-RETIRE-1',
  });
  denied(() =>
    act(state, 'cylinder.inspect', {
      cylinderId: c.id,
      version: c.version + 1,
      condition: 'serviceable',
      notes: 'Restore',
    }),
  );
  denied(() => act(state, 'party.create', { name: 'X' }, 'auditor'), 403);
});

test('financial postings reject duplicates, overpayment and excess refunds', () => {
  let state = createSeedState();
  const invoice = state.invoices.find((i) => i.status === 'issued' && i.totalPaise > 100)!;
  state = act(
    state,
    'finance.receipt',
    {
      invoiceId: invoice.id,
      amountPaise: 100,
      method: 'bank',
      reference: 'UTR-TEST',
    },
    'finance',
  );
  denied(() =>
    act(
      state,
      'finance.receipt',
      {
        invoiceId: invoice.id,
        amountPaise: 100,
        method: 'bank',
        reference: 'UTR-TEST',
      },
      'finance',
    ),
  );
  denied(() =>
    act(
      state,
      'finance.receipt',
      {
        invoiceId: invoice.id,
        amountPaise: invoice.totalPaise,
        method: 'bank',
        reference: 'UTR-TEST-2',
      },
      'finance',
    ),
  );
  state = act(state, 'finance.credit', { invoiceId: invoice.id, amountPaise: 100, reason: 'Correction' }, 'finance');
  assert.equal(state.invoices.at(-1)?.type, 'credit');
  denied(() =>
    act(
      state,
      'finance.refund',
      {
        partyId: invoice.partyId,
        amountPaise: 99999999,
        method: 'bank',
        reference: 'REF-TEST',
        reason: 'Return',
      },
      'finance',
    ),
  );
});

test('deposit and partial refund preserve a traceable remaining balance', () => {
  let state = createSeedState();
  const partyId = 'p-home-1';
  const starting =
    state.receipts
      .filter((r) => r.partyId === partyId && r.kind === 'deposit')
      .reduce((n, r) => n + r.amountPaise, 0) -
    state.receipts
      .filter((r) => r.partyId === partyId && r.kind === 'refund')
      .reduce((n, r) => n + r.amountPaise, 0);
  state = act(
    state,
    'finance.deposit',
    {
      partyId,
      amountPaise: 50000,
      method: 'bank',
      reference: 'DEPOSIT-FLOW',
    },
    'finance',
  );
  state = act(
    state,
    'finance.refund',
    {
      partyId,
      amountPaise: 20000,
      method: 'bank',
      reference: 'REFUND-FLOW',
      reason: 'Unused deposit',
      overrideReason: 'Approved while customer stock remains out',
    },
    'admin',
  );
  const deposits = state.receipts.filter((r) => r.partyId === partyId && r.kind === 'deposit');
  const refunds = state.receipts.filter((r) => r.partyId === partyId && r.kind === 'refund');
  assert.equal(
    deposits.reduce((n, r) => n + r.amountPaise, 0) -
      refunds.reduce((n, r) => n + r.amountPaise, 0),
    starting + 30000,
  );
  denied(() =>
    act(
      state,
      'finance.refund',
      {
        partyId,
        amountPaise: starting + 30001,
        method: 'bank',
        reference: 'REFUND-TOO-MUCH',
        reason: 'Excess',
      },
      'finance',
    ),
  );
});

test('return discrepancy can be resolved once within its branch', () => {
  let state = createSeedState();
  state = act(
    state,
    'return.discrepancy',
    {
      branchId: 'b-delhi',
      serial: 'UNKNOWN-123',
      notes: 'Physical count mismatch',
    },
    'operations',
  );
  const exception = state.exceptions.at(-1)!;
  denied(
    () =>
      act(
        state,
        'exception.resolve',
        {
          exceptionId: exception.id,
          resolution: 'Count reconciled',
        },
        'quality',
        ['b-faridabad'],
      ),
    404,
  );
  state = act(
    state,
    'exception.resolve',
    {
      exceptionId: exception.id,
      resolution: 'Count reconciled',
    },
    'quality',
    ['b-delhi'],
  );
  assert.equal(state.exceptions.find((e) => e.id === exception.id)?.status, 'resolved');
  denied(() =>
    act(
      state,
      'exception.resolve',
      {
        exceptionId: exception.id,
        resolution: 'Again',
      },
      'quality',
      ['b-delhi'],
    ),
  );
});

test('imports reject any invalid row atomically', () => {
  const state = createSeedState();
  const row = {
    serial: 'IMPORT-1',
    tag: 'IMPORT-1',
    manufacturer: 'Demo',
    gas: 'Medical oxygen',
    size: 'B',
    ownerId: 'company',
    branchId: 'b-delhi',
    testDue: '2027-01-01',
    lastTest: '2026-01-01',
    certificate: 'CERT',
  };
  denied(() =>
    act(
      state,
      'cylinders.import',
      {
        rows: [row, { ...row, serial: 'IMPORT-2', tag: state.cylinders[0].tag }],
      },
      'operations',
    ),
  );
  assert.equal(
    state.cylinders.some((c) => c.serial === 'IMPORT-1'),
    false,
  );
});

test('supplier route cannot move quarantined or full stock and received stock needs QC', () => {
  let state = createSeedState();
  const held = state.cylinders.find(
    (c) => c.branchId === 'b-faridabad' && c.condition === 'quarantine',
  )!;
  denied(() =>
    act(
      state,
      'supplier.send',
      {
        supplierId: 'p-supplier-2',
        cylinderIds: [held.id],
        reference: 'DEMO-SEND',
        notes: '',
      },
      'operations',
    ),
  );
  const empty = state.cylinders.find(
    (c) =>
      c.branchId === 'b-faridabad' &&
      c.condition === 'serviceable' &&
      c.contents === 'empty' &&
      !c.batchId,
  )!;
  state = act(
    state,
    'supplier.send',
    {
      supplierId: 'p-supplier-2',
      cylinderIds: [empty.id],
      reference: 'DEMO-SEND-2',
      notes: '',
    },
    'operations',
  );
  assert.equal(state.cylinders.find((c) => c.id === empty.id)?.custody, 'supplier');
  state = act(
    state,
    'supplier.receive',
    {
      supplierId: 'p-supplier-2',
      cylinderIds: [empty.id],
      reference: 'DEMO-RETURN',
      gas: empty.gas,
      service: 'fill',
      contents: 'full',
      notes: '',
    },
    'operations',
  );
  const received = state.cylinders.find((c) => c.id === empty.id)!;
  assert.equal(received.condition, 'inspection_due');
  const batch = state.batches.find((b) => b.id === received.batchId)!;
  assert.equal(batch.supplierId, 'p-supplier-2');
  denied(() =>
    act(
      state,
      'batch.release',
      { batchId: batch.id, certificate: 'DEMO-QC', qualityNotes: 'Passed' },
      'quality',
    ),
  );
  state = act(
    state,
    'cylinder.inspect',
    {
      cylinderId: received.id,
      version: received.version,
      condition: 'serviceable',
      notes: 'Passed',
    },
    'quality',
  );
  state = act(
    state,
    'batch.release',
    { batchId: batch.id, certificate: 'DEMO-QC', qualityNotes: 'Passed' },
    'quality',
  );
  assert.equal(state.batches.find((b) => b.id === batch.id)?.status, 'released');
});

test('purchase receipt creates new assets without dispatch release', () => {
  let state = createSeedState();
  state = act(
    state,
    'purchase.receive',
    {
      supplierId: 'p-supplier-2',
      branchId: 'b-faridabad',
      gas: 'Medical oxygen',
      reference: 'DEMO-PO-1',
      notes: '',
      cylinders: [
        {
          serial: 'DEMO-PUR-1',
          tag: 'DEMO-PUR-TAG-1',
          manufacturer: 'Demo Vendor',
          size: 'B',
          ownerId: 'company',
          testDue: '2027-09-01',
          lastTest: '2026-09-01',
          certificate: 'DEMO-TEST',
        },
      ],
    },
    'operations',
  );
  const c = state.cylinders.find((c) => c.serial === 'DEMO-PUR-1')!;
  const b = state.batches.find((b) => b.id === c.batchId)!;
  assert.equal(c.condition, 'inspection_due');
  assert.equal(b.status, 'awaiting_release');
  assert.equal(b.supplierId, 'p-supplier-2');
  const supplier = state.parties.find((p) => p.id === 'p-supplier-2')!;
  const { id, ...fields } = supplier;
  denied(() => act(state, 'party.update', { ...fields, partyId: id, type: 'hospital' }, 'finance'));
  denied(() =>
    act(
      state,
      'batch.release',
      { batchId: b.id, certificate: 'DEMO-QC', qualityNotes: 'Passed' },
      'quality',
    ),
  );
});

test('recall quarantines customer-held stock and preserves hold on return', () => {
  const state = createSeedState();
  const batch = state.batches.find((b) => b.cylinderIds.includes('c-001'))!;
  const recalled = act(
    state,
    'batch.recall',
    { batchId: batch.id, reason: 'Demo investigation' },
    'quality',
  );
  assert.equal(recalled.cylinders.find((c) => c.id === 'c-001')?.condition, 'quarantine');
  assert.equal(recalled.cylinders.find((c) => c.id === 'c-001')?.custody, 'customer');
  assert.ok(
    recalled.exceptions.some((e) => e.entityId === 'c-001' && e.type === 'recall_recovery'),
  );
  const returned = act(
    recalled,
    'cylinder.return',
    {
      cylinderIds: ['c-001'],
      partyId: 'p-hospital-1',
      contents: 'empty',
      notes: 'Recall recovery',
    },
    'operations',
  );
  const cylinder = returned.cylinders.find((c) => c.id === 'c-001')!;
  assert.equal(cylinder.condition, 'quarantine');
  assert.equal(cylinder.batchId, batch.id);
  denied(() =>
    act(
      returned,
      'cylinder.inspect',
      {
        cylinderId: cylinder.id,
        version: cylinder.version,
        condition: 'serviceable',
        notes: 'Attempted release',
      },
      'quality',
    ),
  );
});

test('partial delivery accepts remaining manifest once and warehouse return closes rental', () => {
  let state = createSeedState('2026-09-28T12:00:00.000Z');
  const order = state.orders.find((o) => o.id === 'o-partial-1')!;
  assert.equal(order.status, 'partial');
  denied(() =>
    act(
      state,
      'order.deliver',
      {
        orderId: order.id,
        cylinderIds: ['c-003'],
        recipient: 'Demo Desk',
        notes: '',
      },
      'driver',
    ),
  );
  state = act(
    state,
    'order.deliver',
    {
      orderId: order.id,
      cylinderIds: ['c-004'],
      recipient: 'Demo Desk',
      notes: '',
    },
    'driver',
  );
  assert.equal(state.orders.find((o) => o.id === order.id)?.status, 'delivered');
  denied(() =>
    act(
      state,
      'cylinder.return',
      {
        cylinderIds: ['c-003'],
        partyId: 'p-hospital-1',
        contents: 'empty',
        notes: '',
      },
      'operations',
    ),
  );
  state = act(
    state,
    'cylinder.return',
    {
      cylinderIds: ['c-003'],
      partyId: 'p-home-1',
      contents: 'empty',
      notes: 'Demo warehouse receipt',
    },
    'operations',
  );
  assert.equal(state.cylinders.find((c) => c.id === 'c-003')?.condition, 'inspection_due');
  assert.equal(state.rentals.find((r) => r.cylinderId === 'c-003')?.end, '2026-09-28');
  denied(() =>
    act(
      state,
      'cylinder.return',
      {
        cylinderIds: ['c-003'],
        partyId: 'p-home-1',
        contents: 'empty',
        notes: '',
      },
      'operations',
    ),
  );
});

test('rental billing uses inclusive period, exclusive return, original free days and paise rounding', () => {
  const state = createSeedState('2026-09-28T12:00:00.000Z');
  state.rentals.push({
    id: 'r-test',
    cylinderId: 'c-005',
    partyId: 'p-home-1',
    orderId: 'o-demo',
    start: '2026-09-20',
    end: '2026-09-25',
    dailyRatePaise: 101,
    freeDays: 2,
  });
  const next = act(
    state,
    'finance.rental',
    {
      partyId: 'p-home-1',
      periodStart: '2026-09-20',
      periodEnd: '2026-09-25',
      taxBps: 1200,
      dueDate: '2026-10-28',
    },
    'finance',
  );
  const invoice = next.invoices.at(-1)!;
  const line = invoice.lines.find((l) => l.unitPricePaise === 101)!;
  assert.equal(line.quantity, 3);
  assert.equal(line.amountPaise, 303);
  assert.equal(invoice.taxPaise, Math.round(invoice.subtotalPaise * 0.12));
  denied(
    () =>
      act(
        next,
        'finance.rental',
        {
          partyId: 'p-home-1',
          periodStart: '2026-09-25',
          periodEnd: '2026-09-27',
          taxBps: 1200,
          dueDate: '2026-10-28',
        },
        'finance',
      ),
    409,
  );
  denied(() =>
    act(
      state,
      'finance.rental',
      {
        partyId: 'p-home-1',
        periodStart: '2026-09-20',
        periodEnd: '2026-09-29',
        taxBps: 1200,
        dueDate: '2026-10-28',
      },
      'finance',
    ),
  );
});

test('Kolkata business day governs expiration and rental dates', () => {
  let state = createSeedState('2026-09-28T20:00:00.000Z');
  const c = state.cylinders.find((c) => c.id === 'c-005')!;
  c.testDue = '2026-09-28';
  state = act(
    state,
    'order.create',
    {
      partyId: 'p-hospital-1',
      branchId: 'b-delhi',
      gas: c.gas,
      size: c.size,
      quantity: 1,
      priority: 'normal',
      dueDate: '2026-09-29',
      notes: '',
      unitPricePaise: 100,
    },
    'operations',
  );
  const o = state.orders.at(-1)!;
  assert.equal(state.settings.mode, 'demo');
  denied(() =>
    applyAction(
      state,
      {
        type: 'order.dispatch',
        payload: {
          orderId: o.id,
          cylinderIds: [c.id],
          vehicle: 'DEMO',
          driverId: 'u-driver',
        },
        idempotencyKey: 'tz',
        expectedRevision: state.revision,
      },
      {
        user: user('operations'),
        now: '2026-09-28T20:00:00.000Z',
        id: () => `tz-${++sequence}`,
      },
    ),
  );
});

test('manufacturer scoped serials and permanent tag aliases retain evidence', () => {
  let state = createSeedState();
  const base = {
    serial: 'SHARED-100',
    tag: 'NEW-TAG-100',
    manufacturer: 'Maker A',
    gas: 'Medical oxygen',
    size: 'B',
    ownerId: 'company',
    branchId: 'b-delhi',
    testDue: '2027-01-01',
    lastTest: '2026-01-01',
    certificate: 'CERT',
  };
  state = act(state, 'cylinder.register', base, 'operations');
  denied(() => act(state, 'cylinder.register', { ...base, tag: 'NEW-TAG-101' }, 'operations'), 409);
  state = act(
    state,
    'cylinder.register',
    { ...base, manufacturer: 'Maker B', tag: 'NEW-TAG-101' },
    'operations',
  );
  let c = state.cylinders.find((c) => c.tag === 'NEW-TAG-100')!;
  state = act(
    state,
    'cylinder.retag',
    { cylinderId: c.id, version: c.version, tag: 'NEW-TAG-102', reason: 'Damaged label' },
    'operations',
  );
  c = state.cylinders.find((x) => x.id === c.id)!;
  assert.deepEqual(c.previousTags, ['NEW-TAG-100']);
  const event = state.movements.find((m) => m.cylinderId === c.id && m.action === 'retag')!;
  assert.equal(event.before?.tag, 'NEW-TAG-100');
  assert.equal(event.after?.tag, 'NEW-TAG-102');
  denied(
    () =>
      act(
        state,
        'cylinder.register',
        { ...base, serial: 'OTHER', tag: 'NEW-TAG-100' },
        'operations',
      ),
    409,
  );
  denied(
    () =>
      act(
        state,
        'cylinder.retag',
        { cylinderId: c.id, version: c.version, tag: 'NEW-TAG-100', reason: 'Reuse' },
        'operations',
      ),
    409,
  );
});

test('physical retag requires the cylinder to be at the plant', () => {
  let state = createSeedState();
  const held = state.cylinders.find((c) => c.id === 'c-001')!;
  denied(() =>
    act(
      state,
      'cylinder.retag',
      {
        cylinderId: held.id,
        version: held.version,
        tag: 'NEW-REMOTE-TAG',
        reason: 'Label replacement',
      },
      'operations',
    ),
  );
  const plant = state.cylinders.find((c) => c.id === 'c-030')!;
  state = act(
    state,
    'cylinder.retag',
    {
      cylinderId: plant.id,
      version: plant.version,
      tag: 'NEW-PLANT-TAG',
      reason: 'Label replacement',
    },
    'operations',
  );
  assert.equal(state.cylinders.find((c) => c.id === plant.id)?.tag, 'NEW-PLANT-TAG');
});

test('test evidence changes require complete coherent dates and certificate', () => {
  const state = createSeedState();
  const c = state.cylinders.find((c) => c.id === 'c-047')!;
  denied(() =>
    act(
      state,
      'cylinder.inspect',
      {
        cylinderId: c.id,
        version: c.version,
        condition: 'testing',
        notes: 'New test',
        testDue: '2027-01-01',
      },
      'quality',
    ),
  );
  denied(() =>
    act(
      state,
      'cylinder.inspect',
      {
        cylinderId: c.id,
        version: c.version,
        condition: 'serviceable',
        notes: 'New test',
        testDue: '2025-01-01',
        lastTest: '2026-01-01',
        certificate: 'CERT',
      },
      'quality',
    ),
  );
});

test('unload preserves order quantity and manifest; delivery proofs accumulate', () => {
  let state = createSeedState();
  state = act(
    state,
    'order.unload',
    { orderId: 'o-partial-1', cylinderIds: ['c-004'], notes: 'Route ended' },
    'operations',
  );
  const o = state.orders.find((x) => x.id === 'o-partial-1')!;
  assert.equal(o.quantity, 2);
  assert.deepEqual(o.cylinderIds, ['c-003', 'c-004']);
  assert.deepEqual(o.unloadedIds, ['c-004']);
  assert.equal(o.status, 'closed_short');
  denied(() =>
    act(
      state,
      'order.unload',
      { orderId: o.id, cylinderIds: ['c-004'], notes: 'Again' },
      'operations',
    ),
  );
  let fresh = createSeedState();
  fresh = act(
    fresh,
    'order.deliver',
    {
      orderId: 'o-partial-1',
      cylinderIds: ['c-004'],
      recipient: 'Second receiver',
      notes: 'Second visit',
    },
    'driver',
  );
  assert.equal(
    fresh.orders.find((x) => x.id === 'o-partial-1')?.deliveryProofs?.at(-1)?.recipient,
    'Second receiver',
  );
});

test('customer owned cylinder opens zero-rate custody interval', () => {
  let state = createSeedState();
  const c = state.cylinders.find((c) => c.id === 'c-005')!;
  c.ownerId = 'p-hospital-1';
  state = act(
    state,
    'order.create',
    {
      partyId: 'p-hospital-1',
      branchId: 'b-delhi',
      gas: c.gas,
      size: c.size,
      quantity: 1,
      priority: 'normal',
      dueDate: '2026-09-28',
      notes: '',
      unitPricePaise: 100,
    },
    'operations',
  );
  const o = state.orders.at(-1)!;
  state = act(
    state,
    'order.dispatch',
    { orderId: o.id, cylinderIds: [c.id], vehicle: 'DEMO', driverId: 'u-driver' },
    'operations',
  );
  state = act(
    state,
    'order.deliver',
    { orderId: o.id, cylinderIds: [c.id], recipient: 'Desk', notes: '' },
    'driver',
  );
  assert.equal(state.rentals.find((r) => r.orderId === o.id)?.dailyRatePaise, 0);
  state.rentals = state.rentals.filter((r) => r.orderId === o.id);
  denied(() =>
    act(
      state,
      'finance.rental',
      {
        partyId: 'p-hospital-1',
        periodStart: '2026-09-28',
        periodEnd: '2026-09-28',
        taxBps: 1200,
        dueDate: '2026-10-28',
      },
      'finance',
    ),
  );
});

test('party classification cannot strand supplier custody or rewrite customer identity', () => {
  let state = createSeedState();
  const supplier = state.parties.find((p) => p.id === 'p-supplier-2')!;
  const customer = state.parties.find((p) => p.id === 'p-hospital-1')!;
  const { id: supplierId, ...supplierFields } = supplier;
  const { id: customerId, ...customerFields } = customer;
  const empty = state.cylinders.find(
    (c) =>
      c.branchId === supplier.branchId &&
      c.condition === 'serviceable' &&
      c.contents === 'empty' &&
      !c.batchId,
  )!;
  state = act(state, 'supplier.send', {
    supplierId,
    cylinderIds: [empty.id],
    reference: 'CLASSIFICATION-TEST',
    notes: '',
  });
  denied(() =>
    act(
      state,
      'party.update',
      { ...supplierFields, partyId: supplierId, type: 'hospital' },
      'finance',
    ),
  );
  denied(() =>
    act(
      state,
      'party.update',
      { ...customerFields, partyId: customerId, type: 'supplier' },
      'finance',
    ),
  );
  state = act(
    state,
    'party.update',
    { ...supplierFields, partyId: supplierId, contact: 'Updated contact' },
    'finance',
  );
  assert.equal(state.parties.find((p) => p.id === supplier.id)?.contact, 'Updated contact');
});

test('unused party classification can be corrected without changing identity', () => {
  let state = createSeedState();
  const supplier = state.parties.find((p) => p.id === 'p-supplier-2')!;
  const { id, ...fields } = supplier;
  state = act(state, 'party.update', { ...fields, partyId: id, type: 'homecare' }, 'finance');
  assert.equal(state.parties.find((p) => p.id === id)?.type, 'homecare');
  assert.match(state.audit[0].summary, /supplier.*homecare/);
  state = act(state, 'order.create', {
    partyId: id,
    branchId: supplier.branchId,
    gas: 'Medical oxygen',
    size: 'B',
    quantity: 1,
    priority: 'normal',
    dueDate: '2026-10-01',
    notes: '',
    unitPricePaise: 10000,
  });
  denied(() => act(state, 'party.update', { ...fields, partyId: id, type: 'supplier' }, 'finance'));
});

test('party edit cannot duplicate another party name in the same branch', () => {
  const state = createSeedState();
  const hospital = state.parties.find((p) => p.id === 'p-hospital-1')!;
  const homecare = state.parties.find((p) => p.id === 'p-home-1')!;
  const { id, ...fields } = homecare;
  denied(
    () =>
      act(
        state,
        'party.update',
        {
          ...fields,
          partyId: id,
          name: hospital.name.toUpperCase(),
        },
        'finance',
      ),
    409,
  );
});

test('supplier route history prevents classification correction after stock returns', () => {
  let state = createSeedState();
  const supplier = state.parties.find((p) => p.id === 'p-supplier-2')!;
  const empty = state.cylinders.find(
    (c) =>
      c.branchId === supplier.branchId &&
      c.condition === 'serviceable' &&
      c.contents === 'empty' &&
      !c.batchId,
  )!;
  state = act(state, 'supplier.send', {
    supplierId: supplier.id,
    cylinderIds: [empty.id],
    reference: 'ROUTE-HISTORY',
    notes: '',
  });
  state = act(state, 'supplier.receive', {
    supplierId: supplier.id,
    cylinderIds: [empty.id],
    reference: 'ROUTE-HISTORY-RETURN',
    gas: empty.gas,
    service: 'fill',
    contents: 'full',
    notes: '',
  });
  const { id, ...fields } = supplier;
  denied(() => act(state, 'party.update', { ...fields, partyId: id, type: 'hospital' }, 'finance'));
});

test('issued invoices and credit notes preserve buyer and seller identity after master edits', () => {
  let state = createSeedState();
  state = act(
    state,
    'order.unload',
    {
      orderId: 'o-partial-1',
      cylinderIds: ['c-004'],
      notes: 'Route ended',
    },
    'operations',
  );
  state = act(
    state,
    'finance.invoice',
    { orderId: 'o-partial-1', taxBps: 1200, dueDate: '2026-10-28', notes: '' },
    'finance',
  );
  const invoiceId = state.invoices.at(-1)!.id;
  const originalBillTo = structuredClone(state.invoices.at(-1)!.billTo);
  const originalIssuer = structuredClone(state.invoices.at(-1)!.issuer);
  const party = state.parties.find((p) => p.id === 'p-home-1')!;
  const { id: partyId, ...partyFields } = party;
  state = act(
    state,
    'party.update',
    {
      ...partyFields,
      partyId,
      name: 'Renamed Home Care',
      address: 'New Address',
      gstin: 'NEWGSTIN',
    },
    'finance',
  );
  state = act(
    state,
    'settings.update',
    {
      companyName: 'Renamed Seller',
      address: 'New Seller Address',
      gstin: 'SELLERNEW',
      defaultTaxBps: 1200,
    },
    'admin',
  );
  assert.deepEqual(state.invoices.find((i) => i.id === invoiceId)?.billTo, originalBillTo);
  assert.deepEqual(state.invoices.find((i) => i.id === invoiceId)?.issuer, originalIssuer);
  state = act(state, 'finance.credit', { invoiceId, reason: 'Void incorrect order' }, 'finance');
  assert.deepEqual(state.invoices.at(-1)?.billTo, originalBillTo);
  assert.deepEqual(state.invoices.at(-1)?.issuer, originalIssuer);
});

test('pickup separates customer collection from warehouse receipt and discrepancy does not mutate custody', () => {
  let state = createSeedState();
  denied(
    () =>
      act(
        state,
        'cylinder.collect',
        {
          partyId: 'p-hospital-1',
          cylinderIds: ['c-001'],
          vehicle: 'DEMO',
          driverId: 'u-driver',
          notes: 'Pickup',
        },
        'driver',
      ),
    403,
  );
  state.orders.find((o) => o.id === 'o-delivered-1')!.driverId = 'u-other';
  const assignedRoute = state.orders.find((o) => o.id === 'o-open-1')!;
  assignedRoute.status = 'dispatched';
  assignedRoute.driverId = 'u-driver';
  denied(
    () =>
      act(
        state,
        'cylinder.collect',
        {
          partyId: 'p-hospital-1',
          cylinderIds: ['c-001'],
          vehicle: 'DEMO',
          driverId: 'u-driver',
          notes: 'Pickup',
        },
        'driver',
        ['b-faridabad'],
      ),
    404,
  );
  state = act(
    state,
    'cylinder.collect',
    {
      partyId: 'p-hospital-1',
      cylinderIds: ['c-001'],
      vehicle: 'DEMO',
      driverId: 'u-driver',
      notes: 'Pickup',
    },
    'driver',
  );
  const pickup = state.pickups?.at(-1)!;
  assert.equal(state.cylinders.find((c) => c.id === 'c-001')?.custodianId, pickup.id);
  assert.equal(state.rentals.find((r) => r.cylinderId === 'c-001')?.end, undefined);
  state = act(
    state,
    'cylinder.return',
    {
      partyId: 'p-hospital-1',
      cylinderIds: ['c-001'],
      contents: 'empty',
      notes: 'Warehouse receipt',
    },
    'operations',
  );
  assert.deepEqual(state.pickups?.at(-1)?.receivedIds, ['c-001']);
  assert.ok(state.rentals.find((r) => r.cylinderId === 'c-001')?.end);
  const before = state.cylinders.find((c) => c.id === 'c-002')!;
  state = act(
    state,
    'return.discrepancy',
    { branchId: 'b-delhi', serial: before.serial, notes: 'Tag does not match' },
    'driver',
  );
  assert.equal(state.cylinders.find((c) => c.id === before.id)?.custodianId, before.custodianId);
  assert.equal(state.exceptions.at(-1)?.branchId, 'b-delhi');
});

test('large paise tax is rounded with exact integer arithmetic', () => {
  let state = createSeedState();
  const o = state.orders.find((o) => o.id === 'o-partial-1')!;
  o.unitPricePaise = 1000000026868675;
  state = act(
    state,
    'order.unload',
    {
      orderId: o.id,
      cylinderIds: ['c-004'],
      notes: 'Route ended',
    },
    'operations',
  );
  state = act(
    state,
    'finance.invoice',
    { orderId: o.id, taxBps: 1234, dueDate: '2026-10-28', notes: '', creditLimitOverrideReason: 'Integer arithmetic test' },
    'admin',
  );
  const i = state.invoices.at(-1)!;
  const expected = (BigInt(i.subtotalPaise) * 1234n + 5000n) / 10000n;
  assert.equal(i.taxPaise, Number(expected));
  assert.notEqual(i.taxPaise, Math.round((i.subtotalPaise * 1234) / 10000));
});
