import type {
  AppState,
  Cylinder,
  Party,
  Order,
  Batch,
  Invoice,
  Movement,
  RentalInterval,
  Receipt,
  AuditEvent,
} from '../shared/types.js';

const isoDay = (value: Date) => value.toISOString().slice(0, 10);
const shift = (now: Date, days: number) =>
  isoDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days)));
export function createSeedState(at = new Date().toISOString()): AppState {
  const now = new Date(at);
  const timestamp = now.toISOString();
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const calendar = new Date(`${localDate}T00:00:00.000Z`);
  const date = localDate;
  const before = (days: number) => shift(calendar, -days);
  const after = (days: number) => shift(calendar, days);
  const branches = [
    { id: 'b-delhi', name: 'Demo Delhi Plant & Godown (Okhla)', city: 'Delhi' },
    { id: 'b-faridabad', name: 'Demo Faridabad Distribution Godown', city: 'Faridabad' },
  ];
  const parties: Party[] = [
    {
      id: 'p-hospital-1',
      name: 'Demo North Care Hospital',
      type: 'hospital',
      contact: 'Demo Procurement Desk',
      phone: '00000 01001',
      address: 'Sample Avenue, Civil Lines',
      city: 'Delhi',
      gstin: 'DEMO-GST-001',
      branchId: 'b-delhi',
      creditLimitPaise: 30000000,
      dailyRentalPaise: 18000,
      freeDays: 2,
      depositPaise: 300000,
    },
    {
      id: 'p-hospital-2',
      name: 'Demo City General Hospital',
      type: 'hospital',
      contact: 'Demo Stores Desk',
      phone: '00000 01002',
      address: 'Model Road, Sector 12',
      city: 'Faridabad',
      gstin: 'DEMO-GST-002',
      branchId: 'b-faridabad',
      creditLimitPaise: 40000000,
      dailyRentalPaise: 16000,
      freeDays: 3,
      depositPaise: 250000,
    },
    {
      id: 'p-home-1',
      name: 'Demo Home Oxygen Service A',
      type: 'homecare',
      contact: 'Demo Service Coordinator',
      phone: '00000 01003',
      address: 'Example Enclave, Block C',
      city: 'Delhi',
      gstin: '',
      branchId: 'b-delhi',
      creditLimitPaise: 5000000,
      dailyRentalPaise: 22000,
      freeDays: 1,
      depositPaise: 350000,
    },
    {
      id: 'p-home-2',
      name: 'Demo Aarogya Home Oxygen Care',
      type: 'homecare',
      contact: 'Demo Service Coordinator',
      phone: '00000 01004',
      address: 'Sample Colony, Sector 21',
      city: 'Faridabad',
      gstin: '',
      branchId: 'b-faridabad',
      creditLimitPaise: 5000000,
      dailyRentalPaise: 21000,
      freeDays: 1,
      depositPaise: 300000,
    },
    {
      id: 'p-industry-1',
      name: 'Demo Okhla Precision Fabricators',
      type: 'industrial',
      contact: 'Demo Purchase Office',
      phone: '00000 01005',
      address: 'Industrial Model Estate',
      city: 'Delhi',
      gstin: 'DEMO-GST-005',
      branchId: 'b-delhi',
      creditLimitPaise: 10000000,
      dailyRentalPaise: 12000,
      freeDays: 0,
      depositPaise: 200000,
    },
    {
      id: 'p-supplier-1',
      name: 'Demo Hydrotest & Valve Services',
      type: 'supplier',
      contact: 'Demo Vendor Desk',
      phone: '00000 01006',
      address: 'Example Industrial Estate',
      city: 'Delhi',
      gstin: 'DEMO-GST-006',
      branchId: 'b-delhi',
      creditLimitPaise: 0,
      dailyRentalPaise: 0,
      freeDays: 0,
      depositPaise: 0,
    },
    {
      id: 'p-supplier-2',
      name: 'Demo Haryana Medical Gases (filled supply)',
      type: 'supplier',
      contact: 'Demo Vendor Desk',
      phone: '00000 01007',
      address: 'Sample Supply Park',
      city: 'Faridabad',
      gstin: 'DEMO-GST-007',
      branchId: 'b-faridabad',
      creditLimitPaise: 0,
      dailyRentalPaise: 0,
      freeDays: 0,
      depositPaise: 0,
    },
    // Demo story customers (see docs/demo-script.md). Added after the original records so
    // existing lookups such as "first hospital" still find the same party.
    {
      id: 'p-hospital-3',
      name: 'Demo Sanjeevani District Hospital',
      type: 'hospital',
      contact: 'Demo Medical Gas Stores',
      phone: '00000 01008',
      address: 'Sample Hospital Road, Sarita Vihar',
      city: 'Delhi',
      gstin: 'DEMO-GST-008',
      branchId: 'b-delhi',
      creditLimitPaise: 30000000,
      dailyRentalPaise: 18000,
      freeDays: 2,
      depositPaise: 300000,
    },
    {
      id: 'p-clinic-1',
      name: 'Demo Shanti Community Clinic',
      type: 'hospital',
      contact: 'Demo Clinic Manager',
      phone: '00000 01009',
      address: 'Example Market, Jasola',
      city: 'Delhi',
      gstin: 'DEMO-GST-009',
      branchId: 'b-delhi',
      creditLimitPaise: 8000000,
      dailyRentalPaise: 20000,
      freeDays: 1,
      depositPaise: 300000,
    },
  ];
  const cylinders: Cylinder[] = [];
  const batches: Batch[] = [];
  const movements: Movement[] = [];
  const rentals: RentalInterval[] = [];
  const owners = ['company', 'company', 'company', 'company', 'p-hospital-1', 'p-home-1'];
  for (let n = 1; n <= 84; n++) {
    const id = `c-${String(n).padStart(3, '0')}`;
    const branchId = n <= 50 ? 'b-delhi' : 'b-faridabad';
    const gas = n % 7 === 0 ? 'Industrial oxygen' : 'Medical oxygen';
    const size = n % 5 === 0 ? 'D' : 'B';
    const condition: Cylinder['condition'] =
      n <= 46
        ? 'serviceable'
        : n <= 55
          ? 'inspection_due'
          : n <= 62
            ? 'quarantine'
            : n <= 67
              ? 'testing'
              : n <= 70
                ? 'retired'
                : 'serviceable';
    const contents: Cylinder['contents'] =
      n <= 28 ? 'full' : n <= 46 ? 'empty' : n <= 70 ? 'unknown' : n <= 80 ? 'full' : 'empty';
    const c: Cylinder = {
      id,
      serial: `DEMO-OX-${String(n).padStart(5, '0')}`,
      tag: `DEMO-TAG-${String(n).padStart(5, '0')}`,
      manufacturer: n % 3 === 0 ? 'Demo Alloy Works' : 'Demo Cylinder Works',
      gas,
      size,
      ownerId:
        n > 50
          ? owners[n % owners.length] === 'p-hospital-1'
            ? 'p-hospital-2'
            : owners[n % owners.length] === 'p-home-1'
              ? 'p-home-2'
              : owners[n % owners.length]
          : n === 4
            ? 'company'
            : owners[n % owners.length],
      branchId,
      custody: 'plant',
      custodianId: branchId,
      condition,
      contents,
      testDue: n >= 63 && n <= 67 ? before(10) : after(120 + n * 3),
      lastTest: before(120 + n),
      certificate: n >= 63 && n <= 67 ? 'EXPIRED-DEMO' : `DEMO-TEST-${String(n).padStart(4, '0')}`,
      version: 1,
      createdAt: `${before(200 + n)}T09:00:00.000Z`,
    };
    cylinders.push(c);
    movements.push({
      id: `m-seed-${n}`,
      cylinderId: id,
      action: 'registered',
      from: 'new',
      to: `plant:${branchId}`,
      at: c.createdAt,
      actorId: 'u-ops',
      actorName: 'Demo Operations',
      reference: c.serial,
      notes: 'Synthetic demonstration asset',
    });
  }
  for (let k = 0; k < 4; k++) {
    const range = k === 0 ? [1, 12] : k === 1 ? [13, 28] : k === 2 ? [71, 75] : [76, 80];
    const ids = cylinders.slice(range[0] - 1, range[1]).map((c) => c.id);
    const b: Batch = {
      id: `batch-${k + 1}`,
      number: `DEMO-BATCH-${String(k + 1).padStart(3, '0')}`,
      branchId: k >= 2 ? 'b-faridabad' : 'b-delhi',
      gas: 'Medical oxygen',
      cylinderIds: ids.filter((id) => cylinders.find((c) => c.id === id)?.gas === 'Medical oxygen'),
      source: k === 3 ? 'Demo purchase receipt' : 'Demo plant fill',
      operator: 'u-ops',
      status: k === 2 ? 'awaiting_release' : 'released',
      createdAt: `${before(12 - k)}T10:00:00.000Z`,
      releasedAt: k === 2 ? undefined : `${before(12 - k)}T13:00:00.000Z`,
      releasedBy: k === 2 ? undefined : 'u-quality',
      certificate: k === 2 ? undefined : `DEMO-QC-${k + 1}`,
      qualityNotes: k === 2 ? undefined : 'Synthetic quality release',
    };
    batches.push(b);
    for (const id of b.cylinderIds) cylinders.find((c) => c.id === id)!.batchId = b.id;
  }
  for (const [id, branchId] of [
    ['batch-industrial-delhi', 'b-delhi'],
    ['batch-industrial-faridabad', 'b-faridabad'],
  ] as const) {
    const members = cylinders.filter(
      (c) =>
        c.branchId === branchId &&
        c.gas === 'Industrial oxygen' &&
        c.contents === 'full' &&
        c.condition === 'serviceable',
    );
    if (!members.length) continue;
    const b: Batch = {
      id,
      number: `DEMO-${id.toUpperCase()}`,
      branchId,
      gas: 'Industrial oxygen',
      cylinderIds: members.map((c) => c.id),
      source: 'Demo industrial fill',
      operator: 'u-ops',
      status: 'released',
      createdAt: `${before(12)}T10:00:00.000Z`,
      releasedAt: `${before(12)}T13:00:00.000Z`,
      releasedBy: 'u-quality',
      certificate: `DEMO-QC-${id}`,
      qualityNotes: 'Synthetic quality release',
    };
    batches.push(b);
    for (const c of members) c.batchId = b.id;
  }
  const orders: Order[] = [
    {
      id: 'o-delivered-1',
      number: 'DEMO-ORD-001',
      partyId: 'p-hospital-1',
      branchId: 'b-delhi',
      gas: 'Medical oxygen',
      size: 'B',
      quantity: 2,
      priority: 'urgent',
      dueDate: before(6),
      notes: 'Demo ward replenishment',
      unitPricePaise: 145000,
      status: 'delivered',
      cylinderIds: ['c-001', 'c-002'],
      deliveredIds: ['c-001', 'c-002'],
      vehicle: 'DL 01 DEMO',
      driverId: 'u-driver',
      createdAt: `${before(7)}T09:00:00.000Z`,
      recipient: 'Demo Receiving Desk',
      deliveredAt: `${before(6)}T13:00:00.000Z`,
    },
    {
      id: 'o-partial-1',
      number: 'DEMO-ORD-002',
      partyId: 'p-home-1',
      branchId: 'b-delhi',
      gas: 'Medical oxygen',
      size: 'B',
      quantity: 2,
      priority: 'normal',
      dueDate: date,
      notes: 'Demo homecare route',
      unitPricePaise: 155000,
      status: 'partial',
      cylinderIds: ['c-003', 'c-004'],
      deliveredIds: ['c-003'],
      vehicle: 'DL 02 DEMO',
      driverId: 'u-driver',
      createdAt: `${before(2)}T09:00:00.000Z`,
      recipient: 'Demo Coordinator',
      deliveredAt: `${before(1)}T14:00:00.000Z`,
    },
    {
      id: 'o-open-1',
      number: 'DEMO-ORD-003',
      partyId: 'p-hospital-1',
      branchId: 'b-delhi',
      gas: 'Medical oxygen',
      size: 'B',
      quantity: 3,
      priority: 'normal',
      dueDate: after(1),
      notes: 'Demo planned replenishment',
      unitPricePaise: 145000,
      status: 'open',
      cylinderIds: [],
      deliveredIds: [],
      vehicle: '',
      driverId: '',
      createdAt: `${before(1)}T11:00:00.000Z`,
    },
    {
      id: 'o-open-2',
      number: 'DEMO-ORD-004',
      partyId: 'p-hospital-2',
      branchId: 'b-faridabad',
      gas: 'Medical oxygen',
      size: 'B',
      quantity: 2,
      priority: 'urgent',
      dueDate: date,
      notes: 'Demo urgent distribution',
      unitPricePaise: 150000,
      status: 'open',
      cylinderIds: [],
      deliveredIds: [],
      vehicle: '',
      driverId: '',
      createdAt: `${before(1)}T12:00:00.000Z`,
    },
  ];
  for (const [id, partyId, orderId, start, end] of [
    ['c-001', 'p-hospital-1', 'o-delivered-1', before(6), undefined],
    ['c-002', 'p-hospital-1', 'o-delivered-1', before(6), undefined],
    ['c-003', 'p-home-1', 'o-partial-1', before(1), undefined],
  ] as const) {
    const c = cylinders.find((c) => c.id === id)!;
    c.custody = 'customer';
    c.custodianId = partyId;
    const party = parties.find((p) => p.id === partyId)!;
    rentals.push({
      id: `r-${id}`,
      cylinderId: id,
      partyId,
      orderId,
      start,
      end,
      dailyRatePaise: party.dailyRentalPaise,
      freeDays: party.freeDays,
    });
  }
  const vehicle = cylinders.find((c) => c.id === 'c-004')!;
  vehicle.custody = 'vehicle';
  vehicle.custodianId = 'o-partial-1';

  // ---------- Demo story anchors (docs/demo-script.md) ----------
  // Extra records for the presenter's walkthrough, each findable by a memorable tag.
  // They are appended after the original 84 cylinders, 4 orders and 6 batches, so every
  // existing id, count and relationship that the tests rely on is unchanged.
  //   DEMO-LOAD-1/2   full, filled today, batch DEMO-BATCH-006 awaiting Quality release
  //   DEMO-HOLD-1     pulled out of DEMO-BATCH-006 by Quality: on hold, dispatch refuses it
  //   DEMO-EXPIRED-1  full and released, but its test date has passed: dispatch refuses it
  //   DEMO-GIVE-1/2   on the demo driver's truck for DEMO-ORD-007 (clinic), ready to Give
  //   DEMO-TAKE-1/2   at Demo Sanjeevani District Hospital since DEMO-ORD-005, to Take back
  //   DEMO-CLINIC-1   at Demo Shanti Community Clinic since DEMO-ORD-006, to Take back
  //   DEMO-SUP-1/2    at the hydrotest supplier for periodic testing
  // DEMO-ORD-008 is the open hospital order for exactly 2 that "Load truck" fills live.
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
  const anchorExceptions: AppState['exceptions'] = [];
  const anchorAudit: AuditEvent[] = [];
  const anchorMove = (
    c: Cylinder,
    action: string,
    from: string,
    to: string,
    at: string,
    actor: 'u-ops' | 'u-quality' | 'u-driver',
    reference: string,
    notes: string,
    beforeBatch?: string,
  ) =>
    movements.push({
      id: `m-demo-${action}-${c.id}`,
      cylinderId: c.id,
      action,
      from,
      to,
      at,
      actorId: actor,
      actorName:
        actor === 'u-ops' ? 'Demo Operations' : actor === 'u-quality' ? 'Demo Quality' : 'Demo Driver',
      reference,
      notes,
      ...(beforeBatch ? { before: { batchId: beforeBatch } } : {}),
    });
  const anchor = (n: number, tag: string, fields: Partial<Cylinder> = {}): Cylinder => {
    const c: Cylinder = {
      id: `c-${String(n).padStart(3, '0')}`,
      serial: `DEMO-OX-${String(n).padStart(5, '0')}`,
      tag,
      manufacturer: n % 2 ? 'Demo Cylinder Works' : 'Demo Alloy Works',
      gas: 'Medical oxygen',
      size: 'B',
      ownerId: 'company',
      branchId: 'b-delhi',
      custody: 'plant',
      custodianId: 'b-delhi',
      condition: 'serviceable',
      contents: 'full',
      testDue: after(400 + n),
      lastTest: before(300 + n),
      certificate: `DEMO-TEST-${String(n).padStart(4, '0')}`,
      version: 1,
      createdAt: `${before(320 + n)}T09:00:00.000Z`,
      ...fields,
    };
    cylinders.push(c);
    anchorMove(c, 'registered', 'new', 'plant:b-delhi', c.createdAt, 'u-ops', c.serial, 'Synthetic demonstration asset');
    anchorMove(c, 'inspection', 'plant:b-delhi', 'plant:b-delhi', `${before(10)}T04:00:00.000Z`, 'u-quality', c.id, 'Synthetic pre-fill check: serviceable');
    return c;
  };
  const give1 = anchor(85, 'DEMO-GIVE-1');
  const give2 = anchor(86, 'DEMO-GIVE-2');
  const take1 = anchor(87, 'DEMO-TAKE-1');
  const take2 = anchor(88, 'DEMO-TAKE-2');
  const clinic1 = anchor(89, 'DEMO-CLINIC-1');
  const load1 = anchor(90, 'DEMO-LOAD-1');
  const load2 = anchor(91, 'DEMO-LOAD-2');
  const hold1 = anchor(92, 'DEMO-HOLD-1');
  // Tested about five years ago; the test lapsed two days ago, after its batch was released.
  const expired1 = anchor(93, 'DEMO-EXPIRED-1', {
    lastTest: before(1827),
    testDue: before(2),
    certificate: 'DEMO-TEST-0093',
  });
  const sup1 = anchor(94, 'DEMO-SUP-1', { testDue: after(5), contents: 'empty' });
  const sup2 = anchor(95, 'DEMO-SUP-2', { testDue: after(5), contents: 'empty' });

  // DEMO-BATCH-005: released nine days ago. Its cylinders went to the district hospital and
  // the clinic, so a recall of this batch traces real seeded deliveries.
  const tracedBatch: Batch = {
    id: 'batch-5',
    number: 'DEMO-BATCH-005',
    branchId: 'b-delhi',
    gas: 'Medical oxygen',
    cylinderIds: [give1, give2, take1, take2, clinic1, expired1].map((c) => c.id),
    source: 'Demo plant fill (Tank 2)',
    operator: 'u-ops',
    fillOperator: 'Demo Shift A Operator',
    status: 'released',
    createdAt: `${before(9)}T05:00:00.000Z`,
    releasedAt: `${before(9)}T08:00:00.000Z`,
    releasedBy: 'u-quality',
    certificate: 'DEMO-QC-5',
    qualityNotes: 'Synthetic quality release (demo data, not a real certificate)',
  };
  // DEMO-BATCH-006: filled this morning by Operations; waits for Quality to release it.
  const awaitingBatch: Batch = {
    id: 'batch-6',
    number: 'DEMO-BATCH-006',
    branchId: 'b-delhi',
    gas: 'Medical oxygen',
    cylinderIds: [load1.id, load2.id],
    source: 'Demo plant fill (Tank 3)',
    operator: 'u-ops',
    fillOperator: 'Demo Shift A Operator',
    status: 'awaiting_release',
    createdAt: hoursAgo(3),
    rejectedCylinderIds: [hold1.id],
  };
  batches.push(tracedBatch, awaitingBatch);
  for (const c of [give1, give2, take1, take2, clinic1, expired1]) {
    c.batchId = tracedBatch.id;
    anchorMove(c, 'fill', 'plant:b-delhi', 'plant:b-delhi', tracedBatch.createdAt, 'u-ops', tracedBatch.id, 'Synthetic plant fill');
  }
  for (const c of [load1, load2, hold1]) {
    c.batchId = awaitingBatch.id;
    anchorMove(c, 'fill', 'plant:b-delhi', 'plant:b-delhi', awaitingBatch.createdAt, 'u-ops', awaitingBatch.id, 'Synthetic plant fill');
  }
  // Quality pulled DEMO-HOLD-1 out of the batch (same effect as the batch.reject command).
  const holdAt = hoursAgo(2.5);
  anchorMove(hold1, 'batch_reject', 'plant:b-delhi', 'plant:b-delhi', holdAt, 'u-quality', awaitingBatch.id, 'Valve leak suspected at seal check (synthetic)');
  hold1.batchId = undefined;
  hold1.condition = 'quarantine';
  hold1.contents = 'unknown';
  anchorExceptions.push(
    {
      id: 'ex-seed-2',
      at: holdAt,
      type: 'quality_hold',
      summary: 'DEMO-HOLD-1 on hold: valve leak suspected at seal check. Do not load until Quality clears it.',
      entityId: hold1.id,
      status: 'open',
      branchId: 'b-delhi',
    },
    {
      id: 'ex-seed-3',
      at: `${before(1)}T03:30:00.000Z`,
      type: 'test_overdue',
      summary: 'DEMO-EXPIRED-1 test date has passed. Send for hydrotest; dispatch is blocked.',
      entityId: expired1.id,
      status: 'open',
      branchId: 'b-delhi',
    },
  );
  anchorAudit.push({
    id: 'audit-demo-hold',
    at: holdAt,
    actorId: 'u-quality',
    actorName: 'Demo Quality',
    action: 'batch.reject',
    entityId: awaitingBatch.id,
    summary: `${hold1.serial} rejected from ${awaitingBatch.number}: valve leak suspected`,
  });
  // DEMO-SUP-1/2 are with the hydrotest supplier (same effect as supplier.send).
  for (const c of [sup1, sup2]) {
    anchorMove(c, 'supplier_send', 'plant:b-delhi', 'supplier:p-supplier-1', `${before(4)}T06:00:00.000Z`, 'u-ops', 'DEMO-SEND-001', 'test: periodic hydrotest due soon');
    c.custody = 'supplier';
    c.custodianId = 'p-supplier-1';
    c.contents = 'unknown';
    c.condition = 'inspection_due';
  }
  anchorAudit.push({
    id: 'audit-demo-supplier-send',
    at: `${before(4)}T06:00:00.000Z`,
    actorId: 'u-ops',
    actorName: 'Demo Operations',
    action: 'supplier.send',
    entityId: 'p-supplier-1',
    summary: 'DEMO-SEND-001: 2 cylinders sent for periodic hydrotest',
  });

  const routeDispatchAt = hoursAgo(2);
  orders.push(
    {
      id: 'o-delivered-2',
      number: 'DEMO-ORD-005',
      partyId: 'p-hospital-3',
      branchId: 'b-delhi',
      gas: 'Medical oxygen',
      size: 'B',
      quantity: 2,
      priority: 'normal',
      dueDate: before(8),
      notes: 'Demo ward replenishment',
      unitPricePaise: 148000,
      status: 'delivered',
      cylinderIds: [take1.id, take2.id],
      deliveredIds: [take1.id, take2.id],
      vehicle: 'DL 02 DEMO',
      driverId: 'u-driver',
      createdAt: `${before(9)}T09:00:00.000Z`,
      recipient: 'Demo Stores Pharmacist',
      deliveredAt: `${before(8)}T07:00:00.000Z`,
      deliveryProofs: [
        {
          cylinderIds: [take1.id, take2.id],
          recipient: 'Demo Stores Pharmacist',
          at: `${before(8)}T07:00:00.000Z`,
          actorId: 'u-driver',
          notes: 'Synthetic delivery proof',
        },
      ],
    },
    {
      id: 'o-delivered-3',
      number: 'DEMO-ORD-006',
      partyId: 'p-clinic-1',
      branchId: 'b-delhi',
      gas: 'Medical oxygen',
      size: 'B',
      quantity: 1,
      priority: 'normal',
      dueDate: before(7),
      notes: 'Demo clinic standby cylinder',
      unitPricePaise: 150000,
      status: 'delivered',
      cylinderIds: [clinic1.id],
      deliveredIds: [clinic1.id],
      vehicle: 'DL 02 DEMO',
      driverId: 'u-driver',
      createdAt: `${before(8)}T11:00:00.000Z`,
      recipient: 'Demo Clinic Manager',
      deliveredAt: `${before(7)}T06:30:00.000Z`,
      deliveryProofs: [
        {
          cylinderIds: [clinic1.id],
          recipient: 'Demo Clinic Manager',
          at: `${before(7)}T06:30:00.000Z`,
          actorId: 'u-driver',
          notes: 'Synthetic delivery proof',
        },
      ],
    },
    {
      id: 'o-route-1',
      number: 'DEMO-ORD-007',
      partyId: 'p-clinic-1',
      branchId: 'b-delhi',
      gas: 'Medical oxygen',
      size: 'B',
      quantity: 2,
      priority: 'normal',
      dueDate: date,
      notes: 'Demo clinic top-up, on the truck now',
      unitPricePaise: 150000,
      status: 'dispatched',
      cylinderIds: [give1.id, give2.id],
      deliveredIds: [],
      vehicle: 'DL 02 DEMO',
      driverId: 'u-driver',
      createdAt: `${before(1)}T10:30:00.000Z`,
    },
    {
      id: 'o-open-3',
      number: 'DEMO-ORD-008',
      partyId: 'p-hospital-3',
      branchId: 'b-delhi',
      gas: 'Medical oxygen',
      size: 'B',
      quantity: 2,
      priority: 'normal',
      dueDate: date,
      notes: 'Demo ward replenishment, 2 x size B',
      unitPricePaise: 148000,
      status: 'open',
      cylinderIds: [],
      deliveredIds: [],
      vehicle: '',
      driverId: '',
      createdAt: `${before(1)}T13:00:00.000Z`,
    },
  );
  for (const [c, orderId, partyId] of [
    [take1, 'o-delivered-2', 'p-hospital-3'],
    [take2, 'o-delivered-2', 'p-hospital-3'],
    [clinic1, 'o-delivered-3', 'p-clinic-1'],
    [give1, 'o-route-1', ''],
    [give2, 'o-route-1', ''],
  ] as const) {
    const order = orders.find((o) => o.id === orderId)!;
    const dispatchedAt = partyId ? `${order.deliveredAt!.slice(0, 10)}T04:30:00.000Z` : routeDispatchAt;
    anchorMove(c, 'dispatch', 'plant:b-delhi', `vehicle:${order.id}`, dispatchedAt, 'u-ops', order.id, 'Synthetic route manifest');
    c.custody = 'vehicle';
    c.custodianId = order.id;
    if (!partyId) continue;
    anchorMove(c, 'delivery', `vehicle:${order.id}`, `customer:${partyId}`, order.deliveredAt!, 'u-driver', order.id, 'Synthetic delivery proof', tracedBatch.id);
    c.custody = 'customer';
    c.custodianId = partyId;
    const party = parties.find((p) => p.id === partyId)!;
    rentals.push({
      id: `r-${c.id}`,
      cylinderId: c.id,
      partyId,
      orderId,
      start: order.deliveredAt!.slice(0, 10),
      dailyRatePaise: party.dailyRentalPaise,
      freeDays: party.freeDays,
    });
  }
  anchorAudit.push({
    id: 'audit-demo-route-dispatch',
    at: routeDispatchAt,
    actorId: 'u-ops',
    actorName: 'Demo Operations',
    action: 'order.dispatch',
    entityId: 'o-route-1',
    summary: 'DEMO-ORD-007: 2 cylinders loaded on DL 02 DEMO for the demo driver',
  });

  for (const order of orders.filter((o) => o.cylinderIds.length)) {
    const party = parties.find((p) => p.id === order.partyId)!;
    order.challanSnapshot = {
      issuer: {
        companyName: 'Batra Oxygen — Demo',
        address: 'Synthetic demonstration address, Delhi NCR',
        gstin: 'DEMO-GSTIN',
      },
      recipient: { name: party.name, address: party.address, city: party.city, gstin: party.gstin },
    };
  }
  const invoices: Invoice[] = [
    {
      id: 'inv-seed-1',
      number: 'DEMO-INV-001',
      partyId: 'p-hospital-1',
      branchId: 'b-delhi',
      type: 'gas',
      sourceId: 'o-delivered-1',
      issuedAt: `${before(5)}T10:00:00.000Z`,
      dueDate: after(25),
      lines: [
        {
          description: 'Medical oxygen B delivery DEMO-ORD-001',
          quantity: 2,
          unitPricePaise: 145000,
          amountPaise: 290000,
        },
      ],
      subtotalPaise: 290000,
      taxBps: 1200,
      taxPaise: 34800,
      totalPaise: 324800,
      paidPaise: 0,
      status: 'issued',
      notes: 'Synthetic demonstration invoice',
    },
    {
      id: 'inv-seed-2',
      number: 'DEMO-INV-002',
      partyId: 'p-home-1',
      branchId: 'b-delhi',
      type: 'gas',
      sourceId: 'demo-historical-home',
      issuedAt: `${before(20)}T10:00:00.000Z`,
      dueDate: after(10),
      lines: [
        {
          description: 'Historical demo oxygen delivery',
          quantity: 1,
          unitPricePaise: 155000,
          amountPaise: 155000,
        },
      ],
      subtotalPaise: 155000,
      taxBps: 1200,
      taxPaise: 18600,
      totalPaise: 173600,
      paidPaise: 50000,
      status: 'partial',
      notes: 'Synthetic demonstration invoice',
    },
    {
      id: 'inv-seed-3',
      number: 'DEMO-INV-003',
      partyId: 'p-hospital-2',
      branchId: 'b-faridabad',
      type: 'rental',
      sourceId: `rental:${before(30)}:${before(15)}`,
      issuedAt: `${before(14)}T10:00:00.000Z`,
      dueDate: after(16),
      lines: [
        {
          description: 'Historical demo cylinder rental',
          quantity: 10,
          unitPricePaise: 16000,
          amountPaise: 160000,
        },
      ],
      subtotalPaise: 160000,
      taxBps: 1200,
      taxPaise: 19200,
      totalPaise: 179200,
      paidPaise: 179200,
      status: 'paid',
      notes: 'Synthetic demonstration invoice',
    },
  ];
  // Anchor: the district hospital's earlier delivery (DEMO-ORD-005), billed and part paid.
  invoices.push({
    id: 'inv-seed-4',
    number: 'DEMO-INV-004',
    partyId: 'p-hospital-3',
    branchId: 'b-delhi',
    type: 'gas',
    sourceId: 'o-delivered-2',
    issuedAt: `${before(7)}T10:00:00.000Z`,
    dueDate: after(23),
    lines: [
      {
        description: 'Medical oxygen B delivery DEMO-ORD-005',
        quantity: 2,
        unitPricePaise: 148000,
        amountPaise: 296000,
      },
    ],
    subtotalPaise: 296000,
    taxBps: 1200,
    taxPaise: 35520,
    totalPaise: 331520,
    paidPaise: 100000,
    status: 'partial',
    notes: 'Synthetic demonstration invoice',
  });
  for (const invoice of invoices) {
    const party = parties.find((p) => p.id === invoice.partyId)!;
    invoice.billTo = {
      name: party.name,
      address: party.address,
      city: party.city,
      gstin: party.gstin,
    };
    invoice.issuer = {
      companyName: 'Batra Oxygen — Demo',
      address: 'Synthetic demonstration address, Delhi NCR',
      gstin: 'DEMO-GSTIN',
    };
  }
  const receipts: Receipt[] = [
    {
      id: 'receipt-seed-1',
      number: 'DEMO-RCPT-001',
      partyId: 'p-home-1',
      invoiceId: 'inv-seed-2',
      amountPaise: 50000,
      method: 'bank',
      reference: 'DEMO-UTR-001',
      at: `${before(10)}T12:00:00.000Z`,
      actorId: 'u-finance',
      kind: 'payment',
    },
    {
      id: 'receipt-seed-2',
      number: 'DEMO-RCPT-002',
      partyId: 'p-hospital-2',
      invoiceId: 'inv-seed-3',
      amountPaise: 179200,
      method: 'bank',
      reference: 'DEMO-UTR-002',
      at: `${before(7)}T12:00:00.000Z`,
      actorId: 'u-finance',
      kind: 'payment',
    },
    {
      id: 'receipt-seed-3',
      number: 'DEMO-RCPT-003',
      partyId: 'p-home-1',
      amountPaise: 350000,
      method: 'upi',
      reference: 'DEMO-DEP-001',
      at: `${before(7)}T12:00:00.000Z`,
      actorId: 'u-finance',
      kind: 'deposit',
    },
  ];
  receipts.push({
    id: 'receipt-seed-4',
    number: 'DEMO-RCPT-004',
    partyId: 'p-hospital-3',
    invoiceId: 'inv-seed-4',
    amountPaise: 100000,
    method: 'bank',
    reference: 'DEMO-UTR-004',
    at: `${before(3)}T12:00:00.000Z`,
    actorId: 'u-finance',
    kind: 'payment',
  });
  const audit: AuditEvent[] = [
    {
      id: 'audit-seed-1',
      at: timestamp,
      actorId: 'u-admin',
      actorName: 'Demo Administrator',
      action: 'demo.seed',
      entityId: '',
      summary: 'Synthetic demonstration state created; no real customer or patient records',
    },
    ...anchorAudit,
  ];
  for (const batch of batches) {
    audit.push({
      id: `audit-${batch.id}`,
      at: batch.releasedAt ?? batch.createdAt,
      actorId: batch.releasedBy ?? batch.operator,
      actorName: batch.releasedBy ? 'Demo Quality' : 'Demo Operations',
      action: batch.releasedBy ? 'batch.release' : 'batch.create',
      entityId: batch.id,
      summary: batch.releasedBy
        ? `${batch.number} released after synthetic quality review`
        : `${batch.number} awaits synthetic quality review`,
    });
  }
  for (const order of orders) {
    audit.push({
      id: `audit-${order.id}`,
      at: order.deliveredAt ?? order.createdAt,
      actorId: order.deliveredAt ? 'u-driver' : 'u-ops',
      actorName: order.deliveredAt ? 'Demo Driver' : 'Demo Operations',
      action: order.deliveredAt ? 'order.deliver' : 'order.create',
      entityId: order.id,
      summary: `${order.number}: ${order.status} synthetic order`,
    });
  }
  for (const invoice of invoices) {
    audit.push({
      id: `audit-${invoice.id}`,
      at: invoice.issuedAt,
      actorId: 'u-finance',
      actorName: 'Demo Finance',
      action: 'finance.invoice',
      entityId: invoice.id,
      summary: `${invoice.number} issued for synthetic account`,
    });
  }
  for (const cylinderId of ['c-001', 'c-002', 'c-003', 'c-004']) {
    const order = cylinderId === 'c-001' || cylinderId === 'c-002' ? orders[0] : orders[1];
    const cylinder = cylinders.find((item) => item.id === cylinderId)!;
    movements.push({
      id: `m-dispatch-${cylinderId}`,
      cylinderId,
      action: 'dispatch',
      from: `plant:${cylinder.branchId}`,
      to: `vehicle:${order.id}`,
      at: order.createdAt,
      actorId: 'u-ops',
      actorName: 'Demo Operations',
      reference: order.id,
      notes: 'Synthetic route manifest',
    });
    if (order.deliveredIds.includes(cylinderId)) {
      movements.push({
        id: `m-delivery-${cylinderId}`,
        cylinderId,
        action: 'delivery',
        from: `vehicle:${order.id}`,
        to: `customer:${order.partyId}`,
        at: order.deliveredAt!,
        actorId: 'u-driver',
        actorName: 'Demo Driver',
        reference: order.id,
        notes: 'Synthetic delivery proof',
        before: { batchId: cylinder.batchId },
      });
    }
  }
  audit.sort((a, b) => b.at.localeCompare(a.at));
  movements.sort((a, b) => b.at.localeCompare(a.at));
  return {
    revision: 1,
    settings: {
      companyName: 'Batra Oxygen — Demo',
      address: 'Synthetic demonstration address, Delhi NCR',
      gstin: 'DEMO-GSTIN',
      defaultTaxBps: 1200,
      mode: 'demo',
    },
    branches,
    cylinders,
    parties,
    orders,
    batches,
    movements,
    rentals,
    invoices,
    receipts,
    audit,
    pickups: [],
    exceptions: [
      {
        id: 'ex-seed-1',
        at: timestamp,
        type: 'inspection_due',
        summary: 'Demo inspection queue includes cylinders awaiting review',
        entityId: 'c-047',
        status: 'open',
      },
      ...anchorExceptions,
    ],
  };
}
