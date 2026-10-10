// Generates docs/system-design.excalidraw: the whole Cylvero system as an editable Excalidraw
// board (open it at https://excalidraw.com → menu → Open). Re-run after big changes:
//   node scripts/system-map.mjs
import { writeFileSync } from 'node:fs';

const elements = [];
let n = 1;
const nextId = (p) => `${p}-${n++}`;
const NOW = 1760000000000;

const C = {
  ink: '#1e1e1e',
  people: '#ffd8a8',
  device: '#e9ecef',
  simple: '#b2f2bb',
  office: '#a5d8ff',
  shared: '#d0bfff',
  cloud: '#ffec99',
  server: '#ffc9c9',
  data: '#c3fae8',
  outside: '#eebefa',
  have: '#b2f2bb',
  partial: '#ffec99',
  missing: '#ffc9c9',
  plan: '#d0ebff',
  white: '#ffffff',
};

function base(type, x, y, w, h, extra = {}) {
  return {
    id: nextId(type),
    type,
    x,
    y,
    width: w,
    height: h,
    angle: 0,
    strokeColor: C.ink,
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: n * 97,
    version: 1,
    versionNonce: n * 131,
    isDeleted: false,
    boundElements: [],
    updated: NOW,
    link: null,
    locked: false,
    ...extra,
  };
}

const measure = (text, size) => {
  const lines = text.split('\n');
  return {
    width: Math.max(...lines.map((l) => l.length)) * size * 0.56,
    height: lines.length * size * 1.25,
  };
};

function textEl(x, y, text, { size = 16, align = 'left', color = C.ink, container, frame } = {}) {
  const m = measure(text, size);
  const el = base('text', x, y, m.width, m.height, {
    text,
    originalText: text,
    fontSize: size,
    fontFamily: 6,
    textAlign: align,
    verticalAlign: container ? 'middle' : 'top',
    containerId: container?.id ?? null,
    strokeColor: color,
    autoResize: true,
    lineHeight: 1.25,
    frameId: frame?.id ?? null,
  });
  if (container) {
    el.x = container.x + (container.width - m.width) / 2;
    el.y = container.y + (container.height - m.height) / 2;
    container.boundElements.push({ type: 'text', id: el.id });
  }
  elements.push(el);
  return el;
}

function box(x, y, w, h, label, { fill = C.white, size = 16, frame, dashed, bold } = {}) {
  const el = base('rectangle', x, y, w, h, {
    backgroundColor: fill,
    roundness: { type: 3 },
    strokeStyle: dashed ? 'dashed' : 'solid',
    strokeWidth: bold ? 3 : 2,
    frameId: frame?.id ?? null,
  });
  elements.push(el);
  if (label) textEl(0, 0, label, { size, align: 'center', container: el, frame });
  return el;
}

/** A labelled container: a big soft box with its title in the top-left corner. */
function group(x, y, w, h, title, fill, frame) {
  const el = base('rectangle', x, y, w, h, {
    backgroundColor: fill,
    roundness: { type: 3 },
    opacity: 45,
    frameId: frame?.id ?? null,
  });
  elements.push(el);
  textEl(x + 16, y + 12, title, { size: 20, frame });
  return el;
}

function edgePoint(b, side) {
  if (side === 'right') return [b.x + b.width, b.y + b.height / 2];
  if (side === 'left') return [b.x, b.y + b.height / 2];
  if (side === 'top') return [b.x + b.width / 2, b.y];
  return [b.x + b.width / 2, b.y + b.height];
}

