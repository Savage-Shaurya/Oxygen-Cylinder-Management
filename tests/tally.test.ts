import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { AppState, Invoice, Party, Receipt } from '../shared/types.js';
import { createSeedState } from '../server/seed.js';
import {
  buildTallyXml,
  indiaDate,
  parseTallyQuery,
  rupees,
  tallyExportResponse,
  xmlEscape,
} from '../server/tally.js';

const window = new JSDOM('').window;
function parse(xml: string): Document {
  const doc = new window.DOMParser().parseFromString(xml, 'application/xml');
  const error = doc.getElementsByTagName('parsererror')[0];
  assert.equal(error, undefined, `XML is not well-formed: ${error?.textContent}`);
  return doc;
}
const kids = (el: Element, name: string) =>
  Array.from(el.children).filter((c) => c.tagName === name);
const text = (el: Element, name: string) => kids(el, name)[0]?.textContent ?? '';
const vouchers = (doc: Document) => Array.from(doc.getElementsByTagName('VOUCHER'));
const byNumber = (doc: Document, n: string) =>
  vouchers(doc).find((v) => text(v, 'VOUCHERNUMBER') === n) ?? assert.fail(`no voucher ${n}`);
/** Rupee text -> paise, exactly (no float). */
function paise(value: string): bigint {
  const m = /^(-?)(\d+)\.(\d{2})$/.exec(value);
  assert.ok(m, `bad amount ${value}`);
  const n = BigInt(m[2]) * 100n + BigInt(m[3]);
  return m[1] ? -n : n;
}
function entries(v: Element) {
  return kids(v, 'ALLLEDGERENTRIES.LIST').map((e) => ({
    ledger: text(e, 'LEDGERNAME'),
    amount: paise(text(e, 'AMOUNT')),
    deemedPositive: text(e, 'ISDEEMEDPOSITIVE'),
    bills: kids(e, 'BILLALLOCATIONS.LIST').map((b) => ({
      name: text(b, 'NAME'),
      type: text(b, 'BILLTYPE'),
      amount: paise(text(b, 'AMOUNT')),
    })),
  }));
}
function assertBalanced(doc: Document) {
  for (const v of vouchers(doc)) {
    const list = entries(v);
    assert.ok(list.length >= 2);
    assert.equal(
      list.reduce((n, e) => n + e.amount, 0n),
      0n,
      `${text(v, 'VOUCHERNUMBER')} unbalanced`,
    );
    for (const e of list) {
      assert.equal(e.deemedPositive, e.amount < 0n ? 'Yes' : 'No');
      if (e.bills.length)
        assert.equal(
          e.bills.reduce((n, b) => n + b.amount, 0n),
          e.amount,
        );
    }
  }
}

