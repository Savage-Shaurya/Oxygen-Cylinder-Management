import { useState } from 'react';
import {
  ArrowsDownUp,
  Buildings,
  Drop,
  Hospital,
  PlusCircle,
  Printer,
  Prohibit,
  SealCheck,
  ShieldCheck,
  Truck,
  Warehouse,
  Warning,
} from '@phosphor-icons/react';
import type { AppState } from '../shared/types';
import { Modal } from './components/UI';
import { lifeStory, type LifeStage } from './life-story';

const stageLook: Record<LifeStage, { icon: typeof Truck; label: string }> = {
  registered: { icon: PlusCircle, label: 'Joined' },
  checked: { icon: ShieldCheck, label: 'Checked' },
  filled: { icon: Drop, label: 'Filled' },
  released: { icon: SealCheck, label: 'Released' },
  truck: { icon: Truck, label: 'On truck' },
  customer: { icon: Hospital, label: 'At customer' },
  back: { icon: Warehouse, label: 'Back' },
  supplier: { icon: Buildings, label: 'Supplier' },
  problem: { icon: Warning, label: 'Problem' },
  retired: { icon: Prohibit, label: 'Retired' },
};

// The normal loop a cylinder goes round, shown as a journey strip.
const loop: LifeStage[] = [
  'registered',
  'checked',
  'filled',
  'released',
  'truck',
  'customer',
  'back',
];

const when = (at: string) =>
  new Date(at).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
const day = (at?: string) =>
  at
    ? new Date(at).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      })
    : '—';

/** A cylinder's whole life, start to end, in plain words. */
export default function LifeStory({
  state,
  cylinderId,
  people,
  onClose,
}: {
  state: AppState;
  cylinderId: string;
  people: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [newestFirst, setNewestFirst] = useState(false);
  const { cylinder: c, events, summary } = lifeStory(state, cylinderId, people);
  if (!c)
    return (
      <Modal title="Life story" onClose={onClose}>
        <p className="life-empty">This cylinder is not in your records.</p>
      </Modal>
    );
  const seen = new Set(events.map((e) => e.stage));
  const latest = events.at(-1)?.stage;
  const shown = newestFirst ? [...events].reverse() : events;
  const owner =
    c.ownerId === 'company'
      ? 'Our company'
      : (state.parties.find((p) => p.id === c.ownerId)?.name ?? c.ownerId);

  return (
    <Modal
      title={`Life story · ${c.tag}`}
      subtitle={`Serial ${c.serial} · ${c.gas} · size ${c.size} · ${c.manufacturer} · owner: ${owner}`}
      onClose={onClose}
      width="wide"
    >
      <div className="life">
        <ol className="life-journey" aria-label="Journey">
          {loop.map((stage) => {
            const { icon: Icon, label } = stageLook[stage];
            return (
              <li
                key={stage}
                className={`${seen.has(stage) ? 'done' : ''} ${latest === stage ? 'now' : ''}`}
              >
                <span className={`life-dot stage-${stage}`}>
                  <Icon size={20} weight="duotone" aria-hidden="true" />
                </span>
                <span>{label}</span>
                {latest === stage && <small>Now</small>}
              </li>
            );
          })}
        </ol>

        <div className="life-stats">
          <div>
            <strong>{summary.trips}</strong>
            <span>Deliveries</span>
          </div>
          <div>
            <strong>{summary.customers.length}</strong>
            <span>Customers served</span>
          </div>
          <div>
            <strong>{summary.fills}</strong>
            <span>Times filled</span>
          </div>
          <div>
            <strong>{summary.inspections}</strong>
            <span>Safety checks</span>
          </div>
          {summary.daysWithCustomers > 0 && (
            <div>
              <strong>{summary.daysWithCustomers}</strong>
              <span>Days with customers</span>
            </div>
          )}
          <div>
            <strong className="small">{day(summary.firstSeen)}</strong>
            <span>In service since</span>
          </div>
          <div>
            <strong
              className={`small ${c.testDue < new Date().toISOString().slice(0, 10) ? 'late' : ''}`}
            >
              {day(c.testDue)}
            </strong>
            <span>Next pressure test</span>
          </div>
        </div>

        <div className="life-toolbar">
          <h3>
            {events.length} recorded {events.length === 1 ? 'step' : 'steps'}
          </h3>
          <div>
            <button className="btn button" onClick={() => setNewestFirst(!newestFirst)}>
              <ArrowsDownUp size={16} /> {newestFirst ? 'Oldest first' : 'Newest first'}
            </button>
            <button className="btn button" onClick={() => window.print()}>
              <Printer size={16} /> Print
            </button>
          </div>
        </div>

        {events.length ? (
          <ol className="life-steps">
            {shown.map((event) => {
              const { icon: Icon } = stageLook[event.stage];
              return (
                <li key={event.id}>
                  <time dateTime={event.at}>{when(event.at)}</time>
                  <span className={`life-dot stage-${event.stage}`}>
                    <Icon size={18} weight="duotone" aria-hidden="true" />
                  </span>
                  <div>
                    <strong>{event.title}</strong>
                    <p>{event.detail}</p>
                    {(event.who || event.notes) && (
                      <small>
                        {event.who && <>By {event.who}</>}
                        {event.who && event.notes && ' · '}
                        {event.notes}
                      </small>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="life-empty">Nothing has been recorded for this cylinder yet.</p>
        )}
        <p className="life-foot">
          Built from the permanent movement records. The app never edits or deletes them;
          corrections appear as new steps.
        </p>
      </div>
    </Modal>
  );
}
