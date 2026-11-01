import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activeMappingMap,
  belowMinimumOrder,
  describeSupplierOption,
  itemMatchesReceivingSearch,
  itemMatchesScannedCode,
  prioritiseMappedItems,
  purchaseOrderSupplierConflict,
} from '../src/receiving.ts';

function item(id, overrides = {}) {
  return {
    id,
    sku: `SKU-${id}`,
    name: `Item ${id}`,
    barcode: null,
    base_uom: 'EA',
    status: 'active',
    ...overrides,
  };
}

function mapping(itemId, overrides = {}) {
  return {
    mapping_id: `mapping-${itemId}`,
    item_id: itemId,
    item_sku: `SKU-${itemId}`,
    item_name: `Item ${itemId}`,
    supplier_sku: `SUP-${itemId}`,
    status: 'active',
    is_preferred: true,
    ...overrides,
  };
}

test('mapped supplier items are prioritised while unmapped items stay selectable', () => {
  const items = [item('a'), item('b'), item('c')];
  const mappings = activeMappingMap([mapping('c')]);

  assert.deepEqual(
    prioritiseMappedItems(items, mappings, 'supplier-1').map((entry) => entry.id),
    ['c', 'a', 'b'],
  );

  // Without a supplier selected the original catalogue order is preserved.
  assert.deepEqual(
    prioritiseMappedItems(items, mappings, null).map((entry) => entry.id),
    ['a', 'b', 'c'],
  );

  // An unmapped item is still returned, never filtered out.
  assert.equal(prioritiseMappedItems(items, mappings, 'supplier-1').length, 3);
});

test('inactive mappings do not label an item as mapped', () => {
  const mappings = activeMappingMap([
    mapping('a', { status: 'inactive' }),
    mapping('b', { status: 'active' }),
  ]);

  assert.equal(mappings.has('a'), false);
  assert.equal(mappings.has('b'), true);
});

test('receiving search matches internal SKU, name, barcode and supplier SKU', () => {
  const target = item('a', { sku: 'INT-100', name: 'Copper Cable', barcode: '8901' });
  const supplierMapping = mapping('a', { supplier_sku: 'APX-900' });

  assert.equal(itemMatchesReceivingSearch(target, supplierMapping, 'INT-100'), true);
  assert.equal(itemMatchesReceivingSearch(target, supplierMapping, 'copper'), true);
  assert.equal(itemMatchesReceivingSearch(target, supplierMapping, '8901'), true);
  assert.equal(itemMatchesReceivingSearch(target, supplierMapping, 'apx-900'), true);
  assert.equal(itemMatchesReceivingSearch(target, supplierMapping, 'missing'), false);
  // An empty query matches everything, keeping the picker complete.
  assert.equal(itemMatchesReceivingSearch(target, supplierMapping, '  '), true);
});

test('barcode scanning accepts the supplier SKU but ignores partial matches', () => {
  const target = item('a', { sku: 'INT-100', barcode: '8901' });
  const supplierMapping = mapping('a', { supplier_sku: 'APX-900' });

  assert.equal(itemMatchesScannedCode(target, supplierMapping, ' apx-900 '), true);
  assert.equal(itemMatchesScannedCode(target, supplierMapping, 'INT-100'), true);
  assert.equal(itemMatchesScannedCode(target, supplierMapping, '8901'), true);
  assert.equal(itemMatchesScannedCode(target, supplierMapping, 'APX-9'), false);
  assert.equal(itemMatchesScannedCode(target, undefined, 'APX-900'), false);
  assert.equal(itemMatchesScannedCode(target, supplierMapping, ''), false);
});

test('purchase-order receipts must keep the order supplier', () => {
  assert.equal(purchaseOrderSupplierConflict('supplier-1', 'supplier-1'), null);
  assert.equal(purchaseOrderSupplierConflict('supplier-1', null), null);
  assert.equal(purchaseOrderSupplierConflict(null, 'supplier-1'), null);
  assert.match(
    purchaseOrderSupplierConflict('supplier-1', 'supplier-2') ?? '',
    /does not match the purchase order/,
  );
});

test('supplier option detail honours cost visibility and MOQ', () => {
  const option = {
    supplier_id: 'supplier-1',
    supplier_name: 'Alpha Supply',
    supplier_sku: 'APX-900',
    is_preferred: true,
    purchase_price: '12.50',
    currency: 'USD',
    lead_time_days: 7,
    min_order_qty: '10',
  };

  const priced = describeSupplierOption(option, true);
  assert.equal(priced[0], 'Preferred for this item');
  assert.ok(priced.includes('SKU APX-900'));
  assert.ok(priced.includes('7d lead'));
  assert.ok(priced.includes('MOQ 10'));
  assert.ok(priced.includes('USD 12.50'));

  const gated = describeSupplierOption(option, false);
  assert.equal(gated.some((entry) => entry.includes('12.50')), false);

  assert.equal(belowMinimumOrder('10', 9), true);
  assert.equal(belowMinimumOrder('10', 10), false);
  assert.equal(belowMinimumOrder(null, 1), false);
  assert.equal(belowMinimumOrder('0', 1), false);
});
