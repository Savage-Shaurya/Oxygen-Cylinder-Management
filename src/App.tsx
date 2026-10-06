import { useEffect, useMemo, useState, useRef, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import {
  ChartBar,
  CirclesFour,
  Cube,
  Factory,
  Truck,
  UsersThree,
  Buildings,
  Receipt,
  ShieldCheck,
  ClockCounterClockwise,
  GearSix,
  SignOut,
  List,
  X,
  ArrowRight,
  Plus,
  DownloadSimple,
  Printer,
  WarningCircle,
  CheckCircle,
  ArrowClockwise,
  MagnifyingGlass,
  UploadSimple,
  HandTap,
} from '@phosphor-icons/react';
import type {
  AppState,
  Bootstrap,
  Cylinder,
  Party,
  Order,
  Batch,
  Invoice,
  Role,
  User,
  Gas,
  Movement,
} from '../shared/types';
import { GASES, ROLES } from '../shared/types';
import { request, login, bootstrap, logout, act, ApiError } from './api';
import { ActionForm, plainOfficeError, type FormField, type Option } from './components/ActionForm';
import { Badge, Button, Card, Empty, Modal, PageHeader, Search, Stat } from './components/UI';
import OfflinePanel from './OfflinePanel';
import ScannerInput from './ScannerInput';
import CylinderLabel from './CylinderLabel';
import PrintChallan from './PrintChallan';
import DemoWalkthrough from './DemoWalkthrough';
import { queueDelivery, listQueuedDeliveries } from './offline';
import { allowedPartyTypes } from './party-options';
import { availableCredit, creditNoteAvailable, depositBalance } from '../shared/finance';
import { downloadCylinderImportTemplate, CYLINDER_IMPORT_COLUMNS } from './import-template';
import { decimalHundredths, invoiceBalance, unbilledOrder, rentalPeriod } from './finance-view';
import BasicApp, {
  canSwitchMode,
  modeFor,
  storeMode,
  storedMode,
  type AppMode,
} from './basic/BasicApp';

type View =
  | 'overview'
  | 'cylinders'
  | 'production'
  | 'orders'
  | 'customers'
  | 'suppliers'
  | 'billing'
  | 'safety'
  | 'reports'
  | 'settings';
type FormSpec = {
  reload?: { kind: string; id?: string };
  title: string;
  subtitle?: string;
  fields: FormField[];
  submitLabel?: string;
  initial?: Record<string, unknown>;
  warning?: string;
  submit: (v: Record<string, unknown>) => Promise<void>;
  alternate?: {
    label: string;
    offlineOnly?: boolean;
    onSubmit: (v: Record<string, unknown>) => Promise<void>;
  };
};
const nav: { id: View; label: string; icon: typeof CirclesFour; group: string }[] = [
  { id: 'overview', label: 'Overview', icon: CirclesFour, group: 'Workspace' },
  { id: 'cylinders', label: 'Cylinders', icon: Cube, group: 'Operations' },
  { id: 'production', label: 'Production', icon: Factory, group: 'Operations' },
  { id: 'orders', label: 'Orders & delivery', icon: Truck, group: 'Operations' },
  { id: 'customers', label: 'Customers', icon: UsersThree, group: 'People' },
  { id: 'suppliers', label: 'Suppliers & purchases', icon: Buildings, group: 'People' },
  { id: 'billing', label: 'Billing & rentals', icon: Receipt, group: 'Finance' },
  { id: 'safety', label: 'Safety', icon: ShieldCheck, group: 'Control' },
  { id: 'reports', label: 'Reports & audit', icon: ChartBar, group: 'Control' },
  { id: 'settings', label: 'Settings', icon: GearSix, group: 'Control' },
];
const labels: Record<View, string> = {
  overview: 'Overview',
  cylinders: 'Cylinders',
  production: 'Production',
  orders: 'Orders & delivery',
  customers: 'Customers',
  suppliers: 'Suppliers & purchases',
  billing: 'Billing & rentals',
  safety: 'Safety',
  reports: 'Reports & audit',
  settings: 'Settings',
};
const roleLabels: Record<Role, string> = {
  admin: 'Administrator',
  operations: 'Operations',
  quality: 'Quality',
  finance: 'Finance',
  driver: 'Driver',
  auditor: 'Auditor',
};
const date = (v?: string) =>
  v
    ? new Date(v).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      })
    : '—';
const datetime = (v?: string) =>
  v
    ? new Date(v).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Kolkata',
      })
    : '—';
const indiaDate = (at: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const money = (p: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(p / 100);
const paise = decimalHundredths;
const text = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown) => Number(v || 0);
const opts = (items: { id: string; name: string }[]): Option[] =>
  items.map((x) => ({ value: x.id, label: x.name }));
const branch = (s: AppState, id: string) => s.branches.find((b) => b.id === id)?.name || id;
const party = (s: AppState, id: string) =>
  id === 'company' ? 'Company owned' : s.parties.find((p) => p.id === id)?.name || id;
// Readable holder name; vehicle custody points at an order or a collection, not a party.
const custodian = (s: AppState, c: Cylinder) => {
  if (c.custody === 'plant') return branch(s, c.branchId);
  if (c.custody === 'vehicle') {
    const order = s.orders.find((o) => o.id === c.custodianId);
    if (order) return `On vehicle ${order.vehicle || ''} · ${order.number}`.replace('  ', ' ');
    const pickup = s.pickups?.find((p) => p.id === c.custodianId);
    if (pickup) return `Collection vehicle ${pickup.vehicle} · ${party(s, pickup.partyId)}`;
    return 'On vehicle';
  }
  return party(s, c.custodianId);
};
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// Movement records store "custody:id" tokens and raw references; show readable names.
const place = (s: AppState, token: string) => {
  if (token === 'new') return 'New record';
  const [kind, id = ''] = token.split(/:(.*)/s);
  if (kind === 'plant') return branch(s, id);
  if (kind === 'customer' || kind === 'supplier') return party(s, id);
  if (kind === 'vehicle') {
    const order = s.orders.find((o) => o.id === id);
    if (order) return `Vehicle ${order.vehicle} · ${order.number}`;
    const pickup = s.pickups?.find((p) => p.id === id);
    return pickup ? `Collection vehicle ${pickup.vehicle}` : 'Vehicle';
  }
  return token;
};
const reference = (s: AppState, ref: string) =>
  s.orders.find((o) => o.id === ref)?.number ??
  s.batches.find((b) => b.id === ref)?.number ??
  s.invoices.find((i) => i.id === ref)?.number ??
  s.cylinders.find((c) => c.id === ref)?.tag ??
  s.parties.find((p) => p.id === ref)?.name ??
  (s.pickups?.some((p) => p.id === ref) ? 'Collection' : ref);
const movementText = (s: AppState, m: Movement) =>
  [
    s.cylinders.find((c) => c.id === m.cylinderId)?.tag ?? '',
    m.action,
    display(m.action),
    reference(s, m.reference),
    m.actorName,
    place(s, m.from),
    place(s, m.to),
  ].join(' ');
const person = (people: { id: string; name: string }[], id: string) =>
  people.find((u) => u.id === id)?.name || id;
const gasTone = (c: Cylinder) =>
  c.condition === 'serviceable' ? 'good' : c.condition === 'inspection_due' ? 'warn' : 'bad';
const statusTone = (s: string): 'good' | 'warn' | 'bad' | 'neutral' | 'blue' =>
  ['serviceable', 'released', 'delivered', 'paid', 'resolved'].includes(s)
    ? 'good'
    : ['inspection_due', 'awaiting_release', 'partial', 'closed_short', 'open', 'issued'].includes(
          s,
        )
      ? 'warn'
      : ['quarantine', 'testing', 'retired', 'recalled', 'cancelled'].includes(s)
        ? 'bad'
        : 'neutral';
const display = (s: string) =>
  s === 'closed_short'
    ? 'Closed · short delivery'
    : s === 'upi'
      ? 'UPI'
      : s.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase());
const age = (dateValue: string) =>
  Math.max(0, Math.floor((Date.now() - new Date(dateValue).getTime()) / 86400000));
