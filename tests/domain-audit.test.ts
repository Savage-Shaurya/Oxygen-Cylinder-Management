import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAction, DomainError } from '../server/domain.js';
import { createSeedState } from '../server/seed.js';
import type { AppState, Role, User } from '../shared/types.js';

let serial = 0;
const now = '2026-09-28T12:00:00.000Z';
function run(
  state: AppState,
  type: string,
  payload: Record<string, unknown>,
  role: Role = 'admin',
  at = now,
) {
  const user: User = {
    id: `u-${role}`,
    name: role,
    email: `${role}@demo.invalid`,
    role,
    branchIds: ['b-delhi', 'b-faridabad'],
    orgId: 'batra',
    active: true,
  };
  return applyAction(
    state,
    { type, payload, idempotencyKey: `audit-${++serial}`, expectedRevision: state.revision },
    { user, now: at, id: () => `audit-id-${++serial}` },
  ).state;
}
function rejected(work: () => unknown, message: RegExp) {
  assert.throws(
    work,
    (error: unknown) => error instanceof DomainError && message.test(error.message),
  );
}
const seed = () => createSeedState(now);

test('recorded emptying recovers nonempty plant stock without changing its inspection', () => {
  let s = seed();
  const c = s.cylinders.find((x) => x.id === 'c-047')!;
  rejected(
    () =>
      run(
        s,
        'cylinder.empty',
        { cylinderId: c.id, version: c.version, method: 'vent', notes: 'Controlled vent' },
        'operations',
      ),
    /not permitted/i,
  );
  s = run(
    s,
    'cylinder.empty',
    { cylinderId: c.id, version: c.version, method: 'vent', notes: 'Controlled vent' },
    'quality',
  );
  assert.equal(s.cylinders.find((x) => x.id === c.id)?.contents, 'empty');
  assert.equal(s.cylinders.find((x) => x.id === c.id)?.condition, 'inspection_due');
  assert.equal(s.movements[0].action, 'empty');
  const released = s.cylinders.find((x) => x.id === 'c-008')!;
  s = run(
    s,
    'cylinder.empty',
    {
      cylinderId: released.id,
      version: released.version,
      method: 'evacuate',
      notes: 'Gas recovered',
    },
    'quality',
  );
  assert.equal(s.cylinders.find((x) => x.id === released.id)?.contents, 'empty');
  assert.equal(s.cylinders.find((x) => x.id === released.id)?.batchId, undefined);
});

test('sealed undelivered vehicle stock keeps its released gas on unload', () => {
  const before = seed();
  const c = before.cylinders.find((x) => x.id === 'c-004')!;
  const s = run(
    before,
    'order.unload',
    {
      orderId: 'o-partial-1',
      cylinderIds: [c.id],
      sealIntact: true,
      notes: 'Tamper seal verified',
    },
    'operations',
  );
  const after = s.cylinders.find((x) => x.id === c.id)!;
  assert.equal(after.contents, 'full');
  assert.equal(after.batchId, c.batchId);
  assert.equal(after.condition, 'serviceable');
});

test('quality can reject one unsafe member and release remaining batch', () => {
  let s = seed();
  const b = s.batches.find((x) => x.status === 'awaiting_release')!;
  const [bad, ...good] = b.cylinderIds;
  for (const id of b.cylinderIds) {
    const c = s.cylinders.find((x) => x.id === id)!;
    c.condition = id === bad ? 'quarantine' : 'serviceable';
  }
  rejected(
    () =>
      run(
        s,
        'batch.release',
        { batchId: b.id, certificate: 'QC', qualityNotes: 'Safe' },
        'quality',
      ),
    /unsafe/,
  );
  s = run(
    s,
    'batch.reject',
    { batchId: b.id, cylinderId: bad, reason: 'Failed hydrotest' },
    'quality',
  );
  assert.deepEqual(s.batches.find((x) => x.id === b.id)?.cylinderIds, good);
  assert.ok(s.batches.find((x) => x.id === b.id)?.rejectedCylinderIds?.includes(bad));
  assert.equal(s.cylinders.find((x) => x.id === bad)?.batchId, undefined);
  s = run(
    s,
    'batch.release',
    { batchId: b.id, certificate: 'QC', qualityNotes: 'Safe' },
    'quality',
  );
  assert.equal(s.batches.find((x) => x.id === b.id)?.status, 'released');
});

