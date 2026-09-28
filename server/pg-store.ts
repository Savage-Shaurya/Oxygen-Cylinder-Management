// Postgres storage (used for hosted deployments such as Supabase). Business rules come
// from store-rules.ts so behaviour matches the SQLite store exactly.
//
// Security model: only the server connects, with a secret connection string. Tables live
// in a private schema that Supabase's Data API does not expose; row-level security is on
// with no policies, and API roles (anon, authenticated) get no privileges, so the public
// API keys cannot read or change anything even if they leak.
import pg from 'pg';
import { hashPassword, tokenHash, verifyPassword, type StoredUser } from './auth.js';
import { createSeedState } from './seed.js';
import type { DataStore, LoginAttempt } from './data-store.js';
import {
  DEMO_PASSWORD,
  SESSION_IDLE_MS,
  SESSION_TTL_MS,
  StoreError,
  assertValidPassword,
  buildNewUser,
  checkModeCompatibility,
  checkRequestEnvelope,
  checkResetPassword,
  checkResetTarget,
  demoRoles,
  idempotencyResult,
  managementEvent,
  passwordEvent,
  planUserUpdate,
  preDomainChecks,
  replayPrior,
  requestedDriverId,
  runDomain,
  settingsGuard,
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

type Db = pg.Pool | pg.PoolClient;
const TABLES = [
  'org_state',
  'users',
  'sessions',
  'idempotency',
  'user_auth_epoch',
  'audit_log',
  'login_attempts',
];
// Supabase's API-facing roles; other providers simply do not have them.
const API_ROLES = ['anon', 'authenticated'];

export interface PgStoreOptions {
  connectionString: string;
  demoMode: boolean;
  /** Private schema name; letters, digits and underscores only. */
  schema?: string;
  /** PEM certificate authority for verifying the database TLS certificate. */
  caCert?: string;
  /** Require TLS (default true); only disable for a local test database. */
  ssl?: boolean;
  poolMax?: number;
}

export function pgPoolConfig(options: PgStoreOptions): pg.PoolConfig {
  // sslmode in the URL would override the explicit TLS settings below.
  const url = new URL(options.connectionString);
  url.searchParams.delete('sslmode');
  const ssl =
    options.ssl === false
      ? false
      : options.caCert
        ? { ca: options.caCert, rejectUnauthorized: true }
        : { rejectUnauthorized: false };
  return {
    connectionString: url.toString(),
    ssl,
    max: options.poolMax ?? 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // Supabase's transaction pooler does not support session state; keep queries simple.
    application_name: 'cylvero',
  };
}

export class PgStore implements DataStore {
  private constructor(
    private readonly pool: pg.Pool,
    private readonly s: string,
    readonly demoMode: boolean,
  ) {}

  static async open(options: PgStoreOptions): Promise<PgStore> {
    const schema = options.schema ?? 'cylvero';
    if (!/^[a-z_][a-z0-9_]{0,40}$/.test(schema)) throw new Error('Invalid schema name');
    if (options.ssl !== false && !options.caCert)
      console.warn('Database TLS is encrypted but the server certificate is not verified.');
    const pool = new pg.Pool(pgPoolConfig(options));
    pool.on('error', (error) => console.error('Idle database connection error', error.message));
    const store = new PgStore(pool, schema, options.demoMode);
    try {
      await store.initialize();
    } catch (error) {
      await pool.end();
      throw error;
    }
    return store;
  }

  async close() {
    await this.pool.end();
  }

  private t(table: string) {
    return `"${this.s}"."${table}"`;
  }

  private async tx<T>(work: (db: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async initialize() {
    const s = `"${this.s}"`;
    await this.tx(async (db) => {
      // One initializer at a time, even when several serverless instances start together.
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`cylvero-init:${this.s}`]);
      await db.query(`CREATE SCHEMA IF NOT EXISTS ${s}`);
      await db.query(`
        CREATE TABLE IF NOT EXISTS ${s}.org_state(org_id text PRIMARY KEY, revision bigint NOT NULL, state_json text NOT NULL);
        CREATE TABLE IF NOT EXISTS ${s}.users(id text PRIMARY KEY, org_id text NOT NULL, name text NOT NULL, email text NOT NULL UNIQUE, role text NOT NULL, branch_ids text NOT NULL, active boolean NOT NULL, password_hash text NOT NULL);
        CREATE TABLE IF NOT EXISTS ${s}.sessions(token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES ${s}.users(id), csrf_token text NOT NULL, expires_at bigint NOT NULL, last_seen_at bigint NOT NULL);
        CREATE INDEX IF NOT EXISTS sessions_user_idx ON ${s}.sessions(user_id);
        CREATE TABLE IF NOT EXISTS ${s}.idempotency(org_id text NOT NULL, user_id text NOT NULL, idem_key text NOT NULL, request_hash text NOT NULL, result_json text NOT NULL, PRIMARY KEY(org_id,user_id,idem_key));
        CREATE TABLE IF NOT EXISTS ${s}.user_auth_epoch(user_id text PRIMARY KEY REFERENCES ${s}.users(id), epoch integer NOT NULL);
        CREATE TABLE IF NOT EXISTS ${s}.audit_log(sequence bigserial PRIMARY KEY, org_id text NOT NULL, id text NOT NULL, at text NOT NULL, actor_id text NOT NULL, actor_name text NOT NULL, action text NOT NULL, entity_id text NOT NULL, summary text NOT NULL);
        CREATE INDEX IF NOT EXISTS audit_org_idx ON ${s}.audit_log(org_id, sequence);
        CREATE TABLE IF NOT EXISTS ${s}.login_attempts(key text PRIMARY KEY, count integer NOT NULL, until bigint NOT NULL);
        CREATE OR REPLACE FUNCTION ${s}.audit_append_only() RETURNS trigger
          LANGUAGE plpgsql SET search_path = '' AS $$
          BEGIN RAISE EXCEPTION 'audit append only'; END $$;
        CREATE OR REPLACE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON ${s}.audit_log
          FOR EACH ROW EXECUTE FUNCTION ${s}.audit_append_only();
        CREATE OR REPLACE TRIGGER audit_no_truncate BEFORE TRUNCATE ON ${s}.audit_log
          FOR EACH STATEMENT EXECUTE FUNCTION ${s}.audit_append_only();
      `);
      // Lock the schema down: RLS on (no policies = no access for non-owners) and no
      // privileges for PUBLIC or Supabase's API roles.
      for (const table of TABLES)
        await db.query(`ALTER TABLE ${s}.${table} ENABLE ROW LEVEL SECURITY`);
      const { rows: roleRows } = await db.query<{ rolname: string }>(
        'SELECT rolname FROM pg_roles WHERE rolname = ANY($1)',
        [API_ROLES],
      );
      const grantees = ['PUBLIC', ...roleRows.map((r) => `"${r.rolname}"`)].join(', ');
      await db.query(`
        REVOKE ALL ON SCHEMA ${s} FROM ${grantees};
        REVOKE ALL ON ALL TABLES IN SCHEMA ${s} FROM ${grantees};
        REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${s} FROM ${grantees};
        REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${s} FROM ${grantees};
        ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} REVOKE ALL ON TABLES FROM ${grantees};
        ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} REVOKE ALL ON SEQUENCES FROM ${grantees};
        ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} REVOKE ALL ON FUNCTIONS FROM ${grantees};
      `);
      const users = Number((await db.query(`SELECT COUNT(*) AS n FROM ${s}.users`)).rows[0].n);
      if (users === 0 && this.demoMode) {
        const orgs = Number((await db.query(`SELECT COUNT(*) AS n FROM ${s}.org_state`)).rows[0].n);
        if (orgs) throw new Error('Existing state cannot be seeded with demo accounts');
        await this.seedDemo(db);
      }
      const userCount = Number((await db.query(`SELECT COUNT(*) AS n FROM ${s}.users`)).rows[0].n);
      const demoAccounts = Number(
        (await db.query(`SELECT COUNT(*) AS n FROM ${s}.users WHERE email LIKE '%@batra.demo'`))
          .rows[0].n,
      );
      const modes = (
        await db.query<{ state_json: string }>(`SELECT state_json FROM ${s}.org_state`)
      ).rows.map((row) => JSON.parse(row.state_json).settings?.mode as string | undefined);
      checkModeCompatibility(this.demoMode, userCount, demoAccounts, modes);
    });
  }

  private async seedDemo(db: pg.PoolClient) {
    const state = createSeedState();
    await db.query(`INSERT INTO ${this.t('org_state')} VALUES ($1,$2,$3)`, [
      'batra',
      state.revision,
      JSON.stringify(state),
    ]);
    const passwordHash = hashPassword(DEMO_PASSWORD);
    for (const [role, id, name] of demoRoles)
      await db.query(`INSERT INTO ${this.t('users')} VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
        id,
        'batra',
        name,
        `${role}@batra.demo`,
        role,
        JSON.stringify(['b-delhi', 'b-faridabad']),
        true,
        passwordHash,
      ]);
    for (const event of [...state.audit].reverse()) await this.appendAudit(db, 'batra', event);
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
  private async user(db: Db, id: string): Promise<StoredUser | undefined> {
    const { rows } = await db.query(`SELECT * FROM ${this.t('users')} WHERE id=$1`, [id]);
    return rows[0] && this.rowUser(rows[0]);
  }
  private async users(db: Db, orgId: string): Promise<StoredUser[]> {
    const { rows } = await db.query(
      `SELECT * FROM ${this.t('users')} WHERE org_id=$1 ORDER BY name`,
      [orgId],
    );
    return rows.map((row) => this.rowUser(row));
  }
  private async state(db: Db, orgId: string, lock = false): Promise<AppState> {
    const { rows } = await db.query<{ state_json: string }>(
      `SELECT state_json FROM ${this.t('org_state')} WHERE org_id=$1${lock ? ' FOR UPDATE' : ''}`,
      [orgId],
    );
    if (!rows[0]) throw new StoreError('Organization not initialized', 503);
    return JSON.parse(rows[0].state_json);
  }
  private async authEpoch(db: Db, id: string): Promise<number> {
    const { rows } = await db.query<{ epoch: number }>(
      `SELECT epoch FROM ${this.t('user_auth_epoch')} WHERE user_id=$1`,
      [id],
    );
    return Number(rows[0]?.epoch ?? 0);
  }
  private async bumpAuthEpoch(db: Db, id: string) {
    await db.query(
      `INSERT INTO ${this.t('user_auth_epoch')}(user_id,epoch) VALUES ($1,1)
       ON CONFLICT(user_id) DO UPDATE SET epoch=${this.t('user_auth_epoch')}.epoch+1`,
      [id],
    );
  }
  private async appendAudit(db: Db, orgId: string, event: AuditEvent) {
    await db.query(
      `INSERT INTO ${this.t('audit_log')}(org_id,id,at,actor_id,actor_name,action,entity_id,summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        orgId,
        event.id,
        event.at,
        event.actorId,
        event.actorName,
        event.action,
        event.entityId,
        event.summary,
      ],
    );
  }
  /** Caller must hold the org_state row lock. */
  private async recordManagementAudit(db: pg.PoolClient, orgId: string, event: AuditEvent) {
    const state = withManagementAudit(await this.state(db, orgId), event);
    await db.query(`UPDATE ${this.t('org_state')} SET revision=$1,state_json=$2 WHERE org_id=$3`, [
      state.revision,
      JSON.stringify(state),
      orgId,
    ]);
    await this.appendAudit(db, orgId, event);
  }
  private async revokeUserSessions(db: Db, id: string) {
    await db.query(`DELETE FROM ${this.t('sessions')} WHERE user_id=$1`, [id]);
  }

  async getUserByEmail(email: string) {
    const { rows } = await this.pool.query(`SELECT * FROM ${this.t('users')} WHERE email=$1`, [
      email.toLowerCase(),
    ]);
    return rows[0] && this.rowUser(rows[0]);
  }
  getUsers(orgId: string) {
    return this.users(this.pool, orgId);
  }
  async createSession(user: User, token: string, csrf: string) {
    const now = Date.now();
    await this.pool.query(
      `DELETE FROM ${this.t('sessions')} WHERE expires_at<=$1 OR last_seen_at<=$2`,
      [now, now - SESSION_IDLE_MS],
    );
    await this.pool.query(
      `INSERT INTO ${this.t('sessions')}(token_hash,user_id,csrf_token,expires_at,last_seen_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [tokenHash(token), user.id, csrf, now + SESSION_TTL_MS, now],
    );
  }
  async session(token: string) {
    const now = Date.now();
    const hashed = tokenHash(token);
    const { rows } = await this.pool.query<{ user_id: string; csrf_token: string }>(
      `SELECT user_id,csrf_token FROM ${this.t('sessions')}
       WHERE token_hash=$1 AND expires_at>$2 AND last_seen_at>$3`,
      [hashed, now, now - SESSION_IDLE_MS],
    );
    if (!rows[0]) return;
    const user = await this.user(this.pool, rows[0].user_id);
    if (!user?.active) return;
    await this.pool.query(`UPDATE ${this.t('sessions')} SET last_seen_at=$1 WHERE token_hash=$2`, [
      now,
      hashed,
    ]);
    return { user, csrfToken: rows[0].csrf_token };
  }
  async revokeSession(token: string) {
    await this.pool.query(`DELETE FROM ${this.t('sessions')} WHERE token_hash=$1`, [
      tokenHash(token),
    ]);
  }
  getState(orgId: string) {
    return this.state(this.pool, orgId);
  }
  async getAudit(orgId: string): Promise<AuditEvent[]> {
    const { rows } = await this.pool.query(
      `SELECT id,at,actor_id,actor_name,action,entity_id,summary FROM ${this.t('audit_log')}
       WHERE org_id=$1 ORDER BY sequence DESC`,
      [orgId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      at: String(r.at),
      actorId: String(r.actor_id),
      actorName: String(r.actor_name),
      action: String(r.action),
      entityId: String(r.entity_id),
      summary: String(r.summary),
    }));
  }

  async apply(user: User, request: ActionRequest): Promise<ActionResult> {
    const hash = checkRequestEnvelope(user, request);
    return this.tx(async (db) => {
      // The row lock serializes writers per organization, like SQLite's BEGIN IMMEDIATE.
      const old = await this.state(db, user.orgId, true);
      settingsGuard(old, user, request);
      const authEpoch = await this.authEpoch(db, user.id);
      const { rows: prior } = await db.query<{ request_hash: string; result_json: string }>(
        `SELECT request_hash,result_json FROM ${this.t('idempotency')}
         WHERE org_id=$1 AND user_id=$2 AND idem_key=$3`,
        [user.orgId, user.id, request.idempotencyKey],
      );
      if (prior[0]) return replayPrior(prior[0], hash, authEpoch, old);
      const driverId = requestedDriverId(request);
      preDomainChecks(old, request, user, driverId ? await this.user(db, driverId) : undefined);
      const { result, newAudit } = runDomain(old, request, user);
      const update = await db.query(
        `UPDATE ${this.t('org_state')} SET revision=$1,state_json=$2 WHERE org_id=$3 AND revision=$4`,
        [result.state.revision, JSON.stringify(result.state), user.orgId, old.revision],
      );
      if (update.rowCount !== 1) throw new StoreError('State changed; refresh and retry', 409);
      for (const event of newAudit) await this.appendAudit(db, user.orgId, event);
      await db.query(`INSERT INTO ${this.t('idempotency')} VALUES ($1,$2,$3,$4,$5)`, [
        user.orgId,
        user.id,
        request.idempotencyKey,
        hash,
        idempotencyResult(result, authEpoch),
      ]);
      return result;
    });
  }

  async createUser(actor: User, input: NewUserInput): Promise<StoredUser> {
    return this.tx(async (db) => {
      const user = buildNewUser(actor, input, await this.state(db, actor.orgId, true));
      try {
        await db.query('SAVEPOINT create_user');
        await db.query(`INSERT INTO ${this.t('users')} VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
          user.id,
          user.orgId,
          user.name,
          user.email,
          user.role,
          JSON.stringify(user.branchIds),
          true,
          user.passwordHash,
        ]);
      } catch (error) {
        if ((error as { code?: string }).code !== '23505') throw error;
        throw new StoreError('Email already in use', 409);
      }
      await this.recordManagementAudit(
        db,
        actor.orgId,
        managementEvent(actor, 'user.create', user.id, `Created user ${user.email}`),
      );
      return user;
    });
  }

  async updateUser(actor: User, id: string, input: UserUpdateInput): Promise<StoredUser> {
    return this.tx(async (db) => {
      const state = await this.state(db, actor.orgId, true);
      const target = await this.user(db, id);
      const plan = planUserUpdate(
        actor,
        id,
        target,
        input,
        state,
        await this.users(db, actor.orgId),
      );
      if (!plan.changed) return target!;
      await db.query(`UPDATE ${this.t('users')} SET active=$1,role=$2,branch_ids=$3 WHERE id=$4`, [
        plan.active,
        plan.role,
        JSON.stringify(plan.nextBranches),
        id,
      ]);
      if (plan.authorizationReduced) {
        await this.bumpAuthEpoch(db, id);
        await this.revokeUserSessions(db, id);
      }
      await this.recordManagementAudit(
        db,
        actor.orgId,
        managementEvent(actor, 'user.update', id, `Updated user ${target!.email}`),
      );
      return (await this.user(db, id))!;
    });
  }

  async changePassword(actor: StoredUser, currentPassword: string, newPassword: string) {
    assertValidPassword(newPassword);
    await this.tx(async (db) => {
      await this.state(db, actor.orgId, true);
      const current = await this.user(db, actor.id);
      if (!current?.active || !verifyPassword(currentPassword, current.passwordHash))
        throw new StoreError('Current password is incorrect', 403);
      await this.setPassword(db, current, newPassword, actor);
    });
  }
  async resetPassword(actor: StoredUser, id: string, newPassword: string) {
    checkResetPassword(actor, id, newPassword);
    await this.tx(async (db) => {
      await this.state(db, actor.orgId, true);
      await this.setPassword(
        db,
        checkResetTarget(actor, await this.user(db, id)),
        newPassword,
        actor,
      );
    });
  }
  private async setPassword(
    db: pg.PoolClient,
    target: StoredUser,
    password: string,
    actor: StoredUser,
  ) {
    await db.query(`UPDATE ${this.t('users')} SET password_hash=$1 WHERE id=$2`, [
      hashPassword(password),
      target.id,
    ]);
    await this.bumpAuthEpoch(db, target.id);
    await this.revokeUserSessions(db, target.id);
    await this.recordManagementAudit(db, actor.orgId, passwordEvent(actor, target));
  }

  async getLoginAttempt(key: string): Promise<LoginAttempt | undefined> {
    const { rows } = await this.pool.query<{ count: number; until: string }>(
      `SELECT count,until FROM ${this.t('login_attempts')} WHERE key=$1`,
      [key],
    );
    return rows[0] && { count: Number(rows[0].count), until: Number(rows[0].until) };
  }
  async recordLoginFailure(key: string, now: number, windowMs: number) {
    const table = this.t('login_attempts');
    await this.pool.query(`DELETE FROM ${table} WHERE until<=$1`, [now]);
    await this.pool.query(
      `INSERT INTO ${table}(key,count,until) VALUES ($1,1,$2)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN ${table}.until > $3 THEN ${table}.count + 1 ELSE 1 END,
         until = $2`,
      [key, now + windowMs, now],
    );
  }
  async clearLoginAttempt(key: string) {
    await this.pool.query(`DELETE FROM ${this.t('login_attempts')} WHERE key=$1`, [key]);
  }
}
