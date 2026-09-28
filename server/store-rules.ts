// Storage-independent rules shared by the SQLite and Postgres stores, so both enforce
// identical checks and messages. Each store only supplies reads and writes.
import { createHash, randomUUID } from 'node:crypto';
import { hashPassword, type StoredUser } from './auth.js';
import { actionPermitted, applyAction } from './domain.js';
import type {
  ActionRequest,
  ActionResult,
  AppState,
  AuditEvent,
  Role,
  User,
} from '../shared/types.ts';

export class StoreError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export const DEMO_PASSWORD = 'OxygenDemo!2026';
export const demoRoles: Array<[Role, string, string]> = [
  ['admin', 'u-admin', 'Admin'],
  ['operations', 'u-ops', 'Operations'],
  ['quality', 'u-quality', 'Quality'],
  ['finance', 'u-finance', 'Finance'],
  ['driver', 'u-driver', 'Driver'],
  ['auditor', 'u-auditor', 'Auditor'],
];
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 30 * 60_000;
const PASSWORD_MESSAGE = 'Password must be 12–256 characters and contain a non-space character';

export function validEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return (
    normalized.length <= 254 &&
    /^\S+@\S+\.\S+$/.test(normalized) &&
    !normalized.endsWith('@batra.demo')
  );
}
export function validPassword(password: string): boolean {
  return (
    password.length >= 12 && password.length <= 256 && /[\p{L}\p{N}\p{S}\p{P}]/u.test(password)
  );
}
export function assertValidPassword(password: string) {
  if (!validPassword(password)) throw new StoreError(PASSWORD_MESSAGE);
}

/** Control characters (including NUL) are never valid in identifiers, names or emails. */
export const hasControlChars = (value: string) => /[\u0000-\u001f\u007f]/.test(value);

const stableHash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

/** Validates the request envelope and role; returns the idempotency hash. */
export function checkRequestEnvelope(user: User, request: ActionRequest): string {
  if (
    typeof request.idempotencyKey !== 'string' ||
    !request.idempotencyKey.trim() ||
    request.idempotencyKey.length > 128 ||
    hasControlChars(request.idempotencyKey)
  )
    throw new StoreError('Idempotency key required');
  const hash = stableHash({
    type: request.type,
    payload: request.payload,
    expectedRevision: request.expectedRevision,
  });
  // Role check first, so a blocked role never sees payload-specific validation errors.
  if (!actionPermitted(request.type, user.role)) throw new StoreError('Action not permitted', 403);
  return hash;
}

export function settingsGuard(old: AppState, user: User, request: ActionRequest) {
  if (
    request.type === 'settings.update' &&
    (user.role !== 'admin' || !old.branches.every((b) => user.branchIds.includes(b.id)))
  )
    throw new StoreError('Organization administrator required', 403);
}

export function replayPrior(
  prior: { request_hash: string; result_json: string },
  hash: string,
  authEpoch: number,
  old: AppState,
): ActionResult {
  if (prior.request_hash !== hash)
    throw new StoreError('Idempotency key reused with different request', 409);
  const metadata = JSON.parse(prior.result_json) as Pick<ActionResult, 'message' | 'entityId'> & {
    authEpoch?: number;
  };
  if ((metadata.authEpoch ?? 0) !== authEpoch)
    throw new StoreError('Authorization changed; submit a new request', 403);
  return { message: metadata.message, entityId: metadata.entityId, state: old };
}

/** The driver a dispatch or collection names; the store loads it before preDomainChecks. */
export function requestedDriverId(request: ActionRequest): string | undefined {
  if (request.type !== 'order.dispatch' && request.type !== 'cylinder.collect') return;
  return typeof request.payload?.driverId === 'string' ? request.payload.driverId : undefined;
}

