/**
 * Export to Tally: builds a TallyPrime XML import file (masters + accounting vouchers) from
 * Cylvero finance records. Pure, no I/O. Money stays in integer paise (BigInt) until it is
 * formatted as rupees with two decimals; floats are never used for amounts.
 *
 * Sources relied on (official Tally help):
 * - https://help.tallysolutions.com/sample-xml/
 *     ENVELOPE / HEADER / TALLYREQUEST "Import Data" / BODY / IMPORTDATA / REQUESTDESC /
 *     REPORTNAME ("All Masters") / REQUESTDATA / TALLYMESSAGE xmlns:UDF="TallyUDF";
 *     LEDGER Action="Create" with NAME + PARENT (mandatory; PARENT must be an existing group),
 *     MAILINGNAME.LIST, ADDRESS.LIST TYPE="String", LEDSTATENAME, COUNTRYNAME;
 *     VOUCHER with DATE as YYYYMMDD, VOUCHERTYPENAME, VOUCHERNUMBER, PERSISTEDVIEW
 *     ("Accounting Voucher View"), ISINVOICE, ledger entries with LEDGERNAME,
 *     ISDEEMEDPOSITIVE (Yes = debit), ISPARTYLEDGER, AMOUNT (debit negative, credit positive),
 *     BILLALLOCATIONS.LIST with NAME / BILLTYPE / AMOUNT; permitted BILLTYPE values are
 *     "Advance", "Agst Ref", "New Ref", "On Account"; the error "Voucher totals do not match!"
 *     is returned when debits and credits differ, so every voucher here sums to exactly 0.
 * - https://help.tallysolutions.com/xml-integration/ (and /xml-message-formats):
 *     STATICVARIABLES / SVCURRENTCOMPANY, REPORTNAME "Vouchers", VOUCHER VCHTYPE + ACTION.
 * - https://help.tallysolutions.com/scenario-2/  (Receipt voucher: ALLLEDGERENTRIES.LIST,
 *     party credited with a positive amount, cash/bank ISDEEMEDPOSITIVE Yes, amount * -1).
 * - https://help.tallysolutions.com/docs/faqs/faq/faq-import-and-export.htm
 *     REMOTEID on VOUCHER is the voucher's identity: importing again with the same id
 *     overwrites the existing voucher when "Overwrite vouchers during import" is Yes (F12
 *     General configuration); with No, a repeat import may create a duplicate. Tally asks
 *     third-party tools to "generate unique Voucher ID for each and every voucher".
 * - https://help.tallysolutions.com/how-to-import-data-from-xml-into-tallyprime-tallyhelp/
 *     Alt+O Import > Masters / Transactions; "Behaviour of import if master already exists"
 *     (Combine opening balance / Ignore duplicates / Modify with new data) is masters-only.
 * - https://help.tallysolutions.com/what-are-the-changes-in-xml-tags/ (Release 3.0 storage
 *     names: Ledger TaxType, GSTDutyHead; voucher StateName, PlaceOfSupply, PartyGSTIN).
 *
 * Uncertain points, using the most widely documented form:
 * - Ledger GST fields: PARTYGSTIN / GSTREGISTRATIONTYPE / LEDSTATENAME are the long-standing
 *   flat ledger tags. TallyPrime 3.0+ stores them in LEDGSTREGDETAILS.LIST; Tally keeps the
 *   flat tags importable, but if a Release 3+ company ignores them, enter GSTIN in Tally.
 *   Only well-formed GSTINs are exported; GSTREGISTRATIONTYPE is sent only as "Regular".
 * - GSTDUTYHEAD values "Central Tax" / "State Tax" / "Integrated Tax" are TallyPrime's labels.
 * - Masters and vouchers can share one file (REPORTNAME "Vouchers" when vouchers are
 *   included); import it under Masters first, then under Transactions.
 * - Agst Ref to a bill created in an earlier export (outside the date range) relies on that
 *   earlier period having been imported already.
 *
 * Accounting mapping (party = customer ledger under Sundry Debtors, bill-wise on):
 *   gas / rental invoice  -> Sales:       Dr party (total, New Ref <invoice no>)
 *                                         Cr sales or rental income (subtotal)
 *                                         Cr CGST + SGST (intra-state) or IGST (inter-state)
 *   credit note           -> Credit Note: Dr sales returns (subtotal), Dr the same tax ledgers
 *                                         Cr party (total: Agst Ref original invoice for the
 *                                         part that reduced its balance, New Ref <CN no> for
 *                                         the rest, which is customer credit)
 *   payment               -> Receipt:     Dr cash / bank / UPI, Cr party (Agst Ref invoice)
 *   deposit               -> Receipt:     Dr cash / bank / UPI, Cr security deposits (liability)
 *   deposit refund        -> Payment:     Dr security deposits, Cr cash / bank / UPI
 *   credit refund         -> Payment:     Dr party (Agst Ref <CN no>), Cr cash / bank / UPI
 *   credit allocation and its reversal -> skipped and listed: they move credit from one bill of
 *     the same customer to another, so the party balance and every ledger total is unchanged.
 *     Tally would need the same party debited and credited in one voucher; the accountant
 *     can adjust the bills in Tally if bill-wise ageing matters.
 *   reversed receipts (only credit allocations can be reversed today) -> skipped and listed.
 * Tax: intra-state when the supplier GSTIN state equals the buyer's; a buyer without a valid
 * GSTIN (and a supplier without one) counts as the same state. CGST gets the odd paisa
 * (ceil of half), SGST the floor. SGST also covers UTGST for Union Territories.
 */
