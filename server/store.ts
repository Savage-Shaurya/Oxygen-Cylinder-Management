import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, rmSync, openSync, closeSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { hashPassword, tokenHash, verifyPassword, type StoredUser } from './auth.js';
import { createSeedState } from './seed.js';
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
export interface StoreOptions {
  dbPath?: string;
  demoMode?: boolean;
  production?: boolean;
  provisioning?: boolean;
}
const demoRoles: Array<[Role, string, string]> = [
  ['admin', 'u-admin', 'Admin'],
  ['operations', 'u-ops', 'Operations'],
  ['quality', 'u-quality', 'Quality'],
  ['finance', 'u-finance', 'Finance'],
  ['driver', 'u-driver', 'Driver'],
  ['auditor', 'u-auditor', 'Auditor'],
];
const stableHash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function secureDatabaseFile(path: string) {
  if (path !== ':memory:' && !existsSync(path)) closeSync(openSync(path, 'wx', 0o600));
}
function privateSqliteWrite(write: () => void, path: string) {
  const oldMask = process.umask(0o077);
  try {
    write();
    chmodSync(path, 0o600);
  } finally {
    process.umask(oldMask);
  }
}
function validEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return (
    normalized.length <= 254 &&
    /^\S+@\S+\.\S+$/.test(normalized) &&
    !normalized.endsWith('@batra.demo')
  );
}
function validPassword(password: string): boolean {
  return (
    password.length >= 12 && password.length <= 256 && /[\p{L}\p{N}\p{S}\p{P}]/u.test(password)
  );
}
export class Store {
  readonly db: DatabaseSync;
  readonly demoMode: boolean;
  constructor(options: StoreOptions = {}) {
    const production = options.production ?? process.env.NODE_ENV === 'production';
    if (production && (options.demoMode || process.env.DEMO_MODE === 'true'))
      throw new Error('Demo mode is forbidden in production');
    this.demoMode = options.demoMode ?? (!production && process.env.DEMO_MODE !== 'false');
    const dbPath = options.dbPath ?? process.env.CTMS_DB_PATH ?? 'data/ctms.sqlite';
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    secureDatabaseFile(dbPath);
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS org_state(org_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, role TEXT NOT NULL, branch_ids TEXT NOT NULL, active INTEGER NOT NULL, password_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS idempotency(org_id TEXT NOT NULL, user_id TEXT NOT NULL, idem_key TEXT NOT NULL, request_hash TEXT NOT NULL, result_json TEXT NOT NULL, PRIMARY KEY(org_id,user_id,idem_key));
      CREATE TABLE IF NOT EXISTS user_auth_epoch(user_id TEXT PRIMARY KEY REFERENCES users(id), epoch INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit_log(sequence INTEGER PRIMARY KEY AUTOINCREMENT, org_id TEXT NOT NULL, id TEXT NOT NULL, at TEXT NOT NULL, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, action TEXT NOT NULL, entity_id TEXT NOT NULL, summary TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit append only'); END;
      CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit append only'); END;`);
    const sessionColumns = this.db.prepare('PRAGMA table_info(sessions)').all() as Array<{
      name: string;
    }>;
    if (!sessionColumns.some((column) => column.name === 'last_seen_at')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0');
      this.db.prepare('UPDATE sessions SET last_seen_at=?').run(Date.now());
    }
    const existing = this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    if (existing.n === 0 && this.demoMode) {
      const stateCount = this.db.prepare('SELECT COUNT(*) AS n FROM org_state').get() as {
        n: number;
      };
      if (stateCount.n) {
        this.db.close();
        throw new Error('Existing state cannot be seeded with demo accounts');
      }
      this.seedDemo();
    }
    if (this.demoMode && existing.n > 0) {
      const states = this.db.prepare('SELECT state_json FROM org_state').all() as {
        state_json: string;
      }[];
      if (states.some((row) => JSON.parse(row.state_json).settings?.mode === 'live')) {
        this.db.close();
        throw new Error('Live state cannot run in demo mode');
      }
    }
    if (!this.demoMode) {
      if (existing.n === 0 && !options.provisioning)
        throw new Error(
          'No production users provisioned; restore or initialize a production database',
        );
      const demo = this.db
        .prepare("SELECT COUNT(*) AS n FROM users WHERE email LIKE '%@batra.demo'")
        .get() as { n: number };
      if (demo.n) throw new Error('Demo accounts cannot run outside demo mode');
      const states = this.db.prepare('SELECT state_json FROM org_state').all() as {
        state_json: string;
      }[];
      if (states.some((row) => JSON.parse(row.state_json).settings?.mode === 'demo'))
        throw new Error('Demo state cannot run outside demo mode');
    }
  }
  close() {
    this.db.close();
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  private seedDemo() {
    this.transaction(() => {
      const state = createSeedState();
      this.db
        .prepare('INSERT INTO org_state VALUES (?,?,?)')
        .run('batra', state.revision, JSON.stringify(state));
      const insert = this.db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)');
      for (const [role, id, name] of demoRoles)
        insert.run(
          id,
          'batra',
          name,
          `${role}@batra.demo`,
          role,
          JSON.stringify(['b-delhi', 'b-faridabad']),
          1,
          hashPassword('OxygenDemo!2026'),
        );
      for (const event of [...state.audit].reverse()) this.appendAudit('batra', event);
    });
  }
  getUserByEmail(email: string): StoredUser | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE email=?').get(email.toLowerCase()) as
      Record<string, unknown> | undefined;
    return row && this.rowUser(row);
  }
  getUser(id: string): StoredUser | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE id=?').get(id) as
      Record<string, unknown> | undefined;
    return row && this.rowUser(row);
  }
  private rowUser(row: Record<string, unknown>): StoredUser {
    return {
      id: String(row.id),
      orgId: String(row.org_id),
      name: String(row.name),
      email: String(row.email),
      role: row.role as Role,
      branchIds: JSON.parse(String(row.branch_ids)),
      active: Boolean(row.active),
      passwordHash: String(row.password_hash),
    };
  }
  getUsers(orgId: string): StoredUser[] {
    return (
      this.db.prepare('SELECT * FROM users WHERE org_id=? ORDER BY name').all(orgId) as Record<
        string,
        unknown
      >[]
    ).map((r) => this.rowUser(r));
  }
  createSession(user: User, token: string, csrf: string) {
    const now = Date.now();
    this.db
      .prepare('DELETE FROM sessions WHERE expires_at<=? OR last_seen_at<=?')
      .run(now, now - 30 * 60_000);
    this.db
      .prepare(
        'INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,last_seen_at) VALUES (?,?,?,?,?)',
      )
      .run(tokenHash(token), user.id, csrf, now + 12 * 60 * 60 * 1000, now);
  }
  session(token: string): { user: StoredUser; csrfToken: string } | undefined {
    const now = Date.now();
    const hashed = tokenHash(token);
    const row = this.db
      .prepare(
        'SELECT user_id,csrf_token FROM sessions WHERE token_hash=? AND expires_at>? AND last_seen_at>?',
      )
      .get(hashed, now, now - 30 * 60_000) as { user_id: string; csrf_token: string } | undefined;
    if (!row) return;
    const user = this.getUser(row.user_id);
    if (user?.active)
      this.db.prepare('UPDATE sessions SET last_seen_at=? WHERE token_hash=?').run(now, hashed);
    return user?.active ? { user, csrfToken: row.csrf_token } : undefined;
  }
  revokeSession(token: string) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
  }
  revokeUserSessions(id: string) {
    this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  }
  private authEpoch(id: string): number {
    const row = this.db.prepare('SELECT epoch FROM user_auth_epoch WHERE user_id=?').get(id) as
      { epoch: number } | undefined;
    return row?.epoch ?? 0;
  }
  getState(orgId: string): AppState {
    const row = this.db.prepare('SELECT state_json FROM org_state WHERE org_id=?').get(orgId) as
      { state_json: string } | undefined;
    if (!row) throw new StoreError('Organization not initialized', 503);
    return JSON.parse(row.state_json);
  }
  private appendAudit(orgId: string, event: AuditEvent) {
    this.db
      .prepare(
        'INSERT INTO audit_log(org_id,id,at,actor_id,actor_name,action,entity_id,summary) VALUES (?,?,?,?,?,?,?,?)',
      )
      .run(
        orgId,
        event.id,
        event.at,
        event.actorId,
        event.actorName,
        event.action,
        event.entityId,
        event.summary,
      );
  }
  private recordManagementAudit(orgId: string, event: AuditEvent) {
    const state = this.getState(orgId);
    state.revision++;
    state.audit = [event, ...state.audit];
    this.db
      .prepare('UPDATE org_state SET revision=?,state_json=? WHERE org_id=?')
      .run(state.revision, JSON.stringify(state), orgId);
    this.appendAudit(orgId, event);
  }
  getAudit(orgId: string): AuditEvent[] {
    return (
      this.db
        .prepare(
          'SELECT id,at,actor_id,actor_name,action,entity_id,summary FROM audit_log WHERE org_id=? ORDER BY sequence DESC',
        )
        .all(orgId) as Record<string, unknown>[]
    ).map((r) => ({
      id: String(r.id),
      at: String(r.at),
      actorId: String(r.actor_id),
      actorName: String(r.actor_name),
      action: String(r.action),
      entityId: String(r.entity_id),
      summary: String(r.summary),
    }));
  }
  apply(user: User, request: ActionRequest): ActionResult {
    if (
      typeof request.idempotencyKey !== 'string' ||
      !request.idempotencyKey.trim() ||
      request.idempotencyKey.length > 128
    )
      throw new StoreError('Idempotency key required');
    const hash = stableHash({
      type: request.type,
      payload: request.payload,
      expectedRevision: request.expectedRevision,
    });
    // Role check first, so a blocked role never sees payload-specific validation errors.
    if (!actionPermitted(request.type, user.role))
      throw new StoreError('Action not permitted', 403);
    return this.transaction(() => {
      const old = this.getState(user.orgId);
      if (
        request.type === 'settings.update' &&
        (user.role !== 'admin' || !old.branches.every((b) => user.branchIds.includes(b.id)))
      )
        throw new StoreError('Organization administrator required', 403);
      const authEpoch = this.authEpoch(user.id);
      const prior = this.db
        .prepare(
          'SELECT request_hash,result_json FROM idempotency WHERE org_id=? AND user_id=? AND idem_key=?',
        )
        .get(user.orgId, user.id, request.idempotencyKey) as
        { request_hash: string; result_json: string } | undefined;
      if (prior) {
        if (prior.request_hash !== hash)
          throw new StoreError('Idempotency key reused with different request', 409);
        const metadata = JSON.parse(prior.result_json) as Pick<
          ActionResult,
          'message' | 'entityId'
        > & { authEpoch?: number };
        if ((metadata.authEpoch ?? 0) !== authEpoch)
          throw new StoreError('Authorization changed; submit a new request', 403);
        return { message: metadata.message, entityId: metadata.entityId, state: old };
      }
      if (
        (request.type === 'party.update' || request.type === 'settings.update') &&
        request.expectedRevision === undefined &&
        !Number.isInteger(request.payload?.expectedVersion)
      )
        throw new StoreError('Entity version required for overwrite');
      if (request.expectedRevision !== undefined && request.expectedRevision !== old.revision)
        throw new StoreError('State changed; refresh and retry', 409);
      if (request.type === 'order.dispatch' || request.type === 'cylinder.collect') {
        const order =
          request.type === 'order.dispatch'
            ? old.orders.find((o) => o.id === request.payload?.orderId)
            : undefined;
        const party =
          request.type === 'cylinder.collect'
            ? old.parties.find((p) => p.id === request.payload?.partyId)
            : undefined;
        const branchId = order?.branchId ?? party?.branchId;
        const driver =
          typeof request.payload?.driverId === 'string'
            ? this.getUser(request.payload.driverId)
            : undefined;
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
      const result = applyAction(old, request, {
        user,
        now: new Date().toISOString(),
        id: randomUUID,
      });
      if (result.state.revision !== old.revision + 1) throw new Error('Invalid domain revision');
      const update = this.db
        .prepare('UPDATE org_state SET revision=?,state_json=? WHERE org_id=? AND revision=?')
        .run(result.state.revision, JSON.stringify(result.state), user.orgId, old.revision);
      if (update.changes !== 1) throw new StoreError('State changed; refresh and retry', 409);
      const priorIds = new Set(old.audit.map((a) => a.id));
      for (const event of [...result.state.audit].reverse())
        if (!priorIds.has(event.id)) this.appendAudit(user.orgId, event);
      this.db
        .prepare('INSERT INTO idempotency VALUES (?,?,?,?,?)')
        .run(
          user.orgId,
          user.id,
          request.idempotencyKey,
          hash,
          JSON.stringify({ message: result.message, entityId: result.entityId, authEpoch }),
        );
      return result;
    });
  }
  createUser(
    actor: User,
    input: { name: string; email: string; password: string; role: Role; branchIds: string[] },
  ): StoredUser {
    return this.transaction(() => {
      const state = this.getState(actor.orgId);
      if (input.branchIds?.some((id) => !actor.branchIds.includes(id)))
        throw new StoreError('Forbidden branch assignment', 403);
      if (!input.name?.trim() || input.name.length > 120)
        throw new StoreError('Enter a name of up to 120 characters');
      if (!validEmail(input.email)) throw new StoreError('Enter a valid email address');
      if (!validPassword(input.password))
        throw new StoreError(
          'Password must be 12–256 characters and contain a non-space character',
        );
      if (
        !input.branchIds?.length ||
        input.branchIds.some((id) => !state.branches.some((b) => b.id === id))
      )
        throw new StoreError('Choose at least one branch');
      const user: StoredUser = {
        id: randomUUID(),
        orgId: actor.orgId,
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        role: input.role,
        branchIds: [...new Set(input.branchIds)],
        active: true,
        passwordHash: hashPassword(input.password),
      };
      try {
        this.db
          .prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)')
          .run(
            user.id,
            user.orgId,
            user.name,
            user.email,
            user.role,
            JSON.stringify(user.branchIds),
            1,
            user.passwordHash,
          );
      } catch {
        throw new StoreError('Email already in use', 409);
      }
      this.recordManagementAudit(actor.orgId, {
        id: randomUUID(),
        at: new Date().toISOString(),
        actorId: actor.id,
        actorName: actor.name,
        action: 'user.create',
        entityId: user.id,
        summary: `Created user ${user.email}`,
      });
      return user;
    });
  }
  updateUser(
    actor: User,
    id: string,
    input: { active?: boolean; role?: Role; branchIds?: string[] },
  ): StoredUser {
    return this.transaction(() => {
      const target = this.getUser(id);
      if (!target || target.orgId !== actor.orgId) throw new StoreError('User not found', 404);
      if (
        target.branchIds.some((b) => !actor.branchIds.includes(b)) ||
        input.branchIds?.some((b) => !actor.branchIds.includes(b))
      )
        throw new StoreError('Forbidden branch assignment', 403);
      const state = this.getState(actor.orgId);
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
        this.getUsers(actor.orgId).filter((u) => u.active && u.role === 'admin').length <= 1
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
        this.getUsers(actor.orgId).filter(isOrgAdmin).length <= 1
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
      if (!changed) return target;
      this.db
        .prepare('UPDATE users SET active=?,role=?,branch_ids=? WHERE id=?')
        .run(Number(active), role, JSON.stringify(nextBranches), id);
      if (authorizationReduced) {
        this.db
          .prepare(
            'INSERT INTO user_auth_epoch(user_id,epoch) VALUES (?,1) ON CONFLICT(user_id) DO UPDATE SET epoch=epoch+1',
          )
          .run(id);
        this.revokeUserSessions(id);
      }
      this.recordManagementAudit(actor.orgId, {
        id: randomUUID(),
        at: new Date().toISOString(),
        actorId: actor.id,
        actorName: actor.name,
        action: 'user.update',
        entityId: id,
        summary: `Updated user ${target.email}`,
      });
      return this.getUser(id)!;
    });
  }
  changePassword(actor: StoredUser, currentPassword: string, newPassword: string): void {
    if (!validPassword(newPassword))
      throw new StoreError('Password must be 12–256 characters and contain a non-space character');
    this.transaction(() => {
      const current = this.getUser(actor.id);
      if (!current?.active || !verifyPassword(currentPassword, current.passwordHash))
        throw new StoreError('Current password is incorrect', 403);
      this.setPassword(current, newPassword, actor);
    });
  }
  resetPassword(actor: StoredUser, id: string, newPassword: string): void {
    if (actor.role !== 'admin') throw new StoreError('Forbidden', 403);
    if (actor.id === id)
      throw new StoreError('Use current password to change your own password', 400);
    if (!validPassword(newPassword))
      throw new StoreError('Password must be 12–256 characters and contain a non-space character');
    this.transaction(() => {
      const target = this.getUser(id);
      if (
        !target ||
        target.orgId !== actor.orgId ||
        !target.branchIds.every((branch) => actor.branchIds.includes(branch))
      )
        throw new StoreError('User not found', 404);
      this.setPassword(target, newPassword, actor);
    });
  }
  private setPassword(target: StoredUser, password: string, actor: StoredUser): void {
    this.db
      .prepare('UPDATE users SET password_hash=? WHERE id=?')
      .run(hashPassword(password), target.id);
    this.db
      .prepare(
        'INSERT INTO user_auth_epoch(user_id,epoch) VALUES (?,1) ON CONFLICT(user_id) DO UPDATE SET epoch=epoch+1',
      )
      .run(target.id);
    this.revokeUserSessions(target.id);
    this.recordManagementAudit(actor.orgId, {
      id: randomUUID(),
      at: new Date().toISOString(),
      actorId: actor.id,
      actorName: actor.name,
      action: actor.id === target.id ? 'user.password_change' : 'user.password_reset',
      entityId: target.id,
      summary:
        actor.id === target.id ? 'User changed own password' : `Password reset for ${target.email}`,
    });
  }
  backup(destination: string) {
    privateSqliteWrite(() => this.db.prepare('VACUUM INTO ?').run(destination), destination);
  }
}

