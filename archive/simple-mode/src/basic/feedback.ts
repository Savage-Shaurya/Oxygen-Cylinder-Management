import { useSyncExternalStore } from 'react';
import { voiceAudio } from '../api';
import { lang, phraseKey, type Lang } from '../i18n';
import { readSetting, writeSetting } from './storage';

// Voice, tones and vibration. Every browser API here is optional: old phones and the
// test runner have none of them, and the app must work silently.

const VOICE_KEY = 'cylvero-voice';
const voiceListeners = new Set<() => void>();

export function voiceOn(): boolean {
  return readSetting(VOICE_KEY) !== 'off';
}

export function setVoiceOn(on: boolean) {
  writeSetting(VOICE_KEY, on ? 'on' : 'off');
  if (!on) stopSpeaking();
  for (const listener of voiceListeners) listener();
}

export function useVoiceOn(): boolean {
  return useSyncExternalStore(
    (listener) => {
      voiceListeners.add(listener);
      return () => voiceListeners.delete(listener);
    },
    voiceOn,
    voiceOn,
  );
}

// Every spoken word is Sarvam AI's voice. Fixed sentences are pre-recorded clips
// (scripts/voice-clips.ts) that also work offline; sentences with names or numbers are
// spoken live by the server's /api/voice. There is no robotic phone voice anywhere: if a
// part cannot be fetched (offline), that part is simply not spoken.
type ClipManifest = Partial<Record<Lang, Record<string, string>>>;
let clips: ClipManifest | null = null;
let clipsLoading: Promise<void> | null = null;

export function loadVoiceClips(): Promise<void> {
  if (clips || typeof fetch !== 'function') return Promise.resolve();
  clipsLoading ??= fetch('/voice/manifest.json')
    .then((response) => (response.ok ? response.json() : null))
    .then((manifest) => {
      if (manifest && typeof manifest === 'object') clips = manifest as ClipManifest;
    })
    .catch(() => undefined)
    .finally(() => {
      clipsLoading = null;
    });
  return clipsLoading;
}

type Segment = { clip: string } | { live: string; language: Lang };

/** Splits a sentence into recorded clips where possible and live Sarvam speech for the rest. */
function segments(sentence: string, language: Lang): Segment[] {
  const table = clips?.[language] ?? {};
  const pieces = sentence
    .trim()
    .split(/(?<=[.?!।])\s+/)
    .filter(Boolean);
  const out: Segment[] = [];
  let pending: string[] = [];
  const flush = () => {
    if (pending.length) out.push({ live: pending.join(' '), language });
    pending = [];
  };
  for (let start = 0; start < pieces.length;) {
    let end = pieces.length;
    let file: string | undefined;
    for (; end > start; end--) {
      const key = phraseKey(pieces.slice(start, end).join(' '), language);
      if (key && table[key]) {
        file = table[key];
        break;
      }
    }
    if (file) {
      flush();
      out.push({ clip: file });
      start = end;
    } else pending.push(pieces[start++]);
  }
  flush();
  return out;
}

const buffers = new Map<string, Promise<AudioBuffer>>();

function bufferFor(ctx: AudioContext, segment: Segment): Promise<AudioBuffer> {
  const key =
    'clip' in segment ? `clip:${segment.clip}` : `live:${segment.language}|${segment.live}`;
  let pending = buffers.get(key);
  if (!pending) {
    pending = (async () => {
      let bytes: ArrayBuffer;
      if ('clip' in segment) {
        const response = await fetch(`/voice/${segment.clip}`);
        if (!response.ok) throw new Error('Voice clip missing');
        bytes = await response.arrayBuffer();
      } else bytes = await voiceAudio(segment.live, segment.language);
      return ctx.decodeAudioData(bytes);
    })();
    buffers.set(key, pending);
    pending.catch(() => buffers.delete(key));
    // Keep memory small on cheap phones: drop the oldest live sentences first.
    for (const old of buffers.keys()) {
      if (buffers.size <= 120) break;
      if (old.startsWith('live:')) buffers.delete(old);
    }
  }
  return pending;
}

