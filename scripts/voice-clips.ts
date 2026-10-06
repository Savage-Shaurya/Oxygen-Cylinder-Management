/**
 * Records Simple mode's fixed phrases as audio clips with Sarvam AI text-to-speech, so phones
 * play a clear human-like voice even when they have no Hindi voice installed, offline, and
 * without any API key in the app.
 *
 *   SARVAM_API_KEY=sk_... npm run voice:clips      (or put the key alone in ./keys.txt)
 *
 * Only phrases without {placeholders} are recorded; sentences with names or numbers use the
 * phone's own voice. Unchanged phrases are skipped, so re-running after a wording change only
 * records what changed. The key is read here on the developer's machine and never shipped.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import en from '../src/i18n/en';
import hi from '../src/i18n/hi';

const OUT = resolve('public/voice');
const MODEL = process.env.VOICE_MODEL ?? 'bulbul:v3';
const SPEAKER = process.env.VOICE_SPEAKER ?? 'priya';
const PACE = Number(process.env.VOICE_PACE ?? 0.95);
const languages = [
  { id: 'hi', code: 'hi-IN', table: hi as Record<string, string> },
  { id: 'en', code: 'en-IN', table: en as Record<string, string> },
] as const;

export type VoiceManifest = Record<string, Record<string, string>>;

/**
 * Phrases worth recording: whole spoken sentences with fixed text. Button labels (no full
 * stop) are never spoken, and sentences with {name} or {one|many} use the phone's voice.
 */
export function recordable(table: Record<string, string>) {
  return Object.entries(table).filter(
    ([, text]) => /[.?!।]$/.test(text.trim()) && !/[{}]/.test(text),
  );
}

function apiKey() {
  const fromEnv = process.env.SARVAM_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const file = resolve('keys.txt');
  if (existsSync(file)) {
    const line = readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => /^sk_/.test(l));
    if (line) return line;
  }
  throw new Error('Set SARVAM_API_KEY (or put the key in keys.txt, which git ignores).');
}

async function speak(key: string, text: string, language: string): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: { 'api-subscription-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        language_code: language,
        model: MODEL,
        speaker: SPEAKER,
        pace: PACE,
        speech_sample_rate: 22050,
        output_audio_codec: 'mp3',
      }),
    });
    if (response.ok) {
      const data = (await response.json()) as { audios?: string[] };
      if (!data.audios?.[0]) throw new Error('Sarvam returned no audio');
      return Buffer.from(data.audios.join(''), 'base64');
    }
    const detail = (await response.text()).slice(0, 300);
    // Rate limits and brief outages are retried; anything else stops the run.
    if ((response.status === 429 || response.status >= 500) && attempt < 5) {
      await new Promise((r) => setTimeout(r, attempt * 2000));
      continue;
    }
    throw new Error(`Sarvam ${response.status}: ${detail}`);
  }
}

async function main() {
  if (process.argv.includes('--dry')) {
    for (const language of languages) {
      const phrases = recordable(language.table);
      const chars = phrases.reduce((sum, [, text]) => sum + text.length, 0);
      console.log(`${language.id}: ${phrases.length} phrases, ${chars} characters`);
    }
    return;
  }
  const key = apiKey();
  const manifestPath = join(OUT, 'manifest.json');
  const previous: VoiceManifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8'))
    : {};
  const manifest: VoiceManifest = {};
  let recorded = 0;
  let kept = 0;
  for (const language of languages) {
    const dir = join(OUT, language.id);
    mkdirSync(dir, { recursive: true });
    manifest[language.id] = {};
    for (const [phrase, text] of recordable(language.table)) {
      const hash = createHash('sha256')
        .update(`${MODEL}|${SPEAKER}|${PACE}|${text}`)
        .digest('hex')
        .slice(0, 10);
      const file = `${language.id}/${phrase}.${hash}.mp3`;
      if (previous[language.id]?.[phrase] === file && existsSync(join(OUT, file))) {
        manifest[language.id][phrase] = file;
        kept++;
        continue;
      }
      writeFileSync(join(OUT, file), await speak(key, text, language.code));
      manifest[language.id][phrase] = file;
      recorded++;
      process.stdout.write(`\r${language.id}: ${recorded} recorded`);
    }
    // Remove clips for phrases that changed or no longer exist.
    const wanted = new Set(Object.values(manifest[language.id]).map((f) => f.split('/')[1]));
    for (const name of readdirSync(dir)) if (!wanted.has(name)) rmSync(join(dir, name));
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `\nVoice clips ready: ${recorded} recorded, ${kept} unchanged. Speaker ${SPEAKER}, ${MODEL}.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
