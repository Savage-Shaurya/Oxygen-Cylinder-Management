import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from '../../shared/types';
import { listQueuedDeliveries, syncQueuedDeliveries } from '../offline';

/** Deliveries saved on this phone while offline, and a one-tap send. */
export function useQueue(user: User, onSynced: () => Promise<void> | void) {
  const [pending, setPending] = useState(0);
  const [conflicts, setConflicts] = useState(0);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);

  // A late answer for the previous account must not show its counts to the next one.
  const activeUser = useRef(user.id);
  activeUser.current = user.id;

  const refresh = useCallback(() => {
    const requested = user.id;
    listQueuedDeliveries(requested)
      .then((records) => {
        if (activeUser.current !== requested) return;
        setPending(records.filter((r) => r.status === 'pending').length);
        setConflicts(records.filter((r) => r.status === 'conflict').length);
      })
      .catch(() => {
        /* Storage unavailable: nothing can be queued either. */
      });
  }, [user.id]);

  useEffect(() => {
    refresh();
    const change = () => {
      setOnline(navigator.onLine);
      refresh();
    };
    window.addEventListener('online', change);
    window.addEventListener('offline', change);
    window.addEventListener('batra-offline-change', change);
    return () => {
      window.removeEventListener('online', change);
      window.removeEventListener('offline', change);
      window.removeEventListener('batra-offline-change', change);
    };
  }, [refresh]);

  async function sync() {
    setBusy(true);
    try {
      const result = await syncQueuedDeliveries(user.id);
      await onSynced();
      return result;
    } finally {
      setBusy(false);
      refresh();
    }
  }

  return { pending, conflicts, busy, online, sync };
}
