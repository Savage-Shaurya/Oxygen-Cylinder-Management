import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAction } from '../server/domain.js';
import { createSeedState } from '../server/seed.js';
import type { AppState, Role, User } from '../shared/types.js';
import { lifeStory } from '../src/life-story.js';

const NOW = '2026-09-28T12:00:00.000Z';
let sequence = 0;
const user = (role: Role): User => ({
  id: `u-${role}`,
  name: `Test ${role}`,
  email: `${role}@batra.demo`,
  role,
  branchIds: ['b-delhi', 'b-faridabad'],
  orgId: 'batra',
  active: true,
});
const people = (['admin', 'operations', 'quality', 'driver'] as Role[]).map((role) => ({
  id: `u-${role}`,
  name: `Test ${role}`,
}));

/** Every step at the same instant, so the story must rely on recording order. */
function act(state: AppState, role: Role, type: string, payload: Record<string, unknown>) {
  return applyAction(
    state,
    { type, payload, idempotencyKey: `life-${++sequence}`, expectedRevision: state.revision },
    { user: user(role), now: NOW, id: () => `life-id-${++sequence}` },
  );
}

test('a full life cycle reads as a plain story, oldest first, with people and places', () => {
  let state = createSeedState(NOW);
  let result = act(state, 'admin', 'cylinder.register', {
    serial: 'SER-LIFE-1',
    tag: 'LIFE-1',
    manufacturer: 'Demo Cylinder Works',
    gas: 'Medical oxygen',
    size: 'B',
    ownerId: 'company',
    branchId: 'b-delhi',
    testDue: '2027-09-01',
    lastTest: '2026-09-01',
    certificate: 'TEST-LIFE-1',
  });
  state = result.state;
  const id = state.cylinders.find((c) => c.tag === 'LIFE-1')!.id;
  const version = () => state.cylinders.find((c) => c.id === id)!.version;
  state = act(state, 'quality', 'cylinder.inspect', {
    cylinderId: id,
    version: version(),
    condition: 'serviceable',
    notes: 'Checked',
  }).state;
  result = act(state, 'operations', 'batch.create', {
    gas: 'Medical oxygen',
    branchId: 'b-delhi',
    cylinderIds: [id],
    source: 'Tank 1',
    operator: 'Test operations',
  });
  state = result.state;
  state = act(state, 'quality', 'batch.release', {
    batchId: result.entityId,
    certificate: 'QC-LIFE-1',
    qualityNotes: 'Within limits',
  }).state;
  result = act(state, 'admin', 'order.create', {
    partyId: 'p-hospital-1',
    branchId: 'b-delhi',
    gas: 'Medical oxygen',
    size: 'B',
    quantity: 1,
    priority: 'normal',
    dueDate: '2026-09-28',
    notes: '',
    unitPricePaise: 0,
  });
  state = result.state;
  const orderId = result.entityId!;
  state = act(state, 'operations', 'order.dispatch', {
    orderId,
    cylinderIds: [id],
    vehicle: 'DL 01 AB 1234',
    driverId: 'u-driver',
  }).state;
  state = act(state, 'driver', 'order.deliver', {
    orderId,
    cylinderIds: [id],
    recipient: 'Sister Mary',
    notes: '',
  }).state;

  const { events, summary } = lifeStory(state, id, people);
  assert.deepEqual(
    events.map((e) => e.title),
    [
      'Joined the fleet',
      'Safety check',
      'Filled with gas',
      'Passed quality check',
      'Loaded on a truck',
      'Delivered',
    ],
  );
  const loaded = events.find((e) => e.title === 'Loaded on a truck')!;
  assert.match(loaded.detail, /DL 01 AB 1234/);
  assert.match(loaded.detail, /driven by Test driver/);
  assert.match(events.at(-1)!.detail, /received by Sister Mary/);
  assert.equal(events.find((e) => e.stage === 'released')!.who, 'Test quality');
  assert.equal(summary.trips, 1);
  assert.equal(summary.fills, 1);
  assert.equal(summary.inspections, 1);
  assert.equal(summary.customers.length, 1);
});

test('an unknown cylinder has no story', () => {
  const { cylinder, events } = lifeStory(createSeedState(NOW), 'missing', people);
  assert.equal(cylinder, undefined);
  assert.equal(events.length, 0);
});
