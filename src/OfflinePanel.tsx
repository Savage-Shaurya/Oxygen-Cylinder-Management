import { useEffect, useRef, useState } from 'react';
import type { AppState, User } from '../shared/types';
import {
  listQueuedDeliveries,
  syncQueuedDeliveries,
  discardQueuedDelivery,
  offlineEvidenceDocument,
  type QueuedDelivery,
} from './offline';

export default function OfflinePanel({
  user,
  onSynced,
  state,
}: {
  user: User;
  onSynced: () => Promise<void> | void;
  state?: Pick<AppState, 'orders' | 'parties' | 'cylinders'>;
}) {
  const [records, setRecords] = useState<QueuedDelivery[]>([]);
  const [recordsOwnerId, setRecordsOwnerId] = useState('');
  const activeUserId = useRef(user.id);
  activeUserId.current = user.id;
  const visibleRecords = recordsOwnerId === user.id ? records : [];
  const pendingCount = visibleRecords.filter((record) => record.status === 'pending').length;
  const conflictCount = visibleRecords.length - pendingCount;
  const [online, setOnline] = useState(navigator.onLine);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  function downloadEvidence(record: QueuedDelivery) {
    const url = URL.createObjectURL(
      new Blob([offlineEvidenceDocument(record)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `delivery-evidence-${record.id}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const refresh = () => {
    const requestedUserId = user.id;
    return listQueuedDeliveries(requestedUserId)
      .then((result) => {
        if (activeUserId.current !== requestedUserId) return;
        setRecords(result);
        setRecordsOwnerId(requestedUserId);
      })
      .catch((error) => {
        if (activeUserId.current === requestedUserId) setMessage(error.message);
      });
  };
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
  if (online && !visibleRecords.length && !message) return null;
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
              ? `${visibleRecords.length} saved ${visibleRecords.length === 1 ? 'delivery' : 'deliveries'}`
              : 'You are offline'}
          </strong>
          <p style={{ margin: '4px 0', color: '#675532' }}>
            {visibleRecords.length
              ? `${pendingCount} pending sync; ${conflictCount} need office review. Shared cylinder custody changes only after the server accepts a delivery.`
              : 'No delivery evidence is saved on this device.'}
          </p>
          {!!visibleRecords.length && (
            <p style={{ margin: '4px 0', color: '#675532' }}>
              Keep this browser profile and its saved data until every delivery is accepted or
              reconciled. Its encryption key is stored on this device alongside the evidence, so a
              lost or shared device is not protected against someone with access to this browser.
              Sign out requires a connection; sign in with the same account to sync.
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {!!visibleRecords.length && (
            <button className="button btn" onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Hide details' : 'Review evidence'}
            </button>
          )}
          {!!visibleRecords.length && (
            <button
              className="button btn"
              disabled={busy || !online || !pendingCount}
              onClick={() => void sync()}
            >
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
        visibleRecords.map((record) => {
          const order = state?.orders.find((item) => item.id === record.action.payload.orderId);
          const party = state?.parties.find((item) => item.id === order?.partyId);
          const identifiers = (record.action.payload.cylinderIds as string[]).map(
            (id) => state?.cylinders.find((item) => item.id === id)?.tag,
          );
          return (
            <div key={record.id} style={{ padding: '12px 0', borderTop: '1px solid #e7dab6' }}>
              <strong>
                {order ? `${order.number} · ${party?.name || 'Customer'}` : 'Saved delivery'} ·{' '}
                {record.status === 'conflict' ? 'Needs office review' : 'Pending'}
              </strong>
              <p>
                Recorded handover:{' '}
                {new Date(
                  String(record.action.payload.occurredAt || record.createdAt),
                ).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}{' '}
                IST
              </p>
              <p title={record.id}>Evidence ID: {record.id.slice(0, 8)}</p>
              <p>
                Cylinders:{' '}
                {identifiers
                  .map(
                    (tag) => tag || 'Identifier unavailable; download evidence for office review',
                  )
                  .join(', ')}
              </p>
              <p>Recipient: {String(record.action.payload.recipient || '')}</p>
              {record.error && <p role="alert">{record.error}</p>}
              {record.status === 'conflict' && (
                <p>
                  Ask the office to compare this saved claim with server custody, then record the
                  resolution. This entry will not retry automatically.
                </p>
              )}
              <button className="button btn" onClick={() => downloadEvidence(record)}>
                Download evidence for office review
              </button>
              <p className="muted">
                The download contains recipient and delivery details without device encryption.
                Handle it as a private record.
              </p>
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
                    setMessage(
                      error instanceof Error ? error.message : 'Could not remove evidence.',
                    );
                  }
                }}
              >
                Discard reconciled evidence
              </button>
            </div>
          );
        })}
    </section>
  );
}
