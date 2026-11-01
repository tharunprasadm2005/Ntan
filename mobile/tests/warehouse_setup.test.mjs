import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCustomSectionBatch,
  compileInitialLocations,
  computeFlatFloorPositions,
  computeRackBins,
  getInitialProposedAreas,
  validateWarehouseAreas,
} from '../src/warehouse_setup.ts';

test('Quick Setup for all-in-one produces a single open floor storage area without forced docks', () => {
  const areas = getInitialProposedAreas('all_in_one', 'general');
  assert.equal(areas.length, 1);
  assert.equal(areas[0].code, 'FLOOR');
  assert.equal(areas[0].type, 'main');
  assert.equal(areas[0].isPickable, true);
  assert.equal(areas[0].isOperational, false);
});

test('Quick Setup for bulk_storage and multi_zone provides clear, human-named suggested areas', () => {
  const bulk = getInitialProposedAreas('bulk_storage', 'bulk');
  const bulkCodes = bulk.map((a) => a.code);
  assert.deepEqual(bulkCodes, ['RECV', 'STORAGE', 'DISP', 'QC']);
  assert.equal(bulk.find((a) => a.code === 'RECV')?.name, 'Inbound Receiving Dock');
  assert.equal(bulk.find((a) => a.code === 'STORAGE')?.name, 'Bulk Pallet Storage Racks');

  const multi = getInitialProposedAreas('multi_zone', 'distribution');
  const multiCodes = multi.map((a) => a.code);
  assert.deepEqual(multiCodes, ['RECV', 'STORAGE', 'PICK', 'DISP']);
  assert.equal(multi.find((a) => a.code === 'PICK')?.name, 'Forward Picking Area');
  assert.equal(multi.find((a) => a.code === 'DISP')?.name, 'Outbound Dispatch Area');

  const cold = getInitialProposedAreas('multi_zone', 'cold_storage');
  assert.ok(cold.some((a) => a.code === 'COLD' && a.type === 'cold_storage'));
});

test('Support multiple areas with the SAME operational purpose and different unique codes', () => {
  const areas = [
    {
      id: 'dock-1',
      code: 'DOCK-01',
      name: 'North Inbound Dock',
      type: 'receiving',
      isPickable: false,
      isOperational: true,
    },
    {
      id: 'dock-2',
      code: 'DOCK-02',
      name: 'South Inbound Dock',
      type: 'receiving',
      isPickable: false,
      isOperational: true,
    },
    {
      id: 'store-1',
      code: 'ROOM-A',
      name: 'Dry Goods Room',
      type: 'main',
      isPickable: true,
      isOperational: false,
    },
    {
      id: 'store-2',
      code: 'ROOM-B',
      name: 'Reserve Room',
      type: 'main',
      isPickable: true,
      isOperational: false,
    },
  ];

  const validation = validateWarehouseAreas(areas);
  assert.equal(validation.valid, true);
  assert.equal(validation.error, null);

  const compiled = compileInitialLocations({
    setupMethod: 'custom',
    areas,
    rackBins: [],
  });
  assert.equal(compiled.error, null);
  assert.equal(compiled.locations.length, 4);
  assert.equal(compiled.locations[0].code, 'DOCK-01');
  assert.equal(compiled.locations[1].code, 'DOCK-02');
  assert.equal(compiled.locations[0].type, 'receiving');
  assert.equal(compiled.locations[1].type, 'receiving');
});

test('Area validation rejects empty codes and duplicate codes', () => {
  const emptyCode = validateWarehouseAreas([
    { id: '1', code: '', name: 'Main', type: 'main', isPickable: true, isOperational: false },
  ]);
  assert.equal(emptyCode.valid, false);
  assert.match(emptyCode.error, /non-empty/);

  const duplicateCode = validateWarehouseAreas([
    { id: '1', code: 'RECV', name: 'Dock 1', type: 'receiving', isPickable: false, isOperational: true },
    { id: '2', code: 'recv', name: 'Dock 2', type: 'receiving', isPickable: false, isOperational: true },
  ]);
  assert.equal(duplicateCode.valid, false);
  assert.match(duplicateCode.error, /Duplicate area code 'RECV'/);
});

test('buildCustomSectionBatch supports single and multi-quantity section generation', () => {
  const single = buildCustomSectionBatch({
    name: 'Chemical Vault',
    code: 'VAULT',
    type: 'quarantine',
    isPickable: false,
    isOperational: true,
    quantity: 1,
  });
  assert.equal(single.length, 1);
  assert.equal(single[0].code, 'VAULT');
  assert.equal(single[0].name, 'Chemical Vault');

  const batch = buildCustomSectionBatch({
    name: 'Storage Bay',
    code: 'BAY',
    type: 'main',
    isPickable: true,
    isOperational: false,
    quantity: 3,
  });
  assert.equal(batch.length, 3);
  assert.equal(batch[0].code, 'BAY-01');
  assert.equal(batch[0].name, 'Storage Bay 1');
  assert.equal(batch[1].code, 'BAY-02');
  assert.equal(batch[2].code, 'BAY-03');
});

test('Set Up Later creates exactly zero locations', () => {
  const result = compileInitialLocations({
    setupMethod: 'later',
    areas: [
      { id: '1', code: 'MAIN', name: 'Ignored', type: 'main', isPickable: true, isOperational: false },
    ],
    rackBins: [],
  });
  assert.equal(result.locations.length, 0);
  assert.equal(result.error, null);
});

test('computeRackBins generates coordinate-based bins and prevents batch overflow', () => {
  const result = computeRackBins({
    aisles: 2,
    racksPerAisle: 2,
    shelvesPerRack: 3,
    binsPerShelf: 2,
    parentCode: 'STORAGE',
  });
  assert.equal(result.error, null);
  assert.equal(result.bins.length, 24); // 2 * 2 * 3 * 2 = 24
  assert.equal(result.bins[0].parent_code, 'STORAGE');
  assert.equal(result.bins[0].code, '01-01-01-01');

  const overflow = computeRackBins({
    aisles: 10,
    racksPerAisle: 10,
    shelvesPerRack: 10,
    binsPerShelf: 10,
    parentCode: 'STORAGE',
  });
  assert.ok(overflow.error);
  assert.match(overflow.error, /exceeds the safe batch limit/);
});

test('computeFlatFloorPositions generates numbered floor bays under storage area', () => {
  const result = computeFlatFloorPositions({
    count: 4,
    parentCode: 'FLOOR',
    prefix: 'POS',
    zeroPad: 2,
  });
  assert.equal(result.error, null);
  assert.equal(result.positions.length, 4);
  assert.equal(result.positions[0].code, 'POS-01');
  assert.equal(result.positions[0].parent_code, 'FLOOR');
  assert.equal(result.positions[3].code, 'POS-04');
});

test('compileInitialLocations detects collision between areas and generated bins', () => {
  const conflict = compileInitialLocations({
    setupMethod: 'quick',
    areas: [
      { id: '1', code: 'BIN-01', name: 'Area Named Bin', type: 'main', isPickable: true, isOperational: false },
    ],
    rackBins: [
      { code: 'BIN-01', type: 'bin', is_pickable: true, parent_code: 'BIN-01' },
    ],
  });
  assert.ok(conflict.error);
  assert.match(conflict.error, /conflicts with an existing area code/);
});
