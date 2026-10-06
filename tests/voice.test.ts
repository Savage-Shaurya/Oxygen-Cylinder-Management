import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import en from '../src/i18n/en';
import hi from '../src/i18n/hi';
import { phraseKey } from '../src/i18n/index';
import { recordable } from '../scripts/voice-clips';

const manifestPath = 'public/voice/manifest.json';

test('only whole fixed sentences are recorded as voice clips', () => {
  const phrases = new Map(recordable(en));
  assert.ok(phrases.has('status.hold'));
  assert.ok(!phrases.has('tile.give'), 'button labels are not spoken');
  assert.ok(!phrases.has('give.summary'), 'sentences with names use the phone voice');
});

test('every recorded clip exists and still matches a phrase in the app', () => {
  if (!existsSync(manifestPath)) return;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<
    string,
    Record<string, string>
  >;
  const tables: Record<string, Record<string, string>> = { en, hi };
  for (const [language, clips] of Object.entries(manifest)) {
    const recordableKeys = new Set(recordable(tables[language]).map(([key]) => key));
    for (const [key, file] of Object.entries(clips)) {
      assert.ok(recordableKeys.has(key), `${language}/${key} is not a spoken phrase any more`);
      assert.ok(existsSync(`public/voice/${file}`), `missing clip ${file}`);
    }
  }
});

test('a spoken sentence finds its phrase key in the chosen language', () => {
  assert.equal(phraseKey(hi['status.hold'], 'hi'), 'status.hold');
  assert.equal(phraseKey(`  ${en['look.unknown']} `, 'en'), 'look.unknown');
  assert.equal(phraseKey('Something nobody says.', 'en'), undefined);
});
