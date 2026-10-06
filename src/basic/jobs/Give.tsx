import { useMemo, useState } from 'react';
import {
  ArrowRight,
  DeviceMobile,
  PencilSimple,
  Truck,
  User as UserIcon,
} from '@phosphor-icons/react';
import { ApiError } from '../../api';
import { queueDelivery } from '../../offline';
import { t } from '../../i18n';
import Commit, { type Outcome } from '../Commit';
import { Dots, EmptyState, PersonCard, Screen, Sheet } from '../components';
import { driverOrders, findByCode, partyOf, pendingIds } from '../model';
import { CylinderPic, PartyIcon } from '../pictures';
import { readList, rememberInList } from '../storage';
import { CylinderRow, ScanStep, useFlash, useScanList, WhoCard, type JobProps } from './shared';

type Step = 'who' | 'scan' | 'name' | 'commit';

export default function Give({ state, user, run, home, params }: JobProps) {
  const orders = driverOrders(state, user).filter((o) => pendingIds(o).length > 0);
  const single = orders.length === 1 ? orders[0].id : undefined;
  const [orderId, setOrderId] = useState(params?.orderId ?? single ?? '');
  const [step, setStep] = useState<Step>(orderId ? 'scan' : 'who');
  const [recipient, setRecipient] = useState('');
  const [typing, setTyping] = useState<'new' | 'handover' | null>(null);
  const [typed, setTyped] = useState('');
  const scans = useScanList();
  const flash = useFlash();

  const order = state.orders.find((o) => o.id === orderId);
  const party = order ? partyOf(state, order.partyId) : undefined;
  const remaining = order ? pendingIds(order) : [];
  // After a refresh, keep only cylinders that can still be given.
  // After saving, these cylinders leave the truck, so the result keeps what was sent.
  const [sent, setSent] = useState<string[]>([]);
  const scanned = step === 'commit' ? sent : scans.ids.filter((id) => remaining.includes(id));
  const customer = party?.name ?? '';
  const sentence = t('give.summary', { n: scanned.length, customer });

  const names = useMemo(() => {
    if (!party) return [];
    const saved = readList(`cylvero-recipients:${party.id}`);
    return party.contact && !saved.some((n) => n.toLowerCase() === party.contact.toLowerCase())
      ? [...saved, party.contact]
      : saved;
  }, [party?.id, step]);

  if (!orders.length && step === 'who')
    return (
      <Screen title={t('give.title')} tone="green" say={t('give.none')} onBack={home}>
        <EmptyState icon={<Truck size={72} weight="duotone" />} text={t('give.none')} />
      </Screen>
    );

  if (step === 'who' || !order)
    return (
      <Screen title={t('give.title')} tone="green" say={t('give.who.say')} onBack={home}>
        <div className="b-list">
          {orders.map((o) => {
            const p = partyOf(state, o.partyId);
            const left = pendingIds(o).length;
            return (
              <PersonCard
                key={o.id}
                name={p?.name ?? o.number}
                party={p}
                label={`${p?.name ?? o.number}, ${t('give.left', { n: left })}`}
                onClick={() => {
                  setOrderId(o.id);
                  scans.set([]);
                  setStep('scan');
                }}
              >
                <Dots total={o.cylinderIds.length} filled={o.cylinderIds.length - left} />
                <span>{t('give.left', { n: left })}</span>
              </PersonCard>
            );
          })}
        </div>
      </Screen>
    );

  if (step === 'scan')
    return (
      <ScanStep
        title={t('give.title')}
        tone="green"
        icon={<CylinderPic look="full" size={34} />}
        who={<WhoCard name={customer} party={party} />}
        say={t('give.scan.say')}
        onBack={() => (single && !params?.orderId ? home() : setStep('who'))}
        count={scanned.length}
        total={remaining.length}
        flash={flash.flash}
        options={state.cylinders
          .filter((c) => remaining.includes(c.id) && !scans.has(c.id))
          .map((c) => ({ code: c.tag, label: c.tag, note: `${c.size} · ${c.serial}` }))}
        onCode={(code) => {
          const c = findByCode(state.cylinders, code);
          if (c && scans.has(c.id)) return flash.info(t('scan.again'));
          if (!c) return flash.bad(t('scan.unknown'));
          if (!remaining.includes(c.id)) return flash.bad(t('give.notOnOrder'));
          scans.add(c.id);
          flash.good(<>✔ {c.tag}</>);
        }}
        onDone={() => setStep('name')}
      />
    );

  if (step === 'name')
    return (
      <Screen
        title={t('give.recipient')}
        tone="green"
        icon={<UserIcon size={30} weight="duotone" />}
        say={t('give.recipient.say')}
        onBack={() => setStep('scan')}
      >
        <div className="b-list">
          {names.map((name) => (
            <PersonCard
              key={name}
              name={name}
              onClick={() => {
                setRecipient(name);
                setSent(scanned);
                setStep('commit');
              }}
            />
          ))}
          <button className="b-card b-card-add" onClick={() => setTyping('new')}>
            <span className="b-badge add" aria-hidden="true">
              <PencilSimple size={26} weight="bold" />
            </span>
            <span className="b-card-name">{t('give.newName')}</span>
          </button>
          <button className="b-card b-card-add" onClick={() => setTyping('handover')}>
            <span className="b-badge add" aria-hidden="true">
              <DeviceMobile size={26} weight="bold" />
            </span>
            <span className="b-card-name">{t('give.handPhone')}</span>
          </button>
        </div>
        {typing && (
          <Sheet
            title={typing === 'handover' ? t('give.typeYourName') : t('give.newName')}
            onClose={() => setTyping(null)}
          >
            <form
              className="b-type-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!typed.trim()) return;
                setRecipient(typed.trim());
                setTyped('');
                setTyping(null);
                setSent(scanned);
                setStep('commit');
              }}
            >
              {typing === 'handover' && <p className="b-handover">{t('give.typeYourName')}</p>}
              <label className="b-field">
                <span>{t('give.nameLabel')}</span>
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
          <CylinderRow n={scanned.length} />
          <ArrowRight size={34} weight="bold" className="b-flow-arrow" />
          <span className="b-flow-end">
            <PartyIcon type={party?.type} size={46} />
            <strong>{customer}</strong>
            <small>
              <UserIcon size={18} /> {recipient}
            </small>
          </span>
        </div>
      }
      sentence={sentence}
      onUndo={() => setStep('scan')}
      onHome={home}
      onFixScan={() => setStep('scan')}
      send={async (): Promise<Outcome> => {
        const payload = { orderId: order.id, cylinderIds: scanned, recipient, notes: '' };
        try {
          await run('order.deliver', payload);
          rememberInList(`cylvero-recipients:${order.partyId}`, recipient);
          return { ok: true, sentence };
        } catch (error) {
          if (error instanceof ApiError && error.status === 0) {
            try {
              await queueDelivery(user.id, payload);
              rememberInList(`cylvero-recipients:${order.partyId}`, recipient);
              return { ok: true, sentence, savedOnPhone: true };
            } catch (queueError) {
              return { ok: false, error: queueError };
            }
          }
          return { ok: false, error };
        }
      }}
    />
  );
}
