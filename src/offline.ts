import type { ActionRequest } from '../shared/types';
import { ApiError, pendingAction, submitAction } from './api';
import { canRetryDelivery, validateQueuedDelivery, type QueuedDelivery } from './offline-rules';
export type { QueuedDelivery } from './offline-rules';

// The non-extractable key and encrypted records live in this browser profile.
// This protects stored payloads from casual inspection, not a compromised origin/device.
const DB_NAME = 'batra-field-evidence-v1';
interface StoredRecord {
  id: string;
  userId: string;
  orderFingerprint?: string;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
}
let opening: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (!opening)
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const records = req.transaction!.objectStoreNames.contains('records')
          ? req.transaction!.objectStore('records')
          : req.result.createObjectStore('records', { keyPath: 'id' });
        if (!records.indexNames.contains('orderFingerprint'))
          records.createIndex('orderFingerprint', 'orderFingerprint', { unique: true });
        if (!req.result.objectStoreNames.contains('keys')) req.result.createObjectStore('keys');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        opening = undefined;
        reject(
          new Error('Offline storage is unavailable. Keep a manual record and contact the office.'),
        );
      };
    });
  return opening;
}
async function read<T>(store: string, key?: IDBValidKey): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const req =
      key === undefined
        ? db.transaction(store).objectStore(store).getAll()
        : db.transaction(store).objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}
async function write(store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    if (key === undefined) tx.objectStore(store).put(value);
    else tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
const keys = new Map<string, Promise<CryptoKey>>();
function keyFor(userId: string): Promise<CryptoKey> {
  if (!keys.has(userId))
    keys.set(
      userId,
      (async () => {
        const existing = await read<CryptoKey | undefined>('keys', userId);
        if (existing) return existing;
        const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
          'encrypt',
          'decrypt',
        ]);
        await write('keys', key, userId);
        return key;
      })(),
    );
  return keys.get(userId)!;
}
async function save(record: QueuedDelivery): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(record.userId);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(record)),
  );
  const orderFingerprint = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify([record.userId, record.action.payload.orderId])),
      ),
    ),
    (value) => value.toString(16).padStart(2, '0'),
  ).join('');
  await write('records', {
    id: record.id,
    userId: record.userId,
    orderFingerprint,
    iv,
    ciphertext,
  } satisfies StoredRecord);
}
export async function listQueuedDeliveries(userId: string): Promise<QueuedDelivery[]> {
  const rows = (await read<StoredRecord[]>('records')).filter((row) => row.userId === userId);
  if (!rows.length) return [];
  const key = await keyFor(userId);
  const values = await Promise.all(
    rows.map(async (row) => {
      try {
        const bytes = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: row.iv as Uint8Array<ArrayBuffer> },
          key,
          row.ciphertext,
        );
        return JSON.parse(new TextDecoder().decode(bytes)) as QueuedDelivery;
      } catch {
        throw new Error(
          'Saved field evidence could not be read. Contact the office before clearing browser storage.',
        );
      }
    }),
  );
  return values.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
/**
 * Saves delivery evidence on this device. When the delivery was already sent but not
 * confirmed, pass that exact command (`sent`): the queue keeps its key and payload unchanged,
 * so a sync reconciles the original instead of creating a second delivery.
 */
export async function queueDelivery(
  userId: string,
  payload: Record<string, unknown>,
  sent?: ActionRequest,
): Promise<QueuedDelivery> {
  // Without an explicit envelope, an unconfirmed send of this same delivery is reused.
  const original = sent ?? (await pendingAction(userId, 'order.deliver', payload));
  const body = original ? original.payload : payload;
  if (original && original.type !== 'order.deliver')
    throw new Error('Only delivery evidence may be saved on this device.');
  if (
    !userId ||
    !body.orderId ||
    !Array.isArray(body.cylinderIds) ||
    !body.cylinderIds.length ||
    !String(body.recipient || '').trim()
  )
    throw new Error('Select the order, accepted cylinders and recipient before saving evidence.');
  const current = await listQueuedDeliveries(userId);
  const same = original && current.find((record) => record.id === original.idempotencyKey);
  if (same) return same;
  if (current.length >= 50)
    throw new Error('Reconcile your saved deliveries before recording more.');
  if (current.some((record) => record.action.payload.orderId === body.orderId))
    throw new Error(
      'This order already has saved delivery evidence. Review it before adding another.',
    );
  const createdAt = new Date().toISOString();
  const id = original?.idempotencyKey ?? crypto.randomUUID();
  const record: QueuedDelivery = {
    id,
    userId,
    createdAt,
    status: 'pending',
    // A sent command is kept exactly as sent; the server matches its key to that payload.
    action: original
      ? structuredClone(original)
      : {
          type: 'order.deliver',
          payload: { ...payload, occurredAt: createdAt },
          idempotencyKey: id,
        },
  };
  try {
    await save(record);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'ConstraintError')
      throw new Error(
        'This order already has saved delivery evidence. Review it before adding another.',
      );
    throw error;
  }
  window.dispatchEvent(new Event('batra-offline-change'));
  return record;
}
export async function discardQueuedDelivery(userId: string, id: string): Promise<void> {
  const row = await read<StoredRecord | undefined>('records', id);
  if (row && row.userId !== userId) throw new Error('This evidence belongs to another user.');
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite');
    tx.objectStore('records').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  window.dispatchEvent(new Event('batra-offline-change'));
}
export async function clearQueuedDeliveries(userId: string): Promise<void> {
  for (const record of await listQueuedDeliveries(userId))
    await discardQueuedDelivery(userId, record.id);
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('keys', 'readwrite');
    tx.objectStore('keys').delete(userId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  keys.delete(userId);
}
export function offlineEvidenceDocument(record: QueuedDelivery): string {
  return JSON.stringify(
    {
      format: 'CTMS saved delivery evidence',
      version: 1,
      exportedAt: new Date().toISOString(),
      notice:
        'Locally recorded claim; server acceptance and physical reconciliation must be verified separately.',
      record,
    },
    null,
    2,
  );
}
let synchronizing = false;
export async function syncQueuedDeliveries(
  userId: string,
): Promise<{ accepted: number; conflicts: number }> {
  if (synchronizing) throw new Error('Delivery synchronization is already running.');
  synchronizing = true;
  let accepted = 0,
    conflicts = 0;
  try {
    for (const record of await listQueuedDeliveries(userId)) {
      const invalid = validateQueuedDelivery(record, userId, new Date().toISOString());
      if (invalid) {
        await save({ ...record, status: 'conflict', error: invalid });
        conflicts++;
        continue;
      }
      try {
        await submitAction(record.action);
        await discardQueuedDelivery(userId, record.id);
        accepted++;
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if (canRetryDelivery(error.status, error.message)) {
          if (error.status === 401 || error.status === 403)
            throw new Error(
              'Sign in again, then retry saved deliveries. Evidence remains on this device.',
            );
          throw error;
        }
        await save({ ...record, status: 'conflict', error: error.message });
        conflicts++;
      }
    }
    return { accepted, conflicts };
  } finally {
    synchronizing = false;
    window.dispatchEvent(new Event('batra-offline-change'));
  }
}