function arrow(a, b, { label, dashed, frame, from, to, via = [], color = C.ink } = {}) {
  let start = from;
  let end = to;
  if (!start || !end) {
    if (b.x >= a.x + a.width) [start, end] = ['right', 'left'];
    else if (b.x + b.width <= a.x) [start, end] = ['left', 'right'];
    else if (b.y >= a.y + a.height) [start, end] = ['bottom', 'top'];
    else [start, end] = ['top', 'bottom'];
  }
  const [x1, y1] = edgePoint(a, start);
  const [x2, y2] = edgePoint(b, end);
  // Waypoints let an arrow bend around boxes instead of cutting through them.
  const points = [[x1, y1], ...via, [x2, y2]].map(([x, y]) => [x - x1, y - y1]);
  const xs = points.map((pt) => pt[0]);
  const ys = points.map((pt) => pt[1]);
  const el = base(
    'arrow',
    x1,
    y1,
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
    {
      points,
      startBinding: { elementId: a.id, focus: 0, gap: 6 },
      endBinding: { elementId: b.id, focus: 0, gap: 6 },
      startArrowhead: null,
      endArrowhead: 'arrow',
      lastCommittedPoint: null,
      elbowed: false,
      roundness: via.length ? null : { type: 2 },
      strokeStyle: dashed ? 'dashed' : 'solid',
      strokeColor: color,
      frameId: frame?.id ?? null,
    },
  );
  elements.push(el);
  a.boundElements.push({ type: 'arrow', id: el.id });
  b.boundElements.push({ type: 'arrow', id: el.id });
  if (label) textEl(0, 0, label, { size: 14, align: 'center', container: el, frame });
  return el;
}

const frames = [];
function frame(x, y, w, h, name) {
  const el = base('frame', x, y, w, h, { name, roundness: null, strokeWidth: 2 });
  frames.push(el);
  return el;
}

// ---------------------------------------------------------------- Title
textEl(0, -260, 'Cylvero · system map', { size: 48 });
textEl(
  0,
  -180,
  'How the cylinder app works today, end to end, and where it should go next. Six sections, top to bottom.',
  { size: 20 },
);

