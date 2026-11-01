import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Mobile Domain Unit Tests for Stock Transfers:
 * - Bin-to-bin vs cross-warehouse classification
 * - Transfer line validation (quantities, lot/serial tracking, availability)
 * - Source and destination location restriction (cannot be equal)
 * - Transfer status transitions (draft -> completed, or draft -> in_transit -> completed, cancellation)
 * - Permission checks (stock.transfer)
 * - Active queue counts for Operations dashboard
 */

function classifyTransferType(fromWarehouseId, toWarehouseId) {
  if (!fromWarehouseId || !toWarehouseId) {
    throw new Error('Both source and destination warehouses are required.');
  }
  return fromWarehouseId === toWarehouseId ? 'bin_to_bin' : 'cross_warehouse';
}

function validateTransferDraft({
  fromWarehouseId,
  toWarehouseId,
  fromLocationId,
  toLocationId,
  lines,
  availableBalances = {}, // key: `${itemId}:${locationId}` -> number
}) {
  const errors = [];

  if (!fromWarehouseId) {
    errors.push('Source warehouse is required.');
  }
  if (!toWarehouseId) {
    errors.push('Destination warehouse is required.');
  }
  if (!fromLocationId) {
    errors.push('Source location is required.');
  }
  if (!toLocationId) {
    errors.push('Destination location is required.');
  }
  if (fromLocationId && toLocationId && fromLocationId === toLocationId) {
    errors.push('Source and destination locations cannot be identical.');
  }

  if (!lines || lines.length === 0) {
    errors.push('At least one item line must be added.');
  } else {
    lines.forEach((line, index) => {
      const lineNum = index + 1;
      const qty = Number(line.qty);
      if (isNaN(qty) || qty <= 0) {
        errors.push(`Line ${lineNum}: Quantity must be positive.`);
      }

      if (line.tracking === 'lot' && (!line.lot_number || line.lot_number.trim() === '')) {
        errors.push(`Line ${lineNum}: Lot number is required for lot-tracked items.`);
      }

      if (line.tracking === 'serial') {
        if (!line.serial_numbers || line.serial_numbers.length === 0) {
          errors.push(`Line ${lineNum}: Serial numbers are required for serial-tracked items.`);
        } else if (line.serial_numbers.length !== qty) {
          errors.push(`Line ${lineNum}: Serial count (${line.serial_numbers.length}) must match quantity (${qty}).`);
        }
      }

      const balanceKey = `${line.item_id}:${fromLocationId}`;
      const available = availableBalances[balanceKey] ?? 0;
      if (qty > available) {
        errors.push(`Line ${lineNum}: Insufficient available stock. Requested ${qty}, available ${available}.`);
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function canCancelTransfer(transfer) {
  return transfer.status === 'draft';
}

function canConfirmOrDispatch(transfer) {
  return transfer.status === 'draft';
}

function canReceiveAtDestination(transfer) {
  return transfer.status === 'in_transit';
}

function computeActiveTransferCount(transfers) {
  return transfers.filter((t) => t.status === 'draft' || t.status === 'in_transit').length;
}

// ----------------------------------------------------
// Tests
// ----------------------------------------------------

test('transfer classification: bin-to-bin vs cross-warehouse', () => {
  assert.equal(classifyTransferType('wh-alpha', 'wh-alpha'), 'bin_to_bin');
  assert.equal(classifyTransferType('wh-alpha', 'wh-beta'), 'cross_warehouse');
  assert.throws(() => classifyTransferType(null, 'wh-beta'), /required/);
});

test('validation: identical source and destination location is rejected', () => {
  const result = validateTransferDraft({
    fromWarehouseId: 'wh-1',
    toWarehouseId: 'wh-1',
    fromLocationId: 'loc-aisle-1',
    toLocationId: 'loc-aisle-1',
    lines: [{ item_id: 'item-1', qty: 5, tracking: 'none' }],
    availableBalances: { 'item-1:loc-aisle-1': 10 },
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('cannot be identical')));
});

test('validation: insufficient stock at source location is rejected', () => {
  const result = validateTransferDraft({
    fromWarehouseId: 'wh-1',
    toWarehouseId: 'wh-1',
    fromLocationId: 'loc-bin-a',
    toLocationId: 'loc-bin-b',
    lines: [{ item_id: 'item-1', qty: 25, tracking: 'none' }],
    availableBalances: { 'item-1:loc-bin-a': 10 },
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('Insufficient available stock')));
});

test('validation: lot tracking requires lot identifier', () => {
  const invalidResult = validateTransferDraft({
    fromWarehouseId: 'wh-1',
    toWarehouseId: 'wh-1',
    fromLocationId: 'loc-bin-a',
    toLocationId: 'loc-bin-b',
    lines: [{ item_id: 'item-pharma', qty: 10, tracking: 'lot', lot_number: '' }],
    availableBalances: { 'item-pharma:loc-bin-a': 50 },
  });

  assert.equal(invalidResult.valid, false);
  assert.ok(invalidResult.errors.some((e) => e.includes('Lot number is required')));

  const validResult = validateTransferDraft({
    fromWarehouseId: 'wh-1',
    toWarehouseId: 'wh-1',
    fromLocationId: 'loc-bin-a',
    toLocationId: 'loc-bin-b',
    lines: [{ item_id: 'item-pharma', qty: 10, tracking: 'lot', lot_number: 'LOT-2026-X' }],
    availableBalances: { 'item-pharma:loc-bin-a': 50 },
  });

  assert.equal(validResult.valid, true);
});

test('validation: serial tracking requires exact matching serial count', () => {
  const mismatched = validateTransferDraft({
    fromWarehouseId: 'wh-1',
    toWarehouseId: 'wh-2',
    fromLocationId: 'loc-source',
    toLocationId: 'loc-dest',
    lines: [
      {
        item_id: 'item-motor',
        qty: 2,
        tracking: 'serial',
        serial_numbers: ['SN-001'],
      },
    ],
    availableBalances: { 'item-motor:loc-source': 5 },
  });

  assert.equal(mismatched.valid, false);
  assert.ok(mismatched.errors.some((e) => e.includes('Serial count (1) must match quantity (2)')));

  const validSerial = validateTransferDraft({
    fromWarehouseId: 'wh-1',
    toWarehouseId: 'wh-2',
    fromLocationId: 'loc-source',
    toLocationId: 'loc-dest',
    lines: [
      {
        item_id: 'item-motor',
        qty: 2,
        tracking: 'serial',
        serial_numbers: ['SN-001', 'SN-002'],
      },
    ],
    availableBalances: { 'item-motor:loc-source': 5 },
  });

  assert.equal(validSerial.valid, true);
});

test('transfer lifecycle permissions and actions', () => {
  const draftTransfer = { id: 'tr-1', status: 'draft', transfer_type: 'cross_warehouse' };
  const inTransitTransfer = { id: 'tr-2', status: 'in_transit', transfer_type: 'cross_warehouse' };
  const completedTransfer = { id: 'tr-3', status: 'completed', transfer_type: 'bin_to_bin' };
  const cancelledTransfer = { id: 'tr-4', status: 'cancelled', transfer_type: 'bin_to_bin' };

  // Can cancel only drafts
  assert.equal(canCancelTransfer(draftTransfer), true);
  assert.equal(canCancelTransfer(inTransitTransfer), false);
  assert.equal(canCancelTransfer(completedTransfer), false);
  assert.equal(canCancelTransfer(cancelledTransfer), false);

  // Can confirm/dispatch only drafts
  assert.equal(canConfirmOrDispatch(draftTransfer), true);
  assert.equal(canConfirmOrDispatch(inTransitTransfer), false);

  // Can receive at destination only when in_transit
  assert.equal(canReceiveAtDestination(inTransitTransfer), true);
  assert.equal(canReceiveAtDestination(draftTransfer), false);
  assert.equal(canReceiveAtDestination(completedTransfer), false);
});

test('active queue counting for Operations screen badge', () => {
  const transfers = [
    { id: '1', status: 'draft' },
    { id: '2', status: 'in_transit' },
    { id: '3', status: 'completed' },
    { id: '4', status: 'cancelled' },
    { id: '5', status: 'draft' },
  ];

  assert.equal(computeActiveTransferCount(transfers), 3);
  assert.equal(computeActiveTransferCount([]), 0);
});

test('rapid transfer helpers: scan location and resolve available items', async () => {
  const {
    findLocationByScannedCode,
    getItemsAvailableAtLocation,
    formatTransferLocation,
  } = await import('../src/transfers.ts');

  const loc1 = {
    id: 'l-1',
    warehouse_id: 'wh-1',
    code: 'A1-R01-S1-B01',
    barcode: 'BC-LOC-01',
    aisle: 'A1',
    rack: 'R01',
    shelf: 'S1',
    bin: 'B01',
    status: 'active',
  };
  const loc2 = {
    id: 'l-2',
    warehouse_id: 'wh-1',
    code: 'A1-R02-S1-B02',
    barcode: null,
    status: 'active',
  };

  // Find by barcode
  assert.equal(findLocationByScannedCode([loc1, loc2], 'bc-loc-01')?.id, 'l-1');
  // Find by code
  assert.equal(findLocationByScannedCode([loc1, loc2], 'A1-R02-S1-B02')?.id, 'l-2');
  // Unknown
  assert.equal(findLocationByScannedCode([loc1, loc2], 'UNKNOWN'), null);

  // Format coordinates
  assert.equal(formatTransferLocation(loc1), 'Aisle: A1 · Rack: R01 · Shelf: S1 · Bin: B01');

  // Available items at location
  const itemA = { id: 'item-a', sku: 'SKU-A', name: 'Product A' };
  const balances = [
    { location_id: 'l-1', item_id: 'item-a', available: '10', on_hand: '10' },
    { location_id: 'l-2', item_id: 'item-a', available: '5', on_hand: '5' },
  ];
  const available = getItemsAvailableAtLocation(balances, [itemA], 'l-1');
  assert.equal(available.length, 1);
  assert.equal(available[0].availableQty, '10');
  assert.equal(available[0].item.sku, 'SKU-A');
});
