import type { AppState, Cylinder, Movement } from '../shared/types';

// Turns a cylinder's movement records (and its batch decisions, which are stored on the batch)
// into a plain-language life story, oldest first. Read-only: it only explains what the server
// already recorded.

export type LifeStage =
  | 'registered'
  | 'checked'
  | 'filled'
  | 'released'
  | 'truck'
  | 'customer'
  | 'back'
  | 'supplier'
  | 'problem'
  | 'retired';

export interface LifeEvent {
  id: string;
  at: string;
  stage: LifeStage;
  title: string;
  detail: string;
  who: string;
  notes: string;
}

export interface LifeSummary {
  trips: number;
  customers: string[];
  fills: number;
  inspections: number;
  daysWithCustomers: number;
  firstSeen?: string;
}

type People = { id: string; name: string }[];

const partyName = (s: AppState, id: string) =>
  id === 'company' ? 'our company' : (s.parties.find((p) => p.id === id)?.name ?? 'a customer');
const branchName = (s: AppState, id: string) => s.branches.find((b) => b.id === id)?.name ?? id;
const personName = (people: People, id: string) => people.find((p) => p.id === id)?.name ?? '';

function placeName(s: AppState, token: string): string {
  const [kind, id = ''] = token.split(/:(.*)/s);
  if (kind === 'plant') return branchName(s, id);
  if (kind === 'customer' || kind === 'supplier') return partyName(s, id);
  if (kind === 'vehicle') {
    const order = s.orders.find((o) => o.id === id);
    if (order) return `truck ${order.vehicle || ''}`.trim();
    const pickup = s.pickups?.find((p) => p.id === id);
    return pickup ? `truck ${pickup.vehicle}`.trim() : 'a truck';
  }
  return token === 'new' ? 'nowhere yet' : token;
}

function describe(
  s: AppState,
  people: People,
  c: Cylinder,
  m: Movement,
): Pick<LifeEvent, 'stage' | 'title' | 'detail'> {
  const order = s.orders.find((o) => o.id === m.reference);
  const batch = s.batches.find((b) => b.id === m.reference);
  const pickup = s.pickups?.find((p) => p.id === m.reference);
  const to = placeName(s, m.to);
  const from = placeName(s, m.from);
  switch (m.action) {
    case 'registered':
      return { stage: 'registered', title: 'Joined the fleet', detail: `Registered at ${to}.` };
    case 'inspection':
      return { stage: 'checked', title: 'Safety check', detail: `Inspected at ${from}.` };
    case 'retag':
      return { stage: 'checked', title: 'New label fitted', detail: 'The QR label was replaced.' };
    case 'empty':
      return { stage: 'checked', title: 'Emptied', detail: `Gas let out at ${to}.` };
    case 'fill':
      return {
        stage: 'filled',
        title: 'Filled with gas',
        detail: `Filled${batch ? ` in batch ${batch.number}` : ''} (${batch?.gas ?? c.gas}) at ${to}.`,
      };
    case 'batch_reject':
      return {
        stage: 'problem',
        title: 'Rejected by quality',
        detail: `Taken out of batch${batch ? ` ${batch.number}` : ''} before release.`,
      };
    case 'recall':
      return {
        stage: 'problem',
        title: 'Recalled',
        detail: `Its gas batch${batch ? ` ${batch.number}` : ''} was recalled; held while at ${from}.`,
      };
    case 'dispatch': {
      const driver = order ? personName(people, order.driverId) : '';
      return {
        stage: 'truck',
        title: 'Loaded on a truck',
        detail: order
          ? `For ${partyName(s, order.partyId)} (order ${order.number}) on truck ${order.vehicle}${driver ? `, driven by ${driver}` : ''}.`
          : `Loaded on ${to}.`,
      };
    }
    case 'delivery': {
      const proof = order?.deliveryProofs?.find((p) => p.cylinderIds.includes(c.id));
      return {
        stage: 'customer',
        title: 'Delivered',
        detail: `Handed to ${to}${proof?.recipient ? `, received by ${proof.recipient}` : ''}${order ? ` (order ${order.number})` : ''}.`,
      };
    }
    case 'unload':
      return {
        stage: 'back',
        title: 'Came back undelivered',
        detail: `Unloaded from the truck at ${to}${order ? ` (order ${order.number})` : ''}.`,
      };
    case 'collection': {
      const driver = pickup ? personName(people, pickup.driverId) : '';
      return {
        stage: 'truck',
        title: 'Collected from the customer',
        detail: `Picked up from ${from} on ${to}${driver ? ` by ${driver}` : ''}.`,
      };
    }
    case 'collection_reverse':
      return {
        stage: 'customer',
        title: 'Collection undone',
        detail: `Recorded as still with ${to}.`,
      };
    case 'return':
      return {
        stage: 'back',
        title: 'Back in the godown',
        detail: `Received at ${to} from ${from}.`,
      };
    case 'supplier_send':
      return { stage: 'supplier', title: 'Sent to a supplier', detail: `Sent to ${to}.` };
    case 'supplier_receive':
      return { stage: 'back', title: 'Back from the supplier', detail: `Received at ${to}.` };
    case 'offsite_lost':
      return { stage: 'problem', title: 'Reported lost', detail: `Lost while with ${from}.` };
    case 'offsite_damaged':
      return { stage: 'problem', title: 'Reported damaged', detail: `Damaged while with ${from}.` };
    case 'rental_stop_incident':
      return { stage: 'problem', title: 'Rent stopped', detail: 'Rent stopped after an incident.' };
    case 'writeoff':
      return { stage: 'retired', title: 'Written off', detail: 'Removed from the fleet.' };
    default:
      return {
        stage: 'checked',
        title: m.action.replaceAll('_', ' ').replace(/^./, (x) => x.toUpperCase()),
        detail: `${from} → ${to}.`,
      };
  }
}