// ---------------------------------------------------------------- 1. Whole system today
{
  const F = frame(0, 0, 2520, 1330, '1 · Whole system today');
  const fy = 60;
  textEl(30, fy, 'PEOPLE (6 roles)', { size: 18, frame: F });
  const roles = [
    ['Driver', 'driver'],
    ['Godown helper\n(operations)', 'ops'],
    ['Quality checker', 'quality'],
    ['Admin / owner', 'admin'],
    ['Accounts\n(finance)', 'finance'],
    ['Auditor\n(read-only)', 'auditor'],
  ];
  const R = {};
  roles.forEach(([label, key], i) => {
    R[key] = box(30, fy + 40 + i * 120, 220, 90, label, { fill: C.people, frame: F });
  });

  textEl(320, fy, 'DEVICES', { size: 18, frame: F });
  const phone = box(
    320,
    fy + 40,
    250,
    130,
    'Phone browser\nor home-screen app\n(Android · iPhone)',
    {
      fill: C.device,
      frame: F,
    },
  );
  const laptop = box(320, fy + 400, 250, 110, 'Laptop / office PC\nbrowser', {
    fill: C.device,
    frame: F,
  });
  const bt = box(320, fy + 560, 250, 80, 'Bluetooth barcode\nscanner (types code)', {
    fill: C.device,
    frame: F,
    dashed: true,
  });
  const gallery = box(320, fy + 670, 250, 80, 'QR photo / screenshot\nfrom gallery', {
    fill: C.device,
    frame: F,
    dashed: true,
  });
  const labels = box(320, fy + 780, 250, 80, 'Printed QR labels\n(Download QR · label sheet)', {
    fill: C.device,
    frame: F,
    dashed: true,
  });

  for (const k of ['driver', 'ops']) arrow(R[k], phone, { frame: F });
  arrow(R.quality, phone, { frame: F, dashed: true });
  for (const k of ['quality', 'admin', 'finance', 'auditor']) arrow(R[k], laptop, { frame: F });

  const app = group(
    640,
    fy + 20,
    600,
    1180,
    'WEB APP (React + Vite) · one app, two faces',
    C.white,
    F,
  );
  const signIn = box(
    670,
    fy + 70,
    540,
    60,
    'Sign-in · picture cards (demo) · email + password (live)',
    {
      fill: C.white,
      frame: F,
    },
  );
  const simple = group(
    670,
    fy + 150,
    540,
    330,
    'SIMPLE MODE · Hindi / English · pictures, dots, voice',
    C.simple,
    F,
  );
  const jobs = [
    'Give',
    'Take back',
    'My truck',
    'Scan (+ life story)',
    'Problem',
    'Came back',
    'Load truck',
    'Filled',
    'Check',
  ];
  jobs.forEach((j, i) =>
    box(690 + (i % 3) * 172, fy + 195 + Math.floor(i / 3) * 70, 160, 56, j, {
      fill: C.white,
      size: 15,
      frame: F,
    }),
  );
  textEl(690, fy + 410, '5-second UNDO · big tick / cross · scan, photo or type', {
    size: 15,
    frame: F,
  });
  textEl(690, fy + 435, 'drivers: Give, Take back, My truck · godown: Came back, Load, Filled', {
    size: 13,
    frame: F,
  });

  const office = group(670, fy + 500, 540, 360, 'OFFICE MODE · English · full detail', C.office, F);
  const pages = [
    'Overview',
    'Cylinders',
    'Production',
    'Orders & delivery',
    'Customers',
    'Suppliers & purchases',
    'Billing & rentals',
    'Safety',
    'Reports & audit',
    'Settings & team',
  ];
  pages.forEach((p, i) =>
    box(690 + (i % 2) * 262, fy + 545 + Math.floor(i / 2) * 52, 250, 42, p, {
      fill: C.white,
      size: 15,
      frame: F,
    }),
  );
  textEl(690, fy + 815, '40+ forms · Life story · QR download / print · More menus', {
    size: 15,
    frame: F,
  });

  const shared = group(670, fy + 880, 540, 300, 'SHARED PARTS INSIDE THE APP', C.shared, F);
  const scanner = box(690, fy + 925, 250, 60, 'Scanner\ncamera · photo · keyboard', {
    fill: C.white,
    size: 14,
    frame: F,
  });
  const queue = box(952, fy + 925, 238, 60, 'Offline delivery queue\n(encrypted on phone)', {
    fill: C.white,
    size: 14,
    frame: F,
  });
  const voiceP = box(690, fy + 1000, 250, 60, 'Voice player\nSarvam clips + live', {
    fill: C.white,
    size: 14,
    frame: F,
  });
  const motion = box(952, fy + 1000, 238, 60, 'Animations (Anime.js)\nTranslations hi / en', {
    fill: C.white,
    size: 14,
    frame: F,
  });
  const act = box(
    690,
    fy + 1075,
    500,
    70,
    'act(): every save gets a retry key + CSRF token\n(never saves twice, even on bad network)',
    {
      fill: C.white,
      size: 14,
      frame: F,
      bold: true,
    },
  );

  arrow(phone, simple, { frame: F, label: 'opens' });
  arrow(laptop, office, { frame: F, label: 'opens' });
  arrow(bt, scanner, { frame: F, dashed: true });
  arrow(gallery, scanner, { frame: F, dashed: true });
  arrow(labels, gallery, { frame: F, dashed: true, from: 'bottom', to: 'bottom' });
  textEl(690, fy + 1155, 'Both modes save through act()', { size: 13, frame: F });

  const vercel = group(1310, fy + 20, 330, 560, 'VERCEL · Mumbai (bom1)', C.cloud, F);
  const statics = box(
    1335,
    fy + 70,
    280,
    120,
    'Static files\napp · fonts (Noto)\n160 voice clips · icons',
    {
      fill: C.white,
      frame: F,
    },
  );
  const headers = box(1335, fy + 220, 280, 80, 'Security headers\nCSP · HSTS · no framing', {
    fill: C.white,
    frame: F,
  });
  const fn = box(1335, fy + 330, 280, 110, 'API function /api/*\n(api/index.mjs bundle)', {
    fill: C.white,
    frame: F,
    bold: true,
  });
  const github = box(
    1335,
    fy + 660,
    280,
    110,
    'GitHub repo (main)\nevery push deploys\nautomatically',
    {
      fill: C.white,
      frame: F,
    },
  );
  arrow(github, vercel, {
    frame: F,
    label: 'build + deploy',
    dashed: true,
    from: 'top',
    to: 'bottom',
  });
  arrow(signIn, statics, { frame: F, label: 'loads' });
  arrow(act, fn, { frame: F, label: 'HTTPS · cookie · CSRF' });
  arrow(shared, statics, {
    frame: F,
    dashed: true,
    label: 'voice clips',
    from: 'right',
    to: 'left',
    via: [
      [1275, fy + 1000],
      [1275, fy + 130],
    ],
  });

  const server = group(
    1710,
    fy + 20,
    420,
    1180,
    'SERVER (Express) · the only door to data',
    C.server,
    F,
  );
  const auth = box(
    1735,
    fy + 70,
    370,
    90,
    'Sign-in & sessions\nlogin · logout · bootstrap\n15-min lockout · 12-h sessions',
    {
      fill: C.white,
      size: 14,
      frame: F,
    },
  );
  const guard = box(
    1735,
    fy + 180,
    370,
    70,
    'Checks on every save\nsession · CSRF · origin · role',
    {
      fill: C.white,
      size: 14,
      frame: F,
    },
  );
  const domain = box(
    1735,
    fy + 270,
    370,
    170,
    'DOMAIN ENGINE  /api/actions\n37 commands, e.g. register, inspect,\nfill batch, release, dispatch, deliver,\ncollect, return, invoice, receipt …\nevery safety + money rule lives here',
    {
      fill: C.white,
      size: 14,
      frame: F,
      bold: true,
    },
  );
  const scope = box(1735, fy + 460, 370, 70, 'Role-scoped data\n(a driver sees only own trips)', {
    fill: C.white,
    size: 14,
    frame: F,
  });
  const reports = box(
    1735,
    fy + 550,
    370,
    70,
    'Reports & exports\naudit · JSON export · cylinders CSV',
    { fill: C.white, size: 14, frame: F },
  );
  const team = box(1735, fy + 640, 370, 70, 'Team & passwords\nadd users · roles · branches', {
    fill: C.white,
    size: 14,
    frame: F,
  });
  const voiceS = box(
    1735,
    fy + 730,
    370,
    90,
    'Live voice /api/voice\nsigned-in only · 40/min · cache\nkey stays on server',
    {
      fill: C.white,
      size: 14,
      frame: F,
    },
  );
  arrow(fn, auth, { frame: F });
  arrow(fn, guard, { frame: F });
  arrow(guard, domain, { frame: F });
  arrow(domain, scope, { frame: F });

  const db = group(
    2200,
    fy + 20,
    290,
    820,
    'SUPABASE POSTGRES\nMumbai · private schema',
    C.data,
    F,
  );
  const orgState = box(
    2220,
    fy + 100,
    250,
    130,
    'org_state\nTHE WHOLE COMPANY\nas one JSON record\n⚠ scale limit',
    {
      fill: '#ffe3e3',
      size: 15,
      frame: F,
      bold: true,
    },
  );
  const tables = [
    'users',
    'sessions',
    'login_attempts',
    'idempotency (retry keys)',
    'audit_log (cannot edit)',
    'user_auth_epoch',
  ];
  const T = {};
  tables.forEach((t, i) => {
    T[t] = box(2220, fy + 250 + i * 72, 250, 56, t, { fill: C.white, size: 15, frame: F });
  });
  arrow(domain, orgState, { frame: F, label: 'read + write whole state' });
  arrow(auth, T.sessions, { frame: F, dashed: true });
  arrow(domain, T['audit_log (cannot edit)'], { frame: F, dashed: true, label: 'append' });

  const sarvam = box(
    2200,
    fy + 900,
    290,
    110,
    'Sarvam AI\nBulbul v3 voice "priya"\nHindi + English',
    { fill: C.outside, frame: F },
  );
  arrow(voiceS, sarvam, { frame: F, label: 'text → speech' });
  const local = box(
    2200,
    fy + 1040,
    290,
    110,
    'On a developer PC\nsame server + SQLite file\ndata/ctms.sqlite',
    {
      fill: C.device,
      frame: F,
      dashed: true,
    },
  );
  textEl(1735, fy + 1140, 'Not built yet: WhatsApp · SMS · Tally · GST e-invoice · RFID · GPS', {
    size: 14,
    color: '#c92a2a',
    frame: F,
  });
  void [
    app,
    simple,
    office,
    shared,
    vercel,
    server,
    db,
    headers,
    reports,
    team,
    queue,
    motion,
    local,
  ];
}

