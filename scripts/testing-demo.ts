/** Persistent, isolated synthetic workspace for the guided user test on port 3004. */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { createApp } from '../server/app.js';

const dbPath = resolve('data/testing-demo.sqlite');
const port = 3004;

function verifyExistingDemo(path: string) {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error('Existing test database must be a regular file; it was left untouched');
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[])
        .map((row) => row.name),
    );
    if (!tables.has('org_state') || !tables.has('users'))
      throw new Error('Existing test database is incomplete; it was left untouched');
    const users = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    const states = db.prepare('SELECT state_json FROM org_state').all() as { state_json: string }[];
    if (users.n < 1 || states.length < 1 ||
      states.some((row) => JSON.parse(row.state_json).settings?.mode !== 'demo'))
      throw new Error('Existing test database is not an initialized demo; it was left untouched');
  } finally {
    db.close();
  }
}

verifyExistingDemo(dbPath);
const app = createApp({ dbPath, demoMode: true, production: false });
const vite = await createServer({
  server: { middlewareMode: true, hmr: { port: 24679 } },
  appType: 'spa',
});
app.use(vite.middlewares);
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Persistent test demo: http://localhost:${port}`);
  console.log(`Synthetic test data: ${dbPath}`);
  console.log('Restarting this command reuses the same test records.');
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await new Promise<void>((done) => server.close(() => done()));
  await vite.close();
  app.locals.store.close();
}
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });
