import type { ActionRequest, ActionResult, AppState, Bootstrap } from '../shared/types';

let csrfToken = '';
let currentUserId = '';
export class ApiError extends Error {
  /** For an unconfirmed action: the exact command that was sent, to reconcile it later. */
  envelope?: ActionRequest;
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * True when the request may have reached the server: the connection dropped, or a gateway
 * gave up waiting. The change may or may not have been saved, so it is neither "saved" nor
 * "not saved" until the same command is checked again.
 */
export function isUncertain(error: unknown): boolean {
  return error instanceof ApiError && [0, 502, 503, 504].includes(error.status);
}

/** The exact command an unconfirmed action sent (same key, same payload), if any. */
export function actionEnvelope(error: unknown): ActionRequest | undefined {
  return error instanceof ApiError && error.envelope ? structuredClone(error.envelope) : undefined;
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  if (options.method && !['GET', 'HEAD'].includes(options.method.toUpperCase()) && csrfToken)
    headers.set('X-CSRF-Token', csrfToken);
  let response: Response;
  try {
    response = await fetch(
      path.startsWith('/api/') ? path : `/api${path.startsWith('/') ? '' : '/'}${path}`,
      {
        ...options,
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
      },
    );
  } catch {
    // A dropped connection can follow a saved change, so never say it was not saved.
    throw new ApiError(
      'Connection unavailable. Could not confirm whether this change was saved. Check before repeating it.',
      0,
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      data?.error || `Request failed (${response.status}). Please try again.`,
      response.status,
    );
  return data as T;
}

export async function login(email: string, password: string): Promise<Bootstrap> {
  const result = await request<Bootstrap>('/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  csrfToken = result.csrfToken;
  currentUserId = result.user.id;
  return result;
}
export async function bootstrap(): Promise<Bootstrap> {
  const result = await request<Bootstrap>('/bootstrap');
  csrfToken = result.csrfToken;
  currentUserId = result.user.id;
  return result;
}
export async function logout(): Promise<void> {
  await request('/logout', { method: 'POST' });
  csrfToken = '';
  currentUserId = '';
}
/** Sarvam speech for a sentence with names or numbers; the voice key stays on the server. */
export async function voiceAudio(text: string, language: string): Promise<ArrayBuffer> {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
  let response: Response;
  try {
    response = await fetch('/api/voice', {
      method: 'POST',
      headers,
      body: JSON.stringify({ text, language }),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('Connection unavailable.', 0);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(data?.error || `Request failed (${response.status})`, response.status);
  }
  return response.arrayBuffer();
}
export function submitAction(action: ActionRequest): Promise<ActionResult> {
  return request<ActionResult>('/actions', {
    method: 'POST',
    body: JSON.stringify(action),
  });
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(',')}}`;
}
type Identity = { idempotencyKey: string; expectedRevision?: number };
// Unconfirmed commands of this tab, also kept in memory in case session storage is blocked.
// Only the key and revision go to session storage; the payload stays in memory.
const unconfirmed = new Map<string, ActionRequest>();
const PENDING_PREFIX = 'batra-pending:';

async function pendingStorageKey(userId: string, type: string, payload: unknown) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical({ type, payload })),
  );
  const fingerprint = Array.from(new Uint8Array(digest), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
  return `${PENDING_PREFIX}${userId}:${fingerprint}`;
}
function storedIdentity(storageKey: string): Identity | undefined {
  const remembered = unconfirmed.get(storageKey);
  if (remembered)
    return {
      idempotencyKey: remembered.idempotencyKey,
      expectedRevision: remembered.expectedRevision,
    };
  try {
    return JSON.parse(sessionStorage.getItem(storageKey) || 'null') || undefined;
  } catch {
    /* Private browsing can restrict storage. */
    return undefined;
  }
}

/**
 * The unconfirmed command this user already sent with the same type and payload, so saving
 * it elsewhere (the device queue) keeps the same key instead of creating a second command.
 */
export async function pendingAction(
  userId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<ActionRequest | undefined> {
  if (!userId || userId !== currentUserId) return undefined;
  const storageKey = await pendingStorageKey(userId, type, payload);
  const remembered = unconfirmed.get(storageKey);
  if (remembered) return structuredClone(remembered);
  const identity = storedIdentity(storageKey);
  if (!identity) return undefined;
  return {
    type,
    payload: structuredClone(payload),
    idempotencyKey: identity.idempotencyKey,
    ...(identity.expectedRevision === undefined
      ? {}
      : { expectedRevision: identity.expectedRevision }),
  };
}

/** Forgets every unconfirmed command, e.g. after the demo data was reset to a new story. */
export function forgetPendingActions() {
  unconfirmed.clear();
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(PENDING_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    /* Storage unavailable. */
  }
}

export async function act(
  type: string,
  payload: Record<string, unknown>,
  expectedRevision?: number,
  state?: AppState,
): Promise<ActionResult> {
  const storageKey = await pendingStorageKey(currentUserId, type, payload);
  const identity: Identity = storedIdentity(storageKey) || {
    idempotencyKey: crypto.randomUUID(),
    expectedRevision,
  };
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(identity));
  } catch {
    /* Request remains idempotent within this attempt. */
  }
  // One immutable envelope: every retry, queue entry and sync sends exactly this.
  const action: ActionRequest = unconfirmed.get(storageKey) ?? {
    type,
    payload: structuredClone(payload),
    idempotencyKey: identity.idempotencyKey,
    ...(identity.expectedRevision === undefined
      ? {}
      : { expectedRevision: identity.expectedRevision }),
  };
  try {
    type Wire = ActionResult & {
      delta?: {
        baseRevision: number;
        revision: number;
        changed: Record<string, { id: string }[]>;
        removed: Record<string, string[]>;
        settings?: AppState['settings'];
      };
    };
    const wire: Wire = state
      ? await request<
          ActionResult & {
            delta?: {
              baseRevision: number;
              revision: number;
              changed: Record<string, { id: string }[]>;
              removed: Record<string, string[]>;
              settings?: AppState['settings'];
            };
          }
        >('/actions', {
          method: 'POST',
          headers: { Prefer: 'return=delta' },
          body: JSON.stringify(action),
        })
      : await submitAction(action);
    let result: ActionResult;
    if ('delta' in wire && wire.delta && state) {
      const delta = wire.delta;
      if (delta.baseRevision !== state.revision) {
        result = { ...wire, state: (await bootstrap()).state };
      } else {
        const next = structuredClone(state);
        for (const key of Object.keys(delta.changed)) {
          if (
            ![
              'branches',
              'cylinders',
              'parties',
              'orders',
              'batches',
              'movements',
              'rentals',
              'invoices',
              'receipts',
              'audit',
              'exceptions',
              'pickups',
            ].includes(key)
          )
            continue;
          const record = next as unknown as Record<string, { id: string }[]>;
          const changes = new Map(delta.changed[key].map((item) => [item.id, item]));
          const removed = new Set(delta.removed[key] || []);
          const retained = (record[key] || [])
            .filter((item) => !removed.has(item.id))
            .map((item) => {
              const replacement = changes.get(item.id);
              changes.delete(item.id);
              return replacement || item;
            });
          record[key] = ['audit', 'movements'].includes(key)
            ? [...changes.values(), ...retained]
            : [...retained, ...changes.values()];
        }
        // A collection may contain removals without changed rows.
        for (const key of Object.keys(delta.removed)) {
          if (Object.hasOwn(delta.changed, key) || !Object.hasOwn(next, key)) continue;
          const record = next as unknown as Record<string, { id: string }[]>;
          if (Array.isArray(record[key]))
            record[key] = record[key].filter((item) => !delta.removed[key].includes(item.id));
        }
        if (delta.settings) next.settings = delta.settings;
        next.revision = delta.revision;
        result = { ...wire, state: next };
      }
    } else result = wire;

    unconfirmed.delete(storageKey);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* No business data is stored here. */
    }
    return result;
  } catch (error) {
    // An ambiguous network/server failure retains its key so retry cannot post twice.
    if (error instanceof ApiError && error.status > 0 && error.status < 500) {
      unconfirmed.delete(storageKey);
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* Storage unavailable. */
      }
    } else if (error instanceof ApiError) {
      unconfirmed.set(storageKey, action);
      error.envelope = structuredClone(action);
    }
    throw error;
  }
}
