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
    { id: 'b-delhi', name: 'Delhi Plant & Distribution', city: 'Delhi' },
    { id: 'b-faridabad', name: 'Faridabad Distribution', city: 'Faridabad' },
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
      name: 'Demo Home Oxygen Service B',
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
      name: 'Demo Precision Fabricators',
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
      name: 'Demo Cylinder Service Works',
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
      name: 'Demo Filled Oxygen Supply',
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
    ],
  };
}