export function preDomainChecks(
  old: AppState,
  request: ActionRequest,
  user: User,
  driver: StoredUser | undefined,
) {
  if (
    (request.type === 'party.update' || request.type === 'settings.update') &&
    request.expectedRevision === undefined &&
    !Number.isInteger(request.payload?.expectedVersion)
  )
    throw new StoreError('Entity version required for overwrite');
  if (request.expectedRevision !== undefined && request.expectedRevision !== old.revision)
    throw new StoreError('State changed; refresh and retry', 409);
  if (request.type !== 'order.dispatch' && request.type !== 'cylinder.collect') return;
  const order =
    request.type === 'order.dispatch'
      ? old.orders.find((o) => o.id === request.payload?.orderId)
      : undefined;
  const party =
    request.type === 'cylinder.collect'
      ? old.parties.find((p) => p.id === request.payload?.partyId)
      : undefined;
  const branchId = order?.branchId ?? party?.branchId;
  if (
    !branchId ||
    !driver ||
    !driver.active ||
    driver.role !== 'driver' ||
    driver.orgId !== user.orgId ||
    !driver.branchIds.includes(branchId)
  )
    throw new StoreError('Active branch driver required');
  if (request.type === 'cylinder.collect' && user.role === 'driver') {
    if (driver.id !== user.id) throw new StoreError('Driver can only collect for self', 403);
    const day = (at: string) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(at));
    const today = day(new Date().toISOString());
    const assigned = old.orders.some(
      (o) =>
        o.partyId === party?.id &&
        o.driverId === user.id &&
        (o.status === 'dispatched' ||
          o.status === 'partial' ||
          (o.status === 'delivered' && o.deliveredAt && day(o.deliveredAt) === today)),
    );
    if (!assigned) throw new StoreError('No current assigned work for customer', 403);
  }
}

/** Runs the domain action; returns the result plus audit events to append (oldest first). */
export function runDomain(old: AppState, request: ActionRequest, user: User) {
  const result = applyAction(old, request, {
    user,
    now: new Date().toISOString(),
    id: randomUUID,
  });
  if (result.state.revision !== old.revision + 1) throw new Error('Invalid domain revision');
  const priorIds = new Set(old.audit.map((a) => a.id));
  const newAudit = [...result.state.audit].reverse().filter((event) => !priorIds.has(event.id));
  return { result, newAudit };
}

export function idempotencyResult(result: ActionResult, authEpoch: number): string {
  return JSON.stringify({ message: result.message, entityId: result.entityId, authEpoch });
}

export function managementEvent(
  actor: User,
  action: string,
  entityId: string,
  summary: string,
): AuditEvent {
  return {
    id: randomUUID(),
    at: new Date().toISOString(),
    actorId: actor.id,
    actorName: actor.name,
    action,
    entityId,
    summary,
  };
}

/** Management actions bump the revision so open forms and audit views stay consistent. */
export function withManagementAudit(state: AppState, event: AuditEvent): AppState {
  return { ...state, revision: state.revision + 1, audit: [event, ...state.audit] };
}

export interface NewUserInput {
  name: string;
  email: string;
  password: string;
  role: Role;
  branchIds: string[];
}
export function buildNewUser(actor: User, input: NewUserInput, state: AppState): StoredUser {
  if (input.branchIds?.some((id) => !actor.branchIds.includes(id)))
    throw new StoreError('Forbidden branch assignment', 403);
  if (!input.name?.trim() || input.name.length > 120 || hasControlChars(input.name))
    throw new StoreError('Enter a name of up to 120 characters');
  if (!validEmail(input.email) || hasControlChars(input.email))
    throw new StoreError('Enter a valid email address');
  assertValidPassword(input.password);
  if (
    !input.branchIds?.length ||
    input.branchIds.some((id) => !state.branches.some((b) => b.id === id))
  )
    throw new StoreError('Choose at least one branch');
  return {
    id: randomUUID(),
    orgId: actor.orgId,
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    role: input.role,
    branchIds: [...new Set(input.branchIds)],
    active: true,
    passwordHash: hashPassword(input.password),
  };
}

