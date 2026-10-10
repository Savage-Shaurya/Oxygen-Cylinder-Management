// Checks the demo story anchors in the seed (docs/demo-script.md): each anchor exists, the
// custody totals add up from real records, and the presenter's full handoff runs end to end
// on the same records under the real domain rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, DomainError } from '../server/domain.js';
import { createSeedState } from '../server/seed.js';
import type { AppState, Role, User } from '../shared/types.js';

const NOW = new Date().toISOString();
const ids: Record<Role, string> = {
  admin: 'u-admin',
  operations: 'u-ops',
  quality: 'u-quality',
  finance: 'u-finance',
  driver: 'u-driver',
  auditor: 'u-auditor',
};
const user = (role: Role): User => ({
  id: ids[role],
  name: `Demo ${role}`,
  email: `${role}@example.test`,
  role,
  branchIds: ['b-delhi', 'b-faridabad'],
  orgId: 'batra',
  active: true,
});
let sequence = 0;
function act(s: AppState, role: Role, type: string, payload: Record<string, unknown>) {
  return applyAction(
    s,
    { type, payload, idempotencyKey: `demo-seed-${++sequence}`, expectedRevision: s.revision },
    { user: user(role), now: NOW, id: () => `demo-seed-id-${++sequence}` },
  ).state;
}
function refused(fn: () => unknown, message?: RegExp) {
  assert.throws(fn, (error: unknown) => error instanceof DomainError && (!message || message.test(error.message)));
}
const byTag = (s: AppState, tag: string) => {
  const c = s.cylinders.find((x) => x.tag === tag);
  assert.ok(c, `anchor ${tag} exists`);
  return c;
};
const indiaToday = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date(NOW));

test('demo anchors exist with the states the script promises', () => {
  const s = createSeedState(NOW);
  for (const tag of ['DEMO-LOAD-1', 'DEMO-LOAD-2']) {
    const c = byTag(s, tag);
    assert.equal(c.contents, 'full');
    assert.equal(s.batches.find((b) => b.id === c.batchId)?.status, 'awaiting_release');
  }
  const awaiting = s.batches.find((b) => b.number === 'DEMO-BATCH-006')!;
  assert.equal(awaiting.operator, 'u-ops');
  assert.equal(byTag(s, 'DEMO-HOLD-1').condition, 'quarantine');
  assert.ok(byTag(s, 'DEMO-EXPIRED-1').testDue < indiaToday);
  for (const tag of ['DEMO-GIVE-1', 'DEMO-GIVE-2']) {
    const c = byTag(s, tag);
    assert.equal(c.custody, 'vehicle');
    assert.equal(c.custodianId, 'o-route-1');
  }
  const route = s.orders.find((o) => o.number === 'DEMO-ORD-007')!;
  assert.equal(route.status, 'dispatched');
  assert.equal(route.driverId, 'u-driver');
  for (const tag of ['DEMO-TAKE-1', 'DEMO-TAKE-2'])
    assert.equal(byTag(s, tag).custodianId, 'p-hospital-3');
  assert.equal(byTag(s, 'DEMO-CLINIC-1').custodianId, 'p-clinic-1');
  for (const tag of ['DEMO-SUP-1', 'DEMO-SUP-2']) assert.equal(byTag(s, tag).custody, 'supplier');
  const open = s.orders.find((o) => o.number === 'DEMO-ORD-008')!;
  assert.equal(open.status, 'open');
  assert.equal(open.quantity, 2);
  assert.equal(s.parties.find((p) => p.id === open.partyId)?.type, 'hospital');
  const partPaid = s.invoices.find((i) => i.number === 'DEMO-INV-004')!;
  assert.equal(partPaid.status, 'partial');
  assert.ok(partPaid.paidPaise > 0 && partPaid.paidPaise < partPaid.totalPaise);
  assert.ok(s.exceptions.some((e) => e.status === 'open' && e.entityId === byTag(s, 'DEMO-HOLD-1').id));
  // Tags are unique, so a typed or scanned code always finds one cylinder.
  assert.equal(new Set(s.cylinders.map((c) => c.tag)).size, s.cylinders.length);
});

test('custody totals and money come from real records', () => {
  const s = createSeedState(NOW);
  const count = (custody: string) => s.cylinders.filter((c) => c.custody === custody).length;
  assert.deepEqual(
    { total: s.cylinders.length, plant: count('plant'), vehicle: count('vehicle'), customer: count('customer'), supplier: count('supplier') },
    { total: 95, plant: 84, vehicle: 3, customer: 6, supplier: 2 },
  );
  // Every cylinder with a customer has exactly one open rental with that customer.
  for (const c of s.cylinders.filter((x) => x.custody === 'customer')) {
    const open = s.rentals.filter((r) => r.cylinderId === c.id && !r.end);
    assert.equal(open.length, 1, c.tag);
    assert.equal(open[0].partyId, c.custodianId);
  }
  // Every vehicle cylinder sits on a real order manifest and has a dispatch movement.
  for (const c of s.cylinders.filter((x) => x.custody === 'vehicle')) {
    const order = s.orders.find((o) => o.id === c.custodianId)!;
    assert.ok(order.cylinderIds.includes(c.id));
    assert.ok(s.movements.some((m) => m.cylinderId === c.id && m.action === 'dispatch' && m.reference === order.id));
  }
  // Invoice totals match their lines; paid amounts match recorded payment receipts.
  for (const i of s.invoices) {
    assert.equal(i.subtotalPaise, i.lines.reduce((n, l) => n + l.amountPaise, 0), i.number);
    assert.equal(i.totalPaise, i.subtotalPaise + i.taxPaise, i.number);
    const paid = s.receipts
      .filter((r) => r.invoiceId === i.id && r.kind === 'payment')
      .reduce((n, r) => n + r.amountPaise, 0);
    assert.equal(i.paidPaise, paid, i.number);
  }
});

