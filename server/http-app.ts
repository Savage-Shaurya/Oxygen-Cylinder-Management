import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import {
  randomToken,
  safeUser,
  verifyPassword,
  hashPassword,
  isRole,
  type StoredUser,
} from './auth.js';
import { StoreError, hasControlChars } from './store-rules.js';
import type { DataStore } from './data-store.js';
import type { ActionRequest, AppState, AuditEvent, User } from '../shared/types.ts';

const cookieName = 'ctms_session';
function cookieToken(req: Request): string | undefined {
  const raw = req.headers.cookie
    ?.split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith(cookieName + '='));
  return raw?.slice(cookieName.length + 1);
}
function csvCell(v: unknown): string {
  const raw = String(v ?? '');
  const safe = /^[\s]*[=+\-@\t\r＝＋－＠]/u.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}
function scopedAudit(events: AuditEvent[], state: AppState, user: User): AuditEvent[] {
  const branches = new Set(user.branchIds);
  const partyIds = new Set(
    state.parties.filter((party) => branches.has(party.branchId)).map((party) => party.id),
  );
  const wholeOrganization = state.branches.every((branch) => branches.has(branch.id));
  const ids = new Set<string>([
    ...state.cylinders.filter((x) => branches.has(x.branchId)).map((x) => x.id),
    ...state.parties.filter((x) => branches.has(x.branchId)).map((x) => x.id),
    ...state.orders.filter((x) => branches.has(x.branchId)).map((x) => x.id),
    ...state.batches.filter((x) => branches.has(x.branchId)).map((x) => x.id),
    ...state.invoices.filter((x) => branches.has(x.branchId)).map((x) => x.id),
    ...state.receipts.filter((x) => partyIds.has(x.partyId)).map((x) => x.id),
    ...(state.pickups ?? []).filter((x) => branches.has(x.branchId)).map((x) => x.id),
  ]);
  for (const exception of state.exceptions)
    if (exception.branchId ? branches.has(exception.branchId) : ids.has(exception.entityId))
      ids.add(exception.id);
  return events.filter(
    (e) =>
      (!e.entityId && wholeOrganization) ||
      ids.has(e.entityId) ||
      (user.role === 'admin' &&
        state.branches.every((b) => user.branchIds.includes(b.id)) &&
        e.action.startsWith('user.')),
  );
}
function scopedState(state: AppState, user: User): AppState {
  const branches = new Set(user.branchIds);
  const cylinders = state.cylinders.filter((c) => branches.has(c.branchId));
  const parties = state.parties.filter((p) => branches.has(p.branchId));
  const orders = state.orders.filter((o) => branches.has(o.branchId));
  const batches = state.batches.filter((b) => branches.has(b.branchId));
  const invoices = state.invoices.filter((i) => branches.has(i.branchId));
  const pickups = (state.pickups ?? []).filter((p) => branches.has(p.branchId));
  const partyIds = new Set(parties.map((p) => p.id));
  const cylinderIds = new Set(cylinders.map((c) => c.id));
  const visibleOrderIds = new Set(orders.map((o) => o.id));
  const shared = {
    ...state,
    branches: state.branches.filter((b) => branches.has(b.id)),
    cylinders,
    parties,
    orders,
    batches,
    movements: state.movements.filter((m) => cylinderIds.has(m.cylinderId)),
    rentals: state.rentals.filter((r) => partyIds.has(r.partyId)),
    invoices,
    pickups,
    receipts: state.receipts.filter((r) => partyIds.has(r.partyId)),
    audit:
      user.role === 'admin' || user.role === 'auditor' ? scopedAudit(state.audit, state, user) : [],
    exceptions: state.exceptions.filter((e) =>
      e.branchId
        ? branches.has(e.branchId)
        : cylinderIds.has(e.entityId) ||
          visibleOrderIds.has(e.entityId) ||
          partyIds.has(e.entityId),
    ),
  };
  if (['operations', 'quality'].includes(user.role))
    return {
      ...shared,
      parties: parties.map((p) => ({
        ...p,
        creditLimitPaise: 0,
        dailyRentalPaise: 0,
        depositPaise: 0,
        freeDays: 0,
        gstin: '',
      })),
      orders: orders.map((o) => ({ ...o, unitPricePaise: 0 })),
      rentals: [],
      invoices: [],
      receipts: [],
    };
  if (user.role !== 'driver') return shared;
  const todayIndia = (at: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(at));
  const today = todayIndia(new Date().toISOString());
  const ownOrders = orders
    .filter(
      (o) =>
        o.driverId === user.id &&
        (['dispatched', 'partial'].includes(o.status) ||
          (o.status === 'delivered' && o.deliveredAt && todayIndia(o.deliveredAt) === today)),
    )
    .map((o) => ({ ...o, unitPricePaise: 0 }));
  const ownPickups = pickups
    .filter((p) => p.driverId === user.id)
    .map((p) => ({ ...p, cylinderIds: p.cylinderIds.filter((id) => !p.receivedIds.includes(id)) }))
    .filter((p) => p.cylinderIds.length > 0);
  const pendingPickupIds = new Set(ownPickups.flatMap((p) => p.cylinderIds));
  const ownPartyIds = new Set([
    ...ownOrders.map((o) => o.partyId),
    ...ownPickups.map((p) => p.partyId),
  ]);
  const receivedPickupIds = new Set(
    pickups.filter((p) => p.driverId === user.id).flatMap((p) => p.receivedIds),
  );
  const unloadedIds = new Set(ownOrders.flatMap((o) => o.unloadedIds ?? []));
  const ownCylinderIds = new Set([
    ...ownOrders.flatMap((o) => o.cylinderIds),
    ...cylinders
      .filter((c) => c.custody === 'customer' && ownPartyIds.has(c.custodianId))
      .map((c) => c.id),
    ...pendingPickupIds,
  ]);
  return {
    ...shared,
    orders: ownOrders,
    parties: parties
      .filter((p) => ownPartyIds.has(p.id))
      .map((p) => ({
        ...p,
        creditLimitPaise: 0,
        dailyRentalPaise: 0,
        depositPaise: 0,
        freeDays: 0,
        gstin: '',
      })),
    cylinders: cylinders.filter(
      (c) => ownCylinderIds.has(c.id) && !receivedPickupIds.has(c.id) && !unloadedIds.has(c.id),
    ),
    pickups: ownPickups,
    batches: [],
    movements: [],
    rentals: [],
    invoices: [],
    receipts: [],
    audit: [],
    exceptions: [],
    settings: { ...shared.settings, address: '', gstin: '', defaultTaxBps: 0 },
  };
}
const stateCollections = [
  'branches',
  'cylinders',
  'parties',
  'orders',
  'batches',
  'movements',
  'rentals',
  'invoices',
  'pickups',
  'receipts',
  'audit',
  'exceptions',
] as const;
function stateDelta(before: AppState, after: AppState) {
  const changed: Record<string, unknown[]> = {};
  const removed: Record<string, string[]> = {};
  for (const name of stateCollections) {
    const prior = new Map(
      ((before[name] ?? []) as Array<{ id: string }>).map((item) => [item.id, item]),
    );
    const next = new Map(
      ((after[name] ?? []) as Array<{ id: string }>).map((item) => [item.id, item]),
    );
    const updates = [...next]
      .filter(([id, item]) => JSON.stringify(prior.get(id)) !== JSON.stringify(item))
      .map(([, item]) => item);
    const deletions = [...prior.keys()].filter((id) => !next.has(id));
    if (updates.length) changed[name] = updates;
    if (deletions.length) removed[name] = deletions;
  }
  return {
    baseRevision: before.revision,
    revision: after.revision,
    changed,
    removed,
    ...(JSON.stringify(before.settings) !== JSON.stringify(after.settings)
      ? { settings: after.settings }
      : {}),
  };
}
export interface HttpAppOptions {
  /** Secure cookies, CSP and built-asset serving. */
  production: boolean;
  /** Express trust-proxy setting for platforms that overwrite X-Forwarded-* headers. */
  trustProxy?: boolean | number | string[];
  /** Serve the built frontend from ./dist (single-server deployments only). */
  serveDist?: boolean;
}
export function createHttpApp(store: DataStore, options: HttpAppOptions) {
  const { production } = options;
  const app = express();
  // Only explicitly listed proxy networks may supply X-Forwarded-* headers.
  const trustedProxies = process.env.CTMS_TRUST_PROXY_CIDRS?.split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (options.trustProxy !== undefined) app.set('trust proxy', options.trustProxy);
  else if (trustedProxies?.length) app.set('trust proxy', trustedProxies);
  app.locals.dataStore = store;
  app.param('id', (_req, _res, next, id) =>
    next(hasControlChars(String(id)) ? new StoreError('User not found', 404) : undefined),
  );
  app.disable('x-powered-by');
  // Production headers match the static-site policy in vercel.json.
  app.use(
    helmet(
      production
        ? {
            contentSecurityPolicy: { directives: { frameAncestors: ["'none'"] } },
            frameguard: { action: 'deny' },
            strictTransportSecurity: { maxAge: 63_072_000, includeSubDomains: true },
            referrerPolicy: { policy: 'no-referrer' },
          }
        : { contentSecurityPolicy: false },
    ),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  const dummyPasswordHash = hashPassword('dummy-password-for-timing-only');
  const bump = (key: string, now: number) => store.recordLoginFailure(key, now, 15 * 60_000);
  const safe =
    (fn: (req: Request, res: Response, next: NextFunction) => unknown) =>
    (req: Request, res: Response, next: NextFunction) =>
      Promise.resolve()
        .then(() => fn(req, res, next))
        .catch(next);
  const requireAuth = safe(async (req, res, next) => {
    const token = cookieToken(req);
    const session = token && (await store.session(token));
    if (!session) throw new StoreError('Authentication required', 401);
    res.locals.user = session.user;
    res.locals.csrfToken = session.csrfToken;
    next();
  });
  const originGuard = safe((req, res, next) => {
    const origin = req.get('origin');
    if (origin) {
      let url: URL;
      try {
        url = new URL(origin);
      } catch {
        throw new StoreError('Invalid origin', 403);
      }
      const host = req.get('host');
      const expectedScheme = req.secure ? 'https:' : 'http:';
      const same = url.host === host && url.protocol === expectedScheme;
      const devAllowed =
        !production &&
        url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost'].includes(url.hostname) &&
        url.port === '5173' &&
        ['127.0.0.1:3001', 'localhost:3001'].includes(host ?? '');
      if (!same && !devAllowed) throw new StoreError('Invalid origin', 403);
    } else if (req.get('sec-fetch-site') === 'cross-site')
      throw new StoreError('Invalid origin', 403);
    next();
  });
  const csrf = safe((req, res, next) => {
    const supplied = req.get('x-csrf-token');
    if (!supplied || supplied !== res.locals.csrfToken)
      throw new StoreError('Invalid CSRF token', 403);
    next();
  });
  const bootstrap = async (user: StoredUser, csrfToken: string) => {
    const [state, allUsers] = await Promise.all([
      store.getState(user.orgId),
      store.getUsers(user.orgId),
    ]);
    return {
      user: safeUser(user),
      csrfToken,
      state: scopedState(state, user),
      users:
        user.role === 'admin'
          ? allUsers
              .filter((u) => u.branchIds.every((b) => user.branchIds.includes(b)))
              .map(safeUser)
          : user.role === 'operations'
            ? allUsers
                .filter(
                  (u) =>
                    u.active &&
                    u.role === 'driver' &&
                    u.branchIds.some((b) => user.branchIds.includes(b)),
                )
                .map((u) => ({ ...safeUser(u), email: '' }))
            : [],
      people: allUsers.map((u) => ({ id: u.id, name: u.name })),
    };
  };
  app.get('/api/health', (_req, res) =>
    res.json({ ok: true, mode: store.demoMode ? 'demo' : 'production' }),
  );
  app.post(
    '/api/login',
    originGuard,
    safe(async (req, res) => {
      const rawEmail =
        typeof req.body?.email === 'string'
          ? req.body.email.trim().toLowerCase().slice(0, 254)
          : '';
      // Control characters can never match an account; treat them as a failed login.
      const email = hasControlChars(rawEmail) ? '' : rawEmail;
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const emailKey = `email:${req.ip}:${email}`,
        ipKey = `ip:${req.ip}`,
        // Address-independent ceiling, so spoofed or rotating client addresses cannot
        // brute-force one account even if a proxy fails to sanitize X-Forwarded-For.
        accountKey = `account:${email}`;
      const now = Date.now();
      const [emailAttempt, ipAttempt, accountAttempt] = await Promise.all([
        store.getLoginAttempt(emailKey),
        store.getLoginAttempt(ipKey),
        store.getLoginAttempt(accountKey),
      ]);
      const over = (attempt: { count: number; until: number } | undefined, limit: number) =>
        !!attempt && attempt.until > now && attempt.count >= limit;
      if (over(emailAttempt, 5) || over(ipAttempt, 100) || over(accountAttempt, 20))
        throw new StoreError('Too many login attempts; try again later', 429);
      const user = await store.getUserByEmail(email);
      const valid = verifyPassword(password, user?.passwordHash ?? dummyPasswordHash);
      if (!user || !user.active || !valid) {
        await bump(emailKey, now);
        await bump(ipKey, now);
        await bump(accountKey, now);
        throw new StoreError('Invalid email or password', 401);
      }
      await store.clearLoginAttempt(emailKey);
      await store.clearLoginAttempt(ipKey);
      await store.clearLoginAttempt(accountKey);
      const token = randomToken(),
        csrfToken = randomToken();
      await store.createSession(user, token, csrfToken);
      res.cookie(cookieName, token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: production,
        path: '/',
        maxAge: 12 * 60 * 60_000,
      });
      res.json(await bootstrap(user, csrfToken));
    }),
  );
  app.get(
    '/api/bootstrap',
    requireAuth,
    safe(async (_req, res) => {
      const user = res.locals.user as StoredUser;
      res.json(await bootstrap(user, res.locals.csrfToken as string));
    }),
  );
  app.post(
    '/api/logout',
    originGuard,
    requireAuth,
    csrf,
    safe(async (req, res) => {
      await store.revokeSession(cookieToken(req)!);
      res.clearCookie(cookieName, {
        httpOnly: true,
        sameSite: 'strict',
        secure: production,
        path: '/',
      });
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/actions',
    originGuard,
    requireAuth,
    csrf,
    safe(async (req, res) => {
      const user = res.locals.user as StoredUser;
      const request = req.body as ActionRequest;
      if (
        !request ||
        typeof request.type !== 'string' ||
        !request.payload ||
        typeof request.payload !== 'object' ||
        Array.isArray(request.payload)
      )
        throw new StoreError('Invalid action');
      if (user.role === 'auditor') throw new StoreError('Read only role', 403);
      const before =
        req.get('prefer') === 'return=delta'
          ? scopedState(await store.getState(user.orgId), user)
          : undefined;
      const result = await store.apply(user, request);
      const after = scopedState(result.state, user);
      if (before) {
        res.json({
          message: result.message,
          entityId: result.entityId,
          delta: stateDelta(before, after),
        });
      } else res.json({ ...result, state: after });
    }),
  );
  app.get(
    '/api/export',
    requireAuth,
    safe(async (_req, res) => {
      const user = res.locals.user as StoredUser;
      if (!['admin', 'auditor'].includes(user.role)) throw new StoreError('Forbidden', 403);
      const [full, audit] = await Promise.all([
        store.getState(user.orgId),
        store.getAudit(user.orgId),
      ]);
      res.attachment('ctms-export.json');
      res.json({
        exportedAt: new Date().toISOString(),
        state: scopedState(full, user),
        audit: scopedAudit(audit, full, user),
      });
    }),
  );
  app.get(
    '/api/cylinders.csv',
    requireAuth,
    safe(async (_req, res) => {
      const user = res.locals.user as StoredUser;
      if (user.role === 'driver') throw new StoreError('Forbidden', 403);
      const rows = scopedState(await store.getState(user.orgId), user).cylinders;
      const keys = [
        'serial',
        'tag',
        'manufacturer',
        'gas',
        'size',
        'branchId',
        'custody',
        'condition',
        'contents',
        'testDue',
        'certificate',
      ];
      res.attachment('cylinders.csv');
      res
        .type('text/csv')
        .send(
          [
            keys.map(csvCell).join(','),
            ...rows.map((row) =>
              keys
                .map((key) => csvCell((row as unknown as Record<string, unknown>)[key]))
                .join(','),
            ),
          ].join('\r\n'),
        );
    }),
  );
  app.get(
    '/api/audit',
    requireAuth,
    safe(async (_req, res) => {
      const user = res.locals.user as StoredUser;
      if (!['admin', 'auditor'].includes(user.role)) throw new StoreError('Forbidden', 403);
      const [audit, full] = await Promise.all([
        store.getAudit(user.orgId),
        store.getState(user.orgId),
      ]);
      res.json(scopedAudit(audit, full, user));
    }),
  );
  app.post(
    '/api/users',
    originGuard,
    requireAuth,
    csrf,
    safe(async (req, res) => {
      const actor = res.locals.user as StoredUser;
      if (actor.role !== 'admin') throw new StoreError('Forbidden', 403);
      const body = req.body;
      if (
        !body ||
        !isRole(body.role) ||
        typeof body.name !== 'string' ||
        typeof body.email !== 'string' ||
        typeof body.password !== 'string' ||
        !Array.isArray(body.branchIds) ||
        body.branchIds.some((x: unknown) => typeof x !== 'string')
      )
        throw new StoreError('Invalid user');
      res.status(201).json(safeUser(await store.createUser(actor, body)));
    }),
  );
  app.post(
    '/api/password',
    originGuard,
    requireAuth,
    csrf,
    safe(async (req, res) => {
      if (
        typeof req.body?.currentPassword !== 'string' ||
        typeof req.body?.newPassword !== 'string'
      )
        throw new StoreError('Current and new passwords required');
      await store.changePassword(
        res.locals.user as StoredUser,
        req.body.currentPassword,
        req.body.newPassword,
      );
      res.clearCookie(cookieName, {
        httpOnly: true,
        sameSite: 'strict',
        secure: production,
        path: '/',
      });
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/users/:id/password',
    originGuard,
    requireAuth,
    csrf,
    safe(async (req, res) => {
      if (typeof req.body?.newPassword !== 'string') throw new StoreError('New password required');
      await store.resetPassword(
        res.locals.user as StoredUser,
        String(req.params.id),
        req.body.newPassword,
      );
      res.json({ ok: true });
    }),
  );
  app.patch(
    '/api/users/:id',
    originGuard,
    requireAuth,
    csrf,
    safe(async (req, res) => {
      const actor = res.locals.user as StoredUser;
      if (actor.role !== 'admin') throw new StoreError('Forbidden', 403);
      const body = req.body;
      if (
        !body ||
        typeof body !== 'object' ||
        (body.active !== undefined && typeof body.active !== 'boolean') ||
        (body.role !== undefined && !isRole(body.role)) ||
        (body.branchIds !== undefined &&
          (!Array.isArray(body.branchIds) ||
            body.branchIds.some((x: unknown) => typeof x !== 'string')))
      )
        throw new StoreError('Invalid user update');
      res.json(safeUser(await store.updateUser(actor, String(req.params.id), body)));
    }),
  );
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  if (production && options.serveDist !== false) {
    const dist = join(process.cwd(), 'dist');
    if (existsSync(dist)) {
      app.use(express.static(dist));
      app.get('/{*path}', (_req, res) => res.sendFile(join(dist, 'index.html')));
    }
  }
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status =
      err instanceof StoreError
        ? err.status
        : typeof (err as { status?: unknown })?.status === 'number'
          ? (err as { status: number }).status
          : 500;
    const message =
      status >= 500
        ? 'Internal server error'
        : err instanceof Error
          ? err.message
          : 'Request failed';
    if (status >= 500) console.error(err);
    res.status(status).json({ error: message });
  });
  return app;
}
