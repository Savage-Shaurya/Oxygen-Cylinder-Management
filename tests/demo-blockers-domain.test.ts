import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAction, DomainError } from '../server/domain.js';
import { createSeedState } from '../server/seed.js';
import { depositBalance } from '../shared/finance.js';
import type { AppState, Invoice, Role, User } from '../shared/types.js';

let n = 0;
const NOW = '2026-09-28T12:00:00.000Z';
const BOTH = ['b-delhi', 'b-faridabad'];
function result(
  s: AppState,
  type: string,
  payload: Record<string, unknown>,
  role: Role = 'admin',
  branchIds = BOTH,
  now = NOW,
) {
  const user: User = {
    id: `u-${role}`,
    name: role,
    email: `${role}@demo.invalid`,
    role,
    branchIds,
    orgId: 'batra',
    active: true,
  };
  return applyAction(
    s,
    { type, payload, idempotencyKey: `blocker-${++n}`, expectedRevision: s.revision },
    { user, now, id: () => `blocker-id-${++n}` },
  );
}
const act = (...args: Parameters<typeof result>) => result(...args).state;
const denies = (f: () => unknown, re: RegExp) =>
  assert.throws(f, (e: unknown) => e instanceof DomainError && re.test(e.message));
const cyl = (s: AppState, id: string) => s.cylinders.find((c) => c.id === id)!;

function writtenOff(id = 'c-001') {
  let s = createSeedState(NOW);
  s = act(s, 'cylinder.offsiteIncident', {
    cylinderId: id,
    version: cyl(s, id).version,
    kind: 'lost',
    notes: 'Missing at ward',
  });
  s = act(s, 'cylinder.writeoff', {
    cylinderId: id,
    version: cyl(s, id).version,
    stopDate: '2026-09-28',
    reason: 'Approved permanent writeoff',
  });
  return s;
}

// D1 ---------------------------------------------------------------------------------------

test('D1: writeoff then return then inspect never revives a written-off cylinder', () => {
  const s = writtenOff();
  assert.equal(cyl(s, 'c-001').condition, 'retired');
  assert.ok(cyl(s, 'c-001').writtenOffAt);
  const movementsBefore = s.movements.length;
  denies(
    () =>
      act(
        s,
        'cylinder.return',
        { partyId: 'p-hospital-1', cylinderIds: ['c-001'], contents: 'empty', notes: 'Found' },
        'operations',
      ),
    /retired/i,
  );
  // Even if earlier code already moved it back to the plant as inspection_due,
  // the durable writeoff mark still blocks every route back to service.
  const c = cyl(s, 'c-001');
  c.custody = 'plant';
  c.custodianId = c.branchId;
  c.condition = 'inspection_due';
  c.offsiteIncident = undefined;
  denies(
    () =>
      act(
        s,
        'cylinder.inspect',
        { cylinderId: c.id, version: c.version, condition: 'serviceable', notes: 'Revive' },
        'quality',
      ),
    /retired/i,
  );
  denies(
    () =>
      act(
        s,
        'cylinder.inspect',
        { cylinderId: c.id, version: c.version, condition: 'quarantine', notes: 'Hold' },
        'quality',
      ),
    /retired/i,
  );
  assert.equal(s.movements.length, movementsBefore, 'History is untouched');
  assert.ok(s.movements.some((m) => m.cylinderId === 'c-001' && m.action === 'writeoff'));
});

test('D1: written-off cylinder is refused by every custody, contents and condition command', () => {
  const s = writtenOff();
  const v = cyl(s, 'c-001').version;
  denies(
    () =>
      act(s, 'cylinder.collect', {
        partyId: 'p-hospital-1',
        cylinderIds: ['c-001'],
        vehicle: 'V',
        driverId: 'u-driver',
        notes: '',
      }),
    /retired/i,
  );
  denies(
    () =>
      act(s, 'cylinder.offsiteIncident', {
        cylinderId: 'c-001',
        version: v,
        kind: 'damaged',
        notes: 'x',
      }),
    /retired/i,
  );
  denies(
    () =>
      act(s, 'rental.stopIncident', {
        cylinderId: 'c-001',
        version: v,
        stopDate: '2026-09-28',
        reason: 'x',
      }),
    /retired/i,
  );
  denies(
    () =>
      act(s, 'cylinder.writeoff', {
        cylinderId: 'c-001',
        version: v,
        stopDate: '2026-09-28',
        reason: 'again',
      }),
    /retired|lost/i,
  );
});

