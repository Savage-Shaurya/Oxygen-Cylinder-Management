import { z } from 'zod';
import type {
  ActionContext,
  ActionRequest,
  ActionResult,
  AppState,
  Cylinder,
  Party,
  Order,
  Batch,
  Invoice,
  RentalInterval,
  Role,
} from '../shared/types.js';

export class DomainError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
const fail = (message: string, status = 400): never => {
  throw new DomainError(message, status);
};
const txt = (max = 200) => z.string().trim().min(1).max(max);
const optional = (max = 500) => z.string().trim().max(max).optional().default('');
const money = z.number().int().nonnegative().safe();
const positiveMoney = z.number().int().positive().safe();
const count = z.number().int().min(1).max(500);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) &&
      new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v,
    'Invalid date',
  );
const gas = z.enum(['Medical oxygen', 'Industrial oxygen']);
const ids = z
  .array(txt(100))
  .min(1)
  .max(500)
  .refine((v) => new Set(v).size === v.length, 'Duplicate cylinder IDs');
const reg = z
  .object({
    serial: txt(80),
    tag: txt(80),
    manufacturer: txt(100),
    gas,
    size: txt(50),
    ownerId: txt(100),
    branchId: txt(100),
    testDue: date,
    lastTest: date,
    certificate: txt(200),
    contents: z.enum(['empty', 'full', 'partial', 'unknown']).optional().default('empty'),
  })
  .strict();
const partyFields = z
  .object({
    name: txt(120),
    type: z.enum(['hospital', 'homecare', 'industrial', 'supplier']),
    contact: txt(120),
    phone: txt(30),
    address: txt(300),
    city: txt(100),
    gstin: z.string().trim().max(20),
    branchId: txt(100),
    creditLimitPaise: money,
    dailyRentalPaise: money,
    freeDays: z.number().int().min(0).max(365),
    depositPaise: money,
  })
  .strict();
