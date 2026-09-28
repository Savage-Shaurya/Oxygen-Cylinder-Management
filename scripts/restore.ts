import { resolve } from 'node:path';
import { restoreSnapshot } from '../server/store.js';

const [snapshot, destination] = process.argv.slice(2);
if (!snapshot || !destination) {
  console.error('Usage: npx tsx scripts/restore.ts <snapshot.sqlite> <new-database.sqlite>');
  process.exit(2);
}
restoreSnapshot(resolve(snapshot), resolve(destination));
console.log(`Snapshot restored to ${resolve(destination)}`);
