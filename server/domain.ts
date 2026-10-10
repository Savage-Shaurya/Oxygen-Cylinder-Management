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
import { creditNoteAvailable, invoiceOutstanding } from '../shared/finance.js';

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
      ownerAuthorizationRef: txt(200).optional(),
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
  'cylinder.empty': z
    .object({
      cylinderId: txt(100),
      version: z.number().int().nonnegative(),
      method: z.enum(['vent', 'evacuate']),
      notes: txt(500),
    })
    .strict(),
  'cylinder.offsiteIncident': z
    .object({
      cylinderId: txt(100),
      version: z.number().int().nonnegative(),
      kind: z.enum(['lost', 'damaged']),
      notes: txt(500),
    })
    .strict(),
  'rental.stopIncident': z
    .object({
      cylinderId: txt(100),
      version: z.number().int().nonnegative(),
      stopDate: date,
      reason: txt(500),
    })
    .strict(),
  'cylinder.writeoff': z
    .object({
      cylinderId: txt(100),
      version: z.number().int().nonnegative(),
      stopDate: date,
      reason: txt(500),
      ownerAuthorizationRef: txt(200).optional(),
    })
    .strict(),
  'party.create': partyFields,
  'party.update': z
    .object({
      partyId: txt(100),
      expectedVersion: z.number().int().nonnegative().optional(),
      ...partyFields.shape,
    })
    .strict(),
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
      ownerAuthorizationRef: txt(200).optional(),
    })
    .strict(),
  'order.deliver': z
    .object({
      orderId: txt(100),
      cylinderIds: ids,
      recipient: txt(120),
      notes: optional(),
      occurredAt: z.string().datetime({ offset: true }).optional(),
    })
    .strict(),
  'cylinder.return': z
    .object({
      cylinderIds: ids,
      partyId: txt(100),
      contents: z.enum(['empty', 'full', 'partial', 'unknown']),
      receivingBranchId: txt(100).optional(),
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
  'collection.reverse': z
    .object({ pickupId: txt(100), cylinderIds: ids, reason: txt(500) })
    .strict(),
  'return.discrepancy': z.object({ branchId: txt(100), serial: txt(80), notes: txt(500) }).strict(),
  'order.unload': z
    .object({
      orderId: txt(100),
      cylinderIds: ids,
      sealIntact: z.boolean().optional().default(false),
      notes: optional(),
    })
    .strict(),
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
  'batch.reject': z.object({ batchId: txt(100), cylinderId: txt(100), reason: txt(500) }).strict(),
  'supplier.send': z
    .object({
      supplierId: txt(100),
      cylinderIds: ids,
      reference: txt(100),
      service: z.enum(['fill', 'test']).optional().default('fill'),
      ownerAuthorizationRef: txt(200).optional(),
      notes: optional(),
    })
    .strict(),
  'supplier.receive': z
    .object({
      supplierId: txt(100),
      cylinderIds: ids,
      reference: txt(100),
      gas,
      service: z.enum(['fill', 'test']),
      contents: z.enum(['empty', 'full', 'partial', 'unknown']),
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
      unitPricePaise: money.optional(),
      creditLimitOverrideReason: txt(500).optional(),
    })
    .strict(),
  'finance.rental': z
    .object({
      partyId: txt(100),
      periodStart: date,
      periodEnd: date,
      taxBps: z.number().int().min(0).max(10000),
      dueDate: date,
      creditLimitOverrideReason: txt(500).optional(),
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
      overrideReason: txt(500).optional(),
    })
    .strict(),
  'finance.credit': z
    .object({ invoiceId: txt(100), amountPaise: positiveMoney.optional(), reason: txt(500) })
    .strict(),
  'finance.creditAllocate': z
    .object({
      creditInvoiceId: txt(100),
      invoiceId: txt(100),
      amountPaise: positiveMoney,
      reason: txt(500),
    })
    .strict(),
  'finance.creditUnallocate': z.object({ receiptId: txt(100), reason: txt(500) }).strict(),
  'finance.creditRefund': z
    .object({
      partyId: txt(100),
      creditInvoiceId: txt(100),
      amountPaise: positiveMoney,
      method: z.enum(['cash', 'upi', 'bank']),
      reference: txt(100),
      reason: txt(500),
    })
    .strict(),
  'exception.resolve': z.object({ exceptionId: txt(100), resolution: txt(500) }).strict(),
  'settings.update': z
    .object({
      companyName: txt(120),
      address: txt(300),
      gstin: z.string().trim().max(20),
      defaultTaxBps: z.number().int().min(0).max(10000),
      supplierOwnedRental: z.enum(['charge', 'no_charge']).optional(),
      expectedVersion: z.number().int().nonnegative().optional(),
    })
    .strict(),
  'cylinders.import': z.object({ rows: z.array(reg).min(1).max(500) }).strict(),
};
const access: Record<string, Role[]> = {
  'cylinder.register': ['admin', 'operations'],
  'cylinder.inspect': ['admin', 'quality'],
  'cylinder.retag': ['admin', 'operations'],
  'cylinder.empty': ['admin', 'quality'],
  'cylinder.offsiteIncident': ['admin', 'operations'],
  'rental.stopIncident': ['admin'],
  'cylinder.writeoff': ['admin'],
  'party.create': ['admin', 'operations', 'finance'],
  'party.update': ['admin', 'finance'],
  'order.create': ['admin', 'operations'],
  'order.cancel': ['admin', 'operations'],
  'order.dispatch': ['admin', 'operations'],
  'order.deliver': ['admin', 'operations', 'driver'],
  'cylinder.return': ['admin', 'operations'],
  'cylinder.collect': ['admin', 'operations', 'driver'],
  'collection.reverse': ['admin', 'operations'],
  'return.discrepancy': ['admin', 'operations', 'driver'],
  'order.unload': ['admin', 'operations'],
  'batch.create': ['admin', 'operations'],
  'batch.release': ['admin', 'quality'],
  'batch.recall': ['admin', 'quality'],
  'batch.reject': ['admin', 'quality'],
  'supplier.send': ['admin', 'operations'],
  'supplier.receive': ['admin', 'operations'],
  'purchase.receive': ['admin', 'operations'],
  'finance.invoice': ['admin', 'finance'],
  'finance.rental': ['admin', 'finance'],
  'finance.receipt': ['admin', 'finance'],
  'finance.deposit': ['admin', 'finance'],
  'finance.refund': ['admin', 'finance'],
  'finance.credit': ['admin', 'finance'],
  'finance.creditAllocate': ['admin', 'finance'],
  'finance.creditUnallocate': ['admin', 'finance'],
  'finance.creditRefund': ['admin', 'finance'],
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
function fiscalYear(ctx: ActionContext) {
  const d = today(ctx);
  const y = Number(d.slice(0, 4)) - (d.slice(5) < '04' ? 1 : 0);
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}
function nextNumber(existing: string[], prefix: string, ctx: ActionContext) {
  const stem = `${prefix}-${fiscalYear(ctx)}-`;
  const max = existing
    .filter((n) => n.startsWith(stem))
    .reduce((m, n) => Math.max(m, Number(n.slice(stem.length)) || 0), 0);
  return `${stem}${String(max + 1).padStart(5, '0')}`;
}
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
// Upper bound for any single amount or running balance: 2^52 paise. Adding two bounded
// values can never pass 2^53, so every step-by-step checked sum stays exact.
const MAX_MONEY_PAISE = 2 ** 52;
function checked(n: number): number {
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_MONEY_PAISE)
    fail('Money amount is out of range');
  return n;
}
function depositHeld(state: AppState, partyId: string): number {
  let total = 0n;
  for (const r of state.receipts) {
    if (r.partyId !== partyId) continue;
    if (r.kind === 'deposit') total += BigInt(r.amountPaise);
    else if (r.kind === 'refund') total -= BigInt(r.amountPaise);
  }
  if (total < 0n || total > BigInt(MAX_MONEY_PAISE)) fail('Deposit balance is out of range');
  return Number(total);
}
function customerCreditHeld(state: AppState, partyId: string): bigint {
  return state.invoices
    .filter((i) => i.partyId === partyId && i.type === 'credit')
    .reduce((n, i) => n + BigInt(creditNoteAvailable(state, i.id)), 0n);
}
// Retirement is permanent: a writeoff mark keeps a cylinder retired even if its condition was
// later changed by older code. Recovery needs a separate, explicitly authorized policy.
const isRetired = (c: Cylinder) => c.condition === 'retired' || !!c.writtenOffAt;
function notRetired(c: Cylinder) {
  if (isRetired(c)) fail(`Cylinder ${c.serial} is retired or written off and cannot be used`);
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
  if (!ctx.user.branchIds.includes(id)) fail('Branch not found', 404);
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
  if (
    item.branchId &&
    (!state.branches.some((b) => b.id === item.branchId) ||
      !ctx.user.branchIds.includes(item.branchId))
  )
    fail(`${label} not found`, 404);
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
  occurredAt = ctx.now,
) {
  const from = `${c.custody}:${c.custodianId}`;
  c.version++;
  state.movements.unshift({
    id: ctx.id(),
    cylinderId: c.id,
    action,
    from,
    to,
    at: occurredAt,
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
    size: p.size.toUpperCase(),
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
    number: nextNumber(
      state.invoices.map((x) => x.number),
      p.type === 'credit' ? 'CN' : p.type === 'rental' ? 'RINV' : 'GINV',
      ctx,
    ),
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
function receiptReference(state: AppState, _partyId: string, method: string, reference: string) {
  if (
    state.receipts.some(
      (r) => r.method === method && r.reference.toLowerCase() === reference.toLowerCase(),
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
    method: 'cash' | 'upi' | 'bank' | 'credit';
    reference: string;
    kind: 'payment' | 'deposit' | 'refund' | 'credit_refund' | 'credit_allocation';
    creditInvoiceId?: string;
    reason?: string;
    targetCreditedPaise?: number;
  },
) {
  receiptReference(state, p.partyId, p.method, p.reference);
  const r = {
    id: ctx.id(),
    number: nextNumber(
      state.receipts.map((x) => x.number),
      p.kind === 'deposit'
        ? 'DEP'
        : p.kind === 'refund'
          ? 'DREF'
          : p.kind === 'credit_refund'
            ? 'CREF'
            : p.kind === 'credit_allocation'
              ? 'CALLOC'
              : 'RCPT',
      ctx,
    ),
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

function partyHasHistory(state: AppState, partyId: string) {
  return (
    state.cylinders.some((c) => c.ownerId === partyId || c.custodianId === partyId) ||
    state.orders.some((o) => o.partyId === partyId) ||
    state.batches.some((b) => b.supplierId === partyId) ||
    state.rentals.some((r) => r.partyId === partyId) ||
    state.invoices.some((i) => i.partyId === partyId) ||
    state.receipts.some((r) => r.partyId === partyId) ||
    state.pickups?.some((p) => p.partyId === partyId) ||
    state.movements.some(
      (m) =>
        m.from === `customer:${partyId}` ||
        m.to === `customer:${partyId}` ||
        m.from === `supplier:${partyId}` ||
        m.to === `supplier:${partyId}`,
    ) ||
    state.exceptions.some((e) => e.entityId === partyId)
  );
}
function stopIncidentRent(
  state: AppState,
  ctx: ActionContext,
  c: Cylinder,
  stopDate: string,
  allowStopped = false,
) {
  if (!c.offsiteIncident) fail('Offsite incident required');
  if (stopDate > today(ctx)) fail('Stop date cannot be in the future');
  const active = state.rentals.filter((r) => r.cylinderId === c.id && !r.end);
  const stopped = state.rentals.find((r) => r.cylinderId === c.id && r.end === stopDate);
  if (allowStopped && active.length === 0 && stopped) return;
  if (active.length === 0 && c.offsiteIncident) {
    const earlier = state.rentals.filter((r) => r.cylinderId === c.id && r.end).at(-1)?.end;
    if (earlier) fail(`Rent already stopped on ${earlier}; use that date`);
  }
  if (active.length !== 1) fail('Active rental missing');
  const r = active[0];
  if (stopDate < r.start) fail('Stop date cannot precede rental start');
  if (
    state.invoices.some(
      (i) =>
        i.type === 'rental' &&
        i.partyId === r.partyId &&
        i.status !== 'credited' &&
        i.sourceId.startsWith('rental:') &&
        i.sourceId.split(':')[2] >= stopDate,
    )
  )
    fail('Stop date conflicts with already billed rental period');
  r.end = stopDate;
}
function enforceCreditLimit(
  state: AppState,
  ctx: ActionContext,
  partyId: string,
  newAmount: number,
  overrideReason?: string,
) {
  const party = state.parties.find((p) => p.id === partyId)!;
  if (party.creditLimitPaise <= 0) return;
  const exposure = state.invoices
    .filter((i) => i.partyId === partyId && i.type !== 'credit')
    .reduce((n, i) => checked(n + invoiceOutstanding(i)), 0);
  if (checked(exposure + newAmount) <= party.creditLimitPaise) return;
  if (ctx.user.role !== 'admin' || !overrideReason)
    fail('Customer credit limit exceeded; admin override reason required');
}

export function actionPermitted(type: string, role: Role): boolean {
  return Object.hasOwn(access, type) && access[type].includes(role);
}

export function applyAction(
  input: AppState,
  request: ActionRequest,
  ctx: ActionContext,
): ActionResult {
  if (!ctx.user.active || !ctx.user.orgId) fail('Access denied', 403);
  if (!actionPermitted(request.type, ctx.user.role)) fail('Action not permitted', 403);
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
      notRetired(c);
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
        fail(
          'Recalled cylinder remains on hold. Use Record emptying to clear the recalled gas, then inspect again.',
        );
      if (p.condition === 'retired' && s.rentals.some((r) => r.cylinderId === c.id && !r.end))
        fail('Cannot retire active rental');
      if (p.condition === 'retired' && c.ownerId !== 'company' && !p.ownerAuthorizationRef)
        fail('Owner authorization reference required');
      c.condition = p.condition;
      movement(
        s,
        ctx,
        c,
        'inspection',
        `${c.custody}:${c.custodianId}`,
        c.id,
        p.ownerAuthorizationRef
          ? `${p.notes}; owner authorization ${p.ownerAuthorizationRef}`
          : p.notes,
      );
      entityId = c.id;
      message = `Cylinder ${p.condition}`;
      break;
    }
    case 'cylinder.retag': {
      const c = object(s.cylinders, p.cylinderId, 'Cylinder', ctx, s);
      if (c.version !== p.version) fail('Cylinder version changed', 409);
      notRetired(c);
      if (c.custody !== 'plant') fail('Cylinder must be at plant for retag');
      if (tagUsed(s, p.tag)) fail('Tag already exists', 409);
      c.previousTags ??= [];
      c.previousTags.push(c.tag);
      c.tag = p.tag;
      movement(s, ctx, c, 'retag', `${c.custody}:${c.custodianId}`, c.id, p.reason);
      entityId = c.id;
      message = 'Tag updated';
      break;
    }
    case 'cylinder.empty': {
      const c = object(s.cylinders, p.cylinderId, 'Cylinder', ctx, s);
      if (c.version !== p.version) fail('Cylinder version changed', 409);
      notRetired(c);
      if (c.custody !== 'plant' || c.condition === 'retired')
        fail('Cylinder must be active at plant');
      // An empty cylinder still linked to a recalled batch needs this record to clear the hold.
      const recalledLink =
        !!c.batchId && s.batches.find((b) => b.id === c.batchId)?.status === 'recalled';
      if (c.contents === 'empty' && !recalledLink) fail('Cylinder is already empty');
      if (c.batchId && s.batches.find((b) => b.id === c.batchId)?.status === 'awaiting_release')
        fail('Reject cylinder from awaiting batch first');
      movement(s, ctx, c, 'empty', `plant:${c.branchId}`, c.id, `${p.method}: ${p.notes}`);
      c.contents = 'empty';
      c.batchId = undefined;
      entityId = c.id;
      message = 'Cylinder emptying recorded';
      break;
    }
    case 'cylinder.offsiteIncident': {
      const c = object(s.cylinders, p.cylinderId, 'Cylinder', ctx, s);
      if (c.version !== p.version) fail('Cylinder version changed', 409);
      notRetired(c);
      const pickup =
        c.custody === 'vehicle' ? s.pickups?.find((x) => x.id === c.custodianId) : undefined;
      if (c.custody !== 'customer' && !pickup) fail('Cylinder is not held offsite');
      if (c.offsiteIncident) fail('Offsite incident already recorded', 409);
      const active = s.rentals.filter((r) => r.cylinderId === c.id && !r.end);
      if (active.length !== 1) fail('Active rental missing');
      movement(s, ctx, c, `offsite_${p.kind}`, `${c.custody}:${c.custodianId}`, c.id, p.notes);
      c.condition = 'quarantine';
      c.offsiteIncident = { kind: p.kind, at: ctx.now, notes: p.notes };
      s.exceptions.push({
        id: ctx.id(),
        at: ctx.now,
        type: `offsite_${p.kind}`,
        summary: `${c.serial}: ${p.notes}`,
        entityId: c.id,
        branchId: c.branchId,
        status: 'open',
      });
      entityId = c.id;
      message = `${p.kind === 'lost' ? 'Loss' : 'Damage'} recorded`;
      break;
    }
    case 'rental.stopIncident': {
      const c = object(s.cylinders, p.cylinderId, 'Cylinder', ctx, s);
      if (c.version !== p.version) fail('Cylinder version changed', 409);
      notRetired(c);
      stopIncidentRent(s, ctx, c, p.stopDate);
      movement(
        s,
        ctx,
        c,
        'rental_stop_incident',
        `${c.custody}:${c.custodianId}`,
        c.id,
        `${p.stopDate}: ${p.reason}`,
      );
      entityId = c.id;
      message = 'Incident rental stopped by administrator';
      break;
    }
    case 'cylinder.writeoff': {
      const c = object(s.cylinders, p.cylinderId, 'Cylinder', ctx, s);
      if (c.version !== p.version) fail('Cylinder version changed', 409);
      notRetired(c);
      if (c.offsiteIncident?.kind !== 'lost' || c.custody === 'plant' || c.condition === 'retired')
        fail('Unrecovered lost cylinder required');
      if (c.ownerId !== 'company' && !p.ownerAuthorizationRef)
        fail('Owner authorization reference required');
      stopIncidentRent(s, ctx, c, p.stopDate, true);
      c.condition = 'retired';
      c.writtenOffAt = ctx.now;
      movement(
        s,
        ctx,
        c,
        'writeoff',
        `${c.custody}:${c.custodianId}`,
        c.id,
        `${p.stopDate}: ${p.reason}${p.ownerAuthorizationRef ? `; owner authorization ${p.ownerAuthorizationRef}` : ''}`,
      );
      const e = s.exceptions.find(
        (x) => x.entityId === c.id && x.type === 'offsite_lost' && x.status === 'open',
      );
      if (e) {
        e.status = 'resolved';
        e.resolution = `Written off: ${p.reason}`;
      }
      entityId = c.id;
      message = 'Lost cylinder written off';
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
      if (p.expectedVersion !== undefined && p.expectedVersion !== (x.version ?? 1))
        fail('Party version changed', 409);
      branch(s, ctx, p.branchId);
      if (p.branchId !== x.branchId) fail('Party branch cannot change');
      if (
        s.parties.some(
          (other) =>
            other.id !== x.id &&
            other.branchId === x.branchId &&
            other.name.toLowerCase() === p.name.toLowerCase(),
        )
      )
        fail('Party already exists', 409);
      const previousType = x.type;
      if (p.type !== previousType && partyHasHistory(s, x.id))
        fail('Party type cannot change after activity');
      const { expectedVersion, ...fields } = p;
      Object.assign(x, fields);
      delete (x as any).partyId;
      x.version = (x.version ?? 1) + 1;
      entityId = x.id;
      message =
        p.type === previousType
          ? 'Party updated'
          : `Party classification corrected from ${previousType} to ${p.type}`;
      break;
    }
    case 'order.create': {
      branch(s, ctx, p.branchId);
      if (p.dueDate < today(ctx)) fail('Requested order date cannot be in the past');
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
        size: p.size.toUpperCase(),
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
      o.cancelReason = p.reason;
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
        notRetired(c);
        const owner = s.parties.find((party) => party.id === c.ownerId);
        if (
          c.branchId !== o.branchId ||
          c.gas !== o.gas ||
          c.size !== o.size ||
          (c.ownerId !== 'company' && c.ownerId !== o.partyId && owner?.type !== 'supplier') ||
          c.custody !== 'plant' ||
          c.condition !== 'serviceable' ||
          c.contents !== 'full' ||
          !dueValid(c, ctx)
        )
          fail('Cylinder is not dispatchable');
        const b = s.batches.find((b) => b.id === c.batchId);
        if (!b || b.status !== 'released' || b.branchId !== o.branchId)
          fail('Released batch required');
        if (owner?.type === 'supplier' && !p.ownerAuthorizationRef)
          fail('Owner authorization reference required for supplier-owned dispatch');
      }
      o.cylinderIds = [...p.cylinderIds];
      const recipient = object(s.parties, o.partyId, 'Party', ctx, s);
      o.challanSnapshot = {
        issuer: {
          companyName: s.settings.companyName,
          address: s.settings.address,
          gstin: s.settings.gstin,
        },
        recipient: {
          name: recipient.name,
          address: recipient.address,
          city: recipient.city,
          gstin: recipient.gstin,
        },
      };
      o.vehicle = p.vehicle;
      o.driverId = p.driverId;
      o.status = 'dispatched';
      for (const c of cs) {
        movement(
          s,
          ctx,
          c,
          'dispatch',
          `vehicle:${o.id}`,
          o.id,
          p.ownerAuthorizationRef ? `Owner authorization ${p.ownerAuthorizationRef}` : '',
        );
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
      const occurredAt = p.occurredAt ? new Date(p.occurredAt).toISOString() : ctx.now;
      const elapsed = Date.parse(ctx.now) - Date.parse(occurredAt);
      if (elapsed < 0 || elapsed > 12 * 60 * 60 * 1000)
        fail('Delivery time must be within the past 12 hours');
      for (const c of cs) {
        notRetired(c);
        const dispatch = s.movements.find(
          (m) => m.cylinderId === c.id && m.action === 'dispatch' && m.reference === o.id,
        );
        if (!dispatch || Date.parse(occurredAt) < Date.parse(dispatch.at))
          fail('Delivery cannot predate dispatch');
        if (
          c.custody !== 'vehicle' ||
          c.custodianId !== o.id ||
          c.condition !== 'serviceable' ||
          !dueValid(c, ctx) ||
          s.batches.find((b) => b.id === c.batchId)?.status !== 'released'
        )
          fail('Cylinder cannot be delivered');
        const start = istDay(occurredAt);
        const dailyRatePaise =
          c.ownerId === party.id ||
          (s.parties.find((x) => x.id === c.ownerId)?.type === 'supplier' &&
            s.settings.supplierOwnedRental === 'no_charge')
            ? 0
            : party.dailyRentalPaise;
        const freeDays = c.ownerId === party.id ? 0 : party.freeDays;
        // A late delivery must not add rent to a day that is already invoiced: that rent
        // could never be billed (overlap rule) and would silently go missing.
        const firstBillable = new Date(day(start) + freeDays * 86400000).toISOString().slice(0, 10);
        const billed =
          dailyRatePaise > 0
            ? s.invoices.find(
                (i) =>
                  i.type === 'rental' &&
                  i.partyId === party.id &&
                  i.status !== 'credited' &&
                  i.sourceId.startsWith('rental:') &&
                  firstBillable <= i.sourceId.split(':')[2],
              )
            : undefined;
        if (billed)
          fail(
            `Rent for ${start} is already invoiced (${billed.number}). Use the current time, or credit that rental invoice first.`,
          );
        movement(s, ctx, c, 'delivery', `customer:${party.id}`, o.id, p.notes, occurredAt);
        c.custody = 'customer';
        c.custodianId = party.id;
        o.deliveredIds.push(c.id);
        s.rentals.push({
          id: ctx.id(),
          cylinderId: c.id,
          partyId: party.id,
          orderId: o.id,
          start,
          dailyRatePaise,
          freeDays,
        });
      }
      o.deliveryProofs ??= [];
      o.deliveryProofs.push({
        cylinderIds: [...p.cylinderIds],
        recipient: p.recipient,
        at: occurredAt,
        actorId: ctx.user.id,
        notes: p.notes,
      });
      o.recipient = p.recipient;
      o.deliveredAt = occurredAt;
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
        notRetired(c);
        if (c.custody !== 'vehicle' || c.custodianId !== o.id) fail('Cylinder not on this vehicle');
        if (
          p.sealIntact &&
          (c.contents !== 'full' ||
            c.condition !== 'serviceable' ||
            !dueValid(c, ctx) ||
            s.batches.find((b) => b.id === c.batchId)?.status !== 'released')
        )
          fail('Only safe released full stock can retain its seal');
        movement(s, ctx, c, 'unload', `plant:${o.branchId}`, o.id, p.notes);
        c.custody = 'plant';
        c.custodianId = o.branchId;
        if (!p.sealIntact) {
          if (c.condition !== 'quarantine') c.condition = 'inspection_due';
          c.contents = 'unknown';
          if (c.condition !== 'quarantine') c.batchId = undefined;
        }
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
        notRetired(c);
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
    case 'collection.reverse': {
      const pickup = object(s.pickups ?? [], p.pickupId, 'Pickup', ctx, s);
      const party = object(s.parties, pickup.partyId, 'Party', ctx, s);
      const cs = cylinders(s, ctx, p.cylinderIds);
      for (const c of cs) {
        notRetired(c);
        if (
          !pickup.cylinderIds.includes(c.id) ||
          pickup.receivedIds.includes(c.id) ||
          pickup.reversedIds?.includes(c.id) ||
          c.custody !== 'vehicle' ||
          c.custodianId !== pickup.id ||
          c.offsiteIncident
        )
          fail('Cylinder is no longer on pickup vehicle');
        if (!s.rentals.some((r) => r.cylinderId === c.id && r.partyId === party.id && !r.end))
          fail('Active rental missing');
      }
      for (const c of cs) {
        movement(s, ctx, c, 'collection_reverse', `customer:${party.id}`, pickup.id, p.reason);
        c.custody = 'customer';
        c.custodianId = party.id;
        pickup.reversedIds ??= [];
        pickup.reversedIds.push(c.id);
      }
      entityId = pickup.id;
      message = 'Collection reversed';
      break;
    }
    case 'return.discrepancy': {
      branch(s, ctx, p.branchId);
      if (ctx.user.role === 'driver') {
        const assignedOrder = s.orders.some(
          (o) =>
            o.branchId === p.branchId &&
            o.driverId === ctx.user.id &&
            (o.status === 'dispatched' ||
              o.status === 'partial' ||
              (o.status === 'delivered' &&
                !!o.deliveredAt &&
                istDay(o.deliveredAt) === today(ctx))),
        );
        const assignedPickup = s.pickups?.some(
          (x) =>
            x.branchId === p.branchId &&
            x.driverId === ctx.user.id &&
            x.cylinderIds.some((id) => !x.receivedIds.includes(id) && !x.reversedIds?.includes(id)),
        );
        if (!assignedOrder && !assignedPickup) fail('No current assigned work for branch', 403);
      }
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
      const receivingBranchId = p.receivingBranchId ?? party.branchId;
      branch(s, ctx, receivingBranchId);
      const cs = cylinders(s, ctx, p.cylinderIds);
      for (const c of cs) {
        notRetired(c);
        const pickup =
          c.custody === 'vehicle' ? s.pickups?.find((x) => x.id === c.custodianId) : undefined;
        const customerHeld = c.custody === 'customer' && c.custodianId === party.id;
        const pickupHeld =
          pickup?.partyId === party.id &&
          pickup.branchId === party.branchId &&
          pickup.cylinderIds.includes(c.id) &&
          !pickup.reversedIds?.includes(c.id) &&
          !pickup.receivedIds.includes(c.id);
        if (c.branchId !== party.branchId || (!customerHeld && !pickupHeld))
          fail('Cylinder is not held by this customer');
        if (receivingBranchId !== c.branchId && c.ownerId !== 'company')
          fail('Third-party-owned cylinder must return to its owning branch');
        const active = s.rentals.filter((r) => r.cylinderId === c.id && !r.end);
        if (active.length !== 1 && !(active.length === 0 && c.offsiteIncident))
          fail('Active rental missing');
        movement(s, ctx, c, 'return', `plant:${receivingBranchId}`, party.id, p.notes);
        c.custody = 'plant';
        c.custodianId = receivingBranchId;
        c.branchId = receivingBranchId;
        c.contents = p.contents;
        if (c.offsiteIncident && s.batches.find((b) => b.id === c.batchId)?.status !== 'recalled') {
          c.batchId = undefined;
        }
        if (c.condition !== 'quarantine') {
          c.condition = 'inspection_due';
          c.batchId = undefined;
        }
        if (active[0]) active[0].end = today(ctx);
        c.offsiteIncident = undefined;
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
        notRetired(c);
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
        fillOperator: p.operator,
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
      if (b.operator === ctx.user.id)
        fail(
          'You recorded this batch, so someone else must release it. Sign in as a Quality user to release it.',
          403,
        );
      const cs = cylinders(s, ctx, b.cylinderIds);
      for (const c of cs) {
        notRetired(c);
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
    case 'batch.reject': {
      const b = object(s.batches, p.batchId, 'Batch', ctx, s);
      if (b.status !== 'awaiting_release') fail('Batch is not awaiting release');
      if (!b.cylinderIds.includes(p.cylinderId)) fail('Cylinder is not in batch');
      if (b.cylinderIds.length === 1) fail('Cannot reject final batch member; recall batch');
      const c = object(s.cylinders, p.cylinderId, 'Cylinder', ctx, s);
      notRetired(c);
      if (c.batchId !== b.id || c.custody !== 'plant')
        fail('Cylinder is not awaiting release at plant');
      movement(s, ctx, c, 'batch_reject', `plant:${c.branchId}`, b.id, p.reason);
      c.batchId = undefined;
      c.contents = 'unknown';
      c.condition = 'quarantine';
      b.cylinderIds = b.cylinderIds.filter((id) => id !== c.id);
      b.rejectedCylinderIds ??= [];
      b.rejectedCylinderIds.push(c.id);
      entityId = b.id;
      message = 'Cylinder rejected from batch';
      break;
    }
    case 'batch.recall': {
      const b = object(s.batches, p.batchId, 'Batch', ctx, s);
      if (b.status === 'recalled') fail('Batch already recalled');
      b.status = 'recalled';
      const deliveries = s.movements.filter(
        (m) => m.action === 'delivery' && m.before?.batchId === b.id,
      );
      b.recipientTrace = deliveries.map((m) => {
        const order = s.orders.find((o) => o.id === m.reference);
        return {
          cylinderId: m.cylinderId,
          partyId: order?.partyId ?? m.to.replace(/^customer:/, ''),
          orderId: m.reference,
          at: m.at,
        };
      });
      // Batch.cylinderIds is historical membership. Only cylinders still carrying this batch
      // hold its gas; former members stay in the recipient trace and are not looked up here.
      const flagged: string[] = [];
      let held = 0;
      for (const id of b.cylinderIds) {
        const c = s.cylinders.find((x) => x.id === id);
        if (!c || isRetired(c) || c.batchId !== b.id) continue;
        if (!ctx.user.branchIds.includes(c.branchId)) {
          // Recalled-batch status already blocks release, dispatch and delivery everywhere.
          // The other branch gets an open task to put this cylinder on hold.
          s.exceptions.push({
            id: ctx.id(),
            at: ctx.now,
            type: 'recall_branch_hold',
            summary: `Hold ${c.serial} for recall of ${b.number}: ${p.reason}`,
            entityId: c.id,
            branchId: c.branchId,
            status: 'open',
          });
          flagged.push(c.serial);
          continue;
        }
        held++;
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
      message = flagged.length
        ? `Batch recalled; ${held} quarantined. ${flagged.length} in another branch sent to that branch to hold: ${flagged.join(', ')}`
        : 'Batch recalled and stock quarantined';
      break;
    }
    case 'supplier.send': {
      const party = object(s.parties, p.supplierId, 'Supplier', ctx, s);
      if (party.type !== 'supplier') fail('Party is not supplier');
      const cs = cylinders(s, ctx, p.cylinderIds);
      for (const c of cs) {
        notRetired(c);
        const safeForFill = c.condition === 'serviceable' && dueValid(c, ctx);
        const safeForTest = ['serviceable', 'inspection_due', 'testing'].includes(c.condition);
        if (
          c.branchId !== party.branchId ||
          c.custody !== 'plant' ||
          !(p.service === 'test' ? safeForTest : safeForFill) ||
          c.contents !== 'empty' ||
          (c.batchId && s.batches.find((b) => b.id === c.batchId)?.status !== 'recalled')
        )
          fail('Only safe empty cylinders can transfer to supplier');
        if (c.ownerId !== 'company' && !p.ownerAuthorizationRef)
          fail('Owner authorization reference required');
        movement(
          s,
          ctx,
          c,
          'supplier_send',
          `supplier:${party.id}`,
          p.reference,
          `${p.service}: ${p.notes}${p.ownerAuthorizationRef ? `; owner authorization ${p.ownerAuthorizationRef}` : ''}`,
        );
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
        notRetired(c);
        if (
          c.branchId !== party.branchId ||
          c.custody !== 'supplier' ||
          c.custodianId !== party.id ||
          c.gas !== p.gas ||
          c.condition === 'retired'
        )
          fail('Cylinder not due from supplier');
      }
      if (p.service === 'fill' && p.contents !== 'full') fail('Filled supplier stock must be full');
      if (p.service === 'test' && p.contents === 'full')
        fail('Test-only return cannot assert filled contents');
      const b: Batch | undefined =
        p.service === 'fill'
          ? {
              id: ctx.id(),
              number: `SUP-${String(s.batches.length + 1).padStart(5, '0')}`,
              branchId: party.branchId,
              gas: p.gas,
              supplierId: party.id,
              cylinderIds: p.cylinderIds,
              source: p.reference,
              operator: ctx.user.id,
              status: 'awaiting_release',
              createdAt: ctx.now,
            }
          : undefined;
      if (b) s.batches.push(b);
      for (const c of cs) {
        movement(s, ctx, c, 'supplier_receive', `plant:${c.branchId}`, p.reference, p.notes);
        c.custody = 'plant';
        c.custodianId = c.branchId;
        c.contents = p.contents;
        c.condition = 'inspection_due';
        c.batchId = b?.id;
      }
      entityId = b?.id ?? party.id;
      message = b
        ? 'Supplier stock received; inspection and quality release required'
        : 'Tested supplier stock received for inspection';
      break;
    }
    case 'purchase.receive': {
      const party = object(s.parties, p.supplierId, 'Supplier', ctx, s);
      if (party.type !== 'supplier' || party.branchId !== p.branchId)
        fail('Invalid supplier branch');
      branch(s, ctx, p.branchId);
      if (
        s.batches.some(
          (b) => b.supplierId === party.id && b.source.toLowerCase() === p.reference.toLowerCase(),
        )
      )
        fail('Supplier purchase reference already recorded', 409);
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
        supplierId: party.id,
        cylinderIds: newIds,
        source: p.reference,
        notes: p.notes,
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
      if (p.dueDate < today(ctx)) fail('Due date cannot precede issue date');
      if (o.deliveredIds.length === 0) fail('No delivered quantity');
      if (o.status !== 'delivered' && o.status !== 'closed_short')
        fail('Finish delivery or unload remaining vehicle stock before invoicing');
      if (
        s.invoices.some((i) => i.type === 'gas' && i.sourceId === o.id && i.status !== 'credited')
      )
        fail('Order already invoiced', 409);
      if ((p.unitPricePaise ?? o.unitPricePaise) === 0) fail('Approved gas price required');
      const line = {
        description: `${o.gas} ${o.size} delivery ${o.number}`,
        quantity: o.deliveredIds.length,
        unitPricePaise: p.unitPricePaise ?? o.unitPricePaise,
        amountPaise: checked(o.deliveredIds.length * (p.unitPricePaise ?? o.unitPricePaise)),
      };
      enforceCreditLimit(
        s,
        ctx,
        o.partyId,
        checked(line.amountPaise + tax(line.amountPaise, p.taxBps)),
        p.creditLimitOverrideReason,
      );
      const i = invoice(s, ctx, {
        partyId: o.partyId,
        branchId: o.branchId,
        type: 'gas',
        sourceId: o.id,
        dueDate: p.dueDate,
        lines: [line],
        taxBps: p.taxBps,
        notes: `${p.notes}${p.creditLimitOverrideReason ? `; credit-limit override: ${p.creditLimitOverrideReason}` : ''}`,
      });
      entityId = i.id;
      message = 'Gas invoice issued';
      break;
    }
    case 'finance.rental': {
      const party = object(s.parties, p.partyId, 'Party', ctx, s);
      if (p.dueDate < today(ctx)) fail('Due date cannot precede issue date');
      if (p.periodEnd < p.periodStart || p.periodEnd >= today(ctx))
        fail('Rental period must contain closed days only');
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
      const subtotal = checked(sum(lines.map((l) => l.amountPaise)));
      enforceCreditLimit(
        s,
        ctx,
        party.id,
        checked(subtotal + tax(subtotal, p.taxBps)),
        p.creditLimitOverrideReason,
      );
      const i = invoice(s, ctx, {
        partyId: party.id,
        branchId: party.branchId,
        type: 'rental',
        sourceId: `rental:${p.periodStart}:${p.periodEnd}`,
        dueDate: p.dueDate,
        lines,
        taxBps: p.taxBps,
        notes: `Inclusive billing period; rental return date excluded${p.creditLimitOverrideReason ? `; credit-limit override: ${p.creditLimitOverrideReason}` : ''}`,
      });
      entityId = i.id;
      message = 'Rental invoice issued';
      break;
    }
    case 'finance.receipt': {
      const i = object(s.invoices, p.invoiceId, 'Invoice', ctx, s);
      if (i.type === 'credit' || i.status === 'credited') fail('Invoice is not payable');
      if (p.amountPaise > invoiceOutstanding(i)) fail('Amount exceeds outstanding balance');
      const r = addReceipt(s, ctx, {
        partyId: i.partyId,
        invoiceId: i.id,
        amountPaise: p.amountPaise,
        method: p.method,
        reference: p.reference,
        kind: 'payment',
      });
      i.paidPaise = checked(i.paidPaise + p.amountPaise);
      i.status = invoiceOutstanding(i) === 0 ? 'paid' : 'partial';
      entityId = r.id;
      message = 'Payment posted';
      break;
    }
    case 'finance.deposit': {
      const party = object(s.parties, p.partyId, 'Party', ctx, s);
      if (party.type === 'supplier') fail('Supplier cannot provide customer deposit');
      if (p.amountPaise > MAX_MONEY_PAISE - depositHeld(s, party.id))
        fail('Deposit balance would exceed the allowed limit');
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
      const balance = depositHeld(s, party.id);
      if (p.amountPaise > balance) fail('Refund exceeds deposit balance');
      const held = s.cylinders.some(
        (c) =>
          (c.custody === 'customer' && c.custodianId === party.id) ||
          (c.custody === 'vehicle' &&
            s.pickups?.some(
              (x) =>
                x.id === c.custodianId && x.partyId === party.id && !x.receivedIds.includes(c.id),
            )),
      );
      const owed = s.invoices.some((i) => i.partyId === party.id && invoiceOutstanding(i) > 0);
      if ((held || owed) && (ctx.user.role !== 'admin' || !p.overrideReason))
        fail('Held cylinders or outstanding invoices require admin override reason');
      const r = addReceipt(s, ctx, {
        partyId: party.id,
        amountPaise: p.amountPaise,
        method: p.method,
        reference: p.reference,
        kind: 'refund',
        reason: `${p.reason}${p.overrideReason ? `; override: ${p.overrideReason}` : ''}`,
      });
      entityId = r.id;
      message = 'Deposit refunded';
      break;
    }
    case 'finance.credit': {
      const i = object(s.invoices, p.invoiceId, 'Invoice', ctx, s);
      if (i.type === 'credit' || i.status === 'credited') fail('Invoice cannot be credited');
      if ((i.appliedCreditPaise ?? 0) > 0)
        fail('Reverse allocated customer credit before correcting invoice');
      const amount = p.amountPaise ?? i.totalPaise - (i.creditedPaise ?? 0);
      if (amount <= 0 || amount > i.totalPaise - (i.creditedPaise ?? 0))
        fail('Credit exceeds uncorrected invoice amount');
      const offset = Math.min(amount, invoiceOutstanding(i));
      const priorTax = sum(
        s.invoices
          .filter((x) => x.type === 'credit' && x.creditedInvoiceId === i.id)
          .map((x) => x.taxPaise),
      );
      const cumulativeTax = Number(
        (BigInt(i.taxPaise) * BigInt((i.creditedPaise ?? 0) + amount) +
          BigInt(Math.floor(i.totalPaise / 2))) /
          BigInt(i.totalPaise),
      );
      const creditTax = cumulativeTax - priorTax;
      const net = amount - creditTax;
      const lines = [
        { description: `Credit: ${i.number}`, quantity: 1, unitPricePaise: net, amountPaise: net },
      ];
      const c = invoice(s, ctx, {
        partyId: i.partyId,
        branchId: i.branchId,
        type: 'credit',
        sourceId: i.id,
        dueDate: today(ctx),
        lines,
        taxBps: 0,
        notes: p.reason,
        creditedInvoiceId: i.id,
        billTo: i.billTo,
        issuer: i.issuer,
      });
      c.taxBps = i.taxBps;
      c.taxPaise = creditTax;
      c.totalPaise = amount;
      c.creditOffsetPaise = offset;
      i.creditedPaise = checked((i.creditedPaise ?? 0) + amount);
      if (customerCreditHeld(s, i.partyId) > BigInt(MAX_MONEY_PAISE))
        fail('Customer credit would exceed the allowed limit');
      i.status =
        i.creditedPaise === i.totalPaise
          ? 'credited'
          : invoiceOutstanding(i) === 0
            ? 'paid'
            : i.paidPaise > 0
              ? 'partial'
              : 'issued';
      entityId = c.id;
      message = 'Credit note issued';
      break;
    }
    case 'finance.creditAllocate': {
      const note = object(s.invoices, p.creditInvoiceId, 'Credit note', ctx, s);
      const target = object(s.invoices, p.invoiceId, 'Invoice', ctx, s);
      if (
        note.type !== 'credit' ||
        target.type === 'credit' ||
        note.partyId !== target.partyId ||
        note.id === target.id
      )
        fail('Credit allocation requires same customer');
      if (
        p.amountPaise > creditNoteAvailable(s, note.id) ||
        p.amountPaise > invoiceOutstanding(target)
      )
        fail('Credit allocation exceeds available balance');
      const r = addReceipt(s, ctx, {
        partyId: target.partyId,
        invoiceId: target.id,
        creditInvoiceId: note.id,
        amountPaise: p.amountPaise,
        method: 'credit',
        reference: `${note.id}:${target.id}:${ctx.id()}`,
        kind: 'credit_allocation',
        reason: p.reason,
        targetCreditedPaise: target.creditedPaise ?? 0,
      });
      target.appliedCreditPaise = checked((target.appliedCreditPaise ?? 0) + p.amountPaise);
      target.status = invoiceOutstanding(target) === 0 ? 'paid' : 'partial';
      entityId = r.id;
      message = 'Customer credit allocated';
      break;
    }
    case 'finance.creditRefund': {
      const party = object(s.parties, p.partyId, 'Party', ctx, s);
      const note = object(s.invoices, p.creditInvoiceId, 'Credit note', ctx, s);
      if (note.type !== 'credit' || note.partyId !== party.id)
        fail('Credit note does not belong to customer');
      if (p.amountPaise > creditNoteAvailable(s, note.id))
        fail('Refund exceeds available customer credit');
      const r = addReceipt(s, ctx, {
        partyId: party.id,
        creditInvoiceId: note.id,
        amountPaise: p.amountPaise,
        method: p.method,
        reference: p.reference,
        kind: 'credit_refund',
        reason: p.reason,
      });
      entityId = r.id;
      message = 'Customer credit refunded';
      break;
    }
    case 'finance.creditUnallocate': {
      const original =
        s.receipts.find((r) => r.id === p.receiptId && r.kind === 'credit_allocation') ??
        fail('Credit allocation not found', 404);
      const targetId = original.invoiceId ?? fail('Credit allocation references unavailable');
      const creditId = original.creditInvoiceId ?? fail('Credit allocation references unavailable');
      const target = object(s.invoices, targetId, 'Invoice', ctx, s);
      object(s.invoices, creditId, 'Credit note', ctx, s);
      if (original.reversedAt) fail('Credit allocation already reversed', 409);
      // A correction made before this allocation is safe to keep. Reversal is refused if the
      // invoice was corrected since (older allocations did not record the corrected amount).
      const correctedSince = (target.creditedPaise ?? 0) !== (original.targetCreditedPaise ?? 0);
      if (target.status === 'credited' || correctedSince)
        fail('Cannot reverse allocation after invoice correction', 409);
      if ((target.appliedCreditPaise ?? 0) < original.amountPaise)
        fail('Credit allocation balance invalid');
      original.reversedAt = ctx.now;
      original.reversalReason = p.reason;
      target.appliedCreditPaise = checked((target.appliedCreditPaise ?? 0) - original.amountPaise);
      target.status =
        (target.creditedPaise ?? 0) === target.totalPaise ||
        (target.status === 'credited' && target.creditedPaise === undefined)
          ? 'credited'
          : invoiceOutstanding(target) === 0
            ? 'paid'
            : target.paidPaise > 0
              ? 'partial'
              : 'issued';
      entityId = original.id;
      message = `Credit allocation reversed: ${p.reason}`;
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
      if (
        e.type === 'recall_recovery' ||
        e.type === 'offsite_lost' ||
        e.type === 'offsite_damaged'
      ) {
        const cylinder = s.cylinders.find((c) => c.id === e.entityId);
        if (cylinder && cylinder.custody !== 'plant') fail('Cylinder is still offsite');
      }
      if (e.type === 'recall_branch_hold') {
        const cylinder = s.cylinders.find((c) => c.id === e.entityId);
        if (
          cylinder &&
          cylinder.condition !== 'quarantine' &&
          !isRetired(cylinder) &&
          s.batches.find((b) => b.id === cylinder.batchId)?.status === 'recalled'
        )
          fail('Put the cylinder in quarantine before closing this recall task');
      }
      e.status = 'resolved';
      e.resolution = p.resolution;
      entityId = e.id;
      message = 'Exception resolved';
      break;
    }
    case 'settings.update': {
      if (p.expectedVersion !== undefined && p.expectedVersion !== (s.settings.version ?? 1))
        fail('Settings version changed', 409);
      const { expectedVersion, ...fields } = p;
      Object.assign(s.settings, fields);
      s.settings.version = (s.settings.version ?? 1) + 1;
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
