import assert from 'node:assert/strict';
import test from 'node:test';

import {
  draftReceipts,
  receiptUnits,
  warehouseAvailability,
} from '../src/logistics.ts';

function receipt(overrides = {}) {
  return {
    id: 'receipt-1',
    number: 'RCV-001',
    status: 'draft',
    warehouse_id: 'warehouse-1',
    location_id: 'location-1',
    supplier: 'Acme',
    purchase_order: null,
    note: null,
    discrepancy_reason: null,
    lines: [
      {
        id: 'line-1',
        item_id: 'item-1',
        sku: 'BOLT-M8',
        item_name: 'M8 bolt',
        qty: '2',
        uom: 'EA',
        base_qty: '2',
        base_uom: 'EA',
        location_id: 'location-1',
        lot_id: null,
        serial_no: null,
        discrepancy_reason: null,
      },
    ],
    created_at: '2026-10-23T08:00:00Z',
    updated_at: '2026-10-23T08:00:00Z',
    committed_at: null,
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
    on_hand: '7',
    reserved: '0',
    blocked: '0',
    available: '7',
    version: 1,
    updated_at: '2026-10-23T08:00:00Z',
    ...overrides,
  };
}

test('totals receipt lines in base units', () => {
  const total = receiptUnits(
    receipt({
      lines: [
        receipt().lines[0],
        { ...receipt().lines[0], id: 'line-2', base_qty: '3.5' },
      ],
    }),
  );
  assert.equal(total, 5.5);
});

test('queues only drafts, oldest first', () => {
  const entries = draftReceipts([
    receipt({ id: 'newer', created_at: '2026-10-23T10:00:00Z' }),
    receipt({
      id: 'applied',
      status: 'applied',
      created_at: '2026-10-23T07:00:00Z',
    }),
    receipt({ id: 'older', created_at: '2026-10-23T08:00:00Z' }),
  ]);
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ['older', 'newer'],
  );
});

test('summarizes available stock and locations by warehouse', () => {
  const warehouses = [
    { id: 'warehouse-1', name: 'Main', address: null, status: 'active' },
    { id: 'warehouse-2', name: 'North', address: null, status: 'active' },
  ];
  const locations = [
    { id: 'location-1', warehouse_id: 'warehouse-1', parent_id: null, code: 'MAIN', type: 'main', status: 'active' },
    { id: 'location-2', warehouse_id: 'warehouse-1', parent_id: null, code: 'RECV', type: 'receiving', status: 'active' },
    { id: 'location-3', warehouse_id: 'warehouse-2', parent_id: null, code: 'MAIN', type: 'main', status: 'archived' },
  ];
  const balances = [
    balance(),
    balance({ id: 'balance-2', item_id: 'item-2', available: '3', on_hand: '3' }),
    balance({
      id: 'balance-3',
      warehouse_id: 'warehouse-2',
      item_id: 'item-3',
      available: '9',
      on_hand: '9',
    }),
    balance({
      id: 'balance-4',
      item_id: 'item-4',
      stock_status: 'blocked',
      available: '0',
      on_hand: '4',
    }),
  ];

  const rows = warehouseAvailability(warehouses, locations, balances);
  assert.equal(rows[0].warehouse.id, 'warehouse-1');
  assert.equal(rows[0].available, 10);
  assert.equal(rows[0].stockedSkus, 2);
  assert.equal(rows[0].locationCount, 2);
  assert.equal(rows[0].share, 100);
  assert.equal(rows[1].warehouse.id, 'warehouse-2');
  assert.equal(rows[1].available, 9);
  assert.equal(rows[1].locationCount, 0);
  assert.equal(rows[1].share, 90);
});
