// The async storage contract the HTTP layer uses, so the same app runs on the local
// SQLite file or on hosted Postgres (Supabase).
import type { StoredUser } from './auth.js';
import type { Store } from './store.js';
import type { NewUserInput, UserUpdateInput } from './store-rules.js';
import type { ActionRequest, ActionResult, AppState, AuditEvent, User } from '../shared/types.ts';

export interface LoginAttempt {
  count: number;
  until: number;
}
export interface DataStore {
  readonly demoMode: boolean;
  getUserByEmail(email: string): Promise<StoredUser | undefined>;
  getUsers(orgId: string): Promise<StoredUser[]>;
  /** Issues a session only if `user`'s verified credential is still current (else 401). */
  createSession(user: StoredUser, token: string, csrf: string): Promise<void>;
  session(token: string): Promise<{ user: StoredUser; csrfToken: string } | undefined>;
  revokeSession(token: string): Promise<void>;
  getState(orgId: string): Promise<AppState>;
  getAudit(orgId: string): Promise<AuditEvent[]>;
  /** Re-checks the actor (active, organization, auth epoch) inside the write transaction. */
  apply(user: User, request: ActionRequest): Promise<ActionResult>;
  createUser(actor: User, input: NewUserInput): Promise<StoredUser>;
  updateUser(actor: User, id: string, input: UserUpdateInput): Promise<StoredUser>;
  changePassword(actor: StoredUser, currentPassword: string, newPassword: string): Promise<void>;
  resetPassword(actor: StoredUser, id: string, newPassword: string): Promise<void>;
  /** Demo only: atomically replaces the organization's business state with a fresh seed,
   * clears its idempotency records and appends a permanent 'demo.reset' audit event.
   * Users and sessions are kept. 404 outside demo mode; 403 unless organization admin. */
  resetDemo(orgId: string, actor: StoredUser): Promise<{ revision: number }>;
  /** Readiness: one database round-trip. */
  ping(): Promise<void>;
  /** Login throttling; shared storage keeps limits consistent across server instances. */
  getLoginAttempt(key: string): Promise<LoginAttempt | undefined>;
  recordLoginFailure(key: string, now: number, windowMs: number): Promise<void>;
  clearLoginAttempt(key: string): Promise<void>;
}

/** Wraps the synchronous SQLite store; login throttling stays in process memory. */
export function sqliteDataStore(store: Store): DataStore {
  const attempts = new Map<string, LoginAttempt>();
  return {
    get demoMode() {
      return store.demoMode;
    },
    getUserByEmail: async (email) => store.getUserByEmail(email),
    getUsers: async (orgId) => store.getUsers(orgId),
    createSession: async (user, token, csrf) => store.createSession(user, token, csrf),
    session: async (token) => store.session(token),
    revokeSession: async (token) => store.revokeSession(token),
    getState: async (orgId) => store.getState(orgId),
    getAudit: async (orgId) => store.getAudit(orgId),
    apply: async (user, request) => store.apply(user, request),
    resetDemo: async (orgId, actor) => store.resetDemo(orgId, actor),
    ping: async () => store.ping(),
    createUser: async (actor, input) => store.createUser(actor, input),
    updateUser: async (actor, id, input) => store.updateUser(actor, id, input),
    changePassword: async (actor, current, next) => store.changePassword(actor, current, next),
    resetPassword: async (actor, id, next) => store.resetPassword(actor, id, next),
    getLoginAttempt: async (key) => attempts.get(key),
    recordLoginFailure: async (key, now, windowMs) => {
      const existing = attempts.get(key);
      attempts.delete(key);
      attempts.set(key, {
        count: existing && existing.until > now ? existing.count + 1 : 1,
        until: now + windowMs,
      });
      if (attempts.size > 10_000) attempts.delete(attempts.keys().next().value!);
    },
    clearLoginAttempt: async (key) => {
      attempts.delete(key);
    },
  };
}
