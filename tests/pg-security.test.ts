// Postgres (Supabase) hardening checks. Runs only when CTMS_TEST_PG_URL points at a
// disposable database. CTMS_TEST_PG_PROBE_URL must log in as a role that is a member of
// the Supabase API roles "anon" and "authenticated" (the roles public API keys map to).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import pg from 'pg';
import { PgStore, pgPoolConfig } from '../server/pg-store.js';
import { createHttpApp } from '../server/http-app.js';

const url = process.env.CTMS_TEST_PG_URL;
const probeUrl = process.env.CTMS_TEST_PG_PROBE_URL;
const skip = url ? false : 'set CTMS_TEST_PG_URL to run Postgres security tests';
let counter = 0;
const schemaName = () => `sec_${process.pid}_${++counter}_${Date.now() % 100000}`;
const TABLES = [
  'org_state',
  'users',
  'sessions',
  'idempotency',
  'user_auth_epoch',
  'audit_log',
  'login_attempts',
];

async function withSchema(work: (schema: string, store: PgStore) => Promise<void>) {
  const schema = schemaName();
  const store = await PgStore.open({ connectionString: url!, schema, demoMode: true, ssl: false });
  try {
    await work(schema, store);
  } finally {
    await store.close();
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
}
async function sql(connectionString: string, text: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await client.query(text, params);
  } finally {
    await client.end();
  }
}

test('schema is private, not public, and every table has row-level security', { skip }, () =>
  withSchema(async (schema) => {
    assert.notEqual(schema, 'public');
    const { rows } = await sql(
      url!,
      `SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname=$1 AND c.relkind='r'`,
      [schema],
    );
    assert.deepEqual(rows.map((r) => r.relname).sort(), [...TABLES].sort());
    for (const row of rows) assert.equal(row.relrowsecurity, true, `${row.relname} RLS`);
    // No policies: nobody except the owning server role can reach rows.
    const policies = await sql(
      url!,
      'SELECT COUNT(*)::int AS n FROM pg_policies WHERE schemaname=$1',
      [schema],
    );
    assert.equal(policies.rows[0].n, 0);
  }),
);

test(
  'Supabase API roles and PUBLIC have no access to any table',
  { skip: skip || (!probeUrl && 'set CTMS_TEST_PG_PROBE_URL') },
  () =>
    withSchema(async (schema) => {
      for (const role of ['anon', 'authenticated']) {
        const client = new pg.Client({ connectionString: probeUrl });
        await client.connect();
        try {
          await client.query(`SET ROLE ${role}`);
          for (const table of TABLES) {
            await assert.rejects(
              client.query(`SELECT * FROM "${schema}"."${table}" LIMIT 1`),
              /permission denied/,
              `${role} read ${table}`,
            );
          }
          await assert.rejects(
            client.query(
              `INSERT INTO "${schema}".users VALUES ('x','batra','x','x@x.x','admin','[]',true,'x')`,
            ),
            /permission denied/,
          );
        } finally {
          await client.end();
        }
      }
      // The probe role itself (PUBLIC privileges only) is also refused.
      await assert.rejects(sql(probeUrl!, `SELECT * FROM "${schema}".users`), /permission denied/);
      const grants = await sql(
        url!,
        `SELECT grantee, table_name FROM information_schema.role_table_grants
       WHERE table_schema=$1 AND grantee IN ('PUBLIC','anon','authenticated')`,
        [schema],
      );
      assert.equal(grants.rowCount, 0);
    }),
);

test('audit log cannot be updated, deleted or truncated even by the owner', { skip }, () =>
  withSchema(async (schema) => {
    const t = `"${schema}".audit_log`;
    await assert.rejects(sql(url!, `UPDATE ${t} SET summary='x'`), /audit append only/);
    await assert.rejects(sql(url!, `DELETE FROM ${t}`), /audit append only/);
    await assert.rejects(sql(url!, `TRUNCATE ${t}`), /audit append only/);
    const fn = await sql(
      url!,
      `SELECT proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname=$1 AND proname='audit_append_only'`,
      [schema],
    );
    assert.deepEqual(fn.rows[0].proconfig, ['search_path=""']);
  }),
);

