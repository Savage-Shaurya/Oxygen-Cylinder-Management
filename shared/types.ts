export type Role = 'admin' | 'operations' | 'quality' | 'finance' | 'driver' | 'auditor';
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  branchIds: string[];
  orgId: string;
  active: boolean;
}
export interface Branch {
  id: string;
  name: string;
  city: string;
}
export type Gas = 'Medical oxygen' | 'Industrial oxygen';
export type Condition = 'serviceable' | 'inspection_due' | 'quarantine' | 'testing' | 'retired';
export type Contents = 'empty' | 'full' | 'partial' | 'unknown';
export type Custody = 'plant' | 'vehicle' | 'customer' | 'supplier';
export interface Cylinder {
  id: string;
  serial: string;
  tag: string;
  manufacturer: string;
  gas: Gas;
  size: string;
  ownerId: string;
  branchId: string;
  custody: Custody;
  custodianId: string;
  condition: Condition;
  contents: Contents;
  testDue: string;
  lastTest: string;
  certificate: string;
  batchId?: string;
  version: number;
  createdAt: string;
  previousTags?: string[];
  offsiteIncident?: { kind: 'lost' | 'damaged'; at: string; notes: string };
  writtenOffAt?: string;
}
export interface Party {
  id: string;
  name: string;
  type: 'hospital' | 'homecare' | 'industrial' | 'supplier';
  contact: string;
  phone: string;
  address: string;
  city: string;
  gstin: string;
  branchId: string;
  creditLimitPaise: number;
  dailyRentalPaise: number;
  freeDays: number;
  depositPaise: number;
  version?: number;
}
export interface Order {
  id: string;
  number: string;
  partyId: string;
  branchId: string;
  gas: Gas;
  size: string;
  quantity: number;
  priority: 'normal' | 'urgent';
  dueDate: string;
  notes: string;
  unitPricePaise: number;
  status: 'open' | 'dispatched' | 'partial' | 'delivered' | 'closed_short' | 'cancelled';
  cancelReason?: string;
  cylinderIds: string[];
  deliveredIds: string[];
  vehicle: string;
  driverId: string;
  createdAt: string;
  recipient?: string;
  deliveredAt?: string;
  unloadedIds?: string[];
  deliveryProofs?: {
    cylinderIds: string[];
    recipient: string;
    at: string;
    actorId: string;
    notes: string;
  }[];
  challanSnapshot?: {
    issuer: { companyName: string; address: string; gstin: string };
    recipient: { name: string; address: string; city: string; gstin: string };
  };
}
export interface ReturnPickup {
  id: string;
  partyId: string;
  branchId: string;
  driverId: string;
  vehicle: string;
  cylinderIds: string[];
  receivedIds: string[];
  reversedIds?: string[];
  createdAt: string;
  notes: string;
}
export interface Batch {
  id: string;
  number: string;
  branchId: string;
  gas: Gas;
  supplierId?: string;
  cylinderIds: string[];
  source: string;
  operator: string;
  fillOperator?: string;
  notes?: string;
  status: 'awaiting_release' | 'released' | 'recalled';
  createdAt: string;
  releasedAt?: string;
  releasedBy?: string;
  certificate?: string;
  qualityNotes?: string;
  rejectedCylinderIds?: string[];
  recipientTrace?: { cylinderId: string; partyId: string; orderId: string; at: string }[];
}
export interface Movement {
  id: string;
  cylinderId: string;
  action: string;
  from: string;
  to: string;
  at: string;
  actorId: string;
  actorName: string;
  reference: string;
  notes: string;
  before?: Partial<Cylinder>;
  after?: Partial<Cylinder>;
}
export interface RentalInterval {
  id: string;
  cylinderId: string;
  partyId: string;
  orderId: string;
  start: string;
  end?: string;
  dailyRatePaise: number;
  freeDays: number;
}
export interface InvoiceLine {
  description: string;
  quantity: number;
  unitPricePaise: number;
  amountPaise: number;
}
export interface Invoice {
  id: string;
  number: string;
  partyId: string;
  branchId: string;
  type: 'gas' | 'rental' | 'credit';
  sourceId: string;
  issuedAt: string;
  dueDate: string;
  lines: InvoiceLine[];
  subtotalPaise: number;
  taxBps: number;
  taxPaise: number;
  totalPaise: number;
  paidPaise: number;
  creditedPaise?: number;
  appliedCreditPaise?: number;
  creditOffsetPaise?: number;
  status: 'issued' | 'partial' | 'paid' | 'credited';
  notes: string;
  creditedInvoiceId?: string;
  billTo?: { name: string; address: string; city: string; gstin: string };
  issuer?: { companyName: string; address: string; gstin: string };
}
export interface Receipt {
  id: string;
  number: string;
  partyId: string;
  invoiceId?: string;
  amountPaise: number;
  method: 'cash' | 'upi' | 'bank' | 'credit';
  reference: string;
  at: string;
  actorId: string;
  kind: 'payment' | 'deposit' | 'refund' | 'credit_refund' | 'credit_allocation';
  creditInvoiceId?: string;
  reason?: string;
  reversedAt?: string;
  reversalReason?: string;
  /** Target invoice's corrected amount when credit was applied (allocations only). */
  targetCreditedPaise?: number;
}
export interface AuditEvent {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  action: string;
  entityId: string;
  summary: string;
}
export interface ExceptionRecord {
  id: string;
  at: string;
  type: string;
  summary: string;
  entityId: string;
  status: 'open' | 'resolved';
  resolution?: string;
  branchId?: string;
}
export interface Settings {
  companyName: string;
  address: string;
  gstin: string;
  defaultTaxBps: number;
  supplierOwnedRental?: 'charge' | 'no_charge';
  mode: 'demo' | 'live';
  version?: number;
}
export interface AppState {
  revision: number;
  settings: Settings;
  branches: Branch[];
  cylinders: Cylinder[];
  parties: Party[];
  orders: Order[];
  batches: Batch[];
  movements: Movement[];
  rentals: RentalInterval[];
  invoices: Invoice[];
  receipts: Receipt[];
  audit: AuditEvent[];
  exceptions: ExceptionRecord[];
  pickups?: ReturnPickup[];
}
export interface ActionRequest {
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  expectedRevision?: number;
}
export interface ActionContext {
  user: User;
  now: string;
  id: () => string;
}
export interface ActionResult {
  state: AppState;
  message: string;
  entityId?: string;
}
export interface Bootstrap {
  user: User;
  csrfToken: string;
  state: AppState;
  users: User[];
  // Names only, so every role can show who did something without seeing account details.
  people?: { id: string; name: string }[];
}
export const ROLES: Role[] = ['admin', 'operations', 'quality', 'finance', 'driver', 'auditor'];
export const GASES: Gas[] = ['Medical oxygen', 'Industrial oxygen'];
