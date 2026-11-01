import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateOutboundProgress,
  findItemByScannedCode,
  formatAllocationCoordinates,
  matchAllocationForScan,
  sortAllocationsByWalkingPath,
} from '../src/outbound.ts';

function dummyItem(overrides = {}) {
  return {
    id: 'item-1',
    company_id: 'co-1',
    client_id: null,
    sku: 'SKU-001',
    name: 'Standard Widget',
    barcode: 'BC-001',
    base_uom: 'EA',
    category: 'Hardware',
    tracking_mode: 'none',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function dummyLocation(overrides = {}) {
  return {
    id: 'loc-1',
    warehouse_id: 'wh-1',
    parent_id: null,
    code: 'A1-R01-S1-B01',
    name: 'Bin 01',
    path: 'WH/A1-R01-S1-B01',
    barcode: 'LOC-BC-01',
    type: 'bin',
    aisle: 'A1',
    rack: 'R01',
    shelf: 'S1',
    bin: 'B01',
    is_pickable: true,
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function dummyAllocation(overrides = {}) {
  return {
    id: 'alloc-1',
    line_id: 'line-1',
    item_id: 'item-1',
    sku: 'SKU-001',
    item_name: 'Standard Widget',
    location_id: 'loc-1',
    location_code: 'A1-R01-S1-B01',
    lot_id: null,
    lot_no: null,
    expiry_date: null,
    serial_id: null,
    serial_no: null,
    qty: '5',
    base_qty: '5',
    base_uom: 'EA',
    status: 'allocated',
    picked_at: null,
    picked_by: null,
    ...overrides,
  };
}

test('calculateOutboundProgress computes progress percentage and completion status', () => {
  const order = {
    id: 'ord-1',
    allocations: [
      dummyAllocation({ id: 'a1', status: 'picked', base_qty: '2' }),
      dummyAllocation({ id: 'a2', status: 'allocated', base_qty: '3' }),
    ],
  };

  const progress = calculateOutboundProgress(order);
  assert.equal(progress.totalAllocations, 2);
  assert.equal(progress.pickedAllocations, 1);
  assert.equal(progress.totalUnits, 5);
  assert.equal(progress.pickedUnits, 2);
  assert.equal(progress.percent, 50);
  assert.equal(progress.isComplete, false);

  const completedOrder = {
    id: 'ord-2',
    allocations: [
      dummyAllocation({ id: 'a1', status: 'picked', base_qty: '2' }),
      dummyAllocation({ id: 'a2', status: 'picked', base_qty: '3' }),
    ],
  };
  const compProgress = calculateOutboundProgress(completedOrder);
  assert.equal(compProgress.isComplete, true);
  assert.equal(compProgress.percent, 100);
});

test('matchAllocationForScan matches barcode, SKU, or serial number and prevents over-picking', () => {
  const item1 = dummyItem({ id: 'item-1', sku: 'SKU-001', barcode: '890123456789' });
  const item2 = dummyItem({ id: 'item-2', sku: 'SKU-002', barcode: '890987654321' });
  const items = [item1, item2];

  const alloc1 = dummyAllocation({ id: 'a1', item_id: 'item-1', sku: 'SKU-001', status: 'allocated' });
  const alloc2 = dummyAllocation({ id: 'a2', item_id: 'item-2', sku: 'SKU-002', status: 'picked' });
  const allocSerial = dummyAllocation({
    id: 'a3',
    item_id: 'item-1',
    sku: 'SKU-001',
    serial_no: 'SN-9999',
    status: 'allocated',
  });
  const allocations = [alloc1, alloc2, allocSerial];

  // Match by barcode
  const matchBarcode = matchAllocationForScan(allocations, items, '890123456789');
  assert.equal(matchBarcode.status, 'match');
  assert.equal(matchBarcode.allocation?.id, 'a1');

  // Match by SKU directly
  const matchSku = matchAllocationForScan(allocations, items, 'SKU-001');
  assert.equal(matchSku.status, 'match');
  assert.equal(matchSku.allocation?.id, 'a1');

  // Match by serial number
  const matchSerial = matchAllocationForScan(allocations, items, 'SN-9999');
  assert.equal(matchSerial.status, 'match');
  assert.equal(matchSerial.allocation?.id, 'a3');

  // Attempt to scan an already-picked item (over-pick prevention)
  const matchPicked = matchAllocationForScan(allocations, items, 'SKU-002');
  assert.equal(matchPicked.status, 'already_picked');
  assert.equal(matchPicked.allocation, null);

  // Attempt to scan an unknown/unrelated item
  const matchUnknown = matchAllocationForScan(allocations, items, 'UNKNOWN-ITEM-BARCODE');
  assert.equal(matchUnknown.status, 'not_in_order');
  assert.equal(matchUnknown.allocation, null);
});

test('formatAllocationCoordinates resolves full Aisle · Rack · Shelf · Bin string', () => {
  const loc = dummyLocation({
    id: 'loc-1',
    code: 'BIN-101',
    aisle: 'A1',
    rack: 'R05',
    shelf: 'S02',
    bin: 'B08',
  });
  const alloc = dummyAllocation({ location_id: 'loc-1' });

  const coords = formatAllocationCoordinates(alloc, [loc]);
  assert.equal(coords, 'Aisle: A1 · Rack: R05 · Shelf: S02 · Bin: B08');
});

test('sortAllocationsByWalkingPath orders unpicked allocations first and follows warehouse aisle hierarchy', () => {
  const locA2 = dummyLocation({ id: 'l-a2', code: 'A2-R01-S1-B01', aisle: 'A2', rack: 'R01', shelf: 'S1', bin: 'B01' });
  const locA1R2 = dummyLocation({ id: 'l-a1-r2', code: 'A1-R02-S1-B01', aisle: 'A1', rack: 'R02', shelf: 'S1', bin: 'B01' });
  const locA1R1 = dummyLocation({ id: 'l-a1-r1', code: 'A1-R01-S1-B01', aisle: 'A1', rack: 'R01', shelf: 'S1', bin: 'B01' });
  const locations = [locA2, locA1R2, locA1R1];

  const alloc1 = dummyAllocation({ id: 'a-a2', location_id: 'l-a2', status: 'allocated' });
  const alloc2 = dummyAllocation({ id: 'a-a1-r2', location_id: 'l-a1-r2', status: 'allocated' });
  const alloc3 = dummyAllocation({ id: 'a-a1-r1', location_id: 'l-a1-r1', status: 'allocated' });
  const allocPicked = dummyAllocation({ id: 'a-picked', location_id: 'l-a1-r1', status: 'picked' });

  const sorted = sortAllocationsByWalkingPath([allocPicked, alloc1, alloc2, alloc3], locations);

  // Unpicked come first, in walking order: A1-R01 -> A1-R02 -> A2-R01 -> picked last
  assert.deepEqual(
    sorted.map((a) => a.id),
    ['a-a1-r1', 'a-a1-r2', 'a-a2', 'a-picked'],
  );
});

test('findItemByScannedCode matches barcode or SKU', () => {
  const items = [
    dummyItem({ id: 'i1', sku: 'WIDGET-01', barcode: '777888999' }),
    dummyItem({ id: 'i2', sku: 'GADGET-02', barcode: null }),
  ];

  assert.equal(findItemByScannedCode(items, '777888999')?.id, 'i1');
  assert.equal(findItemByScannedCode(items, 'widget-01')?.id, 'i1');
  assert.equal(findItemByScannedCode(items, 'gadget-02')?.id, 'i2');
  assert.equal(findItemByScannedCode(items, 'NON-EXISTENT'), null);
});

test('filterStockedItemOptions excludes items not in store or having zero balance', async () => {
  const { filterStockedItemOptions } = await import('../src/outbound.ts');

  const inStockItem = dummyItem({ id: 'item-stocked', sku: 'STK-01', name: 'Stocked Part', base_uom: 'EA' });
  const zeroStockItem = dummyItem({ id: 'item-zero', sku: 'ZER-02', name: 'Zero Stock Part', base_uom: 'EA' });
  const neverReceivedItem = dummyItem({ id: 'item-unreceived', sku: 'UNR-03', name: 'Never Received', base_uom: 'EA' });
  const otherWhItem = dummyItem({ id: 'item-other-wh', sku: 'OTH-04', name: 'Other Warehouse Only', base_uom: 'EA' });

  const items = [inStockItem, zeroStockItem, neverReceivedItem, otherWhItem];

  const balances = [
    { warehouse_id: 'wh-main', location_id: 'bin-1', item_id: 'item-stocked', available: '25', on_hand: '25' },
    { warehouse_id: 'wh-main', location_id: 'bin-2', item_id: 'item-zero', available: '0', on_hand: '0' },
    { warehouse_id: 'wh-other', location_id: 'bin-99', item_id: 'item-other-wh', available: '50', on_hand: '50' },
  ];

  // For wh-main: only item-stocked should be returned
  const mainWhOptions = filterStockedItemOptions(items, balances, { warehouseId: 'wh-main' });
  assert.equal(mainWhOptions.length, 1);
  assert.equal(mainWhOptions[0].value, 'item-stocked');
  assert.equal(mainWhOptions[0].availableQty, '25');
  assert.equal(mainWhOptions[0].detail, '25 EA available in store');

  // For specific location bin-1:
  const bin1Options = filterStockedItemOptions(items, balances, { locationId: 'bin-1' });
  assert.equal(bin1Options.length, 1);
  assert.equal(bin1Options[0].value, 'item-stocked');

  // For empty warehouse: returns empty array
  const emptyOptions = filterStockedItemOptions(items, balances, { warehouseId: 'wh-empty' });
  assert.equal(emptyOptions.length, 0);
});

