import type pg from 'pg';
import type { Db, Queryable, Row } from './sql.js';

const wrap =
  (client: pg.Pool | pg.PoolClient) =>
  async <T extends Row = Row>(text: string, params: unknown[] = []) => {
    const r = await client.query(text, params);
    return { rows: r.rows as T[], rowCount: r.rowCount ?? r.rows.length };
  };

/** Db over a pg pool (direct Postgres or Cloudflare Hyperdrive). */
export function pgDb(pool: pg.Pool): Db {
  // An idle client can error (e.g. server restart); without a listener that crashes the process.
  pool.on('error', (error) => console.error('Idle database connection error:', error.message));
  return {
    kind: 'postgres',
    query: wrap(pool),
    exec: async (script) => {
      await pool.query(script);
    },
    async transaction(work) {
      const client = await pool.connect();
      let broken: Error | undefined;
      try {
        await client.query('BEGIN');
        const tx: Queryable = {
          query: wrap(client),
          exec: async (script) => {
            await client.query(script);
          },
        };
        const out = await work(tx);
        await client.query('COMMIT');
        return out;
      } catch (error) {
        await client.query('ROLLBACK').catch((rollbackError: Error) => {
          broken = rollbackError;
        });
        throw error;
      } finally {
        // Releasing with an error evicts a connection whose rollback failed.
        client.release(broken);
      }
    },
    close: () => pool.end(),
  };
}