test('refusals the script shows: hold, expired test, not yet released', () => {
  const s = createSeedState(NOW);
  for (const tag of ['DEMO-HOLD-1', 'DEMO-EXPIRED-1', 'DEMO-LOAD-1'])
    refused(
      () =>
        act(s, 'operations', 'order.dispatch', {
          orderId: 'o-open-3',
          cylinderIds: [byTag(s, tag).id, byTag(s, 'DEMO-TAG-00012').id],
          vehicle: 'DL 02 DEMO',
          driverId: 'u-driver',
        }),
      /dispatchable|Released batch/,
    );
  // Operations recorded the fill, so Operations cannot release it.
  refused(() =>
    act(s, 'operations', 'batch.release', { batchId: 'batch-6', certificate: 'X', qualityNotes: 'X' }),
  );
});

test('quick path: the driver can Give and Take back straight from the seed', () => {
  let s = createSeedState(NOW);
  s = act(s, 'driver', 'order.deliver', {
    orderId: 'o-route-1',
    cylinderIds: [byTag(s, 'DEMO-GIVE-1').id, byTag(s, 'DEMO-GIVE-2').id],
    recipient: 'Demo Clinic Manager',
  });
  assert.equal(s.orders.find((o) => o.id === 'o-route-1')?.status, 'delivered');
  s = act(s, 'driver', 'cylinder.collect', {
    partyId: 'p-clinic-1',
    cylinderIds: [byTag(s, 'DEMO-CLINIC-1').id],
    vehicle: 'DL 02 DEMO',
    driverId: 'u-driver',
  });
  assert.equal(byTag(s, 'DEMO-CLINIC-1').custody, 'vehicle');
});

test('full handoff on the same records: Quality, Godown, Driver, Godown, Finance, recall', () => {
  let s = createSeedState(NOW);
  const load = ['DEMO-LOAD-1', 'DEMO-LOAD-2'].map((t) => byTag(s, t).id);
  const take = ['DEMO-TAKE-1', 'DEMO-TAKE-2'].map((t) => byTag(s, t).id);
  s = act(s, 'quality', 'batch.release', {
    batchId: 'batch-6',
    certificate: 'DEMO-QC-LIVE',
    qualityNotes: 'Demo release',
  });
  s = act(s, 'operations', 'order.dispatch', {
    orderId: 'o-open-3',
    cylinderIds: load,
    vehicle: 'DL 02 DEMO',
    driverId: 'u-driver',
  });
  s = act(s, 'driver', 'order.deliver', { orderId: 'o-open-3', cylinderIds: load, recipient: 'Demo Ward Sister' });
  s = act(s, 'driver', 'cylinder.collect', {
    partyId: 'p-hospital-3',
    cylinderIds: take,
    vehicle: 'DL 02 DEMO',
    driverId: 'u-driver',
  });
  s = act(s, 'operations', 'cylinder.return', { partyId: 'p-hospital-3', cylinderIds: take, contents: 'empty' });
  for (const id of take) {
    const c = s.cylinders.find((x) => x.id === id)!;
    assert.equal(c.custody, 'plant');
    assert.equal(c.condition, 'inspection_due');
  }
  s = act(s, 'finance', 'finance.invoice', { orderId: 'o-open-3', taxBps: 1200, dueDate: indiaToday });
  const invoice = s.invoices.find((i) => i.sourceId === 'o-open-3')!;
  assert.equal(invoice.totalPaise, 331520);
  s = act(s, 'finance', 'finance.receipt', {
    invoiceId: invoice.id,
    amountPaise: 100000,
    method: 'upi',
    reference: 'DEMO-UPI-LIVE',
  });
  assert.equal(s.invoices.find((i) => i.id === invoice.id)?.status, 'partial');
  // Custody totals are back to the starting position; only state and history differ.
  const count = (custody: string) => s.cylinders.filter((c) => c.custody === custody).length;
  assert.deepEqual([count('plant'), count('vehicle'), count('customer'), count('supplier')], [84, 3, 6, 2]);
  // The auditor cannot change anything.
  refused(() => act(s, 'auditor', 'finance.receipt', { invoiceId: invoice.id, amountPaise: 1, method: 'cash', reference: 'X' }));
  // Recall of DEMO-BATCH-005 traces the seeded hospital and clinic deliveries.
  s = act(s, 'quality', 'batch.recall', { batchId: 'batch-5', reason: 'Demo recall drill' });
  const trace = s.batches.find((b) => b.id === 'batch-5')!.recipientTrace!;
  assert.deepEqual([...new Set(trace.map((r) => r.partyId))].sort(), ['p-clinic-1', 'p-hospital-3']);
  assert.equal(byTag(s, 'DEMO-CLINIC-1').condition, 'quarantine');
  assert.ok(s.exceptions.some((e) => e.type === 'recall_recovery' && e.entityId === byTag(s, 'DEMO-CLINIC-1').id));
});
