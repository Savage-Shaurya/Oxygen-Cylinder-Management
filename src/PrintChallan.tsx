import { Printer } from '@phosphor-icons/react';
import type { AppState, Order } from '../shared/types';

export default function PrintChallan({ order, state }: { order: Order; state: AppState }) {
  function print() {
    const page = window.open('', '_blank', 'width=900,height=900');
    if (!page) {
      window.alert('Allow the print window, then select Print challan again.');
      return;
    }
    page.opener = null;
    const doc = page.document;
    doc.title = `Challan ${order.number}`;
    const style = doc.createElement('style');
    style.textContent =
      'body{font:14px Arial,sans-serif;color:#20322a;margin:42px}header{border-bottom:3px solid #126b57;display:flex;justify-content:space-between;padding-bottom:24px}h1{font-size:24px;margin:0 0 8px}h2{font-size:18px}p{line-height:1.5}table{width:100%;border-collapse:collapse;margin:28px 0}td,th{border-bottom:1px solid #dce3df;padding:12px;text-align:left}th{font-size:12px;text-transform:uppercase}.muted{color:#65736c}.signatures{display:flex;justify-content:space-between;margin:60px 0 30px}.demo{padding:12px;background:#fff3d8;border:1px solid #e2c789}@media print{@page{size:A4;margin:14mm}body{margin:0}}';
    doc.head.append(style);
    const text = (tag: string, value: string, parent: HTMLElement = doc.body) => {
      const el = doc.createElement(tag);
      el.textContent = value;
      parent.append(el);
      return el;
    };
    const header = doc.createElement('header');
    doc.body.append(header);
    const brand = doc.createElement('div');
    header.append(brand);
    const issuer = order.challanSnapshot?.issuer;
    text('h1', issuer?.companyName || 'Historical issuer unavailable', brand);
    if (issuer?.address) text('div', issuer.address, brand);
    if (issuer?.gstin) text('p', `GSTIN: ${issuer.gstin}`, brand);
    const reference = doc.createElement('div');
    header.append(reference);
    text('h2', 'Delivery challan', reference);
    text('strong', order.number, reference);
    text('p', 'Copy of the recorded delivery manifest', reference);
    if (state.settings.mode === 'demo')
      text('p', 'DEMONSTRATION · Synthetic data · Not for commercial or statutory use').className =
        'demo';
    if (!order.challanSnapshot)
      text('p', 'Historical identity snapshot unavailable for this legacy challan. The issuer and customer details at dispatch cannot be verified from this record.').className = 'demo';
    const party = order.challanSnapshot?.recipient;
    text('h2', party?.name || 'Historical customer unavailable');
    if (party?.address || party?.city)
      text('p', `${party?.address || ''}${party?.city ? `, ${party.city}` : ''}`);
    if (party?.gstin) text('p', `Customer GSTIN: ${party.gstin}`);
    text(
      'p',
      `Gas: ${order.gas} · Cylinder size: ${order.size} · Vehicle: ${order.vehicle || 'Not assigned'}`,
    );
    text(
      'p',
      `Recipient recorded: ${order.recipient || 'Awaiting acceptance'} · Order status: ${order.status}`,
    );
    const table = doc.createElement('table');
    doc.body.append(table);
    const heading = doc.createElement('tr');
    table.append(heading);
    for (const name of ['No.', 'Cylinder serial', 'Identifier', 'Movement outcome'])
      text('th', name, heading);
    order.cylinderIds.forEach((id, i) => {
      const c = state.cylinders.find((c) => c.id === id);
      const row = doc.createElement('tr');
      table.append(row);
      for (const value of [
        String(i + 1),
        c?.serial || id,
        c?.tag || '—',
        order.deliveredIds.includes(id)
          ? 'Accepted'
          : order.unloadedIds?.includes(id)
            ? 'Unloaded at plant'
            : 'On vehicle',
      ])
        text('td', value, row);
    });
    text(
      'strong',
      `${order.quantity} requested · ${order.cylinderIds.length} dispatched · ${order.deliveredIds.length} accepted · ${order.unloadedIds?.length || 0} unloaded`,
    );
    for (const proof of order.deliveryProofs || []) {
      text(
        'p',
        `Accepted ${proof.cylinderIds.length} cylinder(s) by ${proof.recipient} on ${new Date(proof.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST${proof.notes ? ` · ${proof.notes}` : ''}`,
      );
    }
    if (order.notes) text('p', `Order notes: ${order.notes}`);
    const signatures = doc.createElement('div');
    signatures.className = 'signatures';
    doc.body.append(signatures);
    text('div', 'Delivered by: ____________________', signatures);
    text('div', 'Received by: ____________________', signatures);
    text(
      'p',
      'This challan records cylinder movement. It is not a tax invoice, e-way bill, safety certificate or confirmation of payment.',
    ).className = 'muted';
    text(
      'p',
      `Printed ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`,
    ).className = 'muted';
    page.focus();
    page.print();
  }
  return (
    <button
      type="button"
      className="btn button"
      disabled={!order.cylinderIds.length}
      onClick={print}
    >
      <Printer size={17} /> Print challan
    </button>
  );
}
