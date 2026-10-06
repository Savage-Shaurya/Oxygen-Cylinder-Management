import { useSyncExternalStore } from 'react';
import { speechLang } from '../i18n';
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

function synth(): SpeechSynthesis | undefined {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
    ? window.speechSynthesis
    : undefined;
}

export function stopSpeaking() {
  try {
    synth()?.cancel();
  } catch {
    /* Nothing is speaking. */
  }
}

/** Speaks a sentence in the chosen language. `force` speaks even when auto-voice is off. */
export function speak(sentence: string, force = false) {
  const speech = synth();
  if (!speech || !sentence || (!force && !voiceOn())) return;
  try {
    speech.cancel();
    const utterance = new SpeechSynthesisUtterance(sentence);
    const language = speechLang();
    utterance.lang = language;
    utterance.rate = 0.92;
    const prefix = language.slice(0, 2);
    const voice =
      speech.getVoices().find((v) => v.lang.replace('_', '-') === language) ??
      speech.getVoices().find((v) => v.lang.toLowerCase().startsWith(prefix));
    if (voice) utterance.voice = voice;
    speech.speak(utterance);
  } catch {
    /* Speech is a helper; pictures and words still carry the message. */
  }
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
