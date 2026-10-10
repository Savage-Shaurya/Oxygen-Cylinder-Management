import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowCounterClockwise,
  ArrowsClockwise,
  CloudCheck,
  House,
  Info,
  Scan,
} from '@phosphor-icons/react';
import { isUncertain } from '../api';
import { t } from '../i18n';
import { friendly, type Friendly } from './errors';
import { failure, speak, success } from './feedback';
import { drawTick, emptyRing, shake } from './motion';
import { BigButton, Sheet } from './components';

/**
 * What a send produced. Only `ok: true` means the server acknowledged it. A failure whose
 * error is uncertain (connection lost) may still have saved; `queued` says the same command
 * is kept on this phone to be checked later.
 */
export type Outcome =
  | { ok: true; sentence: string }
  | {
      ok: false;
      error: unknown;
      lines?: { label: string; ok: boolean }[];
      queued?: boolean;
    };

export const UNDO_SECONDS = 5;
const AUTO_CHECKS = 3;
const AUTO_CHECK_MS = 6000;

/** A result that arrived after its screen was closed, shown by Simple mode as a toast. */
export type BackgroundResult = { kind: 'saved' | 'unsure' | 'failed'; text: string };
const backgroundListeners = new Set<(result: BackgroundResult) => void>();
export function onBackgroundResult(listener: (result: BackgroundResult) => void) {
  backgroundListeners.add(listener);
  return () => {
    backgroundListeners.delete(listener);
  };
}

// Sends that are still in their undo wait, so sign-out or a mode switch can send them first.
const waitingSends = new Set<() => Promise<Outcome | null>>();
/** Sends every waiting action now; true when each one was acknowledged by the server. */
export async function flushWaitingCommits(): Promise<boolean> {
  const outcomes = await Promise.all([...waitingSends].map((send) => send()));
  return outcomes.every((outcome) => !outcome || outcome.ok);
}

const uncertain = (outcome: Outcome | null) =>
  !!outcome && !outcome.ok && isUncertain(outcome.error);

/**
 * Waits a few seconds before sending, with a big UNDO. Nothing reaches the server (or the
 * audit log) until the time runs out, so UNDO is a true "never happened". Leaving the screen
 * sends at once, so work is never silently dropped; the screen says so, and the result of an
 * early send is reported on the next screen.
 */
