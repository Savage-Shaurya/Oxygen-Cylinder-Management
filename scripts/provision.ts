import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { provisionDatabase, type ProvisionConfig } from '../server/store.js';

const [configPath, dbPath] = process.argv.slice(2);
const password = process.env.CTMS_ADMIN_PASSWORD;
if (!configPath || !dbPath || !password) {
  console.error(
    'Usage: CTMS_ADMIN_PASSWORD=<secret> npx tsx scripts/provision.ts <config.json> <database.sqlite>',
  );
  process.exit(2);
}
const config = JSON.parse(readFileSync(resolve(configPath), 'utf8')) as ProvisionConfig;
provisionDatabase(resolve(dbPath), config, password);
console.log(`Live database initialized at ${resolve(dbPath)}`);
