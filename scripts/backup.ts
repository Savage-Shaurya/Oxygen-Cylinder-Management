import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../server/store.js';

const destination = process.argv[2];
if (!destination) {
  console.error('Usage: npx tsx scripts/backup.ts <destination.sqlite>');
  process.exit(2);
}
const path = resolve(destination);
if (existsSync(path)) {
  console.error('Destination already exists');
  process.exit(2);
}
mkdirSync(dirname(path), { recursive: true });
const source = process.env.CTMS_DB_PATH ?? 'data/ctms.sqlite';
if (!existsSync(source)) {
  console.error('Source database does not exist');
  process.exit(2);
}
// A backup is read-only work: never let opening an empty source initialize demo users.
try {
  const inspect = new DatabaseSync(source, { readOnly: true });
  try {
    const tables = inspect
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','org_state')",
      )
      .all();
    if (
      tables.length !== 2 ||
      Number(inspect.prepare('SELECT COUNT(*) AS n FROM users').get()?.n) < 1 ||
      Number(inspect.prepare('SELECT COUNT(*) AS n FROM org_state').get()?.n) < 1
    )
      throw new Error('Source database is not initialized');
  } finally {
    inspect.close();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid source database');
  process.exit(2);
}
// Opening with the current deployment mode enforces its demo/production guard.
const store = new Store({ dbPath: source });
try {
  store.backup(path);
  console.log(`Backup saved to ${path}`);
} finally {
  store.close();
}