export default function Commit({
  summary,
  sentence,
  send,
  onUndo,
  onHome,
  onFixScan,
  seconds = UNDO_SECONDS,
}: {
  summary: ReactNode;
  sentence: string;
  send: () => Promise<Outcome>;
  onUndo: () => void;
  onHome: () => void;
  /** After a failure, go back to the scan step keeping the cylinders that are still valid. */
  onFixScan?: () => void;
  seconds?: number;
}) {
  const [phase, setPhase] = useState<'waiting' | 'sending' | 'done' | 'failed' | 'unsure'>(
    'waiting',
  );
  const [checking, setChecking] = useState(false);
  const [left, setLeft] = useState(seconds);
  const [result, setResult] = useState<Outcome | null>(null);
  const [details, setDetails] = useState(false);
  const running = useRef<Promise<Outcome> | null>(null);
  const undone = useRef(false);
  // True until the first send starts; only a still-waiting action is sent on leaving.
  const waiting = useRef(true);
  const mounted = useRef(true);
  const autoChecks = useRef(0);
  const ring = useRef<SVGCircleElement>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sendRef = useRef(send);
  sendRef.current = send;
  const sentenceRef = useRef(sentence);
  sentenceRef.current = sentence;

  function go(): Promise<Outcome> | null {
    if (undone.current) return null;
    if (running.current) return running.current;
    waiting.current = false;
    waitingSends.delete(flushNow);
    if (mounted.current) setPhase('sending');
    running.current = (async () => {
      let outcome: Outcome;
      try {
        outcome = await sendRef.current();
      } catch (error) {
        outcome = { ok: false, error };
      }
      running.current = null;
      if (mounted.current) {
        setChecking(false);
        setResult(outcome);
        setPhase(outcome.ok ? 'done' : uncertain(outcome) ? 'unsure' : 'failed');
      } else report(outcome, sentenceRef.current);
      return outcome;
    })();
    return running.current;
  }
  const flushNow = () => (waiting.current ? go() : running.current) ?? Promise.resolve(null);

  function check() {
    if (running.current) return;
    setChecking(true);
    void go();
  }

  useEffect(() => {
    mounted.current = true;
    clearTimeout(flushTimer.current);
    if (!waiting.current || undone.current) return;
    waitingSends.add(flushNow);
    const ends = Date.now() + seconds * 1000;
    const ringAnimation = emptyRing(ring.current, seconds * 1000);
    const tick = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((ends - Date.now()) / 1000));
      setLeft(remaining);
      if (remaining <= 0) {
        clearInterval(tick);
        void go();
      }
    }, 200);
    const leave = () => void go();
    window.addEventListener('pagehide', leave);
    return () => {
      mounted.current = false;
      clearInterval(tick);
      ringAnimation.pause();
      window.removeEventListener('pagehide', leave);
      // Closing the screen while waiting sends it now, and the result is reported as a toast.
      // A remount (React dev mode) cancels this.
      flushTimer.current = setTimeout(() => {
        waitingSends.delete(flushNow);
        if (waiting.current) void go();
      }, 0);
    };
  }, []);

  // While unsure, check again with the same command a few times and when the network returns.
  useEffect(() => {
    if (phase !== 'unsure') return;
    const again = () => {
      if (autoChecks.current >= AUTO_CHECKS) return;
      autoChecks.current++;
      check();
    };
    const timer = setTimeout(again, AUTO_CHECK_MS);
    window.addEventListener('online', again);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('online', again);
    };
  }, [phase, result]);

  if (phase === 'waiting' || phase === 'sending')
    return (
      <div className="b-commit" role="status" aria-live="polite">
        <div className="b-commit-summary">{summary}</div>
        <p className="b-commit-sentence">{sentence}</p>
        {phase === 'waiting' ? (
          <button
            className="b-undo"
            onClick={() => {
              undone.current = true;
              waitingSends.delete(flushNow);
              onUndo();
            }}
          >
            <span className="b-undo-ring" aria-hidden="true">
              <svg viewBox="0 0 64 64">
                <circle cx="32" cy="32" r="27" className="track" />
                <circle cx="32" cy="32" r="27" className="bar" ref={ring} />
              </svg>
              <strong>{left}</strong>
            </span>
            <span className="b-undo-text">
              <ArrowCounterClockwise size={30} weight="bold" />
              {t('common.undo')}
            </span>
          </button>
        ) : (
          <div className="b-sending">
            <span className="b-spinner" aria-hidden="true" />
            {t(checking ? 'result.checking' : 'result.sending')}
          </div>
        )}
        <p className="b-saving-in">{phase === 'waiting' && t('result.saving', { n: left })}</p>
        {phase === 'waiting' && <p className="b-saving-in">{t('result.leaveSends')}</p>}
      </div>
    );

  if (result?.ok) return <Success sentence={result.sentence} onHome={onHome} summary={summary} />;

  const lines = result && !result.ok ? result.lines : undefined;
  if (phase === 'unsure')
    return (
      <Unsure
        queued={!!(result && !result.ok && result.queued)}
        lines={lines}
        onCheck={check}
        onHome={onHome}
      />
    );

  const problem = friendly(result && !result.ok ? result.error : undefined);
  return (
    <Failure
      problem={problem}
      lines={lines}
      details={details}
      setDetails={setDetails}
      onRetry={() => void go()}
      onFixScan={onFixScan}
      onHome={onHome}
    />
  );
}

/** Tells Simple mode what happened to a send whose screen had already closed. */
function report(outcome: Outcome, sentence: string) {
  let note: BackgroundResult;
  if (outcome.ok) note = { kind: 'saved', text: t('result.leftSaved', { sentence }) };
  else if (uncertain(outcome))
    note = {
      kind: 'unsure',
      text: t(outcome.queued ? 'result.leftUnsureQueued' : 'result.leftUnsure'),
    };
  else
    note = {
      kind: 'failed',
      text: t('result.leftFailed', { reason: t(friendly(outcome.error).key) }),
    };
  for (const listener of backgroundListeners) listener(note);
}

/** Moves keyboard and screen-reader focus to a result heading when it appears. */
function useFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