test('supplier test-only receipt remains unfilled and no release batch is created', () => {
  let s = seed();
  const c = s.cylinders.find((x) => x.id === 'c-029')!;
  s = run(
    s,
    'supplier.send',
    { supplierId: 'p-supplier-1', cylinderIds: [c.id], reference: 'S1', notes: '', ownerAuthorizationRef: 'OWNER-S1' },
    'operations',
  );
  const previous = s.batches.length;
  s = run(
    s,
    'supplier.receive',
    {
      supplierId: 'p-supplier-1',
      cylinderIds: [c.id],
      reference: 'S1',
      gas: c.gas,
      service: 'test',
      contents: 'empty',
      notes: '',
    },
    'operations',
  );
  assert.equal(s.batches.length, previous);
  assert.equal(s.cylinders.find((x) => x.id === c.id)?.contents, 'empty');
  assert.equal(s.cylinders.find((x) => x.id === c.id)?.condition, 'inspection_due');
});

test('recall quarantines current batch gas and traces prior recipients', () => {
  let s = seed();
  const b = s.batches.find((x) => x.id === 'batch-1')!;
  const old = s.cylinders.find((x) => x.id === 'c-001')!;
  old.custody = 'plant';
  old.custodianId = old.branchId;
  old.batchId = undefined;
  old.condition = 'serviceable';
  const current = s.cylinders.find((x) => x.id === 'c-002')!;
  s = run(s, 'batch.recall', { batchId: b.id, reason: 'Failed potency' }, 'quality');
  assert.equal(s.cylinders.find((x) => x.id === current.id)?.condition, 'quarantine');
  assert.equal(s.cylinders.find((x) => x.id === old.id)?.condition, 'serviceable');
  assert.ok(
    s.batches
      .find((x) => x.id === b.id)
      ?.recipientTrace?.some((x) => x.cylinderId === old.id && x.partyId === 'p-hospital-1'),
  );
});

test('customer loss stays in custody and leaves rental running pending policy decision', () => {
  let s = seed();
  const c = s.cylinders.find((x) => x.id === 'c-001')!;
  s = run(
    s,
    'cylinder.offsiteIncident',
    { cylinderId: c.id, version: c.version, kind: 'lost', notes: 'Customer reported missing' },
    'operations',
  );
  assert.equal(s.rentals.find((x) => x.cylinderId === c.id)?.end, undefined);
  assert.equal(s.cylinders.find((x) => x.id === c.id)?.custody, 'customer');
  assert.equal(s.cylinders.find((x) => x.id === c.id)?.condition, 'quarantine');
  const e = s.exceptions.find((x) => x.type === 'offsite_lost' && x.entityId === c.id)!;
  rejected(
    () => run(s, 'exception.resolve', { exceptionId: e.id, resolution: 'Done' }, 'operations'),
    /still offsite/,
  );
});

test('expired empty cylinders can go to a supplier for testing but held stock cannot', () => {
  let s = seed();
  const c = s.cylinders.find((x) => x.id === 'c-029')!;
  c.condition = 'inspection_due';
  c.testDue = '2026-09-01';
  rejected(
    () =>
      run(
        s,
        'supplier.send',
        {
          supplierId: 'p-supplier-1',
          cylinderIds: [c.id],
          reference: 'TEST-1',
          service: 'fill',
          notes: '',
        },
        'operations',
      ),
    /safe empty/i,
  );
  s = run(
    s,
    'supplier.send',
    {
      supplierId: 'p-supplier-1',
      cylinderIds: [c.id],
      reference: 'TEST-1',
      service: 'test',
      notes: 'Hydrotest',
      ownerAuthorizationRef: 'OWNER-TEST-1',
    },
    'operations',
  );
  assert.equal(s.cylinders.find((x) => x.id === c.id)?.custody, 'supplier');
  assert.match(s.movements[0].notes, /test/i);
  const held = seed();
  const heldCylinder = held.cylinders.find((x) => x.id === 'c-029')!;
  heldCylinder.condition = 'quarantine';
  rejected(
    () =>
      run(
        held,
        'supplier.send',
        {
          supplierId: 'p-supplier-1',
          cylinderIds: [heldCylinder.id],
          reference: 'TEST-2',
          service: 'test',
          notes: '',
        },
        'operations',
      ),
    /safe empty/i,
  );
});

test('rental invoicing accepts only closed days and invoice price can be approved by finance', () => {
  let s = seed();
  rejected(
    () =>
      run(
        s,
        'finance.rental',
        {
          partyId: 'p-hospital-1',
          periodStart: '2026-09-20',
          periodEnd: '2026-09-28',
          taxBps: 0,
          dueDate: '2026-10-01',
        },
        'finance',
      ),
    /closed/i,
  );
  s = run(
    s,
    'order.unload',
    { orderId: 'o-partial-1', cylinderIds: ['c-004'], notes: 'Route ended' },
    'operations',
  );
  s.orders.find((o) => o.id === 'o-partial-1')!.unitPricePaise = 0;
  rejected(
    () =>
      run(
        s,
        'finance.invoice',
        { orderId: 'o-partial-1', taxBps: 0, dueDate: '2026-10-01', notes: '' },
        'finance',
      ),
    /approved gas price/i,
  );
  s = run(
    s,
    'finance.invoice',
    { orderId: 'o-partial-1', taxBps: 0, dueDate: '2026-10-01', notes: '', unitPricePaise: 166000 },
    'finance',
  );
  assert.equal(s.invoices.at(-1)?.lines[0].unitPricePaise, 166000);
});

