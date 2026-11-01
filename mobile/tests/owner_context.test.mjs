import assert from 'node:assert/strict';
import test from 'node:test';

// Helper logic replicating the workspace owner filtering
function getInventoryOwners(clients) {
  return clients.filter((c) => c.is_internal || c.types?.includes('3pl_client'));
}

function getInternalOwner(inventoryOwners) {
  return inventoryOwners.find((c) => c.is_internal) ?? null;
}

function computeIsMultiOwner(inventoryModel, inventoryOwners) {
  return (inventoryModel === '3pl' || inventoryModel === 'hybrid') && inventoryOwners.length > 1;
}

function computeDefaultClientId(isMultiOwner, internalClient, inventoryOwners) {
  if (!isMultiOwner) {
    return internalClient?.id ?? inventoryOwners[0]?.id ?? null;
  }
  return null;
}

function validateTransactionOwner(clientId, isMultiOwner, defaultOwnerId) {
  const effectiveId = isMultiOwner ? clientId : defaultOwnerId;
  if (!effectiveId || effectiveId.toLowerCase() === 'all' || effectiveId === '*') {
    return { valid: false, error: 'Select an explicit inventory owner.' };
  }
  return { valid: true, ownerId: effectiveId };
}

test('distinguishes inventory owners from suppliers and customers', () => {
  const clients = [
    { id: 'internal-1', name: 'Internal Stock', is_internal: true, types: ['3pl_client'] },
    { id: 'sup-1', name: 'Raw Material Supplier', is_internal: false, types: ['supplier'] },
    { id: 'cust-1', name: 'Retail Customer', is_internal: false, types: ['customer'] },
    { id: '3pl-client-a', name: 'Acme Brand Co', is_internal: false, types: ['3pl_client'] },
  ];

  const owners = getInventoryOwners(clients);
  assert.equal(owners.length, 2);
  assert.deepEqual(owners.map((o) => o.id), ['internal-1', '3pl-client-a']);
  assert.ok(!owners.some((o) => o.id === 'sup-1'));
  assert.ok(!owners.some((o) => o.id === 'cust-1'));
});

test('single-owner manufacturing workspace uses internal stock without switching controls', () => {
  const clients = [
    { id: 'internal-1', name: 'Internal Stock', is_internal: true, types: ['3pl_client'] },
    { id: 'sup-1', name: 'Supplier A', is_internal: false, types: ['supplier'] },
    { id: 'sup-2', name: 'Supplier B', is_internal: false, types: ['supplier'] },
    { id: 'cust-1', name: 'Customer A', is_internal: false, types: ['customer'] },
  ];

  const owners = getInventoryOwners(clients);
  const internal = getInternalOwner(owners);
  const isMultiOwner = computeIsMultiOwner('internal', owners);
  const defaultOwnerId = computeDefaultClientId(isMultiOwner, internal, owners);

  assert.equal(isMultiOwner, false, 'Internal mode must never be multi-owner');
  assert.equal(defaultOwnerId, 'internal-1', 'Must default to internal stock owner');

  // Even if user attempts transaction without choosing client, single-owner defaults to internal
  const tx = validateTransactionOwner(null, isMultiOwner, defaultOwnerId);
  assert.equal(tx.valid, true);
  assert.equal(tx.ownerId, 'internal-1');
});

test('multi-owner 3PL workspace identifies multiple owners and allows all-owners viewing', () => {
  const clients = [
    { id: 'internal-1', name: 'Internal', is_internal: true, types: ['3pl_client'] },
    { id: 'client-alpha', name: 'Alpha Brand', is_internal: false, types: ['3pl_client'] },
    { id: 'client-beta', name: 'Beta Brand', is_internal: false, types: ['3pl_client'] },
  ];

  const owners = getInventoryOwners(clients);
  const internal = getInternalOwner(owners);
  const isMultiOwner = computeIsMultiOwner('hybrid', owners);
  const defaultOwnerId = computeDefaultClientId(isMultiOwner, internal, owners);

  assert.equal(isMultiOwner, true);
  assert.equal(defaultOwnerId, null, 'Multi-owner defaults to null (all owners viewing view)');
});

test('never allows All Owners viewing option to be submitted as a transaction owner', () => {
  const isMultiOwner = true;
  const defaultOwnerId = null;

  // Attempting to submit null or 'all'
  const resultNull = validateTransactionOwner(null, isMultiOwner, defaultOwnerId);
  assert.equal(resultNull.valid, false);

  const resultAll = validateTransactionOwner('all', isMultiOwner, defaultOwnerId);
  assert.equal(resultAll.valid, false);

  const resultStar = validateTransactionOwner('*', isMultiOwner, defaultOwnerId);
  assert.equal(resultStar.valid, false);

  // Submitting an explicit owner ID
  const resultValid = validateTransactionOwner('client-alpha', isMultiOwner, defaultOwnerId);
  assert.equal(resultValid.valid, true);
  assert.equal(resultValid.ownerId, 'client-alpha');
});

test('correctly filters items and balances by active owner', () => {
  const items = [
    { id: 'item-1', client_id: 'client-a', sku: 'A-SKU' },
    { id: 'item-2', client_id: 'client-b', sku: 'B-SKU' },
    { id: 'item-3', client_id: 'internal', sku: 'INT-SKU' },
  ];

  const filterByOwner = (activeOwnerId) =>
    items.filter((item) => !activeOwnerId || item.client_id === activeOwnerId);

  // When viewing "All Owners" (activeOwnerId === null)
  assert.equal(filterByOwner(null).length, 3);

  // When viewing Client A
  const clientAItems = filterByOwner('client-a');
  assert.equal(clientAItems.length, 1);
  assert.equal(clientAItems[0].sku, 'A-SKU');

  // When viewing Internal
  const internalItems = filterByOwner('internal');
  assert.equal(internalItems.length, 1);
  assert.equal(internalItems[0].sku, 'INT-SKU');
});