const schemas: Record<string, z.ZodTypeAny> = {
  'cylinder.register': reg,
  'cylinder.inspect': z
    .object({
      cylinderId: txt(100),
      version: z.number().int().nonnegative(),
      condition: z.enum(['serviceable', 'quarantine', 'testing', 'retired']),
      notes: txt(500),
      testDue: date.optional(),
      lastTest: date.optional(),
      certificate: txt(200).optional(),
    })
    .strict(),
  'cylinder.retag': z
    .object({
      cylinderId: txt(100),
      version: z.number().int().nonnegative(),
      tag: txt(80),
      reason: txt(500),
    })
    .strict(),
  'party.create': partyFields,
  'party.update': z.object({ partyId: txt(100), ...partyFields.shape }).strict(),
  'order.create': z
    .object({
      partyId: txt(100),
      branchId: txt(100),
      gas,
      size: txt(50),
      quantity: count,
      priority: z.enum(['normal', 'urgent']),
      dueDate: date,
      notes: optional(),
      unitPricePaise: money,
    })
    .strict(),
  'order.cancel': z.object({ orderId: txt(100), reason: txt(500) }).strict(),
  'order.dispatch': z
    .object({
      orderId: txt(100),
      cylinderIds: ids,
      vehicle: txt(100),
      driverId: txt(100),
    })
    .strict(),
  'order.deliver': z
    .object({
      orderId: txt(100),
      cylinderIds: ids,
      recipient: txt(120),
      notes: optional(),
    })
    .strict(),
  'cylinder.return': z
    .object({
      cylinderIds: ids,
      partyId: txt(100),
      contents: z.enum(['empty', 'full', 'partial', 'unknown']),
      notes: optional(),
    })
    .strict(),
  'cylinder.collect': z
    .object({
      partyId: txt(100),
      cylinderIds: ids,
      vehicle: txt(100),
      driverId: txt(100),
      notes: optional(),
    })
    .strict(),
  'return.discrepancy': z.object({ branchId: txt(100), serial: txt(80), notes: txt(500) }).strict(),
  'order.unload': z.object({ orderId: txt(100), cylinderIds: ids, notes: optional() }).strict(),
  'batch.create': z
    .object({
      gas,
      branchId: txt(100),
      cylinderIds: ids,
      source: txt(120),
      operator: txt(100),
    })
    .strict(),
  'batch.release': z
    .object({
      batchId: txt(100),
      certificate: txt(200),
      qualityNotes: txt(500),
    })
    .strict(),
  'batch.recall': z.object({ batchId: txt(100), reason: txt(500) }).strict(),
  'supplier.send': z
    .object({
      supplierId: txt(100),
      cylinderIds: ids,
      reference: txt(100),
      notes: optional(),
    })
    .strict(),
  'supplier.receive': z
    .object({
      supplierId: txt(100),
      cylinderIds: ids,
      reference: txt(100),
      gas,
      notes: optional(),
    })
    .strict(),
  'purchase.receive': z
    .object({
      supplierId: txt(100),
      branchId: txt(100),
      gas,
      reference: txt(100),
      cylinders: z
        .array(reg.omit({ gas: true, branchId: true, contents: true }))
        .min(1)
        .max(500),
      notes: optional(),
    })
    .strict(),
  'finance.invoice': z
    .object({
      orderId: txt(100),
      taxBps: z.number().int().min(0).max(10000),
      dueDate: date,
      notes: optional(),
    })
    .strict(),
  'finance.rental': z
    .object({
      partyId: txt(100),
      periodStart: date,
      periodEnd: date,
      taxBps: z.number().int().min(0).max(10000),
      dueDate: date,
    })
    .strict(),
  'finance.receipt': z
    .object({
      invoiceId: txt(100),
      amountPaise: positiveMoney,
      method: z.enum(['cash', 'upi', 'bank']),
      reference: txt(100),
    })
    .strict(),
  'finance.deposit': z
    .object({
      partyId: txt(100),
      amountPaise: positiveMoney,
      method: z.enum(['cash', 'upi', 'bank']),
      reference: txt(100),
    })
    .strict(),
  'finance.refund': z
    .object({
      partyId: txt(100),
      amountPaise: positiveMoney,
      method: z.enum(['cash', 'upi', 'bank']),
      reference: txt(100),
      reason: txt(500),
    })
    .strict(),
  'finance.credit': z.object({ invoiceId: txt(100), reason: txt(500) }).strict(),
  'exception.resolve': z.object({ exceptionId: txt(100), resolution: txt(500) }).strict(),
  'settings.update': z
    .object({
      companyName: txt(120),
      address: txt(300),
      gstin: z.string().trim().max(20),
      defaultTaxBps: z.number().int().min(0).max(10000),
    })
    .strict(),
  'cylinders.import': z.object({ rows: z.array(reg).min(1).max(500) }).strict(),
};
const access: Record<string, Role[]> = {
  'cylinder.register': ['admin', 'operations'],
  'cylinder.inspect': ['admin', 'quality'],
  'cylinder.retag': ['admin', 'operations'],
  'party.create': ['admin', 'operations', 'finance'],
  'party.update': ['admin', 'finance'],
  'order.create': ['admin', 'operations'],
  'order.cancel': ['admin', 'operations'],
  'order.dispatch': ['admin', 'operations'],
  'order.deliver': ['admin', 'operations', 'driver'],
  'cylinder.return': ['admin', 'operations'],
  'cylinder.collect': ['admin', 'operations', 'driver'],
  'return.discrepancy': ['admin', 'operations', 'driver'],
  'order.unload': ['admin', 'operations'],
  'batch.create': ['admin', 'operations'],
  'batch.release': ['admin', 'quality'],
  'batch.recall': ['admin', 'quality'],
  'supplier.send': ['admin', 'operations'],
  'supplier.receive': ['admin', 'operations'],
  'purchase.receive': ['admin', 'operations'],
  'finance.invoice': ['admin', 'finance'],
  'finance.rental': ['admin', 'finance'],
  'finance.receipt': ['admin', 'finance'],
  'finance.deposit': ['admin', 'finance'],
  'finance.refund': ['admin', 'finance'],
  'finance.credit': ['admin', 'finance'],
  'exception.resolve': ['admin', 'operations', 'quality'],
  'settings.update': ['admin'],
  'cylinders.import': ['admin', 'operations'],
};
const day = (v: string) => Date.parse(`${v}T00:00:00Z`);
const days = (a: string, b: string) => Math.round((day(b) - day(a)) / 86400000);
const istDay = (instant: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant));
const today = (ctx: ActionContext) => istDay(ctx.now);
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
function checked(n: number): number {
  if (!Number.isSafeInteger(n) || n < 0) fail('Money amount is out of range');
  return n;
}
function tax(subtotal: number, bps: number) {
  const amount = (BigInt(checked(subtotal)) * BigInt(bps) + 5000n) / 10000n;
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) fail('Money amount is out of range');
  return Number(amount);
}
function dueValid(c: Cylinder, ctx: ActionContext) {
  return (
    c.testDue >= today(ctx) &&
    c.lastTest <= today(ctx) &&
    c.lastTest <= c.testDue &&
    !!c.certificate
  );
}
function branch(state: AppState, ctx: ActionContext, id: string) {
  if (!state.branches.some((b) => b.id === id)) fail('Branch not found', 404);
  if (!ctx.user.branchIds.includes(id)) fail('Branch access denied', 403);
}
function object<T extends { id: string; branchId?: string }>(
  items: T[],
  id: string,
  label: string,
  ctx: ActionContext,
  state: AppState,
): T {
  const item = items.find((x) => x.id === id);
  if (!item) return fail(`${label} not found`, 404);
  if (item.branchId) branch(state, ctx, item.branchId);
  return item;
}
function cylinders(state: AppState, ctx: ActionContext, list: string[]) {
  return list.map((id) => object(state.cylinders, id, 'Cylinder', ctx, state));
}
function movement(
  state: AppState,
  ctx: ActionContext,
  c: Cylinder,
  action: string,
  to: string,
  reference: string,
  notes = '',
) {
  const from = `${c.custody}:${c.custodianId}`;
  c.version++;
  state.movements.unshift({
    id: ctx.id(),
    cylinderId: c.id,
    action,
    from,
    to,
    at: ctx.now,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    reference,
    notes,
  });
}
function tagUsed(state: AppState, tag: string) {
  const key = tag.toLowerCase();
  return state.cylinders.some(
    (c) => c.tag.toLowerCase() === key || c.previousTags?.some((old) => old.toLowerCase() === key),
  );
}
function serialUnique(state: AppState, manufacturer: string, serial: string, tag: string) {
  if (
    state.cylinders.some(
      (c) =>
        c.manufacturer.toLowerCase() === manufacturer.toLowerCase() &&
        c.serial.toLowerCase() === serial.toLowerCase(),
    )
  )
    fail('Manufacturer and serial already exist', 409);
  if (tagUsed(state, tag)) fail('Tag already exists', 409);
}
function createCylinder(state: AppState, ctx: ActionContext, p: z.infer<typeof reg>) {
  branch(state, ctx, p.branchId);
  if (
    p.ownerId !== 'company' &&
    object(state.parties, p.ownerId, 'Owner', ctx, state).branchId !== p.branchId
  )
    fail('Owner branch mismatch');
  if (day(p.lastTest) > day(p.testDue) || p.lastTest > today(ctx)) fail('Invalid test dates');
  serialUnique(state, p.manufacturer, p.serial, p.tag);
  const c: Cylinder = {
    ...p,
    id: ctx.id(),
    custody: 'plant',
    custodianId: p.branchId,
    condition: 'inspection_due',
    contents: p.contents,
    version: 1,
    createdAt: ctx.now,
  };
  state.cylinders.push(c);
  state.movements.unshift({
    id: ctx.id(),
    cylinderId: c.id,
    action: 'registered',
    from: 'new',
    to: `plant:${p.branchId}`,
    at: ctx.now,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    reference: c.serial,
    notes: 'Initial inspection required',
  });
  return c;
}
function invoice(
  state: AppState,
  ctx: ActionContext,
  p: {
    partyId: string;
    branchId: string;
    type: Invoice['type'];
    sourceId: string;
    dueDate: string;
    lines: Invoice['lines'];
    taxBps: number;
    notes: string;
    creditedInvoiceId?: string;
    billTo?: Invoice['billTo'];
    issuer?: Invoice['issuer'];
  },
) {
  const subtotal = checked(sum(p.lines.map((l) => checked(l.amountPaise))));
  const taxPaise = tax(subtotal, p.taxBps);
  const total = checked(subtotal + taxPaise);
  const party = state.parties.find((party) => party.id === p.partyId);
  if (!party) return fail('Invoice customer not found', 404);
  const i: Invoice = {
    id: ctx.id(),
    number: `${p.type === 'credit' ? 'CN' : 'INV'}-${String(state.invoices.length + 1).padStart(5, '0')}`,
    issuedAt: ctx.now,
    subtotalPaise: subtotal,
    taxPaise,
    totalPaise: total,
    paidPaise: 0,
    status: 'issued',
    ...p,
    billTo: p.billTo ?? {
      name: party.name,
      address: party.address,
      city: party.city,
      gstin: party.gstin,
    },
    issuer: p.issuer ?? {
      companyName: state.settings.companyName,
      address: state.settings.address,
      gstin: state.settings.gstin,
    },
  };
  state.invoices.push(i);
  return i;
}
function receiptReference(state: AppState, partyId: string, method: string, reference: string) {
  if (
    method !== 'cash' &&
    state.receipts.some(
      (r) =>
        r.partyId === partyId &&
        r.method === method &&
        r.reference.toLowerCase() === reference.toLowerCase(),
    )
  )
    fail('Payment reference already posted', 409);
}
function addReceipt(
  state: AppState,
  ctx: ActionContext,
  p: {
    partyId: string;
    invoiceId?: string;
    amountPaise: number;
    method: 'cash' | 'upi' | 'bank';
    reference: string;
    kind: 'payment' | 'deposit' | 'refund';
  },
) {
  receiptReference(state, p.partyId, p.method, p.reference);
  const r = {
    id: ctx.id(),
    number: `RCPT-${String(state.receipts.length + 1).padStart(5, '0')}`,
    at: ctx.now,
    actorId: ctx.user.id,
    ...p,
  };
  state.receipts.push(r);
  return r;
}
function setOrderStatus(o: Order) {
  o.status =
    o.deliveredIds.length === o.quantity
      ? 'delivered'
      : o.deliveredIds.length + (o.unloadedIds?.length ?? 0) === o.cylinderIds.length
        ? 'closed_short'
        : o.deliveredIds.length || o.unloadedIds?.length
          ? 'partial'
          : 'dispatched';
}