const SUPPLIER = '07AABCB1234C1Z5'; // Delhi
function party(id: string, name: string, gstin: string): Party {
  return {
    id,
    name,
    type: 'hospital',
    contact: '',
    phone: '',
    address: 'Main Road',
    city: 'Delhi',
    gstin,
    branchId: 'b1',
    creditLimitPaise: 0,
    dailyRentalPaise: 0,
    freeDays: 0,
    depositPaise: 0,
  };
}
function invoice(p: Partial<Invoice> & Pick<Invoice, 'id' | 'number' | 'partyId'>): Invoice {
  const subtotal = p.subtotalPaise ?? 100000;
  const tax = p.taxPaise ?? 12000;
  return {
    branchId: 'b1',
    type: 'gas',
    sourceId: 'o1',
    issuedAt: '2026-10-05T06:00:00.000Z',
    dueDate: '2026-11-05',
    lines: [
      {
        description: 'Medical oxygen',
        quantity: 1,
        unitPricePaise: subtotal,
        amountPaise: subtotal,
      },
    ],
    subtotalPaise: subtotal,
    taxBps: 1200,
    taxPaise: tax,
    totalPaise: subtotal + tax,
    paidPaise: 0,
    status: 'issued',
    notes: '',
    issuer: { companyName: 'Supplier', address: '', gstin: SUPPLIER },
    ...p,
  };
}
function receipt(
  p: Partial<Receipt> & Pick<Receipt, 'id' | 'number' | 'partyId' | 'kind'>,
): Receipt {
  return {
    amountPaise: 50000,
    method: 'bank',
    reference: 'UTR',
    at: '2026-10-06T06:00:00.000Z',
    actorId: 'u1',
    ...p,
  };
}
function baseState(invoices: Invoice[] = [], receipts: Receipt[] = []): AppState {
  return {
    revision: 1,
    settings: {
      companyName: 'Batra Oxygen',
      address: '',
      gstin: SUPPLIER,
      defaultTaxBps: 1200,
      mode: 'live',
    },
    branches: [{ id: 'b1', name: 'Delhi', city: 'Delhi' }],
    cylinders: [],
    parties: [
      party('p-delhi', 'Delhi Hospital', '07AAACD1111A1Z1'),
      party('p-hr', 'Haryana Hospital', '06AAACH2222B1Z2'),
      party('p-none', 'Home Care Patient', ''),
    ],
    orders: [],
    batches: [],
    movements: [],
    rentals: [],
    invoices,
    receipts,
    audit: [],
    exceptions: [],
  };
}
const RANGE = { from: '2026-10-01', to: '2026-10-31' };

test('rupee formatting is exact from integer paise', () => {
  assert.equal(rupees(0), '0.00');
  assert.equal(rupees(5), '0.05');
  assert.equal(rupees(-324800), '-3248.00');
  assert.equal(rupees(2 ** 52), '45035996273704.96');
  assert.throws(() => rupees(1.5));
});

test('output is well-formed XML with the Tally import envelope', () => {
  const state = baseState([invoice({ id: 'i1', number: 'GINV-1', partyId: 'p-delhi' })]);
  const { xml } = buildTallyXml(state, RANGE);
  const doc = parse(xml);
  const root = doc.documentElement;
  assert.equal(root.tagName, 'ENVELOPE');
  assert.equal(doc.getElementsByTagName('TALLYREQUEST')[0].textContent, 'Import Data');
  assert.equal(doc.getElementsByTagName('REPORTNAME')[0].textContent, 'Vouchers');
  assert.equal(doc.getElementsByTagName('SVCURRENTCOMPANY')[0].textContent, 'Batra Oxygen');
  const ledger = Array.from(doc.getElementsByTagName('LEDGER')).find(
    (l) => l.getAttribute('NAME') === 'Delhi Hospital',
  )!;
  assert.equal(text(ledger, 'PARENT'), 'Sundry Debtors');
  assert.equal(text(ledger, 'ISBILLWISEON'), 'Yes');
  assert.equal(text(ledger, 'PARTYGSTIN'), '07AAACD1111A1Z1');
  assert.equal(text(ledger, 'LEDSTATENAME'), 'Delhi');
  assert.equal(text(ledger, 'GSTREGISTRATIONTYPE'), 'Regular');
  const unregistered = Array.from(doc.getElementsByTagName('LEDGER')).find(
    (l) => l.getAttribute('NAME') === 'Home Care Patient',
  )!;
  assert.equal(kids(unregistered, 'PARTYGSTIN').length, 0);
  const masters = buildTallyXml(state, { ...RANGE, includeVouchers: false });
  assert.equal(parse(masters.xml).getElementsByTagName('REPORTNAME')[0].textContent, 'All Masters');
  assert.equal(parse(masters.xml).getElementsByTagName('VOUCHER').length, 0);
});

