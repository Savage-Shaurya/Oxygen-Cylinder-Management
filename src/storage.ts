// Per-phone conveniences only (language, voice, remembered names). Never business records.
const memory = new Map<string, string>();

function store(): Storage | undefined {
  try {
    return globalThis.localStorage ?? globalThis.window?.localStorage;
  } catch {
    return undefined;
  }
}

export function readSetting(key: string): string | null {
  try {
    const value = store()?.getItem(key);
    if (value !== null && value !== undefined) return value;
  } catch {
    /* Private browsing or blocked storage falls back to memory. */
  }
  return memory.get(key) ?? null;
}

export function writeSetting(key: string, value: string | null) {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  try {
    if (value === null) store()?.removeItem(key);
    else store()?.setItem(key, value);
  } catch {
    /* Memory copy keeps the choice for this visit. */
  }
}

export function readList(key: string): string[] {
  try {
    const value = JSON.parse(readSetting(key) || '[]');
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/** Puts a value first, without duplicates, keeping the list short. */
export function rememberInList(key: string, value: string, limit = 6) {
  const clean = value.trim();
  if (!clean) return;
  const next = [
    clean,
    ...readList(key).filter((item) => item.toLowerCase() !== clean.toLowerCase()),
  ];
  writeSetting(key, JSON.stringify(next.slice(0, limit)));
}
