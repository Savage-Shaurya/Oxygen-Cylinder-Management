import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Store } from '../server/store.js';

const destination = process.argv[2];
if (!destination) {
  console.error('Usage: npm run demo:new -- data/presentation.sqlite');
  process.exit(2);
}
const path = resolve(destination);
if (existsSync(path)) {
  console.error('Destination already exists. Choose a new filename to preserve existing work.');
  process.exit(2);
}
mkdirSync(dirname(path), { recursive: true });
const store = new Store({ dbPath: path, demoMode: true, production: false });
try {
  const state = store.getState('batra');
  console.log(`Fresh demonstration created: ${path}`);
  console.log(`${state.cylinders.length} synthetic cylinders · ${state.branches.length} branches`);
  console.log(
    'Start the app with CTMS_DB_PATH set to this file. Existing demonstration files are unchanged.',
  );
} finally {
  store.close();
}