test('a Sales voucher has the exact expected structure', () => {
  const state = baseState([invoice({ id: 'inv-1', number: 'GINV-0001', partyId: 'p-delhi' })]);
  const { xml } = buildTallyXml(state, RANGE);
  const start = xml.indexOf('    <VOUCHER ');
  const end = xml.indexOf('</VOUCHER>', start) + '</VOUCHER>'.length;
  assert.equal(
    xml.slice(start, end),
    [
      '    <VOUCHER REMOTEID="cylvero-invoice-inv-1" VCHTYPE="Sales" ACTION="Create" OBJVIEW="Accounting Voucher View">',
      '     <DATE>20261005</DATE>',
      '     <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>',
      '     <VOUCHERNUMBER>GINV-0001</VOUCHERNUMBER>',
      '     <PARTYLEDGERNAME>Delhi Hospital</PARTYLEDGERNAME>',
      '     <PARTYGSTIN>07AAACD1111A1Z1</PARTYGSTIN>',
      '     <STATENAME>Delhi</STATENAME>',
      '     <PLACEOFSUPPLY>Delhi</PLACEOFSUPPLY>',
      '     <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>',
      '     <ISINVOICE>No</ISINVOICE>',
      '     <NARRATION>Gas invoice GINV-0001: Medical oxygen</NARRATION>',
      '     <ALLLEDGERENTRIES.LIST>',
      '      <LEDGERNAME>Delhi Hospital</LEDGERNAME>',
      '      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>',
      '      <ISPARTYLEDGER>Yes</ISPARTYLEDGER>',
      '      <AMOUNT>-1120.00</AMOUNT>',
      '      <BILLALLOCATIONS.LIST>',
      '       <NAME>GINV-0001</NAME>',
      '       <BILLTYPE>New Ref</BILLTYPE>',
      '       <AMOUNT>-1120.00</AMOUNT>',
      '      </BILLALLOCATIONS.LIST>',
      '     </ALLLEDGERENTRIES.LIST>',
      '     <ALLLEDGERENTRIES.LIST>',
      '      <LEDGERNAME>Sales - Medical Oxygen</LEDGERNAME>',
      '      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>',
      '      <ISPARTYLEDGER>No</ISPARTYLEDGER>',
      '      <AMOUNT>1000.00</AMOUNT>',
      '     </ALLLEDGERENTRIES.LIST>',
      '     <ALLLEDGERENTRIES.LIST>',
      '      <LEDGERNAME>Output CGST</LEDGERNAME>',
      '      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>',
      '      <ISPARTYLEDGER>No</ISPARTYLEDGER>',
      '      <AMOUNT>60.00</AMOUNT>',
      '     </ALLLEDGERENTRIES.LIST>',
      '     <ALLLEDGERENTRIES.LIST>',
      '      <LEDGERNAME>Output SGST</LEDGERNAME>',
      '      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>',
      '      <ISPARTYLEDGER>No</ISPARTYLEDGER>',
      '      <AMOUNT>60.00</AMOUNT>',
      '     </ALLLEDGERENTRIES.LIST>',
      '    </VOUCHER>',
    ].join('\n'),
  );
});

test('intra-state splits CGST/SGST with the odd paisa on CGST; inter-state uses IGST', () => {
  const state = baseState([
    invoice({
      id: 'a',
      number: 'INTRA',
      partyId: 'p-delhi',
      subtotalPaise: 100001,
      taxPaise: 12001,
    }),
    invoice({ id: 'b', number: 'INTER', partyId: 'p-hr', type: 'rental' }),
    invoice({ id: 'c', number: 'NOGST', partyId: 'p-none' }),
  ]);
  const doc = parse(buildTallyXml(state, RANGE).xml);
  assertBalanced(doc);
  const intra = entries(byNumber(doc, 'INTRA'));
  assert.equal(intra.find((e) => e.ledger === 'Output CGST')!.amount, 6001n);
  assert.equal(intra.find((e) => e.ledger === 'Output SGST')!.amount, 6000n);
  assert.ok(!intra.some((e) => e.ledger === 'Output IGST'));
  const inter = entries(byNumber(doc, 'INTER'));
  assert.equal(inter.find((e) => e.ledger === 'Output IGST')!.amount, 12000n);
  assert.equal(inter.find((e) => e.ledger === 'Cylinder Rental Income')!.amount, 100000n);
  assert.ok(!inter.some((e) => e.ledger === 'Output CGST'));
  const none = entries(byNumber(doc, 'NOGST'));
  assert.ok(none.some((e) => e.ledger === 'Output CGST'));
  assert.ok(!none.some((e) => e.ledger === 'Output IGST'));
});

