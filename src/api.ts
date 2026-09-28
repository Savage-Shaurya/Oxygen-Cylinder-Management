import type { ActionRequest, ActionResult, Bootstrap } from '../shared/types';

let csrfToken = '';
let currentUserId = '';
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
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
    throw new ApiError(
      'Connection unavailable. Your changes have not been posted. Reconnect and try again.',
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
export async function act(
  type: string,
  payload: Record<string, unknown>,
  expectedRevision?: number,
): Promise<ActionResult> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical({ type, payload })),
  );
  const fingerprint = Array.from(new Uint8Array(digest), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
  const storageKey = `batra-pending:${currentUserId}:${fingerprint}`;
  let saved: { idempotencyKey: string; expectedRevision?: number } | undefined;
  try {
    saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null') || undefined;
  } catch {
    /* Private browsing can restrict storage. */
  }
  const identity = saved || {
    idempotencyKey: crypto.randomUUID(),
    expectedRevision,
  };
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(identity));
  } catch {
    /* Request remains idempotent within this attempt. */
  }
  try {
    const result = await submitAction({ type, payload, ...identity });
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* No business data is stored here. */
    }
    return result;
  } catch (error) {
    // An ambiguous network/server failure retains its key so retry cannot post twice.
    if (error instanceof ApiError && error.status > 0 && error.status < 500) {
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* Storage unavailable. */
      }
    }
    throw error;
  }
}
