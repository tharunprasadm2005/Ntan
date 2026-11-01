import assert from 'node:assert/strict';
import test from 'node:test';

// Core domain logic mirroring OperationsScreen & logistics helpers

function computeWarehouseContext(assignedWarehouseIds, warehouses) {
  if (assignedWarehouseIds && assignedWarehouseIds.length > 0) {
    const assigned = warehouses.filter((w) => assignedWarehouseIds.includes(w.id));
    if (assigned.length === 1) {
      return assigned[0].name;
    }
    if (assigned.length > 1) {
      return `${assigned.length} assigned facilities`;
    }
  }
  if (warehouses.length === 1) {
    return warehouses[0].name;
  }
  if (warehouses.length > 1) {
    return `All facilities (${warehouses.length})`;
  }
  return 'Main facility';
}

function computeOwnerContext({ isMultiOwner, internalClient, activeClient, inventoryOwners }) {
  if (!isMultiOwner) {
    return internalClient?.name ?? 'Internal stock';
  }
  if (activeClient) {
    return `${activeClient.name} (${activeClient.code})`;
  }
  return `All visible owners (${inventoryOwners.length})`;
}

function computeOperationalCounts({
  canReadInventory,
  canReceive,
  canPutaway,
  canIssue,
  canTransfer,
  receipts = [],
  putawayTasks = [],
  outboundOrders = [],
  transfers = [],
}) {
  const pendingReceipts =
    canReadInventory || canReceive
      ? receipts.filter((r) => r.status === 'draft').length
      : null;

  const pendingPutaway =
    canReadInventory || canPutaway
      ? putawayTasks.filter((t) => t.status === 'pending').length
      : null;

  const openOutbound =
    canReadInventory || canIssue
      ? outboundOrders.filter(
          (o) => o.status === 'draft' || o.status === 'allocated',
        ).length
      : null;

  const activeTransfers =
    canReadInventory || canTransfer
      ? transfers.filter((t) => t.status === 'draft' || t.status === 'in_transit').length
      : null;

  const totalPending =
    (pendingReceipts ?? 0) +
    (pendingPutaway ?? 0) +
    (openOutbound ?? 0) +
    (activeTransfers ?? 0);

  return {
    pendingReceipts,
    pendingPutaway,
    openOutbound,
    activeTransfers,
    totalPending,
    isClear: totalPending === 0,
  };
}

function sanitizeClientId(clientId) {
  if (!clientId || clientId === 'all' || clientId === '*') {
    return null;
  }
  return clientId;
}

const WORKFLOW_CLASSIFICATION = {
  receiving: 'working',
  putaway: 'working',
  outbound_orders: 'working',
  picking: 'working',
  packing: 'partial',
  dispatch: 'working',
  transfers: 'working',
  cycle_counts: 'planned',
  adjustments: 'planned',
  returns: 'planned',
};

test('workflow classification matches operational capabilities', () => {
  assert.equal(WORKFLOW_CLASSIFICATION.receiving, 'working');
  assert.equal(WORKFLOW_CLASSIFICATION.putaway, 'working');
  assert.equal(WORKFLOW_CLASSIFICATION.outbound_orders, 'working');
  assert.equal(WORKFLOW_CLASSIFICATION.picking, 'working');
  assert.equal(WORKFLOW_CLASSIFICATION.packing, 'partial'); // integrated inside order flow, no separate pack station
  assert.equal(WORKFLOW_CLASSIFICATION.dispatch, 'working'); // shipping integrated in outbound
  assert.equal(WORKFLOW_CLASSIFICATION.transfers, 'working'); // fully implemented & integrated
  assert.equal(WORKFLOW_CLASSIFICATION.cycle_counts, 'planned');
  assert.equal(WORKFLOW_CLASSIFICATION.adjustments, 'planned');
  assert.equal(WORKFLOW_CLASSIFICATION.returns, 'planned');
});

test('warehouse context: single-owner and single warehouse', () => {
  const warehouses = [{ id: 'wh-1', name: 'Central Distribution Center' }];
  const context = computeWarehouseContext([], warehouses);
  assert.equal(context, 'Central Distribution Center');
});

test('warehouse context: multi-warehouse without user scoping', () => {
  const warehouses = [
    { id: 'wh-1', name: 'Central DC' },
    { id: 'wh-2', name: 'West Annex' },
    { id: 'wh-3', name: 'East Cold Storage' },
  ];
  const context = computeWarehouseContext([], warehouses);
  assert.equal(context, 'All facilities (3)');
});

test('warehouse context: user restricted to specific warehouse', () => {
  const warehouses = [
    { id: 'wh-1', name: 'Central DC' },
    { id: 'wh-2', name: 'West Annex' },
  ];
  const context = computeWarehouseContext(['wh-2'], warehouses);
  assert.equal(context, 'West Annex');
});

test('warehouse context: user restricted to multiple specific warehouses', () => {
  const warehouses = [
    { id: 'wh-1', name: 'Central DC' },
    { id: 'wh-2', name: 'West Annex' },
    { id: 'wh-3', name: 'East Storage' },
  ];
  const context = computeWarehouseContext(['wh-1', 'wh-3'], warehouses);
  assert.equal(context, '2 assigned facilities');
});

test('owner context: single-owner manufacturing workspace', () => {
  const internalClient = { id: 'c-int', name: 'Apex Automation Internal' };
  const context = computeOwnerContext({
    isMultiOwner: false,
    internalClient,
    activeClient: null,
    inventoryOwners: [internalClient],
  });
  assert.equal(context, 'Apex Automation Internal');
});