test('D1: legacy serviceable state with a writeoff mark cannot be filled, dispatched or released', () => {
  // c-008 is serviceable full released stock at the Delhi plant.
  let s = createSeedState(NOW);
  cyl(s, 'c-008').writtenOffAt = '2026-09-01T00:00:00.000Z';
  const o = result(
    s,
    'order.create',
    {
      partyId: 'p-hospital-1',
      branchId: 'b-delhi',
      gas: 'Medical oxygen',
      size: 'B',
      quantity: 1,
      priority: 'normal',
      dueDate: '2026-09-28',
      notes: '',
      unitPricePaise: 100,
    },
    'operations',
  );
  s = o.state;
  denies(
    () =>
      act(
        s,
        'order.dispatch',
        { orderId: o.entityId, cylinderIds: ['c-008'], vehicle: 'V', driverId: 'u-driver' },
        'operations',
      ),
    /retired/i,
  );
  // Empty serviceable c-030 with a writeoff mark cannot be filled or sent to a supplier.
  const e = cyl(s, 'c-030');
  e.writtenOffAt = '2026-09-01T00:00:00.000Z';
  denies(
    () =>
      act(
        s,
        'batch.create',
        {
          gas: e.gas,
          branchId: 'b-delhi',
          cylinderIds: [e.id],
          source: 'Plant',
          operator: 'Op',
        },
        'operations',
      ),
    /retired/i,
  );
  denies(
    () =>
      act(
        s,
        'supplier.send',
        {
          supplierId: 'p-supplier-1',
          cylinderIds: [e.id],
          reference: 'SUP-1',
          service: 'test',
        },
        'operations',
      ),
    /retired/i,
  );
});

test('D1: inspection to retired is terminal for retag, empty, supplier and batch reject', () => {
  let s = createSeedState(NOW);
  // c-071 is a member of awaiting_release batch-3 at the Faridabad plant.
  const c = cyl(s, 'c-071');
  assert.equal(s.batches.find((b) => b.id === c.batchId)?.status, 'awaiting_release');
  s = act(s, 'cylinder.inspect', {
    cylinderId: c.id,
    version: c.version,
    condition: 'retired',
    notes: 'Failed hydro test',
    ownerAuthorizationRef: 'OWN-RET-1',
  });
  assert.equal(cyl(s, c.id).condition, 'retired');
  const v = cyl(s, c.id).version;
  denies(
    () => act(s, 'batch.reject', { batchId: c.batchId, cylinderId: c.id, reason: 'x' }, 'quality'),
    /retired/i,
  );
  denies(
    () => act(s, 'cylinder.retag', { cylinderId: c.id, version: v, tag: 'NEW-TAG-1', reason: 'x' }),
    /retired/i,
  );
  denies(
    () =>
      act(
        s,
        'cylinder.empty',
        { cylinderId: c.id, version: v, method: 'vent', notes: 'x' },
        'quality',
      ),
    /retired/i,
  );
  denies(
    () =>
      act(
        s,
        'cylinder.inspect',
        { cylinderId: c.id, version: v, condition: 'serviceable', notes: 'x' },
        'quality',
      ),
    /retired/i,
  );
  assert.equal(cyl(s, c.id).condition, 'retired');
});

test('D1: retired cylinder on a vehicle cannot be unloaded back into stock', () => {
  const s = createSeedState(NOW);
  cyl(s, 'c-004').condition = 'retired';
  denies(
    () =>
      act(
        s,
        'order.unload',
        { orderId: 'o-partial-1', cylinderIds: ['c-004'], notes: '' },
        'operations',
      ),
    /retired/i,
  );
});

// D2 ---------------------------------------------------------------------------------------

