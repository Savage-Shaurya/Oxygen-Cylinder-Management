import { useState } from 'react';
import { ArrowRight, HandPalm, Truck } from '@phosphor-icons/react';
import { t } from '../../i18n';
import Commit from '../Commit';
import { EmptyState, PersonCard, Screen } from '../components';
import { collectableCustomers, driverVehicle, findByCode } from '../model';
import { PartyIcon } from '../pictures';
import { readSetting, writeSetting } from '../storage';
import { CylinderRow, ScanStep, useFlash, useScanList, type JobProps } from './shared';
import VehicleSheet from './VehicleSheet';

type Step = 'who' | 'scan' | 'commit';

export default function TakeBack({ state, user, run, home, open }: JobProps) {
  const customers = collectableCustomers(state, user);
  const [partyId, setPartyId] = useState(customers.length === 1 ? customers[0].party.id : '');
  const [step, setStep] = useState<Step>(partyId ? 'scan' : 'who');
  const [askVehicle, setAskVehicle] = useState(false);
  const scans = useScanList();
  const flash = useFlash();
  const vehicleKey = `cylvero-vehicle:${user.id}`;

  const chosen = customers.find((item) => item.party.id === partyId);
  const heldIds = chosen?.held.map((c) => c.id) ?? [];
  const scanned = scans.ids.filter((id) => heldIds.includes(id));
  const customer = chosen?.party.name ?? '';
  const sentence = t('take.summary', { n: scanned.length, customer });
  const vehicle = driverVehicle(state, user, partyId) || readSetting(vehicleKey) || '';

  if (!customers.length)
    return (
      <Screen title={t('take.title')} tone="blue" say={t('take.none')} onBack={home}>
        <EmptyState icon={<Truck size={72} weight="duotone" />} text={t('take.none')} />
      </Screen>
    );

  if (step === 'who' || !chosen)
    return (
      <Screen title={t('take.title')} tone="blue" say={t('take.who.say')} onBack={home}>
        <div className="b-list">
          {customers.map(({ party, held }) => (
            <PersonCard
              key={party.id}
              name={party.name}
              party={party}
              label={`${party.name}, ${t('take.has', { n: held.length })}`}
              onClick={() => {
                setPartyId(party.id);
                scans.set([]);
                setStep('scan');
              }}
            >
              {t('take.has', { n: held.length })}
            </PersonCard>
          ))}
        </div>
      </Screen>
    );

  if (step === 'scan')
    return (
      <>
        <ScanStep
          title={customer}
          tone="blue"
          icon={<PartyIcon type={chosen.party.type} />}
          say={t('take.scan.say')}
          onBack={() => (customers.length === 1 ? home() : setStep('who'))}
          count={scanned.length}
          flash={flash.flash}
          options={chosen.held
            .filter((c) => !scans.has(c.id))
            .map((c) => ({ code: c.tag, label: c.tag, note: `${c.size} · ${c.serial}` }))}
          onCode={(code) => {
            const c = findByCode(state.cylinders, code);
            if (c && scans.has(c.id)) return flash.info(t('scan.again'));
            if (!c || !heldIds.includes(c.id)) {
              const sentence = c ? t('take.notHere', { customer }) : t('scan.unknown');
              return flash.bad(
                sentence,
                <span className="b-flash-row">
                  <HandPalm size={28} weight="fill" /> {sentence}
                  <button
                    className="b-flash-action"
                    onClick={() => open('problem', { code: c?.tag ?? code })}
                  >
                    {t('take.report')}
                  </button>
                </span>,
              );
            }
            scans.add(c.id);
            flash.good(<>✔ {c.tag}</>);
          }}
          onDone={() => (vehicle ? setStep('commit') : setAskVehicle(true))}
        />
        {askVehicle && (
          <VehicleSheet
            onClose={() => setAskVehicle(false)}
            onSave={(value) => {
              writeSetting(vehicleKey, value);
              setAskVehicle(false);
              setStep('commit');
            }}
          />
        )}
      </>
    );

  return (
    <Commit
      summary={
        <div className="b-flow">
          <span className="b-flow-end">
            <PartyIcon type={chosen.party.type} size={46} />
            <strong>{customer}</strong>
          </span>
          <ArrowRight size={34} weight="bold" className="b-flow-arrow" />
          <CylinderRow n={scanned.length} look="empty" />
          <Truck size={46} weight="duotone" />
        </div>
      }
      sentence={sentence}
      onUndo={() => setStep('scan')}
      onFixScan={() => setStep('scan')}
      onHome={home}
      send={async () => {
        await run('cylinder.collect', {
          partyId,
          cylinderIds: scanned,
          vehicle,
          driverId: user.id,
          notes: '',
        });
        return { ok: true, sentence };
      }}
    />
  );
}