// ---------------------------------------------------------------- 2. Cylinder life cycle
{
  const F = frame(0, 1450, 2520, 1000, '2 · Cylinder life cycle (what the server allows)');
  const y0 = 1500;
  const s = (x, y, label, fill = C.white) =>
    box(x, y, 250, 90, label, { fill, size: 16, frame: F });
  // Side states sit in a lane above the main loop.
  const hold = s(360, y0 + 20, 'ON HOLD\nquarantine / testing', C.missing);
  const supplier = s(690, y0 + 20, 'At supplier\nrefill or hydro test', C.device);
  // The main loop: left to right on top, right to left below.
  const fresh = s(30, y0 + 200, 'New cylinder', C.device);
  const check = s(360, y0 + 200, 'At godown\nneeds safety check', '#fff3bf');
  const ready = s(690, y0 + 200, 'At godown\nempty · safe', C.simple);
  const waiting = s(1020, y0 + 200, 'Full\nwaiting for quality', '#fff3bf');
  const released = s(1350, y0 + 200, 'Full · released\nready to send', C.simple);
  const pickup = s(690, y0 + 480, 'On pickup truck\n(collected empty)', C.office);
  const customer = s(1020, y0 + 480, 'At customer\nrent running', C.outside);
  const truck = s(1350, y0 + 480, 'On delivery truck\n(order · driver · truck no.)', C.office);
  const exception = s(690, y0 + 760, 'Exception queue\n(unknown cylinder)', C.partial);
  const lost = s(1020, y0 + 760, 'Lost / damaged\nat customer', C.missing);
  const retired = s(1350, y0 + 760, 'Written off /\nretired', C.device);

  arrow(fresh, check, { frame: F, label: 'register' });
  arrow(check, ready, { frame: F, label: 'inspect: good' });
  arrow(ready, waiting, { frame: F, label: 'fill batch' });
  arrow(waiting, released, { frame: F, label: 'quality release' });
  arrow(released, truck, { frame: F, label: 'dispatch (exact count)' });
  arrow(truck, customer, { frame: F, label: 'deliver + name' });
  arrow(customer, pickup, { frame: F, label: 'collect' });
  arrow(pickup, check, {
    frame: F,
    label: 'came back (return)',
    from: 'left',
    to: 'right',
    via: [
      [650, y0 + 525],
      [650, y0 + 245],
    ],
  });
  arrow(truck, check, {
    frame: F,
    label: 'unload (not delivered)',
    dashed: true,
    from: 'bottom',
    to: 'bottom',
    via: [
      [1475, y0 + 650],
      [485, y0 + 650],
    ],
  });
  arrow(check, hold, { frame: F, label: 'inspect: hold', dashed: true, from: 'top', to: 'bottom' });
  arrow(released, hold, {
    frame: F,
    label: 'recall batch',
    dashed: true,
    from: 'top',
    to: 'right',
    via: [
      [1475, y0 + 150],
      [640, y0 + 150],
      [640, y0 + 65],
    ],
  });
  arrow(ready, supplier, {
    frame: F,
    label: 'send',
    dashed: true,
    from: 'top',
    to: 'bottom',
    via: [[860, y0 + 160]],
  });
  arrow(supplier, check, {
    frame: F,
    label: 'receive back',
    dashed: true,
    from: 'bottom',
    to: 'top',
    via: [
      [770, y0 + 175],
      [530, y0 + 175],
    ],
  });
  arrow(customer, lost, { frame: F, label: 'report incident', dashed: true });
  arrow(lost, retired, { frame: F, label: 'write off' });
  arrow(pickup, exception, { frame: F, label: 'Problem button', dashed: true });
  textEl(
    1750,
    y0 + 200,
    'Every arrow is one command.\nThe server refuses an arrow that\nbreaks a rule: unsafe gas, test date\nover, wrong count, wrong customer.\nEach arrow adds a movement record:\nthat is the Life story.',
    {
      size: 18,
      frame: F,
    },
  );
}