test('D2: member returned to another branch does not block a local recall and stays in the trace', () => {
  let s = createSeedState(NOW);
  const batchId = cyl(s, 'c-001').batchId!;
  s = act(
    s,
    'cylinder.return',
    {
      partyId: 'p-hospital-1',
      cylinderIds: ['c-001'],
      receivingBranchId: 'b-faridabad',
      contents: 'empty',
      notes: 'Authorized cross-branch return',
    },
    'operations',
  );
  assert.equal(cyl(s, 'c-001').branchId, 'b-faridabad');
  assert.equal(cyl(s, 'c-001').batchId, undefined);
  const before = s;
  s = act(s, 'batch.recall', { batchId, reason: 'Failed potency' }, 'quality', ['b-delhi']);
  const b = s.batches.find((x) => x.id === batchId)!;
  assert.equal(b.status, 'recalled');
  assert.equal(cyl(s, 'c-002').condition, 'quarantine');
  assert.equal(cyl(s, 'c-001').condition, 'inspection_due', 'Historical member untouched');
  assert.ok(
    b.recipientTrace?.some((r) => r.cylinderId === 'c-001' && r.partyId === 'p-hospital-1'),
  );
  assert.ok(b.cylinderIds.includes('c-001'), 'Historical membership kept');
  assert.equal(
    s.exceptions.some((e) => e.entityId === 'c-001'),
    false,
    'No task for stock that no longer carries this batch',
  );
  assert.equal(before.batches.find((x) => x.id === batchId)!.status, 'released');
});

test('D2: affected stock in another branch is flagged for that branch, never silently skipped', () => {
  let s = createSeedState(NOW);
  // c-005 still carries batch-1 gas but now sits at the Faridabad plant.
  const moved = cyl(s, 'c-005');
  assert.equal(moved.batchId, 'batch-1');
  moved.branchId = 'b-faridabad';
  moved.custodianId = 'b-faridabad';
  const r = result(s, 'batch.recall', { batchId: 'batch-1', reason: 'Failed potency' }, 'quality', [
    'b-delhi',
  ]);
  s = r.state;
  assert.equal(cyl(s, 'c-002').condition, 'quarantine');
  assert.equal(cyl(s, 'c-005').condition, 'serviceable', 'Out-of-scope stock not changed');
  const task = s.exceptions.find((e) => e.entityId === 'c-005' && e.status === 'open');
  assert.ok(task, 'Open task recorded for the other branch');
  assert.equal(task.branchId, 'b-faridabad');
  assert.equal(task.type, 'recall_branch_hold');
  assert.match(task.summary, /DEMO-OX-00005/);
  assert.match(r.message, /another branch/i);
  // The recalled batch already blocks dispatch of that gas everywhere.
  // The other branch cannot close the task until the cylinder is held.
  denies(
    () =>
      act(s, 'exception.resolve', { exceptionId: task.id, resolution: 'Done' }, 'quality', [
        'b-faridabad',
      ]),
    /quarantine|hold/i,
  );
  s = act(
    s,
    'cylinder.inspect',
    {
      cylinderId: 'c-005',
      version: cyl(s, 'c-005').version,
      condition: 'quarantine',
      notes: 'Recall hold',
    },
    'quality',
    ['b-faridabad'],
  );
  s = act(s, 'exception.resolve', { exceptionId: task.id, resolution: 'Held' }, 'quality', [
    'b-faridabad',
  ]);
  assert.equal(s.exceptions.find((e) => e.id === task.id)?.status, 'resolved');
});

test('D2: a quality user with both branches quarantines all current stock', () => {
  let s = createSeedState(NOW);
  cyl(s, 'c-005').branchId = 'b-faridabad';
  cyl(s, 'c-005').custodianId = 'b-faridabad';
  s = act(s, 'batch.recall', { batchId: 'batch-1', reason: 'Failed potency' }, 'quality');
  assert.equal(cyl(s, 'c-005').condition, 'quarantine');
  assert.equal(
    s.exceptions.some((e) => e.type === 'recall_branch_hold'),
    false,
  );
});

// D3 ---------------------------------------------------------------------------------------

