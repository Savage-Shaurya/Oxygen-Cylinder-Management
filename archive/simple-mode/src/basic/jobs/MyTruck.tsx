import { useEffect, useRef } from 'react';
import { CaretRight, CheckCircle, Truck } from '@phosphor-icons/react';
import { t } from '../../i18n';
import { Dots, EmptyState, PersonCard, Screen } from '../components';
import { driverPickups, driverWork, partyOf, pendingIds } from '../model';
import { countUp } from '../motion';
import { CylinderPic } from '../pictures';
import type { JobProps } from './shared';

/** Read-only: what is on the driver's truck now, and where to go next. */
export default function MyTruck({ state, user, home, open }: JobProps) {
  const work = driverWork(state, user);
  const fullIds = new Set(work.flatMap((o) => pendingIds(o)));
  const full = state.cylinders.filter((c) => fullIds.has(c.id) && c.custody === 'vehicle').length;
  const empty = driverPickups(state, user).reduce(
    (sum, p) =>
      sum +
      p.cylinderIds.filter((id) => !p.receivedIds.includes(id) && !p.reversedIds?.includes(id))
        .length,
    0,
  );
  const vehicles = [...new Set(work.map((o) => o.vehicle).filter(Boolean))];
  const fullRef = useRef<HTMLElement>(null);
  const emptyRef = useRef<HTMLElement>(null);
  useEffect(() => {
    countUp(fullRef.current, full);
    countUp(emptyRef.current, empty);
  }, [full, empty]);
  const say = full || empty ? t('truck.say', { full, empty }) : t('truck.none');

  return (
    <Screen
      title={t('truck.title')}
      tone="orange"
      icon={<Truck size={30} weight="duotone" />}
      say={say}
      onBack={home}
    >
      {vehicles.length > 0 && (
        <div className="b-plate-show">
          <Truck size={30} weight="fill" /> {vehicles.join(' · ')}
        </div>
      )}
      <div className="b-truck-stock">
        <div className="b-stock full">
          <CylinderPic look="full" size={64} />
          <span className="b-stock-label">{t('truck.full')}</span>
          <strong ref={fullRef}>{full}</strong>
          <Dots total={full} filled={full} />
        </div>
        <div className="b-stock empty">
          <CylinderPic look="empty" size={64} />
          <span className="b-stock-label">{t('truck.empty')}</span>
          <strong ref={emptyRef}>{empty}</strong>
          <Dots total={empty} filled={0} />
        </div>
      </div>
      {work.length ? (
        <>
          <h2 className="b-section">{t('truck.stops')}</h2>
          <div className="b-list">
            {work.map((o) => {
              const party = partyOf(state, o.partyId);
              const left = pendingIds(o).length;
              const done = left === 0;
              return (
                <PersonCard
                  key={o.id}
                  name={party?.name ?? o.number}
                  party={party}
                  done={done}
                  label={`${party?.name ?? o.number}, ${done ? t('truck.stopDone') : t('give.left', { n: left })}`}
                  onClick={done ? undefined : () => open('give', { orderId: o.id })}
                >
                  {done ? (
                    <span className="b-done-mark">
                      <CheckCircle size={22} weight="fill" /> {t('truck.stopDone')}
                    </span>
                  ) : (
                    <>
                      <Dots total={o.cylinderIds.length} filled={o.cylinderIds.length - left} />
                      <span className="b-go">
                        {t('tile.give')} <CaretRight size={18} weight="bold" />
                      </span>
                    </>
                  )}
                </PersonCard>
              );
            })}
          </div>
        </>
      ) : (
        <EmptyState icon={<Truck size={72} weight="duotone" />} text={t('truck.none')} />
      )}
    </Screen>
  );
}