import type { AppState, Invoice, Party, Receipt, Role } from '../shared/types.js';

export interface TallyLedgerNames {
  salesGas: string;
  salesRental: string;
  cgst: string;
  sgst: string;
  igst: string;
  cash: string;
  bank: string;
  upi: string;
  deposits: string;
  creditNotes: string;
}
export interface TallyExportOptions {
  /** Exact Tally company name; defaults to settings.companyName. */
  companyName?: string;
  /** Inclusive India (Asia/Kolkata) dates, YYYY-MM-DD. */
  from: string;
  to: string;
  ledgers?: Partial<TallyLedgerNames>;
  includeMasters?: boolean;
  includeVouchers?: boolean;
}
export interface TallySkipped {
  id: string;
  number: string;
  kind: string;
  reason: string;
}
export interface TallySummary {
  companyName: string;
  from: string;
  to: string;
  counts: {
    ledgers: number;
    vouchers: number;
    sales: number;
    creditNotes: number;
    receipts: number;
    deposits: number;
    depositRefunds: number;
    creditRefunds: number;
    skipped: number;
  };
  totals: {
    /** Gas + rental invoice totals (incl. tax). */
    salesPaise: number;
    salesTaxPaise: number;
    creditNotesPaise: number;
    receiptsPaise: number;
    depositsPaise: number;
    depositRefundsPaise: number;
    creditRefundsPaise: number;
  };
  skipped: TallySkipped[];
  warnings: string[];
}
export interface TallyExportResult {
  xml: string;
  summary: TallySummary;
}

export const DEFAULT_TALLY_LEDGERS: Readonly<Omit<TallyLedgerNames, 'upi'>> = {
  salesGas: 'Sales - Medical Oxygen',
  salesRental: 'Cylinder Rental Income',
  cgst: 'Output CGST',
  sgst: 'Output SGST',
  igst: 'Output IGST',
  cash: 'Cash',
  bank: 'Bank Account',
  deposits: 'Cylinder Security Deposits',
  creditNotes: 'Sales Returns',
};

/** GST state code (first two GSTIN digits) -> TallyPrime state name. */
export const GST_STATE_NAMES: Readonly<Record<string, string>> = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '25': 'Dadra & Nagar Haveli and Daman & Diu',
  '26': 'Dadra & Nagar Haveli and Daman & Diu',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
};

