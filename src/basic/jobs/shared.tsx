import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckFat } from '@phosphor-icons/react';
import type { ActionResult, AppState, User } from '../../../shared/types';
import { t } from '../../i18n';
import { Badge, BigButton, Dots, Flash, Screen, type Tone } from '../components';
import { scanBeep, scanReject, speak } from '../feedback';
import { CylinderPic, PartyIcon, type CylinderLook } from '../pictures';
import type { Party } from '../../../shared/types';
import Scanner, { type PickOption } from '../Scanner';

export type JobId =
  'give' | 'take' | 'truck' | 'look' | 'problem' | 'back' | 'load' | 'fill' | 'check';

export type JobProps = {
  state: AppState;
  user: User;
  users: User[];
  /** Names of everyone in the organisation, for "who did this". */
  people: { id: string; name: string }[];
  run: (type: string, payload: Record<string, unknown>) => Promise<ActionResult>;
  home: () => void;
  open: (job: JobId, params?: Record<string, string>) => void;
  params?: Record<string, string>;
};

/** The list of scanned cylinder ids, kept in a ref so quick scans never read stale state. */
export function useScanList(initial: string[] = []) {
  const ref = useRef<string[]>(initial);
  const [ids, setIds] = useState<string[]>(initial);
  return {
    ids,
    has: (id: string) => ref.current.includes(id),
    add(id: string) {
      ref.current = [...ref.current, id];
      setIds(ref.current);
    },
    set(next: string[]) {
      ref.current = next;
      setIds(next);
    },
    count: () => ref.current.length,
  };
}

type FlashState = { tone: 'good' | 'bad' | 'info'; text: ReactNode; key: number } | null;

/** A short message under the camera, with sound and vibration. */
export function useFlash() {
  const [flash, setFlash] = useState<FlashState>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  function show(tone: 'good' | 'bad' | 'info', text: ReactNode, ms = 2600) {
    clearTimeout(timer.current);
    setFlash({ tone, text, key: Date.now() });
    timer.current = setTimeout(() => setFlash(null), ms);
  }
  return {
    flash,
    good(text: ReactNode) {
      scanBeep();
      show('good', text, 1400);
    },
    bad(sentence: string, extra?: ReactNode) {
      scanReject(sentence);
      show('bad', extra ?? sentence, 3600);
    },
    info(sentence: string) {
      speak(sentence);
      show('info', sentence);
    },
    clear() {
      setFlash(null);
    },
  };
}

/** The camera step every job shares: scan, see the count grow, then tap Done. */
export function ScanStep({
  title,
  tone,
  icon,
  say,
  onBack,
  onCode,
  options,
  count,
  total,
  flash,
  children,
  onDone,
  doneReady,
  doneLabel,
  who,
}: {
  title: string;
  tone: Tone;
  icon: ReactNode;
  say: string;
  onBack: () => void;
  onCode: (code: string) => void;
  options?: PickOption[];
  count: number;
  total?: number;
  flash: FlashState;
  children?: ReactNode;
  onDone: () => void;
  doneReady?: boolean;
  doneLabel?: string;
  /** Who this scan is for, shown as a card under the title. */
  who?: ReactNode;
}) {
  const ready = doneReady ?? count > 0;
  return (
    <Screen
      title={title}
      tone={tone}
      icon={icon}
      say={say}
      onBack={onBack}
      footer={
        ready ? (
          <BigButton
            onClick={onDone}
            tone="green"
            label={doneLabel ?? `${t('common.done')} ${count}`}
          >
            <CheckFat size={30} weight="fill" /> {t('common.done')}
            <span className="b-count-pill">{count}</span>
          </BigButton>
        ) : undefined
      }
    >
      {who}
      <Scanner onCode={onCode} options={options} />
      <div className="b-tally" aria-live="polite">
        <span className="b-tally-number">
          {count}
          {total !== undefined && <small> / {total}</small>}
        </span>
        {total !== undefined && total > 0 && <Dots total={total} filled={count} />}
      </div>
      {flash && (
        <Flash key={flash.key} tone={flash.tone}>
          {flash.text}
        </Flash>
      )}
      {children}
    </Screen>
  );
}

/** A row of little cylinder pictures standing for a count. */
export function CylinderRow({ n, look = 'full' }: { n: number; look?: CylinderLook }) {
  const shown = Math.min(n, 5);
  return (
    <span className="b-cyl-row" role="img" aria-label={t('common.cylinders', { n })}>
      {Array.from({ length: shown }, (_, i) => (
        <CylinderPic key={i} look={look} size={46} />
      ))}
      {n > shown && <span className="b-cyl-more">+{n - shown}</span>}
      <span className="b-cyl-count">×{n}</span>
    </span>
  );
}

/** The customer a scan is for: letter badge, picture and full name. */
export function WhoCard({ name, party }: { name: string; party?: Party }) {
  return (
    <div className="b-who">
      <Badge name={name} size={44} />
      <span className="b-who-icon">
        <PartyIcon type={party?.type} size={26} />
      </span>
      <span>{name}</span>
    </div>
  );
}