test('text is escaped and control characters stripped', () => {
  assert.equal(xmlEscape(`a&b<c>"d'\u0001e`), 'a&amp;b&lt;c&gt;&quot;d&apos;e');
  const state = baseState([
    invoice({
      id: 'x"1',
      number: 'G&<1>',
      partyId: 'p-evil',
      notes: '',
      lines: [
        {
          description: 'O2 <b>"big"</b> & \u0007bell',
          quantity: 1,
          unitPricePaise: 100000,
          amountPaise: 100000,
        },
      ],
    }),
  ]);
  state.parties.push(party('p-evil', `Ram & Sons <"Pvt"> 'Ltd'\u0000\u001F\n`, ''));
  const { xml } = buildTallyXml(state, { ...RANGE, companyName: 'A&B <Co>' });
  assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(xml));
  const doc = parse(xml);
  const v = byNumber(doc, 'G&<1>');
  assert.equal(text(v, 'PARTYLEDGERNAME'), `Ram & Sons <"Pvt"> 'Ltd'`);
  assert.equal(v.getAttribute('REMOTEID'), 'cylvero-invoice-x_1');
  assert.ok(text(v, 'NARRATION').includes('O2 <b>"big"</b> & bell'));
  assert.equal(doc.getElementsByTagName('SVCURRENTCOMPANY')[0].textContent, 'A&B <Co>');
});

test('only records inside the India-date range are exported', () => {
  const state = baseState(
    [
      // 30 Sep 19:00 UTC is 1 Oct 00:30 IST: inside.
      invoice({ id: 'in', number: 'IN', partyId: 'p-delhi', issuedAt: '2026-09-30T19:00:00.000Z' }),
      // 30 Sep 18:00 UTC is 30 Sep 23:30 IST: outside.
      invoice({
        id: 'out',
        number: 'OUT',
        partyId: 'p-delhi',
        issuedAt: '2026-09-30T18:00:00.000Z',
      }),
      // 31 Oct 18:29 UTC is 31 Oct 23:59 IST: inside; 18:30 UTC is 1 Nov: outside.
      invoice({
        id: 'last',
        number: 'LAST',
        partyId: 'p-delhi',
        issuedAt: '2026-10-31T18:29:00.000Z',
      }),
      invoice({
        id: 'nov',
        number: 'NOV',
        partyId: 'p-delhi',
        issuedAt: '2026-10-31T18:30:00.000Z',
      }),
    ],
    [
      receipt({
        id: 'r',
        number: 'R-SEPT',
        partyId: 'p-delhi',
        kind: 'deposit',
        at: '2026-09-15T06:00:00Z',
      }),
    ],
  );
  const { xml, summary } = buildTallyXml(state, RANGE);
  const numbers = vouchers(parse(xml)).map((v) => text(v, 'VOUCHERNUMBER'));
  assert.deepEqual(numbers.sort(), ['IN', 'LAST']);
  assert.equal(text(byNumber(parse(xml), 'IN'), 'DATE'), '20261001');
  assert.equal(summary.counts.deposits, 0);
  assert.equal(indiaDate('2026-10-31T18:30:00.000Z'), '2026-11-01');
  assert.throws(() => buildTallyXml(state, { from: '2026-10-31', to: '2026-10-01' }));
  assert.throws(() => buildTallyXml(state, { from: '2026-02-30', to: '2026-03-01' }));
});