// ---------------------------------------------------------------- 3. One save, end to end
{
  const F = frame(0, 2550, 2520, 560, '3 · One save, end to end (driver taps Done on "Give")');
  const y = 2640;
  const steps = [
    ['1. Tap Done\n(scanned 2 cylinders)', C.simple],
    ['2. 5-second UNDO ring\nnothing sent yet', C.partial],
    ['3. act()\nretry key + CSRF', C.shared],
    ['4. Vercel\n/api/actions', C.cloud],
    ['5. Checks\nsession · role · origin', C.server],
    ['6. Domain rules\non the truck? safe?\nright driver?', C.server],
    ['7. One transaction\nsave state + audit row', C.data],
    ['8. Changes sent back\n(delta, not everything)', C.cloud],
    ['9. Green tick\n+ Sarvam voice', C.simple],
  ];
  let prev;
  steps.forEach(([label, fill], i) => {
    const b = box(30 + i * 275, y, 240, 120, label, { fill, size: 15, frame: F });
    if (prev) arrow(prev, b, { frame: F });
    prev = b;
  });
  const offline = box(
    580,
    y + 230,
    520,
    100,
    'No network? Deliveries are saved encrypted on the phone\nand sent later with the ☁ button (same retry key).',
    {
      fill: C.device,
      size: 15,
      frame: F,
    },
  );
  const undo = box(
    30,
    y + 230,
    480,
    100,
    'UNDO in time → nothing reaches the server,\nnothing in the audit log. A true "never happened".',
    {
      fill: C.partial,
      size: 15,
      frame: F,
    },
  );
  const fail = box(
    1170,
    y + 230,
    560,
    100,
    'Refused? One of 4 picture screens: no network,\nsomething changed, not allowed, call office.',
    {
      fill: C.missing,
      size: 15,
      frame: F,
    },
  );
  void [offline, undo, fail];
}

