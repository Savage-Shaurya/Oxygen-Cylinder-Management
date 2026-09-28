/** Isolated browser QA: never opens the user's demonstration database. */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { createApp } from '../server/app.js';

const port = Number(process.env.QA_PORT || 3002);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || [3001, 5173].includes(port))
  throw new Error('Choose a separate QA port');
const directory = mkdtempSync(join(tmpdir(), 'cylvero-browser-qa-'));
const app = createApp({ dbPath: join(directory, 'qa.sqlite'), demoMode: true, production: false });
const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'spa' });
app.use(vite.middlewares);
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Isolated browser QA: http://localhost:${port}`);
  console.log(`Disposable test database: ${directory}`);
});
async function stop() {
  server.close();
  await vite.close();
  app.locals.store.close();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
