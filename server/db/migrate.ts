import { createHash } from 'node:crypto';
import { assertSchemaName, type Db, type Queryable } from './sql.js';
import { MIGRATIONS } from '../migrations/index.js';

export interface Migration {
  version: number;
  name: string;
  /** SQL text; `{{schema}}` is replaced by the quoted schema name. */
  sql: string;
}
// Supabase's API-facing roles; other providers do not have them.
const API_ROLES = ['anon', 'authenticated'];

export const migrationChecksum = (sql: string) => createHash('sha256').update(sql).digest('hex');

/** Applies pending migrations once, under a lock, then locks the schema down. */
export async function migrate(db: Db, schema: string, migrations: Migration[] = MIGRATIONS) {
  const s = assertSchemaName(schema);
  return db.transaction(async (tx) => {
    // One migrator at a time, even when several server instances start together.
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`cylvero-migrate:${schema}`]);
    await tx.exec(`CREATE SCHEMA IF NOT EXISTS ${s};
      CREATE TABLE IF NOT EXISTS ${s}.schema_migrations(
        version integer PRIMARY KEY, name text NOT NULL, checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now());`);
    const { rows } = await tx.query<{ version: number; checksum: string }>(
      `SELECT version, checksum FROM ${s}.schema_migrations`,
    );
    const applied = new Map(rows.map((r) => [Number(r.version), r.checksum]));
    const ran: number[] = [];
    for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
      const sum = migrationChecksum(m.sql);
      if (applied.has(m.version)) {
        if (applied.get(m.version) !== sum)
          throw new Error(`Migration ${m.version} (${m.name}) was changed after it was applied`);
        continue;
      }
      await tx.exec(m.sql.replaceAll('{{schema}}', s));
      await tx.query(
        `INSERT INTO ${s}.schema_migrations(version, name, checksum) VALUES ($1,$2,$3)`,
        [m.version, m.name, sum],
      );
      ran.push(m.version);
    }
    await lockDown(tx, schema, s);
    return ran;
  });
}

/** Row-level security on every table (no policies) and no rights for PUBLIC or API roles. */
async function lockDown(tx: Queryable, schema: string, s: string) {
  const { rows: tables } = await tx.query<{ tablename: string }>(
    'SELECT tablename FROM pg_tables WHERE schemaname = $1',
    [schema],
  );
  for (const { tablename } of tables)
    await tx.exec(`ALTER TABLE ${s}."${tablename.replaceAll('"', '')}" ENABLE ROW LEVEL SECURITY;`);
  const { rows: roles } = await tx.query<{ rolname: string }>(
    'SELECT rolname FROM pg_roles WHERE rolname = ANY($1)',
    [API_ROLES],
  );
  const grantees = ['PUBLIC', ...roles.map((r) => `"${r.rolname}"`)].join(', ');
  await tx.exec(`
    REVOKE ALL ON SCHEMA ${s} FROM ${grantees};
    REVOKE ALL ON ALL TABLES IN SCHEMA ${s} FROM ${grantees};
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${s} FROM ${grantees};
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${s} FROM ${grantees};
    ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} REVOKE ALL ON TABLES FROM ${grantees};
    ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} REVOKE ALL ON SEQUENCES FROM ${grantees};
    ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} REVOKE ALL ON FUNCTIONS FROM ${grantees};`);
}
