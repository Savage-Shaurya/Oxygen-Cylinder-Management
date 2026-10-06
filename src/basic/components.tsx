import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft, SpeakerHigh, X } from '@phosphor-icons/react';
import type { Party } from '../../shared/types';
import { t } from '../i18n';
import { speak, tap } from './feedback';
import { badgeHue, initials } from './model';
import { popDot, press } from './motion';
import { PartyIcon } from './pictures';

export type Tone = 'green' | 'blue' | 'orange' | 'purple' | 'red' | 'teal';

/** One job step: back arrow, picture title, a speaker that reads the instruction aloud. */
export function Screen({
  title,
  icon,
  tone,
  say,
  onBack,
  children,
  footer,
  sayOnOpen = true,
}: {
  title: string;
  icon?: ReactNode;
  tone: Tone;
  say: string;
  onBack?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  sayOnOpen?: boolean;
}) {
  useEffect(() => {
    if (sayOnOpen) speak(say);
  }, [say, sayOnOpen]);
  return (
    <section className={`b-screen tone-${tone}`} aria-label={title}>
      <div className="b-screen-head">
        {onBack ? (
          <button className="b-round" aria-label={t('common.back')} onClick={onBack}>
            <ArrowLeft size={28} weight="bold" />
          </button>
        ) : (
          <span className="b-round-space" />
        )}
        <h1 className="b-screen-title">
          {icon && <span className="b-screen-icon">{icon}</span>}
          <span>{title}</span>
        </h1>
        <button
          className="b-round b-listen"
          aria-label={t('common.listen')}
          onClick={() => speak(say, true)}
        >
          <SpeakerHigh size={28} weight="fill" />
        </button>
      </div>
      <p className="b-instruction">{say}</p>
      <div className="b-screen-body">{children}</div>
      {footer && <div className="b-screen-foot">{footer}</div>}
    </section>
  );
}

/** Counts shown as dots, so "3 of 5" can be seen without reading. */
export function Dots({
  total,
  filled,
  max = 12,
  label,
}: {
  total: number;
  filled: number;
  max?: number;
  label?: string;
}) {
  const refs = useRef<(HTMLSpanElement | null)[]>([]);
  const last = useRef(filled);
  useLayoutEffect(() => {
    if (filled > last.current) popDot(refs.current[Math.min(filled, max) - 1] ?? null);
    last.current = filled;
  }, [filled, max]);
  const shown = Math.min(total, max);
  return (
    <span
      className="b-dots"
      role="img"
      aria-label={label ?? t('common.ofTotal', { n: filled, total })}
    >
      {Array.from({ length: shown }, (_, i) => (
        <span
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className={`b-dot ${i < filled ? 'on' : ''}`}
        />
      ))}
      {total > max && <span className="b-dots-more">+{total - max}</span>}
    </span>
  );
}

export function Badge({ name, size = 52 }: { name: string; size?: number }) {
  return (
    <span
      className="b-badge"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.48,
        ['--hue' as string]: badgeHue(name),
      }}
    >
      {initials(name)}
    </span>
  );
}

/** A tappable person or customer row with a big letter badge. */
export function PersonCard({
  name,
  party,
  icon,
  children,
  onClick,
  done,
  label,
}: {
  name: string;
  party?: Party;
  icon?: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
  done?: boolean;
  label?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const content = (
    <>
      <Badge name={name} />
      <span className="b-card-main">
        <span className="b-card-name">
          {(icon || party) && (
            <span className="b-card-icon">
              {icon ?? <PartyIcon type={party?.type} size={24} />}
            </span>
          )}
          {name}
        </span>
        {children && <span className="b-card-sub">{children}</span>}
      </span>
    </>
  );
  if (!onClick) return <div className={`b-card ${done ? 'done' : ''}`}>{content}</div>;
  return (
    <button
      ref={ref}
      className={`b-card ${done ? 'done' : ''}`}
      aria-label={label ?? name}
      onClick={() => {
        tap();
        press(ref.current);
        onClick();
      }}
    >
      {content}
    </button>
  );
}

/** A big square picture choice. */
export function ChoiceTile({
  icon,
  label,
  tone,
  onClick,
  disabled,
  wide,
}: {
  icon: ReactNode;
  label: string;
  tone: Tone;
  onClick: () => void;
  disabled?: boolean;
  wide?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      className={`b-choice tone-${tone} ${wide ? 'wide' : ''}`}
      disabled={disabled}
      onClick={() => {
        tap();
        press(ref.current);
        onClick();
      }}
    >
      <span className="b-choice-icon">{icon}</span>
      <span className="b-choice-label">{label}</span>
    </button>
  );
}

export function BigButton({
  children,
  onClick,
  tone = 'green',
  disabled,
  label,
  variant = 'solid',
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: Tone;
  disabled?: boolean;
  label?: string;
  variant?: 'solid' | 'soft';
}) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      className={`b-big ${variant} tone-${tone}`}
      disabled={disabled}
      aria-label={label}
      onClick={() => {
        tap();
        press(ref.current);
        onClick();
      }}
    >
      {children}
    </button>
  );
}

/** A bottom sheet for rare extras (typing a code, details, menu). */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="b-sheet-wrap">
      <button className="b-sheet-backdrop" aria-label={t('common.close')} onClick={onClose} />
      <div className="b-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="b-sheet-head">
          <h2>{title}</h2>
          <button className="b-round" aria-label={t('common.close')} onClick={onClose}>
            <X size={24} weight="bold" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** A large flash under the camera: green for counted, red for refused. */
export function Flash({ tone, children }: { tone: 'good' | 'bad' | 'info'; children: ReactNode }) {
  return (
    <div className={`b-flash ${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

/** A friendly picture for "nothing here". */
export function EmptyState({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="b-empty">
      <span className="b-empty-icon">{icon}</span>
      <p>{text}</p>
    </div>
  );
}
