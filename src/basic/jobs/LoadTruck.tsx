import { useState } from 'react';
import { ArrowRight, PencilSimple, Truck, Warehouse, Warning } from '@phosphor-icons/react';
import { t } from '../../i18n';
import Commit from '../Commit';
import { Dots, EmptyState, PersonCard, Screen } from '../components';
import {
  dispatchProblem,
  findByCode,
  gasShort,
  lastVehicleOf,
  loadableOrders,
  partyOf,
} from '../model';
import { readSetting, writeSetting } from '../storage';
import { CylinderRow, ScanStep, useFlash, useScanList, WhoCard, type JobProps } from './shared';
import VehicleSheet from './VehicleSheet';

type Step = 'which' | 'scan' | 'driver' | 'commit';

const vehicleKey = (driverId: string) => `cylvero-driver-vehicle:${driverId}`;

/** Load an open order on a truck: pick the order, scan exactly enough, pick the driver. */
export default function LoadTruck({ state, user, users, run, home }: JobProps) {
  const orders = loadableOrders(state, user);
  const [orderId, setOrderId] = useState('');
  const [step, setStep] = useState<Step>('which');
  const [driverId, setDriverId] = useState('');
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ driverId: string; go: boolean } | null>(null);
  const scans = useScanList();
  const flash = useFlash();

  const order = state.orders.find((o) => o.id === orderId);
  const party = order ? partyOf(state, order.partyId) : undefined;
  const customer = party?.name ?? order?.number ?? '';
  const drivers = order
    ? users.filter((u) => u.role === 'driver' && u.active && u.branchIds.includes(order.branchId))
    : [];
  const vehicleFor = (id: string) =>
    typed[id] || lastVehicleOf(state, id, readSetting(vehicleKey(id)));
  const driver = drivers.find((d) => d.id === driverId);
  const vehicle = driverId ? vehicleFor(driverId) : '';
  const sentence = t('load.summary', { n: scans.ids.length, customer });

  if (!orders.length && step === 'which')
    return (
      <Screen title={t('load.title')} tone="orange" say={t('load.none')} onBack={home}>
        <EmptyState icon={<Warehouse size={72} weight="duotone" />} text={t('load.none')} />
      </Screen>
    );

  if (step === 'which' || !order)
    return (
      <Screen
        title={t('load.title')}
        tone="orange"
        icon={<Truck size={30} weight="duotone" />}
        say={t('load.which.say')}
        onBack={home}
      >
        <div className="b-list">
          {orders.map((o) => {
            const p = partyOf(state, o.partyId);
            const urgent = o.priority === 'urgent';
            const what = `${t(gasShort(o.gas))} ${o.size}`;
            return (
              <PersonCard
                key={o.id}
                name={p?.name ?? o.number}
                party={p}
                label={`${p?.name ?? o.number}, ${what}, ${t('common.cylinders', { n: o.quantity })}${urgent ? `, ${t('load.urgent')}` : ''}`}
                onClick={() => {
                  setOrderId(o.id);
                  scans.set([]);
                  setStep('scan');
                }}
              >
                <span className="b-gas-chip">{what}</span>
                <Dots total={o.quantity} filled={0} />
                <strong className="b-qty">{o.quantity}</strong>
                {urgent && (
                  <span className="b-urgent">
                    <Warning size={18} weight="fill" /> {t('load.urgent')}
                  </span>
                )}
              </PersonCard>
            );
          })}
        </div>
      </Screen>
    );

  if (step === 'scan')
    return (
      <ScanStep
        title={t('load.title')}
        tone="orange"
        icon={<Truck size={30} weight="duotone" />}
        who={<WhoCard name={customer} party={party} />}
        say={t('load.scan.say')}
        onBack={() => setStep('which')}
        count={scans.ids.length}
        total={order.quantity}
        doneReady={scans.ids.length === order.quantity}
        flash={flash.flash}
        options={state.cylinders
          .filter((c) => !scans.has(c.id) && dispatchProblem(state, order, c) === null)
          .map((c) => ({ code: c.tag, label: c.tag, note: `${c.size} · ${c.serial}` }))}
        onCode={(code) => {
          const c = findByCode(state.cylinders, code);
          if (c && scans.has(c.id)) return flash.info(t('scan.again'));
          if (!c) return flash.bad(t('scan.unknown'));
          const problem = dispatchProblem(state, order, c);
          if (problem) return flash.bad(t(problem));
          if (scans.count() >= order.quantity) return flash.bad(t('load.enough'));
          scans.add(c.id);
          flash.good(<>✔ {c.tag}</>);
        }}
        onDone={() => setStep('driver')}
      />
    );

  if (step === 'driver')
    return (
      <Screen
        title={t('load.driver')}
        tone="orange"
        icon={<Truck size={30} weight="duotone" />}
        say={drivers.length ? t('load.driver.say') : t('load.noDrivers')}
        onBack={() => setStep('scan')}
      >
        {drivers.length ? (
          <div className="b-list">
            {drivers.map((d) => {
              const plate = vehicleFor(d.id);
              return (
                <div className="b-driver-row" key={d.id}>
                  <PersonCard
                    name={d.name}
                    label={`${d.name}, ${plate || t('load.vehicleMissing')}`}
                    onClick={() => {
                      setDriverId(d.id);
                      if (plate) setStep('commit');
                      else setEditing({ driverId: d.id, go: true });
                    }}
                  >
                    <span className={`b-plate-chip ${plate ? '' : 'missing'}`}>
                      <Truck size={20} weight="fill" /> {plate || t('load.vehicleMissing')}
                    </span>
                  </PersonCard>
                  <button
                    className="b-change"
                    aria-label={`${t('common.change')} ${d.name}`}
                    onClick={() => setEditing({ driverId: d.id, go: false })}
                  >
                    <PencilSimple size={22} weight="bold" />
                    <span>{t('common.change')}</span>
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={<Truck size={72} weight="duotone" />} text={t('load.noDrivers')} />
        )}
        {editing && (
          <VehicleSheet
            initial={vehicleFor(editing.driverId)}
            onClose={() => setEditing(null)}
            onSave={(value) => {
              setTyped((current) => ({ ...current, [editing.driverId]: value }));
              if (editing.go) {
                setDriverId(editing.driverId);
                setStep('commit');
              }
              setEditing(null);
            }}
          />
        )}
      </Screen>
    );

  return (
    <Commit
      summary={
        <div className="b-flow">
          <CylinderRow n={scans.ids.length} />
          <ArrowRight size={34} weight="bold" className="b-flow-arrow" />
          <span className="b-flow-end">
            <Truck size={46} weight="duotone" />
            <strong>{vehicle}</strong>
            <small>{driver?.name}</small>
          </span>
        </div>
      }
      sentence={sentence}
      onUndo={() => setStep('driver')}
      onFixScan={() => {
        // Keep only cylinders that can still go on this order; pick another order if it left.
        const still = state.orders.find((o) => o.id === order.id);
        if (!still || !orders.some((o) => o.id === order.id)) {
          scans.set([]);
          setStep('which');
          return;
        }
        scans.set(
          scans.ids.filter((id) => {
            const c = state.cylinders.find((x) => x.id === id);
            return !!c && dispatchProblem(state, still, c) === null;
          }),
        );
        setStep('scan');
      }}
      onHome={home}
      send={async () => {
        await run('order.dispatch', {
          orderId: order.id,
          cylinderIds: scans.ids,
          vehicle,
          driverId,
        });
        writeSetting(vehicleKey(driverId), vehicle);
        return { ok: true, sentence };
      }}
    />
  );
}
