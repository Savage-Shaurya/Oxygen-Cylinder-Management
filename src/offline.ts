import { ApiError, submitAction } from './api';
import { canRetryDelivery, validateQueuedDelivery, type QueuedDelivery } from './offline-rules';
export type { QueuedDelivery } from './offline-rules';

// The non-extractable key and encrypted records live in this browser profile.
// This protects stored payloads from casual inspection, not a compromised origin/device.
const DB_NAME = 'batra-field-evidence-v1';
interface StoredRecord {
  id: string;
  userId: string;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
}
let opening: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (!opening)
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('records', { keyPath: 'id' });
        req.result.createObjectStore('keys');
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
  await write('records', {
    id: record.id,
    userId: record.userId,
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
export async function queueDelivery(
  userId: string,
  payload: Record<string, unknown>,
  expectedRevision: number,
): Promise<QueuedDelivery> {
  if (
    !userId ||
    !payload.orderId ||
    !Array.isArray(payload.cylinderIds) ||
    !payload.cylinderIds.length ||
    !String(payload.recipient || '').trim()
  )
    throw new Error('Select the order, accepted cylinders and recipient before saving evidence.');
  const current = await listQueuedDeliveries(userId);
  if (current.length >= 50)
    throw new Error('Reconcile your saved deliveries before recording more.');
  if (current.some((record) => record.action.payload.orderId === payload.orderId))
    throw new Error(
      'This order already has saved delivery evidence. Review it before adding another.',
    );
  const id = crypto.randomUUID();
  const record: QueuedDelivery = {
    id,
    userId,
    createdAt: new Date().toISOString(),
    status: 'pending',
    action: {
      type: 'order.deliver',
      payload,
      expectedRevision,
      idempotencyKey: id,
    },
  };
  await save(record);
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
        if (!(error instanceof ApiError) || canRetryDelivery(error.status)) throw error;
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
