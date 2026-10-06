import { useEffect, useState } from 'react';
import { CheckCircle, HandPalm, Info, Scan, SealCheck } from '@phosphor-icons/react';
import type { Cylinder } from '../../../shared/types';
import { t } from '../../i18n';
import Commit from '../Commit';
import { BigButton, ChoiceTile, Flash, Screen, Sheet } from '../components';
import { speak } from '../feedback';
import {
  basicStatus,
  checkBlocks,
  findByCode,
  gasShort,
  inMyBranches,
  placeName,
  placeText,
  statusText,
} from '../model';
import { CylinderPic, lookFor, PlaceIcon } from '../pictures';
import Scanner from '../Scanner';
import { useFlash, type JobProps } from './shared';

type Step = 'scan' | 'look' | 'commit';
type Verdict = 'good' | 'hold';

// Notes stay in English so the office reads the same words whatever the checker's language.
const officeWords: Record<Verdict, string> = {
  good: 'Checked in simple mode: looks good, marked serviceable.',
  hold: 'Checked in simple mode: put on hold for the office to inspect.',
};

/** Quality check: scan one cylinder, look at it, then Good or Hold. */
export default function Check({ state, user, run, home }: JobProps) {
  const [step, setStep] = useState<Step>('scan');
  const [cylinderId, setCylinderId] = useState('');
  const [verdict, setVerdict] = useState<Verdict>('good');
  const [finished, setFinished] = useState(false);
  const [info, setInfo] = useState(false);
  const flash = useFlash();
  const found = state.cylinders.find((c) => c.id === cylinderId);

  function next() {
    setCylinderId('');
    setFinished(false);
    setStep('scan');
  }

  if (step === 'scan' || !found)
    return (
      <Screen
        title={t('check.title')}
        tone="teal"
        icon={<SealCheck size={30} weight="duotone" />}
        say={t('check.say')}
        onBack={home}
      >
        <Scanner
          options={state.cylinders
            .filter(
              (c) =>
                c.custody === 'plant' &&
                c.ownerId === 'company' &&
                c.condition !== 'retired' &&
                inMyBranches(user, c.branchId),
            )
            .map((c) => ({ code: c.tag, label: c.tag, note: `${c.size} · ${c.serial}` }))}
          onCode={(code) => {
            const c = findByCode(state.cylinders, code);
            if (!c) return flash.bad(t('scan.unknown'));
            // Other companies' cylinders are checked in the office, with the owner's permission.
            if (c.ownerId !== 'company') return flash.bad(t('check.owner'));
            flash.good(<>✔ {c.tag}</>);
            setCylinderId(c.id);
            setStep('look');
          }}
        />
        {flash.flash && (
          <Flash key={flash.flash.key} tone={flash.flash.tone}>
            {flash.flash.text}
          </Flash>
        )}
      </Screen>
    );

  const sentence = t(verdict === 'good' ? 'check.summaryGood' : 'check.summaryHold');

  if (step === 'look')
    return (
      <Screen
        title={t('check.question')}
        tone="teal"
        icon={<SealCheck size={30} weight="duotone" />}
        say={t('check.question')}
        sayOnOpen={false}
        onBack={next}
        footer={
          <BigButton onClick={next} tone="teal" variant="soft">
            <Scan size={28} weight="bold" /> {t('check.next')}
          </BigButton>
        }
      >
        <CheckCard
          cylinder={found}
          state={state}
          onInfo={() => setInfo(true)}
          onChoose={(choice) => {
            setVerdict(choice);
            setStep('commit');
          }}
        />
        {info && (
          <Sheet title={t('common.details')} onClose={() => setInfo(false)}>
            <dl className="b-info">
              <dt>{t('info.tag')}</dt>
              <dd>{found.tag}</dd>
              <dt>{t('info.serial')}</dt>
              <dd>{found.serial}</dd>
              <dt>{t('info.size')}</dt>
              <dd>{found.size}</dd>
              <dt>{t('info.testDue')}</dt>
              <dd>{found.testDue}</dd>
            </dl>
          </Sheet>
        )}
      </Screen>
    );

  return (
    <div className="b-check-commit">
      <Commit
        summary={
          <div className="b-flow">
            <CylinderPic look={verdict === 'good' ? 'full' : 'hold'} size={70} />
            <span className="b-flow-end">
              {verdict === 'good' ? (
                <CheckCircle size={46} weight="fill" />
              ) : (
                <HandPalm size={46} weight="fill" />
              )}
              <strong>{found.tag}</strong>
            </span>
          </div>
        }
        sentence={sentence}
        onUndo={() => setStep('look')}
        onFixScan={next}
        onHome={home}
        send={async () => {
          try {
            await run('cylinder.inspect', {
              cylinderId: found.id,
              version: found.version,
              condition: verdict === 'good' ? 'serviceable' : 'quarantine',
              notes: officeWords[verdict],
            });
            return { ok: true, sentence };
          } finally {
            setFinished(true);
          }
        }}
      />
      {finished && (
        <BigButton onClick={next} tone="teal">
          <Scan size={30} weight="bold" /> {t('check.next')}
        </BigButton>
      )}
    </div>
  );
}

function CheckCard({
  cylinder,
  state,
  onInfo,
  onChoose,
}: {
  cylinder: Cylinder;
  state: JobProps['state'];
  onInfo: () => void;
  onChoose: (verdict: Verdict) => void;
}) {
  const status = basicStatus(state, cylinder);
  const words = t(statusText[status]);
  const place = placeName(state, cylinder);
  const where = `${t(placeText[cylinder.custody])}${place ? `, ${place}` : ''}`;
  const blocks = checkBlocks(state, cylinder);
  const reason = blocks.hold ?? blocks.good;
  useEffect(() => {
    speak([words, reason ? t(reason) : t('check.question')].join(' '));
  }, [cylinder.id, reason]);
  return (
    <>
      <div className={`b-answer status-${status}`}>
        <div className="b-answer-band">
          <CylinderPic look={lookFor[status]} size={110} />
          <p className="b-answer-words">{words}</p>
        </div>
        <div className="b-answer-facts">
          <div>
            <span className="b-fact-icon">
              <PlaceIcon custody={cylinder.custody} size={34} />
            </span>
            <span>
              <small>{t('look.where')}</small>
              <strong>{where}</strong>
            </span>
          </div>
          <div>
            <span className="b-fact-icon gas">O₂</span>
            <span>
              <small>{t('look.gas')}</small>
              <strong>
                {t(gasShort(cylinder.gas))} · {cylinder.size}
              </strong>
            </span>
          </div>
        </div>
        <button className="b-link" onClick={onInfo}>
          <Info size={20} /> {t('common.details')}
        </button>
      </div>
      {reason && (
        <Flash tone="bad">
          <span className="b-flash-row">
            <HandPalm size={28} weight="fill" /> {t(reason)}
          </span>
        </Flash>
      )}
      <div className="b-choices">
        <ChoiceTile
          tone="green"
          icon={<CheckCircle size={56} weight="fill" />}
          label={t('check.good')}
          disabled={!!blocks.good}
          onClick={() => onChoose('good')}
        />
        <ChoiceTile
          tone="red"
          icon={<HandPalm size={56} weight="fill" />}
          label={t('check.hold')}
          disabled={!!blocks.hold}
          onClick={() => onChoose('hold')}
        />
      </div>
    </>
  );
}