export function lifeStory(
  s: AppState,
  cylinderId: string,
  people: People,
): { cylinder?: Cylinder; events: LifeEvent[]; summary: LifeSummary } {
  const c = s.cylinders.find((x) => x.id === cylinderId);
  const empty: LifeSummary = {
    trips: 0,
    customers: [],
    fills: 0,
    inspections: 0,
    daysWithCustomers: 0,
  };
  if (!c) return { events: [], summary: empty };
  // Movements are stored newest first, so a lower index means later; that order breaks ties
  // between steps recorded at the same moment.
  const order = new Map<string, number>();
  s.movements.forEach((m, index) => order.set(m.id, s.movements.length - index));
  const events: (LifeEvent & { seq: number })[] = s.movements
    .filter((m) => m.cylinderId === c.id)
    .map((m) => ({
      id: m.id,
      seq: order.get(m.id)!,
      at: m.at,
      who: m.actorName,
      notes: m.notes,
      ...describe(s, people, c, m),
    }));
  // Quality release is recorded on the batch, not the cylinder; show it in the story too.
  for (const m of s.movements.filter((x) => x.cylinderId === c.id && x.action === 'fill')) {
    const batch = s.batches.find((b) => b.id === m.reference);
    if (batch?.releasedAt)
      events.push({
        id: `release-${batch.id}-${m.id}`,
        seq: order.get(m.id)! + 0.5,
        at: batch.releasedAt,
        stage: 'released',
        title: 'Passed quality check',
        detail: `Batch ${batch.number} released for delivery${batch.certificate ? ` (certificate ${batch.certificate})` : ''}.`,
        who: batch.releasedBy ? personName(people, batch.releasedBy) : '',
        notes: batch.qualityNotes ?? '',
      });
  }
  events.sort((a, b) => a.at.localeCompare(b.at) || a.seq - b.seq);

  const deliveries = s.movements.filter((m) => m.cylinderId === c.id && m.action === 'delivery');
  const now = Date.now();
  const daysWithCustomers = s.rentals
    .filter((r) => r.cylinderId === c.id)
    .reduce((sum, r) => {
      const end = r.end ? Date.parse(r.end) : now;
      return sum + Math.max(0, Math.round((end - Date.parse(r.start)) / 86_400_000));
    }, 0);
  return {
    cylinder: c,
    events: events.map(({ seq: _seq, ...event }) => event),
    summary: {
      trips: deliveries.length,
      customers: [...new Set(deliveries.map((m) => placeName(s, m.to)))],
      fills: events.filter((e) => e.stage === 'filled').length,
      inspections: s.movements.filter((m) => m.cylinderId === c.id && m.action === 'inspection')
        .length,
      daysWithCustomers,
      firstSeen: events[0]?.at ?? c.createdAt,
    },
  };
}