test('passwords and session tokens are never stored in readable form', { skip }, () =>
  withSchema(async (schema, store) => {
    const app = createHttpApp(store, { production: false });
    const server: Server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const r = await fetch(base + '/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: base },
        body: JSON.stringify({ email: 'admin@batra.demo', password: 'OxygenDemo!2026' }),
      });
      assert.equal(r.status, 200);
      const token = r.headers.get('set-cookie')!.split(';')[0].split('=')[1];
      const dump = await sql(
        url!,
        `SELECT (SELECT string_agg(password_hash, ',') FROM "${schema}".users) AS hashes,
                (SELECT string_agg(token_hash, ',') FROM "${schema}".sessions) AS sessions`,
      );
      assert.equal(dump.rows[0].hashes.includes('OxygenDemo!2026'), false);
      assert.equal(dump.rows[0].sessions.includes(token), false);
      assert.match(dump.rows[0].sessions, /^[0-9a-f]{64}$/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }),
);

test(
  'parallel cold starts initialize once and share one seeded organization',
  { skip },
  async () => {
    const schema = schemaName();
    const open = () => PgStore.open({ connectionString: url!, schema, demoMode: true, ssl: false });
    const stores = await Promise.all([open(), open(), open()]);
    try {
      const users = await sql(url!, `SELECT COUNT(*)::int AS n FROM "${schema}".users`);
      const orgs = await sql(url!, `SELECT COUNT(*)::int AS n FROM "${schema}".org_state`);
      assert.equal(users.rows[0].n, 6);
      assert.equal(orgs.rows[0].n, 1);
    } finally {
      for (const store of stores) await store.close();
      await sql(url!, `DROP SCHEMA "${schema}" CASCADE`);
    }
  },
);

test('login lockout is shared across separate server instances', { skip }, () =>
  withSchema(async (schema) => {
    const second = await PgStore.open({
      connectionString: url!,
      schema,
      demoMode: true,
      ssl: false,
    });
    const first = await PgStore.open({
      connectionString: url!,
      schema,
      demoMode: true,
      ssl: false,
    });
    const servers: Server[] = [];
    try {
      const bases: string[] = [];
      for (const store of [first, second]) {
        const app = createHttpApp(store, { production: false });
        const server: Server = await new Promise((resolve) => {
          const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });
        servers.push(server);
        bases.push(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
      }
      const attempt = (base: string, password: string) =>
        fetch(base + '/api/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: base },
          body: JSON.stringify({ email: 'finance@batra.demo', password }),
        });
      for (let i = 0; i < 5; i++)
        assert.equal((await attempt(bases[0], 'wrong-password-123')).status, 401);
      // A different instance sees the same lockout, even with the correct password.
      assert.equal((await attempt(bases[1], 'OxygenDemo!2026')).status, 429);
    } finally {
      for (const server of servers)
        await new Promise<void>((resolve) => server.close(() => resolve()));
      await first.close();
      await second.close();
    }
  }),
);

test('TLS settings verify the server certificate when a CA is supplied', () => {
  const verified = pgPoolConfig({
    connectionString: 'postgresql://u:p@db.example.com:6543/postgres?sslmode=require',
    demoMode: true,
    caCert: '-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----',
  });
  assert.deepEqual(verified.ssl, {
    ca: '-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----',
    rejectUnauthorized: true,
  });
  assert.equal(String(verified.connectionString).includes('sslmode'), false);
  const encryptedOnly = pgPoolConfig({ connectionString: 'postgresql://u:p@h/db', demoMode: true });
  assert.deepEqual(encryptedOnly.ssl, { rejectUnauthorized: false });
});
