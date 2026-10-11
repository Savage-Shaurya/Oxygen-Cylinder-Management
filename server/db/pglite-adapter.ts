import { PGlite, type Transaction } from '@electric-sql/pglite';
import type { Db, Row } from './sql.js';

const wrap =
  (q: PGlite | Transaction) =>
  async <T extends Row = Row>(text: string, params: unknown[] = []) => {
    const r = await q.query<T>(text, params as never[]);
    return { rows: r.rows, rowCount: r.affectedRows || r.rows.length };
  };

/** Db over in-process PGlite. `dataDir` persists to disk; omit it for an in-memory database. */
export async function pgliteDb(dataDir?: string): Promise<Db> {
  const lite = await PGlite.create(dataDir);
  return {
    kind: 'pglite',
    query: wrap(lite),
    exec: async (script) => {
      await lite.exec(script);
    },
    transaction: (work) =>
      lite.transaction((tx) =>
        work({
          query: wrap(tx),
          exec: async (script) => {
            await tx.exec(script);
          },
        }),
      ),
    close: () => lite.close(),
  };
}
