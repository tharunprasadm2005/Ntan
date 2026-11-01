import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPurchaseOrderLines,
  buildPurchaseOrderReceiveDraft,
  isPurchaseOrderReceivable,
  purchaseOrderLineError,
  purchaseOrderStatusLabels,
} from '../src/purchasing.ts';

function order(overrides = {}) {
  return {
    id: 'po-1',
    company_id: 'company-1',
    client_id: 'client-1',
    number: 'PO-20260101-ABC123',
    status: 'open',
    warehouse_id: 'warehouse-1',
    supplier_id: 'supplier-1',
    supplier_name: 'Apex Supplies',
    expected_date: '2026-02-01',
    note: null,
    line_count: 2,
    ordered_qty: '10',
    received_qty: '0',
    remaining_qty: '10',
    lines: [
      {
        id: 'line-1',
        item_id: 'item-1',
        sku: 'BOLT-M8',
        item_name: 'M8 bolt',
        uom: 'EA',
        base_uom: 'EA',
        ordered_qty: '6',
        received_qty: '2',
        remaining_qty: '4',
      },
      {
        id: 'line-2',
        item_id: 'item-2',
        sku: 'NUT-M8',
        item_name: 'M8 nut',
        uom: 'EA',
        base_uom: 'EA',
        ordered_qty: '4',
        received_qty: '4',
        remaining_qty: '0',
      },
    ],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    received_at: null,
    cancelled_at: null,
    ...overrides,
  };
}

test('only open or partially received orders with a balance can be received', () => {
  assert.equal(isPurchaseOrderReceivable(order()), true);
  assert.equal(isPurchaseOrderReceivable(order({ status: 'partially_received' })), true);
  assert.equal(isPurchaseOrderReceivable(order({ status: 'received' })), false);
  assert.equal(isPurchaseOrderReceivable(order({ status: 'cancelled' })), false);
  assert.equal(
    isPurchaseOrderReceivable(order({ status: 'open', remaining_qty: '0' })),
    false,
  );
  assert.equal(purchaseOrderStatusLabels.partially_received, 'Partially received');
});

test('receive prefill carries order context and only outstanding lines', () => {
  let counter = 0;
  const draft = buildPurchaseOrderReceiveDraft(order(), () => `key-${++counter}`);

  assert.equal(draft.lines.length, 1);
  assert.equal(draft.lines[0].itemId, 'item-1');
  assert.equal(draft.lines[0].qty, '4');
  assert.equal(draft.lines[0].orderedQty, '6');
  assert.equal(draft.lines[0].remainingQty, '4');
  assert.equal(draft.purchaseOrderId, 'po-1');
  assert.equal(draft.purchaseOrderNumber, 'PO-20260101-ABC123');
  assert.equal(draft.supplierId, 'supplier-1');
  assert.equal(draft.warehouseId, 'warehouse-1');
  assert.equal(draft.clientId, 'client-1');
  assert.equal(draft.purchaseOrderLines.length, 2);
  // Prefill is a form state only; nothing is committed from this helper.
  assert.equal(draft.pendingReceipt, null);
  assert.equal(draft.pendingKey, null);
});

test('purchase order lines use edited quantities and skip non-positive rows', () => {
  const rows = [
    {
      item_id: 'item-1',
      warehouse_id: 'warehouse-1',
      suggested_qty: '4',
      base_uom: 'EA',
    },
    {
      item_id: 'item-2',
      warehouse_id: 'warehouse-1',
      suggested_qty: '7',
      base_uom: 'EA',
    },
  ];
  const quantities = { 'item-1:warehouse-1': '9', 'item-2:warehouse-1': '0' };
  const lines = buildPurchaseOrderLines(
    rows,
    quantities,
    (row) => `${row.item_id}:${row.warehouse_id}`,
  );
  assert.deepEqual(lines, [{ item_id: 'item-1', qty: '9' }]);
});

test('receipt lines must stay within the outstanding order quantities', () => {
  const orderLines = order().lines.map((line) => ({
    itemId: line.item_id,
    sku: line.sku,
    itemName: line.item_name,
    uom: line.base_uom,
    lineId: line.id,
    orderedQty: line.ordered_qty,
    receivedQty: line.received_qty,
    remainingQty: line.remaining_qty,
  }));

  assert.equal(
    purchaseOrderLineError(
      [{ itemId: 'item-1', qty: '4' }],
      orderLines,
      'PO-20260101-ABC123',
    ),
    null,
  );
  assert.match(
    purchaseOrderLineError(
      [{ itemId: 'item-1', qty: '5' }],
      orderLines,
      'PO-20260101-ABC123',
    ),
    /only 4 EA remaining/,
  );
  assert.match(
    purchaseOrderLineError(
      [{ itemId: 'item-2', qty: '1' }],
      orderLines,
      'PO-20260101-ABC123',
    ),
    /only 0 EA remaining/,
  );
  assert.match(
    purchaseOrderLineError(
      [{ itemId: 'item-9', qty: '1' }],
      orderLines,
      'PO-20260101-ABC123',
    ),
    /not on purchase order/,
  );
  assert.match(
    purchaseOrderLineError(
      [
        { itemId: 'item-1', qty: '1' },
        { itemId: 'item-1', qty: '2' },
      ],
      orderLines,
      'PO-20260101-ABC123',
    ),
    /only once/,
  );
  assert.equal(
    purchaseOrderLineError(
      [
        { itemId: null, qty: '5' },
        { itemId: '', qty: '5' },
      ],
      orderLines,
      'PO-20260101-ABC123',
    ),
    null,
  );
});
