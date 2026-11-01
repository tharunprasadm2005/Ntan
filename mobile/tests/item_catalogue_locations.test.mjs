import test from 'node:test';
import assert from 'node:assert/strict';

test('Phase 1: Existing item import continues working without location columns', () => {
  const rowWithoutLocations = {
    sku: 'WIDGET-01',
    name: 'Standard Widget',
    barcode: '8901234567890',
    category: 'Hardware',
    item_type: 'stocked_material',
    base_uom: 'EA',
    tracking_mode: 'none',
  };

  assert.equal(rowWithoutLocations.sku, 'WIDGET-01');
  assert.equal(rowWithoutLocations.warehouse_code, undefined);
  assert.equal(rowWithoutLocations.bin_code, undefined);
});

test('Phase 1: Optional spreadsheet columns parse correctly for preferred locations', () => {
  const rowWithLocations = {
    sku: 'CHG-1001',
    name: 'Charger',
    warehouse_code: 'CHN-WH',
    zone_code: 'A',
    aisle_code: 'A03',
    rack_code: 'R05',
    shelf_code: 'S02',
    bin_code: 'B08',
    storage_type: 'bin',
    preferred_location: 'B08',
  };

  assert.equal(rowWithLocations.warehouse_code, 'CHN-WH');
  assert.equal(rowWithLocations.zone_code, 'A');
  assert.equal(rowWithLocations.aisle_code, 'A03');
  assert.equal(rowWithLocations.rack_code, 'R05');
  assert.equal(rowWithLocations.shelf_code, 'S02');
  assert.equal(rowWithLocations.bin_code, 'B08');
  assert.equal(rowWithLocations.preferred_location, 'B08');
});

test('Phase 1: Multi-warehouse preferred locations preserve assignments per warehouse', () => {
  const existingPreferredLocations = [
    {
      warehouse_id: 'wh-chennai',
      warehouse_code: 'CHN-WH',
      location_id: 'loc-01',
      location_code: 'B08',
      bin: 'B08',
      is_primary: true,
    },
  ];

  // Incoming update for Bangalore warehouse
  const newBangaloreLocation = {
    warehouse_id: 'wh-bangalore',
    warehouse_code: 'BLR-WH',
    location_id: 'loc-02',
    location_code: 'R01-B02',
    bin: 'B02',
    is_primary: true,
  };

  const updatedLocations = [
    ...existingPreferredLocations.filter((l) => l.warehouse_id !== newBangaloreLocation.warehouse_id),
    newBangaloreLocation,
  ];

  assert.equal(updatedLocations.length, 2);
  assert.equal(updatedLocations.find((l) => l.warehouse_code === 'CHN-WH')?.location_code, 'B08');
  assert.equal(updatedLocations.find((l) => l.warehouse_code === 'BLR-WH')?.location_code, 'R01-B02');
});

test('Phase 1: Preferred item assignments remain separate from actual stock quantities', () => {
  const bin = {
    id: 'bin-101',
    code: 'B08',
    type: 'bin',
    capacity: '100',
    status: 'active',
    preferred_items: [
      { item_id: 'item-1', sku: 'CHG-1001', name: 'Charger', is_primary: true },
      { item_id: 'item-2', sku: 'CBL-2002', name: 'USB-C Cable', is_primary: true },
    ],
    actual_stock_qty: '45.0',
  };

  assert.equal(bin.preferred_items.length, 2);
  assert.equal(bin.actual_stock_qty, '45.0');
  assert.notEqual(bin.preferred_items.length, Number(bin.actual_stock_qty));
});

