import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../server/app.js';
import type { Store } from '../server/store.js';

// Live Sarvam speech for sentences with names or numbers. No real network: Sarvam is faked.
async function fixture(voice: { apiKey?: string; perMinute?: number }) {
  const calls: { key: string | null; body: Record<string, unknown> }[] = [];
  const fakeSarvam = (async (_url: string, init?: RequestInit) => {
    calls.push({
      key: new Headers(init?.headers).get('api-subscription-key'),
      body: JSON.parse(String(init?.body)),
    });
    return Response.json({ audios: [Buffer.from('ID3-fake-mp3').toString('base64')] });
  }) as typeof fetch;
  const app = createApp({ dbPath: ':memory:', demoMode: true }, { ...voice, fetch: fakeSarvam });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const login = async () => {
    const r = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ email: 'driver@batra.demo', password: 'OxygenDemo!2026' }),
    });
    assert.equal(r.status, 200);
    return {
      cookie: r.headers.get('set-cookie')!.split(';')[0],
      csrf: ((await r.json()) as { csrfToken: string }).csrfToken,
    };
  };
  const say = (
    session: { cookie: string; csrf: string } | null,
    body: Record<string, unknown>,
    csrf = session?.csrf,
  ) =>
    fetch(`${base}/api/voice`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: base,
        ...(session ? { cookie: session.cookie } : {}),
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
      },
      body: JSON.stringify(body),
    });
  const dispose = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    (app.locals.store as Store).close();
  };
  return { calls, login, say, dispose };
}

test('live voice needs a signed-in user and a CSRF token', async () => {
  const f = await fixture({ apiKey: 'test-key' });
  try {
    assert.equal((await f.say(null, { text: 'Hello.', language: 'en' })).status, 401);
    const session = await f.login();
    assert.equal((await f.say(session, { text: 'Hello.', language: 'en' }, 'wrong')).status, 403);
    assert.equal(f.calls.length, 0);
  } finally {
    await f.dispose();
  }
});

test('live voice speaks with the shared Sarvam voice and caches repeated sentences', async () => {
  const f = await fixture({ apiKey: 'test-key' });
  try {
    const session = await f.login();
    const text = '2 cylinders given to City Care.';
    const first = await f.say(session, { text, language: 'en' });
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('content-type'), 'audio/mpeg');
    assert.equal(Buffer.from(await first.arrayBuffer()).toString(), 'ID3-fake-mp3');
    assert.equal((await f.say(session, { text, language: 'en' })).status, 200);
    assert.equal(f.calls.length, 1, 'the second request is served from the cache');
    assert.equal(f.calls[0].key, 'test-key');
    assert.deepEqual(
      {
        text: f.calls[0].body.text,
        language: f.calls[0].body.language_code,
        model: f.calls[0].body.model,
        speaker: f.calls[0].body.speaker,
      },
      { text, language: 'en-IN', model: 'bulbul:v3', speaker: 'priya' },
    );
  } finally {
    await f.dispose();
  }
});

test('live voice refuses bad input, limits each user, and reports a missing key', async () => {
  const f = await fixture({ apiKey: 'test-key', perMinute: 2 });
  try {
    const session = await f.login();
    assert.equal((await f.say(session, { text: 'Hi.', language: 'fr' })).status, 400);
    assert.equal((await f.say(session, { text: '', language: 'hi' })).status, 400);
    assert.equal((await f.say(session, { text: 'x'.repeat(301), language: 'hi' })).status, 400);
    assert.equal((await f.say(session, { text: 'One.', language: 'hi' })).status, 200);
    assert.equal((await f.say(session, { text: 'Two.', language: 'hi' })).status, 200);
    assert.equal((await f.say(session, { text: 'Three.', language: 'hi' })).status, 429);
  } finally {
    await f.dispose();
  }
  const unconfigured = await fixture({});
  try {
    const session = await unconfigured.login();
    assert.equal((await unconfigured.say(session, { text: 'Hi.', language: 'en' })).status, 503);
    assert.equal(unconfigured.calls.length, 0);
  } finally {
    await unconfigured.dispose();
  }
});