export interface UserUpdateInput {
  active?: boolean;
  role?: Role;
  branchIds?: string[];
}
export function planUserUpdate(
  actor: User,
  id: string,
  target: StoredUser | undefined,
  input: UserUpdateInput,
  state: AppState,
  users: StoredUser[],
) {
  if (!target || target.orgId !== actor.orgId) throw new StoreError('User not found', 404);
  if (
    target.branchIds.some((b) => !actor.branchIds.includes(b)) ||
    input.branchIds?.some((b) => !actor.branchIds.includes(b))
  )
    throw new StoreError('Forbidden branch assignment', 403);
  if (
    input.branchIds &&
    (!input.branchIds.length ||
      input.branchIds.some((b) => !state.branches.some((x) => x.id === b)))
  )
    throw new StoreError('Invalid branches');
  const active = input.active ?? target.active;
  const role = input.role ?? target.role;
  const nextBranches = [...new Set(input.branchIds ?? target.branchIds)];
  if (id === actor.id && (!active || role !== 'admin'))
    throw new StoreError('Cannot disable your own admin account');
  if (
    target.role === 'admin' &&
    target.active &&
    (!active || role !== 'admin') &&
    users.filter((u) => u.active && u.role === 'admin').length <= 1
  )
    throw new StoreError('Cannot remove final admin');
  const allBranches = state.branches.map((branch) => branch.id);
  const isOrgAdmin = (candidate: StoredUser) =>
    candidate.active &&
    candidate.role === 'admin' &&
    allBranches.every((branch) => candidate.branchIds.includes(branch));
  if (
    isOrgAdmin(target) &&
    (!active ||
      role !== 'admin' ||
      !allBranches.every((branch) => nextBranches.includes(branch))) &&
    users.filter(isOrgAdmin).length <= 1
  )
    throw new StoreError('Cannot remove final organization administrator');
  const authorizationReduced =
    (target.active && !active) ||
    role !== target.role ||
    target.branchIds.some((branch) => !nextBranches.includes(branch));
  const changed =
    active !== target.active ||
    role !== target.role ||
    JSON.stringify(nextBranches) !== JSON.stringify(target.branchIds);
  return { active, role, nextBranches, authorizationReduced, changed };
}

export function checkResetPassword(actor: StoredUser, id: string, newPassword: string) {
  if (actor.role !== 'admin') throw new StoreError('Forbidden', 403);
  if (actor.id === id)
    throw new StoreError('Use current password to change your own password', 400);
  assertValidPassword(newPassword);
}
export function checkResetTarget(actor: StoredUser, target: StoredUser | undefined): StoredUser {
  if (
    !target ||
    target.orgId !== actor.orgId ||
    !target.branchIds.every((branch) => actor.branchIds.includes(branch))
  )
    throw new StoreError('User not found', 404);
  return target;
}
export function passwordEvent(actor: StoredUser, target: StoredUser): AuditEvent {
  const own = actor.id === target.id;
  return managementEvent(
    actor,
    own ? 'user.password_change' : 'user.password_reset',
    target.id,
    own ? 'User changed own password' : `Password reset for ${target.email}`,
  );
}

/** Guards shared by both stores when opening a database in demo or live mode. */
export function checkModeCompatibility(
  demoMode: boolean,
  userCount: number,
  demoAccountCount: number,
  stateModes: Array<string | undefined>,
  provisioning = false,
) {
  if (demoMode && userCount > 0 && stateModes.includes('live'))
    throw new Error('Live state cannot run in demo mode');
  if (!demoMode) {
    if (userCount === 0 && !provisioning)
      throw new Error(
        'No production users provisioned; restore or initialize a production database',
      );
    if (demoAccountCount) throw new Error('Demo accounts cannot run outside demo mode');
    if (stateModes.includes('demo')) throw new Error('Demo state cannot run outside demo mode');
  }
}