test('payments, deposits and refunds map to Receipt and Payment vouchers', () => {
  const inv = invoice({ id: 'i1', number: 'GINV-1', partyId: 'p-delhi' });
  const state = baseState(
    [inv],
    [
      receipt({
        id: 'r1',
        number: 'RCPT-1',
        partyId: 'p-delhi',
        kind: 'payment',
        invoiceId: 'i1',
        method: 'cash',
      }),
      receipt({
        id: 'r2',
        number: 'RCPT-2',
        partyId: 'p-delhi',
        kind: 'payment',
        invoiceId: 'i1',
        method: 'upi',
      }),
      receipt({
        id: 'd1',
        number: 'DEP-1',
        partyId: 'p-delhi',
        kind: 'deposit',
        amountPaise: 300000,
        method: 'bank',
      }),
      receipt({
        id: 'f1',
        number: 'DREF-1',
        partyId: 'p-delhi',
        kind: 'refund',
        amountPaise: 100000,
        method: 'cash',
        reason: 'returned',
      }),
    ],
  );
  const { xml, summary } = buildTallyXml(state, { ...RANGE, ledgers: { upi: 'UPI Collections' } });
  const doc = parse(xml);
  assertBalanced(doc);
  const pay = byNumber(doc, 'RCPT-1');
  assert.equal(pay.getAttribute('VCHTYPE'), 'Receipt');
  assert.deepEqual(entries(pay), [
    {
      ledger: 'Delhi Hospital',
      amount: 50000n,
      deemedPositive: 'No',
      bills: [{ name: 'GINV-1', type: 'Agst Ref', amount: 50000n }],
    },
    { ledger: 'Cash', amount: -50000n, deemedPositive: 'Yes', bills: [] },
  ]);
  assert.equal(entries(byNumber(doc, 'RCPT-2'))[1].ledger, 'UPI Collections');
  const dep = byNumber(doc, 'DEP-1');
  assert.equal(dep.getAttribute('VCHTYPE'), 'Receipt');
  assert.deepEqual(
    entries(dep).map((e) => [e.ledger, e.amount]),
    [
      ['Cylinder Security Deposits', 300000n],
      ['Bank Account', -300000n],
    ],
  );
  const ref = byNumber(doc, 'DREF-1');
  assert.equal(ref.getAttribute('VCHTYPE'), 'Payment');
  assert.equal(text(ref, 'VOUCHERTYPENAME'), 'Payment');
  assert.deepEqual(
    entries(ref).map((e) => [e.ledger, e.amount]),
    [
      ['Cylinder Security Deposits', -100000n],
      ['Cash', 100000n],
    ],
  );
  const depositLedger = Array.from(doc.getElementsByTagName('LEDGER')).find(
    (l) => l.getAttribute('NAME') === 'Cylinder Security Deposits',
  )!;
  assert.equal(text(depositLedger, 'PARENT'), 'Current Liabilities');
  assert.equal(summary.totals.depositsPaise, 300000);
  assert.equal(summary.totals.depositRefundsPaise, 100000);
  assert.equal(summary.totals.receiptsPaise, 100000);
  // UPI defaults to the bank ledger.
  const defaults = parse(buildTallyXml(state, RANGE).xml);
  assert.equal(entries(byNumber(defaults, 'RCPT-2'))[1].ledger, 'Bank Account');
});