function Success({
  sentence,
  onHome,
  summary,
}: {
  sentence: string;
  onHome: () => void;
  summary: ReactNode;
}) {
  const circle = useRef<SVGCircleElement>(null);
  const path = useRef<SVGPathElement>(null);
  const heading = useFocus<HTMLHeadingElement>();
  useEffect(() => {
    drawTick(circle.current, path.current);
    success(sentence);
  }, []);
  return (
    <div className="b-result good" role="status">
      <svg className="b-tick" viewBox="0 0 120 120" aria-hidden="true">
        <circle ref={circle} cx="60" cy="60" r="54" />
        <path ref={path} d="M36 62l16 16 32-34" />
      </svg>
      <div className="b-commit-summary small">{summary}</div>
      <h2 className="b-result-text" tabIndex={-1} ref={heading}>
        {sentence}
      </h2>
      <BigButton onClick={onHome} tone="green">
        <House size={30} weight="fill" /> {t('common.home')}
      </BigButton>
    </div>
  );
}

function Lines({ lines, unsure }: { lines: { label: string; ok: boolean }[]; unsure?: boolean }) {
  return (
    <ul className="b-lines">
      {lines.map((line) => (
        <li key={line.label} className={line.ok ? 'ok' : unsure ? 'unsure' : 'bad'}>
          <span aria-hidden="true">{line.ok ? '✔' : unsure ? '?' : '✖'}</span> {line.label}
        </li>
      ))}
    </ul>
  );
}

/** The connection dropped after sending: it may or may not be saved. Never green, never red. */
function Unsure({
  queued,
  lines,
  onCheck,
  onHome,
}: {
  queued: boolean;
  lines?: { label: string; ok: boolean }[];
  onCheck: () => void;
  onHome: () => void;
}) {
  const heading = useFocus<HTMLHeadingElement>();
  useEffect(() => {
    speak(t('result.unsure'));
  }, []);
  return (
    <div className="b-result unsure" role="status" aria-live="polite">
      <ArrowsClockwise className="b-unsure-icon" size={96} weight="bold" aria-hidden="true" />
      <h2 className="b-result-text" tabIndex={-1} ref={heading}>
        {t('result.unsure')}
      </h2>
      <p className="b-result-note">
        {queued && <CloudCheck size={26} weight="duotone" aria-hidden="true" />}
        {t(queued ? 'result.unsureQueued' : 'result.unsureStay')}
      </p>
      {lines && <Lines lines={lines} unsure />}
      <div className="b-row">
        <BigButton onClick={onCheck} tone="blue">
          <ArrowsClockwise size={28} weight="bold" /> {t('result.checkNow')}
        </BigButton>
        <BigButton onClick={onHome} tone="teal" variant="soft">
          <House size={28} weight="fill" /> {t('common.home')}
        </BigButton>
      </div>
    </div>
  );
}

function Failure({
  problem,
  lines,
  details,
  setDetails,
  onRetry,
  onFixScan,
  onHome,
}: {
  problem: Friendly;
  lines?: { label: string; ok: boolean }[];
  details: boolean;
  setDetails: (open: boolean) => void;
  onRetry: () => void;
  onFixScan?: () => void;
  onHome: () => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const heading = useFocus<HTMLHeadingElement>();
  const message = lines?.some((line) => line.ok) ? t('back.someFailed') : t(problem.key);
  // When the records changed or the role cannot do it, sending the same thing again cannot work.
  const retryHelps = problem.kind !== 'changed' && problem.kind !== 'notAllowed';
  useEffect(() => {
    shake(card.current);
    failure(message);
  }, []);
  return (
    <div className="b-result bad" role="alert" ref={card}>
      <svg className="b-cross" viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="54" />
        <path d="M40 40l40 40M80 40L40 80" />
      </svg>
      <h2 className="b-result-text" tabIndex={-1} ref={heading}>
        {message}
      </h2>
      {lines && <Lines lines={lines} />}
      <div className="b-row">
        {retryHelps && (
          <BigButton onClick={onRetry} tone="blue">
            <ArrowCounterClockwise size={28} weight="bold" /> {t('common.retry')}
          </BigButton>
        )}
        {onFixScan && (
          <BigButton onClick={onFixScan} tone="blue" variant={retryHelps ? 'soft' : undefined}>
            <Scan size={28} weight="bold" /> {t('result.backToScan')}
          </BigButton>
        )}
        <BigButton onClick={onHome} tone="teal" variant="soft">
          <House size={28} weight="fill" /> {t('common.home')}
        </BigButton>
      </div>
      <button className="b-link" onClick={() => setDetails(true)}>
        <Info size={20} /> {t('common.details')}
      </button>
      {details && (
        <Sheet title={t('common.details')} onClose={() => setDetails(false)}>
          <p className="b-detail-text">{problem.detail}</p>
        </Sheet>
      )}
    </div>
  );
}