// ---------------------------------------------------------------- 4. Who sees what
{
  const F = frame(0, 3210, 2520, 760, '4 · Who sees what');
  const y = 3290;
  const rows = [
    ['Driver', 'Simple only: Give · Take back · My truck · Scan · Problem', C.simple],
    [
      'Godown (operations)',
      'Simple first: Came back · Load truck · Filled · Scan · Problem → can switch to Office',
      C.simple,
    ],
    ['Quality', 'Office first (inspect, release, recall, Safety) → Simple: Scan · Check', C.office],
    ['Admin', 'Office: everything, team, settings, audit → can switch to Simple', C.office],
    [
      'Finance',
      'Office: Billing & rentals, customers, invoices, receipts, deposits, credits',
      C.office,
    ],
    ['Auditor', 'Office, read-only: Reports & audit, exports', C.office],
  ];
  rows.forEach(([who, what, fill], i) => {
    const a = box(30, y + i * 105, 300, 80, who, { fill: C.people, size: 18, frame: F });
    const b = box(430, y + i * 105, 1300, 80, what, { fill, size: 16, frame: F });
    arrow(a, b, { frame: F });
  });
  textEl(
    1800,
    y,
    'The server decides what each role\nreceives and may do. Hiding a\nbutton is never the security.',
    {
      size: 18,
      frame: F,
    },
  );
}