// 00:30 IST on 28 September: finance may already bill 27 September.
const MIDNIGHT = '2026-09-27T19:00:00.000Z';
function billedThrough27(freeDays = 0) {
  let s = createSeedState(MIDNIGHT);
  s.parties.find((p) => p.id === 'p-home-1')!.freeDays = freeDays;
  s.rentals.find((r) => r.cylinderId === 'c-003')!.freeDays = 0;
  s = act(
    s,
    'finance.rental',
    {
      partyId: 'p-home-1',
      periodStart: '2026-09-20',
      periodEnd: '2026-09-27',
      taxBps: 0,
      dueDate: '2026-10-10',
    },
    'finance',
    BOTH,
    MIDNIGHT,
  );
  return s;
}
const lateDelivery = (s: AppState, occurredAt?: string) =>
  act(
    s,
    'order.deliver',
    { orderId: 'o-partial-1', cylinderIds: ['c-004'], recipient: 'Desk', notes: '', occurredAt },
    'driver',
    BOTH,
    MIDNIGHT,
  );

test('D3: backdated delivery into an invoiced rental period is refused', () => {
  const s = billedThrough27();
  denies(() => lateDelivery(s, '2026-09-27T18:00:00.000Z'), /already invoiced/i);
});

test('D3: delivery after the invoiced period, or covered by free days, is still accepted', () => {
  const now = lateDelivery(billedThrough27());
  assert.equal(now.rentals.at(-1)?.start, '2026-09-28');
  const free = lateDelivery(billedThrough27(1), '2026-09-27T18:00:00.000Z');
  assert.equal(free.rentals.at(-1)?.start, '2026-09-27');
});

test('D3: a fully credited rental invoice no longer blocks the late delivery', () => {
  let s = billedThrough27();
  const inv = s.invoices.at(-1)!;
  s = act(s, 'finance.credit', { invoiceId: inv.id, reason: 'Reissue' }, 'finance', BOTH, MIDNIGHT);
  s = lateDelivery(s, '2026-09-27T18:00:00.000Z');
  assert.equal(s.rentals.at(-1)?.start, '2026-09-27');
});

// D4 ---------------------------------------------------------------------------------------

test('D4: deposits cannot push a balance past the money limit or lose paise', () => {
  let s = createSeedState(NOW);
  const dep = (amountPaise: number, reference: string) =>
    act(
      s,
      'finance.deposit',
      { partyId: 'p-hospital-1', amountPaise, method: 'bank', reference },
      'finance',
    );
  denies(() => dep(Number.MAX_SAFE_INTEGER, 'BIG-1'), /limit/i);
  s = dep(3_000_000_000_000_000, 'BIG-2');
  denies(() => dep(3_000_000_000_000_000, 'BIG-3'), /limit/i);
  s = dep(1, 'SMALL-1');
  assert.equal(depositBalance(s, 'p-hospital-1'), 3_000_000_000_000_001);
});

test('D4: customer credit totals cannot exceed the money limit', () => {
  let s = createSeedState(NOW);
  const base = s.invoices.find((i) => i.id === 'inv-seed-1')!;
  const big = (id: string): Invoice => ({
    ...structuredClone(base),
    id,
    number: `GINV-${id}`,
    sourceId: id,
    lines: [
      {
        description: 'x',
        quantity: 1,
        unitPricePaise: 3_000_000_000_000_000,
        amountPaise: 3_000_000_000_000_000,
      },
    ],
    subtotalPaise: 3_000_000_000_000_000,
    taxBps: 0,
    taxPaise: 0,
    totalPaise: 3_000_000_000_000_000,
    paidPaise: 3_000_000_000_000_000,
    status: 'paid',
  });
  s.invoices.push(big('big-a'), big('big-b'));
  s = act(s, 'finance.credit', { invoiceId: 'big-a', reason: 'Correction' }, 'finance');
  denies(
    () => act(s, 'finance.credit', { invoiceId: 'big-b', reason: 'Correction' }, 'finance'),
    /limit/i,
  );
});

test('D4: invoice amounts above the money limit are refused', () => {
  let s = createSeedState(NOW);
  s = act(
    s,
    'order.unload',
    { orderId: 'o-partial-1', cylinderIds: ['c-004'], notes: 'Route ended' },
    'operations',
  );
  denies(
    () =>
      act(
        s,
        'finance.invoice',
        {
          orderId: 'o-partial-1',
          taxBps: 0,
          dueDate: '2026-10-01',
          notes: '',
          unitPricePaise: 5_000_000_000_000_000,
          creditLimitOverrideReason: 'Approved',
        },
        'admin',
      ),
    /out of range/i,
  );
});