let current: AudioBufferSourceNode | undefined;
let queue = 0;

async function running(ctx: AudioContext): Promise<boolean> {
  if (ctx.state === 'running') return true;
  // Before the first tap the browser keeps audio locked; never queue speech for later.
  await Promise.race([ctx.resume().catch(() => undefined), new Promise((r) => setTimeout(r, 300))]);
  return (ctx.state as string) === 'running';
}

async function play(parts: Segment[]) {
  const ctx = context();
  if (!ctx || !parts.length) return;
  const token = ++queue;
  await loadVoiceClips();
  if (token !== queue) return;
  // Fetch every part at once, then play them in order with no gaps.
  const loads = parts.map((part) => bufferFor(ctx, part).catch(() => null));
  for (const load of loads) {
    const buffer = await load;
    if (token !== queue) return;
    if (!buffer) continue;
    if (!(await running(ctx)) || token !== queue) return;
    await new Promise<void>((resolve) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => resolve();
      current = source;
      source.start();
    });
  }
}

export function stopSpeaking() {
  queue++;
  try {
    current?.stop();
  } catch {
    /* Nothing is speaking. */
  }
  current = undefined;
}

/** Speaks a sentence in the chosen language. `force` speaks even when auto-voice is off. */
export function speak(sentence: string, force = false, language: Lang = lang()) {
  if (!sentence || (!force && !voiceOn())) return;
  stopSpeaking();
  void play(segments(sentence, language)).catch(() => undefined);
}

/** Speaks several sentences, each in its own language (used before a language is chosen). */
export function speakEach(parts: [sentence: string, language: Lang][], force = false) {
  if (!parts.length || (!force && !voiceOn())) return;
  stopSpeaking();
  void loadVoiceClips().then(() =>
    play(parts.flatMap(([sentence, language]) => segments(sentence, language))).catch(
      () => undefined,
    ),
  );
}

let audio: AudioContext | undefined;
function context(): AudioContext | undefined {
  try {
    const Ctor =
      typeof window !== 'undefined'
        ? (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined;
    if (!Ctor) return;
    audio ??= new Ctor();
    if (audio.state === 'suspended') void audio.resume();
    return audio;
  } catch {
    return undefined;
  }
}

function tones(notes: [frequency: number, start: number, length: number][], type: OscillatorType) {
  const ctx = context();
  if (!ctx) return;
  try {
    for (const [frequency, start, length] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = frequency;
      const at = ctx.currentTime + start;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + length + 0.02);
    }
  } catch {
    /* Sound is optional. */
  }
}

function vibrate(pattern: number | number[]) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function')
      navigator.vibrate(pattern);
  } catch {
    /* Vibration is optional. */
  }
}

/** One cylinder counted. */
export function scanBeep() {
  tones([[1320, 0, 0.09]], 'sine');
  vibrate(40);
}

/** A scan that cannot be used. */
export function scanReject(sentence?: string) {
  tones(
    [
      [220, 0, 0.16],
      [180, 0.18, 0.2],
    ],
    'square',
  );
  vibrate([90, 70, 90]);
  if (sentence) speak(sentence);
}

export function success(sentence?: string) {
  tones(
    [
      [660, 0, 0.12],
      [880, 0.12, 0.12],
      [1175, 0.24, 0.22],
    ],
    'sine',
  );
  vibrate(60);
  if (sentence) speak(sentence);
}

export function failure(sentence?: string) {
  tones(
    [
      [300, 0, 0.18],
      [200, 0.2, 0.28],
    ],
    'triangle',
  );
  vibrate([120, 80, 120]);
  if (sentence) speak(sentence);
}

/** A soft tap sound for big buttons. */
export function tap() {
  tones([[520, 0, 0.04]], 'sine');
}
