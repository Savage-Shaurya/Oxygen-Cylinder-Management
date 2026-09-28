import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateQueuedDelivery,
  canRetryDelivery,
  type QueuedDelivery,
} from '../src/offline-rules';

const record: QueuedDelivery = {
  id: 'evt-1',
  userId: 'u-driver',
  createdAt: '2026-09-28T08:00:00Z',
  status: 'pending',
  action: {
    type: 'order.deliver',
    payload: { orderId: 'o-1', cylinderIds: ['c-1'], recipient: 'Receiving staff', notes: '' },
    idempotencyKey: 'evt-1',
    expectedRevision: 4,
  },
};
test('only scoped pending delivery evidence can be synchronized', () => {
  assert.equal(validateQueuedDelivery(record, 'u-driver', '2026-09-28T09:00:00Z'), null);
  assert.match(validateQueuedDelivery(record, 'u-other', '2026-09-28T09:00:00Z')!, /another user/);
  assert.match(
    validateQueuedDelivery(
      { ...record, action: { ...record.action, type: 'finance.refund' } },
      'u-driver',
      '2026-09-28T09:00:00Z',
    )!,
    /delivery/,
  );
});
test('expired, future-dated and conflicted records cannot replay automatically', () => {
  assert.match(validateQueuedDelivery(record, 'u-driver', '2026-09-29T09:00:00Z')!, /expired/);
  assert.match(validateQueuedDelivery(record, 'u-driver', '2026-09-27T09:00:00Z')!, /time/);
  assert.equal(canRetryDelivery(409), false);
  assert.equal(canRetryDelivery(401), true);
  assert.equal(canRetryDelivery(403, 'Invalid CSRF token'), true);
  assert.equal(canRetryDelivery(403, 'Role is not allowed'), false);
  assert.equal(canRetryDelivery(0), true);
  assert.equal(canRetryDelivery(503), true);
});
test('an action and storage record must share one idempotency identity', () => {
  assert.match(
    validateQueuedDelivery({ ...record, id: 'different' }, 'u-driver', '2026-09-28T09:00:00Z')!,
    /identity/,
  );
});
