import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowCounterClockwise, CloudCheck, House, Info } from '@phosphor-icons/react';
import { t } from '../i18n';
import { friendly, type Friendly } from './errors';
import { failure, success } from './feedback';
import { drawTick, emptyRing, shake } from './motion';
import { BigButton, Sheet } from './components';

export type Outcome =
  | { ok: true; sentence: string; savedOnPhone?: boolean }
  | { ok: false; error: unknown; lines?: { label: string; ok: boolean }[] };

export const UNDO_SECONDS = 5;

/**
 * Waits a few seconds before sending, with a big UNDO. Nothing reaches the server (or the
 * audit log) until the time runs out, so UNDO is a true "never happened". Leaving the page
 * sends at once, so work is never silently dropped.
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
  /** After a failure, go back to the scan step with the same cylinders. */
  onFixScan?: () => void;
  seconds?: number;
}) {
  const [phase, setPhase] = useState<'waiting' | 'sending' | 'done' | 'failed'>('waiting');
  const [left, setLeft] = useState(seconds);
  const [result, setResult] = useState<Outcome | null>(null);
  const [details, setDetails] = useState(false);
  const started = useRef(false);
  const undone = useRef(false);
  const ring = useRef<SVGCircleElement>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sendRef = useRef(send);
  sendRef.current = send;

  async function go() {
    if (started.current || undone.current) return;
    started.current = true;
    setPhase('sending');
    let outcome: Outcome;
    try {
      outcome = await sendRef.current();
    } catch (error) {
      outcome = { ok: false, error };
    }
    setResult(outcome);
    setPhase(outcome.ok ? 'done' : 'failed');
  }

  useEffect(() => {
    clearTimeout(flushTimer.current);
    if (started.current || undone.current) return;
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
      clearInterval(tick);
      ringAnimation.pause();
      window.removeEventListener('pagehide', leave);
      // Closing the screen while waiting still sends. A remount (React dev mode) cancels this.
      flushTimer.current = setTimeout(() => void go(), 0);
    };
  }, []);

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
            {t('result.sending')}
          </div>
        )}
        <p className="b-saving-in">{phase === 'waiting' && t('result.saving', { n: left })}</p>
      </div>
    );

  if (result?.ok)
    return (
      <Success
        sentence={result.sentence}
        savedOnPhone={result.savedOnPhone}
        onHome={onHome}
        summary={summary}
      />
    );

  const problem = friendly(result && !result.ok ? result.error : undefined);
  return (
    <Failure
      problem={problem}
      lines={result && !result.ok ? result.lines : undefined}
      details={details}
      setDetails={setDetails}
      onRetry={() => {
        started.current = false;
        void go();
      }}
      onFixScan={onFixScan}
      onHome={onHome}
    />
  );
}

function Success({
  sentence,
  savedOnPhone,
  onHome,
  summary,
}: {
  sentence: string;
  savedOnPhone?: boolean;
  onHome: () => void;
  summary: ReactNode;
}) {
  const circle = useRef<SVGCircleElement>(null);
  const path = useRef<SVGPathElement>(null);
  useEffect(() => {
    drawTick(circle.current, path.current);
    success(savedOnPhone ? `${sentence} ${t('give.savedPhone')}` : sentence);
  }, []);
  return (
    <div className="b-result good" role="status">
      <svg className="b-tick" viewBox="0 0 120 120" aria-hidden="true">
        <circle ref={circle} cx="60" cy="60" r="54" />
        <path ref={path} d="M36 62l16 16 32-34" />
      </svg>
      <div className="b-commit-summary small">{summary}</div>
      <p className="b-result-text">{sentence}</p>
      {savedOnPhone && (
        <p className="b-result-note">
          <CloudCheck size={26} weight="duotone" /> {t('give.savedPhone')}
        </p>
      )}
      <BigButton onClick={onHome} tone="green">
        <House size={30} weight="fill" /> {t('common.home')}
      </BigButton>
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
  const message = lines?.some((line) => line.ok) ? t('back.someFailed') : t(problem.key);
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
      <p className="b-result-text">{message}</p>
      {lines && (
        <ul className="b-lines">
          {lines.map((line) => (
            <li key={line.label} className={line.ok ? 'ok' : 'bad'}>
              <span aria-hidden="true">{line.ok ? '✔' : '✖'}</span> {line.label}
            </li>
          ))}
        </ul>
      )}
      <div className="b-row">
        {problem.kind === 'changed' && onFixScan ? (
          <BigButton onClick={onFixScan} tone="blue">
            <ArrowCounterClockwise size={28} weight="bold" /> {t('common.back')}
          </BigButton>
        ) : (
          <BigButton onClick={onRetry} tone="blue">
            <ArrowCounterClockwise size={28} weight="bold" /> {t('common.retry')}
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
