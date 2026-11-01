import assert from 'node:assert/strict';
import test from 'node:test';

import { isIsoDate, parseSerialNumbers } from '../src/tracking.ts';

test('parseSerialNumbers splits, trims and removes duplicates', () => {
  assert.deepEqual(parseSerialNumbers(' SN-1, SN-2\nSN-1;SN-3 '), [
    'SN-1',
    'SN-2',
    'SN-3',
  ]);
  assert.deepEqual(parseSerialNumbers(' , ;\n'), []);
});

test('isIsoDate rejects impossible and malformed dates', () => {
  assert.equal(isIsoDate('2027-06-30'), true);
  assert.equal(isIsoDate('2027-02-30'), false);
  assert.equal(isIsoDate('30-06-2027'), false);
  assert.equal(isIsoDate(''), false);
});