function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  const value = input.replace(/^\uFEFF/, '');
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '"') {
      if (quoted && value[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && value[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (quoted) throw new Error('CSV has an unclosed quoted field');
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export default function App() {
  const [session, setSession] = useState<Bootstrap | null>(null);
  const latestSession = useRef<Bootstrap | null>(null);
  const factories = useRef<Record<string, (id?: string) => void>>({});
  const captureSpec = useRef<{ active: boolean; spec: FormSpec | null }>({
    active: false,
    spec: null,
  });
  latestSession.current = session;
  const [loading, setLoading] = useState(true);
  const [loginError, setLoginError] = useState('');
  const [serverMode, setServerMode] = useState<'demo' | 'live'>('live');
  const [bootFailure, setBootFailure] = useState(false);
  const [view, setView] = useState<View>(() => {
    const hash = location.hash.slice(1) as View;
    return labels[hash] ? hash : 'overview';
  });
  const [menu, setMenu] = useState(false);
  const [form, setForm] = useState<FormSpec | null>(null);
  const [detail, setDetail] = useState<{
    kind: 'cylinder' | 'order' | 'batch' | 'party' | 'invoice';
    id: string;
  } | null>(null);
  const [toast, setToast] = useState('');
  // Basic (picture) or Office mode, chosen per user on this phone.
  const [modeChoice, setModeChoice] = useState<Record<string, AppMode>>({});
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  useEffect(() => {
    Promise.allSettled([bootstrap(), request<{ mode: 'demo' | 'live' }>('/api/health')])
      .then(([sessionResult, healthResult]) => {
        if (sessionResult.status === 'fulfilled') setSession(sessionResult.value);
        if (healthResult.status === 'fulfilled') setServerMode(healthResult.value.mode);
        if (
          sessionResult.status === 'rejected' &&
          (!(sessionResult.reason instanceof ApiError) || sessionResult.reason.status !== 401)
        )
          setBootFailure(true);
        if (sessionResult.status === 'rejected' && healthResult.status === 'rejected')
          setBootFailure(true);
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const sync = () => {
      const h = location.hash.slice(1) as View;
      if (labels[h]) {
        setView(h);
        setSearch('');
        setFilter('all');
        setDetail(null);
      }
    };
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 5500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  async function submitLogin(email: string, password: string) {
    try {
      setLoginError('');
      setSession(await login(email, password));
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : 'Sign in failed');
    }
  }
  async function signout() {
    if (session) {
      const pending = await listQueuedDeliveries(session.user.id);
      if (
        pending.length &&
        !window.confirm(
          `${pending.length} delivery record(s) are saved on this device. Sign out with evidence still pending? Sign in as the same user to synchronize it.`,
        )
      )
        return;
    }
    try {
      await logout();
    } catch {
      setToast(
        'Could not sign out on the server. Reconnect and try again. Your saved delivery evidence is retained.',
      );
      return;
    }
    setSession(null);
    setDetail(null);
    location.hash = 'overview';
  }
  function navigate(v: View) {
    location.hash = v;
    setView(v);
    setSearch('');
    setFilter('all');
    setMenu(false);
    setDetail(null);
  }
  // `quiet` is for Basic mode, which shows its own result and must not change the office page.
  async function run(type: string, payload: Record<string, unknown>, quiet = false) {
    const current = latestSession.current;
    if (!current) throw new Error('Session expired. Sign in again.');
    payload = { ...payload };
    for (const key of ['ownerAuthorizationRef', 'creditLimitOverrideReason', 'overrideReason']) {
      if (typeof payload[key] === 'string' && !payload[key].trim()) delete payload[key];
    }
    try {
      const result = await act(type, payload, undefined, current.state);
      const updated = { ...current, state: result.state };
      latestSession.current = updated;
      setSession(updated);
      if (quiet) return result;
      setToast(result.message);
      const destinations: Record<string, View> = {
        'cylinder.register': 'cylinders',
        'cylinders.import': 'cylinders',
        'order.create': 'orders',
        'batch.create': 'production',
        'finance.invoice': 'billing',
        'finance.rental': 'billing',
        'finance.credit': 'billing',
        'finance.deposit': 'billing',
        'finance.refund': 'billing',
        'finance.receipt': 'billing',
        'finance.creditAllocate': 'billing',
        'finance.creditRefund': 'billing',
      };
      if (destinations[type]) navigate(destinations[type]);
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        try {
          const refreshed = await bootstrap();
          latestSession.current = refreshed;
          setSession(refreshed);
        } catch {
          /* Keep entered values and the original error visible. */
        }
      }
      throw error;
    }
  }
  function open(spec: FormSpec) {
    if (captureSpec.current.active) {
      captureSpec.current.spec = spec;
      return;
    }
    setDetail(null);
    setForm(spec);
  }
  function allowed(...roles: Role[]) {
    return !!session && roles.includes(session.user.role);
  }
  if (loading)
    return (
      <div className="loading-screen">
        <div className="brand-symbol">C</div>
        <span>Opening workspace…</span>
      </div>
    );
  if (bootFailure && !session)
    return (
      <div className="loading-screen unavailable-screen">
        <div className="brand-symbol">C</div>
        <div>
          <h1>Workspace temporarily unavailable</h1>
          <p>Could not connect to the local service. Your session has not been signed out.</p>
          <Button onClick={() => location.reload()}>Retry connection</Button>
        </div>
      </div>
    );
  if (!session) return <Login mode={serverMode} onSubmit={submitLogin} error={loginError} />;
  const switchMode = (next: AppMode) => {
    storeMode(session.user.id, next);
    setModeChoice((current) => ({ ...current, [session.user.id]: next }));
    setToast('');
    setForm(null);
    setDetail(null);
    setMenu(false);
  };
  if (
    modeFor(session.user.role, modeChoice[session.user.id] ?? storedMode(session.user.id)) ===
    'basic'
  )
    return (
      <BasicApp
        session={session}
        run={(type, payload) => run(type, payload, true)}
        refresh={async () => {
          const refreshed = await bootstrap();
          latestSession.current = refreshed;
          setSession(refreshed);
        }}
        signOut={signout}
        toOffice={canSwitchMode(session.user.role) ? () => switchMode('office') : undefined}
      />
    );
  const s = session.state,
    u = session.user,
    users = session.users,
    people = session.people ?? users;
  const financialRead = ['admin', 'finance', 'auditor'].includes(u.role);
  const availableBranches = s.branches.filter(
    (b) => u.role === 'admin' || u.branchIds.includes(b.id),
  );
  const parties = s.parties.filter((p) => u.role === 'admin' || u.branchIds.includes(p.branchId));
  const cylinders = s.cylinders.filter(
    (c) => u.role === 'admin' || u.branchIds.includes(c.branchId),
  );
  const orders = s.orders.filter((o) => u.role === 'admin' || u.branchIds.includes(o.branchId));
  const batches = s.batches.filter((b) => u.role === 'admin' || u.branchIds.includes(b.branchId));
  const customerParties = parties.filter((p) => p.type !== 'supplier');
  const suppliers = parties.filter((p) => p.type === 'supplier');
  const ownerOptions = [{ value: 'company', label: 'Company owned' }, ...opts(parties)];
  const branchOptions = opts(availableBranches);
  const partyOptions = opts(customerParties);
  const supplierOptions = opts(suppliers);
  const gasOptions = GASES.map((g) => ({ value: g, label: g }));
  const driverOptions = opts(users.filter((x) => x.role === 'driver' && x.active));
  const invoiceOptions = opts(
    s.invoices
      .filter((i) => i.type !== 'credit' && i.status !== 'paid' && i.status !== 'credited')
      .map((i) => ({
        id: i.id,
        name: `${i.number} · ${i.billTo?.name || party(s, i.partyId)} · ${money(invoiceBalance(i))} due`,
      })),
  );
  const recordOptions = (list: Cylinder[]) =>
    list.map((c) => ({
      value: c.id,
      label: `${c.tag} · ${c.serial} · ${c.size} · ${branch(s, c.branchId)}`,
      // Old labels and serial plates still scan to the same cylinder.
      aliases: [...(c.previousTags ?? []), c.serial],
    }));
  const baseFields: FormField[] = [
    { name: 'branchId', label: 'Branch', type: 'select', required: true, options: branchOptions },
  ];
  const priceField = (name: string, label: string, value = 0): FormField => ({
    name,
    label,
    type: 'number',
    min: 0,
    step: 0.01,
    value,
    required: true,
    hint: 'Amount in ₹',
  });
  const authorizationField: FormField = {
    name: 'ownerAuthorizationRef',
    label: 'Owner permission reference',
    hint: 'Required for third-party-owned cylinders. Record the owner’s permission for this specific work.',
    type: 'text',
  };
  const creditOverrideFields: FormField[] =
    u.role === 'admin'
      ? [
          {
            name: 'creditLimitOverrideReason',
            label: 'Credit-limit exception reason',
            hint: 'Leave blank unless deliberately approving an amount above the customer limit.',
            type: 'textarea',
          },
        ]
      : [];
  function stopIncidentRent(c: Cylinder) {
    open({
      title: `Approve rental stop · ${c.tag}`,
      warning:
        'This ends rent on the selected date. Already billed days cannot be silently removed.',
      submitLabel: 'Approve rental stop',
      fields: [
        {
          name: 'stopDate',
          label: 'Rental stop date',
          type: 'date',
          required: true,
          value: today(),
        },
        { name: 'reason', label: 'Approval reason', type: 'textarea', required: true },
      ],
      submit: async (v) => {
        await run('rental.stopIncident', { cylinderId: c.id, version: c.version, ...v });
      },
    });
  }
  function writeOff(c: Cylinder) {
    // If rent was already stopped for this incident, the write-off must use that same date.
    const stoppedOn = s.rentals.find(
      (r) =>
        r.cylinderId === c.id && r.end && !s.rentals.some((x) => x.cylinderId === c.id && !x.end),
    )?.end;
    open({
      title: `Write off lost cylinder · ${c.tag}`,
      warning:
        'This retires the lost asset, closes its loss investigation and stops its rent. It does not pretend that the cylinder returned to the plant.',
      submitLabel: 'Approve writeoff',
      fields: [
        {
          name: 'stopDate',
          label: stoppedOn ? 'Rental stop date (already approved)' : 'Rental stop date',
          type: 'date',
          required: true,
          value: stoppedOn ?? today(),
        },
        authorizationField,
        { name: 'reason', label: 'Writeoff approval reason', type: 'textarea', required: true },
      ],
      submit: async (v) => {
        await run('cylinder.writeoff', { cylinderId: c.id, version: c.version, ...v });
      },
    });
  }
  function reverseCollection() {
    const pickups = (s.pickups || []).filter((p) =>
      p.cylinderIds.some(
        (id) =>
          !p.receivedIds.includes(id) &&
          cylinders.some((c) => c.id === id && c.custody === 'vehicle' && c.custodianId === p.id),
      ),
    );
    open({
      title: 'Undo collection',
      subtitle:
        'Correct only cylinders still on the pickup vehicle. Plant receipts cannot be undone here.',
      submitLabel: 'Undo selected collection',
      fields: [
        {
          name: 'pickupId',
          label: 'Collection',
          type: 'select',
          required: true,
          options: pickups.map((p) => ({
            value: p.id,
            label: `${party(s, p.partyId)} · ${p.vehicle} · ${datetime(p.createdAt)}`,
          })),
        },
        {
          name: 'cylinderIds',
          label: 'Cylinders to return to customer custody',
          type: 'multiselect',
          required: true,
          options: (v) =>
            recordOptions(
              cylinders.filter((c) => c.custody === 'vehicle' && c.custodianId === v.pickupId),
            ),
          span: 'full',
        },
        { name: 'reason', label: 'Correction reason', type: 'textarea', required: true },
      ],
      submit: async (v) => {
        await run('collection.reverse', v);
      },
    });
  }
  function register() {
    open({
      title: 'Register cylinder',
      subtitle: 'Create a traceable asset. Inspection is required before dispatch.',
      submitLabel: 'Register cylinder',
      fields: [
        { name: 'serial', label: 'Manufacturer serial', required: true },
        { name: 'tag', label: 'Scan tag / QR code', required: true },
        { name: 'manufacturer', label: 'Manufacturer', required: true },
        { name: 'gas', label: 'Gas service', type: 'select', required: true, options: gasOptions },
        { name: 'size', label: 'Cylinder size', required: true, placeholder: 'e.g. B or D' },
        {
          name: 'ownerId',
          label: 'Owner',
          type: 'select',
          required: true,
          options: (v) => [
            { value: 'company', label: 'Company owned' },
            ...opts(parties.filter((p) => p.branchId === v.branchId)),
          ],
        },
        ...baseFields,
        {
          name: 'contents',
          label: 'Current contents',
          type: 'select',
          required: true,
          options: ['empty', 'full', 'partial', 'unknown'].map((x) => ({
            value: x,
            label: display(x),
          })),
          value: 'empty',
        },
        { name: 'lastTest', label: 'Last test date', type: 'date', required: true },
        { name: 'testDue', label: 'Next test due', type: 'date', required: true },
        { name: 'certificate', label: 'Certificate reference', required: true },
      ],
      submit: async (v) => {
        await run('cylinder.register', {
          ...v,
          serial: text(v.serial),
          tag: text(v.tag),
          manufacturer: text(v.manufacturer),
          size: text(v.size),
          certificate: text(v.certificate),
        });
      },
    });
  }
  function emptyCylinder(c: Cylinder) {
    open({
      reload: { kind: 'emptyCylinder', id: c.id },
      title: `Record emptying · ${c.tag}`,
      subtitle:
        'Record work already performed by trained staff. The cylinder remains subject to inspection and recall holds.',
      submitLabel: 'Record emptying',
      fields: [
        {
          name: 'method',
          label: 'Method used',
          type: 'select',
          required: true,
          options: [
            { value: 'vent', label: 'Venting' },
            { value: 'evacuate', label: 'Evacuation' },
          ],
        },
        { name: 'notes', label: 'Work record / evidence', type: 'textarea', required: true },
      ],
      submit: async (v) => {
        await run('cylinder.empty', { cylinderId: c.id, version: c.version, ...v });
      },
    });
  }
  function offsiteIncident(c: Cylinder) {
    open({
      reload: { kind: 'offsiteIncident', id: c.id },
      title: `Report incident · ${c.tag}`,
      warning:
        'This records the incident and holds the cylinder without changing physical custody. Rental continues until plant receipt under the current policy.',
      submitLabel: 'Record incident',
      fields: [
        {
          name: 'kind',
          label: 'Incident',
          type: 'select',
          required: true,
          options: [
            { value: 'lost', label: 'Lost' },
            { value: 'damaged', label: 'Damaged' },
          ],
        },
        { name: 'notes', label: 'Incident details / evidence', type: 'textarea', required: true },
      ],
      submit: async (v) => {
        await run('cylinder.offsiteIncident', { cylinderId: c.id, version: c.version, ...v });
      },
    });
  }
  function rejectBatchCylinder(b: Batch) {
    open({
      reload: { kind: 'rejectBatchCylinder', id: b.id },
      title: `Reject member · ${b.number}`,
      subtitle:
        'Exclude the failed cylinder from release. Its history and quality hold are retained.',
      submitLabel: 'Reject cylinder',
      fields: [
        {
          name: 'cylinderId',
          label: 'Cylinder',
          type: 'select',
          required: true,
          options: recordOptions(cylinders.filter((c) => b.cylinderIds.includes(c.id))),
        },
        { name: 'reason', label: 'Rejection reason', type: 'textarea', required: true },
      ],
      submit: async (v) => {
        await run('batch.reject', { batchId: b.id, ...v });
      },
    });
  }
  function inspect(c: Cylinder) {
    open({
      reload: { kind: 'inspect', id: c.id },
      title: `Inspect ${c.tag}`,
      subtitle: `Serial ${c.serial} · version ${c.version}`,
      submitLabel: 'Record inspection',
      initial: {
        condition: c.condition === 'inspection_due' ? 'serviceable' : c.condition,
        testDue: c.testDue,
        lastTest: c.lastTest,
        certificate: c.certificate,
      },
      fields: [
        authorizationField,
        {
          name: 'condition',
          label: 'Inspection outcome',
          type: 'select',
          required: true,
          options: ['serviceable', 'quarantine', 'testing', 'retired'].map((x) => ({
            value: x,
            label: display(x),
          })),
        },
        { name: 'lastTest', label: 'Last test date', type: 'date', required: true },
        { name: 'testDue', label: 'Next test due', type: 'date', required: true },
        { name: 'certificate', label: 'Certificate reference', required: true },
        {
          name: 'notes',
          label: 'Inspection notes',
          type: 'textarea',
          required: true,
          span: 'full',
        },
      ],
      submit: async (v) => {
        await run('cylinder.inspect', {
          cylinderId: c.id,
          version: c.version,
          ...v,
          notes: text(v.notes),
        });
      },
    });
  }
  function retag(c: Cylinder) {
    open({
      reload: { kind: 'retag', id: c.id },
      title: `Replace tag · ${c.tag}`,
      subtitle: 'The cylinder identity and its history stay intact.',
      fields: [
        { name: 'tag', label: 'New tag / QR code', required: true },
        { name: 'reason', label: 'Reason for replacement', type: 'textarea', required: true },
      ],
      submit: async (v) => {
        await run('cylinder.retag', {
          cylinderId: c.id,
          version: c.version,
          tag: text(v.tag),
          reason: text(v.reason),
        });
      },
    });
  }
  function partyFields(type?: Party['type'], editing = false): FormField[] {
    return [
      {
        name: 'name',
        label: type === 'supplier' ? 'Supplier business name' : 'Business / customer name',
        required: true,
      },
      {
        name: 'type',
        label: 'Party type',
        type: 'select',
        required: true,
        options: allowedPartyTypes(
          editing ? 'edit' : type === 'supplier' ? 'supplier' : 'customer',
        ).map((x) => ({
          value: x,
          label: display(x),
        })),
        value: type || '',
      },
      { name: 'contact', label: 'Contact person', required: true },
      { name: 'phone', label: 'Phone', type: 'tel', required: true },
      { name: 'address', label: 'Address', type: 'textarea', required: true, span: 'full' },
      { name: 'city', label: 'City', required: true },
      { name: 'gstin', label: 'GSTIN', hint: 'Leave blank if not applicable' },
      ...baseFields,
      priceField('creditLimitPaise', 'Credit limit'),
      priceField('dailyRentalPaise', 'Daily rental per cylinder'),
      {
        name: 'freeDays',
        label: 'Rental free days',
        type: 'number',
        min: 0,
        max: 365,
        step: 1,
        required: true,
        value: 0,
      },
      priceField('depositPaise', 'Standard deposit'),
    ];
  }
  function normalizeParty(v: Record<string, unknown>) {
    return {
      ...v,
      name: text(v.name),
      contact: text(v.contact),
      phone: text(v.phone),
      address: text(v.address),
      city: text(v.city),
      gstin: text(v.gstin),
      creditLimitPaise: paise(v.creditLimitPaise),
      dailyRentalPaise: paise(v.dailyRentalPaise),
      depositPaise: paise(v.depositPaise),
      freeDays: num(v.freeDays),
    };
  }
  function createParty(type?: Party['type']) {
    open({
      title: type === 'supplier' ? 'Add supplier' : 'Add customer',
      subtitle: 'Set custody and commercial terms for future work.',
      fields: partyFields(type),
      submit: async (v) => {
        const expectedTypes = allowedPartyTypes(type === 'supplier' ? 'supplier' : 'customer');
        if (!expectedTypes.includes(v.type as Party['type']))
          throw new Error('Choose a valid type for this form.');
        await run('party.create', normalizeParty(v));
        navigate(type === 'supplier' ? 'suppliers' : 'customers');
        setToast(`${type === 'supplier' ? 'Supplier' : 'Customer'} created: ${text(v.name)}`);
      },
    });
  }
  function editParty(p: Party) {
    open({
      reload: { kind: 'editParty', id: p.id },
      title: `Edit ${p.name}`,
      initial: {
        ...p,
        creditLimitPaise: p.creditLimitPaise / 100,
        dailyRentalPaise: p.dailyRentalPaise / 100,
        depositPaise: p.depositPaise / 100,
      },
      fields: partyFields(p.type, true),
      submit: async (v) => {
        await run('party.update', {
          partyId: p.id,
          expectedVersion: p.version ?? 1,
          ...normalizeParty(v),
        });
      },
    });
  }
  function createOrder() {
    open({
      title: 'New order',
      subtitle:
        'A specific cylinder manifest is selected at dispatch. Finance reviews and approves the final gas price when invoicing.',
      fields: [
        {
          name: 'partyId',
          label: 'Customer',
          type: 'select',
          options: partyOptions,
          required: true,
        },
        {
          name: 'branchId',
          label: 'Branch',
          type: 'select',
          required: true,
          options: (v) =>
            branchOptions.filter(
              (b) => b.value === customerParties.find((p) => p.id === v.partyId)?.branchId,
            ),
        },
        { name: 'gas', label: 'Gas', type: 'select', options: gasOptions, required: true },
        { name: 'size', label: 'Cylinder size', required: true, placeholder: 'e.g. B or D' },
        {
          name: 'quantity',
          label: 'Quantity',
          type: 'number',
          min: 1,
          max: 500,
          step: 1,
          required: true,
        },
        {
          name: 'priority',
          label: 'Priority',
          type: 'select',
          required: true,
          options: [
            { value: 'normal', label: 'Normal' },
            { value: 'urgent', label: 'Urgent' },
          ],
          value: 'normal',
        },
        { name: 'dueDate', label: 'Requested date', type: 'date', required: true, value: today() },
        ...(financialRead ? [priceField('unitPricePaise', 'Gas price per cylinder')] : []),
        { name: 'notes', label: 'Order notes', type: 'textarea', span: 'full' },
      ],
      submit: async (v) => {
        await run('order.create', {
          ...v,
          quantity: num(v.quantity),
          unitPricePaise: paise(v.unitPricePaise),
          notes: text(v.notes),
        });
      },
    });
  }
  function dispatch(o: Order) {
    const eligible = cylinders.filter(
      (c) =>
        c.branchId === o.branchId &&
        c.gas === o.gas &&
        c.size === o.size &&
        c.custody === 'plant' &&
        (c.ownerId === 'company' ||
          c.ownerId === o.partyId ||
          s.parties.some((p) => p.id === c.ownerId && p.type === 'supplier')) &&
        c.contents === 'full' &&
        c.condition === 'serviceable' &&
        c.testDue >= today() &&
        !!c.batchId &&
        batches.some((b) => b.id === c.batchId && b.status === 'released'),
    );
    open({
      reload: { kind: 'dispatch', id: o.id },
      title: `Dispatch ${o.number}`,
      subtitle: `${party(s, o.partyId)} · ${count(o.quantity, `${o.size} cylinder`)}`,
      submitLabel: 'Confirm dispatch',
      fields: [
        authorizationField,
        {
          name: 'cylinderIds',
          label: 'Scan or select exact cylinders',
          type: 'multiselect',
          required: true,
          options: recordOptions(eligible),
          span: 'full',
          hint: 'Select the physical units loaded. Only released, safe stock appears.',
        },
        { name: 'vehicle', label: 'Vehicle registration', required: true },
        {
          name: 'driverId',
          label: 'Assigned driver',
          type: 'select',
          required: true,
          options: driverOptions,
        },
      ],
      submit: async (v) => {
        const ids = v.cylinderIds as string[];
        if (!ids.length) throw new Error('Select at least one cylinder');
        if (ids.length !== o.quantity)
          throw new Error(`Select exactly ${count(o.quantity, 'cylinder')} for this order`);
        await run('order.dispatch', {
          orderId: o.id,
          ownerAuthorizationRef: text(v.ownerAuthorizationRef),
          cylinderIds: ids,
          vehicle: text(v.vehicle),
          driverId: v.driverId,
        });
      },
    });
  }
  function deliver(o: Order) {
    const remaining = o.cylinderIds.filter(
      (id) => !o.deliveredIds.includes(id) && !o.unloadedIds?.includes(id),
    );
    open({
      reload: { kind: 'deliver', id: o.id },
      title: `Record delivery · ${o.number}`,
      subtitle:
        'Select only the units accepted by the recipient. You can complete a partial delivery.',
      submitLabel: 'Record acceptance',
      fields: [
        {
          name: 'cylinderIds',
          label: 'Accepted cylinder tags',
          type: 'multiselect',
          required: true,
          options: recordOptions(cylinders.filter((c) => remaining.includes(c.id))),
          span: 'full',
        },
        { name: 'recipient', label: 'Recipient name', required: true },
        { name: 'notes', label: 'Delivery evidence / notes', type: 'textarea', span: 'full' },
      ],
      submit: async (v) => {
        if (!(v.cylinderIds as string[]).length)
          throw new Error('Select at least one accepted cylinder');
        await run('order.deliver', {
          orderId: o.id,
          cylinderIds: v.cylinderIds,
          recipient: text(v.recipient),
          notes: text(v.notes),
        });
      },
      alternate: {
        label: 'Save evidence on device',
        offlineOnly: true,
        onSubmit: async (v) => {
          if (!(v.cylinderIds as string[]).length || !text(v.recipient))
            throw new Error('Select accepted cylinders and enter the recipient');
          await queueDelivery(u.id, {
            orderId: o.id,
            cylinderIds: v.cylinderIds,
            recipient: text(v.recipient),
            notes: text(v.notes),
          });
          setToast('Delivery evidence saved on this device. Sync when connected.');
        },
      },
    });
  }
  function unload(o: Order) {
    const remaining = o.cylinderIds.filter(
      (id) => !o.deliveredIds.includes(id) && !o.unloadedIds?.includes(id),
    );
    open({
      reload: { kind: 'unload', id: o.id },
      title: `Unload remaining stock · ${o.number}`,
      subtitle: 'Return undelivered vehicle stock to the plant.',
      fields: [
        {
          name: 'cylinderIds',
          label: 'Cylinders returned to plant',
          type: 'multiselect',
          required: true,
          options: (v) =>
            recordOptions(
              cylinders.filter(
                (c) =>
                  remaining.includes(c.id) &&
                  (v.sealIntact !== 'true' ||
                    (c.contents === 'full' &&
                      c.condition === 'serviceable' &&
                      c.testDue >= today() &&
                      s.batches.some((b) => b.id === c.batchId && b.status === 'released'))),
              ),
            ),
          span: 'full',
        },
        {
          name: 'sealIntact',
          label: 'Seal checked on every selected cylinder',
          type: 'select',
          required: true,
          value: 'false',
          options: [
            { value: 'false', label: 'Not verified — hold for inspection' },
            { value: 'true', label: 'All seals intact — retain released stock' },
          ],
        },
        { name: 'notes', label: 'Reason / handover notes', type: 'textarea', required: true },
      ],
      submit: async (v) => {
        if (!(v.cylinderIds as string[]).length) throw new Error('Select at least one cylinder');
        await run('order.unload', {
          sealIntact: v.sealIntact === 'true',
          orderId: o.id,
          cylinderIds: v.cylinderIds,
          notes: text(v.notes),
        });
      },
    });
  }
  function collectReturns() {
    const held = cylinders.filter(
      (c) =>
        c.custody === 'customer' &&
        (u.role !== 'driver' ||
          orders.some(
            (o) =>
              o.partyId === c.custodianId &&
              o.driverId === u.id &&
              (['dispatched', 'partial'].includes(o.status) ||
                (o.status === 'delivered' &&
                  o.deliveredAt &&
                  indiaDate(o.deliveredAt) === today())),
          )),
    );
    open({
      reload: { kind: 'collectReturns' },
      title: 'Collect empties',
      subtitle:
        'Record the exact cylinders picked up from a customer. Plant receiving confirms them separately.',
      fields: [
        {
          name: 'partyId',
          label: 'Customer',
          type: 'select',
          required: true,
          options: partyOptions,
        },
        {
          name: 'cylinderIds',
          label: 'Collected cylinder tags',
          type: 'multiselect',
          required: true,
          options: (v) => recordOptions(held.filter((c) => c.custodianId === v.partyId)),
          span: 'full',
        },
        { name: 'vehicle', label: 'Vehicle registration', required: true },
        {
          name: 'driverId',
          label: 'Collecting driver',
          type: 'select',
          required: true,
          options: driverOptions,
          value: u.role === 'driver' ? u.id : undefined,
        },
        { name: 'notes', label: 'Pickup notes', type: 'textarea' },
      ],
      submit: async (v) => {
        if (!(v.cylinderIds as string[]).length) throw new Error('Select collected cylinders');
        await run('cylinder.collect', {
          partyId: v.partyId,
          cylinderIds: v.cylinderIds,
          vehicle: text(v.vehicle),
          driverId: v.driverId,
          notes: text(v.notes),
        });
      },
    });
  }
  function reportDiscrepancy() {
    open({
      title: 'Report unknown return',
      subtitle:
        'An unidentified or disputed unit enters the exception queue. No cylinder custody changes until resolved.',
      fields: [
        ...baseFields,
        { name: 'serial', label: 'Observed serial or tag', required: true },
        { name: 'notes', label: 'What was observed', type: 'textarea', required: true },
      ],
      submit: async (v) => {
        await run('return.discrepancy', {
          branchId: v.branchId,
          serial: text(v.serial),
          notes: text(v.notes),
        });
      },
    });
  }
  function receiveReturn(p?: Party) {
    const held = cylinders.filter(
      (c) =>
        (c.custody === 'customer' ||
          (c.custody === 'vehicle' && s.pickups?.some((x) => x.cylinderIds.includes(c.id)))) &&
        true,
    );
    open({
      reload: { kind: 'receiveReturn', id: p?.id },
      title: 'Receive customer returns',
      subtitle: 'Confirm every physical cylinder received at the plant.',
      fields: [
        {
          name: 'partyId',
          label: 'Customer',
          type: 'select',
          required: true,
          options: partyOptions,
          value: p?.id,
        },
        {
          name: 'cylinderIds',
          label: 'Returned cylinder tags',
          type: 'multiselect',
          required: true,
          options: (v) =>
            recordOptions(
              held.filter(
                (c) =>
                  c.custodianId === v.partyId ||
                  s.pickups?.some(
                    (pickup) =>
                      pickup.partyId === v.partyId &&
                      pickup.cylinderIds.includes(c.id) &&
                      !pickup.receivedIds.includes(c.id),
                  ),
              ),
            ),
          span: 'full',
        },
        {
          name: 'receivingBranchId',
          label: 'Receiving branch',
          hint: 'A different receiving branch is supported for company-owned cylinders only. Third-party stock must return to its owning branch.',
          type: 'select',
          required: true,
          options: branchOptions,
          value: p?.branchId,
          defaultOnChange: {
            dependsOn: ['partyId'],
            value: (v) => customerParties.find((p) => p.id === v.partyId)?.branchId || '',
          },
        },
        {
          name: 'contents',
          label: 'Contents on return',
          type: 'select',
          required: true,
          options: ['empty', 'full', 'partial', 'unknown'].map((x) => ({
            value: x,
            label: display(x),
          })),
          value: 'empty',
        },
        { name: 'notes', label: 'Receiving notes', type: 'textarea', required: true },
      ],
      submit: async (v) => {
        if (!(v.cylinderIds as string[]).length) throw new Error('Select returned cylinders');
        await run('cylinder.return', {
          partyId: v.partyId,
          receivingBranchId: v.receivingBranchId,
          cylinderIds: v.cylinderIds,
          contents: v.contents,
          notes: text(v.notes),
        });
      },
    });
  }
  function createBatch() {
    const eligible = cylinders.filter(
      (c) =>
        c.custody === 'plant' &&
        c.contents === 'empty' &&
        c.condition === 'serviceable' &&
        c.testDue >= today() &&
        !batches.some((b) => b.status === 'awaiting_release' && b.cylinderIds.includes(c.id)),
    );
    open({
      reload: { kind: 'createBatch' },
      title: 'Create fill batch',
      subtitle: 'Select inspected empty cylinders. Quality must release the completed batch.',
      fields: [
        { name: 'gas', label: 'Gas', type: 'select', required: true, options: gasOptions },
        ...baseFields,
        {
          name: 'cylinderIds',
          label: 'Cylinders to fill',
          type: 'multiselect',
          required: true,
          options: (v) =>
            recordOptions(eligible.filter((c) => c.branchId === v.branchId && c.gas === v.gas)),
          span: 'full',
        },
        { name: 'source', label: 'Gas source / lot reference', required: true },
        { name: 'operator', label: 'Fill operator', required: true },
      ],
      submit: async (v) => {
        if (!(v.cylinderIds as string[]).length) throw new Error('Select cylinders for this batch');
        await run('batch.create', { ...v, source: text(v.source), operator: text(v.operator) });
      },
    });
  }
  function release(b: Batch) {
    open({
      reload: { kind: 'release', id: b.id },
      title: `Release ${b.number}`,
      subtitle: 'Independent quality review makes this stock eligible for dispatch.',
      submitLabel: 'Release batch',
      fields: [
        { name: 'certificate', label: 'Quality certificate reference', required: true },
        { name: 'qualityNotes', label: 'Release notes', type: 'textarea', required: true },
      ],
      submit: async (v) => {
        await run('batch.release', {
          batchId: b.id,
          certificate: text(v.certificate),
          qualityNotes: text(v.qualityNotes),
        });
      },
    });
  }
  function recall(b: Batch) {
    open({
      reload: { kind: 'recall', id: b.id },
      title: `Recall ${b.number}`,
      warning:
        'This holds cylinders still carrying this batch and records its past customer recipients for follow-up.',
      submitLabel: 'Recall batch',
      fields: [{ name: 'reason', label: 'Recall reason', type: 'textarea', required: true }],
      submit: async (v) => {
        await run('batch.recall', { batchId: b.id, reason: text(v.reason) });
      },
    });
  }
  function supplierSend() {
    const eligible = cylinders.filter(
      (c) =>
        c.custody === 'plant' &&
        c.contents === 'empty' &&
        ['serviceable', 'inspection_due', 'testing'].includes(c.condition) &&
        (!c.batchId || s.batches.some((b) => b.id === c.batchId && b.status === 'recalled')),
    );
    open({
      reload: { kind: 'supplierSend' },
      title: 'Send to supplier',
      subtitle: 'Record exactly which cylinders leave plant custody.',
      fields: [
        authorizationField,
        {
          name: 'service',
          label: 'Service required',
          type: 'select',
          required: true,
          value: 'fill',
          options: [
            { value: 'fill', label: 'Refill' },
            { value: 'test', label: 'Hydrotest / inspection' },
          ],
        },
        {
          name: 'supplierId',
          label: 'Supplier',
          type: 'select',
          required: true,
          options: supplierOptions,
        },
        {
          name: 'cylinderIds',
          label: 'Cylinder tags',
          type: 'multiselect',
          required: true,
          options: (v) =>
            recordOptions(
              eligible.filter(
                (c) =>
                  c.branchId === suppliers.find((p) => p.id === v.supplierId)?.branchId &&
                  (v.service === 'test' ||
                    (c.condition === 'serviceable' &&
                      c.testDue >= today() &&
                      !!c.lastTest &&
                      c.lastTest <= today() &&
                      c.lastTest <= c.testDue &&
                      !!c.certificate)),
              ),
            ),
          span: 'full',
        },
        { name: 'reference', label: 'Transfer reference', required: true },
        { name: 'notes', label: 'Handover notes', type: 'textarea' },
      ],
      submit: async (v) => {
        if (!(v.cylinderIds as string[]).length) throw new Error('Select cylinders');
        await run('supplier.send', { ...v, reference: text(v.reference), notes: text(v.notes) });
      },
    });
  }
  function supplierReceive() {
    const held = cylinders.filter((c) => c.custody === 'supplier');
    open({
      reload: { kind: 'supplierReceive' },
      title: 'Receive from supplier',
      subtitle:
        'Record the service performed and actual contents. Filled stock requires quality release.',
      fields: [
        {
          name: 'supplierId',
          label: 'Supplier',
          type: 'select',
          required: true,
          options: supplierOptions,
        },
        {
          name: 'cylinderIds',
          label: 'Received cylinder tags',
          type: 'multiselect',
          required: true,
          options: (v) =>
            recordOptions(
              held.filter((c) => c.custodianId === v.supplierId && (!v.gas || c.gas === v.gas)),
            ),
          span: 'full',
        },
        { name: 'gas', label: 'Gas', type: 'select', required: true, options: gasOptions },
        {
          name: 'service',
          label: 'Service performed',
          type: 'select',
          required: true,
          options: [
            { value: 'fill', label: 'Refill' },
            { value: 'test', label: 'Test / inspection only' },
          ],
        },
        {
          name: 'contents',
          label: 'Actual contents received',
          type: 'select',
          required: true,
          options: (v) =>
            (v.service === 'fill' ? ['full'] : ['empty', 'partial', 'unknown']).map((value) => ({
              value,
              label: display(value),
            })),
        },
        { name: 'reference', label: 'Supplier delivery reference', required: true },
        { name: 'notes', label: 'Receiving notes', type: 'textarea' },
      ],
      submit: async (v) => {
        if (!(v.cylinderIds as string[]).length) throw new Error('Select cylinders');
        await run('supplier.receive', { ...v, reference: text(v.reference), notes: text(v.notes) });
      },
    });
  }
  function purchaseReceive() {
    open({
      title: 'Receive new cylinders',
      subtitle:
        'Upload or paste a CSV with the exact header: serial,tag,manufacturer,size,ownerId,lastTest,testDue,certificate. Quoted commas are supported. Each new asset enters quality hold.',
      fields: [
        {
          name: 'supplierId',
          label: 'Supplier',
          type: 'select',
          required: true,
          options: supplierOptions,
        },
        {
          name: 'branchId',
          label: 'Branch',
          type: 'select',
          required: true,
          options: (v) =>
            branchOptions.filter(
              (b) => b.value === suppliers.find((p) => p.id === v.supplierId)?.branchId,
            ),
        },
        { name: 'gas', label: 'Gas', type: 'select', required: true, options: gasOptions },
        { name: 'reference', label: 'Purchase / delivery reference', required: true },
        { name: 'file', label: 'Cylinder CSV file', type: 'file', span: 'full' },
        {
          name: 'cylindersText',
          label: 'Or paste cylinder CSV',
          type: 'textarea',
          span: 'full',
          placeholder:
            'serial,tag,manufacturer,size,ownerId,lastTest,testDue,certificate\nSER001,TAG001,"Demo Cylinder Works",B,company,2026-01-01,2031-01-01,CERT001',
        },
        { name: 'notes', label: 'Receiving notes', type: 'textarea' },
      ],
      submit: async (v) => {
        const content = v.file instanceof File ? await v.file.text() : text(v.cylindersText);
        if (!content.trim())
          throw new Error('Choose a cylinder CSV file or paste the CSV template');
        const parsed = parseCsv(content),
          headers = parsed.shift()?.map((x) => x.trim()) || [];
        const required = [
          'serial',
          'tag',
          'manufacturer',
          'size',
          'ownerId',
          'lastTest',
          'testDue',
          'certificate',
        ];
        if (
          headers.length !== required.length ||
          required.some((name, index) => headers[index] !== name)
        )
          throw new Error(`CSV header must be: ${required.join(',')}`);
        if (!parsed.length) throw new Error('Add at least one cylinder row');
        if (parsed.length > 500) throw new Error('Maximum 500 cylinders per purchase receipt');
        const rows = parsed.map((columns, index) => {
          if (columns.length !== required.length || columns.some((value) => !value))
            throw new Error(`Row ${index + 2} needs all eight values`);
          const row: Record<string, string> = Object.fromEntries(
            required.map((name, i) => [name, columns[i]]),
          );
          row.ownerId = importRefs.owner(row.ownerId, text(v.branchId));
          return row;
        });
        await run('purchase.receive', {
          supplierId: v.supplierId,
          branchId: v.branchId,
          gas: v.gas,
          reference: text(v.reference),
          notes: text(v.notes),
          cylinders: rows,
        });
      },
    });
  }

  function issueInvoice(o: Order) {
    open({
      reload: { kind: 'issueInvoice', id: o.id },
      title: `Invoice ${o.number}`,
      subtitle: `Review the price for ${o.deliveredIds.length} accepted cylinder${o.deliveredIds.length === 1 ? '' : 's'}. Current subtotal: ${money(o.deliveredIds.length * o.unitPricePaise)}.`,
      fields: [
        ...creditOverrideFields,
        {
          ...priceField(
            'unitPricePaise',
            'Approved gas price per cylinder',
            o.unitPricePaise / 100,
          ),
          min: 0.01,
        },
        {
          name: 'taxBps',
          label: 'Tax rate (%)',
          type: 'number',
          required: true,
          min: 0,
          max: 100,
          step: 0.01,
          value: s.settings.defaultTaxBps / 100,
        },
        { name: 'dueDate', label: 'Payment due', type: 'date', required: true, value: today() },
        { name: 'notes', label: 'Invoice notes', type: 'textarea' },
      ],
      submit: async (v) => {
        await run('finance.invoice', {
          orderId: o.id,
          ...(v.creditLimitOverrideReason
            ? { creditLimitOverrideReason: text(v.creditLimitOverrideReason) }
            : {}),
          unitPricePaise: paise(v.unitPricePaise),
          taxBps: paise(v.taxBps),
          dueDate: v.dueDate,
          notes: text(v.notes),
        });
      },
    });
  }
  function rentalInvoice() {
    const period = rentalPeriod(today(), s.invoices);
    open({
      title: 'Generate rental invoice',
      subtitle: 'Charges derive from recorded customer custody and the agreed free days.',
      fields: [
        ...creditOverrideFields,
        {
          name: 'partyId',
          label: 'Customer',
          type: 'select',
          required: true,
          options: partyOptions,
        },
        {
          name: 'periodStart',
          label: 'Period start',
          type: 'date',
          required: true,
          value: period.start,
          defaultOnChange: {
            dependsOn: ['partyId'],
            value: (v) => rentalPeriod(today(), s.invoices, String(v.partyId)).start,
          },
        },
        {
          name: 'periodEnd',
          label: 'Period end (latest yesterday)',
          type: 'date',
          required: true,
          value: period.end,
        },
        {
          name: 'taxBps',
          label: 'Tax rate (%)',
          type: 'number',
          required: true,
          min: 0,
          max: 100,
          step: 0.01,
          value: s.settings.defaultTaxBps / 100,
        },
        { name: 'dueDate', label: 'Payment due', type: 'date', required: true, value: today() },
      ],
      submit: async (v) => {
        await run('finance.rental', { ...v, taxBps: paise(v.taxBps) });
      },
    });
  }
  function receipt(i?: Invoice) {
    open({
      title: 'Record payment',
      subtitle: 'Allocate a received amount to one invoice.',
      fields: [
        {
          name: 'invoiceId',
          label: 'Invoice',
          type: 'select',
          required: true,
          options: invoiceOptions,
          value: i?.id,
        },
        { ...priceField('amountPaise', 'Amount received'), min: 0.01 },
        {
          name: 'method',
          label: 'Method',
          type: 'select',
          required: true,
          options: ['cash', 'upi', 'bank'].map((x) => ({ value: x, label: display(x) })),
        },
        { name: 'reference', label: 'Payment reference', required: true },
      ],
      submit: async (v) => {
        await run('finance.receipt', {
          invoiceId: v.invoiceId,
          amountPaise: paise(v.amountPaise),
          method: v.method,
          reference: text(v.reference),
        });
      },
    });
  }
  function deposit(kind: 'deposit' | 'refund') {
    open({
      title: kind === 'deposit' ? 'Record security deposit' : 'Refund security deposit',
      fields: [
        ...(kind === 'refund' && u.role === 'admin'
          ? [
              {
                name: 'overrideReason',
                label: 'Liability exception approval',
                type: 'textarea' as const,
                hint: 'Only administrators may approve a deposit refund while cylinders or unpaid invoices remain. Leave blank for the normal check.',
              },
            ]
          : []),
        {
          name: 'partyId',
          label: 'Customer',
          type: 'select',
          required: true,
          options: partyOptions,
        },
        { ...priceField('amountPaise', 'Amount'), min: 0.01 },
        {
          name: 'method',
          label: 'Method',
          type: 'select',
          required: true,
          options: ['cash', 'upi', 'bank'].map((x) => ({ value: x, label: display(x) })),
        },
        { name: 'reference', label: 'Transaction reference', required: true },
        ...(kind === 'refund'
          ? [{ name: 'reason', label: 'Refund reason', type: 'textarea' as const, required: true }]
          : []),
      ],
      submit: async (v) => {
        await run(`finance.${kind}`, {
          partyId: v.partyId,
          ...(v.overrideReason ? { overrideReason: text(v.overrideReason) } : {}),
          amountPaise: paise(v.amountPaise),
          method: v.method,
          reference: text(v.reference),
          ...(kind === 'refund' ? { reason: text(v.reason) } : {}),
        });
      },
    });
  }
  function credit(i: Invoice) {
    open({
      reload: { kind: 'credit', id: i.id },
      title: `Credit ${i.number}`,
      warning:
        'A credit note corrects all or part of this bill. Only an overpaid amount becomes spendable or refundable customer credit.',
      submitLabel: 'Issue credit note',
      fields: [
        {
          ...priceField(
            'amountPaise',
            'Credit amount',
            (i.totalPaise - (i.creditedPaise || 0)) / 100,
          ),
          min: 0.01,
        },
        { name: 'reason', label: 'Reason for credit', type: 'textarea', required: true },
      ],
      submit: async (v) => {
        await run('finance.credit', {
          invoiceId: i.id,
          amountPaise: paise(v.amountPaise),
          reason: text(v.reason),
        });
      },
    });
  }
  function allocateCredit() {
    open({
      title: 'Apply customer credit',
      subtitle: 'Use available credit against an unpaid invoice for the same customer.',
      submitLabel: 'Apply credit',
      fields: [
        {
          name: 'creditInvoiceId',
          label: 'Credit note',
          type: 'select',
          required: true,
          options: s.invoices
            .filter((i) => i.type === 'credit' && creditNoteAvailable(s, i.id) > 0)
            .map((i) => ({
              value: i.id,
              label: `${i.number} · ${party(s, i.partyId)} · ${money(creditNoteAvailable(s, i.id))} available`,
            })),
        },
        {
          name: 'invoiceId',
          label: 'Invoice to settle',
          type: 'select',
          required: true,
          options: (v) =>
            invoiceOptions.filter(
              (o) =>
                s.invoices.find((i) => i.id === o.value)?.partyId ===
                s.invoices.find((i) => i.id === v.creditInvoiceId)?.partyId,
            ),
        },
        { ...priceField('amountPaise', 'Amount to apply'), min: 0.01 },
        { name: 'reason', label: 'Allocation reason', type: 'textarea', required: true },
      ],
      submit: async (v) => {
        await run('finance.creditAllocate', { ...v, amountPaise: paise(v.amountPaise) });
      },
    });
  }
  function unallocateCredit() {
    open({
      title: 'Undo credit allocation',
      subtitle: 'Return an applied credit to its credit note before correcting the target invoice.',
      submitLabel: 'Undo allocation',
      fields: [
        {
          name: 'receiptId',
          label: 'Credit allocation',
          type: 'select',
          required: true,
          options: s.receipts
            .filter((r) => r.kind === 'credit_allocation' && !r.reversedAt)
            .map((r) => ({ value: r.id, label: `${r.number} · ${money(r.amountPaise)}` })),
        },
        { name: 'reason', label: 'Reversal reason', type: 'textarea', required: true },
      ],
      submit: async (v) => {
        await run('finance.creditUnallocate', v);
      },
    });
  }
  function refundCredit() {
    open({
      title: 'Refund customer credit',
      subtitle: 'Refund only the unused customer credit created by corrections to paid bills.',
      submitLabel: 'Record credit refund',
      fields: [
        {
          name: 'partyId',
          label: 'Customer',
          type: 'select',
          required: true,
          options: customerParties
            .filter((p) => availableCredit(s, p.id) > 0)
            .map((p) => ({
              value: p.id,
              label: `${p.name} · ${money(availableCredit(s, p.id))} available`,
            })),
        },
        {
          name: 'creditInvoiceId',
          label: 'Credit note to refund',
          type: 'select',
          required: true,
          options: (v) =>
            s.invoices
              .filter(
                (i) =>
                  i.type === 'credit' &&
                  i.partyId === v.partyId &&
                  creditNoteAvailable(s, i.id) > 0,
              )
              .map((i) => ({
                value: i.id,
                label: `${i.number} · ${money(creditNoteAvailable(s, i.id))} available`,
              })),
        },
        { ...priceField('amountPaise', 'Refund amount'), min: 0.01 },
        {
          name: 'method',
          label: 'Method',
          type: 'select',
          required: true,
          options: ['cash', 'upi', 'bank'].map((value) => ({ value, label: display(value) })),
        },
        { name: 'reference', label: 'Refund transaction reference', required: true },
        { name: 'reason', label: 'Refund reason', type: 'textarea', required: true },
      ],
      submit: async (v) => {
        await run('finance.creditRefund', { ...v, amountPaise: paise(v.amountPaise) });
      },
    });
  }
  function resolveException(id: string) {
    open({
      title: 'Resolve exception',
      fields: [
        { name: 'resolution', label: 'Resolution and evidence', type: 'textarea', required: true },
      ],
      submit: async (v) => {
        await run('exception.resolve', { exceptionId: id, resolution: text(v.resolution) });
      },
    });
  }
  function settingsForm() {
    open({
      reload: { kind: 'settingsForm' },
      title: 'Company settings',
      initial: { ...s.settings, defaultTaxBps: s.settings.defaultTaxBps / 100 },
      fields: [
        {
          name: 'supplierOwnedRental',
          label: 'Rent for supplier-owned cylinders',
          type: 'select',
          required: true,
          value: s.settings.supplierOwnedRental || 'charge',
          options: [
            { value: 'charge', label: 'Charge the customer’s agreed rental rate' },
            { value: 'no_charge', label: 'Do not charge rental on supplier-owned cylinders' },
          ],
        },
        { name: 'companyName', label: 'Company name', required: true },
        { name: 'address', label: 'Business address', type: 'textarea', required: true },
        { name: 'gstin', label: 'GSTIN' },
        {
          name: 'defaultTaxBps',
          label: 'Default tax rate (%)',
          type: 'number',
          required: true,
          min: 0,
          max: 100,
          step: 0.01,
        },
      ],
      submit: async (v) => {
        await run('settings.update', {
          expectedVersion: s.settings.version ?? 1,
          supplierOwnedRental: text(v.supplierOwnedRental),
          companyName: text(v.companyName),
          address: text(v.address),
          gstin: text(v.gstin),
          defaultTaxBps: paise(v.defaultTaxBps),
        });
      },
    });
  }
  function changePassword() {
    open({
      title: 'Change your password',
      subtitle: 'All your sessions will end. Sign in again with your new password.',
      submitLabel: 'Change password',
      fields: [
        { name: 'currentPassword', label: 'Current password', type: 'password', required: true },
        {
          name: 'newPassword',
          label: 'New password',
          type: 'password',
          required: true,
          minLength: 12,
          hint: 'At least 12 characters; not only spaces.',
        },
      ],
      submit: async (v) => {
        await request('/api/password', { method: 'POST', body: JSON.stringify(v) });
        setSession(null);
        latestSession.current = null;
        setDetail(null);
      },
    });
  }
  function resetPassword(target: User) {
    open({
      title: `Reset password · ${target.name}`,
      subtitle:
        'The member will be signed out of every session. Share the replacement password through your approved secure channel.',
      submitLabel: 'Reset member password',
      fields: [
        {
          name: 'newPassword',
          label: 'Replacement password',
          type: 'password',
          required: true,
          minLength: 12,
          hint: 'At least 12 characters; not only spaces.',
        },
      ],
      submit: async (v) => {
        await request(`/api/users/${target.id}/password`, {
          method: 'POST',
          body: JSON.stringify(v),
        });
        setToast('Password reset. Member sessions have ended.');
      },
    });
  }
  function addUser() {
    open({
      title: 'Add team member',
      subtitle: 'Each person receives their own account and branch scope.',
      fields: [
        { name: 'name', label: 'Full name', required: true },
        { name: 'email', label: 'Email', type: 'email', required: true },
        {
          name: 'password',
          label: 'Temporary password',
          type: 'password',
          required: true,
          minLength: 12,
          hint: 'At least 12 characters; not only spaces.',
        },
        {
          name: 'role',
          label: 'Role',
          type: 'select',
          required: true,
          options: ROLES.map((r) => ({ value: r, label: roleLabels[r] })),
        },
        {
          name: 'branchIds',
          label: 'Branch access',
          type: 'multiselect',
          required: true,
          options: branchOptions,
        },
      ],
      submit: async (v) => {
        if (!(v.branchIds as string[]).length) throw new Error('Select at least one branch');
        await request('/api/users', { method: 'POST', body: JSON.stringify(v) });
        setSession(await bootstrap());
        setToast('Team member created');
      },
    });
  }
  function editUser(target: User) {
    open({
      title: `Edit ${target.name}`,
      initial: {
        role: target.role,
        branchIds: target.branchIds,
        active: target.active ? 'true' : 'false',
      },
      fields: [
        {
          name: 'role',
          label: 'Role',
          type: 'select',
          required: true,
          options: ROLES.map((r) => ({ value: r, label: roleLabels[r] })),
        },
        {
          name: 'branchIds',
          label: 'Branch access',
          type: 'multiselect',
          required: true,
          options: branchOptions,
        },
        {
          name: 'active',
          label: 'Account status',
          type: 'select',
          required: true,
          options: [
            { value: 'true', label: 'Active' },
            { value: 'false', label: 'Disabled' },
          ],
        },
      ],
      submit: async (v) => {
        if (!(v.branchIds as string[]).length) throw new Error('Select at least one branch');
        await request(`/api/users/${target.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            role: v.role,
            branchIds: v.branchIds,
            active: v.active === 'true',
          }),
        });
        setSession(await bootstrap());
        setToast('Team member updated');
      },
    });
  }
  function cancelOrder(o: Order) {
    open({
      title: `Cancel ${o.number}`,
      submitLabel: 'Confirm cancellation',
      fields: [{ name: 'reason', label: 'Cancellation reason', type: 'textarea', required: true }],
      submit: async (v) => {
        await run('order.cancel', { orderId: o.id, reason: text(v.reason) });
      },
    });
  }
  async function exportData(path: string) {
    const response = await fetch(path, { credentials: 'include' });
    if (!response.ok) {
      let err = 'Export failed';
      try {
        err = (await response.json()).error || err;
      } catch {}
      throw new Error(err);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = path.includes('csv') ? 'cylinders.csv' : 'cylvero-operations.json';
    a.click();
    URL.revokeObjectURL(url);
  }
  async function safeExport(path: string) {
    try {
      await exportData(path);
    } catch (e) {
      setToast(e instanceof Error ? plainOfficeError(e.message) : 'Export failed');
    }
  }
  // CSV imports accept readable names as well as internal codes: "Delhi" or "b-delhi",
  // "Company owned" or "company", a customer/supplier name or its ID, any-case gas names.
  const importRefs = {
    branch: (value: string) => {
      const v = value.trim().toLowerCase();
      return (
        s.branches.find((b) => [b.id, b.name, b.city].some((x) => x.toLowerCase() === v))?.id ??
        value.trim()
      );
    },
    owner: (value: string, branchId: string) => {
      const v = value.trim().toLowerCase();
      if (v === 'company' || v === 'company owned') return 'company';
      const matches = s.parties.filter(
        (p) => p.id.toLowerCase() === v || p.name.toLowerCase() === v,
      );
      return (matches.find((p) => p.branchId === branchId) ?? matches[0])?.id ?? value.trim();
    },
    gas: (value: string) =>
      GASES.find((g) => g.toLowerCase() === value.trim().toLowerCase()) ?? value.trim(),
  };
  function importCsv() {
    open({
      title: 'Import cylinders',
      subtitle:
        'Upload a CSV file or paste rows. Required columns: serial,tag,manufacturer,gas,size,ownerId,branchId,testDue,lastTest,certificate. ownerId may be "Company owned" or a customer name; branchId may be the branch name (for example Delhi). Dates use YYYY-MM-DD. Maximum 500 rows; if any row is wrong, nothing is imported.',
      fields: [
        { name: 'file', label: 'CSV file', type: 'file', span: 'full' },
        { name: 'csv', label: 'Or paste CSV data', type: 'textarea', span: 'full' },
      ],
      submit: async (v) => {
        const contents = v.file instanceof File ? await v.file.text() : text(v.csv);
        if (!contents.trim()) throw new Error('Choose a CSV file or paste CSV data');
        const parsed = parseCsv(contents);
        const headers = parsed.shift()?.map((x) => x.trim()) || [];
        const needed: readonly string[] = CYLINDER_IMPORT_COLUMNS;
        if (
          new Set(headers).size !== headers.length ||
          headers.some((h) => !needed.includes(h) && h !== 'contents')
        )
          throw new Error(
            'CSV contains duplicate or unsupported columns. Use the listed import columns.',
          );
        if (needed.some((x) => !headers.includes(x)))
          throw new Error(`CSV needs columns: ${needed.join(', ')}`);
        if (parsed.length > 500) throw new Error('Maximum 500 cylinders per import');
        const rows = parsed.map((cols, index) => {
          if (cols.length !== headers.length)
            throw new Error(
              `Row ${index + 2} has ${cols.length} columns; expected ${headers.length}`,
            );
          const row: Record<string, string> = Object.fromEntries(
            headers.map((h, i) => [h, cols[i] || '']),
          );
          row.branchId = importRefs.branch(row.branchId);
          row.ownerId = importRefs.owner(row.ownerId, row.branchId);
          row.gas = importRefs.gas(row.gas);
          return row;
        });
        await run('cylinders.import', { rows });
      },
    });
  }

  factories.current = {
    inspect: (id) => {
      const x = cylinders.find((x) => x.id === id);
      if (!x) throw new Error('Record no longer available');
      inspect(x);
    },
    retag: (id) => {
      const x = cylinders.find((x) => x.id === id);
      if (!x) throw new Error('Record no longer available');
      retag(x);
    },
    emptyCylinder: (id) => {
      const x = cylinders.find((x) => x.id === id);
      if (!x) throw new Error('Record no longer available');
      emptyCylinder(x);
    },
    offsiteIncident: (id) => {
      const x = cylinders.find((x) => x.id === id);
      if (!x) throw new Error('Record no longer available');
      offsiteIncident(x);
    },
    rejectBatchCylinder: (id) => {
      const x = batches.find((x) => x.id === id);
      if (!x) throw new Error('Record no longer available');
      rejectBatchCylinder(x);
    },
    editParty: (id) => {
      const x = parties.find((x) => x.id === id);
      if (!x) throw new Error('Record no longer available');
      editParty(x);
    },
    dispatch: (id) => {
      const x = orders.find((x) => x.id === id);
      if (!x) throw new Error('Record no longer available');
      dispatch(x);
    },
    deliver: (id) => {
      const x = orders.find((x) => x.id === id);
      if (!x) throw new Error('Record no longer available');
      deliver(x);
    },
    unload: (id) => {
      const x = orders.find((x) => x.id === id);
      if (!x) throw new Error('Record no longer available');
      unload(x);
    },
    receiveReturn: (id) => receiveReturn(parties.find((p) => p.id === id)),
    createBatch,
    supplierSend,
    supplierReceive,
    issueInvoice: (id) => {
      const x = orders.find((x) => x.id === id);
      if (!x) throw new Error('Record no longer available');
      issueInvoice(x);
    },
    settingsForm,
    collectReturns,
    reverseCollection,
    release: (id) => {
      const x = batches.find((x) => x.id === id);
      if (!x) throw new Error('Record no longer available');
      release(x);
    },
    recall: (id) => {
      const x = batches.find((x) => x.id === id);
      if (!x) throw new Error('Record no longer available');
      recall(x);
    },
    credit: (id) => {
      const x = s.invoices.find((x) => x.id === id);
      if (!x) throw new Error('Record no longer available');
      credit(x);
    },
  };
  async function reloadForm() {
    if (!form?.reload) throw new Error('Close and reopen this form to reload it.');
    const descriptor = form.reload;
    const refreshed = await bootstrap();
    latestSession.current = refreshed;
    flushSync(() => setSession(refreshed));
    captureSpec.current = { active: true, spec: null };
    try {
      factories.current[descriptor.kind]?.(descriptor.id);
    } finally {
      captureSpec.current.active = false;
    }
    const next = captureSpec.current.spec;
    if (!next)
      throw new Error('This action is no longer available. Close this form and check the record.');
    const resetValues = ['editParty', 'settingsForm'].includes(descriptor.kind);
    setForm(next);
    return { ...next, onSubmit: next.submit, resetValues };
  }
  const viewContent: Record<View, ReactNode> = {
    overview: (
      <Overview
        s={s}
        u={u}
        users={users}
        navigate={navigate}
        showDetail={setDetail}
        actions={{ createOrder, register, receiveReturn, createBatch }}
      />
    ),
    cylinders: (
      <Cylinders
        s={s}
        items={cylinders}
        search={search}
        setSearch={setSearch}
        filter={filter}
        setFilter={setFilter}
        showDetail={(id) => setDetail({ kind: 'cylinder', id })}
        register={register}
        inspect={inspect}
        retag={retag}
        exportCsv={() => safeExport('/api/cylinders.csv')}
        importCsv={importCsv}
        canExport={u.role !== 'driver'}
        canWrite={allowed('admin', 'operations')}
        canInspect={allowed('admin', 'quality')}
      />
    ),
    production: (
      <Production
        s={s}
        people={people}
        items={batches}
        search={search}
        setSearch={setSearch}
        showDetail={(id) => setDetail({ kind: 'batch', id })}
        createBatch={createBatch}
        release={release}
        recall={recall}
        canCreate={allowed('admin', 'operations')}
        canQuality={allowed('admin', 'quality')}
      />
    ),
    orders: (
      <Orders
        s={s}
        items={orders}
        users={users}
        search={search}
        setSearch={setSearch}
        filter={filter}
        setFilter={setFilter}
        showDetail={(id) => setDetail({ kind: 'order', id })}
        createOrder={createOrder}
        dispatch={dispatch}
        deliver={deliver}
        unload={unload}
        receiveReturn={() => receiveReturn()}
        collectReturns={collectReturns}
        reverseCollection={reverseCollection}
        reportDiscrepancy={reportDiscrepancy}
        cancelOrder={cancelOrder}
        canOperate={allowed('admin', 'operations')}
        canDeliver={allowed('admin', 'operations', 'driver')}
        currentUser={u}
      />
    ),
    customers: (
      <Parties
        s={s}
        items={customerParties}
        title="Customers"
        search={search}
        setSearch={setSearch}
        add={() => createParty()}
        edit={editParty}
        showDetail={(id) => setDetail({ kind: 'party', id })}
        canAdd={allowed('admin', 'operations', 'finance')}
        canEdit={allowed('admin', 'finance')}
        financialRead={financialRead}
        canReturn={allowed('admin', 'operations')}
        receiveReturn={receiveReturn}
      />
    ),
    suppliers: (
      <Suppliers
        s={s}
        items={suppliers}
        search={search}
        setSearch={setSearch}
        add={() => createParty('supplier')}
        edit={editParty}
        showDetail={(id) => setDetail({ kind: 'party', id })}
        send={supplierSend}
        receive={supplierReceive}
        purchase={purchaseReceive}
        canOperate={allowed('admin', 'operations')}
        canEdit={allowed('admin', 'finance')}
      />
    ),
    billing: financialRead ? (
      <Billing
        s={s}
        search={search}
        setSearch={setSearch}
        filter={filter}
        setFilter={setFilter}
        showDetail={(id) => setDetail({ kind: 'invoice', id })}
        invoice={issueInvoice}
        rental={rentalInvoice}
        receipt={receipt}
        deposit={deposit}
        credit={credit}
        unallocateCredit={unallocateCredit}
        allocateCredit={allocateCredit}
        refundCredit={refundCredit}
        canFinance={allowed('admin', 'finance')}
      />
    ) : (
      <Card>
        <Empty
          title="Finance access required"
          description="This area is available to finance, audit and administrators."
        />
      </Card>
    ),
    safety: (
      <Safety
        s={s}
        inspect={inspect}
        recall={recall}
        resolve={resolveException}
        showCylinder={(id) => setDetail({ kind: 'cylinder', id })}
        canInspect={allowed('admin', 'quality')}
        canResolve={allowed('admin', 'operations', 'quality')}
      />
    ),
    reports: (
      <Reports
        s={s}
        exportJson={() => safeExport('/api/export')}
        exportCsv={() => safeExport('/api/cylinders.csv')}
        canExport={allowed('admin', 'auditor')}
        canCsv={u.role !== 'driver'}
      />
    ),
    settings: (
      <Settings
        s={s}
        users={users}
        currentUser={u}
        editSettings={settingsForm}
        addUser={addUser}
        editUser={editUser}
        changePassword={changePassword}
        resetPassword={resetPassword}
        canAdmin={allowed('admin')}
        financialRead={financialRead}
      />
    ),
  };
  return (
    <div className="app-shell">
      <aside className={`sidebar ${menu ? 'sidebar-open' : ''}`}>
        <div className="sidebar-top">
          <div className="brand">
            <div className="brand-symbol">C</div>
            <div>
              <strong>Cylvero</strong>
              <small>Operations workspace</small>
            </div>
          </div>
          <button
            className="icon-button mobile-only"
            aria-label="Close navigation"
            onClick={() => setMenu(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="workspace-chip">
          <span className="chip-dot" />
          <div>
            <strong>{s.settings.mode === 'demo' ? 'Demo workspace' : 'Local workspace'}</strong>
            <small>
              {s.settings.mode === 'demo' ? 'Synthetic records' : 'Operational records'}
            </small>
          </div>
        </div>
        <nav aria-label="Main navigation">
          {['Workspace', 'Operations', 'People', 'Finance', 'Control'].map((group) => {
            const links = nav.filter(
              (n) =>
                n.group === group &&
                (n.id !== 'billing' || financialRead) &&
                // Quality staff do not buy or manage suppliers (simplification plan 5.2).
                (n.id !== 'suppliers' || u.role !== 'quality'),
            );
            return links.length ? (
              <div key={group} className="nav-group">
                <div className="nav-heading">{group}</div>
                {links.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => navigate(n.id)}
                    className={`nav-item ${view === n.id ? 'active' : ''}`}
                    aria-current={view === n.id ? 'page' : undefined}
                  >
                    <n.icon size={19} weight={view === n.id ? 'fill' : 'regular'} />
                    <span>{n.label}</span>
                  </button>
                ))}
              </div>
            ) : null;
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="user-card">
            <div className="avatar">
              {u.name
                .split(' ')
                .map((x) => x[0])
                .slice(0, 2)
                .join('')}
            </div>
            <div>
              <strong>{u.name}</strong>
              <small>{roleLabels[u.role]}</small>
            </div>
          </div>
          <button className="nav-item signout" onClick={signout}>
            <SignOut size={18} /> Sign out
          </button>
        </div>
      </aside>
      {menu && (
        <button
          className="mobile-backdrop"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-only"
            aria-label="Open navigation"
            onClick={() => setMenu(true)}
          >
            <List size={22} />
          </button>
          <div className="crumb">
            Workspace <span>/</span> <strong>{labels[view]}</strong>
          </div>
          <div className="topbar-right">
            {s.settings.mode === 'demo' && (
              <DemoWalkthrough state={s} user={u} onNavigate={navigate} />
            )}
            {canSwitchMode(u.role) && (
              <button
                className="btn button simple-mode"
                onClick={() => switchMode('basic')}
                title="Big pictures for scanning and delivery"
              >
                <HandTap size={16} weight="duotone" aria-hidden="true" />
                <span>Simple mode</span>
              </button>
            )}
            <div className="top-avatar">{u.name[0]}</div>
          </div>
        </header>
        <main className="content">
          <OfflinePanel state={s} user={u} onSynced={async () => setSession(await bootstrap())} />
          {viewContent[view]}
        </main>
      </div>
      {form && (
        <ActionForm
          {...form}
          onClose={() => setForm(null)}
          onSubmit={form.submit}
          onReloadLatest={form.reload ? reloadForm : undefined}
        />
      )}
      {detail && (
        <Detail
          kind={detail.kind}
          id={detail.id}
          s={s}
          users={users}
          people={people}
          currentUser={u}
          onClose={() => setDetail(null)}
          actions={{
            inspect,
            emptyCylinder,
            offsiteIncident,
            stopIncidentRent,
            writeOff,
            rejectBatchCylinder,
            retag,
            dispatch,
            deliver,
            unload,
            release,
            recall,
            editParty,
            issueInvoice,
            receipt,
            credit,
          }}
          permissions={{
            operate: allowed('admin', 'operations'),
            inspect: allowed('admin', 'quality'),
            quality: allowed('admin', 'quality'),
            finance: allowed('admin', 'finance'),
            financialRead,
            deliver: allowed('admin', 'operations', 'driver'),
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <span aria-hidden="true">•</span>
          {toast}
          <button aria-label="Dismiss" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function Login({
  mode,
  onSubmit,
  error,
}: {
  mode: 'demo' | 'live';
  onSubmit: (email: string, password: string) => Promise<void>;
  error: string;
}) {
  const [email, setEmail] = useState(mode === 'demo' ? 'operations@batra.demo' : ''),
    [password, setPassword] = useState(mode === 'demo' ? 'OxygenDemo!2026' : ''),
    [busy, setBusy] = useState(false),
    // Demo mode lists the built-in accounts; members added in Settings sign in by email.
    [otherAccount, setOtherAccount] = useState(false);
  useEffect(() => {
    if (mode === 'demo') {
      setEmail('operations@batra.demo');
      setPassword('OxygenDemo!2026');
      setOtherAccount(false);
    }
  }, [mode]);
  const typedEmail = mode !== 'demo' || otherAccount;
  return (
    <div className="login-screen">
      <div className="login-panel">
        <div className="login-brand">
          <div className="brand-symbol">C</div>
          <span>Cylvero</span>
        </div>
        <div className="login-copy">
          <div className="eyebrow">Operations workspace</div>
          <h1>
            Every cylinder.
            <br />
            Accounted for.
          </h1>
          <p>
            One place to manage stock, dispatch, quality and billing with a clear record of each
            movement.
          </p>
        </div>
        <div className="login-footer">
          {mode === 'demo'
            ? 'Local demonstration · Synthetic data only'
            : 'Cylvero · Cylinder operations'}
        </div>
      </div>
      <div className="login-form-wrap">
        <form
          className="login-card"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await onSubmit(email, password);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="eyebrow">Welcome back</div>
          <h2>Sign in to your workspace</h2>
          <p>
            {mode === 'demo'
              ? 'Choose a demo role to explore its permitted work.'
              : 'Enter your assigned account credentials.'}
          </p>
          {mode === 'demo' && (
            <label className="field">
              <span className="field-label">Demo account</span>
              <select
                value={otherAccount ? 'other' : email}
                onChange={(e) => {
                  if (e.target.value === 'other') {
                    setOtherAccount(true);
                    setEmail('');
                    setPassword('');
                  } else {
                    setOtherAccount(false);
                    setEmail(e.target.value);
                    setPassword('OxygenDemo!2026');
                  }
                }}
              >
                {ROLES.map((role) => (
                  <option value={`${role}@batra.demo`} key={role}>
                    {roleLabels[role]} · {role}@batra.demo
                  </option>
                ))}
                <option value="other">Other account (type an email)</option>
              </select>
            </label>
          )}
          {typedEmail && (
            <label className="field">
              <span className="field-label">Email address</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
            </label>
          )}
          <label className="field">
            <span className="field-label">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <Button type="submit" loading={busy} className="login-submit">
            Sign in <ArrowRight size={17} />
          </Button>
          {mode === 'demo' && (
            <div className="demo-hint">
              <strong>Demo access</strong>
              <span>Password: OxygenDemo!2026</span>
              <span>Accounts are role scoped. No live business data is used.</span>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

function Overview({
  s,
  u,
  users,
  navigate,
  showDetail,
  actions,
}: {
  s: AppState;
  u: User;
  users: User[];
  navigate: (v: View) => void;
  showDetail: (d: { kind: 'order' | 'cylinder'; id: string }) => void;
  actions: {
    createOrder: () => void;
    register: () => void;
    receiveReturn: (p?: Party) => void;
    createBatch: () => void;
  };
}) {
  const cs = s.cylinders,
    ready = cs.filter(
      (c) =>
        c.custody === 'plant' &&
        c.contents === 'full' &&
        c.condition === 'serviceable' &&
        c.testDue >= today() &&
        !!c.batchId &&
        s.batches.some((b) => b.id === c.batchId && b.status === 'released'),
    ).length,
    held = cs.filter((c) => c.custody === 'customer').length,
    plant = cs.filter((c) => c.custody === 'plant').length,
    vehicle = cs.filter((c) => c.custody === 'vehicle').length,
    supplier = cs.filter((c) => c.custody === 'supplier').length,
    unsafe = cs.filter((c) => c.condition !== 'serviceable' || c.testDue < today()).length,
    active = s.orders.filter((o) => ['open', 'dispatched', 'partial'].includes(o.status)),
    due = s.cylinders.filter((c) => c.condition === 'inspection_due' || c.testDue < today()),
    openExceptions = s.exceptions.filter((e) => e.status === 'open');
  return (
    <>
      <PageHeader
        eyebrow="Daily command center"
        title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${u.name.split(' ')[0]}`}
        description={`${date(today())} · ${s.branches.length} branches · saved revision ${s.revision}`}
        actions={
          <>
            {['admin', 'operations'].includes(u.role) && (
              <Button onClick={actions.createOrder}>
                <Plus size={16} /> New order
              </Button>
            )}
          </>
        }
      />
      <div className="overview-top">
        <div className="hero-card">
          <div className="hero-kicker">
            <span className="live-dot" /> FLEET POSITION
          </div>
          <div className="hero-main">
            <div>
              <span className="hero-number">{cs.length}</span>
              <span className="hero-unit">cylinders tracked</span>
            </div>
            <p>Each unit has a known custodian, contents and safety status.</p>
          </div>
          <div className="hero-breakdown">
            <div>
              <strong>{plant}</strong>
              <span>At plant</span>
            </div>
            <div>
              <strong>{vehicle}</strong>
              <span>On vehicle</span>
            </div>
            <div>
              <strong>{held}</strong>
              <span>With customers</span>
            </div>
            <div>
              <strong>{supplier}</strong>
              <span>With suppliers</span>
            </div>
          </div>
        </div>
        <div className="overview-stats">
          <Stat
            label="Ready to dispatch"
            value={ready}
            detail="Released, safe, full stock"
            tone="good"
          />
          <Stat
            label="Open orders"
            value={active.length}
            detail={`${active.filter((o) => o.priority === 'urgent').length} urgent requests`}
          />
          <Stat
            label="Safety attention"
            value={unsafe + openExceptions.length}
            detail={`${due.length} test or inspection due`}
            tone="warn"
          />
          <Stat label="Customer holdings" value={held} detail="Individual cylinders on rent" />
        </div>
      </div>
      <div className="dashboard-grid">
        <Card>
          <div className="section-heading">
            <div>
              <div className="eyebrow">Dispatch desk</div>
              <h2>Orders in motion</h2>
            </div>
            <button className="text-link" onClick={() => navigate('orders')}>
              View all <ArrowRight size={15} />
            </button>
          </div>
          {active.length ? (
            <div className="stack-list">
              {active.slice(0, 6).map((o) => (
                <button
                  className="stack-row"
                  key={o.id}
                  onClick={() => showDetail({ kind: 'order', id: o.id })}
                >
                  <span className="row-icon">
                    <Truck size={18} />
                  </span>
                  <span className="row-primary">
                    <strong>
                      {o.number} · {party(s, o.partyId)}
                    </strong>
                    <small>
                      {o.quantity} × {o.size} · due {date(o.dueDate)}
                    </small>
                  </span>
                  <Badge tone={statusTone(o.status)}>{display(o.status)}</Badge>
                  <ArrowRight size={16} className="row-arrow" />
                </button>
              ))}
            </div>
          ) : (
            <Empty title="No open orders" description="New dispatch work will appear here." />
          )}
        </Card>
        <Card>
          <div className="section-heading">
            <div>
              <div className="eyebrow">Quality watch</div>
              <h2>Needs attention</h2>
            </div>
            <button className="text-link" onClick={() => navigate('safety')}>
              Safety queue <ArrowRight size={15} />
            </button>
          </div>
          {due.length || openExceptions.length ? (
            <div className="stack-list">
              {due.slice(0, 4).map((c) => (
                <button
                  className="stack-row"
                  key={c.id}
                  onClick={() => showDetail({ kind: 'cylinder', id: c.id })}
                >
                  <span className="row-icon attention">
                    <WarningCircle size={18} />
                  </span>
                  <span className="row-primary">
                    <strong>
                      {c.tag} · {c.serial}
                    </strong>
                    <small>
                      {c.testDue < today() ? 'Test overdue' : display(c.condition)} ·{' '}
                      {branch(s, c.branchId)}
                    </small>
                  </span>
                  <ArrowRight size={16} className="row-arrow" />
                </button>
              ))}
              {openExceptions.slice(0, 2).map((e) => (
                <div className="stack-row" key={e.id}>
                  <span className="row-icon attention">
                    <WarningCircle size={18} />
                  </span>
                  <span className="row-primary">
                    <strong>{display(e.type)}</strong>
                    <small>{e.summary}</small>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title="No safety items"
              description="Exceptions and inspection due items will appear here."
            />
          )}
        </Card>
      </div>
      <div className="dashboard-grid lower">
        <Card>
          <div className="section-heading">
            <div>
              <div className="eyebrow">Traceable work</div>
              <h2>Recent activity</h2>
            </div>
            <button className="text-link" onClick={() => navigate('reports')}>
              Audit trail <ArrowRight size={15} />
            </button>
          </div>
          <div className="activity-list">
            {s.audit.slice(0, 6).map((a) => (
              <div className="activity-row" key={a.id}>
                <span className="activity-dot" />
                <div>
                  <strong>{a.summary}</strong>
                  <small>
                    {a.actorName} · {datetime(a.at)}
                  </small>
                </div>
              </div>
            ))}
            {!s.audit.length && (
              <p className="muted pad">Activity appears after the first saved action.</p>
            )}
          </div>
        </Card>
        <Card>
          <div className="section-heading">
            <div>
              <div className="eyebrow">At a glance</div>
              <h2>Next actions</h2>
            </div>
          </div>
          <div className="quick-actions">
            {(['admin', 'operations'].includes(u.role)
              ? [
                  {
                    label: 'Register cylinder',
                    desc: 'Add a serialized asset',
                    fn: actions.register,
                    icon: Cube,
                  },
                  {
                    label: 'Receive returns',
                    desc: 'Record physical receipt',
                    fn: () => actions.receiveReturn(),
                    icon: ArrowClockwise,
                  },
                  {
                    label: 'Create fill batch',
                    desc: 'Prepare stock for quality',
                    fn: actions.createBatch,
                    icon: Factory,
                  },
                ]
              : [
                  {
                    label: 'Review safety queue',
                    desc: 'Inspections and exceptions',
                    fn: () => navigate('safety'),
                    icon: ShieldCheck,
                  },
                  {
                    label: ['finance', 'auditor'].includes(u.role)
                      ? 'Open billing'
                      : 'View assigned work',
                    desc: ['finance', 'auditor'].includes(u.role)
                      ? 'Invoices and rental ledger'
                      : 'Orders and delivery records',
                    fn: () =>
                      navigate(['finance', 'auditor'].includes(u.role) ? 'billing' : 'orders'),
                    icon: Receipt,
                  },
                ]
            ).map((x) => (
              <button key={x.label} className="quick-action" onClick={x.fn}>
                <x.icon size={19} />
                <span>
                  <strong>{x.label}</strong>
                  <small>{x.desc}</small>
                </span>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  // Row actions stay pinned in view on narrow screens (see .has-actions in styles.css).
  const hasActions = headers.at(-1) === 'Actions';
  return (
    <div className={hasActions ? 'table-scroll has-actions' : 'table-scroll'}>
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
function FilterPills({
  items,
  value,
  onChange,
}: {
  items: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="filters" role="group" aria-label="Filter records">
      {items.map((x) => (
        <button
          key={x.value}
          className={value === x.value ? 'selected' : ''}
          aria-pressed={value === x.value}
          onClick={() => onChange(x.value)}
        >
          {x.label}
        </button>
      ))}
    </div>
  );
}
function Toolbar({
  search,
  setSearch,
  children,
  placeholder,
}: {
  search: string;
  setSearch: (v: string) => void;
  children?: ReactNode;
  placeholder?: string;
}) {
  return (
    <div className="toolbar">
      <Search value={search} onChange={setSearch} placeholder={placeholder} />
      <div className="toolbar-actions">{children}</div>
    </div>
  );
}

function Cylinders({
  s,
  items,
  search,
  setSearch,
  filter,
  setFilter,
  showDetail,
  register,
  inspect,
  retag,
  exportCsv,
  importCsv,
  canWrite,
  canExport,
  canInspect,
}: {
  s: AppState;
  items: Cylinder[];
  search: string;
  setSearch: (v: string) => void;
  filter: string;
  setFilter: (v: string) => void;
  showDetail: (id: string) => void;
  register: () => void;
  inspect: (c: Cylinder) => void;
  retag: (c: Cylinder) => void;
  exportCsv: () => void;
  importCsv: () => void;
  canWrite: boolean;
  canExport: boolean;
  canInspect: boolean;
}) {
  const [scanMessage, setScanMessage] = useState('');
  const filtered = items.filter((c) => {
    const q = search.toLowerCase();
    return (
      (!q ||
        [
          c.serial,
          c.tag,
          ...(c.previousTags || []),
          c.manufacturer,
          c.gas,
          c.size,
          party(s, c.ownerId),
        ].some((x) => x.toLowerCase().includes(q))) &&
      (filter === 'all' || filter === c.custody || filter === c.condition)
    );
  });
  return (
    <>
      <PageHeader
        eyebrow="Asset register"
        title="Cylinders"
        description="Trace every serialized unit from inspection through delivery and return."
        actions={
          <>
            {canWrite && (
              <Button variant="secondary" onClick={downloadCylinderImportTemplate}>
                Download import template
              </Button>
            )}
            {canWrite && (
              <Button variant="secondary" onClick={importCsv}>
                <UploadSimple size={16} /> Import CSV
              </Button>
            )}
            {canExport && (
              <Button variant="secondary" onClick={exportCsv}>
                <DownloadSimple size={16} /> Export CSV
              </Button>
            )}
            {canWrite && (
              <Button onClick={register}>
                <Plus size={16} /> Register cylinder
              </Button>
            )}
          </>
        }
      />
      <div className="summary-strip">
        <Stat label="Total assets" value={items.length} />
        <Stat label="At plant" value={items.filter((c) => c.custody === 'plant').length} />
        <Stat label="With customers" value={items.filter((c) => c.custody === 'customer').length} />
        <Stat
          label="On safety hold"
          value={items.filter((c) => c.condition !== 'serviceable').length}
          tone="warn"
        />
      </div>
      <Card>
        <div className="cylinder-scan">
          <ScannerInput
            placeholder="Scan a cylinder label to open it"
            onScan={(code) => {
              const key = code.trim().toLowerCase();
              const found = items.find((c) =>
                [c.tag, c.serial, c.id, ...(c.previousTags ?? [])].some(
                  (x) => x.toLowerCase() === key,
                ),
              );
              setScanMessage(found ? '' : `No cylinder found for “${code}”.`);
              if (found) showDetail(found.id);
            }}
          />
          {scanMessage && (
            <p role="alert" className="form-error">
              {scanMessage}
            </p>
          )}
        </div>
        <Toolbar search={search} setSearch={setSearch} placeholder="Search tag, serial, owner…">
          <span className="results-count">{count(filtered.length, 'record')}</span>
        </Toolbar>
        <FilterPills
          value={filter}
          onChange={setFilter}
          items={[
            { value: 'all', label: 'All' },
            { value: 'plant', label: 'At plant' },
            { value: 'vehicle', label: 'Vehicle' },
            { value: 'customer', label: 'Customer' },
            { value: 'supplier', label: 'Supplier' },
            { value: 'inspection_due', label: 'Inspection due' },
            { value: 'quarantine', label: 'Quarantine' },
          ]}
        />
        {filtered.length ? (
          <Table
            headers={[
              'Tag / serial',
              'Gas & size',
              'Custody',
              'Contents',
              'Condition',
              'Test due',
              'Actions',
            ]}
          >
            {filtered.map((c) => (
              <tr key={c.id}>
                <td>
                  <button className="table-link" onClick={() => showDetail(c.id)}>
                    {c.tag}
                  </button>
                  <small className="cell-sub">{c.serial}</small>
                </td>
                <td>
                  {c.gas}
                  <small className="cell-sub">
                    {c.size} · {c.manufacturer}
                  </small>
                </td>
                <td>
                  <strong>{display(c.custody)}</strong>
                  <small className="cell-sub">{custodian(s, c)}</small>
                </td>
                <td>
                  <Badge tone={c.contents === 'full' ? 'blue' : 'neutral'}>
                    {display(c.contents)}
                  </Badge>
                </td>
                <td>
                  <Badge tone={gasTone(c)}>{display(c.condition)}</Badge>
                </td>
                <td className={c.testDue < today() ? 'alert-text' : ''}>{date(c.testDue)}</td>
                <td>
                  <div className="row-actions">
                    <button onClick={() => showDetail(c.id)}>Details</button>
                    {canInspect && c.custody === 'plant' && c.condition !== 'retired' && (
                      <button onClick={() => inspect(c)}>Inspect</button>
                    )}
                    {canWrite && c.custody === 'plant' && (
                      <button onClick={() => retag(c)}>Retag</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty
            title="No cylinders found"
            description="Try another search or register a new cylinder."
          />
        )}
      </Card>
    </>
  );
}

function Production({
  s,
  people,
  items,
  search,
  setSearch,
  showDetail,
  createBatch,
  release,
  recall,
  canCreate,
  canQuality,
}: {
  s: AppState;
  people: { id: string; name: string }[];
  items: Batch[];
  search: string;
  setSearch: (v: string) => void;
  showDetail: (id: string) => void;
  createBatch: () => void;
  release: (b: Batch) => void;
  recall: (b: Batch) => void;
  canCreate: boolean;
  canQuality: boolean;
}) {
  const filtered = items.filter((b) =>
    [b.number, b.gas, b.source, b.fillOperator || '', b.operator].some((x) =>
      x.toLowerCase().includes(search.toLowerCase()),
    ),
  );
  return (
    <>
      <PageHeader
        eyebrow="Fill & quality"
        title="Production"
        description="Make filled stock available only after independent quality release."
        actions={
          canCreate && (
            <Button onClick={createBatch}>
              <Plus size={16} /> Create batch
            </Button>
          )
        }
      />
      <div className="summary-strip">
        <Stat
          label="Awaiting release"
          value={items.filter((b) => b.status === 'awaiting_release').length}
          tone="warn"
        />
        <Stat
          label="Released"
          value={items.filter((b) => b.status === 'released').length}
          tone="good"
        />
        <Stat
          label="Recalled"
          value={items.filter((b) => b.status === 'recalled').length}
          tone="warn"
        />
        <Stat
          label="Cylinders in batches"
          value={items.reduce((n, b) => n + b.cylinderIds.length, 0)}
        />
      </div>
      <Card>
        <Toolbar
          search={search}
          setSearch={setSearch}
          placeholder="Search batch, source, operator…"
        >
          <span className="results-count">{count(filtered.length, 'batch', 'batches')}</span>
        </Toolbar>
        {filtered.length ? (
          <Table
            headers={[
              'Batch',
              'Gas / source',
              'Cylinders',
              'Operator',
              'Created',
              'Status',
              'Actions',
            ]}
          >
            {filtered.map((b) => (
              <tr key={b.id}>
                <td>
                  <button className="table-link" onClick={() => showDetail(b.id)}>
                    {b.number}
                  </button>
                  <small className="cell-sub">{branch(s, b.branchId)}</small>
                </td>
                <td>
                  {b.gas}
                  <small className="cell-sub">{b.source}</small>
                </td>
                <td>{b.cylinderIds.length}</td>
                <td>{b.fillOperator || person(people, b.operator)}</td>
                <td>{date(b.createdAt)}</td>
                <td>
                  <Badge tone={statusTone(b.status)}>{display(b.status)}</Badge>
                </td>
                <td>
                  <div className="row-actions">
                    <button onClick={() => showDetail(b.id)}>Details</button>
                    {canQuality && b.status === 'awaiting_release' && (
                      <button onClick={() => release(b)}>Release</button>
                    )}
                    {canQuality && b.status === 'released' && (
                      <button onClick={() => recall(b)}>Recall</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty
            title="No batches yet"
            description="Create a fill batch to begin the quality workflow."
            action={canCreate && <Button onClick={createBatch}>Create batch</Button>}
          />
        )}
      </Card>
    </>
  );
}

function Orders({
  s,
  items,
  users,
  search,
  setSearch,
  filter,
  setFilter,
  showDetail,
  createOrder,
  dispatch,
  deliver,
  unload,
  receiveReturn,
  collectReturns,
  reverseCollection,
  reportDiscrepancy,
  cancelOrder,
  canOperate,
  canDeliver,
  currentUser,
}: {
  s: AppState;
  items: Order[];
  users: User[];
  search: string;
  setSearch: (v: string) => void;
  filter: string;
  setFilter: (v: string) => void;
  showDetail: (id: string) => void;
  createOrder: () => void;
  dispatch: (o: Order) => void;
  deliver: (o: Order) => void;
  unload: (o: Order) => void;
  receiveReturn: () => void;
  collectReturns: () => void;
  reverseCollection: () => void;
  reportDiscrepancy: () => void;
  cancelOrder: (o: Order) => void;
  canOperate: boolean;
  canDeliver: boolean;
  currentUser: User;
}) {
  const filtered = items.filter(
    (o) =>
      (filter === 'all' || filter === o.status) &&
      [o.number, party(s, o.partyId), o.vehicle, o.gas].some((x) =>
        x.toLowerCase().includes(search.toLowerCase()),
      ),
  );
  return (
    <>
      <PageHeader
        eyebrow="Dispatch & acceptance"
        title="Orders & delivery"
        description="Pick exact cylinders, record partial acceptance and reconcile the vehicle."
        actions={
          <>
            {canOperate && (
              <Button variant="secondary" onClick={reverseCollection}>
                Undo collection
              </Button>
            )}
            {canOperate && (
              <Button variant="secondary" onClick={receiveReturn}>
                <ArrowClockwise size={16} /> Receive returns
              </Button>
            )}
            {canDeliver && (
              <Button variant="secondary" onClick={collectReturns}>
                Collect empties
              </Button>
            )}
            {canDeliver && (
              <Button variant="secondary" onClick={reportDiscrepancy}>
                Report unknown
              </Button>
            )}
            {canOperate && (
              <Button onClick={createOrder}>
                <Plus size={16} /> New order
              </Button>
            )}
          </>
        }
      />
      <div className="summary-strip">
        <Stat label="Open" value={items.filter((o) => o.status === 'open').length} />
        <Stat
          label="On vehicle"
          value={items.filter((o) => ['dispatched', 'partial'].includes(o.status)).length}
          tone="warn"
        />
        <Stat
          label="Delivered"
          value={items.filter((o) => o.status === 'delivered').length}
          tone="good"
        />
        <Stat
          label="Urgent active"
          value={
            items.filter(
              (o) =>
                o.priority === 'urgent' &&
                !['delivered', 'closed_short', 'cancelled'].includes(o.status),
            ).length
          }
          tone="warn"
        />
      </div>
      <Card>
        <Toolbar
          search={search}
          setSearch={setSearch}
          placeholder="Search order, customer, vehicle…"
        >
          <span className="results-count">{count(filtered.length, 'order')}</span>
        </Toolbar>
        <FilterPills
          value={filter}
          onChange={setFilter}
          items={[
            'all',
            'open',
            'dispatched',
            'partial',
            'closed_short',
            'delivered',
            'cancelled',
          ].map((x) => ({ value: x, label: display(x) }))}
        />
        {filtered.length ? (
          <Table headers={['Order', 'Customer', 'Request', 'Due', 'Progress', 'Status', 'Actions']}>
            {filtered.map((o) => (
              <tr key={o.id}>
                <td>
                  <button
                    className="table-link"
                    aria-label={`Open ${o.number} details and actions`}
                    onClick={() => showDetail(o.id)}
                  >
                    {o.number}
                  </button>
                  <small className="cell-sub">
                    {o.priority === 'urgent' ? 'Urgent · ' : ''}
                    {branch(s, o.branchId)}
                  </small>
                </td>
                <td>{party(s, o.partyId)}</td>
                <td>
                  {o.quantity} × {o.size}
                  <small className="cell-sub">{o.gas}</small>
                </td>
                <td>{date(o.dueDate)}</td>
                <td>
                  {o.deliveredIds.length} accepted · {o.unloadedIds?.length || 0} unloaded /{' '}
                  {o.cylinderIds.length || o.quantity}
                  <small className="cell-sub">of original request</small>
                </td>
                <td>
                  <Badge tone={statusTone(o.status)}>{display(o.status)}</Badge>
                </td>
                <td>
                  <div className="row-actions">
                    <button onClick={() => showDetail(o.id)}>Details</button>
                    {canOperate && o.status === 'open' && (
                      <button onClick={() => dispatch(o)}>Dispatch</button>
                    )}
                    {canDeliver &&
                      ['dispatched', 'partial'].includes(o.status) &&
                      (currentUser.role !== 'driver' || o.driverId === currentUser.id) && (
                        <button onClick={() => deliver(o)}>Deliver</button>
                      )}
                    {canOperate &&
                      ['dispatched', 'partial'].includes(o.status) &&
                      o.cylinderIds.some(
                        (id) => !o.deliveredIds.includes(id) && !o.unloadedIds?.includes(id),
                      ) && <button onClick={() => unload(o)}>Unload</button>}
                    {canOperate && o.status === 'open' && (
                      <button onClick={() => cancelOrder(o)}>Cancel</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty
            title="No orders found"
            description="Try another filter or create an order."
            action={canOperate && <Button onClick={createOrder}>New order</Button>}
          />
        )}
      </Card>
    </>
  );
}

function Parties({
  s,
  items,
  title,
  search,
  setSearch,
  add,
  edit,
  showDetail,
  canAdd,
  canEdit,
  financialRead,
  canReturn,
  receiveReturn,
}: {
  s: AppState;
  items: Party[];
  title: string;
  search: string;
  setSearch: (v: string) => void;
  add: () => void;
  edit: (p: Party) => void;
  showDetail: (id: string) => void;
  canAdd: boolean;
  canEdit: boolean;
  financialRead: boolean;
  canReturn: boolean;
  receiveReturn: (p?: Party) => void;
}) {
  const filtered = items.filter((p) =>
    [p.name, p.contact, p.city, p.phone, p.gstin].some((x) =>
      x.toLowerCase().includes(search.toLowerCase()),
    ),
  );
  return (
    <>
      <PageHeader
        eyebrow="Relationship directory"
        title={title}
        description="Customer details and cylinder custody in one place."
        actions={
          canAdd && (
            <Button onClick={add}>
              <Plus size={16} /> Add customer
            </Button>
          )
        }
      />
      <Card>
        <Toolbar search={search} setSearch={setSearch} placeholder="Search name, phone, city…">
          <span className="results-count">{count(filtered.length, 'customer')}</span>
        </Toolbar>
        {filtered.length ? (
          <Table
            headers={[
              'Customer',
              'Type',
              'Contact',
              'City',
              'Holding',
              ...(financialRead ? ['Rental / day'] : []),
              'Actions',
            ]}
          >
            {filtered.map((p) => (
              <tr key={p.id}>
                <td>
                  <button className="table-link" onClick={() => showDetail(p.id)}>
                    {p.name}
                  </button>
                  <small className="cell-sub">{p.gstin || 'No GSTIN'}</small>
                </td>
                <td>{display(p.type)}</td>
                <td>
                  {p.contact}
                  <small className="cell-sub">{p.phone}</small>
                </td>
                <td>{p.city}</td>
                <td>
                  {count(
                    s.cylinders.filter((c) => c.custody === 'customer' && c.custodianId === p.id)
                      .length,
                    'cylinder',
                  )}
                </td>
                {financialRead && <td>{money(p.dailyRentalPaise)}</td>}
                <td>
                  <div className="row-actions">
                    <button onClick={() => showDetail(p.id)}>Details</button>
                    {canEdit && <button onClick={() => edit(p)}>Edit</button>}
                    {canReturn && <button onClick={() => receiveReturn(p)}>Return</button>}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty
            title="No customers found"
            description="Add a customer or try another search."
            action={canAdd && <Button onClick={add}>Add customer</Button>}
          />
        )}
      </Card>
    </>
  );
}

function Suppliers({
  s,
  items,
  search,
  setSearch,
  add,
  edit,
  showDetail,
  send,
  receive,
  purchase,
  canOperate,
  canEdit,
}: {
  s: AppState;
  items: Party[];
  search: string;
  setSearch: (v: string) => void;
  add: () => void;
  edit: (p: Party) => void;
  showDetail: (id: string) => void;
  send: () => void;
  receive: () => void;
  purchase: () => void;
  canOperate: boolean;
  canEdit: boolean;
}) {
  const filtered = items.filter((p) =>
    [p.name, p.contact, p.city, p.phone].some((x) =>
      x.toLowerCase().includes(search.toLowerCase()),
    ),
  );
  return (
    <>
      <PageHeader
        eyebrow="Vendor custody"
        title="Suppliers & purchases"
        description="Track each cylinder sent out, received back or purchased new."
        actions={
          <>
            {canOperate && (
              <Button variant="secondary" onClick={send}>
                Send cylinders
              </Button>
            )}
            {canOperate && (
              <Button variant="secondary" onClick={receive}>
                Receive from supplier
              </Button>
            )}
            {canOperate && (
              <Button variant="secondary" onClick={purchase}>
                Receive purchase
              </Button>
            )}
            {canOperate && (
              <Button onClick={add}>
                <Plus size={16} /> Add supplier
              </Button>
            )}
          </>
        }
      />
      <div className="summary-strip">
        <Stat label="Suppliers" value={items.length} />
        <Stat
          label="With suppliers"
          value={s.cylinders.filter((c) => c.custody === 'supplier').length}
        />
        <Stat
          label="Received awaiting QC"
          value={s.batches.filter((b) => b.status === 'awaiting_release' && b.supplierId).length}
          tone="warn"
        />
      </div>
      <Card>
        <Toolbar search={search} setSearch={setSearch} placeholder="Search supplier or city…">
          <span className="results-count">{count(filtered.length, 'supplier')}</span>
        </Toolbar>
        {filtered.length ? (
          <Table headers={['Supplier', 'Contact', 'City', 'Cylinders held', 'Branch', 'Actions']}>
            {filtered.map((p) => (
              <tr key={p.id}>
                <td>
                  <button className="table-link" onClick={() => showDetail(p.id)}>
                    {p.name}
                  </button>
                  <small className="cell-sub">{p.gstin || 'No GSTIN'}</small>
                </td>
                <td>
                  {p.contact}
                  <small className="cell-sub">{p.phone}</small>
                </td>
                <td>{p.city}</td>
                <td>
                  {
                    s.cylinders.filter((c) => c.custody === 'supplier' && c.custodianId === p.id)
                      .length
                  }
                </td>
                <td>{branch(s, p.branchId)}</td>
                <td>
                  <div className="row-actions">
                    <button onClick={() => showDetail(p.id)}>Details</button>
                    {canEdit && <button onClick={() => edit(p)}>Edit</button>}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty
            title="No suppliers found"
            description="Add a supplier to manage external transfers and purchases."
            action={canOperate && <Button onClick={add}>Add supplier</Button>}
          />
        )}
      </Card>
    </>
  );
}

function Billing({
  s,
  search,
  setSearch,
  filter,
  setFilter,
  showDetail,
  invoice,
  rental,
  receipt,
  deposit,
  credit,
  allocateCredit,
  unallocateCredit,
  refundCredit,
  canFinance,
}: {
  s: AppState;
  search: string;
  setSearch: (v: string) => void;
  filter: string;
  setFilter: (v: string) => void;
  showDetail: (id: string) => void;
  invoice: (o: Order) => void;
  rental: () => void;
  receipt: (i?: Invoice) => void;
  deposit: (kind: 'deposit' | 'refund') => void;
  credit: (i: Invoice) => void;
  allocateCredit: () => void;
  unallocateCredit: () => void;
  refundCredit: () => void;
  canFinance: boolean;
}) {
  const invoices = s.invoices.filter(
      (i) =>
        (filter === 'all' || filter === i.type || filter === i.status) &&
        [i.number, i.billTo?.name || party(s, i.partyId)].some((x) =>
          x.toLowerCase().includes(search.toLowerCase()),
        ),
    ),
    uninvoiced = s.orders.filter(
      (o) =>
        o.deliveredIds.length > 0 &&
        unbilledOrder(s.invoices, o.id) &&
        ['delivered', 'closed_short'].includes(o.status),
    );
  const outstanding = s.invoices
    .filter((i) => i.type !== 'credit' && i.status !== 'credited')
    .reduce((n, i) => n + invoiceBalance(i), 0);
  return (
    <>
      <PageHeader
        eyebrow="Financial records"
        title="Billing & rentals"
        description="Issue documents from accepted deliveries, charge custody and allocate receipts."
        actions={
          <>
            {canFinance && (
              <Button variant="secondary" onClick={allocateCredit}>
                Apply credit
              </Button>
            )}
            {canFinance && (
              <Button variant="secondary" onClick={refundCredit}>
                Refund credit
              </Button>
            )}
            {canFinance &&
              s.receipts.some((r) => r.kind === 'credit_allocation' && !r.reversedAt) && (
                <Button variant="secondary" onClick={unallocateCredit}>
                  Undo credit allocation
                </Button>
              )}
            {canFinance && (
              <Button variant="secondary" onClick={() => deposit('deposit')}>
                Record deposit
              </Button>
            )}
            {canFinance && (
              <Button variant="secondary" onClick={() => deposit('refund')}>
                Refund deposit
              </Button>
            )}
            {canFinance && (
              <Button variant="secondary" onClick={() => receipt()}>
                Record payment
              </Button>
            )}
            {canFinance && (
              <Button onClick={rental}>
                <Plus size={16} /> Rental invoice
              </Button>
            )}
          </>
        }
      />
      <div className="summary-strip">
        <Stat
          label="Invoices issued"
          value={s.invoices.filter((i) => i.type !== 'credit').length}
        />
        <Stat label="Outstanding" value={money(outstanding)} tone="warn" />
        <Stat label="Receipts" value={s.receipts.length} />
        <Stat label="Unbilled deliveries" value={uninvoiced.length} />
      </div>
      {canFinance && uninvoiced.length > 0 && (
        <Card className="pending-card">
          <div className="section-heading">
            <div>
              <div className="eyebrow">Ready to bill</div>
              <h2>Accepted deliveries</h2>
            </div>
          </div>
          <div className="pending-orders">
            {uninvoiced.map((o) => (
              <div key={o.id}>
                <span>
                  <strong>{o.number}</strong> · {party(s, o.partyId)} · {o.deliveredIds.length}{' '}
                  delivered
                </span>
                <Button variant="secondary" onClick={() => invoice(o)}>
                  Issue invoice
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card>
        <Toolbar search={search} setSearch={setSearch} placeholder="Search invoice or customer…">
          <span className="results-count">{count(invoices.length, 'invoice')}</span>
        </Toolbar>
        <FilterPills
          value={filter}
          onChange={setFilter}
          items={['all', 'gas', 'rental', 'credit', 'issued', 'partial', 'paid', 'credited'].map(
            (x) => ({
              value: x,
              label: display(x),
            }),
          )}
        />
        {invoices.length ? (
          <Table
            headers={[
              'Invoice',
              'Customer',
              'Type',
              'Issued / due',
              'Total',
              'Balance',
              'Status',
              'Actions',
            ]}
          >
            {invoices.map((i) => (
              <tr key={i.id}>
                <td>
                  <button className="table-link" onClick={() => showDetail(i.id)}>
                    {i.number}
                  </button>
                </td>
                <td>{i.billTo?.name || party(s, i.partyId)}</td>
                <td>{i.type === 'credit' ? 'Credit note' : display(i.type)}</td>
                <td>
                  {date(i.issuedAt)}
                  {i.type !== 'credit' && <small className="cell-sub">Due {date(i.dueDate)}</small>}
                </td>
                <td>{money(i.totalPaise)}</td>
                <td>{money(invoiceBalance(i))}</td>
                <td>
                  <Badge tone={statusTone(i.status)}>
                    {i.type === 'credit' ? 'Credit recorded' : display(i.status)}
                  </Badge>
                </td>
                <td>
                  <div className="row-actions">
                    <button onClick={() => showDetail(i.id)}>Details / print</button>
                    {canFinance &&
                      i.type !== 'credit' &&
                      ['issued', 'partial'].includes(i.status) && (
                        <button onClick={() => receipt(i)}>Payment</button>
                      )}
                    {canFinance &&
                      i.status !== 'credited' &&
                      (i.creditedPaise || 0) < i.totalPaise &&
                      i.type !== 'credit' && <button onClick={() => credit(i)}>Credit</button>}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty
            title="No invoices found"
            description="Issue an invoice from a delivery or recorded rental period."
          />
        )}
      </Card>
      <Card className="ledger-card">
        <div className="section-heading">
          <div>
            <div className="eyebrow">Customer account</div>
            <h2>Balances and deposits</h2>
          </div>
        </div>
        <Table
          headers={[
            'Customer',
            'Unpaid invoices',
            'Available credit',
            'Deposit held',
            'Cylinders held',
          ]}
        >
          {s.parties
            .filter((p) => p.type !== 'supplier')
            .map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>
                  {money(
                    s.invoices
                      .filter((i) => i.partyId === p.id)
                      .reduce((n, i) => n + invoiceBalance(i), 0),
                  )}
                </td>
                <td>{money(availableCredit(s, p.id))}</td>
                <td>{money(depositBalance(s, p.id))}</td>
                <td>
                  {
                    s.cylinders.filter((c) => c.custody === 'customer' && c.custodianId === p.id)
                      .length
                  }
                </td>
              </tr>
            ))}
        </Table>
      </Card>
      <Card className="ledger-card">
        <div className="section-heading">
          <div>
            <div className="eyebrow">Cash record</div>
            <h2>Receipts & deposits · newest first</h2>
          </div>
        </div>
        {s.receipts.length ? (
          <Table headers={['Receipt', 'Party', 'Kind', 'Method', 'Amount', 'Date']}>
            {[...s.receipts].reverse().map((r) => (
              <tr key={r.id}>
                <td>{r.number}</td>
                <td>{party(s, r.partyId)}</td>
                <td>
                  <Badge
                    tone={
                      r.reversedAt || r.kind === 'refund' || r.kind === 'credit_refund'
                        ? 'warn'
                        : 'good'
                    }
                  >
                    {r.reversedAt ? 'Reversed allocation' : display(r.kind)}
                  </Badge>
                  {r.reversedAt && (
                    <small className="cell-sub">
                      {r.reversalReason} · {date(r.reversedAt)}
                    </small>
                  )}
                </td>
                <td>
                  {r.method.toUpperCase()}
                  <small className="cell-sub">{r.reference}</small>
                </td>
                <td>{money(r.amountPaise)}</td>
                <td>{date(r.at)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty
            title="No receipts yet"
            description="Recorded payments and security deposits appear here."
          />
        )}
      </Card>
    </>
  );
}

function Safety({
  s,
  inspect,
  recall,
  resolve,
  showCylinder,
  canInspect,
  canResolve,
}: {
  s: AppState;
  inspect: (c: Cylinder) => void;
  recall: (b: Batch) => void;
  resolve: (id: string) => void;
  showCylinder: (id: string) => void;
  canInspect: boolean;
  canResolve: boolean;
}) {
  const due = s.cylinders.filter((c) => c.condition !== 'serviceable' || c.testDue < today()),
    exceptions = s.exceptions.filter((e) => e.status === 'open'),
    recalled = s.batches.filter((b) => b.status === 'recalled');
  return (
    <>
      <PageHeader
        eyebrow="Quality & control"
        title="Safety"
        description="Inspection holds, test dates, recalls and unresolved exceptions."
      />
      <div className="summary-strip">
        <Stat label="Inspection / hold" value={due.length} tone="warn" />
        <Stat
          label="Overdue tests"
          value={s.cylinders.filter((c) => c.testDue < today()).length}
          tone="warn"
        />
        <Stat label="Open exceptions" value={exceptions.length} tone="warn" />
        <Stat label="Recalled batches" value={recalled.length} tone="warn" />
      </div>
      <Card>
        <div className="section-heading">
          <div>
            <div className="eyebrow">Action queue</div>
            <h2>Cylinders requiring review</h2>
          </div>
        </div>
        {due.length ? (
          <Table headers={['Cylinder', 'Issue', 'Custody', 'Test due', 'Actions']}>
            {due.map((c) => (
              <tr key={c.id}>
                <td>
                  <button className="table-link" onClick={() => showCylinder(c.id)}>
                    {c.tag}
                  </button>
                  <small className="cell-sub">{c.serial}</small>
                </td>
                <td>
                  <Badge tone="bad">
                    {c.testDue < today() ? 'Test overdue' : display(c.condition)}
                  </Badge>
                </td>
                <td>
                  {display(c.custody)}
                  <small className="cell-sub">{custodian(s, c)}</small>
                </td>
                <td>{date(c.testDue)}</td>
                <td>
                  <div className="row-actions">
                    <button onClick={() => showCylinder(c.id)}>History</button>
                    {canInspect && c.custody === 'plant' && c.condition !== 'retired' && (
                      <button onClick={() => inspect(c)}>Inspect</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty
            title="No cylinders on hold"
            description="Safety holds and overdue tests will appear here."
          />
        )}
      </Card>
      <div className="dashboard-grid lower">
        <Card>
          <div className="section-heading">
            <div>
              <div className="eyebrow">Exceptions</div>
              <h2>Open investigations</h2>
            </div>
          </div>
          {exceptions.length ? (
            <div className="exception-list">
              {exceptions.map((e) => (
                <div className="exception-row" key={e.id}>
                  <div>
                    <Badge tone="bad">{display(e.type)}</Badge>
                    <p>{e.summary}</p>
                    <small>
                      {datetime(e.at)} · {e.entityId}
                    </small>
                  </div>
                  {canResolve && (
                    <Button variant="secondary" onClick={() => resolve(e.id)}>
                      Resolve
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title="No open exceptions"
              description="Movement discrepancies and recalls will appear here."
            />
          )}
        </Card>
        <Card>
          <div className="section-heading">
            <div>
              <div className="eyebrow">Recall register</div>
              <h2>Recalled batches</h2>
            </div>
          </div>
          {recalled.length ? (
            <div className="stack-list">
              {recalled.map((b) => (
                <div className="stack-row" key={b.id}>
                  <span className="row-icon attention">
                    <WarningCircle size={18} />
                  </span>
                  <span className="row-primary">
                    <strong>{b.number}</strong>
                    <small>
                      {b.cylinderIds.length} affected cylinders · {b.gas}
                    </small>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="No recalled batches" description="Quality recalls will appear here." />
          )}
        </Card>
      </div>
    </>
  );
}

function Reports({
  s,
  exportJson,
  exportCsv,
  canExport,
  canCsv,
}: {
  s: AppState;
  exportJson: () => void;
  exportCsv: () => void;
  canExport: boolean;
  canCsv: boolean;
}) {
  const [tab, setTab] = useState<'stock' | 'movement' | 'audit'>('stock'),
    [query, setQuery] = useState('');
  // Each tab searches different records, so a search never carries over between tabs.
  const switchTab = (next: 'stock' | 'movement' | 'audit') => {
    setTab(next);
    setQuery('');
  };
  const grouped = s.branches.flatMap((b) =>
    GASES.map((g) => {
      const c = s.cylinders.filter((c) => c.branchId === b.id && c.gas === g);
      return {
        branch: b.name,
        gas: g,
        total: c.length,
        plant: c.filter((x) => x.custody === 'plant').length,
        customer: c.filter((x) => x.custody === 'customer').length,
        vehicle: c.filter((x) => x.custody === 'vehicle').length,
        supplier: c.filter((x) => x.custody === 'supplier').length,
        hold: c.filter((x) => x.condition !== 'serviceable').length,
      };
    }),
  );
  return (
    <>
      <PageHeader
        eyebrow="Operational intelligence"
        title="Reports & audit"
        description="All figures are calculated from the current saved workspace."
        actions={
          <>
            {canExport && (
              <Button variant="secondary" onClick={exportJson}>
                <DownloadSimple size={16} /> Full JSON export
              </Button>
            )}
            {canCsv && (
              <Button variant="secondary" onClick={exportCsv}>
                <DownloadSimple size={16} /> Cylinder CSV
              </Button>
            )}
          </>
        }
      />
      <div className="summary-strip">
        <Stat label="Cylinders" value={s.cylinders.length} />
        <Stat label="Movements" value={s.movements.length} />
        <Stat label="Orders" value={s.orders.length} />
        <Stat label="Audit events" value={s.audit.length} />
      </div>
      <Card>
        <div className="report-tabs" role="tablist">
          {[
            { id: 'stock', name: 'Stock position' },
            { id: 'movement', name: 'Movement ledger' },
            { id: 'audit', name: 'Audit trail' },
          ].map((t) => (
            <button
              role="tab"
              id={`report-tab-${t.id}`}
              aria-controls={`report-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onKeyDown={(event) => {
                const ids = ['stock', 'movement', 'audit'] as const;
                const index = ids.indexOf(tab);
                const next =
                  event.key === 'ArrowRight'
                    ? (index + 1) % 3
                    : event.key === 'ArrowLeft'
                      ? (index + 2) % 3
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? 2
                          : -1;
                if (next >= 0) {
                  event.preventDefault();
                  switchTab(ids[next]);
                  document.getElementById(`report-tab-${ids[next]}`)?.focus();
                }
              }}
              aria-selected={tab === t.id}
              key={t.id}
              className={tab === t.id ? 'active' : ''}
              onClick={() => switchTab(t.id as typeof tab)}
            >
              {t.name}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`report-panel-${tab}`} aria-labelledby={`report-tab-${tab}`}>
          {tab === 'stock' && (
            <>
              {grouped.length ? (
                <Table
                  headers={[
                    'Branch',
                    'Gas',
                    'Total',
                    'Plant',
                    'Vehicle',
                    'Customer',
                    'Supplier',
                    'On hold',
                  ]}
                >
                  {grouped.map((g, i) => (
                    <tr key={i}>
                      <td>{g.branch}</td>
                      <td>{g.gas}</td>
                      <td>
                        <strong>{g.total}</strong>
                      </td>
                      <td>{g.plant}</td>
                      <td>{g.vehicle}</td>
                      <td>{g.customer}</td>
                      <td>{g.supplier}</td>
                      <td>{g.hold}</td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Empty
                  title="No stock data"
                  description="Registered cylinders will appear in this report."
                />
              )}
            </>
          )}
          {tab === 'movement' && (
            <>
              <Toolbar
                search={query}
                setSearch={setQuery}
                placeholder="Search cylinder, action, reference…"
              />
              {s.movements.filter((m) =>
                movementText(s, m).toLowerCase().includes(query.toLowerCase()),
              ).length ? (
                <Table
                  headers={['When', 'Cylinder', 'Movement', 'From → to', 'Actor', 'Reference']}
                >
                  {s.movements
                    .filter((m) => movementText(s, m).toLowerCase().includes(query.toLowerCase()))
                    .slice(0, 200)
                    .map((m) => (
                      <tr key={m.id}>
                        <td>{datetime(m.at)}</td>
                        <td>
                          {s.cylinders.find((c) => c.id === m.cylinderId)?.tag || m.cylinderId}
                        </td>
                        <td>{display(m.action)}</td>
                        <td>
                          {place(s, m.from)} → {place(s, m.to)}
                        </td>
                        <td>{m.actorName}</td>
                        <td>
                          {reference(s, m.reference)}
                          <small className="cell-sub">{m.notes}</small>
                        </td>
                      </tr>
                    ))}
                </Table>
              ) : (
                <Empty
                  title="No movements found"
                  description="Serial movements appear after work is recorded."
                />
              )}
            </>
          )}
          {tab === 'audit' && (
            <>
              {!canExport && (
                <p className="muted pad">
                  Audit records are available to administrators and auditors.
                </p>
              )}
              <Toolbar
                search={query}
                setSearch={setQuery}
                placeholder="Search action, actor, record…"
              />
              {s.audit.filter((a) =>
                [a.action, a.actorName, a.entityId, a.summary].some((x) =>
                  x.toLowerCase().includes(query.toLowerCase()),
                ),
              ).length ? (
                <Table headers={['When', 'Actor', 'Action', 'Record', 'Summary']}>
                  {s.audit
                    .filter((a) =>
                      [a.action, a.actorName, a.entityId, a.summary].some((x) =>
                        x.toLowerCase().includes(query.toLowerCase()),
                      ),
                    )
                    .slice(0, 200)
                    .map((a) => (
                      <tr key={a.id}>
                        <td>{datetime(a.at)}</td>
                        <td>{a.actorName}</td>
                        <td>{display(a.action)}</td>
                        <td>{a.entityId}</td>
                        <td>{a.summary}</td>
                      </tr>
                    ))}
                </Table>
              ) : (
                <Empty
                  title="No audit events found"
                  description="Every saved action appears in the audit trail."
                />
              )}
            </>
          )}
        </div>
      </Card>
    </>
  );
}

function Settings({
  s,
  users,
  currentUser,
  editSettings,
  addUser,
  editUser,
  changePassword,
  resetPassword,
  canAdmin,
  financialRead,
}: {
  s: AppState;
  users: User[];
  currentUser: User;
  editSettings: () => void;
  addUser: () => void;
  editUser: (u: User) => void;
  changePassword: () => void;
  resetPassword: (u: User) => void;
  canAdmin: boolean;
  financialRead: boolean;
}) {
  return (
    <>
      <PageHeader
        eyebrow="Workspace administration"
        title="Settings"
        description="Company identity, account access and demo environment."
        actions={
          <Button variant="secondary" onClick={changePassword}>
            Change my password
          </Button>
        }
      />
      <div className="settings-grid">
        <Card className="settings-card">
          <div className="section-heading">
            <div>
              <div className="eyebrow">Business profile</div>
              <h2>{s.settings.companyName}</h2>
            </div>
            {canAdmin && (
              <Button variant="secondary" onClick={editSettings}>
                Edit profile
              </Button>
            )}
          </div>
          <dl className="detail-grid">
            <div>
              <dt>Address</dt>
              <dd>
                {currentUser.role === 'driver'
                  ? 'Available on the assigned delivery challan'
                  : s.settings.address}
              </dd>
            </div>
            <div>
              <dt>GSTIN</dt>
              <dd>
                {currentUser.role === 'driver'
                  ? 'Available on the assigned delivery challan'
                  : s.settings.gstin || 'Not configured'}
              </dd>
            </div>
            {financialRead && (
              <div>
                <dt>Default tax rate</dt>
                <dd>{(s.settings.defaultTaxBps / 100).toFixed(2)}%</dd>
              </div>
            )}
            <div>
              <dt>Workspace mode</dt>
              <dd>
                <Badge tone="blue">
                  {s.settings.mode === 'demo' ? 'Synthetic demo' : 'Live local workspace'}
                </Badge>
              </dd>
            </div>
          </dl>
        </Card>
        <Card className="settings-card">
          <div className="section-heading">
            <div>
              <div className="eyebrow">External services</div>
              <h2>Integration status</h2>
            </div>
          </div>
          <p className="muted">
            Accounting, GST submission, messaging and payment gateway connections are unconfigured.
            Financial receipts here record manually confirmed payments; no external settlement is
            implied.
          </p>
          <div className="integration-list">
            {['Accounting sync', 'GST submission', 'WhatsApp messages', 'Payment gateway'].map(
              (x) => (
                <div key={x}>
                  <span>{x}</span>
                  <Badge tone="neutral">Unconfigured</Badge>
                </div>
              ),
            )}
          </div>
        </Card>
      </div>
      <Card className="users-card">
        <div className="section-heading">
          <div>
            <div className="eyebrow">Access control</div>
            <h2>Team members</h2>
          </div>
          {canAdmin && (
            <Button onClick={addUser}>
              <Plus size={16} /> Add member
            </Button>
          )}
        </div>
        {!users.length && (
          <p className="muted pad">No team members are visible within your access.</p>
        )}
        <Table headers={['Name', 'Email', 'Role', 'Branches', 'Status', 'Actions']}>
          {users.map((user) => (
            <tr key={user.id}>
              <td>
                <strong>{user.name}</strong>
                {user.id === currentUser.id && <small className="cell-sub">You</small>}
              </td>
              <td>{user.email}</td>
              <td>{roleLabels[user.role]}</td>
              <td>{user.branchIds.map((id) => branch(s, id)).join(', ')}</td>
              <td>
                <Badge tone={user.active ? 'good' : 'bad'}>
                  {user.active ? 'Active' : 'Disabled'}
                </Badge>
              </td>
              <td>
                {canAdmin && (
                  <div className="row-actions">
                    <button onClick={() => editUser(user)}>Edit access</button>
                    {user.id !== currentUser.id && (
                      <button onClick={() => resetPassword(user)}>Reset password</button>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

function Detail({
  kind,
  id,
  s,
  users,
  people,
  currentUser,
  onClose,
  actions,
  permissions,
}: {
  kind: 'cylinder' | 'order' | 'batch' | 'party' | 'invoice';
  id: string;
  s: AppState;
  users: User[];
  people: { id: string; name: string }[];
  currentUser: User;
  onClose: () => void;
  actions: {
    inspect: (c: Cylinder) => void;
    emptyCylinder: (c: Cylinder) => void;
    offsiteIncident: (c: Cylinder) => void;
    stopIncidentRent: (c: Cylinder) => void;
    writeOff: (c: Cylinder) => void;
    rejectBatchCylinder: (b: Batch) => void;
    retag: (c: Cylinder) => void;
    dispatch: (o: Order) => void;
    deliver: (o: Order) => void;
    unload: (o: Order) => void;
    release: (b: Batch) => void;
    recall: (b: Batch) => void;
    editParty: (p: Party) => void;
    issueInvoice: (o: Order) => void;
    receipt: (i: Invoice) => void;
    credit: (i: Invoice) => void;
  };
  permissions: {
    operate: boolean;
    inspect: boolean;
    quality: boolean;
    finance: boolean;
    financialRead: boolean;
    deliver: boolean;
  };
}) {
  const c = kind === 'cylinder' ? s.cylinders.find((x) => x.id === id) : undefined,
    o = kind === 'order' ? s.orders.find((x) => x.id === id) : undefined,
    b = kind === 'batch' ? s.batches.find((x) => x.id === id) : undefined,
    p = kind === 'party' ? s.parties.find((x) => x.id === id) : undefined,
    i = kind === 'invoice' ? s.invoices.find((x) => x.id === id) : undefined;
  const title = c?.tag || o?.number || b?.number || p?.name || i?.number || 'Record';
  return (
    <Modal
      title={title}
      subtitle={`${display(kind)} record · saved workspace`}
      onClose={onClose}
      width="wide"
    >
      <div className="detail-content">
        {c && (
          <>
            <div className="detail-status">
              <Badge tone={gasTone(c)}>{display(c.condition)}</Badge>
              <Badge tone={c.contents === 'full' ? 'blue' : 'neutral'}>{display(c.contents)}</Badge>
              <Badge>{display(c.custody)}</Badge>
            </div>
            <dl className="detail-grid">
              <div>
                <dt>Manufacturer serial</dt>
                <dd>{c.serial}</dd>
              </div>
              <div>
                <dt>Gas & size</dt>
                <dd>
                  {c.gas} · {c.size}
                </dd>
              </div>
              <div>
                <dt>Manufacturer</dt>
                <dd>{c.manufacturer}</dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>{party(s, c.ownerId)}</dd>
              </div>
              <div>
                <dt>Branch</dt>
                <dd>{branch(s, c.branchId)}</dd>
              </div>
              <div>
                <dt>Current custodian</dt>
                <dd>{custodian(s, c)}</dd>
              </div>
              <div>
                <dt>Last test</dt>
                <dd>{date(c.lastTest)}</dd>
              </div>
              <div>
                <dt>Next test due</dt>
                <dd className={c.testDue < today() ? 'alert-text' : ''}>{date(c.testDue)}</dd>
              </div>
              <div>
                <dt>Certificate</dt>
                <dd>{c.certificate || 'No reference'}</dd>
              </div>
              <div>
                <dt>Record version</dt>
                <dd>{c.version}</dd>
              </div>
            </dl>
            <div className="detail-actions">
              {permissions.inspect && c.custody === 'plant' && c.condition !== 'retired' && (
                <Button onClick={() => actions.inspect(c)}>Record inspection</Button>
              )}
              {permissions.inspect &&
                c.custody === 'plant' &&
                (c.contents !== 'empty' ||
                  s.batches.some((b) => b.id === c.batchId && b.status === 'recalled')) &&
                c.condition !== 'retired' &&
                !s.batches.some((b) => b.id === c.batchId && b.status === 'awaiting_release') && (
                  <Button variant="secondary" onClick={() => actions.emptyCylinder(c)}>
                    Record emptying
                  </Button>
                )}
              {permissions.operate &&
                (c.custody === 'customer' || s.pickups?.some((p) => p.id === c.custodianId)) &&
                !c.offsiteIncident &&
                (!permissions.financialRead ||
                  s.rentals.some((r) => r.cylinderId === c.id && !r.end)) &&
                c.condition !== 'retired' && (
                  <Button variant="danger" onClick={() => actions.offsiteIncident(c)}>
                    Report loss / damage
                  </Button>
                )}
              {permissions.operate && c.custody === 'plant' && (
                <Button variant="secondary" onClick={() => actions.retag(c)}>
                  Replace tag
                </Button>
              )}
            </div>
            {currentUser.role === 'admin' && c.offsiteIncident && c.condition !== 'retired' && (
              <div className="detail-actions">
                <Button variant="secondary" onClick={() => actions.stopIncidentRent(c)}>
                  Approve rental stop
                </Button>
                {c.offsiteIncident.kind === 'lost' && (
                  <Button variant="danger" onClick={() => actions.writeOff(c)}>
                    Write off lost cylinder
                  </Button>
                )}
              </div>
            )}
            <div className="detail-section">
              <h3>Identity label</h3>
              <CylinderLabel cylinder={c} />
              {(c.previousTags?.length || 0) > 0 && (
                <p className="muted">Previous tags: {c.previousTags?.join(', ')}</p>
              )}
            </div>
            <div className="detail-section">
              <h3>Movement timeline</h3>
              {s.movements.filter((m) => m.cylinderId === c.id).length ? (
                <div className="timeline">
                  {s.movements
                    .filter((m) => m.cylinderId === c.id)
                    .sort((a, b) => b.at.localeCompare(a.at))
                    .map((m) => (
                      <div key={m.id} className="timeline-item">
                        <div className="timeline-node" />
                        <div>
                          <strong>{display(m.action)}</strong>
                          <p>
                            {place(s, m.from)} → {place(s, m.to)}
                          </p>
                          <small>
                            {datetime(m.at)} · {m.actorName} · {reference(s, m.reference)}
                          </small>
                          {m.notes && <small>{m.notes}</small>}
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                <p className="muted">No movements recorded yet.</p>
              )}
            </div>
          </>
        )}
        {o && (
          <>
            <div className="detail-status">
              <Badge tone={statusTone(o.status)}>{display(o.status)}</Badge>
              {o.priority === 'urgent' && <Badge tone="bad">Urgent</Badge>}
            </div>
            <dl className="detail-grid">
              <div>
                <dt>Customer</dt>
                <dd>{party(s, o.partyId)}</dd>
              </div>
              <div>
                <dt>Branch</dt>
                <dd>{branch(s, o.branchId)}</dd>
              </div>
              <div>
                <dt>Request</dt>
                <dd>
                  {o.quantity} × {o.size} · {o.gas}
                </dd>
              </div>
              <div>
                <dt>Requested date</dt>
                <dd>{date(o.dueDate)}</dd>
              </div>
              {permissions.financialRead && (
                <div>
                  <dt>Unit price</dt>
                  <dd>{money(o.unitPricePaise)}</dd>
                </div>
              )}
              <div>
                <dt>Vehicle</dt>
                <dd>{o.vehicle || 'Not assigned'}</dd>
              </div>
              <div>
                <dt>Driver</dt>
                <dd>{o.driverId ? person(people, o.driverId) : 'Not assigned'}</dd>
              </div>
              <div>
                <dt>Accepted</dt>
                <dd>
                  {o.deliveredIds.length} accepted · {o.unloadedIds?.length || 0} unloaded /{' '}
                  {o.cylinderIds.length || o.quantity}
                </dd>
              </div>
              <div>
                <dt>Recipient</dt>
                <dd>{o.recipient || 'Awaiting delivery'}</dd>
              </div>
              <div>
                <dt>Notes</dt>
                <dd>{o.notes || '—'}</dd>
              </div>
            </dl>
            <div className="detail-actions">
              {permissions.operate && o.status === 'open' && (
                <Button onClick={() => actions.dispatch(o)}>Dispatch order</Button>
              )}
              {permissions.deliver &&
                (currentUser.role !== 'driver' || o.driverId === currentUser.id) &&
                ['dispatched', 'partial'].includes(o.status) && (
                  <Button onClick={() => actions.deliver(o)}>Record delivery</Button>
                )}
              {permissions.operate &&
                ['dispatched', 'partial'].includes(o.status) &&
                o.cylinderIds.some(
                  (x) => !o.deliveredIds.includes(x) && !o.unloadedIds?.includes(x),
                ) && (
                  <Button variant="secondary" onClick={() => actions.unload(o)}>
                    Unload remainder
                  </Button>
                )}
              {permissions.finance &&
                ['delivered', 'closed_short'].includes(o.status) &&
                o.deliveredIds.length > 0 &&
                unbilledOrder(s.invoices, o.id) && (
                  <Button variant="secondary" onClick={() => actions.issueInvoice(o)}>
                    Issue invoice
                  </Button>
                )}
              {o.cylinderIds.length > 0 && <PrintChallan order={o} state={s} />}
            </div>
            <div className="detail-section">
              <h3>Dispatch manifest</h3>
              {o.cylinderIds.length ? (
                <div className="tag-grid">
                  {o.cylinderIds.map((cid) => {
                    const cylinder = s.cylinders.find((x) => x.id === cid);
                    return (
                      <div key={cid}>
                        <strong>{cylinder?.tag || cid}</strong>
                        <small>{cylinder?.serial || ''}</small>
                        <Badge
                          tone={
                            o.deliveredIds.includes(cid)
                              ? 'good'
                              : o.unloadedIds?.includes(cid)
                                ? 'neutral'
                                : 'warn'
                          }
                        >
                          {o.deliveredIds.includes(cid)
                            ? 'Accepted'
                            : o.unloadedIds?.includes(cid)
                              ? 'Unloaded'
                              : 'On vehicle'}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="muted">No cylinders dispatched yet.</p>
              )}
            </div>
          </>
        )}
        {b && (
          <>
            <div className="detail-status">
              <Badge tone={statusTone(b.status)}>{display(b.status)}</Badge>
            </div>
            <dl className="detail-grid">
              <div>
                <dt>Gas</dt>
                <dd>{b.gas}</dd>
              </div>
              <div>
                <dt>Branch</dt>
                <dd>{branch(s, b.branchId)}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{b.source}</dd>
              </div>
              <div>
                <dt>Operator</dt>
                <dd>
                  {b.fillOperator || person(people, b.operator)}
                  <small className="cell-sub">Recorded by {person(people, b.operator)}</small>
                </dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{datetime(b.createdAt)}</dd>
              </div>
              <div>
                <dt>Released</dt>
                <dd>{datetime(b.releasedAt)}</dd>
              </div>
              <div>
                <dt>Certificate</dt>
                <dd>{b.certificate || 'Awaiting quality review'}</dd>
              </div>
              <div>
                <dt>Quality notes</dt>
                <dd>{b.qualityNotes || '—'}</dd>
              </div>
            </dl>
            <div className="detail-actions">
              {permissions.quality && b.status === 'awaiting_release' && (
                <Button onClick={() => actions.release(b)}>Release batch</Button>
              )}
              {permissions.quality &&
                b.status === 'awaiting_release' &&
                b.cylinderIds.length > 1 && (
                  <Button variant="secondary" onClick={() => actions.rejectBatchCylinder(b)}>
                    Reject cylinder
                  </Button>
                )}
              {permissions.quality && ['released', 'awaiting_release'].includes(b.status) && (
                <Button variant="danger" onClick={() => actions.recall(b)}>
                  Recall batch
                </Button>
              )}
            </div>
            <div className="detail-section">
              {b.recipientTrace && (
                <>
                  <h3>Recipients of recalled gas</h3>
                  {b.recipientTrace.length ? (
                    b.recipientTrace.map((r, index) => (
                      <p key={index}>
                        {party(s, r.partyId)} ·{' '}
                        {s.cylinders.find((c) => c.id === r.cylinderId)?.tag || 'Cylinder'} ·{' '}
                        {s.orders.find((o) => o.id === r.orderId)?.number || 'Order'} ·{' '}
                        {datetime(r.at)}
                      </p>
                    ))
                  ) : (
                    <p className="muted">
                      No attributable delivery snapshots for this batch. Older records without batch
                      snapshots require manual trace review.
                    </p>
                  )}
                </>
              )}
              <h3>Cylinders · {b.cylinderIds.length}</h3>
              {!!b.rejectedCylinderIds?.length && (
                <p className="muted">
                  Rejected members:{' '}
                  {b.rejectedCylinderIds
                    .map((id) => s.cylinders.find((c) => c.id === id)?.tag || id)
                    .join(', ')}
                </p>
              )}
              <div className="tag-grid">
                {b.cylinderIds.map((cid) => {
                  const cylinder = s.cylinders.find((x) => x.id === cid);
                  return (
                    <div key={cid}>
                      <strong>{cylinder?.tag || cid}</strong>
                      <small>{cylinder?.serial || ''}</small>
                      <Badge tone={cylinder ? gasTone(cylinder) : 'neutral'}>
                        {cylinder ? display(cylinder.condition) : 'Unknown'}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
        {p && (
          <>
            <div className="detail-status">
              <Badge tone="blue">{display(p.type)}</Badge>
            </div>
            <dl className="detail-grid">
              <div>
                <dt>Contact</dt>
                <dd>{p.contact}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{p.phone}</dd>
              </div>
              <div>
                <dt>Address</dt>
                <dd>
                  {p.address}, {p.city}
                </dd>
              </div>
              <div>
                <dt>GSTIN</dt>
                <dd>{p.gstin || '—'}</dd>
              </div>
              <div>
                <dt>Branch</dt>
                <dd>{branch(s, p.branchId)}</dd>
              </div>
              {permissions.financialRead && (
                <>
                  <div>
                    <dt>Credit limit</dt>
                    <dd>{money(p.creditLimitPaise)}</dd>
                  </div>
                  <div>
                    <dt>Daily rental</dt>
                    <dd>{money(p.dailyRentalPaise)}</dd>
                  </div>
                  <div>
                    <dt>Free days</dt>
                    <dd>{p.freeDays}</dd>
                  </div>
                  <div>
                    <dt>Standard deposit</dt>
                    <dd>{money(p.depositPaise)}</dd>
                  </div>
                </>
              )}
              <div>
                <dt>Cylinders held</dt>
                <dd>{s.cylinders.filter((c) => c.custodianId === p.id).length}</dd>
              </div>
            </dl>
            {permissions.finance && (
              <div className="detail-actions">
                <Button variant="secondary" onClick={() => actions.editParty(p)}>
                  Edit details
                </Button>
              </div>
            )}
            <div className="detail-section">
              <h3>Current cylinder holdings</h3>
              <div className="tag-grid">
                {s.cylinders
                  .filter((c) => c.custodianId === p.id)
                  .map((c) => (
                    <div key={c.id}>
                      <strong>{c.tag}</strong>
                      <small>{c.serial}</small>
                      <Badge tone={gasTone(c)}>{display(c.condition)}</Badge>
                    </div>
                  ))}
              </div>
              {!s.cylinders.some((c) => c.custodianId === p.id) && (
                <p className="muted">No cylinders currently held.</p>
              )}
            </div>
          </>
        )}
        {i && (
          <>
            <div className="print-document">
              {s.settings.mode === 'demo' && (
                <div className="form-warning">
                  DEMONSTRATION · Synthetic data · Not for commercial or statutory use
                </div>
              )}
              <div className="invoice-head">
                <div>
                  <div className="eyebrow">
                    {i.type === 'credit' ? 'Credit note' : `${display(i.type)} invoice`}
                  </div>
                  <h2>{i.number}</h2>
                  <p>
                    {i.issuer?.companyName ??
                      'Issuer identity was not captured on this legacy invoice'}
                    <br />
                    {i.issuer?.address ?? ''}
                    <br />
                    {(i.issuer?.gstin ?? '') && `GSTIN ${i.issuer?.gstin ?? ''}`}
                  </p>
                </div>
                <div className="invoice-dates">
                  <span>Issued {date(i.issuedAt)}</span>
                  {i.type !== 'credit' && <span>Due {date(i.dueDate)}</span>}
                  <Badge tone={statusTone(i.status)}>
                    {i.type === 'credit' ? 'Credit recorded' : display(i.status)}
                  </Badge>
                </div>
              </div>
              {i.type === 'credit' && (
                <p>
                  Credit against{' '}
                  {s.invoices.find((original) => original.id === i.sourceId)?.number || i.sourceId}
                </p>
              )}
              {i.status === 'credited' && (
                <p>
                  Credited by{' '}
                  {s.invoices.find((credit) => credit.type === 'credit' && credit.sourceId === i.id)
                    ?.number || 'linked credit note'}
                </p>
              )}
              <div className="invoice-billto">
                <small>BILL TO</small>
                <strong>{i.billTo?.name || 'Historical customer identity unavailable'}</strong>
                <span>
                  {i.billTo
                    ? `${i.billTo.address}, ${i.billTo.city}`
                    : 'Historical address was not captured'}
                </span>
                {(i.billTo?.gstin ?? '') && <span>GSTIN {i.billTo?.gstin ?? ''}</span>}
              </div>
              <Table headers={['Description', 'Qty', 'Unit price', 'Amount']}>
                {i.lines.map((line, index) => (
                  <tr key={index}>
                    <td>{line.description}</td>
                    <td>{line.quantity}</td>
                    <td>{money(line.unitPricePaise)}</td>
                    <td>{money(line.amountPaise)}</td>
                  </tr>
                ))}
              </Table>
              <div className="invoice-totals">
                <div>
                  <span>Subtotal</span>
                  <strong>{money(i.subtotalPaise)}</strong>
                </div>
                <div>
                  <span>Tax ({(i.taxBps / 100).toFixed(2)}%)</span>
                  <strong>{money(i.taxPaise)}</strong>
                </div>
                <div className="total">
                  <span>Total</span>
                  <strong>{money(i.totalPaise)}</strong>
                </div>
                {!!i.creditedPaise && (
                  <div>
                    <span>Credited</span>
                    <strong>{money(i.creditedPaise)}</strong>
                  </div>
                )}
                {!!i.appliedCreditPaise && (
                  <div>
                    <span>Customer credit applied</span>
                    <strong>{money(i.appliedCreditPaise)}</strong>
                  </div>
                )}
                {i.type === 'credit' && (
                  <div>
                    <span>Available customer credit</span>
                    <strong>{money(creditNoteAvailable(s, i.id))}</strong>
                  </div>
                )}
                <div>
                  <span>Paid</span>
                  <strong>{money(i.paidPaise)}</strong>
                </div>
                <div>
                  <span>Balance</span>
                  <strong>{money(invoiceBalance(i))}</strong>
                </div>
              </div>
              {i.notes && <p className="invoice-notes">{i.notes}</p>}
            </div>
            <div className="detail-actions no-print">
              <Button variant="secondary" onClick={() => window.print()}>
                <Printer size={16} /> Print invoice
              </Button>
              {permissions.finance &&
                i.type !== 'credit' &&
                ['issued', 'partial'].includes(i.status) && (
                  <Button onClick={() => actions.receipt(i)}>Record payment</Button>
                )}
              {permissions.finance &&
                i.status !== 'credited' &&
                (i.creditedPaise || 0) < i.totalPaise &&
                i.type !== 'credit' && (
                  <Button variant="danger" onClick={() => actions.credit(i)}>
                    Issue credit note
                  </Button>
                )}
            </div>
            <div className="detail-section no-print">
              <h3>Allocated receipts</h3>
              {s.receipts
                .filter((r) => r.invoiceId === i.id)
                .map((r) => (
                  <div className="ledger-line" key={r.id}>
                    <span>
                      {r.number} · {display(r.method)} · {date(r.at)}
                    </span>
                    <strong>{money(r.amountPaise)}</strong>
                  </div>
                ))}
              {!s.receipts.some((r) => r.invoiceId === i.id) && (
                <p className="muted">No payments allocated.</p>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