test('delivery occurrence must be within twelve hours and after dispatch', () => {
  let s = seed();
  rejected(
    () =>
      run(
        s,
        'order.deliver',
        {
          orderId: 'o-partial-1',
          cylinderIds: ['c-004'],
          recipient: 'Desk',
          notes: '',
          occurredAt: '2026-09-27T20:00:00.000Z',
        },
        'driver',
      ),
    /12 hours/i,
  );
  const dispatch = s.movements.find((m) => m.cylinderId === 'c-004' && m.action === 'dispatch')!;
  dispatch.at = '2026-09-28T11:45:00.000Z';
  rejected(
    () =>
      run(
        s,
        'order.deliver',
        {
          orderId: 'o-partial-1',
          cylinderIds: ['c-004'],
          recipient: 'Desk',
          notes: '',
          occurredAt: '2026-09-28T11:30:00.000Z',
        },
        'driver',
      ),
    /dispatch/i,
  );
  s = run(
    s,
    'order.deliver',
    {
      orderId: 'o-partial-1',
      cylinderIds: ['c-004'],
      recipient: 'Desk',
      notes: '',
      occurredAt: '2026-09-28T11:50:00.000Z',
    },
    'driver',
  );
  assert.equal(
    s.orders.find((o) => o.id === 'o-partial-1')?.deliveryProofs?.at(-1)?.at,
    '2026-09-28T11:50:00.000Z',
  );
  assert.equal(s.movements[0].at, '2026-09-28T11:50:00.000Z');
  assert.equal(s.audit[0].at, now);
});

test('finance rejects past due dates and duplicate cash references across customers', () => {
  let s = seed();
  s = run(
    s,
    'order.unload',
    { orderId: 'o-partial-1', cylinderIds: ['c-004'], notes: 'Route ended' },
    'operations',
  );
  rejected(
    () =>
      run(
        s,
        'finance.invoice',
        { orderId: 'o-partial-1', taxBps: 0, dueDate: '2026-09-27', notes: '' },
        'finance',
      ),
    /due date/i,
  );
  s = run(
    s,
    'finance.deposit',
    { partyId: 'p-hospital-1', amountPaise: 100, method: 'cash', reference: 'Cash Book 12' },
    'finance',
  );
  rejected(
    () =>
      run(
        s,
        'finance.deposit',
        { partyId: 'p-home-1', amountPaise: 100, method: 'cash', reference: 'cash book 12' },
        'finance',
      ),
    /reference already posted/i,
  );
  rejected(
    () =>
      run(
        s,
        'finance.deposit',
        { partyId: 'p-supplier-1', amountPaise: 100, method: 'cash', reference: 'Cash Book 13' },
        'finance',
      ),
    /supplier/i,
  );
});

test('purchase records notes and rejects a repeated supplier reference', () => {
  let s = seed();
  const purchase = {
    supplierId: 'p-supplier-1',
    branchId: 'b-delhi',
    gas: 'Medical oxygen',
    reference: 'PO-123',
    notes: 'Seals checked',
    cylinders: [
      {
        serial: 'NEW-123',
        tag: 'NEW-123',
        manufacturer: 'Test Works',
        size: 'B',
        ownerId: 'company',
        testDue: '2027-09-28',
        lastTest: '2026-09-01',
        certificate: 'CERT-123',
      },
    ],
  };
  s = run(s, 'purchase.receive', purchase, 'operations');
  assert.equal(s.batches.at(-1)?.notes, 'Seals checked');
  rejected(
    () =>
      run(
        s,
        'purchase.receive',
        {
          ...purchase,
          cylinders: [{ ...purchase.cylinders[0], serial: 'NEW-124', tag: 'NEW-124' }],
        },
        'operations',
      ),
    /reference/i,
  );
});

