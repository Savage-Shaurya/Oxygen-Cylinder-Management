// Vercel entry: the HTTP app backed by Postgres (Supabase). Bundled into api/index.mjs by
// scripts/bundle-api.ts. Configuration comes only from Vercel environment variables.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
import { createHttpApp } from './http-app.js';
import { PgStore } from './pg-store.js';

let appPromise: Promise<Express> | undefined;

async function build(): Promise<Express> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not configured');
  const store = await PgStore.open({
    connectionString,
    // The hosted copy is a demonstration workspace unless explicitly switched off.
    demoMode: process.env.CTMS_DEMO_MODE !== 'false',
    caCert: process.env.DATABASE_CA_CERT?.replaceAll('\\n', '\n') || undefined,
    poolMax: Number(process.env.PG_POOL_MAX ?? 3),
    // Only for a local stand-in database; hosted Postgres always uses TLS.
    ssl: process.env.DATABASE_SSL !== 'disable',
  });
  // Vercel overwrites X-Forwarded-For and serves over HTTPS, so its proxy hop is trusted.
  return createHttpApp(store, {
    production: true,
    trustProxy: 1,
    serveDist: false,
    // Set SARVAM_API_KEY in Vercel; without it, live sentences stay silent (clips still play).
    voice: { apiKey: process.env.SARVAM_API_KEY?.trim() || undefined },
  });
}

/** Restores the original /api/... path from the rewrite in vercel.json. */
export function restoreApiPath(rawUrl: string): string {
  const url = new URL(rawUrl, 'http://internal');
  const forwarded = url.searchParams.get('__path');
  url.searchParams.delete('__path');
  if (forwarded !== null && (url.pathname === '/api' || url.pathname === '/api/'))
    url.pathname = `/api/${forwarded.replace(/^\/+/, '')}`;
  return url.pathname + url.search;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  req.url = restoreApiPath(req.url ?? '/');
  let app: Express;
  try {
    appPromise ??= build();
    app = await appPromise;
  } catch (error) {
    appPromise = undefined; // retry on the next request
    console.error('Startup failed:', error instanceof Error ? error.message : error);
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify({ error: 'Service temporarily unavailable' }));
    return;
  }
  app(req as Parameters<Express>[0], res as Parameters<Express>[1]);
}
