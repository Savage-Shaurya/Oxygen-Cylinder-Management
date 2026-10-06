import { ApiError } from '../api';
import type { TextKey } from '../i18n';

// Every failure becomes one of four plain screens. The raw message stays behind "Details".
export type Friendly = {
  kind: 'offline' | 'changed' | 'notAllowed' | 'other';
  key: TextKey;
  detail: string;
};

export function friendly(error: unknown): Friendly {
  const detail = error instanceof Error ? error.message : String(error ?? '');
  if (error instanceof ApiError) {
    if (error.status === 0) return { kind: 'offline', key: 'error.offline', detail };
    if (error.status === 409) return { kind: 'changed', key: 'error.changed', detail };
    if (error.status === 401 || error.status === 403)
      return { kind: 'notAllowed', key: 'error.notAllowed', detail };
  }
  return { kind: 'other', key: 'error.other', detail };
}
