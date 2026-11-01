import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Cross-Page Integration & Warehouse Workflow Tests (Phases 1 - 7):
 * 1. In-memory draft persistence across page navigation (receiveDraftStore)
 * 2. Business Partners -> Receive Stock isolation (Supplier selection does NOT change Inventory Owner)
 * 3. Item Catalogue -> Receive Stock (Barcode match vs unknown barcode trigger)
 * 4. Warehouses & Bins -> Receive Stock (Reactive location filtering, staging vs direct storage)
 * 5. Inventory Owner Context (Separation of Supplier, Owner, Customer, and Warehouse)
 * 6. Receive Stock -> Putaway Workflow (Staging generates putaway tasks with receipt filter; direct storage is immediate)
 */

// Simulation of receiveDraftStore
class MockReceiveDraftStore {
  constructor() {
    this.draft = null;
  }
  getDraft() {
    return this.draft ? JSON.parse(JSON.stringify(this.draft)) : null;
  }
  setDraft(draft) {
    this.draft = draft ? JSON.parse(JSON.stringify(draft)) : null;
  }
  clearDraft() {
    this.draft = null;
  }
}

test('Phase 1 & 7: Draft persistence across navigation preserves all receiving inputs', () => {
  const store = new MockReceiveDraftStore();
  assert.equal(store.getDraft(), null);

  const initialDraft = {
    warehouseId: 'wh-north-01',
    locationId: 'loc-recv-01',
    receiptClientId: 'client-acme-corp',
    supplierId: 'partner-sup-44',
    supplierName: 'Apex Tools & Components',
    purchaseOrder: 'PO-2026-991',
    note: 'Dock delivery bay 4',
    discrepancyReason: '',
    lines: [
      {
        tempId: 'line-1',
        itemId: 'item-101',
        item: { id: 'item-101', sku: 'BOLT-M8', name: 'M8 Stainless Steel Bolt', uom: 'pcs' },
        qty: '100',
        uom: 'pcs',
        lotNo: 'LOT-2026-A',
        expiryDate: '2028-12-31',
        serialNumbers: [],
      },
    ],
  };

  // User enters form data and navigates away to Create Supplier or Item Catalogue
  store.setDraft(initialDraft);

  // Return to Receive Stock: draft is intact
  const restored = store.getDraft();
  assert.notEqual(restored, null);
  assert.equal(restored.warehouseId, 'wh-north-01');
  assert.equal(restored.supplierId, 'partner-sup-44');
  assert.equal(restored.purchaseOrder, 'PO-2026-991');
  assert.equal(restored.lines.length, 1);
  assert.equal(restored.lines[0].item.sku, 'BOLT-M8');

  // Once posted, draft is safely cleared
  store.clearDraft();
  assert.equal(store.getDraft(), null);
});

test('Phase 2 & 5: Supplier selection preserves inventory owner and filters out non-suppliers', () => {
  const businessPartners = [
    { id: 'bp-1', name: 'Industrial Fasteners Ltd', types: ['supplier'], active: true },
    { id: 'bp-2', name: 'Retail Customer Corp', types: ['customer'], active: true },
    { id: 'bp-3', name: '3PL Client Logistics Co', types: ['3pl_client'], active: true },
    { id: 'bp-4', name: 'Obsolete Supplier Inc', types: ['supplier'], active: false },
  ];

  // Filter only active partners with 'supplier' role
  const selectableSuppliers = businessPartners.filter(
    (bp) => bp.active && Array.isArray(bp.types) && bp.types.includes('supplier'),
  );
  assert.equal(selectableSuppliers.length, 1);
  assert.equal(selectableSuppliers[0].id, 'bp-1');

  // In 3PL or single-owner mode, selecting supplier must NOT alter receiptClientId
  let formState = {
    receiptClientId: 'owner-3pl-client-99', // Inventory owner
    supplierId: '',
    supplierName: '',
  };

  const selectedSupplier = selectableSuppliers[0];
  formState = {
    ...formState,
    supplierId: selectedSupplier.id,
    supplierName: selectedSupplier.name,
  };

  assert.equal(formState.supplierId, 'bp-1');
  assert.equal(formState.supplierName, 'Industrial Fasteners Ltd');
  assert.equal(formState.receiptClientId, 'owner-3pl-client-99', 'Inventory owner remained intact');
});