export interface ProvisionConfig {
  companyName: string;
  address: string;
  gstin: string;
  defaultTaxBps: number;
  branches: Array<{ id: string; name: string; city: string }>;
  admin: { name: string; email: string };
}
export function provisionDatabase(dbPath: string, config: ProvisionConfig, password: string): void {
  if (
    !config ||
    !config.companyName?.trim() ||
    !config.address?.trim() ||
    !Number.isInteger(config.defaultTaxBps) ||
    config.defaultTaxBps < 0 ||
    config.defaultTaxBps > 10000 ||
    !Array.isArray(config.branches) ||
    config.branches.length < 1 ||
    config.branches.length > 100 ||
    !config.admin?.name?.trim() ||
    !validEmail(config.admin.email)
  )
    throw new StoreError('Invalid provisioning configuration');
  const branchIds = new Set<string>();
  for (const branch of config.branches) {
    if (
      !branch ||
      !/^[-a-z0-9]{1,64}$/.test(branch.id) ||
      !branch.name?.trim() ||
      !branch.city?.trim() ||
      branchIds.has(branch.id)
    )
      throw new StoreError('Invalid branch');
    branchIds.add(branch.id);
  }
  const passwordHash = hashPassword(password);
  const store = new Store({ dbPath, demoMode: false, provisioning: true });
  try {
    store.transaction(() => {
      const users = store.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
      const orgs = store.db.prepare('SELECT COUNT(*) AS n FROM org_state').get() as { n: number };
      if (users.n || orgs.n) throw new StoreError('Database already initialized', 409);
      const at = new Date().toISOString();
      const adminId = randomUUID();
      const audit: AuditEvent = {
        id: randomUUID(),
        at,
        actorId: adminId,
        actorName: config.admin.name.trim(),
        action: 'system.provision',
        entityId: '',
        summary: 'Live organization initialized',
      };
      const state: AppState = {
        revision: 0,
        settings: {
          companyName: config.companyName.trim(),
          address: config.address.trim(),
          gstin: config.gstin ?? '',
          defaultTaxBps: config.defaultTaxBps,
          mode: 'live',
        },
        branches: config.branches.map((b) => ({ ...b })),
        cylinders: [],
        parties: [],
        orders: [],
        batches: [],
        movements: [],
        rentals: [],
        invoices: [],
        receipts: [],
        audit: [audit],
        exceptions: [],
      };
      store.db
        .prepare('INSERT INTO org_state VALUES (?,?,?)')
        .run('default', 0, JSON.stringify(state));
      store.db
        .prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)')
        .run(
          adminId,
          'default',
          config.admin.name.trim(),
          config.admin.email.trim().toLowerCase(),
          'admin',
          JSON.stringify([...branchIds]),
          1,
          passwordHash,
        );
      store.db
        .prepare(
          'INSERT INTO audit_log(org_id,id,at,actor_id,actor_name,action,entity_id,summary) VALUES (?,?,?,?,?,?,?,?)',
        )
        .run(
          'default',
          audit.id,
          audit.at,
          audit.actorId,
          audit.actorName,
          audit.action,
          audit.entityId,
          audit.summary,
        );
    });
  } finally {
    store.close();
  }
}

