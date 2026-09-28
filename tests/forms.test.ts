import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateFormValues, declaredFormValues } from '../src/components/form-values';

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
