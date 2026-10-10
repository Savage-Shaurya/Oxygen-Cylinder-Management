import { useSyncExternalStore } from 'react';
import en from './en';
import hi from './hi';
import { readSetting, writeSetting } from '../basic/storage';

export type Lang = 'en' | 'hi';
export type TextKey = keyof typeof en;
export type Params = Record<string, string | number>;

const tables: Record<Lang, Record<TextKey, string>> = { en, hi };
export const LANGS: { id: Lang; name: string; speech: string }[] = [
  { id: 'hi', name: 'हिंदी', speech: 'hi-IN' },
  { id: 'en', name: 'English', speech: 'en-IN' },
];

const LANG_KEY = 'cylvero-lang';
const listeners = new Set<() => void>();
let current: Lang | null = null;

function stored(): Lang | null {
  const value = readSetting(LANG_KEY);
  return value === 'en' || value === 'hi' ? value : null;
}

/** The chosen language, or null before the first-use picker has been answered. */
export function chosenLang(): Lang | null {
  return (current ??= stored());
}

export function lang(): Lang {
  return chosenLang() ?? 'en';
}

export function setLang(next: Lang) {
  current = next;
  writeSetting(LANG_KEY, next);
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  for (const listener of listeners) listener();
}

export function useLang(): Lang | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    chosenLang,
    chosenLang,
  );
}

/** Looks up a phrase; `{name}` is replaced and `{one|many}` follows `params.n`. */
export function t(key: TextKey, params: Params = {}, language: Lang = lang()): string {
  const template = tables[language][key] ?? en[key];
  return template
    .replace(/\{([^{}|]*)\|([^{}]*)\}/g, (_, one: string, many: string) =>
      Number(params.n) === 1 ? one : many,
    )
    .replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match,
    );
}

const phraseMaps: Partial<Record<Lang, Map<string, TextKey>>> = {};

/** The key whose fixed text is exactly this sentence, used to find a recorded voice clip. */
export function phraseKey(text: string, language: Lang = lang()): TextKey | undefined {
  let map = phraseMaps[language];
  if (!map) {
    map = new Map();
    for (const [key, value] of Object.entries(tables[language]))
      if (!map.has(value.trim())) map.set(value.trim(), key as TextKey);
    phraseMaps[language] = map;
  }
  return map.get(text.trim());
}

export function speechLang(language: Lang = lang()) {
  return LANGS.find((item) => item.id === language)!.speech;
}
