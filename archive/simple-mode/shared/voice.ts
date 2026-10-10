// One Sarvam voice for everything spoken in the app: recorded clips and live sentences alike.
export const VOICE = {
  model: 'bulbul:v3',
  speaker: 'priya',
  pace: 0.95,
  sampleRate: 22050,
  codec: 'mp3',
} as const;

export const VOICE_LANGUAGES = { hi: 'hi-IN', en: 'en-IN' } as const;
export type VoiceLanguage = keyof typeof VOICE_LANGUAGES;

/** Longest sentence the app may ask the server to speak. */
export const VOICE_MAX_TEXT = 300;