// ---------------------------------------------------------------- 5. Target system
{
  const F = frame(0, 4070, 2520, 1150, '5 · Target system (plan)');
  const y = 4140;
  textEl(30, y, 'CHANNELS', { size: 18, frame: F });
  const field = box(
    30,
    y + 40,
    340,
    130,
    'Field app (Android / iOS)\nSimple mode · offline-first\nRFID · camera · thermal print',
    { fill: C.simple, frame: F },
  );
  const officeWeb = box(30, y + 200, 340, 100, 'Office web app\ndashboards · bulk work', {
    fill: C.office,
    frame: F,
  });
  const portal = box(30, y + 330, 340, 100, 'Customer portal\n"my cylinders, my bills"', {
    fill: C.plan,
    frame: F,
  });
  const bot = box(30, y + 460, 340, 100, 'WhatsApp bot\nchallans · reminders · balance', {
    fill: C.plan,
    frame: F,
  });
  const site = box(30, y + 590, 340, 100, 'Brand website\ndemo booking · ROI calculator', {
    fill: C.plan,
    frame: F,
  });

  const api = box(
    500,
    y + 40,
    360,
    650,
    'ONE API\n(versioned, documented)\nsign-in · roles · tenants\n(multi-company)\nrate limits\naudit on every write',
    {
      fill: C.server,
      frame: F,
      bold: true,
    },
  );
  for (const c of [field, officeWeb, portal, bot, site]) arrow(c, api, { frame: F });

  textEl(960, y, 'SERVICES', { size: 18, frame: F });
  const svc = [
    ['Operations\ncylinders · orders · trips', C.white],
    ['Billing & GST\ninvoices · e-invoice · e-way bill', C.white],
    ['Rental & recovery\nageing · penalties · deposits', C.white],
    ['Notifications\nWhatsApp · SMS · email · voice', C.white],
    ['Integrations\nTally · GPS · RFID gates', C.white],
    ['Reports & insights\nloss, recovery, test-due', C.white],
  ];
  const S = svc.map(([label, fill], i) =>
    box(960, y + 40 + i * 108, 360, 92, label, { fill, size: 15, frame: F }),
  );
  for (const sv of S) arrow(api, sv, { frame: F });

  textEl(1420, y, 'DATA & JOBS', { size: 18, frame: F });
  const pg = box(
    1420,
    y + 40,
    420,
    170,
    'Postgres, one table per thing\ncylinders · movements (append-only)\norders · invoices · customers\nper-record versions (no global lock)',
    {
      fill: C.data,
      size: 15,
      frame: F,
      bold: true,
    },
  );
  const files = box(
    1420,
    y + 240,
    420,
    90,
    'File storage\nphotos · signatures · test certificates',
    { fill: C.data, size: 15, frame: F },
  );
  const jobs = box(
    1420,
    y + 360,
    420,
    110,
    'Scheduled jobs\ntest-due + rental alerts · Tally sync\nnightly reports',
    { fill: C.data, size: 15, frame: F },
  );
  const analytics = box(
    1420,
    y + 500,
    420,
    90,
    'Analytics copy\n(heavy reports off the main database)',
    { fill: C.data, size: 15, frame: F },
  );
  arrow(S[0], pg, { frame: F });
  arrow(S[1], pg, { frame: F });
  arrow(S[3], jobs, { frame: F, dashed: true });
  arrow(S[5], analytics, { frame: F, dashed: true });
  arrow(S[0], files, { frame: F, dashed: true });

  textEl(1940, y, 'OUTSIDE SERVICES (through Notifications + Integrations)', {
    size: 18,
    frame: F,
  });
  const ext = [
    'Sarvam AI (voice + speech-to-text)',
    'WhatsApp Business API',
    'GST IRP / e-way bill (via GSP)',
    'Tally (two-way sync)',
    'GPS trackers / phone GPS',
    'UHF RFID readers (Bluetooth + gates)',
  ];
  ext.forEach((label, i) => {
    const b = box(1940, y + 40 + i * 108, 540, 92, label, { fill: C.outside, size: 16, frame: F });
    void b;
  });
  textEl(
    500,
    y + 760,
    'Run it like a product: staging + production · error alerts · uptime checks · daily backups with point-in-time restore · tests on every push',
    {
      size: 18,
      frame: F,
    },
  );
  void [files];
}

