import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, rmSync, openSync, closeSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashPassword, tokenHash, verifyPassword, type StoredUser } from './auth.js';
import { createSeedState } from './seed.js';
import {
  DEMO_PASSWORD,
  SESSION_IDLE_MS,
  SESSION_TTL_MS,
  StoreError,
  assertCredentialCurrent,
  assertValidPassword,
  buildNewUser,
  checkModeCompatibility,
  checkRequestEnvelope,
  checkResetPassword,
  checkResetTarget,
  currentActor,
  demoResetState,
  demoRoles,
  domainUser,
  idempotencyResult,
  managementEvent,
  passwordEvent,
  planUserUpdate,
  preDomainChecks,
  replayPrior,
  requestedDriverId,
  runDomain,
  settingsGuard,
  validEmail,
  withManagementAudit,
  type NewUserInput,
  type UserUpdateInput,
} from './store-rules.js';
import type {
  ActionRequest,
  ActionResult,
  AppState,
  AuditEvent,
  Role,
  User,
} from '../shared/types.ts';

export { StoreError };
export interface StoreOptions {
  dbPath?: string;
  demoMode?: boolean;
  production?: boolean;
  provisioning?: boolean;
}
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
    const demo = this.db
      .prepare("SELECT COUNT(*) AS n FROM users WHERE email LIKE '%@batra.demo'")
      .get() as { n: number };
    const modes = (
      this.db.prepare('SELECT state_json FROM org_state').all() as { state_json: string }[]
    ).map((row) => JSON.parse(row.state_json).settings?.mode as string | undefined);
    try {
      checkModeCompatibility(this.demoMode, existing.n, demo.n, modes, options.provisioning);
    } catch (error) {
      this.db.close();
      throw error;
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
          hashPassword(DEMO_PASSWORD),
        );
      for (const event of [...state.audit].reverse()) this.appendAudit('batra', event);
    });
  }
  getUserByEmail(email: string): StoredUser | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE email=?').get(email.toLowerCase()) as
      Record<string, unknown> | undefined;
    return row && { ...this.rowUser(row), authEpoch: this.authEpoch(String(row.id)) };
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
  /** Issues a session only while the verified credential is still current (LS-06). */
  createSession(user: StoredUser, token: string, csrf: string) {
    this.transaction(() => {
      assertCredentialCurrent(user, this.getUser(user.id), this.authEpoch(user.id));
      const now = Date.now();
      this.db
        .prepare('DELETE FROM sessions WHERE expires_at<=? OR last_seen_at<=?')
        .run(now, now - SESSION_IDLE_MS);
      this.db
        .prepare(
          'INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,last_seen_at) VALUES (?,?,?,?,?)',
        )
        .run(tokenHash(token), user.id, csrf, now + SESSION_TTL_MS, now);
    });
  }
  session(token: string): { user: StoredUser; csrfToken: string } | undefined {
    const now = Date.now();
    const hashed = tokenHash(token);
    const row = this.db
      .prepare(
        'SELECT user_id,csrf_token FROM sessions WHERE token_hash=? AND expires_at>? AND last_seen_at>?',
      )
      .get(hashed, now, now - SESSION_IDLE_MS) as
      { user_id: string; csrf_token: string } | undefined;
    if (!row) return;
    const found = this.getUser(row.user_id);
    if (!found?.active) return;
    const user = { ...found, authEpoch: this.authEpoch(found.id) };
    this.db.prepare('UPDATE sessions SET last_seen_at=? WHERE token_hash=?').run(now, hashed);
    return { user, csrfToken: row.csrf_token };
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
  private bumpAuthEpoch(id: string) {
    this.db
      .prepare(
        'INSERT INTO user_auth_epoch(user_id,epoch) VALUES (?,1) ON CONFLICT(user_id) DO UPDATE SET epoch=epoch+1',
      )
      .run(id);
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
    const state = withManagementAudit(this.getState(orgId), event);
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
  /** Current actor, re-read inside the write transaction. */
  private actor(snapshot: User): StoredUser {
    return currentActor(snapshot, this.getUser(snapshot.id), this.authEpoch(snapshot.id));
  }
  private admin(snapshot: User): StoredUser {
    const actor = this.actor(snapshot);
    if (actor.role !== 'admin') throw new StoreError('Forbidden', 403);
    return actor;
  }
  ping() {
    this.db.prepare('SELECT 1 AS ok').get();
  }
  resetDemo(orgId: string, snapshot: StoredUser): { revision: number } {
    if (!this.demoMode) throw new StoreError('Not found', 404);
    return this.transaction(() => {
      const actor = this.actor(snapshot);
      if (actor.orgId !== orgId) throw new StoreError('Not found', 404);
      const { state, event } = demoResetState(
        this.demoMode,
        this.getState(orgId),
        domainUser(actor),
        createSeedState(new Date().toISOString()),
      );
      this.db
        .prepare('UPDATE org_state SET revision=?,state_json=? WHERE org_id=?')
        .run(state.revision, JSON.stringify(state), orgId);
      this.db.prepare('DELETE FROM idempotency WHERE org_id=?').run(orgId);
      this.appendAudit(orgId, event);
      return { revision: state.revision };
    });
  }
  apply(snapshot: User, request: ActionRequest): ActionResult {
    const hash = checkRequestEnvelope(snapshot, request);
    return this.transaction(() => {
      const current = this.actor(snapshot);
      const user = domainUser(current);
      checkRequestEnvelope(user, request);
      const old = this.getState(user.orgId);
      settingsGuard(old, user, request);
      const authEpoch = current.authEpoch!;
      const prior = this.db
        .prepare(
          'SELECT request_hash,result_json FROM idempotency WHERE org_id=? AND user_id=? AND idem_key=?',
        )
        .get(user.orgId, user.id, request.idempotencyKey) as
        { request_hash: string; result_json: string } | undefined;
      if (prior) return replayPrior(prior, hash, authEpoch, old);
      const driverId = requestedDriverId(request);
      preDomainChecks(old, request, user, driverId ? this.getUser(driverId) : undefined);
      const { result, newAudit } = runDomain(old, request, user);
      const update = this.db
        .prepare('UPDATE org_state SET revision=?,state_json=? WHERE org_id=? AND revision=?')
        .run(result.state.revision, JSON.stringify(result.state), user.orgId, old.revision);
      if (update.changes !== 1) throw new StoreError('State changed; refresh and retry', 409);
      for (const event of newAudit) this.appendAudit(user.orgId, event);
      this.db
        .prepare('INSERT INTO idempotency VALUES (?,?,?,?,?)')
        .run(
          user.orgId,
          user.id,
          request.idempotencyKey,
          hash,
          idempotencyResult(result, authEpoch),
        );
      return result;
    });
  }
  createUser(snapshot: User, input: NewUserInput): StoredUser {
    return this.transaction(() => {
      const actor = domainUser(this.admin(snapshot));
      const user = buildNewUser(actor, input, this.getState(actor.orgId));
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
      this.recordManagementAudit(
        actor.orgId,
        managementEvent(actor, 'user.create', user.id, `Created user ${user.email}`),
      );
      return user;
    });
  }
  updateUser(snapshot: User, id: string, input: UserUpdateInput): StoredUser {
    return this.transaction(() => {
      const actor = domainUser(this.admin(snapshot));
      const target = this.getUser(id);
      const plan = planUserUpdate(
        actor,
        id,
        target,
        input,
        this.getState(actor.orgId),
        this.getUsers(actor.orgId),
      );
      if (!plan.changed) return target!;
      this.db
        .prepare('UPDATE users SET active=?,role=?,branch_ids=? WHERE id=?')
        .run(Number(plan.active), plan.role, JSON.stringify(plan.nextBranches), id);
      if (plan.authorizationReduced) {
        this.bumpAuthEpoch(id);
        this.revokeUserSessions(id);
      }
      this.recordManagementAudit(
        actor.orgId,
        managementEvent(actor, 'user.update', id, `Updated user ${target!.email}`),
      );
      return this.getUser(id)!;
    });
  }
  changePassword(actor: StoredUser, currentPassword: string, newPassword: string): void {
    assertValidPassword(newPassword);
    this.transaction(() => {
      const current = this.getUser(actor.id);
      if (!current?.active || !verifyPassword(currentPassword, current.passwordHash))
        throw new StoreError('Current password is incorrect', 403);
      this.setPassword(current, newPassword, actor);
    });
  }
  resetPassword(snapshot: StoredUser, id: string, newPassword: string): void {
    checkResetPassword(snapshot, id, newPassword);
    this.transaction(() => {
      const actor = this.admin(snapshot);
      this.setPassword(checkResetTarget(actor, this.getUser(id)), newPassword, actor);
    });
  }
  private setPassword(target: StoredUser, password: string, actor: StoredUser): void {
    this.db
      .prepare('UPDATE users SET password_hash=? WHERE id=?')
      .run(hashPassword(password), target.id);
    this.bumpAuthEpoch(target.id);
    this.revokeUserSessions(target.id);
    this.recordManagementAudit(actor.orgId, passwordEvent(actor, target));
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
