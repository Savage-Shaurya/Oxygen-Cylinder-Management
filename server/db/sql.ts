// Storage-neutral database access used by the relational stores. Two adapters implement
// it: real Postgres (pg-adapter.ts) and in-process PGlite (pglite-adapter.ts).
export type Row = Record<string, unknown>;
export interface Queryable {
  query<T extends Row = Row>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number }>;
  /** Runs a multi-statement script without parameters (schema migrations only). */
  exec(script: string): Promise<void>;
}
export interface Db extends Queryable {
  readonly kind: 'postgres' | 'pglite';
  /** Runs `work` in one transaction; any thrown error rolls everything back. */
  transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Validates a schema name before it is placed in SQL text, and returns it quoted. */
export function assertSchemaName(name: string): string {
  if (!/^[a-z_][a-z0-9_]{0,40}$/.test(name)) throw new Error('Invalid schema name');
  return `"${name}"`;
}

/** Canonical form of a scanned or typed cylinder code, so look-alike entries collide. */
export function normalizeCode(code: string): string {
  if (/[\u0000-\u001f\u007f]/.test(code)) throw new Error('Code contains control characters');
  const out = code
    .normalize('NFKC')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  if (!out) throw new Error('Code is empty');
  return out;
}
