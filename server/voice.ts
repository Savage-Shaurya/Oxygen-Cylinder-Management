// Speaks sentences that cannot be pre-recorded (names, counts) with Sarvam AI, so the app
// never falls back to a robotic phone voice. The key stays on the server; phones only send
// the sentence. Results are cached; each user and the whole instance are rate limited, and
// every provider call has a hard time limit, to keep cost and waiting predictable.
import { VOICE, VOICE_LANGUAGES, VOICE_MAX_TEXT, type VoiceLanguage } from '../shared/voice.js';
import { StoreError, hasControlChars } from './store-rules.js';

/** Longest wait for the speech provider before the request is cancelled. */
export const VOICE_PROVIDER_TIMEOUT_MS = 8_000;

export interface VoiceOptions {
  apiKey?: string;
  /** Injected in tests; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Requests per user per minute. */
  perMinute?: number;
  /** Provider calls per minute for all users of this server together. */
  globalPerMinute?: number;
  /** Provider time limit in milliseconds. */
  timeoutMs?: number;
  cacheSize?: number;
}

export function createVoice(options: VoiceOptions) {
  const call = options.fetch ?? fetch;
  const perMinute = options.perMinute ?? 40;
  const globalPerMinute = options.globalPerMinute ?? 120;
  const timeoutMs = options.timeoutMs ?? VOICE_PROVIDER_TIMEOUT_MS;
  const cacheSize = options.cacheSize ?? 300;
  const cache = new Map<string, Promise<Buffer>>();
  const usage = new Map<string, number[]>();
  let shared: number[] = [];

  function check(text: unknown, language: unknown): { text: string; language: VoiceLanguage } {
    // Own properties only: inherited names such as "toString" are not languages.
    if (typeof language !== 'string' || !Object.hasOwn(VOICE_LANGUAGES, language))
      throw new StoreError('Unsupported voice language', 400);
    if (typeof text !== 'string') throw new StoreError('Text required', 400);
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean || clean.length > VOICE_MAX_TEXT || hasControlChars(clean))
      throw new StoreError('Text cannot be spoken', 400);
    return { text: clean, language: language as VoiceLanguage };
  }

  function allow(userId: string, now = Date.now()) {
    const recent = (usage.get(userId) ?? []).filter((at) => now - at < 60_000);
    shared = shared.filter((at) => now - at < 60_000);
    if (recent.length >= perMinute || shared.length >= globalPerMinute)
      throw new StoreError('Too many voice requests', 429);
    recent.push(now);
    shared.push(now);
    usage.set(userId, recent);
    if (usage.size > 10_000) usage.delete(usage.keys().next().value!);
  }

  async function request(text: string, language: VoiceLanguage): Promise<Buffer> {
    if (!options.apiKey) throw new StoreError('Voice is not configured', 503);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await call('https://api.sarvam.ai/text-to-speech', {
          method: 'POST',
          signal: controller.signal,
          headers: { 'api-subscription-key': options.apiKey, 'content-type': 'application/json' },
          body: JSON.stringify({
            text,
            language_code: VOICE_LANGUAGES[language],
            model: VOICE.model,
            speaker: VOICE.speaker,
            pace: VOICE.pace,
            speech_sample_rate: VOICE.sampleRate,
            output_audio_codec: VOICE.codec,
          }),
        });
      } catch {
        if (controller.signal.aborted) {
          console.error('Sarvam voice timed out');
          throw new StoreError('Voice unavailable', 504);
        }
        console.error('Sarvam voice request failed');
        throw new StoreError('Voice unavailable', 502);
      }
      if (!response.ok) {
        // The body can include account details: log the status only and discard the body.
        console.error('Sarvam voice failed with status', response.status);
        await response.body?.cancel().catch(() => undefined);
        throw new StoreError('Voice unavailable', 502);
      }
      let data: { audios?: string[] };
      try {
        data = (await response.json()) as { audios?: string[] };
      } catch {
        throw new StoreError('Voice unavailable', controller.signal.aborted ? 504 : 502);
      }
      if (!data.audios?.length) throw new StoreError('Voice unavailable', 502);
      return Buffer.from(data.audios.join(''), 'base64');
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    configured: () => !!options.apiKey,
    async speak(userId: string, rawText: unknown, rawLanguage: unknown): Promise<Buffer> {
      const { text, language } = check(rawText, rawLanguage);
      const key = `${language}|${text}`;
      const cached = cache.get(key);
      if (cached) {
        // Refresh its place so often-used sentences stay cached.
        cache.delete(key);
        cache.set(key, cached);
        return cached;
      }
      allow(userId);
      const pending = request(text, language);
      cache.set(key, pending);
      pending.catch(() => cache.delete(key));
      while (cache.size > cacheSize) cache.delete(cache.keys().next().value!);
      return pending;
    },
  };
}
