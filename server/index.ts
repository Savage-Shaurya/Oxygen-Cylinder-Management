import { createApp } from './app.js';

export function startServer() {
  const app = createApp();
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? '127.0.0.1';
  return app.listen(port, host, () => console.log(`CTMS API listening on http://${host}:${port}`));
}
if (import.meta.url === `file://${process.argv[1]}`) startServer();
