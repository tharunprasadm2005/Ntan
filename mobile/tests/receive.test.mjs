import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Mobile Domain Unit Tests for Receive Stock Workflow:
 * - Location classification (staging -> putaway vs direct storage)
 * - Header validation (warehouse, location, inventory owner, supplier-PO dependency)
 * - Line item validation (positive quantities, base unit matching)
 * - Lot tracking and ISO expiry date validation
 * - Serial tracking validation (1:1 serial to quantity count, duplicate serial rejection)
 * - Pre-commit review data aggregation
 * - Draft lifecycle and cancellation logic
 * - Line discrepancy / inspection notes
 */

function classifyLocationStorage(locationType) {
  const PUTAWAY_SOURCE_TYPES = new Set(['receiving', 'staging']);
  return {
    isStaging: PUTAWAY_SOURCE_TYPES.has(locationType),
    storageMethod: PUTAWAY_SOURCE_TYPES.has(locationType)
      ? 'Staging (Put-away required)'
      : 'Direct Storage (Immediate on-hand)',
    putawayRequired: PUTAWAY_SOURCE_TYPES.has(locationType),
  };
}

function parseSerials(raw) {
  if (!raw) return [];
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isIsoDate(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str);
}

function validateReceiveDelivery({
  warehouseId,
  locationId,
  clientId,
  supplier,
  purchaseOrder,
  lines,
  itemsMap = {}, // itemId -> item definition
}) {
  const errors = [];

  if (!warehouseId) {
    errors.push('Select a warehouse.');
  }
  if (!locationId) {
    errors.push('Select a receiving location.');
  }
  if (!clientId || clientId.toLowerCase() === 'all') {
    errors.push('Select the inventory owner.');
  }
  if (purchaseOrder && !supplier) {
    errors.push('A supplier is required when a purchase order reference is provided.');
  }

  if (!lines || lines.length === 0) {
    errors.push('At least one receipt line is required.');
    return { valid: false, errors };
  }

  const seenSerials = new Set();

  lines.forEach((line, index) => {
    const lineNum = index + 1;
    if (!line.itemId) {
      errors.push(`Line ${lineNum}: Select an item.`);
      return;
    }

    const item = itemsMap[line.itemId];
    if (!item || item.status !== 'active') {
      errors.push(`Line ${lineNum}: Item is invalid or inactive.`);
      return;
    }

    const qty = Number(line.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      errors.push(`Line ${lineNum}: Quantity must be greater than zero.`);
      return;
    }

    if (item.tracking_mode === 'lot') {
      if (!line.lotNo || !line.lotNo.trim()) {
        errors.push(`Line ${lineNum}: Lot number is required for lot-tracked items.`);
      }
    }

    if (item.expiry_tracked) {
      if (!line.expiryDate || !line.expiryDate.trim()) {
        errors.push(`Line ${lineNum}: Expiry date is required.`);
      } else if (!isIsoDate(line.expiryDate.trim())) {
        errors.push(`Line ${lineNum}: Expiry date must use YYYY-MM-DD format.`);
      }
    }

    if (item.tracking_mode === 'serial') {
      const serials = parseSerials(line.serials);
      if (!Number.isInteger(qty) || serials.length !== qty) {
        errors.push(
          `Line ${lineNum}: Must supply exactly one serial number per unit (${serials.length} serials for ${qty} units).`,
        );
      }

      // Check within-line and cross-line duplicates
      const lineSerialSet = new Set();
      for (const sn of serials) {
        if (lineSerialSet.has(sn)) {
          errors.push(`Line ${lineNum}: Duplicate serial "${sn}" in the same line.`);
        }
        lineSerialSet.add(sn);

        const key = `${item.id}:${sn}`;
        if (seenSerials.has(key)) {
          errors.push(`Line ${lineNum}: Serial "${sn}" appears multiple times in this delivery.`);
        }
        seenSerials.add(key);
      }
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}

function calculateReviewSummary(lines) {
  let totalUnits = 0;
  let totalSerials = 0;
  let lotCount = 0;
  let hasDiscrepancies = false;

  lines.forEach((l) => {
    const qty = Number(l.qty) || 0;
    totalUnits += qty;
    if (l.lotNo) lotCount += 1;
    if (l.serials) {
      totalSerials += parseSerials(l.serials).length;
    }
    if (l.discrepancyReason && l.discrepancyReason.trim()) {
      hasDiscrepancies = true;
    }
  });

  return {
    lineCount: lines.length,
    totalUnits,
    totalSerials,
    lotCount,
    hasDiscrepancies,
  };
}

// -------------------------------------------------------------
// TESTS
// -------------------------------------------------------------

test('Location classification distinguishes staging and direct storage', () => {
  const staging = classifyLocationStorage('receiving');
  assert.equal(staging.isStaging, true);
  assert.equal(staging.putawayRequired, true);
  assert.ok(staging.storageMethod.includes('Put-away'));

  const stage2 = classifyLocationStorage('staging');
  assert.equal(stage2.isStaging, true);
  assert.equal(stage2.putawayRequired, true);

  const bin = classifyLocationStorage('bin');
  assert.equal(bin.isStaging, false);
  assert.equal(bin.putawayRequired, false);
  assert.ok(bin.storageMethod.includes('Direct Storage'));

  const shelf = classifyLocationStorage('shelf');
  assert.equal(shelf.isStaging, false);
  assert.equal(shelf.putawayRequired, false);
});

test('Header validation enforces warehouse, location, owner and supplier-PO logic', () => {
  const items = { 'it-1': { id: 'it-1', status: 'active', tracking_mode: 'none' } };

  // Missing warehouse
  const res1 = validateReceiveDelivery({
    warehouseId: null,
    locationId: 'loc-1',
    clientId: 'cli-1',
    lines: [{ itemId: 'it-1', qty: '5' }],
    itemsMap: items,
  });
  assert.equal(res1.valid, false);
  assert.ok(res1.errors.some((e) => e.includes('warehouse')));

  // Missing location
  const res2 = validateReceiveDelivery({
    warehouseId: 'wh-1',
    locationId: null,
    clientId: 'cli-1',
    lines: [{ itemId: 'it-1', qty: '5' }],
    itemsMap: items,
  });
  assert.equal(res2.valid, false);
  assert.ok(res2.errors.some((e) => e.includes('location')));

  // PO entered without supplier
  const res3 = validateReceiveDelivery({
    warehouseId: 'wh-1',
    locationId: 'loc-1',
    clientId: 'cli-1',
    supplier: '',
    purchaseOrder: 'PO-2026-001',
    lines: [{ itemId: 'it-1', qty: '5' }],
    itemsMap: items,
  });
  assert.equal(res3.valid, false);
  assert.ok(res3.errors.some((e) => e.includes('supplier is required')));

  // Valid header
  const res4 = validateReceiveDelivery({
    warehouseId: 'wh-1',
    locationId: 'loc-1',
    clientId: 'cli-1',
    supplier: 'Apex Logistics',
    purchaseOrder: 'PO-2026-001',
    lines: [{ itemId: 'it-1', qty: '5' }],
    itemsMap: items,
  });
  assert.equal(res4.valid, true);
});

test('Line validation enforces positive quantity, lot number and ISO expiry date', () => {
  const items = {
    'it-standard': { id: 'it-standard', status: 'active', tracking_mode: 'none' },
    'it-lot': { id: 'it-lot', status: 'active', tracking_mode: 'lot', expiry_tracked: true },
  };

  // Zero quantity rejected
  const res1 = validateReceiveDelivery({
    warehouseId: 'wh-1',
    locationId: 'loc-1',
    clientId: 'cli-1',
    lines: [{ itemId: 'it-standard', qty: '0' }],
    itemsMap: items,
  });
  assert.equal(res1.valid, false);
  assert.ok(res1.errors.some((e) => e.includes('Quantity must be greater than zero')));

  // Lot item missing lot number and expiry date
  const res2 = validateReceiveDelivery({
    warehouseId: 'wh-1',
    locationId: 'loc-1',
    clientId: 'cli-1',
    lines: [{ itemId: 'it-lot', qty: '4', lotNo: '', expiryDate: '' }],
    itemsMap: items,
  });
  assert.equal(res2.valid, false);
  assert.ok(res2.errors.some((e) => e.includes('Lot number is required')));
  assert.ok(res2.errors.some((e) => e.includes('Expiry date is required')));

  // Invalid date format
  const res3 = validateReceiveDelivery({
    warehouseId: 'wh-1',
    locationId: 'loc-1',
    clientId: 'cli-1',
    lines: [{ itemId: 'it-lot', qty: '4', lotNo: 'LOT-99', expiryDate: '12/31/2027' }],
    itemsMap: items,
  });
  assert.equal(res3.valid, false);
  assert.ok(res3.errors.some((e) => e.includes('YYYY-MM-DD')));

  // Valid lot line
  const res4 = validateReceiveDelivery({
    warehouseId: 'wh-1',
    locationId: 'loc-1',
    clientId: 'cli-1',
    lines: [{ itemId: 'it-lot', qty: '4', lotNo: 'LOT-99', expiryDate: '2027-12-31' }],
    itemsMap: items,
  });
  assert.equal(res4.valid, true);
});

test('Serial validation enforces 1:1 count and rejects intra-line and cross-line duplicates', () => {
  const items = {
    'it-serial': { id: 'it-serial', status: 'active', tracking_mode: 'serial' },
  };

  // Serial count mismatch (2 units, 1 serial)
  const res1 = validateReceiveDelivery({
    warehouseId: 'wh-1',
    locationId: 'loc-1',
    clientId: 'cli-1',
    lines: [{ itemId: 'it-serial', qty: '2', serials: 'SN-001' }],
    itemsMap: items,
  });
  assert.equal(res1.valid, false);
  assert.ok(res1.errors.some((e) => e.includes('one serial number per unit')));

  // Duplicate serial in same line
  const res2 = validateReceiveDelivery({
    warehouseId: 'wh-1',
    locationId: 'loc-1',
    clientId: 'cli-1',
    lines: [{ itemId: 'it-serial', qty: '2', serials: 'SN-001\nSN-001' }],
    itemsMap: items,
  });
  assert.equal(res2.valid, false);
  assert.ok(res2.errors.some((e) => e.includes('Duplicate serial "SN-001" in the same line')));

  // Duplicate serial across lines
  const res3 = validateReceiveDelivery({
    warehouseId: 'wh-1',
    locationId: 'loc-1',
    clientId: 'cli-1',
    lines: [
      { itemId: 'it-serial', qty: '1', serials: 'SN-001' },
      { itemId: 'it-serial', qty: '1', serials: 'SN-001' },
    ],
    itemsMap: items,
  });
  assert.equal(res3.valid, false);
  assert.ok(res3.errors.some((e) => e.includes('appears multiple times in this delivery')));

  // Valid serial delivery
  const res4 = validateReceiveDelivery({
    warehouseId: 'wh-1',
    locationId: 'loc-1',
    clientId: 'cli-1',
    lines: [
      { itemId: 'it-serial', qty: '2', serials: 'SN-001\nSN-002' },
      { itemId: 'it-serial', qty: '1', serials: 'SN-003' },
    ],
    itemsMap: items,
  });
  assert.equal(res4.valid, true);
});

test('Review summary aggregates units, lots, serials and inspection notes', () => {
  const lines = [
    { itemId: 'it-1', qty: '10', lotNo: 'LOT-A', discrepancyReason: 'Slight carton scuff' },
    { itemId: 'it-2', qty: '2', serials: 'SN-10\nSN-11' },
    { itemId: 'it-3', qty: '5' },
  ];

  const summary = calculateReviewSummary(lines);
  assert.equal(summary.lineCount, 3);
  assert.equal(summary.totalUnits, 17);
  assert.equal(summary.totalSerials, 2);
  assert.equal(summary.lotCount, 1);
  assert.equal(summary.hasDiscrepancies, true);
});

test('Continuous scanner helpers: frame deduplication, planning, and serial appending', async () => {
  const {
    shouldAcceptCameraScan,
    planItemScan,
    appendScannedSerial,
    receiveScanSummary,
    parseScanQuantity,
  } = await import('../src/receiveScanner.ts');

  // Camera deduplication gate: duplicate frames within window rejected
  const gate = { code: '8901234567890', at: 1000 };
  assert.equal(shouldAcceptCameraScan(gate, '8901234567890', 1200, 1500), false);
  // Deliberate re-scan after gate window accepted
  assert.equal(shouldAcceptCameraScan(gate, '8901234567890', 2600, 1500), true);
  // Different barcode scanned immediately accepted
  assert.equal(shouldAcceptCameraScan(gate, '8901234567891', 1200, 1500), true);

  // Item scan plan: repeated scan increments quantity
  const existingLines = [{ key: 'line-1', itemId: 'it-1', qty: '3' }];
  const incrementPlan = planItemScan(existingLines, { itemId: 'it-1', quantity: 2 });
  assert.equal(incrementPlan.mode, 'increment');
  assert.equal(incrementPlan.lineKey, 'line-1');
  assert.equal(incrementPlan.quantity, 2);

  // Item scan plan: new item adds line
  const addPlan = planItemScan(existingLines, { itemId: 'it-2', quantity: 1 });
  assert.equal(addPlan.mode, 'add');
  assert.equal(addPlan.lineKey, null);

  // Serial appending and deduplication
  const s1 = appendScannedSerial('SN-001', 'SN-002');
  assert.equal(s1.error, null);
  assert.equal(s1.values.length, 2);
  assert.equal(s1.serials, 'SN-001\nSN-002');

  const sDup = appendScannedSerial(s1.serials, 'SN-001');
  assert.ok(sDup.error?.includes('already on this line'));

  // Running summary without inventory mutation
  const summary = receiveScanSummary([
    { key: '1', itemId: 'it-1', qty: '5' },
    { key: '2', itemId: 'it-2', qty: '2.5' },
    { key: '3', itemId: null, qty: '0' },
  ]);
  assert.equal(summary.lineCount, 2);
  assert.equal(summary.unitCount, 7.5);

  // Manual quantity parser validation
  assert.equal(parseScanQuantity('10'), 10);
  assert.equal(parseScanQuantity('2,5'), 2.5);
  assert.equal(parseScanQuantity(''), 1);
  assert.equal(parseScanQuantity('-5'), null);
});

test('Persisted receive drafts: serialization, isolation scope, and lifecycle recovery', async () => {
  const {
    serializeReceiveDraft,
    parseStoredReceiveDraft,
    savePersistedReceiveDraft,
    loadPersistedReceiveDraft,
    clearPersistedReceiveDraft,
    receiveDraftContextKey,
  } = await import('../src/receiveDraftStore.ts');

  const memoryStore = new Map();
  const mockStorage = {
    async getItem(key) {
      return memoryStore.get(key) ?? null;
    },
    async setItem(key, val) {
      memoryStore.set(key, val);
    },
    async removeItem(key) {
      memoryStore.delete(key);
    },
  };

  const scope = {
    companyId: 'comp-100',
    userId: 'user-200',
    contextKey: receiveDraftContextKey({ warehouseId: 'wh-1', locationId: 'loc-1' }),
  };

  const draft = {
    lines: [{ key: 'k1', itemId: 'it-1', qty: '10', lotNo: '', expiryDate: '', serials: '', discrepancyReason: '' }],
    clientId: 'cli-1',
    warehouseId: 'wh-1',
    locationId: 'loc-1',
    supplier: 'Supplier Corp',
    supplierId: 'sup-1',
    purchaseOrder: 'PO-900',
    purchaseOrderId: 'po-1',
    purchaseOrderNumber: 'PO-900',
    purchaseOrderLines: [],
    note: 'Delivery note test',
    deliveryNote: 'DN-88',
    pendingReceipt: null,
    pendingKey: null,
  };

  // Save
  const saved = await savePersistedReceiveDraft(mockStorage, scope, draft);
  assert.equal(saved, true);

  // Load by correct user & company
  const loaded = await loadPersistedReceiveDraft(mockStorage, 'comp-100', 'user-200');
  assert.ok(loaded);
  assert.equal(loaded.draft.lines.length, 1);
  assert.equal(loaded.draft.lines[0].itemId, 'it-1');
  assert.equal(loaded.draft.lines[0].qty, '10');

  // Tenant / user isolation check: another user cannot load draft
  const unauthorizedUser = await loadPersistedReceiveDraft(mockStorage, 'comp-100', 'other-user');
  assert.equal(unauthorizedUser, null);

  // Clear
  await clearPersistedReceiveDraft(mockStorage, scope);
  const cleared = await loadPersistedReceiveDraft(mockStorage, 'comp-100', 'user-200');
  assert.equal(cleared, null);
});