export function applyAction(
  input: AppState,
  request: ActionRequest,
  ctx: ActionContext,
): ActionResult {
  if (!ctx.user.active || !ctx.user.orgId) fail('Access denied', 403);
  if (!access[request.type]?.includes(ctx.user.role)) fail('Action not permitted', 403);
  if (request.expectedRevision !== undefined && request.expectedRevision !== input.revision)
    fail('State changed; refresh and retry', 409);
  const parsed = schemas[request.type].safeParse(request.payload);
  if (!parsed.success)
    fail(
      `Invalid ${request.type} payload: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  const p: any = parsed.data;
  const s: AppState = structuredClone(input);
  let entityId: string | undefined;
  let message = 'Saved';
  switch (request.type) {
    case 'cylinder.register': {
      const c = createCylinder(s, ctx, p);
      entityId = c.id;
      message = 'Cylinder registered for inspection';
      break;
    }
    case 'cylinders.import': {
      const ss = new Set<string>(),
        tt = new Set<string>();
      for (const row of p.rows) {
        const a = `${row.manufacturer.toLowerCase()}:${row.serial.toLowerCase()}`,
          b = row.tag.toLowerCase();
        if (ss.has(a) || tt.has(b)) fail('Duplicate serial or tag in import', 409);
        ss.add(a);
        tt.add(b);
        createCylinder(s, ctx, row);
      }
      message = `Imported ${p.rows.length} cylinders for inspection`;
      break;
    }
    case 'cylinder.inspect': {
      const c = object(s.cylinders, p.cylinderId, 'Cylinder', ctx, s);
      if (c.version !== p.version) fail('Cylinder version changed', 409);
      if (c.condition === 'retired') fail('Retired cylinder is immutable');
      if (c.custody !== 'plant') fail('Cylinder must be at plant for inspection');
      const testEvidenceCount = [p.testDue, p.lastTest, p.certificate].filter(
        (value) => value !== undefined,
      ).length;
      if (testEvidenceCount !== 0 && testEvidenceCount !== 3)
        fail('Complete test dates and certificate required');
      if (testEvidenceCount === 3 && (p.lastTest > p.testDue || p.lastTest > today(ctx)))
        fail('Invalid test dates');
      if (p.testDue) c.testDue = p.testDue;
      if (p.lastTest) c.lastTest = p.lastTest;
      if (p.certificate) c.certificate = p.certificate;
      if (p.condition === 'serviceable' && !dueValid(c, ctx))
        fail('Valid dated test and certificate required');
      if (
        p.condition === 'serviceable' &&
        c.batchId &&
        s.batches.find((batch) => batch.id === c.batchId)?.status === 'recalled'
      )
        fail('Recalled cylinder remains on hold');
      if (p.condition === 'retired' && s.rentals.some((r) => r.cylinderId === c.id && !r.end))
        fail('Cannot retire active rental');
      c.condition = p.condition;
      movement(s, ctx, c, 'inspection', `${c.custody}:${c.custodianId}`, c.id, p.notes);
      entityId = c.id;
      message = `Cylinder ${p.condition}`;
      break;
    }
    case 'cylinder.retag': {
      const c = object(s.cylinders, p.cylinderId, 'Cylinder', ctx, s);
      if (c.version !== p.version) fail('Cylinder version changed', 409);
      if (c.condition === 'retired') fail('Retired cylinder is immutable');
      if (tagUsed(s, p.tag)) fail('Tag already exists', 409);
      c.previousTags ??= [];
      c.previousTags.push(c.tag);
      c.tag = p.tag;
      movement(s, ctx, c, 'retag', `${c.custody}:${c.custodianId}`, c.id, p.reason);
      entityId = c.id;
      message = 'Tag updated';
      break;
    }
    case 'party.create': {
      branch(s, ctx, p.branchId);
      if (
        s.parties.some(
          (x) => x.name.toLowerCase() === p.name.toLowerCase() && x.branchId === p.branchId,
        )
      )
        fail('Party already exists', 409);
      const x: Party = { id: ctx.id(), ...p };
      s.parties.push(x);
      entityId = x.id;
      message = 'Party created';
      break;
    }
    case 'party.update': {
      const x = object(s.parties, p.partyId, 'Party', ctx, s);
      branch(s, ctx, p.branchId);
      if (p.branchId !== x.branchId) fail('Party branch cannot change');
      if (p.type !== x.type) fail('Party type cannot change');
      Object.assign(x, p);
      delete (x as any).partyId;
      entityId = x.id;
      message = 'Party updated';
      break;
    }
    case 'order.create': {
      branch(s, ctx, p.branchId);
      const party = object(s.parties, p.partyId, 'Party', ctx, s);
      if (party.branchId !== p.branchId || party.type === 'supplier')
        fail('Invalid customer or branch');
      const o: Order = {
        id: ctx.id(),
        number: `ORD-${String(s.orders.length + 1).padStart(5, '0')}`,
        status: 'open',
        cylinderIds: [],
        deliveredIds: [],
        vehicle: '',
        driverId: '',
        createdAt: ctx.now,
        ...p,
      };
      s.orders.push(o);
      entityId = o.id;
      message = 'Order created';
      break;
    }
    case 'order.cancel': {
      const o = object(s.orders, p.orderId, 'Order', ctx, s);
      if (o.status !== 'open') fail('Only open orders may be cancelled');
      o.status = 'cancelled';
      entityId = o.id;
      message = 'Order cancelled';
      break;
    }
    case 'order.dispatch': {
      const o = object(s.orders, p.orderId, 'Order', ctx, s);
      if (o.status !== 'open') fail('Order is not open');
      if (p.cylinderIds.length !== o.quantity) fail('Manifest must match order quantity');
      const cs = cylinders(s, ctx, p.cylinderIds);
      for (const c of cs) {
        if (
          c.branchId !== o.branchId ||
          c.gas !== o.gas ||
          c.size !== o.size ||
          c.custody !== 'plant' ||
          c.condition !== 'serviceable' ||
          c.contents !== 'full' ||
          !dueValid(c, ctx)
        )
          fail('Cylinder is not dispatchable');
        const b = s.batches.find((b) => b.id === c.batchId);
        if (!b || b.status !== 'released' || b.branchId !== o.branchId)
          fail('Released batch required');
      }
      o.cylinderIds = [...p.cylinderIds];
      o.vehicle = p.vehicle;
      o.driverId = p.driverId;
      o.status = 'dispatched';
      for (const c of cs) {
        movement(s, ctx, c, 'dispatch', `vehicle:${o.id}`, o.id);
        c.custody = 'vehicle';
        c.custodianId = o.id;
      }
      entityId = o.id;
      message = 'Order dispatched';
      break;
    }
    case 'order.deliver': {
      const o = object(s.orders, p.orderId, 'Order', ctx, s);
      if (ctx.user.role === 'driver' && o.driverId !== ctx.user.id)
        fail('Driver is not assigned', 403);
      if (!['dispatched', 'partial'].includes(o.status)) fail('Order is not in delivery');
      if (
        s.invoices.some((i) => i.type === 'gas' && i.sourceId === o.id && i.status !== 'credited')
      )
        fail('Order already invoiced');
      for (const id of p.cylinderIds) {
        if (
          !o.cylinderIds.includes(id) ||
          o.deliveredIds.includes(id) ||
          o.unloadedIds?.includes(id)
        )
          fail('Cylinder is not pending in manifest');
      }
      const party = object(s.parties, o.partyId, 'Party', ctx, s);
      const cs = cylinders(s, ctx, p.cylinderIds);
      for (const c of cs) {
        if (
          c.custody !== 'vehicle' ||
          c.custodianId !== o.id ||
          c.condition !== 'serviceable' ||
          !dueValid(c, ctx) ||
          s.batches.find((b) => b.id === c.batchId)?.status !== 'released'
        )
          fail('Cylinder cannot be delivered');
        movement(s, ctx, c, 'delivery', `customer:${party.id}`, o.id, p.notes);
        c.custody = 'customer';
        c.custodianId = party.id;
        o.deliveredIds.push(c.id);
        s.rentals.push({
          id: ctx.id(),
          cylinderId: c.id,
          partyId: party.id,
          orderId: o.id,
          start: today(ctx),
          dailyRatePaise: c.ownerId === party.id ? 0 : party.dailyRentalPaise,
          freeDays: c.ownerId === party.id ? 0 : party.freeDays,
        });
      }
      o.deliveryProofs ??= [];
      o.deliveryProofs.push({
        cylinderIds: [...p.cylinderIds],
        recipient: p.recipient,
        at: ctx.now,
        actorId: ctx.user.id,
        notes: p.notes,
      });
      o.recipient = p.recipient;
      o.deliveredAt = ctx.now;
      setOrderStatus(o);
      entityId = o.id;
      message = `Delivered ${cs.length} cylinder${cs.length === 1 ? '' : 's'}`;
      break;
    }
    case 'order.unload': {
      const o = object(s.orders, p.orderId, 'Order', ctx, s);
      if (!['dispatched', 'partial'].includes(o.status)) fail('Order has no vehicle stock');
      for (const id of p.cylinderIds) {
        if (
          !o.cylinderIds.includes(id) ||
          o.deliveredIds.includes(id) ||
          o.unloadedIds?.includes(id)
        )
          fail('Cylinder not pending');
      }
      const cs = cylinders(s, ctx, p.cylinderIds);
      for (const c of cs) {
        if (c.custody !== 'vehicle' || c.custodianId !== o.id) fail('Cylinder not on this vehicle');
        movement(s, ctx, c, 'unload', `plant:${o.branchId}`, o.id, p.notes);
        c.custody = 'plant';
        c.custodianId = o.branchId;
        if (c.condition !== 'quarantine') c.condition = 'inspection_due';
        c.contents = 'unknown';
        if (c.condition !== 'quarantine') c.batchId = undefined;
      }
      o.unloadedIds ??= [];
      o.unloadedIds.push(...p.cylinderIds);
      setOrderStatus(o);
      entityId = o.id;
      message = 'Vehicle stock unloaded';
      break;
    }
    case 'cylinder.collect': {
      const party = object(s.parties, p.partyId, 'Party', ctx, s);
      if (party.type === 'supplier') fail('Supplier stock is not a customer return');
      if (ctx.user.role === 'driver' && p.driverId !== ctx.user.id)
        fail('Driver is not assigned', 403);
      if (ctx.user.role === 'driver') {
        const assigned = s.orders.some(
          (o) =>
            o.partyId === party.id &&
            o.branchId === party.branchId &&
            o.driverId === ctx.user.id &&
            (o.status === 'dispatched' ||
              o.status === 'partial' ||
              (o.status === 'delivered' && o.deliveredAt && istDay(o.deliveredAt) === today(ctx))),
        );
        if (!assigned) fail('No current assigned work for customer', 403);
      }
      const cs = cylinders(s, ctx, p.cylinderIds);
      for (const c of cs) {
        if (c.branchId !== party.branchId || c.custody !== 'customer' || c.custodianId !== party.id)
          fail('Cylinder is not held by this customer');
        const active = s.rentals.filter(
          (r) => r.cylinderId === c.id && r.partyId === party.id && !r.end,
        );
        if (active.length !== 1) fail('Active rental missing');
      }
      s.pickups ??= [];
      const pickup = {
        id: ctx.id(),
        partyId: party.id,
        branchId: party.branchId,
        driverId: p.driverId,
        vehicle: p.vehicle,
        cylinderIds: [...p.cylinderIds],
        receivedIds: [],
        createdAt: ctx.now,
        notes: p.notes,
      };
      s.pickups.push(pickup);
      for (const c of cs) {
        movement(s, ctx, c, 'collection', `vehicle:${pickup.id}`, pickup.id, p.notes);
        c.custody = 'vehicle';
        c.custodianId = pickup.id;
      }
      entityId = pickup.id;
      message = `Collected ${cs.length} customer return${cs.length === 1 ? '' : 's'}`;
      break;
    }
    case 'return.discrepancy': {
      branch(s, ctx, p.branchId);
      const record = {
        id: ctx.id(),
        at: ctx.now,
        type: 'return_discrepancy',
        summary: `${p.serial}: ${p.notes}`,
        entityId: p.serial,
        status: 'open' as const,
        branchId: p.branchId,
      };
      s.exceptions.push(record);
      entityId = record.id;
      message = 'Return discrepancy recorded for review';
      break;
    }
    case 'cylinder.return': {
      const party = object(s.parties, p.partyId, 'Party', ctx, s);
      const cs = cylinders(s, ctx, p.cylinderIds);
      for (const c of cs) {
        const pickup =
          c.custody === 'vehicle' ? s.pickups?.find((x) => x.id === c.custodianId) : undefined;
        const customerHeld = c.custody === 'customer' && c.custodianId === party.id;
        const pickupHeld =
          pickup?.partyId === party.id &&
          pickup.branchId === party.branchId &&
          pickup.cylinderIds.includes(c.id) &&
          !pickup.receivedIds.includes(c.id);
        if (c.branchId !== party.branchId || (!customerHeld && !pickupHeld))
          fail('Cylinder is not held by this customer');
        const active = s.rentals.filter((r) => r.cylinderId === c.id && !r.end);
        if (active.length !== 1) fail('Active rental missing');
        movement(s, ctx, c, 'return', `plant:${c.branchId}`, party.id, p.notes);
        c.custody = 'plant';
        c.custodianId = c.branchId;
        c.contents = p.contents;
        if (c.condition !== 'quarantine') {
          c.condition = 'inspection_due';
          c.batchId = undefined;
        }
        active[0].end = today(ctx);
        if (pickup) pickup.receivedIds.push(c.id);
      }
      entityId = party.id;
      message = `Received ${cs.length} returns`;
      break;
    }
    case 'batch.create': {
      branch(s, ctx, p.branchId);
      const cs = cylinders(s, ctx, p.cylinderIds);
      for (const c of cs) {
        if (
          c.branchId !== p.branchId ||
          c.gas !== p.gas ||
          c.custody !== 'plant' ||
          c.condition !== 'serviceable' ||
          c.contents !== 'empty' ||
          !dueValid(c, ctx) ||
          (c.batchId && s.batches.find((b) => b.id === c.batchId)?.status !== 'recalled')
        )
          fail('Cylinder cannot be filled');
      }
      const b: Batch = {
        id: ctx.id(),
        number: `BATCH-${String(s.batches.length + 1).padStart(5, '0')}`,
        branchId: p.branchId,
        gas: p.gas,
        cylinderIds: p.cylinderIds,
        source: p.source,
        operator: ctx.user.id,
        status: 'awaiting_release',
        createdAt: ctx.now,
      };
      s.batches.push(b);
      for (const c of cs) {
        movement(s, ctx, c, 'fill', `plant:${c.branchId}`, b.id);
        c.contents = 'full';
        c.batchId = b.id;
      }
      entityId = b.id;
      message = 'Batch awaiting quality release';
      break;
    }
    case 'batch.release': {
      const b = object(s.batches, p.batchId, 'Batch', ctx, s);
      if (b.status !== 'awaiting_release') fail('Batch is not awaiting release');
      if (b.operator === ctx.user.id) fail('Independent quality release required', 403);
      const cs = cylinders(s, ctx, b.cylinderIds);
      for (const c of cs) {
        if (
          c.batchId !== b.id ||
          c.custody !== 'plant' ||
          c.condition !== 'serviceable' ||
          c.contents !== 'full' ||
          !dueValid(c, ctx)
        )
          fail('Batch contains unsafe cylinder');
      }
      b.status = 'released';
      b.releasedAt = ctx.now;
      b.releasedBy = ctx.user.id;
      b.certificate = p.certificate;
      b.qualityNotes = p.qualityNotes;
      entityId = b.id;
      message = 'Batch released';
      break;
    }
    case 'batch.recall': {
      const b = object(s.batches, p.batchId, 'Batch', ctx, s);
      if (b.status === 'recalled') fail('Batch already recalled');
      b.status = 'recalled';
      for (const c of cylinders(s, ctx, b.cylinderIds)) {
        if (c.condition === 'retired') continue;
        c.condition = 'quarantine';
        movement(s, ctx, c, 'recall', `${c.custody}:${c.custodianId}`, b.id, p.reason);
        if (c.custody === 'customer' || c.custody === 'vehicle')
          s.exceptions.push({
            id: ctx.id(),
            at: ctx.now,
            type: 'recall_recovery',
            summary: `Recover ${c.serial}: ${p.reason}`,
            entityId: c.id,
            branchId: c.branchId,
            status: 'open',
          });
      }
      entityId = b.id;
      message = 'Batch recalled and stock quarantined';
      break;
    }
    case 'supplier.send': {
      const party = object(s.parties, p.supplierId, 'Supplier', ctx, s);
      if (party.type !== 'supplier') fail('Party is not supplier');
      const cs = cylinders(s, ctx, p.cylinderIds);
      for (const c of cs) {
        if (
          c.branchId !== party.branchId ||
          c.custody !== 'plant' ||
          c.condition !== 'serviceable' ||
          c.contents !== 'empty' ||
          !dueValid(c, ctx) ||
          (c.batchId && s.batches.find((b) => b.id === c.batchId)?.status !== 'recalled')
        )
          fail('Only safe empty cylinders can transfer to supplier');
        movement(s, ctx, c, 'supplier_send', `supplier:${party.id}`, p.reference, p.notes);
        c.custody = 'supplier';
        c.custodianId = party.id;
        c.contents = 'unknown';
        c.condition = 'inspection_due';
        c.batchId = undefined;
      }
      entityId = party.id;
      message = 'Stock sent to supplier';
      break;
    }
    case 'supplier.receive': {
      const party = object(s.parties, p.supplierId, 'Supplier', ctx, s);
      if (party.type !== 'supplier') fail('Party is not supplier');
      const cs = cylinders(s, ctx, p.cylinderIds);
      for (const c of cs) {
        if (
          c.branchId !== party.branchId ||
          c.custody !== 'supplier' ||
          c.custodianId !== party.id ||
          c.gas !== p.gas ||
          c.condition === 'retired'
        )
          fail('Cylinder not due from supplier');
      }
      const b: Batch = {
        id: ctx.id(),
        number: `SUP-${String(s.batches.length + 1).padStart(5, '0')}`,
        branchId: party.branchId,
        gas: p.gas,
        cylinderIds: p.cylinderIds,
        source: p.reference,
        operator: ctx.user.id,
        status: 'awaiting_release',
        createdAt: ctx.now,
      };
      s.batches.push(b);
      for (const c of cs) {
        movement(s, ctx, c, 'supplier_receive', `plant:${c.branchId}`, p.reference, p.notes);
        c.custody = 'plant';
        c.custodianId = c.branchId;
        c.contents = 'full';
        c.condition = 'inspection_due';
        c.batchId = b.id;
      }
      entityId = b.id;
      message = 'Supplier stock received; inspection and quality release required';
      break;
    }
    case 'purchase.receive': {
      const party = object(s.parties, p.supplierId, 'Supplier', ctx, s);
      if (party.type !== 'supplier' || party.branchId !== p.branchId)
        fail('Invalid supplier branch');
      branch(s, ctx, p.branchId);
      const newIds: string[] = [];
      for (const row of p.cylinders) {
        const c = createCylinder(s, ctx, {
          ...row,
          gas: p.gas,
          branchId: p.branchId,
          contents: 'full',
        });
        newIds.push(c.id);
      }
      const b: Batch = {
        id: ctx.id(),
        number: `PUR-${String(s.batches.length + 1).padStart(5, '0')}`,
        branchId: p.branchId,
        gas: p.gas,
        cylinderIds: newIds,
        source: p.reference,
        operator: ctx.user.id,
        status: 'awaiting_release',
        createdAt: ctx.now,
      };
      s.batches.push(b);
      for (const id of newIds) s.cylinders.find((c) => c.id === id)!.batchId = b.id;
      entityId = b.id;
      message = 'Purchased stock awaiting inspection and quality release';
      break;
    }
    case 'finance.invoice': {
      const o = object(s.orders, p.orderId, 'Order', ctx, s);
      if (o.deliveredIds.length === 0) fail('No delivered quantity');
      if (
        s.invoices.some((i) => i.type === 'gas' && i.sourceId === o.id && i.status !== 'credited')
      )
        fail('Order already invoiced', 409);
      const line = {
        description: `${o.gas} ${o.size} delivery ${o.number}`,
        quantity: o.deliveredIds.length,
        unitPricePaise: o.unitPricePaise,
        amountPaise: checked(o.deliveredIds.length * o.unitPricePaise),
      };
      const i = invoice(s, ctx, {
        partyId: o.partyId,
        branchId: o.branchId,
        type: 'gas',
        sourceId: o.id,
        dueDate: p.dueDate,
        lines: [line],
        taxBps: p.taxBps,
        notes: p.notes,
      });
      entityId = i.id;
      message = 'Gas invoice issued';
      break;
    }
    case 'finance.rental': {
      const party = object(s.parties, p.partyId, 'Party', ctx, s);
      if (p.periodEnd < p.periodStart || p.periodEnd > today(ctx)) fail('Invalid rental period');
      if (
        s.invoices.some(
          (i) =>
            i.type === 'rental' &&
            i.partyId === party.id &&
            i.sourceId.startsWith('rental:') &&
            (() => {
              const [, a, b] = i.sourceId.split(':');
              return !(p.periodEnd < a || p.periodStart > b);
            })() &&
            i.status !== 'credited',
        )
      )
        fail('Rental period overlaps issued invoice', 409);
      const lines: Invoice['lines'] = [];
      for (const r of s.rentals.filter((r) => r.partyId === party.id)) {
        if (r.dailyRatePaise === 0) continue;
        const end = r.end ?? new Date(day(today(ctx)) + 86400000).toISOString().slice(0, 10);
        const startMs = Math.max(day(r.start), day(p.periodStart));
        const endMs = Math.min(day(end), day(p.periodEnd) + 86400000);
        if (endMs <= startMs) continue;
        const freeEnd = day(r.start) + r.freeDays * 86400000;
        const billDays = Math.max(0, Math.round((endMs - Math.max(startMs, freeEnd)) / 86400000));
        if (billDays)
          lines.push({
            description: `Cylinder ${s.cylinders.find((c) => c.id === r.cylinderId)?.serial ?? r.cylinderId} rental`,
            quantity: billDays,
            unitPricePaise: r.dailyRatePaise,
            amountPaise: checked(billDays * r.dailyRatePaise),
          });
      }
      if (!lines.length) fail('No billable rental days');
      const i = invoice(s, ctx, {
        partyId: party.id,
        branchId: party.branchId,
        type: 'rental',
        sourceId: `rental:${p.periodStart}:${p.periodEnd}`,
        dueDate: p.dueDate,
        lines,
        taxBps: p.taxBps,
        notes: 'Inclusive billing period; rental return date excluded',
      });
      entityId = i.id;
      message = 'Rental invoice issued';
      break;
    }
    case 'finance.receipt': {
      const i = object(s.invoices, p.invoiceId, 'Invoice', ctx, s);
      if (i.type === 'credit' || i.status === 'credited') fail('Invoice is not payable');
      if (p.amountPaise > i.totalPaise - i.paidPaise) fail('Amount exceeds outstanding balance');
      const r = addReceipt(s, ctx, {
        partyId: i.partyId,
        invoiceId: i.id,
        amountPaise: p.amountPaise,
        method: p.method,
        reference: p.reference,
        kind: 'payment',
      });
      i.paidPaise = checked(i.paidPaise + p.amountPaise);
      i.status = i.paidPaise === i.totalPaise ? 'paid' : 'partial';
      entityId = r.id;
      message = 'Payment posted';
      break;
    }
    case 'finance.deposit': {
      const party = object(s.parties, p.partyId, 'Party', ctx, s);
      const r = addReceipt(s, ctx, {
        partyId: party.id,
        amountPaise: p.amountPaise,
        method: p.method,
        reference: p.reference,
        kind: 'deposit',
      });
      entityId = r.id;
      message = 'Deposit posted';
      break;
    }
    case 'finance.refund': {
      const party = object(s.parties, p.partyId, 'Party', ctx, s);
      const balance =
        sum(
          s.receipts
            .filter((r) => r.partyId === party.id && r.kind === 'deposit')
            .map((r) => r.amountPaise),
        ) -
        sum(
          s.receipts
            .filter((r) => r.partyId === party.id && r.kind === 'refund')
            .map((r) => r.amountPaise),
        );
      if (p.amountPaise > balance) fail('Refund exceeds deposit balance');
      const r = addReceipt(s, ctx, {
        partyId: party.id,
        amountPaise: p.amountPaise,
        method: p.method,
        reference: p.reference,
        kind: 'refund',
      });
      entityId = r.id;
      message = 'Deposit refunded';
      break;
    }
    case 'finance.credit': {
      const i = object(s.invoices, p.invoiceId, 'Invoice', ctx, s);
      if (i.type === 'credit' || i.status === 'credited' || i.paidPaise > 0)
        fail('Invoice cannot be credited');
      if (s.invoices.some((x) => x.creditedInvoiceId === i.id))
        fail('Invoice already credited', 409);
      const lines = i.lines.map((l) => ({
        ...l,
        description: `Credit: ${l.description}`,
      }));
      const c = invoice(s, ctx, {
        partyId: i.partyId,
        branchId: i.branchId,
        type: 'credit',
        sourceId: i.id,
        dueDate: today(ctx),
        lines,
        taxBps: i.taxBps,
        notes: p.reason,
        creditedInvoiceId: i.id,
        billTo: i.billTo,
        issuer: i.issuer,
      });
      i.status = 'credited';
      entityId = c.id;
      message = 'Credit note issued';
      break;
    }
    case 'exception.resolve': {
      const e = object(s.exceptions, p.exceptionId, 'Exception', ctx, s);
      if (e.branchId) branch(s, ctx, e.branchId);
      const linked = [...s.cylinders, ...s.orders, ...s.batches, ...s.parties].find(
        (x) => x.id === e.entityId,
      );
      if (linked) branch(s, ctx, linked.branchId);
      else if (!e.branchId) fail('Exception scope unavailable', 403);
      if (e.status === 'resolved') fail('Exception already resolved');
      e.status = 'resolved';
      e.resolution = p.resolution;
      entityId = e.id;
      message = 'Exception resolved';
      break;
    }
    case 'settings.update': {
      Object.assign(s.settings, p);
      message = 'Settings updated';
      break;
    }
    default:
      fail('Unsupported action');
  }
  const addedMovements = s.movements.length - input.movements.length;
  for (const record of s.movements.slice(0, addedMovements)) {
    const before = input.cylinders.find((c) => c.id === record.cylinderId);
    const after = s.cylinders.find((c) => c.id === record.cylinderId);
    if (before) record.before = structuredClone(before);
    if (after) record.after = structuredClone(after);
  }
  s.revision = input.revision + 1;
  s.audit.unshift({
    id: ctx.id(),
    at: ctx.now,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: request.type,
    entityId: entityId ?? '',
    summary: message,
  });
  return { state: s, message, entityId };
}
