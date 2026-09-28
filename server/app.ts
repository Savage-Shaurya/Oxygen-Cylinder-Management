// Single-server entry: the HTTP app backed by the local SQLite store.
import { Store, type StoreOptions } from './store.js';
import { sqliteDataStore } from './data-store.js';
import { createHttpApp } from './http-app.js';

export function createApp(options: StoreOptions = {}) {
  const production =
    options.production ??
    (options.demoMode === false ||
      process.env.DEMO_MODE === 'false' ||
      process.env.NODE_ENV === 'production');
  const store = new Store({ ...options, production });
  const app = createHttpApp(sqliteDataStore(store), { production });
  app.locals.store = store;
  return app;
}
