/**
 * Takes one new demo cylinder through a complete, real life cycle on a running demo server,
 * using the same commands and permissions as the app (each step signed in as the right role):
 *
 *   register → safety check → fill → quality release → order → load on truck → deliver
 *   → collect empty → back in godown → safety check
 *
 * Afterwards open Admin → Cylinders → the new tag → Details → Life story.
 *
 *   npm run demo:lifecycle                    (server at http://127.0.0.1:3001)
 *   CTMS_BASE=https://your-app.vercel.app npm run demo:lifecycle
 *
 * Refuses to run unless the server reports demo mode, so live data is never touched.
 */
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.CTMS_BASE ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const PASSWORD = 'OxygenDemo!2026';
const BRANCH = 'b-delhi';
const CUSTOMER = 'p-hospital-1';

type Session = { cookie: string; csrf: string; name: string };

async function signIn(role: string): Promise<Session> {
  const response = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email: `${role}@batra.demo`, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`Sign in as ${role} failed: ${await response.text()}`);
  const body = (await response.json()) as { csrfToken: string; user: { name: string } };
  return {
    cookie: response.headers.get('set-cookie')!.split(';')[0],
    csrf: body.csrfToken,
    name: body.user.name,
  };
}

async function act(
  session: Session,
  type: string,
  payload: Record<string, unknown>,
): Promise<{ entityId?: string; state: { orders: { id: string; number: string }[] } }> {
  const response = await fetch(`${BASE}/api/actions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: BASE,
      cookie: session.cookie,
      'x-csrf-token': session.csrf,
    },
    body: JSON.stringify({ type, payload, idempotencyKey: randomUUID() }),
  });
  if (!response.ok) throw new Error(`${type} failed: ${await response.text()}`);
  return response.json() as Promise<{
    entityId?: string;
    state: { orders: { id: string; number: string }[] };
  }>;
}

/** The cylinder's current record version, read fresh so inspections never use a stale one. */
async function versionOf(session: Session, cylinderId: string): Promise<number> {
  const response = await fetch(`${BASE}/api/bootstrap`, { headers: { cookie: session.cookie } });
  if (!response.ok) throw new Error(`Could not read the cylinder: ${await response.text()}`);
  const body = (await response.json()) as {
    state: { cylinders: { id: string; version: number }[] };
  };
  const found = body.state.cylinders.find((c) => c.id === cylinderId);
  if (!found) throw new Error('The new cylinder is not visible to this role.');
  return found.version;
}

const pause = () => new Promise((r) => setTimeout(r, 1100));

async function main() {
  const health = (await (await fetch(`${BASE}/api/health`)).json()) as { mode?: string };
  if (health.mode !== 'demo') throw new Error('This script only runs against a demo workspace.');

  const [admin, operations, quality, driver] = await Promise.all(
    ['admin', 'operations', 'quality', 'driver'].map(signIn),
  );
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(2, 14);
  const tag = `STORY-${stamp}`;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const nextYear = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
  const step = (text: string) => console.log(`✔ ${text}`);

  const registered = await act(admin, 'cylinder.register', {
    serial: `SER-${stamp}`,
    tag,
    manufacturer: 'Demo Cylinder Works',
    gas: 'Medical oxygen',
    size: 'B',
    ownerId: 'company',
    branchId: BRANCH,
    testDue: nextYear,
    lastTest: today,
    certificate: `TEST-${stamp}`,
    contents: 'empty',
  });
  const cylinderId = registered.entityId!;
  step(`Registered ${tag} (by ${admin.name})`);
  await pause();

  await act(quality, 'cylinder.inspect', {
    cylinderId,
    version: await versionOf(quality, cylinderId),
    condition: 'serviceable',
    notes: 'New cylinder: valve, thread and paint checked.',
  });
  step(`Safety check passed (by ${quality.name})`);
  await pause();

  const batch = await act(operations, 'batch.create', {
    gas: 'Medical oxygen',
    branchId: BRANCH,
    cylinderIds: [cylinderId],
    source: 'Tank 1',
    operator: operations.name,
  });
  step(`Filled from Tank 1 (by ${operations.name})`);
  await pause();

  await act(quality, 'batch.release', {
    batchId: batch.entityId,
    certificate: `QC-${stamp}`,
    qualityNotes: 'Purity and pressure within limits.',
  });
  step(`Quality released the batch (by ${quality.name})`);
  await pause();

  const order = await act(admin, 'order.create', {
    partyId: CUSTOMER,
    branchId: BRANCH,
    gas: 'Medical oxygen',
    size: 'B',
    quantity: 1,
    priority: 'urgent',
    dueDate: today,
    notes: 'Life story demonstration',
    unitPricePaise: 45000,
  });
  const orderId = order.entityId!;
  step('Order created for the hospital');
  await pause();

  await act(operations, 'order.dispatch', {
    orderId,
    cylinderIds: [cylinderId],
    vehicle: 'DL 01 AB 1234',
    driverId: 'u-driver',
  });
  step(`Loaded on truck DL 01 AB 1234 (by ${operations.name})`);
  await pause();

  await act(driver, 'order.deliver', {
    orderId,
    cylinderIds: [cylinderId],
    recipient: 'Sister Mary',
    notes: '',
  });
  step(`Delivered, received by Sister Mary (driver ${driver.name})`);
  await pause();

  await act(driver, 'cylinder.collect', {
    partyId: CUSTOMER,
    cylinderIds: [cylinderId],
    vehicle: 'DL 01 AB 1234',
    driverId: 'u-driver',
    notes: '',
  });
  step('Empty collected from the hospital');
  await pause();

  await act(operations, 'cylinder.return', {
    partyId: CUSTOMER,
    cylinderIds: [cylinderId],
    contents: 'empty',
    receivingBranchId: BRANCH,
    notes: 'Received by scan. All empty.',
  });
  step('Back in the godown');
  await pause();

  await act(quality, 'cylinder.inspect', {
    cylinderId,
    version: await versionOf(quality, cylinderId),
    condition: 'serviceable',
    notes: 'Returned cylinder checked; ready to fill again.',
  });
  step('Safety check after return');
  console.log(`\nDone. Open Admin → Cylinders → ${tag} → Details → Life story.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
