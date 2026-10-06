import type { AppState, Cylinder, Order, Party, ReturnPickup, User } from '../../shared/types';
import type { TextKey } from '../i18n';

// Read-only helpers that turn server records into the few ideas a basic user needs.
// The server still checks every rule; these only stop obviously wrong scans early.

export const indiaDay = (at: string | Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));

export const today = () => indiaDay(new Date());

/** Finds a cylinder by the scanned QR text: its tag, an old tag or the serial plate. */
export function findByCode(cylinders: Cylinder[], code: string): Cylinder | undefined {
  const wanted = code.trim().toLowerCase();
  if (!wanted) return;
  return (
    cylinders.find((c) => c.tag.toLowerCase() === wanted) ??
    cylinders.find((c) => c.previousTags?.some((tag) => tag.toLowerCase() === wanted)) ??
    cylinders.find((c) => c.serial.toLowerCase() === wanted)
  );
}

export type BasicStatus = 'ready' | 'wait' | 'empty' | 'hold' | 'unsure';

export function testValid(c: Cylinder) {
  const day = today();
  return c.testDue >= day && c.lastTest <= day && c.lastTest <= c.testDue && !!c.certificate;
}

export function basicStatus(state: AppState, c: Cylinder): BasicStatus {
  const batch = state.batches.find((b) => b.id === c.batchId);
  if (c.condition !== 'serviceable' || !testValid(c) || batch?.status === 'recalled') return 'hold';
  if (c.contents === 'empty') return 'empty';
  if (c.contents === 'full') return batch?.status === 'released' ? 'ready' : 'wait';
  return 'unsure';
}

export const statusText: Record<BasicStatus, TextKey> = {
  ready: 'status.ready',
  wait: 'status.wait',
  empty: 'status.empty',
  hold: 'status.hold',
  unsure: 'status.unsure',
};

export const placeText: Record<Cylinder['custody'], TextKey> = {
  plant: 'place.plant',
  vehicle: 'place.vehicle',
  customer: 'place.customer',
  supplier: 'place.supplier',
};

export function placeName(state: AppState, c: Cylinder): string {
  if (c.custody === 'plant')
    return state.branches.find((b) => b.id === c.custodianId || b.id === c.branchId)?.name ?? '';
  if (c.custody === 'customer' || c.custody === 'supplier')
    return state.parties.find((p) => p.id === c.custodianId)?.name ?? '';
  const order = state.orders.find((o) => o.id === c.custodianId);
  if (order) return order.vehicle;
  return state.pickups?.find((p) => p.id === c.custodianId)?.vehicle ?? '';
}

export const partyOf = (state: AppState, id: string): Party | undefined =>
  state.parties.find((p) => p.id === id);

export const partyName = (state: AppState, id: string) => partyOf(state, id)?.name ?? '—';

/** Cylinders on an order that are still on the truck. */
export const pendingIds = (o: Order) =>
  o.cylinderIds.filter((id) => !o.deliveredIds.includes(id) && !o.unloadedIds?.includes(id));

// ---------- Driver ----------

export function driverOrders(state: AppState, user: User): Order[] {
  return state.orders.filter(
    (o) => o.driverId === user.id && ['dispatched', 'partial'].includes(o.status),
  );
}

/** Orders the driver may still act for today, including ones already delivered today. */
export function driverWork(state: AppState, user: User): Order[] {
  const day = today();
  return state.orders.filter(
    (o) =>
      o.driverId === user.id &&
      (['dispatched', 'partial'].includes(o.status) ||
        (o.status === 'delivered' && !!o.deliveredAt && indiaDay(o.deliveredAt) === day)),
  );
}

/** Customers the driver may collect empties from today, with what each holds. */
export function collectableCustomers(state: AppState, user: User) {
  const ids = [...new Set(driverWork(state, user).map((o) => o.partyId))];
  return ids
    .map((id) => {
      const party = partyOf(state, id);
      const held = state.cylinders.filter(
        (c) =>
          c.custody === 'customer' &&
          c.custodianId === id &&
          party &&
          c.branchId === party.branchId,
      );
      return party ? { party, held } : undefined;
    })
    .filter((item): item is { party: Party; held: Cylinder[] } => !!item);
}

export function driverPickups(state: AppState, user: User): ReturnPickup[] {
  return (state.pickups ?? []).filter(
    (p) =>
      p.driverId === user.id &&
      p.cylinderIds.some((id) => !p.receivedIds.includes(id) && !p.reversedIds?.includes(id)),
  );
}

export function driverVehicle(state: AppState, user: User, partyId?: string): string {
  const work = driverWork(state, user);
  return (
    work.find((o) => o.partyId === partyId && o.vehicle)?.vehicle ??
    work.find((o) => o.vehicle)?.vehicle ??
    driverPickups(state, user).at(-1)?.vehicle ??
    ''
  );
}

/** Branches where the driver currently has a trip (the server allows reports only there). */
export function driverBranches(state: AppState, user: User): string[] {
  return [
    ...new Set([
      ...driverWork(state, user).map((o) => o.branchId),
      ...driverPickups(state, user).map((p) => p.branchId),
    ]),
  ];
}

// ---------- Godown ----------

export type DispatchProblem =
  | 'load.why.size'
  | 'load.why.notFull'
  | 'load.why.hold'
  | 'load.why.notChecked'
  | 'load.why.notHere'
  | 'load.why.branch'
  | 'load.why.owner';

