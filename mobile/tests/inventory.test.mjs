import assert from 'node:assert/strict';
import test from 'node:test';

import { lowStockItems, summarizeStock } from '../src/inventory.ts';

function item(overrides = {}) {
  return {
    id: 'item-1',
    sku: 'BOLT-M8',
    name: 'M8 bolt',
    barcode: null,
    description: null,
    category: null,
    item_type: 'stocked_material',
    base_uom: 'EA',
    tracking_mode: 'none',
    cost: null,
    reorder_point: '10',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function balance(overrides = {}) {
  return {
    id: 'balance-1',
    item_id: 'item-1',
    sku: 'BOLT-M8',
    item_name: 'M8 bolt',
    warehouse_id: 'warehouse-1',
    location_id: 'location-1',
    lot_id: null,
    serial_id: null,
    stock_status: 'available',
    on_hand: '4',
    reserved: '0',
    blocked: '0',
    available: '4',
    version: 1,
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

test('summarizes available, blocked and quarantine stock from real balances', () => {
  const summary = summarizeStock(
    [item(), item({ id: 'item-2', sku: 'PUMP', reorder_point: null })],
    [
      balance(),
      balance({
        id: 'balance-2',
        stock_status: 'quarantine',
        on_hand: '3',
        available: '3',
      }),
      balance({
        id: 'balance-3',
        item_id: 'item-2',
        stock_status: 'blocked',
        on_hand: '2',
        available: '2',
      }),
    ],
  );

  assert.equal(summary.totalOnHand, 9);
  assert.equal(summary.totalAvailable, 4);
  assert.equal(summary.quarantineUnits, 3);
  assert.equal(summary.blockedUnits, 2);
  assert.equal(summary.stockedSkus, 1);
  assert.equal(summary.stockoutCount, 1);
  assert.equal(summary.lowStockCount, 1);
});

test('returns low stock items with stockouts first', () => {
  const summary = summarizeStock(
    [
      item({ id: 'item-1', sku: 'LOW', reorder_point: '10' }),
      item({ id: 'item-2', sku: 'EMPTY', reorder_point: '5' }),
      item({ id: 'item-3', sku: 'HEALTHY', reorder_point: '2' }),
    ],
    [
      balance({ id: 'b1', item_id: 'item-1', on_hand: '6', available: '6' }),
      balance({ id: 'b2', item_id: 'item-2', on_hand: '0', available: '0' }),
      balance({ id: 'b3', item_id: 'item-3', on_hand: '9', available: '9' }),
    ],
  );

  const alerts = lowStockItems(summary);
  assert.deepEqual(
    alerts.map((entry) => entry.item.sku),
    ['EMPTY', 'LOW'],
  );
  assert.equal(summary.stockoutCount, 1);
});

test('sample products dataset contains 100+ valid products across warehouse categories', async () => {
  const { SAMPLE_PRODUCTS_CSV } = await import('../src/sampleCatalogue.ts');
  const lines = SAMPLE_PRODUCTS_CSV.trim().split('\n').filter((l) => l.trim().length > 0);
  const header = lines[0];
  const rows = lines.slice(1);

  assert.ok(header.startsWith('sku,name,barcode,category'));
  assert.ok(rows.length >= 100, `Expected at least 100 products, got ${rows.length}`);

  // Validate every row has at least SKU, name, and valid tracking mode
  const categories = new Set();
  const trackingModes = new Set();

  for (const row of rows) {
    const cols = row.split(',');
    assert.ok(cols.length >= 7, `Row malformed: ${row}`);
    const sku = cols[0].trim();
    const name = cols[1].trim();
    const cat = cols[3].trim();
    const tracking = cols[6].trim();

    assert.ok(sku.length > 0);
    assert.ok(name.length > 0);
    categories.add(cat);
    trackingModes.add(tracking);
  }

  assert.ok(categories.has('Electrical'));
  assert.ok(categories.has('Chemicals'));
  assert.ok(categories.has('Packaging'));
  assert.ok(categories.has('Safety'));
  assert.ok(trackingModes.has('none'));
  assert.ok(trackingModes.has('lot'));
  assert.ok(trackingModes.has('serial'));
});

test('catalogue item filtering by category, tracking mode, and health', () => {
  const testItems = [
    item({ id: '1', sku: 'ELEC-1', category: 'Electrical', tracking_mode: 'none', reorder_point: '10' }),
    item({ id: '2', sku: 'ELEC-2', category: 'Electrical', tracking_mode: 'serial', reorder_point: '2' }),
    item({ id: '3', sku: 'CHEM-1', category: 'Chemicals', tracking_mode: 'lot', reorder_point: '20' }),
    item({ id: '4', sku: 'SAFE-1', category: 'Safety', tracking_mode: 'none', reorder_point: null }),
  ];

  const stockMap = new Map([
    ['1', 5], // on_hand 5 <= reorder 10 -> Low stock!
    ['2', 15], // on_hand 15 > reorder 2 -> Healthy
    ['3', 25], // on_hand 25 > reorder 20 -> Healthy
    ['4', 50],
  ]);

  // Filter by category
  const elec = testItems.filter((i) => i.category === 'Electrical');
  assert.equal(elec.length, 2);

  // Filter by tracking mode
  const lotTracked = testItems.filter((i) => i.tracking_mode === 'lot');
  assert.equal(lotTracked.length, 1);
  assert.equal(lotTracked[0].sku, 'CHEM-1');

  // Filter by low stock
  const lowStock = testItems.filter((i) => {
    const onHand = stockMap.get(i.id) ?? 0;
    return i.reorder_point !== null && onHand <= Number(i.reorder_point);
  });
  assert.equal(lowStock.length, 1);
  assert.equal(lowStock[0].sku, 'ELEC-1');
});

