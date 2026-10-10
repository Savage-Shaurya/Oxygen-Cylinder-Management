import { useRef, useState } from 'react';
import { ArrowRight, Drop, Question, SealCheck, Truck, Warehouse } from '@phosphor-icons/react';
import { t } from '../../i18n';
import Commit, { type Outcome } from '../Commit';
import { ChoiceTile, Dots, PersonCard, Screen } from '../components';
import {
  arrivalGroup,
  canKeepSeal,
  findByCode,
  inMyBranches,
  partyName,
  partyOf,
  type ArrivalGroup,
} from '../model';
import { CylinderPic } from '../pictures';
import { CylinderRow, ScanStep, useFlash, useScanList, type JobProps } from './shared';

type Step = 'scan' | 'seal' | 'state' | 'commit';
type Contents = 'empty' | 'partial' | 'unknown';
type Group = { key: string; kind: ArrivalGroup['kind']; id: string; ids: string[] };
type Part = {
  key: string;
  group: string;
  type: 'cylinder.return' | 'order.unload';
  payload: Record<string, unknown>;
};

// Notes stay in English so the office reads the same words whatever the helper's language.
const contentsWords: Record<Contents, string> = {
  empty: 'all empty',
  partial: 'some gas left',
  unknown: 'not sure if empty',
};

