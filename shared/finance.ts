import type { AppState, Invoice } from './types.js';

export function invoiceOutstanding(invoice: Invoice): number {
  if (invoice.type === 'credit') return 0;
  if (invoice.status === 'credited' && invoice.creditedPaise === undefined) return 0;
  return Math.max(0, invoice.totalPaise - invoice.paidPaise - (invoice.creditedPaise ?? 0) - (invoice.appliedCreditPaise ?? 0));
}

export function depositBalance(state: AppState, partyId: string): number {
  return state.receipts.filter(r => r.partyId === partyId).reduce((balance, r) =>
    balance + (r.kind === 'deposit' ? r.amountPaise : r.kind === 'refund' ? -r.amountPaise : 0), 0);
}

export function creditNoteAvailable(state: AppState, creditInvoiceId: string): number {
  const note = state.invoices.find(i => i.id === creditInvoiceId && i.type === 'credit');
  if (!note) return 0;
  const used = state.receipts.filter(r => r.creditInvoiceId === note.id && !r.reversedAt && (r.kind === 'credit_refund' || r.kind === 'credit_allocation')).reduce((n, r) => n + r.amountPaise, 0);
  return Math.max(0, note.totalPaise - (note.creditOffsetPaise ?? note.totalPaise) - used);
}

export function availableCredit(state: AppState, partyId: string): number {
  return state.invoices.filter(i => i.partyId === partyId && i.type === 'credit').reduce((n, i) => n + creditNoteAvailable(state, i.id), 0);
}
