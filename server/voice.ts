// Speaks sentences that cannot be pre-recorded (names, counts) with Sarvam AI, so the app
// never falls back to a robotic phone voice. The key stays on the server; phones only send
// the sentence. Results are cached and each user is rate limited to keep cost predictable.
import { VOICE, VOICE_LANGUAGES, VOICE_MAX_TEXT, type VoiceLanguage } from '../shared/voice.js';
import { StoreError, hasControlChars } from './store-rules.js';

export interface VoiceOptions {
  apiKey?: string;
  /** Injected in tests; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Requests per user per minute. */
  perMinute?: number;
  cacheSize?: number;
}

export function createVoice(options: VoiceOptions) {
  const call = options.fetch ?? fetch;
  const perMinute = options.perMinute ?? 40;
  const cacheSize = options.cacheSize ?? 300;
  const cache = new Map<string, Promise<Buffer>>();
  const usage = new Map<string, number[]>();

  function check(text: unknown, language: unknown): { text: string; language: VoiceLanguage } {
    if (typeof language !== 'string' || !(language in VOICE_LANGUAGES))
      throw new StoreError('Unsupported voice language', 400);
    if (typeof text !== 'string') throw new StoreError('Text required', 400);
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean || clean.length > VOICE_MAX_TEXT || hasControlChars(clean))
      throw new StoreError('Text cannot be spoken', 400);
    return { text: clean, language: language as VoiceLanguage };
  }

  function allow(userId: string, now = Date.now()) {
    const recent = (usage.get(userId) ?? []).filter((at) => now - at < 60_000);
    if (recent.length >= perMinute) throw new StoreError('Too many voice requests', 429);
    recent.push(now);
    usage.set(userId, recent);
  }

  async function request(text: string, language: VoiceLanguage): Promise<Buffer> {
    if (!options.apiKey) throw new StoreError('Voice is not configured', 503);
    const response = await call('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
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
    if (!response.ok) {
      // The provider's message can include account details; keep it in the server log only.
      console.error('Sarvam voice failed:', response.status, (await response.text()).slice(0, 200));
      throw new StoreError('Voice unavailable', 502);
    }
    const data = (await response.json()) as { audios?: string[] };
    if (!data.audios?.length) throw new StoreError('Voice unavailable', 502);
    return Buffer.from(data.audios.join(''), 'base64');
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
