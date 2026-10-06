import { useEffect, useState } from 'react';
import { Info, QrCode, Scan } from '@phosphor-icons/react';
import type { Cylinder } from '../../../shared/types';
import { t } from '../../i18n';
import { BigButton, Screen, Sheet } from '../components';
import { scanBeep, scanReject, speak } from '../feedback';
import { basicStatus, findByCode, partyName, placeName, placeText, statusText } from '../model';
import { CylinderPic, lookFor, PlaceIcon } from '../pictures';
import Scanner from '../Scanner';
import type { JobProps } from './shared';

/** "What is this cylinder?" — one scan, one big answer. */
export default function Look({ state, home }: JobProps) {
  const [found, setFound] = useState<Cylinder | null | undefined>(undefined);
  const [info, setInfo] = useState(false);

  if (found === undefined)
    return (
      <Screen
        title={t('look.title')}
        tone="purple"
        icon={<QrCode size={30} weight="duotone" />}
        say={t('look.say')}
        onBack={home}
      >
        <Scanner
          onCode={(code) => {
            const c = findByCode(state.cylinders, code) ?? null;
            if (c) scanBeep();
            else scanReject();
            setFound(c);
          }}
        />
      </Screen>
    );

  return (
    <Screen
      title={t('look.title')}
      tone="purple"
      icon={<QrCode size={30} weight="duotone" />}
      say={t('look.say')}
      sayOnOpen={false}
      onBack={home}
      footer={
        <BigButton onClick={() => setFound(undefined)} tone="purple">
          <Scan size={30} weight="bold" /> {t('look.next')}
        </BigButton>
      }
    >
      {found ? <Answer cylinder={found} state={state} onInfo={() => setInfo(true)} /> : <Unknown />}
      {info && found && (
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
            <dt>{t('info.owner')}</dt>
            <dd>
              {found.ownerId === 'company' ? t('info.company') : partyName(state, found.ownerId)}
            </dd>
          </dl>
        </Sheet>
      )}
    </Screen>
  );
}

function Answer({
  cylinder,
  state,
  onInfo,
}: {
  cylinder: Cylinder;
  state: JobProps['state'];
  onInfo: () => void;
}) {
  const status = basicStatus(state, cylinder);
  const words = t(statusText[status]);
  const where = `${t(placeText[cylinder.custody])}${placeName(state, cylinder) ? `, ${placeName(state, cylinder)}` : ''}`;
  useEffect(() => {
    speak(`${words} ${where}.`);
  }, [cylinder.id]);
  return (
    <div className={`b-answer status-${status}`}>
      <div className="b-answer-band">
        <CylinderPic look={lookFor[status]} size={120} />
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
              {t(cylinder.gas === 'Medical oxygen' ? 'gas.medical' : 'gas.industrial')} ·{' '}
              {cylinder.size}
            </strong>
          </span>
        </div>
      </div>
      <button className="b-link" onClick={onInfo}>
        <Info size={20} /> {t('common.details')}
      </button>
    </div>
  );
}

function Unknown() {
  useEffect(() => {
    speak(t('look.unknown'));
  }, []);
  return (
    <div className="b-answer status-unsure">
      <div className="b-answer-band">
        <CylinderPic look="unknown" size={120} />
        <p className="b-answer-words">{t('look.unknown')}</p>
      </div>
    </div>
  );
}