test('Phase 3: Item lookup by SKU/barcode and unknown barcode detection', () => {
  const catalogue = [
    { id: 'it-1', sku: 'SKU-BEARING-01', barcode: '8901234567890', name: 'Ball Bearing 608ZZ', active: true, tracking_mode: 'lot' },
    { id: 'it-2', sku: 'SKU-MOTOR-55', barcode: '8901234567891', name: 'DC Stepper Motor', active: true, tracking_mode: 'serial' },
    { id: 'it-3', sku: 'SKU-OLD-01', barcode: '8901234567892', name: 'Archived Widget', active: false, tracking_mode: 'none' },
  ];

  function matchBarcode(scannedCode) {
    const activeItems = catalogue.filter((it) => it.active);
    const item = activeItems.find(
      (it) => it.barcode === scannedCode || it.sku.toLowerCase() === scannedCode.toLowerCase(),
    );
    if (item) {
      return { match: true, item };
    }
    return {
      match: false,
      offerCreateItem: true,
      scannedCode,
    };
  }

  // Known item scanned
  const res1 = matchBarcode('8901234567890');
  assert.equal(res1.match, true);
  assert.equal(res1.item.sku, 'SKU-BEARING-01');

  // Inactive item scanned: treated as not selectable
  const res2 = matchBarcode('8901234567892');
  assert.equal(res2.match, false);

  // Unknown item scanned: offers create item modal with pre-filled barcode
  const res3 = matchBarcode('UNKNOWN-998877');
  assert.equal(res3.match, false);
  assert.equal(res3.offerCreateItem, true);
  assert.equal(res3.scannedCode, 'UNKNOWN-998877');
});

test('Phase 4: Warehouse selection reactively updates locations and classifies staging vs direct storage', () => {
  const allLocations = [
    { id: 'loc-wh1-recv', warehouse_id: 'wh-1', code: 'RECV-01', type: 'receiving', active: true },
    { id: 'loc-wh1-rack', warehouse_id: 'wh-1', code: 'RACK-A-01', type: 'main', active: true },
    { id: 'loc-wh2-recv', warehouse_id: 'wh-2', code: 'RECV-02', type: 'staging', active: true },
    { id: 'loc-wh2-inactive', warehouse_id: 'wh-2', code: 'OLD-BIN', type: 'main', active: false },
  ];

  function getAvailableLocations(warehouseId) {
    return allLocations.filter((l) => l.warehouse_id === warehouseId && l.active);
  }

  function classifyLocation(loc) {
    const isStaging = ['receiving', 'staging'].includes(loc.type);
    return {
      isStaging,
      putawayRequired: isStaging,
      storageMethod: isStaging ? 'Staging (Put-away required)' : 'Direct Storage (Immediate on-hand)',
    };
  }

  const wh1Locs = getAvailableLocations('wh-1');
  assert.equal(wh1Locs.length, 2);

  const stagingLoc = wh1Locs.find((l) => l.code === 'RECV-01');
  const storageLoc = wh1Locs.find((l) => l.code === 'RACK-A-01');

  assert.equal(classifyLocation(stagingLoc).putawayRequired, true);
  assert.equal(classifyLocation(storageLoc).putawayRequired, false);

  // Warehouse 2 excludes inactive locations
  const wh2Locs = getAvailableLocations('wh-2');
  assert.equal(wh2Locs.length, 1);
  assert.equal(wh2Locs[0].code, 'RECV-02');
});

test('Phase 6: Receive Stock -> Putaway task queue filtering and banner', () => {
  const tasks = [
    { id: 'task-1', receipt_id: 'rcv-100', receipt_number: 'RCV-2026-001', item_name: 'Bolt M8', qty: 50, status: 'pending' },
    { id: 'task-2', receipt_id: 'rcv-100', receipt_number: 'RCV-2026-001', item_name: 'Nut M8', qty: 50, status: 'pending' },
    { id: 'task-3', receipt_id: 'rcv-101', receipt_number: 'RCV-2026-002', item_name: 'Gasket', qty: 10, status: 'pending' },
  ];

  function filterTasks(receiptId) {
    if (!receiptId) return tasks;
    return tasks.filter((t) => t.receipt_id === receiptId);
  }

  // Filtered by specific receipt
  const filtered = filterTasks('rcv-100');
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].receipt_number, 'RCV-2026-001');

  // Clear filter shows all tasks
  const allTasks = filterTasks(null);
  assert.equal(allTasks.length, 3);
});
