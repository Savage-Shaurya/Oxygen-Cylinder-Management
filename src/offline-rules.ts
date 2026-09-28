import type { ActionRequest } from '../shared/types';
export interface QueuedDelivery {
  id: string;
  userId: string;
  createdAt: string;
  status: 'pending' | 'conflict';
  action: ActionRequest;
  error?: string;
}
export function validateQueuedDelivery(
  record: QueuedDelivery,
  userId: string,
  now: string,
): string | null {
  if (record.userId !== userId)
    return 'This evidence belongs to another user. Sign in with the original account.';
  if (record.action.type !== 'order.deliver')
    return 'Only delivery evidence may be queued offline.';
  if (record.id !== record.action.idempotencyKey)
    return 'The saved evidence identity is invalid. Review it before proceeding.';
  const elapsed = Date.parse(now) - Date.parse(record.createdAt);
  if (!Number.isFinite(elapsed) || elapsed < -300_000)
    return 'The device time is invalid. Review the recorded handover time.';
  if (elapsed > 12 * 60 * 60 * 1000)
    return 'Offline authorization has expired. Reconcile this evidence with the office.';
  if (record.status === 'conflict')
    return record.error || 'This delivery needs office review before it can be posted.';
  return null;
}
export function canRetryDelivery(status: number, message = ''): boolean {
  return (
    status === 0 || status === 401 || (status === 403 && /csrf/i.test(message)) || status >= 500
  );
}
