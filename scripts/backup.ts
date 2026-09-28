import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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
// Opening with the current deployment mode enforces its demo/production guard.
const store = new Store({ dbPath: source });
try {
  store.backup(path);
  console.log(`Backup saved to ${path}`);
} finally {
  store.close();
}
