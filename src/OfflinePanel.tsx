import { useEffect, useState } from 'react';
import type { User } from '../shared/types';
import {
  listQueuedDeliveries,
  syncQueuedDeliveries,
  discardQueuedDelivery,
  type QueuedDelivery,
} from './offline';

export default function OfflinePanel({
  user,
  onSynced,
}: {
  user: User;
  onSynced: () => Promise<void> | void;
}) {
  const [records, setRecords] = useState<QueuedDelivery[]>([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const refresh = () =>
    listQueuedDeliveries(user.id)
      .then(setRecords)
      .catch((error) => setMessage(error.message));
  useEffect(() => {
    void refresh();
    const change = () => {
      setOnline(navigator.onLine);
      void refresh();
    };
    window.addEventListener('online', change);
    window.addEventListener('offline', change);
    window.addEventListener('batra-offline-change', change);
    return () => {
      window.removeEventListener('online', change);
      window.removeEventListener('offline', change);
      window.removeEventListener('batra-offline-change', change);
    };
  }, [user.id]);
  async function sync() {
    setBusy(true);
    setMessage('');
    try {
      const result = await syncQueuedDeliveries(user.id);
      setMessage(`${result.accepted} delivery accepted. ${result.conflicts} need office review.`);
      await onSynced();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to synchronize. Evidence is still saved on this device.',
      );
    } finally {
      setBusy(false);
      void refresh();
    }
  }
  if (online && !records.length && !message) return null;
  return (
    <section
      className="offline-panel"
      aria-label="Field evidence sync"
      style={{
        margin: '0 0 20px',
        border: '1px solid #e4c77e',
        borderRadius: 12,
        background: '#fffaf0',
        padding: '14px 18px',
        fontSize: 14,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <strong>
            {online
              ? `${records.length} saved ${records.length === 1 ? 'delivery' : 'deliveries'}`
              : 'You are offline'}
          </strong>
          <p style={{ margin: '4px 0', color: '#675532' }}>
            Saved evidence is pending. Shared cylinder custody changes only after the server accepts
            it.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {!!records.length && (
            <button className="button btn" onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Hide details' : 'Review evidence'}
            </button>
          )}
          {!!records.length && (
            <button className="button btn" disabled={busy || !online} onClick={() => void sync()}>
              {busy ? 'Synchronizing…' : 'Sync deliveries'}
            </button>
          )}
        </div>
      </div>
      {message && (
        <p role="status" style={{ marginTop: 8 }}>
          {message}
        </p>
      )}
      {expanded &&
        records.map((record) => (
          <div key={record.id} style={{ padding: '12px 0', borderTop: '1px solid #e7dab6' }}>
            <strong>
              {String(record.action.payload.orderId)} ·{' '}
              {record.status === 'conflict' ? 'Needs office review' : 'Pending'}
            </strong>
            <p>
              {new Date(record.createdAt).toLocaleString('en-IN')} ·{' '}
              {(record.action.payload.cylinderIds as string[]).join(', ')}
            </p>
            <p>Recipient: {String(record.action.payload.recipient || '')}</p>
            {record.error && <p role="alert">{record.error}</p>}
            <button
              className="button btn"
              onClick={async () => {
                if (
                  !window.confirm(
                    'Discard this device’s saved evidence? Only do this after the office has reconciled the physical delivery. This does not reverse any server transaction.',
                  )
                )
                  return;
                try {
                  await discardQueuedDelivery(user.id, record.id);
                  await refresh();
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : 'Could not remove evidence.');
                }
              }}
            >
              Discard reconciled evidence
            </button>
          </div>
        ))}
    </section>
  );
}
