import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterPutawayDestinations,
  isPutawayDestination,
  newPutawayRequestKey,
  parsePutawayQuantity,
  putawayProgress,
} from '../src/putaway.ts';

const context = { warehouseId: 'wh-1', fromLocationId: 'loc-recv' };

function location(overrides = {}) {
  return {
    id: 'loc-bin',
    warehouse_id: 'wh-1',
    parent_id: null,
    code: 'BIN-01',
    name: 'Bin 01',
    path: 'MAIN/BIN-01',
    barcode: null,
    type: 'bin',
    is_pickable: true,
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

test('putaway destinations require an active storage location in the same warehouse', () => {
  assert.equal(isPutawayDestination(location(), context), true);
  assert.equal(isPutawayDestination(location({ status: 'blocked' }), context), false);
  assert.equal(isPutawayDestination(location({ type: 'receiving' }), context), false);
  assert.equal(isPutawayDestination(location({ type: 'staging' }), context), false);
  assert.equal(isPutawayDestination(location({ warehouse_id: 'wh-2' }), context), false);
  assert.equal(isPutawayDestination(location({ id: 'loc-recv' }), context), false);
  assert.equal(isPutawayDestination(location({ type: 'dispatch' }), context), true);
});

test('destination filtering keeps only eligible bins and preserves order', () => {
  const filtered = filterPutawayDestinations(
    [
      location({ id: 'bin-a', code: 'BIN-A' }),
      location({ id: 'bin-b', code: 'BIN-B', status: 'archived' }),
      location({ id: 'stage', code: 'STAGE', type: 'staging' }),
      location({ id: 'bin-c', code: 'BIN-C', warehouse_id: 'wh-2' }),
      location({ id: 'bin-d', code: 'BIN-D' }),
    ],
    context,
  );
  assert.deepEqual(
    filtered.map((entry) => entry.code),
    ['BIN-A', 'BIN-D'],
  );
});

test('putaway quantity validation rejects zero, negative, excessive and imprecise values', () => {
  assert.deepEqual(parsePutawayQuantity('2.5', '10'), {
    quantity: '2.5',
    error: null,
  });
  assert.deepEqual(parsePutawayQuantity('2,5', '10'), {
    quantity: '2.5',
    error: null,
  });
  assert.deepEqual(parsePutawayQuantity('10', '10'), {
    quantity: '10',
    error: null,
  });
  assert.equal(parsePutawayQuantity('', '10').error, 'Enter the quantity to put away.');
  assert.ok(parsePutawayQuantity('0', '10').error);
  assert.ok(parsePutawayQuantity('-1', '10').error);
  assert.ok(parsePutawayQuantity('abc', '10').error);
  assert.ok(parsePutawayQuantity('1.0000001', '10').error);
  assert.equal(parsePutawayQuantity('10.1', '10').error, 'Enter 10 or less.');
});

test('putaway progress distinguishes staged, partially placed and completed stock', () => {
  assert.deepEqual(putawayProgress({
    status: 'pending',
    base_qty: '10',
    completed_qty: '0',
    remaining_qty: '10',
  }), {
    completedQty: '0',
    remainingQty: '10',
    isPartial: false,
    isComplete: false,
  });

  assert.deepEqual(putawayProgress({
    status: 'pending',
    base_qty: '10',
    completed_qty: '4',
    remaining_qty: '6',
  }), {
    completedQty: '4',
    remainingQty: '6',
    isPartial: true,
    isComplete: false,
  });

  assert.equal(putawayProgress({
    status: 'completed',
    base_qty: '10',
    completed_qty: '10',
    remaining_qty: '0',
  }).isComplete, true);

  assert.equal(putawayProgress({
    status: 'pending',
    base_qty: '10',
    completed_qty: '10',
    remaining_qty: '0',
  }).isComplete, true);
});

test('putaway request keys are unique per attempt', () => {
  const first = newPutawayRequestKey('task-1');
  const second = newPutawayRequestKey('task-1');
  assert.notEqual(first, second);
  assert.ok(first.startsWith('task-1-'));
  assert.ok(first.length >= 8);
});

test('hierarchy filtering and destination barcode scanning', async () => {
  const {
    formatLocationCoordinates,
    filterDestinationsByHierarchy,
    findDestinationByScannedCode,
  } = await import('../src/putaway.ts');

  const loc1 = location({
    id: 'loc-1',
    code: 'BIN-A1-R01-S1',
    barcode: 'BC-BIN-001',
    aisle: 'A1',
    rack: 'R01',
    shelf: 'S1',
    bin: 'B01',
  });
  const loc2 = location({
    id: 'loc-2',
    code: 'BIN-A1-R02-S1',
    barcode: 'BC-BIN-002',
    aisle: 'A1',
    rack: 'R02',
    shelf: 'S1',
    bin: 'B02',
  });
  const loc3 = location({
    id: 'loc-3',
    code: 'BIN-B1-R01-S1',
    barcode: null,
    aisle: 'B1',
    rack: 'R01',
    shelf: 'S1',
    bin: 'B03',
  });

  const list = [loc1, loc2, loc3];

  // Coordinates string formatting
  assert.equal(
    formatLocationCoordinates(loc1),
    'Aisle: A1 · Rack: R01 · Shelf: S1 · Bin: B01',
  );

  // Filter by aisle
  const aisleA1 = filterDestinationsByHierarchy(list, { aisle: 'A1' });
  assert.equal(aisleA1.length, 2);
  assert.deepEqual(aisleA1.map((l) => l.id), ['loc-1', 'loc-2']);

  // Filter by aisle + rack
  const rackR2 = filterDestinationsByHierarchy(list, { aisle: 'A1', rack: 'R02' });
  assert.equal(rackR2.length, 1);
  assert.equal(rackR2[0].id, 'loc-2');

  // Scan barcode matching barcode field
  assert.equal(findDestinationByScannedCode(list, 'BC-BIN-001')?.id, 'loc-1');
  assert.equal(findDestinationByScannedCode(list, 'bc-bin-002')?.id, 'loc-2');

  // Scan barcode matching code directly
  assert.equal(findDestinationByScannedCode(list, 'BIN-B1-R01-S1')?.id, 'loc-3');
  assert.equal(findDestinationByScannedCode(list, 'bin-b1-r01-s1')?.id, 'loc-3');

  // Invalid barcode returns null
  assert.equal(findDestinationByScannedCode(list, 'UNKNOWN-BARCODE'), null);
});

test('manual coordinate building and destination coordinate matching', async () => {
  const {
    buildCoordinateLocationCode,
    findDestinationByCoordinates,
  } = await import('../src/putaway.ts');

  // Build coordinate location code
  assert.equal(
    buildCoordinateLocationCode({ aisle: 'A1', rack: 'R02', shelf: 'S1', bin: 'B04' }),
    'A1-R02-S1-B04',
  );
  assert.equal(
    buildCoordinateLocationCode({ aisle: ' a2 ', rack: ' r03 ' }),
    'A2-R03',
  );
  assert.equal(buildCoordinateLocationCode({}), '');

  const locA = location({
    id: 'loc-a',
    code: 'A1-R01-S1-B01',
    aisle: 'A1',
    rack: 'R01',
    shelf: 'S1',
    bin: 'B01',
  });
  const locB = location({
    id: 'loc-b',
    code: 'A1-R02-S1-B02',
    aisle: 'A1',
    rack: 'R02',
    shelf: 'S1',
    bin: 'B02',
  });
  const list = [locA, locB];

  // Match when user types all coordinates exactly (case-insensitive)
  const match1 = findDestinationByCoordinates(list, {
    aisle: 'a1',
    rack: 'r01',
    shelf: 's1',
    bin: 'b01',
  });
  assert.equal(match1?.id, 'loc-a');

  // Match when user types partial coordinates that uniquely point to loc-b
  const match2 = findDestinationByCoordinates(list, {
    aisle: 'A1',
    rack: 'R02',
  });
  assert.equal(match2?.id, 'loc-b');

  // Non-matching coordinates return null (allows user to create new bin)
  const matchNone = findDestinationByCoordinates(list, {
    aisle: 'A3',
    rack: 'R99',
    shelf: 'S9',
    bin: 'B99',
  });
  assert.equal(matchNone, null);
});

test('suggestPutawayBinsForItem recommends bins where stock already exists for consolidation', async () => {
  const { suggestPutawayBinsForItem } = await import('../src/putaway.ts');

  const loc1 = location({ id: 'loc-1', code: 'A1-R01-S1-B01' });
  const loc2 = location({ id: 'loc-2', code: 'A2-R05-S1-B01' });
  const loc3 = location({ id: 'loc-3', code: 'B1-R01-S1-B01' });

  const balances = [
    { location_id: 'loc-2', item_id: 'item-widget', on_hand: '20' },
    { location_id: 'loc-1', item_id: 'other-item', on_hand: '5' },
    { location_id: 'loc-3', item_id: 'item-widget', on_hand: '0' }, // zero on hand ignored
  ];

  const suggested = suggestPutawayBinsForItem('item-widget', balances, [loc1, loc2, loc3]);
  assert.equal(suggested.length, 1);
  assert.equal(suggested[0].id, 'loc-2');
});
