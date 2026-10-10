// A cylinder written off as lost that turns up again: an admin receives it back. It returns to
// the godown on hold and must pass a safety check before use; both events stay in its history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, DomainError } from '../server/domain.js';
import { createSeedState } from '../server/seed.js';
import type { AppState, Role, User } from '../shared/types.js';
import { lifeStory } from '../src/life-story.js';

const NOW = new Date().toISOString();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(NOW));
const nextYear = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
const user = (role: Role): User => ({
  id: `u-${role}`,
  name: `Test ${role}`,
  email: `${role}@example.test`,
  role,
  branchIds: ['b-delhi', 'b-faridabad'],
  orgId: 'batra',
  active: true,
});
let n = 0;
const act = (s: AppState, role: Role, type: string, payload: Record<string, unknown>) =>
  applyAction(
    s,
    { type, payload, idempotencyKey: `recover-${++n}`, expectedRevision: s.revision },
    { user: user(role), now: NOW, id: () => `recover-id-${++n}` },
  ).state;
const refused = (fn: () => unknown, message?: RegExp) =>
  assert.throws(
    fn,
    (e: unknown) => e instanceof DomainError && (!message || message.test(e.message)),
  );

/** A company cylinder at a customer, reported lost and written off. */
function writtenOff() {
  let s = createSeedState(NOW);
  const c = s.cylinders.find((x) => x.custody === 'customer' && x.ownerId === 'company')!;
  const version = () => s.cylinders.find((x) => x.id === c.id)!.version;
  s = act(s, 'admin', 'cylinder.offsiteIncident', {
    cylinderId: c.id,
    version: version(),
    kind: 'lost',
    notes: 'Not found at the ward',
  });
  s = act(s, 'admin', 'cylinder.writeoff', {
    cylinderId: c.id,
    version: version(),
    stopDate: today,
    reason: 'Lost after search',
  });
  return { s, id: c.id };
}

test('an admin receives a written-off lost cylinder back on hold at the godown', () => {
  const { s: before, id } = writtenOff();
  const c0 = before.cylinders.find((x) => x.id === id)!;
  const s = act(before, 'admin', 'cylinder.recover', {
    cylinderId: id,
    version: c0.version,
    branchId: 'b-delhi',
    reason: 'Found in the hospital basement store',
  });
  const c = s.cylinders.find((x) => x.id === id)!;
  assert.equal(c.custody, 'plant');
  assert.equal(c.custodianId, 'b-delhi');
  assert.equal(c.condition, 'quarantine');
  assert.equal(c.contents, 'unknown');
  assert.equal(c.writtenOffAt, undefined);
  assert.equal(c.offsiteIncident, undefined);
  assert.equal(c.batchId, undefined);
  const actions = s.movements.filter((m) => m.cylinderId === id).map((m) => m.action);
  assert.ok(actions.includes('writeoff') && actions.includes('recovery'), 'both stay in history');
  const story = lifeStory(s, id, [{ id: 'u-admin', name: 'Test admin' }]).events;
  assert.equal(story.at(-1)!.title, 'Found and received back');
});

test('a recovered cylinder must pass a safety check before it can be used', () => {
  const { s: before, id } = writtenOff();
  let s = act(before, 'admin', 'cylinder.recover', {
    cylinderId: id,
    version: before.cylinders.find((x) => x.id === id)!.version,
    branchId: 'b-delhi',
    reason: 'Found again',
  });
  const order = s.orders.find((o) => o.status === 'open')!;
  refused(() =>
    act(s, 'operations', 'order.dispatch', {
      orderId: order.id,
      cylinderIds: [id],
      vehicle: 'DL 1',
      driverId: 'u-driver',
    }),
  );
  s = act(s, 'quality', 'cylinder.inspect', {
    cylinderId: id,
    version: s.cylinders.find((x) => x.id === id)!.version,
    condition: 'serviceable',
    notes: 'Checked after recovery',
    lastTest: today,
    testDue: nextYear,
    certificate: 'TEST-RECOVERED',
  });
  assert.equal(s.cylinders.find((x) => x.id === id)!.condition, 'serviceable');
});

test('only an admin can receive a cylinder back, with a reason', () => {
  const { s, id } = writtenOff();
  const version = s.cylinders.find((x) => x.id === id)!.version;
  for (const role of ['operations', 'quality', 'finance', 'driver', 'auditor'] as Role[])
    refused(() =>
      act(s, role, 'cylinder.recover', {
        cylinderId: id,
        version,
        branchId: 'b-delhi',
        reason: 'x',
      }),
    );
  refused(() =>
    act(s, 'admin', 'cylinder.recover', {
      cylinderId: id,
      version,
      branchId: 'b-delhi',
      reason: '',
    }),
  );
});

test('recovery is only for written-off lost cylinders; retirement by inspection stays final', () => {
  const s = createSeedState(NOW);
  const active = s.cylinders.find((x) => x.custody === 'plant' && x.condition === 'serviceable')!;
  refused(
    () =>
      act(s, 'admin', 'cylinder.recover', {
        cylinderId: active.id,
        version: active.version,
        branchId: 'b-delhi',
        reason: 'Not lost',
      }),
    /written off as lost/i,
  );
  const scrapped = s.cylinders.find((x) => x.condition === 'retired' && !x.writtenOffAt);
  if (scrapped)
    refused(() =>
      act(s, 'admin', 'cylinder.recover', {
        cylinderId: scrapped.id,
        version: scrapped.version,
        branchId: 'b-delhi',
        reason: 'Try',
      }),
    );
});

test('a stale version is refused', () => {
  const { s, id } = writtenOff();
  const c = s.cylinders.find((x) => x.id === id)!;
  refused(
    () =>
      act(s, 'admin', 'cylinder.recover', {
        cylinderId: id,
        version: c.version - 1,
        branchId: 'b-delhi',
        reason: 'Found',
      }),
    /version/i,
  );
});
