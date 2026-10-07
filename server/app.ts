// Single-server entry: the HTTP app backed by the local SQLite store.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store, type StoreOptions } from './store.js';
import { sqliteDataStore } from './data-store.js';
import { createHttpApp } from './http-app.js';
import type { VoiceOptions } from './voice.js';

/** Sarvam key from SARVAM_API_KEY; on a developer machine also from the git-ignored keys.txt. */
function localVoiceKey(production: boolean): string | undefined {
  const fromEnv = process.env.SARVAM_API_KEY?.trim();
  if (fromEnv || production) return fromEnv || undefined;
  const file = resolve('keys.txt');
  if (!existsSync(file)) return undefined;
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('sk_'));
}

export function createApp(options: StoreOptions = {}, voice?: VoiceOptions) {
  const production =
    options.production ??
    (options.demoMode === false ||
      process.env.DEMO_MODE === 'false' ||
      process.env.NODE_ENV === 'production');
  const store = new Store({ ...options, production });
  const app = createHttpApp(sqliteDataStore(store), {
    production,
    voice: voice ?? { apiKey: localVoiceKey(production) },
  });
  app.locals.store = store;
  return app;
}