/** Why a cylinder cannot go on this order, using the same rules as dispatch. */
export function dispatchProblem(state: AppState, o: Order, c: Cylinder): DispatchProblem | null {
  if (c.custody !== 'plant') return 'load.why.notHere';
  if (c.branchId !== o.branchId) return 'load.why.branch';
  if (c.gas !== o.gas || c.size !== o.size) return 'load.why.size';
  const batch = state.batches.find((b) => b.id === c.batchId);
  if (c.condition !== 'serviceable' || !testValid(c) || batch?.status === 'recalled')
    return 'load.why.hold';
  if (c.contents !== 'full') return 'load.why.notFull';
  if (!batch || batch.status !== 'released' || batch.branchId !== o.branchId)
    return 'load.why.notChecked';
  // Third-party stock needs the owner's written permission, which only the office records.
  if (c.ownerId !== 'company') return 'load.why.owner';
  return null;
}

export type FillProblem =
  'fill.why.notEmpty' | 'fill.why.hold' | 'fill.why.gas' | 'fill.why.branch' | 'fill.why.notHere';

export function fillProblem(state: AppState, c: Cylinder, first?: Cylinder): FillProblem | null {
  if (c.custody !== 'plant') return 'fill.why.notHere';
  const batch = state.batches.find((b) => b.id === c.batchId);
  if (c.condition !== 'serviceable' || !testValid(c)) return 'fill.why.hold';
  if (c.contents !== 'empty') return 'fill.why.notEmpty';
  if (batch && batch.status !== 'recalled') return 'fill.why.hold';
  if (first && first.branchId !== c.branchId) return 'fill.why.branch';
  if (first && first.gas !== c.gas) return 'fill.why.gas';
  return null;
}

/** How a cylinder scanned in the godown came back, so one scan screen can sort them. */
export type ArrivalGroup =
  { kind: 'customer'; partyId: string } | { kind: 'truck'; orderId: string };

export function arrivalGroup(state: AppState, c: Cylinder): ArrivalGroup | null {
  if (c.custody === 'customer') return { kind: 'customer', partyId: c.custodianId };
  if (c.custody !== 'vehicle') return null;
  const pickup = state.pickups?.find((p) => p.id === c.custodianId);
  if (pickup) {
    if (pickup.receivedIds.includes(c.id) || pickup.reversedIds?.includes(c.id)) return null;
    return { kind: 'customer', partyId: pickup.partyId };
  }
  const order = state.orders.find((o) => o.id === c.custodianId);
  if (order && pendingIds(order).includes(c.id) && ['dispatched', 'partial'].includes(order.status))
    return { kind: 'truck', orderId: order.id };
  return null;
}

/** Seal can be kept only for safe, released, full stock (the server's unload rule). */
export function canKeepSeal(state: AppState, c: Cylinder) {
  return (
    c.contents === 'full' &&
    c.condition === 'serviceable' &&
    testValid(c) &&
    state.batches.find((b) => b.id === c.batchId)?.status === 'released'
  );
}

export function initials(name: string) {
  return (
    name
      .replace(/^(demo|dr\.?|mr\.?|mrs\.?|ms\.?)\s+/i, '')
      .trim()
      .charAt(0)
      .toUpperCase() || '?'
  );
}

/** A steady colour per name, so the same customer always has the same badge colour. */
export function badgeHue(name: string) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return hash;
}

// ---------- Godown helpers for Came back, Load truck, Filled and Check ----------

/** Admins see every branch; everyone else only their own. */
export const inMyBranches = (user: User, branchId: string) =>
  user.role === 'admin' || user.branchIds.includes(branchId);

/** Already filled and waiting for quality release (the office "Create batch" rule). */
export const inAwaitingBatch = (state: AppState, c: Cylinder) =>
  state.batches.some((b) => b.status === 'awaiting_release' && b.cylinderIds.includes(c.id));

export const gasShort = (gas: Cylinder['gas']): TextKey =>
  gas === 'Medical oxygen' ? 'gas.medicalShort' : 'gas.industrialShort';

/** Open orders a helper can load, urgent first, then by due date. */
export function loadableOrders(state: AppState, user: User): Order[] {
  return state.orders
    .filter((o) => o.status === 'open' && inMyBranches(user, o.branchId))
    .sort(
      (a, b) =>
        Number(b.priority === 'urgent') - Number(a.priority === 'urgent') ||
        a.dueDate.localeCompare(b.dueDate) ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

/** The truck last used with a driver: remembered on this phone, else from their latest order. */
export function lastVehicleOf(state: AppState, driverId: string, remembered: string | null) {
  if (remembered) return remembered;
  return (
    state.orders
      .filter((o) => o.driverId === driverId && o.vehicle)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.vehicle ?? ''
  );
}

export type CheckBlock =
  'check.retired' | 'check.notHere' | 'check.owner' | 'check.goodBlocked' | 'check.recalled';

/**
 * Why a quality check cannot mark the cylinder Good or Hold, following the server's
 * inspection rules. Hold is blocked only when the server would refuse any inspection.
 */
export function checkBlocks(
  state: AppState,
  c: Cylinder,
): { good: CheckBlock | null; hold: CheckBlock | null } {
  const any: CheckBlock | null =
    c.condition === 'retired'
      ? 'check.retired'
      : c.custody !== 'plant'
        ? 'check.notHere'
        : c.ownerId !== 'company'
          ? 'check.owner'
          : null;
  if (any) return { good: any, hold: any };
  if (!testValid(c)) return { good: 'check.goodBlocked', hold: null };
  if (state.batches.find((b) => b.id === c.batchId)?.status === 'recalled')
    return { good: 'check.recalled', hold: null };
  return { good: null, hold: null };
}
