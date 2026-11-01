import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReorderDraftLines, reorderRowKey, suggestedReorderQty } from '../src/reorder.ts';

function row(overrides = {}) {
  return {
    item_id: 'item-1',
    sku: 'BOLT-M8',
    item_name: 'M8 bolt',
    client_id: 'client-1',
    warehouse_id: 'warehouse-1',
    warehouse_name: 'Main Warehouse',
    base_uom: 'EA',
    on_hand: '4',
    reserved: '0',
    blocked: '0',
    available: '4',
    incoming_qty: '0',
    incoming_source: 'unsupported',
    projected_stock: '4',
    reorder_point: '10',
    target_stock: '20',
    target_stock_source: 'fallback',
    suggested_qty: '16',
    urgency: 'critical',
    ...overrides,
  };
}

test('Fallback target stock is twice the reorder point and is flagged', () => {
  const result = suggestedReorderQty({ available: 4, reorderPoint: 10, targetStock: null });
  assert.equal(result.targetStock, 20);
  assert.equal(result.targetAssumed, true);
  assert.equal(result.projectedStock, 4);
  assert.equal(result.suggestedQty, 16);
  assert.equal(result.urgency, 'critical');
  assert.equal(result.belowReorderPoint, true);
});

test('Configured target stock is honoured, including zero', () => {
  const configured = suggestedReorderQty({
    available: 4,
    reorderPoint: 10,
    targetStock: 15,
  });
  assert.equal(configured.targetStock, 15);
  assert.equal(configured.targetAssumed, false);
  assert.equal(configured.suggestedQty, 11);

  const zeroTarget = suggestedReorderQty({ available: 2, reorderPoint: 10, targetStock: 0 });
  assert.equal(zeroTarget.targetAssumed, false);
  assert.equal(zeroTarget.suggestedQty, 0);
});

test('Projected stock adds incoming once without double counting reservations', () => {
  const result = suggestedReorderQty({
    available: 2,
    reorderPoint: 10,
    targetStock: 20,
    incomingQty: 5,
  });
  assert.equal(result.projectedStock, 7);
  assert.equal(result.suggestedQty, 13);

  const covered = suggestedReorderQty({
    available: 2,
    reorderPoint: 10,
    targetStock: 20,
    incomingQty: 18,
  });
  assert.equal(covered.suggestedQty, 0);
});

test('Urgency reflects stockout and critical thresholds', () => {
  assert.equal(suggestedReorderQty({ available: 0, reorderPoint: 10 }).urgency, 'stockout');
  assert.equal(suggestedReorderQty({ available: 5, reorderPoint: 10 }).urgency, 'critical');
  assert.equal(suggestedReorderQty({ available: 6, reorderPoint: 10 }).urgency, 'low');
  assert.equal(suggestedReorderQty({ available: 11, reorderPoint: 10 }).urgency, null);
});

test('Reorder rows are unique per item and warehouse', () => {
  assert.equal(reorderRowKey(row()), 'item-1:warehouse-1');
  assert.equal(
    reorderRowKey(row({ warehouse_id: 'warehouse-2' })),
    'item-1:warehouse-2',
  );
  assert.equal(
    reorderRowKey(row({ warehouse_id: null })),
    'item-1:unassigned',
  );
});

test('Draft lines use edited quantities and skip non-positive lines', () => {
  const first = row();
  const second = row({ item_id: 'item-2', warehouse_id: 'warehouse-1', suggested_qty: '5' });
  const third = row({ item_id: 'item-3', warehouse_id: null, suggested_qty: '0' });
  const lines = buildReorderDraftLines(
    [first, second, third],
    {
      'item-1:warehouse-1': '7',
      'item-2:warehouse-1': '0',
    },
    () => 'key',
  );
  assert.equal(lines.length, 1);
  assert.deepEqual(
    {
      itemId: lines[0].itemId,
      qty: lines[0].qty,
      lotNo: lines[0].lotNo,
      expiryDate: lines[0].expiryDate,
      serials: lines[0].serials,
      discrepancyReason: lines[0].discrepancyReason,
    },
    {
      itemId: 'item-1',
      qty: '7',
      lotNo: '',
      expiryDate: '',
      serials: '',
      discrepancyReason: '',
    },
  );
});