/** Everything that came off a truck, scanned on one screen and sorted by itself. */
export default function CameBack({ state, user, run, home }: JobProps) {
  const [step, setStep] = useState<Step>('scan');
  const [sealOk, setSealOk] = useState(false);
  const [contents, setContents] = useState<Contents>('empty');
  const [parts, setParts] = useState<Part[]>([]);
  const [frozen, setFrozen] = useState<Group[]>([]);
  const scans = useScanList();
  const flash = useFlash();
  const groupOf = useRef<Record<string, ArrivalGroup>>({});
  const sent = useRef(new Set<string>());

  const groups: Group[] = [];
  for (const id of scans.ids) {
    const g = groupOf.current[id];
    if (!g) continue;
    const gid = g.kind === 'customer' ? g.partyId : g.orderId;
    const key = `${g.kind}:${gid}`;
    const found = groups.find((item) => item.key === key);
    if (found) found.ids.push(id);
    else groups.push({ key, kind: g.kind, id: gid, ids: [id] });
  }
  const empties = groups.filter((g) => g.kind === 'customer');
  const fulls = groups.filter((g) => g.kind === 'truck');
  const count = (list: Group[]) => list.reduce((sum, g) => sum + g.ids.length, 0);
  const total = count(groups);

  const nameOf = (g: Group) =>
    g.kind === 'customer'
      ? partyName(state, g.id)
      : partyName(state, state.orders.find((o) => o.id === g.id)?.partyId ?? '');
  const labelOf = (g: Group) =>
    t(g.kind === 'customer' ? 'back.groupEmpty' : 'back.groupFull', {
      customer: nameOf(g),
      n: g.ids.length,
    });

  function eligible(id: string) {
    const c = state.cylinders.find((item) => item.id === id);
    if (!c || !inMyBranches(user, c.branchId)) return null;
    const g = arrivalGroup(state, c);
    if (!g) return null;
    if (g.kind === 'customer' && partyOf(state, g.partyId)?.branchId !== c.branchId) return null;
    return g;
  }

  function build(seal: boolean, kind: Contents) {
    const next: Part[] = [];
    for (const g of groups.filter((item) => item.kind === 'customer')) {
      next.push({
        key: `return:${g.id}`,
        group: g.key,
        type: 'cylinder.return',
        payload: {
          partyId: g.id,
          cylinderIds: g.ids,
          contents: kind,
          receivingBranchId: partyOf(state, g.id)?.branchId,
          notes: `Received by scan in simple mode. Helper said: ${contentsWords[kind]}.`,
        },
      });
    }
    for (const g of groups.filter((item) => item.kind === 'truck')) {
      const keep = seal
        ? g.ids.filter((id) => {
            const c = state.cylinders.find((item) => item.id === id);
            return !!c && canKeepSeal(state, c);
          })
        : [];
      const hold = g.ids.filter((id) => !keep.includes(id));
      if (keep.length)
        next.push({
          key: `unload:${g.id}:keep`,
          group: g.key,
          type: 'order.unload',
          payload: {
            orderId: g.id,
            cylinderIds: keep,
            sealIntact: true,
            notes: 'Unloaded by scan in simple mode. Helper said: seals OK.',
          },
        });
      if (hold.length)
        next.push({
          key: `unload:${g.id}:hold`,
          group: g.key,
          type: 'order.unload',
          payload: {
            orderId: g.id,
            cylinderIds: hold,
            sealIntact: false,
            notes: seal
              ? 'Unloaded by scan in simple mode. Helper said seals OK, but this stock is not safe released stock, so it is held for inspection.'
              : 'Unloaded by scan in simple mode. Helper was not sure about the seals, so it is held for inspection.',
          },
        });
    }
    setParts(next);
    setFrozen(groups.map((g) => ({ ...g, ids: [...g.ids] })));
    setStep('commit');
  }

  function afterSeal(seal: boolean) {
    setSealOk(seal);
    if (empties.length) setStep('state');
    else build(seal, contents);
  }

  const sentence = t('back.summary', { n: step === 'commit' ? count(frozen) : total });

  if (step === 'scan')
    return (
      <ScanStep
        title={t('back.title')}
        tone="blue"
        icon={<Warehouse size={30} weight="duotone" />}
        say={t('back.say')}
        onBack={home}
        count={total}
        flash={flash.flash}
        options={state.cylinders
          .filter((c) => !scans.has(c.id) && eligible(c.id))
          .map((c) => {
            const g = eligible(c.id)!;
            const who =
              g.kind === 'customer'
                ? partyName(state, g.partyId)
                : partyName(state, state.orders.find((o) => o.id === g.orderId)?.partyId ?? '');
            return { code: c.tag, label: c.tag, note: `${c.size} · ${who}` };
          })}
        onCode={(code) => {
          const c = findByCode(state.cylinders, code);
          if (c && scans.has(c.id)) return flash.info(t('scan.again'));
          if (!c) return flash.bad(t('scan.unknown'));
          if (!inMyBranches(user, c.branchId)) return flash.bad(t('load.why.branch'));
          if (c.custody === 'plant') return flash.bad(t('back.inGodown'));
          const g = eligible(c.id);
          if (!g) return flash.bad(t('back.notBack'));
          groupOf.current[c.id] = g;
          scans.add(c.id);
          flash.good(<>✔ {c.tag}</>);
        }}
        onDone={() => {
          if (fulls.length) setStep('seal');
          else if (empties.length) setStep('state');
        }}
      >
        {empties.length > 0 && (
          <>
            <h2 className="b-section b-group-head">
              <CylinderPic look="empty" size={30} /> {t('back.empties')}
            </h2>
            <div className="b-list">
              {empties.map((g) => (
                <GroupCard key={g.key} name={nameOf(g)} group={g} state={state} />
              ))}
            </div>
          </>
        )}
        {fulls.length > 0 && (
          <>
            <h2 className="b-section b-group-head">
              <CylinderPic look="full" size={30} /> {t('back.fulls')}
            </h2>
            <div className="b-list">
              {fulls.map((g) => (
                <GroupCard key={g.key} name={nameOf(g)} group={g} state={state} />
              ))}
            </div>
          </>
        )}
      </ScanStep>
    );

  if (step === 'seal')
    return (
      <Screen
        title={t('back.seal')}
        tone="blue"
        icon={<SealCheck size={30} weight="duotone" />}
        say={t('back.seal.say')}
        onBack={() => setStep('scan')}
      >
        <div className="b-scanned-code">
          <CylinderRow n={count(fulls)} look="full" />
        </div>
        <div className="b-choices">
          <ChoiceTile
            tone="green"
            icon={<SealCheck size={56} weight="fill" />}
            label={t('back.sealOk')}
            onClick={() => afterSeal(true)}
          />
          <ChoiceTile
            tone="red"
            icon={<Question size={56} weight="bold" />}
            label={t('back.sealUnsure')}
            onClick={() => afterSeal(false)}
          />
        </div>
      </Screen>
    );

  if (step === 'state')
    return (
      <Screen
        title={t('back.state')}
        tone="blue"
        icon={<CylinderPic look="empty" size={34} />}
        say={t('back.state.say')}
        onBack={() => setStep(fulls.length ? 'seal' : 'scan')}
      >
        <div className="b-scanned-code">
          <CylinderRow n={count(empties)} look="empty" />
        </div>
        <div className="b-choices">
          <ChoiceTile
            tone="blue"
            icon={<CylinderPic look="empty" size={64} />}
            label={t('back.allEmpty')}
            onClick={() => {
              setContents('empty');
              build(sealOk, 'empty');
            }}
          />
          <ChoiceTile
            tone="orange"
            icon={<Drop size={56} weight="fill" />}
            label={t('back.someGas')}
            onClick={() => {
              setContents('partial');
              build(sealOk, 'partial');
            }}
          />
          <ChoiceTile
            wide
            tone="purple"
            icon={<Question size={52} weight="bold" />}
            label={t('back.notSure')}
            onClick={() => {
              setContents('unknown');
              build(sealOk, 'unknown');
            }}
          />
        </div>
      </Screen>
    );

  const emptyCount = count(frozen.filter((g) => g.kind === 'customer'));
  const fullCount = count(frozen.filter((g) => g.kind === 'truck'));
  return (
    <Commit
      summary={
        <div className="b-flow">
          {emptyCount > 0 && <CylinderRow n={emptyCount} look="empty" />}
          {fullCount > 0 && <CylinderRow n={fullCount} look="full" />}
          <ArrowRight size={34} weight="bold" className="b-flow-arrow" />
          <Warehouse size={52} weight="duotone" />
        </div>
      }
      sentence={sentence}
      onUndo={() => setStep('scan')}
      onFixScan={() => {
        // Keep only cylinders whose send did not go through, then scan again from there.
        const done = new Set(
          parts
            .filter((part) => sent.current.has(part.key))
            .flatMap((part) => part.payload.cylinderIds as string[]),
        );
        sent.current = new Set();
        scans.set(scans.ids.filter((id) => !done.has(id)));
        setStep('scan');
      }}
      onHome={home}
      send={async (): Promise<Outcome> => {
        let firstError: unknown;
        // One after another, so each group gets its own result and its own retry.
        for (const part of parts) {
          if (sent.current.has(part.key)) continue;
          try {
            await run(part.type, part.payload);
            sent.current.add(part.key);
          } catch (error) {
            firstError ??= error;
          }
        }
        if (firstError === undefined) return { ok: true, sentence };
        return {
          ok: false,
          error: firstError,
          lines: frozen.map((g) => ({
            label: labelOf(g),
            ok: parts
              .filter((part) => part.group === g.key)
              .every((part) => sent.current.has(part.key)),
          })),
        };
      }}
    />
  );
}

function GroupCard({
  name,
  group,
  state,
}: {
  name: string;
  group: Group;
  state: JobProps['state'];
}) {
  const party =
    group.kind === 'customer'
      ? partyOf(state, group.id)
      : partyOf(state, state.orders.find((o) => o.id === group.id)?.partyId ?? '');
  const n = group.ids.length;
  return (
    <PersonCard
      name={name}
      party={group.kind === 'customer' ? party : undefined}
      icon={group.kind === 'truck' ? <Truck size={24} weight="duotone" /> : undefined}
    >
      <Dots total={n} filled={group.kind === 'truck' ? n : 0} />
      <strong className="b-qty">{n}</strong>
    </PersonCard>
  );
}
