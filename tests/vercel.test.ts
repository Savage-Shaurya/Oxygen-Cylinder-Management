import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bundle, normalizeEol } from '../scripts/bundle-api.js';
import { restoreApiPath } from '../server/vercel.js';

test('committed Vercel function bundle matches the server source', async () => {
  // Line endings are ignored: a Windows checkout (core.autocrlf) has CRLF, esbuild emits LF.
  const committed = normalizeEol(readFileSync('api/index.mjs', 'utf8'));
  assert.equal(
    committed === normalizeEol(await bundle()),
    true,
    'api/index.mjs is stale: run npm run bundle:api',
  );
});

test('Vercel rewrite restores the original API path and query', () => {
  assert.equal(restoreApiPath('/api?__path=login'), '/api/login');
  assert.equal(restoreApiPath('/api?__path=users%2Fu-1%2Fpassword'), '/api/users/u-1/password');
  assert.equal(restoreApiPath('/api?x=1&__path=audit'), '/api/audit?x=1');
  assert.equal(restoreApiPath('/api/login?__path=login'), '/api/login');
  assert.equal(restoreApiPath('/api/health'), '/api/health');
});

test('vercel.json routes API calls to the function and sends security headers', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
  assert.deepEqual(config.rewrites[0], {
    source: '/api/:path*',
    destination: '/api?__path=:path*',
  });
  const headers = Object.fromEntries(
    config.headers[0].headers.map((h: { key: string; value: string }) => [h.key, h.value]),
  );
  assert.match(headers['Content-Security-Policy'], /script-src 'self';/);
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.match(headers['Strict-Transport-Security'], /max-age=\d+/);
});