test('credit notes reverse the invoice; allocations are skipped; credit refunds are Payments', () => {
  const original = invoice({
    id: 'i1',
    number: 'GINV-1',
    partyId: 'p-hr',
    issuedAt: '2026-09-20T06:00:00Z',
  });
  const note = invoice({
    id: 'cn1',
    number: 'CN-1',
    partyId: 'p-hr',
    type: 'credit',
    sourceId: 'i1',
    creditedInvoiceId: 'i1',
    subtotalPaise: 50000,
    taxPaise: 6000,
    totalPaise: 56000,
    creditOffsetPaise: 40000,
  });
  const state = baseState(
    [original, note],
    [
      receipt({
        id: 'a1',
        number: 'CALLOC-1',
        partyId: 'p-hr',
        kind: 'credit_allocation',
        method: 'credit',
        creditInvoiceId: 'cn1',
        invoiceId: 'i1',
        amountPaise: 5000,
      }),
      receipt({
        id: 'a2',
        number: 'CALLOC-2',
        partyId: 'p-hr',
        kind: 'credit_allocation',
        method: 'credit',
        creditInvoiceId: 'cn1',
        invoiceId: 'i1',
        amountPaise: 5000,
        reversedAt: '2026-10-07T00:00:00Z',
      }),
      receipt({
        id: 'c1',
        number: 'CREF-1',
        partyId: 'p-hr',
        kind: 'credit_refund',
        creditInvoiceId: 'cn1',
        amountPaise: 6000,
        method: 'bank',
      }),
    ],
  );
  const { xml, summary } = buildTallyXml(state, RANGE);
  const doc = parse(xml);
  assertBalanced(doc);
  const cn = byNumber(doc, 'CN-1');
  assert.equal(cn.getAttribute('VCHTYPE'), 'Credit Note');
  assert.deepEqual(entries(cn), [
    {
      ledger: 'Haryana Hospital',
      amount: 56000n,
      deemedPositive: 'No',
      bills: [
        { name: 'GINV-1', type: 'Agst Ref', amount: 40000n },
        { name: 'CN-1', type: 'New Ref', amount: 16000n },
      ],
    },
    { ledger: 'Sales Returns', amount: -50000n, deemedPositive: 'Yes', bills: [] },
    { ledger: 'Output IGST', amount: -6000n, deemedPositive: 'Yes', bills: [] },
  ]);
  const refund = byNumber(doc, 'CREF-1');
  assert.equal(refund.getAttribute('VCHTYPE'), 'Payment');
  assert.deepEqual(entries(refund)[0].bills, [{ name: 'CN-1', type: 'Agst Ref', amount: -6000n }]);
  assert.deepEqual(summary.skipped.map((s) => s.number).sort(), ['CALLOC-1', 'CALLOC-2']);
  assert.ok(summary.skipped.every((s) => s.reason.length > 10));
  assert.equal(summary.counts.creditNotes, 1);
  assert.equal(summary.totals.creditNotesPaise, 56000);
  assert.equal(summary.totals.creditRefundsPaise, 6000);
  // A legacy credit note without offset applies wholly against the original invoice.
  delete note.creditOffsetPaise;
  const legacy = entries(byNumber(parse(buildTallyXml(state, RANGE).xml), 'CN-1'))[0];
  assert.deepEqual(legacy.bills, [{ name: 'GINV-1', type: 'Agst Ref', amount: 56000n }]);
});

test('duplicate customer names and clashes with system ledgers get unique ledger names', () => {
  const state = baseState();
  state.parties.push(party('p-dup', 'delhi hospital', ''), party('p-cash', 'Cash', ''));
  const doc = parse(buildTallyXml(state, RANGE).xml);
  const names = Array.from(doc.getElementsByTagName('LEDGER')).map((l) =>
    text(l, 'NAME').toLowerCase(),
  );
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes('cash (p-cash)'));
});