export function restoreSnapshot(sourcePath: string, destinationPath: string): void {
  if (!existsSync(sourcePath)) throw new StoreError('Snapshot does not exist', 404);
  if (sourcePath === destinationPath || existsSync(destinationPath))
    throw new StoreError('Restore destination must be a new file');
  const source = new DatabaseSync(sourcePath);
  try {
    const row = source.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (row.integrity_check !== 'ok') throw new StoreError('Snapshot integrity check failed');
    for (const table of ['org_state', 'users', 'sessions', 'idempotency', 'audit_log']) {
      const found = source
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table);
      if (!found) throw new StoreError('Snapshot is not a CTMS database');
    }
    mkdirSync(dirname(destinationPath), { recursive: true });
    privateSqliteWrite(() => source.prepare('VACUUM INTO ?').run(destinationPath), destinationPath);
  } finally {
    source.close();
  }
  try {
    const restored = new DatabaseSync(destinationPath);
    try {
      if (
        (restored.prepare('PRAGMA integrity_check').get() as { integrity_check: string })
          .integrity_check !== 'ok'
      )
        throw new StoreError('Restored database integrity check failed');
      restored.prepare('DELETE FROM sessions').run();
    } finally {
      restored.close();
    }
  } catch (error) {
    rmSync(destinationPath, { force: true });
    throw error;
  }
}