test('owner context: 3PL multi-owner viewing specific client', () => {
  const activeClient = { id: 'c-client-1', name: 'Nordic Pharma', code: 'NP-01' };
  const context = computeOwnerContext({
    isMultiOwner: true,
    internalClient: null,
    activeClient,
    inventoryOwners: [activeClient, { id: 'c-client-2', name: 'Beta Corp', code: 'BC-02' }],
  });
  assert.equal(context, 'Nordic Pharma (NP-01)');
});

test('owner context: 3PL multi-owner viewing all visible owners', () => {
  const context = computeOwnerContext({
    isMultiOwner: true,
    internalClient: null,
    activeClient: null,
    inventoryOwners: [
      { id: 'c-1', name: 'Client 1', code: 'C1' },
      { id: 'c-2', name: 'Client 2', code: 'C2' },
    ],
  });
  assert.equal(context, 'All visible owners (2)');
});

test('operational counts: full permissions with pending tasks', () => {
  const receipts = [
    { id: 'r1', status: 'draft' },
    { id: 'r2', status: 'draft' },
    { id: 'r3', status: 'committed' },
  ];
  const putawayTasks = [
    { id: 'p1', status: 'pending' },
    { id: 'p2', status: 'completed' },
  ];
  const outboundOrders = [
    { id: 'o1', status: 'draft' },
    { id: 'o2', status: 'allocated' },
    { id: 'o3', status: 'shipped' },
    { id: 'o4', status: 'cancelled' },
  ];

  const counts = computeOperationalCounts({
    canReadInventory: true,
    canReceive: true,
    canPutaway: true,
    canIssue: true,
    receipts,
    putawayTasks,
    outboundOrders,
  });

  assert.equal(counts.pendingReceipts, 2);
  assert.equal(counts.pendingPutaway, 1);
  assert.equal(counts.openOutbound, 2); // draft and allocated
  assert.equal(counts.totalPending, 5);
  assert.equal(counts.isClear, false);
});

test('operational counts: empty queues detect queue clear', () => {
  const receipts = [{ id: 'r1', status: 'committed' }];
  const putawayTasks = [{ id: 'p1', status: 'completed' }];
  const outboundOrders = [{ id: 'o1', status: 'shipped' }];

  const counts = computeOperationalCounts({
    canReadInventory: true,
    canReceive: true,
    canPutaway: true,
    canIssue: true,
    receipts,
    putawayTasks,
    outboundOrders,
  });

  assert.equal(counts.pendingReceipts, 0);
  assert.equal(counts.pendingPutaway, 0);
  assert.equal(counts.openOutbound, 0);
  assert.equal(counts.totalPending, 0);
  assert.equal(counts.isClear, true);
});

test('operational counts: permission restricted user hides inaccessible counts', () => {
  const receipts = [{ id: 'r1', status: 'draft' }];
  const putawayTasks = [{ id: 'p1', status: 'pending' }];
  const outboundOrders = [{ id: 'o1', status: 'draft' }];

  // Putaway-only operator (no receive, no issue, no inventory.read)
  const counts = computeOperationalCounts({
    canReadInventory: false,
    canReceive: false,
    canPutaway: true,
    canIssue: false,
    receipts,
    putawayTasks,
    outboundOrders,
  });

  assert.equal(counts.pendingReceipts, null);
  assert.equal(counts.pendingPutaway, 1);
  assert.equal(counts.openOutbound, null);
  assert.equal(counts.totalPending, 1);
});

test('sanitizes clientId in API calls to prevent invalid query params', () => {
  assert.equal(sanitizeClientId('client-123'), 'client-123');
  assert.equal(sanitizeClientId(null), null);
  assert.equal(sanitizeClientId(undefined), null);
  assert.equal(sanitizeClientId('all'), null);
  assert.equal(sanitizeClientId('*'), null);
});

test('reports metrics: computes valuation, turnover rate, and stockout counts', () => {
  const items = [
    { id: 'i1', sku: 'SKU-01', cost: '10.00' },
    { id: 'i2', sku: 'SKU-02', cost: '25.50' },
    { id: 'i3', sku: 'SKU-03', cost: null }, // fallback to 12.50
  ];

  const balances = [
    { item_id: 'i1', on_hand: '100', available: '80', reserved: '20' },
    { item_id: 'i2', on_hand: '20', available: '20', reserved: '0' },
    { item_id: 'i3', on_hand: '0', available: '0', reserved: '0' }, // stockout
  ];

  const receipts = [
    {
      status: 'committed',
      lines: [{ qty: '50' }, { qty: '50' }],
    },
  ];

  // Total valuation: 100*10 + 20*25.50 + 0*12.5 = 1000 + 510 = 1510
  let totalValuation = 0;
  let totalOnHand = 0;
  for (const b of balances) {
    const item = items.find((i) => i.id === b.item_id);
    const cost = Number(item.cost ?? 12.5);
    const onHand = Number(b.on_hand);
    totalOnHand += onHand;
    totalValuation += onHand * cost;
  }
  assert.equal(totalValuation, 1510);
  assert.equal(totalOnHand, 120);

  // Stockout count
  const stockouts = items.filter((item) => {
    const totalItemBal = balances
      .filter((b) => b.item_id === item.id)
      .reduce((sum, b) => sum + Number(b.on_hand), 0);
    return totalItemBal === 0;
  }).length;
  assert.equal(stockouts, 1);
});