const GSTIN_PATTERN = /^(\d{2})[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const IST_OFFSET_MS = 330 * 60 * 1000;

/** Normalised GSTIN when it is well-formed with a known state code, else undefined. */
export function validGstin(raw: string | undefined): string | undefined {
  const gstin = (raw ?? '').trim().toUpperCase();
  const match = GSTIN_PATTERN.exec(gstin);
  return match && GST_STATE_NAMES[match[1]] ? gstin : undefined;
}
export function gstinState(raw: string | undefined): string | undefined {
  const gstin = validGstin(raw);
  return gstin ? GST_STATE_NAMES[gstin.slice(0, 2)] : undefined;
}
/** State code for comparison; 25 and 26 are the same merged UT. */
function stateCode(raw: string | undefined): string | undefined {
  const gstin = validGstin(raw);
  if (!gstin) return undefined;
  const code = gstin.slice(0, 2);
  return code === '25' ? '26' : code === '28' ? '37' : code;
}

export function isStrictDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    y >= 1900 &&
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/** India calendar date (YYYY-MM-DD) of an ISO timestamp; a bare date is returned as is. */
export function indiaDate(at: string): string | undefined {
  if (DATE_PATTERN.test(at)) return isStrictDate(at) ? at : undefined;
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Integer paise -> "1234.50" / "-1234.50". BigInt only, never float. */
export function rupees(paise: bigint | number): string {
  if (typeof paise === 'number' && !Number.isSafeInteger(paise))
    throw new Error('Amount must be whole paise');
  let p = BigInt(paise);
  const negative = p < 0n;
  if (negative) p = -p;
  const text = `${p / 100n}.${(p % 100n).toString().padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

// XML 1.0 forbids C0 controls except tab/LF/CR, plus U+FFFE/U+FFFF and lone surrogates.
const XML_ILLEGAL =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** One-line text: control characters removed, whitespace collapsed, trimmed. */
export function cleanText(value: unknown, max = 1000): string {
  return String(value ?? '')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(XML_ILLEGAL, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}
export function xmlEscape(value: unknown): string {
  return String(value ?? '')
    .replace(XML_ILLEGAL, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface Bill {
  name: string;
  type: 'New Ref' | 'Agst Ref' | 'On Account';
  /** Signed like the entry: debit negative. */
  amount: bigint;
}
interface Entry {
  ledger: string;
  /** Debit negative, credit positive (Tally convention). */
  amount: bigint;
  isParty?: boolean;
  bills?: Bill[];
}
interface Voucher {
  remoteId: string;
  type: 'Sales' | 'Receipt' | 'Payment' | 'Credit Note';
  date: string;
  number: string;
  partyLedger: string;
  narration: string;
  gst?: { partyGstin?: string; state?: string };
  entries: Entry[];
  sortKey: string;
}
interface LedgerMaster {
  name: string;
  parent: string;
  billWise?: boolean;
  taxDutyHead?: string;
  party?: { gstin?: string; state?: string; address: string[]; mailingName: string };
}

function resolveLedgers(input: Partial<TallyLedgerNames> | undefined): TallyLedgerNames {
  const pick = (key: keyof typeof DEFAULT_TALLY_LEDGERS) =>
    cleanText(input?.[key], 200) || DEFAULT_TALLY_LEDGERS[key];
  const bank = pick('bank');
  return {
    salesGas: pick('salesGas'),
    salesRental: pick('salesRental'),
    cgst: pick('cgst'),
    sgst: pick('sgst'),
    igst: pick('igst'),
    cash: pick('cash'),
    bank,
    upi: cleanText(input?.upi, 200) || bank,
    deposits: pick('deposits'),
    creditNotes: pick('creditNotes'),
  };
}

const big = (n: number) => BigInt(n);
const safeId = (id: string) => id.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 120);

export function buildTallyXml(state: AppState, options: TallyExportOptions): TallyExportResult {
  if (!isStrictDate(options.from) || !isStrictDate(options.to))
    throw new Error('From and to must be real dates in YYYY-MM-DD form');
  if (options.from > options.to) throw new Error('From date must not be after to date');
  const from = options.from;
  const to = options.to;
  const companyName =
    cleanText(options.companyName, 200) || cleanText(state.settings.companyName, 200);
  const ledgers = resolveLedgers(options.ledgers);
  const includeMasters = options.includeMasters ?? true;
  const includeVouchers = options.includeVouchers ?? true;
  const inRange = (at: string) => {
    const d = indiaDate(at);
    return d !== undefined && d >= from && d <= to;
  };

  const skipped: TallySkipped[] = [];
  const warnings = new Set<string>();
  const skip = (id: string, number: string, kind: string, reason: string) =>
    skipped.push({ id, number: cleanText(number, 100), kind, reason });

  // ---- Party ledger names: unique (Tally names are case-insensitive), never a system ledger.
  const reserved = new Set(Object.values(ledgers).map((n) => n.toLowerCase()));
  const partyById = new Map(state.parties.map((p) => [p.id, p]));
  const partyLedger = new Map<string, string>();
  const used = new Set<string>(reserved);
  const partyMasters = new Map<string, LedgerMaster>();
  function ledgerFor(partyId: string, fallback?: Invoice['billTo']): string {
    const existing = partyLedger.get(partyId);
    if (existing) return existing;
    const party: Party | undefined = partyById.get(partyId);
    const base = cleanText(party?.name ?? fallback?.name, 180) || `Customer ${safeId(partyId)}`;
    let name = base;
    if (used.has(name.toLowerCase())) name = `${base} (${safeId(partyId).slice(-8)})`;
    for (let n = 2; used.has(name.toLowerCase()); n++)
      name = `${base} (${safeId(partyId).slice(-8)}-${n})`;
    used.add(name.toLowerCase());
    partyLedger.set(partyId, name);
    const rawGstin = party?.gstin ?? fallback?.gstin ?? '';
    const gstin = validGstin(rawGstin);
    if (rawGstin.trim() && !gstin)
      warnings.add(
        `GSTIN "${cleanText(rawGstin, 30)}" of ${name} is not a valid GSTIN; exported without GSTIN.`,
      );
    partyMasters.set(partyId, {
      name,
      parent: 'Sundry Debtors',
      billWise: true,
      party: {
        gstin,
        state: gstinState(gstin),
        mailingName: cleanText(party?.name ?? fallback?.name, 180) || name,
        address: [party?.address ?? fallback?.address, party?.city ?? fallback?.city]
          .map((x) => cleanText(x, 200))
          .filter(Boolean),
      },
    });
    return name;
  }
  // Deterministic naming: customers in name/id order first.
  for (const p of [...state.parties]
    .filter((p) => p.type !== 'supplier')
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)))
    ledgerFor(p.id);

  const invoiceById = new Map(state.invoices.map((i) => [i.id, i]));
  const vouchers: Voucher[] = [];
  const counts = {
    sales: 0,
    creditNotes: 0,
    receipts: 0,
    deposits: 0,
    depositRefunds: 0,
    creditRefunds: 0,
  };
  const totals = {
    salesPaise: 0n,
    salesTaxPaise: 0n,
    creditNotesPaise: 0n,
    receiptsPaise: 0n,
    depositsPaise: 0n,
    depositRefundsPaise: 0n,
    creditRefundsPaise: 0n,
  };

  function taxEntries(inv: Invoice, sign: bigint): Entry[] {
    const tax = big(inv.taxPaise);
    if (tax === 0n) return [];
    const supplier = stateCode(inv.issuer?.gstin ?? state.settings.gstin);
    const buyer = stateCode(inv.billTo?.gstin ?? partyById.get(inv.partyId)?.gstin);
    if (!supplier)
      warnings.add('Supplier GSTIN is missing or invalid; tax exported as CGST + SGST.');
    const interState = supplier !== undefined && buyer !== undefined && supplier !== buyer;
    if (interState) return [{ ledger: ledgers.igst, amount: sign * tax }];
    const sgst = tax / 2n;
    const cgst = tax - sgst; // odd paisa goes to CGST
    return [
      { ledger: ledgers.cgst, amount: sign * cgst },
      { ledger: ledgers.sgst, amount: sign * sgst },
    ].filter((e) => e.amount !== 0n);
  }
  function gstHeader(inv: Invoice) {
    const gstin = validGstin(inv.billTo?.gstin ?? partyById.get(inv.partyId)?.gstin);
    return { partyGstin: gstin, state: gstinState(gstin) };
  }
  function moneyLedger(r: Receipt): string | undefined {
    return r.method === 'cash'
      ? ledgers.cash
      : r.method === 'bank'
        ? ledgers.bank
        : r.method === 'upi'
          ? ledgers.upi
          : undefined;
  }
  function amountsOk(inv: Invoice): boolean {
    return (
      [inv.subtotalPaise, inv.taxPaise, inv.totalPaise].every(
        (n) => Number.isSafeInteger(n) && n >= 0,
      ) && big(inv.subtotalPaise) + big(inv.taxPaise) === big(inv.totalPaise)
    );
  }

  // ---- Invoices and credit notes.
  for (const inv of state.invoices) {
    if (!inRange(inv.issuedAt)) continue;
    const kind = inv.type === 'credit' ? 'credit_note' : `${inv.type}_invoice`;
    if (!amountsOk(inv)) {
      skip(
        inv.id,
        inv.number,
        kind,
        'Subtotal plus tax does not equal the total; fix in Cylvero first.',
      );
      continue;
    }
    if (inv.totalPaise === 0) {
      skip(inv.id, inv.number, kind, 'Zero amount; nothing to post.');
      continue;
    }
    const party = ledgerFor(inv.partyId, inv.billTo);
    const date = indiaDate(inv.issuedAt)!;
    const number = cleanText(inv.number, 100);
    const total = big(inv.totalPaise);
    if (inv.type === 'credit') {
      const original = inv.creditedInvoiceId ? invoiceById.get(inv.creditedInvoiceId) : undefined;
      const offset = big(Math.min(inv.creditOffsetPaise ?? inv.totalPaise, inv.totalPaise));
      const bills: Bill[] = [];
      if (original && offset > 0n)
        bills.push({ name: cleanText(original.number, 100), type: 'Agst Ref', amount: offset });
      const rest = total - (original ? offset : 0n);
      if (rest > 0n) bills.push({ name: number, type: 'New Ref', amount: rest });
      vouchers.push({
        remoteId: `cylvero-credit-note-${safeId(inv.id)}`,
        type: 'Credit Note',
        date,
        number,
        partyLedger: party,
        narration: cleanText(
          `Credit note ${number}${original ? ` against ${original.number}` : ''}${inv.notes ? `: ${inv.notes}` : ''}`,
          500,
        ),
        gst: gstHeader(inv),
        entries: [
          { ledger: party, amount: total, isParty: true, bills },
          { ledger: ledgers.creditNotes, amount: -big(inv.subtotalPaise) },
          ...taxEntries(inv, -1n),
        ].filter((e) => e.amount !== 0n),
        sortKey: `${date}|2|${number}|${inv.id}`,
      });
      counts.creditNotes++;
      totals.creditNotesPaise += total;
      continue;
    }
    vouchers.push({
      remoteId: `cylvero-invoice-${safeId(inv.id)}`,
      type: 'Sales',
      date,
      number,
      partyLedger: party,
      narration: cleanText(
        `${inv.type === 'rental' ? 'Cylinder rental' : 'Gas'} invoice ${number}${inv.lines.length ? `: ${inv.lines.map((l) => l.description).join('; ')}` : ''}`,
        500,
      ),
      gst: gstHeader(inv),
      entries: [
        {
          ledger: party,
          amount: -total,
          isParty: true,
          bills: [{ name: number, type: 'New Ref' as const, amount: -total }],
        },
        {
          ledger: inv.type === 'rental' ? ledgers.salesRental : ledgers.salesGas,
          amount: big(inv.subtotalPaise),
        },
        ...taxEntries(inv, 1n),
      ].filter((e) => e.amount !== 0n),
      sortKey: `${date}|1|${number}|${inv.id}`,
    });
    counts.sales++;
    totals.salesPaise += total;
    totals.salesTaxPaise += big(inv.taxPaise);
  }

  // ---- Receipts (payments, deposits, refunds, credit refunds).
  for (const r of state.receipts) {
    if (!inRange(r.at)) continue;
    const number = cleanText(r.number, 100);
    if (r.kind === 'credit_allocation') {
      skip(
        r.id,
        r.number,
        r.kind,
        r.reversedAt
          ? 'Credit allocation that was later reversed; no ledger effect.'
          : 'Credit allocation only moves customer credit between bills of the same customer; ledger balances are unchanged. Adjust bills in Tally if needed.',
      );
      continue;
    }
    if (r.reversedAt) {
      skip(r.id, r.number, r.kind, 'Reversed in Cylvero; not posted.');
      continue;
    }
    if (!Number.isSafeInteger(r.amountPaise) || r.amountPaise <= 0) {
      skip(r.id, r.number, r.kind, 'Amount is not a positive whole number of paise.');
      continue;
    }
    const money = moneyLedger(r);
    if (!money) {
      skip(r.id, r.number, r.kind, `Unsupported payment method "${cleanText(r.method, 20)}".`);
      continue;
    }
    const amount = big(r.amountPaise);
    const date = indiaDate(r.at)!;
    const party = ledgerFor(r.partyId);
    const ref = r.reference ? ` (ref ${r.reference})` : '';
    const base = { date, number, remoteId: `cylvero-receipt-${safeId(r.id)}` };
    if (r.kind === 'payment') {
      const inv = r.invoiceId ? invoiceById.get(r.invoiceId) : undefined;
      const bill: Bill = inv
        ? { name: cleanText(inv.number, 100), type: 'Agst Ref', amount }
        : { name: number, type: 'On Account', amount };
      if (!inv) warnings.add(`Receipt ${number}: invoice not found; posted On Account.`);
      vouchers.push({
        ...base,
        type: 'Receipt',
        partyLedger: party,
        narration: cleanText(
          `Payment ${number} for ${inv?.number ?? 'account'} by ${r.method}${ref}`,
          500,
        ),
        entries: [
          { ledger: party, amount, isParty: true, bills: [bill] },
          { ledger: money, amount: -amount },
        ],
        sortKey: `${date}|3|${number}|${r.id}`,
      });
      counts.receipts++;
      totals.receiptsPaise += amount;
    } else if (r.kind === 'deposit') {
      vouchers.push({
        ...base,
        type: 'Receipt',
        partyLedger: ledgers.deposits,
        narration: cleanText(
          `Cylinder security deposit ${number} from ${party} by ${r.method}${ref}`,
          500,
        ),
        entries: [
          { ledger: ledgers.deposits, amount },
          { ledger: money, amount: -amount },
        ],
        sortKey: `${date}|4|${number}|${r.id}`,
      });
      counts.deposits++;
      totals.depositsPaise += amount;
    } else if (r.kind === 'refund') {
      vouchers.push({
        ...base,
        type: 'Payment',
        partyLedger: ledgers.deposits,
        narration: cleanText(
          `Security deposit refund ${number} to ${party} by ${r.method}${ref}${r.reason ? `: ${r.reason}` : ''}`,
          500,
        ),
        entries: [
          { ledger: ledgers.deposits, amount: -amount },
          { ledger: money, amount },
        ],
        sortKey: `${date}|5|${number}|${r.id}`,
      });
      counts.depositRefunds++;
      totals.depositRefundsPaise += amount;
    } else if (r.kind === 'credit_refund') {
      const note = r.creditInvoiceId ? invoiceById.get(r.creditInvoiceId) : undefined;
      const bill: Bill = note
        ? { name: cleanText(note.number, 100), type: 'Agst Ref', amount: -amount }
        : { name: number, type: 'On Account', amount: -amount };
      vouchers.push({
        ...base,
        type: 'Payment',
        partyLedger: party,
        narration: cleanText(
          `Refund of customer credit ${number}${note ? ` from ${note.number}` : ''} by ${r.method}${ref}${r.reason ? `: ${r.reason}` : ''}`,
          500,
        ),
        entries: [
          { ledger: party, amount: -amount, isParty: true, bills: [bill] },
          { ledger: money, amount },
        ],
        sortKey: `${date}|6|${number}|${r.id}`,
      });
      counts.creditRefunds++;
      totals.creditRefundsPaise += amount;
    } else {
      skip(r.id, r.number, String(r.kind), 'Unknown receipt kind.');
    }
  }

  // Every voucher must balance exactly; bill allocations must equal their entry.
  for (const v of vouchers) {
    const sum = v.entries.reduce((n, e) => n + e.amount, 0n);
    if (sum !== 0n) throw new Error(`Voucher ${v.number} does not balance (${rupees(sum)})`);
    for (const e of v.entries)
      if (e.bills && e.bills.reduce((n, b) => n + b.amount, 0n) !== e.amount)
        throw new Error(`Voucher ${v.number} bill allocations do not match ${e.ledger}`);
  }
  vouchers.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));

  // ---- Masters: supporting ledgers, then customers (only when vouchers or masters needed).
  const supporting: LedgerMaster[] = [
    { name: ledgers.salesGas, parent: 'Sales Accounts' },
    { name: ledgers.salesRental, parent: 'Sales Accounts' },
    { name: ledgers.creditNotes, parent: 'Sales Accounts' },
    { name: ledgers.cgst, parent: 'Duties & Taxes', taxDutyHead: 'Central Tax' },
    { name: ledgers.sgst, parent: 'Duties & Taxes', taxDutyHead: 'State Tax' },
    { name: ledgers.igst, parent: 'Duties & Taxes', taxDutyHead: 'Integrated Tax' },
    { name: ledgers.cash, parent: 'Cash-in-Hand' },
    { name: ledgers.bank, parent: 'Bank Accounts' },
    { name: ledgers.upi, parent: 'Bank Accounts' },
    { name: ledgers.deposits, parent: 'Current Liabilities' },
  ];
  const masters: LedgerMaster[] = [];
  if (includeMasters) {
    const seen = new Set<string>();
    for (const m of supporting) {
      if (seen.has(m.name.toLowerCase())) continue;
      seen.add(m.name.toLowerCase());
      masters.push(m);
    }
    masters.push(...[...partyMasters.values()].sort((a, b) => a.name.localeCompare(b.name)));
  }

  const xml = renderEnvelope(companyName, masters, includeVouchers ? vouchers : []);
  const n = (x: bigint) => Number(x);
  return {
    xml,
    summary: {
      companyName,
      from,
      to,
      counts: {
        ledgers: masters.length,
        vouchers: includeVouchers ? vouchers.length : 0,
        ...counts,
        skipped: skipped.length,
      },
      totals: {
        salesPaise: n(totals.salesPaise),
        salesTaxPaise: n(totals.salesTaxPaise),
        creditNotesPaise: n(totals.creditNotesPaise),
        receiptsPaise: n(totals.receiptsPaise),
        depositsPaise: n(totals.depositsPaise),
        depositRefundsPaise: n(totals.depositRefundsPaise),
        creditRefundsPaise: n(totals.creditRefundsPaise),
      },
      skipped,
      warnings: [...warnings],
    },
  };
}

function tag(name: string, value: string, indent: string): string {
  return `${indent}<${name}>${xmlEscape(value)}</${name}>`;
}
function renderLedger(m: LedgerMaster): string {
  const i = '     ';
  const lines = [`    <LEDGER NAME="${xmlEscape(m.name)}" ACTION="Create">`];
  if (m.party) {
    lines.push(`${i}<MAILINGNAME.LIST TYPE="String">`);
    lines.push(tag('MAILINGNAME', m.party.mailingName, `${i} `));
    lines.push(`${i}</MAILINGNAME.LIST>`);
    if (m.party.address.length) {
      lines.push(`${i}<ADDRESS.LIST TYPE="String">`);
      for (const a of m.party.address) lines.push(tag('ADDRESS', a, `${i} `));
      lines.push(`${i}</ADDRESS.LIST>`);
    }
  }
  lines.push(tag('NAME', m.name, i));
  lines.push(tag('PARENT', m.parent, i));
  if (m.billWise !== undefined) lines.push(tag('ISBILLWISEON', m.billWise ? 'Yes' : 'No', i));
  if (m.taxDutyHead) {
    lines.push(tag('TAXTYPE', 'GST', i));
    lines.push(tag('GSTDUTYHEAD', m.taxDutyHead, i));
  }
  if (m.party) {
    lines.push(tag('COUNTRYNAME', 'India', i));
    if (m.party.state) lines.push(tag('LEDSTATENAME', m.party.state, i));
    if (m.party.gstin) {
      lines.push(tag('GSTREGISTRATIONTYPE', 'Regular', i));
      lines.push(tag('PARTYGSTIN', m.party.gstin, i));
    }
  }
  lines.push('    </LEDGER>');
  return lines.join('\n');
}
function renderVoucher(v: Voucher): string {
  const i = '     ';
  const lines = [
    `    <VOUCHER REMOTEID="${xmlEscape(v.remoteId)}" VCHTYPE="${xmlEscape(v.type)}" ACTION="Create" OBJVIEW="Accounting Voucher View">`,
    tag('DATE', v.date.replace(/-/g, ''), i),
    tag('VOUCHERTYPENAME', v.type, i),
    tag('VOUCHERNUMBER', v.number, i),
    tag('PARTYLEDGERNAME', v.partyLedger, i),
  ];
  if (v.gst?.partyGstin) lines.push(tag('PARTYGSTIN', v.gst.partyGstin, i));
  if (v.gst?.state) {
    lines.push(tag('STATENAME', v.gst.state, i));
    lines.push(tag('PLACEOFSUPPLY', v.gst.state, i));
  }
  lines.push(tag('PERSISTEDVIEW', 'Accounting Voucher View', i));
  lines.push(tag('ISINVOICE', 'No', i));
  if (v.narration) lines.push(tag('NARRATION', v.narration, i));
  for (const e of v.entries) {
    lines.push(`${i}<ALLLEDGERENTRIES.LIST>`);
    lines.push(tag('LEDGERNAME', e.ledger, `${i} `));
    lines.push(tag('ISDEEMEDPOSITIVE', e.amount < 0n ? 'Yes' : 'No', `${i} `));
    lines.push(tag('ISPARTYLEDGER', e.isParty ? 'Yes' : 'No', `${i} `));
    lines.push(tag('AMOUNT', rupees(e.amount), `${i} `));
    for (const b of e.bills ?? []) {
      lines.push(`${i} <BILLALLOCATIONS.LIST>`);
      lines.push(tag('NAME', b.name, `${i}  `));
      lines.push(tag('BILLTYPE', b.type, `${i}  `));
      lines.push(tag('AMOUNT', rupees(b.amount), `${i}  `));
      lines.push(`${i} </BILLALLOCATIONS.LIST>`);
    }
    lines.push(`${i}</ALLLEDGERENTRIES.LIST>`);
  }
  lines.push('    </VOUCHER>');
  return lines.join('\n');
}
function renderEnvelope(company: string, masters: LedgerMaster[], vouchers: Voucher[]): string {
  const messages = [...masters.map(renderLedger), ...vouchers.map(renderVoucher)].map(
    (body) => `   <TALLYMESSAGE xmlns:UDF="TallyUDF">\n${body}\n   </TALLYMESSAGE>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ENVELOPE>',
    ' <HEADER>',
    '  <TALLYREQUEST>Import Data</TALLYREQUEST>',
    ' </HEADER>',
    ' <BODY>',
    '  <IMPORTDATA>',
    '   <REQUESTDESC>',
    `    <REPORTNAME>${vouchers.length ? 'Vouchers' : 'All Masters'}</REPORTNAME>`,
    '    <STATICVARIABLES>',
    `     <SVCURRENTCOMPANY>${xmlEscape(company)}</SVCURRENTCOMPANY>`,
    '    </STATICVARIABLES>',
    '   </REQUESTDESC>',
    '   <REQUESTDATA>',
    ...messages,
    '   </REQUESTDATA>',
    '  </IMPORTDATA>',
    ' </BODY>',
    '</ENVELOPE>',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------
// HTTP contract helpers (wired by the caller into server/http-app.ts).

export const TALLY_EXPORT_ROLES: readonly Role[] = ['admin', 'finance', 'auditor'];
export const TALLY_LEDGER_KEYS = [
  'salesGas',
  'salesRental',
  'cgst',
  'sgst',
  'igst',
  'cash',
  'bank',
  'upi',
  'deposits',
  'creditNotes',
] as const satisfies readonly (keyof TallyLedgerNames)[];
const NAME_MAX = 100;
// Letters, marks, digits, spaces, dashes, connectors and common accounting punctuation.
const SAFE_NAME = /^[\p{L}\p{M}\p{N}\p{Zs}\p{Pd}\p{Pc}&().,'’\/+@#:;!%*[\]]+$/u;
const QUERY_KEYS = new Set<string>([
  'company',
  'from',
  'to',
  'masters',
  'vouchers',
  ...TALLY_LEDGER_KEYS,
]);
const MAX_RANGE_DAYS = 3660;

export type TallyQueryResult =
  { ok: true; options: TallyExportOptions } | { ok: false; error: string };

function safeName(label: string, raw: unknown): { value?: string; error?: string } {
  if (raw === undefined) return {};
  if (typeof raw !== 'string') return { error: `${label} must be a single value` };
  const value = raw.trim();
  if (!value) return {};
  if (value.length > NAME_MAX) return { error: `${label} must be at most ${NAME_MAX} characters` };
  if (!SAFE_NAME.test(value))
    return { error: `${label} contains characters Tally names cannot use` };
  return { value: value.replace(/\s+/g, ' ') };
}
function flag(label: string, raw: unknown): { value?: boolean; error?: string } {
  if (raw === undefined) return {};
  if (raw === '1' || raw === 'true' || raw === 'yes') return { value: true };
  if (raw === '0' || raw === 'false' || raw === 'no') return { value: false };
  return { error: `${label} must be 1 or 0` };
}

/** Validates GET /api/export/tally query parameters into builder options. */
export function parseTallyQuery(query: unknown): TallyQueryResult {
  if (!query || typeof query !== 'object' || Array.isArray(query))
    return { ok: false, error: 'Query parameters are required' };
  const q = query as Record<string, unknown>;
  for (const key of Object.keys(q))
    if (!QUERY_KEYS.has(key))
      return { ok: false, error: `Unknown parameter "${key.slice(0, 40)}"` };
  const from = q.from;
  const to = q.to;
  if (typeof from !== 'string' || !isStrictDate(from))
    return { ok: false, error: 'from must be a real date in YYYY-MM-DD form' };
  if (typeof to !== 'string' || !isStrictDate(to))
    return { ok: false, error: 'to must be a real date in YYYY-MM-DD form' };
  if (from > to) return { ok: false, error: 'from must not be after to' };
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > MAX_RANGE_DAYS)
    return { ok: false, error: 'Date range is too long; export at most ten years at a time' };
  const company = safeName('Company name', q.company);
  if (company.error) return { ok: false, error: company.error };
  const ledgerNames: Partial<TallyLedgerNames> = {};
  for (const key of TALLY_LEDGER_KEYS) {
    const name = safeName(`Ledger name ${key}`, q[key]);
    if (name.error) return { ok: false, error: name.error };
    if (name.value) ledgerNames[key] = name.value;
  }
  const masters = flag('masters', q.masters);
  if (masters.error) return { ok: false, error: masters.error };
  const vouchers = flag('vouchers', q.vouchers);
  if (vouchers.error) return { ok: false, error: vouchers.error };
  if (masters.value === false && vouchers.value === false)
    return { ok: false, error: 'Choose masters, vouchers or both' };
  return {
    ok: true,
    options: {
      companyName: company.value,
      from,
      to,
      ledgers: ledgerNames,
      includeMasters: masters.value ?? true,
      includeVouchers: vouchers.value ?? true,
    },
  };
}

export interface TallyHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * GET /api/export/tally. Pass the state ALREADY scoped to the user's branches (scopedState in
 * http-app.ts is module-private), the signed-in user's role, and req.query.
 */
export function tallyExportResponse(
  scopedState: AppState,
  user: { role: Role },
  query: unknown,
): TallyHttpResponse {
  const json = (status: number, error: string): TallyHttpResponse => ({
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ error }),
  });
  if (!TALLY_EXPORT_ROLES.includes(user.role)) return json(403, 'Forbidden');
  const parsed = parseTallyQuery(query);
  if (!parsed.ok) return json(400, parsed.error);
  const { xml, summary } = buildTallyXml(scopedState, parsed.options);
  return {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${tallyFileName(parsed.options.from, parsed.options.to)}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Tally-Vouchers': String(summary.counts.vouchers),
      'X-Tally-Skipped': String(summary.counts.skipped),
    },
    body: xml,
  };
}
export function tallyFileName(from: string, to: string): string {
  return `cylvero-tally-${from}-${to}.xml`;
}
