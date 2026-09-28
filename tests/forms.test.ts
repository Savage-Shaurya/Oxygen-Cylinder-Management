import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  updateFormValues,
  declaredFormValues,
  friendlyFormError,
} from '../src/components/form-values';

test('changing branch on customer, supplier, registration and order forms adds no cylinder field', () => {
  for (const previous of [
    { name: 'Test customer', branchId: '' },
    { name: 'Test supplier', branchId: '' },
    { serial: 'TEST-01', gas: 'Medical oxygen', branchId: '' },
    { partyId: 'test-party', quantity: 2, branchId: '' },
  ]) {
    const fields = Object.keys(previous).map((name) => ({ name }));
    const result = updateFormValues(previous, 'branchId', 'b-delhi', fields);
    assert.deepEqual(result, { ...previous, branchId: 'b-delhi' });
  }
});

test('changing cylinder eligibility clears selections only on forms that contain them', () => {
  const previous = { partyId: 'old-party', cylinderIds: ['old-cylinder'], notes: 'Keep notes' };
  const fields = Object.keys(previous).map((name) => ({ name }));
  assert.deepEqual(updateFormValues(previous, 'partyId', 'new-party', fields), {
    partyId: 'new-party',
    cylinderIds: [],
    notes: 'Keep notes',
  });
  assert.deepEqual(updateFormValues(previous, 'notes', 'New note', fields), {
    ...previous,
    notes: 'New note',
  });
});

test('changing gas preserves selected supplier cylinders when their options remain eligible', () => {
  const previous = { supplierId: 's-1', cylinderIds: ['c-1'], gas: '' };
  const fields = [
    { name: 'supplierId' },
    { name: 'gas' },
    { name: 'cylinderIds', options: () => [{ value: 'c-1' }, { value: 'c-2' }] },
  ];
  assert.deepEqual(updateFormValues(previous, 'gas', 'Medical oxygen', fields), {
    ...previous,
    gas: 'Medical oxygen',
  });
});

test('a dependent default updates only when its parent changes', () => {
  const fields = [
    { name: 'partyId' },
    {
      name: 'periodStart',
      defaultOnChange: {
        dependsOn: ['partyId'],
        value: (values: Record<string, unknown>) =>
          values.partyId === 'new-party' ? '2026-09-02' : '2026-09-01',
      },
    },
    { name: 'notes' },
  ];
  const changed = updateFormValues(
    { partyId: 'old-party', periodStart: '2026-09-10', notes: '' },
    'partyId',
    'new-party',
    fields,
  );
  assert.equal(changed.periodStart, '2026-09-02');
  assert.equal(
    updateFormValues({ ...changed, periodStart: '2026-09-15' }, 'notes', 'keep', fields)
      .periodStart,
    '2026-09-15',
  );
});

test('an already open customer form discards the previously injected field on submission', () => {
  const values = { name: 'Test customer', branchId: 'b-delhi', cylinderIds: [] };
  assert.deepEqual(declaredFormValues(values, [{ name: 'name' }, { name: 'branchId' }]), {
    name: 'Test customer',
    branchId: 'b-delhi',
  });
  const cylinderValues = { cylinderIds: ['c-1'], notes: 'Proof' };
  assert.deepEqual(
    declaredFormValues(cylinderValues, [{ name: 'cylinderIds' }, { name: 'notes' }]),
    cylinderValues,
  );
});

test('declared text is trimmed while passwords preserve their exact bytes', () => {
  assert.deepEqual(
    declaredFormValues({ name: '  Clinic  ', password: '  secret  ' }, [
      { name: 'name', type: 'text' },
      { name: 'password', type: 'password' },
    ]),
    { name: 'Clinic', password: '  secret  ' },
  );
});

test('schema errors use visible field labels and one-based CSV rows', () => {
  assert.equal(
    friendlyFormError('Invalid cylinders.import payload: rows.0.ownerId: Required', [
      { name: 'ownerId', label: 'Owner' },
    ]),
    'Row 1 · Owner: Required',
  );
  assert.equal(
    friendlyFormError('Invalid cylinders.import payload: rows.0.ownerId: Required', []),
    'Row 1 · Owner: Required',
  );
});
