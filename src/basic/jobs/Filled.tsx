import { useMemo, useState } from 'react';
import { ArrowRight, Drop, Plus } from '@phosphor-icons/react';
import type { Cylinder } from '../../../shared/types';
import { t } from '../../i18n';
import Commit from '../Commit';
import { PersonCard, Screen, Sheet } from '../components';
import { fillProblem, findByCode, gasShort, inAwaitingBatch, inMyBranches } from '../model';
import { readList, rememberInList } from '../storage';
import { CylinderRow, ScanStep, useFlash, useScanList, type JobProps } from './shared';

type Step = 'scan' | 'lot' | 'commit';
const LOTS = 'cylvero-lots';

/** Empties were filled: scan them, pick the gas tank, and they wait for quality release. */
export default function Filled({ state, user, run, home }: JobProps) {
  const [step, setStep] = useState<Step>('scan');
  const [lot, setLot] = useState('');
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const scans = useScanList();
  const flash = useFlash();

  const first = state.cylinders.find((c) => c.id === scans.ids[0]);
  const lots = useMemo(() => readList(LOTS), [step]);
  const sentence = t('fill.summary', { n: scans.ids.length });

  function problem(c: Cylinder, base = first) {
    if (!inMyBranches(user, c.branchId)) return 'fill.why.branch' as const;
    if (inAwaitingBatch(state, c)) return 'fill.why.waiting' as const;
    return fillProblem(state, c, base);
  }

  if (step === 'scan')
    return (
      <ScanStep
        title={t('fill.title')}
        tone="green"
        icon={<Drop size={30} weight="duotone" />}
        say={t('fill.say')}
        onBack={home}
        count={scans.ids.length}
        flash={flash.flash}
        options={state.cylinders
          .filter((c) => !scans.has(c.id) && problem(c) === null)
          .map((c) => ({
            code: c.tag,
            label: c.tag,
            note: `${t(gasShort(c.gas))} · ${c.size} · ${c.serial}`,
          }))}
        onCode={(code) => {
          const c = findByCode(state.cylinders, code);
          if (c && scans.has(c.id)) return flash.info(t('scan.again'));
          if (!c) return flash.bad(t('scan.unknown'));
          const why = problem(c);
          if (why) return flash.bad(t(why));
          scans.add(c.id);
          flash.good(<>✔ {c.tag}</>);
        }}
        onDone={() => setStep('lot')}
      >
        {first && (
          <div className="b-fill-gas">
            <Drop size={26} weight="fill" /> {t(gasShort(first.gas))}
          </div>
        )}
      </ScanStep>
    );

  if (step === 'lot' || !first)
    return (
      <Screen
        title={t('fill.lot')}
        tone="green"
        icon={<Drop size={30} weight="duotone" />}
        say={t('fill.lot.say')}
        onBack={() => setStep('scan')}
      >
        <div className="b-list">
          {lots.map((name) => (
            <PersonCard
              key={name}
              name={name}
              icon={<Drop size={24} weight="duotone" />}
              onClick={() => {
                setLot(name);
                setStep('commit');
              }}
            />
          ))}
          <button className="b-card b-card-add" onClick={() => setTyping(true)}>
            <span className="b-badge add" aria-hidden="true">
              <Plus size={26} weight="bold" />
            </span>
            <span className="b-card-name">{t('fill.newLot')}</span>
          </button>
        </div>
        {typing && (
          <Sheet title={t('fill.newLot')} onClose={() => setTyping(false)}>
            <form
              className="b-type-form"
              onSubmit={(event) => {
                event.preventDefault();
                const clean = typed.replace(/\s+/g, ' ').trim();
                if (!clean) return;
                setLot(clean);
                setTyped('');
                setTyping(false);
                setStep('commit');
              }}
            >
              <label className="b-field">
                <span>{t('fill.lotLabel')}</span>
                <input
                  autoFocus
                  value={typed}
                  maxLength={120}
                  onChange={(event) => setTyped(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <button className="b-big solid tone-green" type="submit" disabled={!typed.trim()}>
                <ArrowRight size={28} weight="bold" /> {t('common.done')}
              </button>
            </form>
          </Sheet>
        )}
      </Screen>
    );

  return (
    <Commit
      summary={
        <div className="b-flow">
          <span className="b-flow-end">
            <Drop size={46} weight="duotone" />
            <strong>{lot}</strong>
          </span>
          <ArrowRight size={34} weight="bold" className="b-flow-arrow" />
          <CylinderRow n={scans.ids.length} look="wait" />
        </div>
      }
      sentence={sentence}
      onUndo={() => setStep('lot')}
      onFixScan={() => setStep('scan')}
      onHome={home}
      send={async () => {
        await run('batch.create', {
          gas: first.gas,
          branchId: first.branchId,
          cylinderIds: scans.ids,
          source: lot,
          operator: user.name.slice(0, 100),
        });
        rememberInList(LOTS, lot);
        return { ok: true, sentence };
      }}
    />
  );
}
