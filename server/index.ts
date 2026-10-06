import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

export function startServer() {
  const app = createApp();
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? '127.0.0.1';
  return app.listen(port, host, () => console.log(`CTMS API listening on http://${host}:${port}`));
}
// Compare real paths so direct starts work on Windows too (file:///C:/… vs C:\…).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) startServer();
