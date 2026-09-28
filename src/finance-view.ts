import type { Invoice } from '../shared/types';
import { invoiceOutstanding } from '../shared/finance';

export function decimalHundredths(value: unknown): number {
  const input = String(value ?? '').trim() || '0';
  if (!/^\d+(\.\d{1,2})?$/.test(input))
    throw new Error('Enter a positive amount with at most two decimal places.');
  const [whole, fraction = ''] = input.split('.');
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('This amount is too large.');
  return Number(result);
}
export const invoiceBalance = invoiceOutstanding;
export const unbilledOrder = (invoices: Invoice[], orderId: string) =>
  !invoices.some((i) => i.type === 'gas' && i.sourceId === orderId && i.status !== 'credited');
export function rentalPeriod(day: string, invoices: Invoice[], partyId?: string) {
  const end = new Date(`${day}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  const previousMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1, 12));
  const issuedEnds = invoices
    .filter(
      (i) =>
        i.type === 'rental' &&
        i.status !== 'credited' &&
        i.partyId === partyId &&
        i.sourceId.startsWith('rental:'),
    )
    .map((i) => i.sourceId.split(':')[2])
    .sort();
  const last = issuedEnds.at(-1);
  const start = last ? new Date(`${last}T12:00:00Z`) : previousMonth;
  if (last) start.setUTCDate(start.getUTCDate() + 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}
