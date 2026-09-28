import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decimalHundredths,
  invoiceBalance,
  unbilledOrder,
  rentalPeriod,
} from '../src/finance-view';
import type { Invoice } from '../shared/types';
test('decimal conversion does not round invalid fractional money', () => {
  assert.equal(decimalHundredths('12500.50'), 1250050);
  assert.equal(decimalHundredths('0.29'), 29);
  for (const value of ['1.005', '0.015', '1e3', '-1', 'Infinity'])
    assert.throws(() => decimalHundredths(value));
});
test('credit documents carry no receivable and credited delivery can be reissued', () => {
  const original = {
    type: 'gas',
    status: 'credited',
    sourceId: 'o',
    totalPaise: 100,
    paidPaise: 0,
  } as Invoice;
  assert.equal(invoiceBalance(original), 0);
  assert.equal(unbilledOrder([original], 'o'), true);
  assert.equal(invoiceBalance({ ...original, type: 'credit', status: 'issued' }), 0);
  assert.equal(unbilledOrder([{ ...original, status: 'issued' }], 'o'), false);
});
test('rental defaults use closed dates and resume after issued period', () => {
  assert.deepEqual(rentalPeriod('2026-03-31', []), { start: '2026-02-01', end: '2026-03-30' });
  assert.deepEqual(
    rentalPeriod(
      '2026-10-28',
      [
        {
          type: 'rental',
          status: 'issued',
          partyId: 'p',
          sourceId: 'rental:2026-09-01:2026-09-30',
        } as Invoice,
      ],
      'p',
    ),
    { start: '2026-10-01', end: '2026-10-27' },
  );
});
