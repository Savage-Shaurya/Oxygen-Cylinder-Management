import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedPartyTypes } from '../src/party-options';

test('customer and supplier creation cannot offer each other’s classifications', () => {
  assert.deepEqual(allowedPartyTypes('customer'), ['hospital', 'homecare', 'industrial']);
  assert.deepEqual(allowedPartyTypes('supplier'), ['supplier']);
  assert.equal(allowedPartyTypes('edit').length, 4);
});
