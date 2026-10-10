// A delivery made live during the demo must appear in a later recall of its batch, so the
// presenter can show "who received this gas" for cylinders the audience just watched move.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction } from '../server/domain.js';
import { createSeedState } from '../server/seed.js';
import type { AppState, Role, User } from '../shared/types.js';

const NOW = new Date().toISOString();
const user = (role: Role): User => ({
  id: {
    admin: 'u-admin',
    operations: 'u-ops',
    quality: 'u-quality',
    finance: 'u-finance',
    driver: 'u-driver',
    auditor: 'u-auditor',
  }[role],
  name: `Demo ${role}`,
  email: `${role}@example.test`,
  role,
  branchIds: ['b-delhi', 'b-faridabad'],
  orgId: 'batra',
  active: true,
});
let sequence = 0;
const act = (s: AppState, role: Role, type: string, payload: Record<string, unknown>) =>
  applyAction(
    s,
    { type, payload, idempotencyKey: `recall-live-${++sequence}`, expectedRevision: s.revision },
    { user: user(role), now: NOW, id: () => `recall-live-id-${++sequence}` },
  ).state;

test('recalling a batch traces the deliveries made live in the demo', () => {
  let s = createSeedState(NOW);
  const load = ['DEMO-LOAD-1', 'DEMO-LOAD-2'].map(
    (tag) => s.cylinders.find((c) => c.tag === tag)!.id,
  );
  s = act(s, 'quality', 'batch.release', {
    batchId: 'batch-6',
    certificate: 'QC-LIVE',
    qualityNotes: 'Demo release',
  });
  s = act(s, 'operations', 'order.dispatch', {
    orderId: 'o-open-3',
    cylinderIds: load,
    vehicle: 'DL 02 DEMO',
    driverId: 'u-driver',
  });
  s = act(s, 'driver', 'order.deliver', {
    orderId: 'o-open-3',
    cylinderIds: load,
    recipient: 'Demo Ward Sister',
  });
  s = act(s, 'quality', 'batch.recall', { batchId: 'batch-6', reason: 'Demo recall drill' });
  const trace = s.batches.find((b) => b.id === 'batch-6')!.recipientTrace ?? [];
  assert.deepEqual(trace.map((r) => r.cylinderId).sort(), [...load].sort());
  assert.ok(trace.every((r) => r.orderId === 'o-open-3' && r.partyId === 'p-hospital-3'));
});