test('seed state exports cleanly and totals match the records in range', () => {
  const now = '2026-10-11T08:00:00.000Z';
  const state = createSeedState(now);
  const range = { from: '2026-09-01', to: '2026-10-11' };
  const { xml, summary } = buildTallyXml(state, range);
  const doc = parse(xml);
  assertBalanced(doc);
  const inRange = (at: string) => {
    const d = indiaDate(at)!;
    return d >= range.from && d <= range.to;
  };
  const invoices = state.invoices.filter((i) => inRange(i.issuedAt) && i.type !== 'credit');
  const receipts = state.receipts.filter((r) => inRange(r.at));
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  assert.ok(invoices.length > 0 && receipts.length > 0);
  assert.equal(summary.counts.sales, invoices.length);
  assert.equal(summary.totals.salesPaise, sum(invoices.map((i) => i.totalPaise)));
  assert.equal(summary.totals.salesTaxPaise, sum(invoices.map((i) => i.taxPaise)));
  assert.equal(
    summary.totals.receiptsPaise,
    sum(receipts.filter((r) => r.kind === 'payment').map((r) => r.amountPaise)),
  );
  assert.equal(
    summary.totals.depositsPaise,
    sum(receipts.filter((r) => r.kind === 'deposit').map((r) => r.amountPaise)),
  );
  assert.equal(summary.counts.vouchers, invoices.length + receipts.length);
  assert.equal(vouchers(doc).length, summary.counts.vouchers);
  assert.equal(summary.counts.skipped, 0);
  // Every ledger used by a voucher is created in the same file.
  const masters = new Set(
    Array.from(doc.getElementsByTagName('LEDGER')).map((l) => text(l, 'NAME')),
  );
  for (const v of vouchers(doc))
    for (const e of entries(v)) assert.ok(masters.has(e.ledger), e.ledger);
  // Stable: the same input gives byte-identical output (same REMOTEIDs on re-import).
  assert.equal(buildTallyXml(state, range).xml, xml);
  const ids = vouchers(doc).map((v) => v.getAttribute('REMOTEID'));
  assert.equal(new Set(ids).size, ids.length);
});

test('parseTallyQuery validates strictly', () => {
  const ok = parseTallyQuery({
    from: '2026-10-01',
    to: '2026-10-31',
    company: 'Batra Oxygen — Demo',
    cash: 'Cash (Main)',
    masters: '0',
  });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.options.companyName, 'Batra Oxygen — Demo');
    assert.equal(ok.options.ledgers?.cash, 'Cash (Main)');
    assert.equal(ok.options.includeMasters, false);
    assert.equal(ok.options.includeVouchers, true);
  }
  const bad = (q: unknown) => assert.equal(parseTallyQuery(q).ok, false, JSON.stringify(q));
  bad(undefined);
  bad({ from: '2026-10-01' });
  bad({ from: '2026-1-01', to: '2026-10-31' });
  bad({ from: '2026-02-29', to: '2026-03-31' });
  bad({ from: '2026-10-31', to: '2026-10-01' });
  bad({ from: '2026-10-01', to: '2026-10-31', company: 'x'.repeat(101) });
  bad({ from: '2026-10-01', to: '2026-10-31', bank: '<script>' });
  bad({ from: '2026-10-01', to: '2026-10-31', bank: 'a\u0000b' });
  bad({ from: '2026-10-01', to: '2026-10-31', cash: ['a', 'b'] });
  bad({ from: '2026-10-01', to: '2026-10-31', masters: 'maybe' });
  bad({ from: '2026-10-01', to: '2026-10-31', masters: '0', vouchers: '0' });
  bad({ from: '2026-10-01', to: '2026-10-31', extra: '1' });
});

test('tallyExportResponse enforces roles and returns an XML attachment', () => {
  const state = baseState([invoice({ id: 'i1', number: 'GINV-1', partyId: 'p-delhi' })]);
  const query = { from: '2026-10-01', to: '2026-10-31' };
  for (const role of ['operations', 'quality', 'driver'] as const)
    assert.equal(tallyExportResponse(state, { role }, query).status, 403);
  assert.equal(tallyExportResponse(state, { role: 'finance' }, { from: 'x' }).status, 400);
  for (const role of ['admin', 'finance', 'auditor'] as const) {
    const res = tallyExportResponse(state, { role }, query);
    assert.equal(res.status, 200);
    assert.equal(res.headers['Content-Type'], 'application/xml; charset=utf-8');
    assert.equal(
      res.headers['Content-Disposition'],
      'attachment; filename="cylvero-tally-2026-10-01-2026-10-31.xml"',
    );
    parse(res.body);
  }
});