// ---------------------------------------------------------------- 6. Benchmark gap
{
  const F = frame(0, 5320, 2520, 1000, '6 · Against the benchmark (ctmsgas.com feature list)');
  const y = 5390;
  const cols = [
    [
      'WE HAVE IT',
      C.have,
      [
        'QR tagging + label print / download',
        'Barcode + Bluetooth scanner input',
        'Cylinder history (Life story)',
        'Full lifecycle with safety rules',
        'Orders, dispatch, delivery challan',
        'Customer returns + pickups',
        'Fill batches + quality release / recall',
        'Rental billing, free days, deposits',
        'GST invoices, receipts, credit notes',
        'Multi-branch, 6 roles, audit log',
        'CSV import, exports',
        'Phone app (installable web app)',
      ],
    ],
    [
      'PARTLY',
      C.partial,
      [
        'Test-due tracking (no reminders yet)',
        'Hydro test (via supplier send / receive)',
        'Offline use (deliveries only)',
        'Dashboards (overview, not drill-down)',
        'Customer ledger (inside Billing)',
        'Approval workflow (fill ≠ release)',
        'Proof of delivery (typed name only)',
        'Role management (6 fixed roles)',
      ],
    ],
    [
      'MISSING',
      C.missing,
      [
        'WhatsApp challans / invoices / reminders',
        'SMS + email alerts',
        'Tally sync',
        'GST e-invoice (IRN) + e-way bill',
        'RFID readers + gates',
        'GPS vehicle tracking, route planning',
        'Native Android / iOS app + thermal print',
        'Photo + signature proof of delivery',
        'Customer portal, vendor portal',
        'Multi-company tenancy',
        'Quotations, debit notes, penalties',
        'Liquid / line loss, yield reports',
      ],
    ],
  ];
  cols.forEach(([title, fill, items], c) => {
    const x = 30 + c * 830;
    box(x, y, 780, 60, title, { fill, size: 22, frame: F, bold: true });
    items.forEach((item, i) =>
      box(x, y + 80 + i * 66, 780, 54, item, { fill: C.white, size: 16, frame: F }),
    );
  });
  textEl(
    30,
    y + 900,
    'OURS ONLY: Hindi + English picture mode for workers who cannot read · Sarvam voice · 5-second undo · plain-language Life story · read QR from a photo · server-enforced safety rules',
    {
      size: 18,
      color: '#2b8a3e',
      frame: F,
    },
  );
}

// Frames go first so Excalidraw draws them behind their contents.
const doc = {
  type: 'excalidraw',
  version: 2,
  source: 'https://excalidraw.com',
  elements: [...frames, ...elements],
  appState: { viewBackgroundColor: '#ffffff', gridSize: null },
  files: {},
};
writeFileSync(
  new URL('../docs/system-design.excalidraw', import.meta.url),
  JSON.stringify(doc, null, 1),
);
console.log(
  `docs/system-design.excalidraw: ${frames.length} sections, ${elements.length} elements`,
);