test('seed branch owners, industrial release, and invoice parties are valid', () => {
  const s = seed();
  for (const c of s.cylinders)
    assert.ok(
      c.ownerId === 'company' || s.parties.find((p) => p.id === c.ownerId)?.branchId === c.branchId,
    );
  assert.ok(
    s.cylinders.some(
      (c) =>
        c.gas === 'Industrial oxygen' &&
        c.condition === 'serviceable' &&
        c.contents === 'full' &&
        s.batches.find((b) => b.id === c.batchId)?.status === 'released',
    ),
  );
  for (const i of s.invoices) {
    assert.equal(i.billTo?.name, s.parties.find((p) => p.id === i.partyId)?.name);
    assert.equal(i.issuer?.companyName, s.settings.companyName);
  }
  for (const o of s.orders.filter((o) => o.cylinderIds.length)) {
    assert.equal(
      o.challanSnapshot?.recipient.name,
      s.parties.find((p) => p.id === o.partyId)?.name,
    );
    assert.equal(o.challanSnapshot?.issuer.companyName, s.settings.companyName);
  }
});

test('dispatch freezes challan parties and batch retains named fill operator', () => {
  let s = seed();
  const c = s.cylinders.find((x) => x.id === 'c-008')!;
  s = run(
    s,
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
  const o = s.orders.at(-1)!;
  s = run(
    s,
    'order.dispatch',
    { orderId: o.id, cylinderIds: [c.id], vehicle: 'DEMO', driverId: 'u-driver' },
    'operations',
  );
  assert.equal(s.orders.at(-1)?.challanSnapshot?.recipient.gstin, 'DEMO-GST-001');
  assert.equal(s.orders.at(-1)?.challanSnapshot?.issuer.gstin, 'DEMO-GSTIN');
  const empty = s.cylinders.find((x) => x.id === 'c-029')!;
  s = run(
    s,
    'batch.create',
    {
      branchId: empty.branchId,
      gas: empty.gas,
      cylinderIds: [empty.id],
      source: 'Plant',
      operator: 'Shift B Operator',
    },
    'operations',
  );
  assert.equal(s.batches.at(-1)?.operator, 'u-operations');
  assert.equal(s.batches.at(-1)?.fillOperator, 'Shift B Operator');
});

test('foreign branch objects are indistinguishable from missing records', () => {
  const s = seed();
  const limited: User = {
    id: 'u-limited',
    name: 'Limited',
    email: 'limited@demo.invalid',
    role: 'quality',
    branchIds: ['b-delhi'],
    orgId: 'batra',
    active: true,
  };
  const invoke = (cylinderId: string) =>
    applyAction(
      s,
      {
        type: 'cylinder.inspect',
        payload: { cylinderId, version: 1, condition: 'serviceable', notes: 'Check' },
        idempotencyKey: `audit-${++serial}`,
      },
      { user: limited, now, id: () => `audit-id-${++serial}` },
    );
  for (const cylinderId of ['c-051', 'does-not-exist']) {
    assert.throws(
      () => invoke(cylinderId),
      (error: unknown) =>
        error instanceof DomainError &&
        error.status === 404 &&
        error.message === 'Cylinder not found',
    );
  }
  rejected(() => run(s, 'constructor', {}), /not permitted/);
});

test('new orders reject past requested dates and normalize size', () => {
  let s = seed();
  const base = {
    partyId: 'p-hospital-1',
    branchId: 'b-delhi',
    gas: 'Medical oxygen',
    size: 'b',
    quantity: 1,
    priority: 'normal',
    notes: '',
    unitPricePaise: 100,
  };
  rejected(() => run(s, 'order.create', { ...base, dueDate: '2026-09-27' }, 'operations'), /past/i);
  s = run(s, 'order.create', { ...base, dueDate: '2026-09-28' }, 'operations');
  assert.equal(s.orders.at(-1)?.size, 'B');
  s = run(
    s,
    'cylinder.register',
    {
      serial: 'SIZE-1',
      tag: 'SIZE-1',
      manufacturer: 'Test Works',
      gas: 'Medical oxygen',
      size: 'b',
      ownerId: 'company',
      branchId: 'b-delhi',
      testDue: '2027-09-28',
      lastTest: '2026-09-01',
      certificate: 'SIZE-CERT',
    },
    'operations',
  );
  assert.equal(s.cylinders.at(-1)?.size, 'B');
});

test('driver discrepancy requires assigned work in its branch', () => {
  let s = seed();
  rejected(
    () =>
      run(
        s,
        'return.discrepancy',
        { branchId: 'b-faridabad', serial: 'UNKNOWN', notes: 'Unexpected return' },
        'driver',
      ),
    /assigned work/i,
  );
  s = run(
    s,
    'return.discrepancy',
    { branchId: 'b-delhi', serial: 'UNKNOWN', notes: 'Unexpected return' },
    'driver',
  );
  assert.equal(s.exceptions.at(-1)?.branchId, 'b-delhi');
});
