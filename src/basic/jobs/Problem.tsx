import { useState } from 'react';
import { HandPalm, Question, SealWarning, Tag, Warehouse, Warning } from '@phosphor-icons/react';
import { t } from '../../i18n';
import Commit from '../Commit';
import { BigButton, ChoiceTile, EmptyState, PersonCard, Screen, Sheet } from '../components';
import { scanBeep } from '../feedback';
import { driverBranches, findByCode } from '../model';
import { CylinderPic } from '../pictures';
import Scanner from '../Scanner';
import type { JobProps } from './shared';

type Reason = 'notOurs' | 'noLabel' | 'damaged' | 'other';
type Step = 'scan' | 'what' | 'where' | 'commit';

// Notes stay in English so the office reads the same words whatever the worker's language.
const officeWords: Record<Reason, string> = {
  notOurs: 'not our cylinder',
  noLabel: 'no label',
  damaged: 'damaged',
  other: 'other',
};

/** Report a cylinder that does not belong, has no label or is damaged. */
export default function Problem({ state, user, run, home, params }: JobProps) {
  const branches =
    user.role === 'driver'
      ? driverBranches(state, user)
      : state.branches
          .filter((b) => user.role === 'admin' || user.branchIds.includes(b.id))
          .map((b) => b.id);
  const [code, setCode] = useState(params?.code ?? '');
  const [reason, setReason] = useState<Reason | null>(null);
  const [other, setOther] = useState('');
  const [typing, setTyping] = useState(false);
  const [branchId, setBranchId] = useState('');
  const [step, setStep] = useState<Step>(params?.code ? 'what' : 'scan');

  if (!branches.length)
    return (
      <Screen title={t('problem.title')} tone="red" say={t('problem.noWork')} onBack={home}>
        <EmptyState icon={<HandPalm size={72} weight="duotone" />} text={t('problem.noWork')} />
      </Screen>
    );

  const known = code ? findByCode(state.cylinders, code) : undefined;
  const serial = known?.tag ?? (code || 'NO LABEL');
  const sentence = t('problem.summary');

  function chooseReason(next: Reason) {
    setReason(next);
    const guess =
      known && branches.includes(known.branchId)
        ? known.branchId
        : branches.length === 1
          ? branches[0]
          : '';
    setBranchId(guess);
    setStep(guess ? 'commit' : 'where');
  }

  if (step === 'scan')
    return (
      <Screen
        title={t('problem.title')}
        tone="red"
        icon={<HandPalm size={30} weight="duotone" />}
        say={t('problem.scan.say')}
        onBack={home}
      >
        <Scanner
          onCode={(value) => {
            scanBeep();
            setCode(value);
            setStep('what');
          }}
        />
        <BigButton
          tone="red"
          variant="soft"
          onClick={() => {
            setCode('');
            chooseReason('noLabel');
          }}
        >
          <Tag size={28} weight="bold" /> {t('problem.noLabel')}
        </BigButton>
      </Screen>
    );

  if (step === 'what')
    return (
      <Screen
        title={t('problem.what')}
        tone="red"
        icon={<Warning size={30} weight="duotone" />}
        say={t('problem.what.say')}
        onBack={() => setStep('scan')}
      >
        <div className="b-scanned-code">
          <CylinderPic look="unknown" size={44} /> <strong>{serial}</strong>
        </div>
        <div className="b-choices">
          <ChoiceTile
            tone="red"
            icon={<Question size={52} weight="duotone" />}
            label={t('problem.notOurs')}
            onClick={() => chooseReason('notOurs')}
          />
          <ChoiceTile
            tone="orange"
            icon={<Tag size={52} weight="duotone" />}
            label={t('problem.noLabel')}
            onClick={() => chooseReason('noLabel')}
          />
          <ChoiceTile
            tone="red"
            icon={<SealWarning size={52} weight="duotone" />}
            label={t('problem.damaged')}
            onClick={() => chooseReason('damaged')}
          />
          <ChoiceTile
            tone="purple"
            icon={<Warning size={52} weight="duotone" />}
            label={t('problem.other')}
            onClick={() => setTyping(true)}
          />
        </div>
        {typing && (
          <Sheet title={t('problem.other')} onClose={() => setTyping(false)}>
            <form
              className="b-type-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!other.trim()) return;
                setTyping(false);
                chooseReason('other');
              }}
            >
              <label className="b-field">
                <span>{t('problem.otherLabel')}</span>
                <textarea
                  autoFocus
                  rows={3}
                  maxLength={300}
                  value={other}
                  onChange={(event) => setOther(event.target.value)}
                />
              </label>
              <button className="b-big solid tone-green" type="submit" disabled={!other.trim()}>
                {t('common.done')}
              </button>
            </form>
          </Sheet>
        )}
      </Screen>
    );

  if (step === 'where')
    return (
      <Screen
        title={t('problem.where')}
        tone="red"
        icon={<Warehouse size={30} weight="duotone" />}
        say={t('problem.where.say')}
        onBack={() => setStep('what')}
      >
        <div className="b-list">
          {branches.map((id) => {
            const name = state.branches.find((b) => b.id === id)?.name ?? id;
            return (
              <PersonCard
                key={id}
                name={name}
                icon={<Warehouse size={24} weight="duotone" />}
                onClick={() => {
                  setBranchId(id);
                  setStep('commit');
                }}
              />
            );
          })}
        </div>
      </Screen>
    );

  const notes = `Reported in simple mode: ${officeWords[reason ?? 'other']}${reason === 'other' && other.trim() ? ` — ${other.trim()}` : ''}`;
  return (
    <Commit
      summary={
        <div className="b-flow">
          <CylinderPic look="unknown" size={70} />
          <span className="b-flow-end">
            <HandPalm size={46} weight="duotone" />
            <strong>{serial}</strong>
          </span>
        </div>
      }
      sentence={sentence}
      onUndo={() => setStep('what')}
      onFixScan={() => setStep('scan')}
      onHome={home}
      send={async () => {
        await run('return.discrepancy', {
          branchId,
          serial: serial.slice(0, 80),
          notes: notes.slice(0, 500),
        });
        return { ok: true, sentence };
      }}
    />
  );
}
