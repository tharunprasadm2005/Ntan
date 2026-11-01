import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activeSupplierPartners,
  itemMatchesSupplierFilter,
  preferredSupplierForItem,
  preferredSupplierIds,
  suggestSupplierIdForRows,
} from '../src/supplierMapping.ts';

function supplier(overrides = {}) {
  return {
    id: 'supplier-1',
    company_id: 'company-1',
    code: 'SUP-1',
    name: 'Alpha Supply',
    display_name: null,
    types: ['supplier'],
    status: 'active',
    is_internal: false,
    ...overrides,
  };
}

test('only active supplier partners are offered for item linking and filtering', () => {
  const suppliers = activeSupplierPartners([
    supplier({ id: 'b', name: 'Beta Supply' }),
    supplier({ id: 'a', name: 'Alpha Supply' }),
    supplier({ id: 'archived', name: 'Aardvark', status: 'archived' }),
    supplier({ id: 'customer', name: 'Customer Co', types: ['customer'] }),
    supplier({ id: 'dual', name: 'Dual Role', types: ['supplier', 'customer'] }),
  ]);

  assert.deepEqual(
    suppliers.map((entry) => entry.name),
    ['Alpha Supply', 'Beta Supply', 'Dual Role'],
  );
});

test('a purchase order supplier is suggested only when every selected row agrees', () => {
  const suppliers = [
    supplier({ id: 'supplier-1', name: 'Alpha Supply' }),
    supplier({ id: 'supplier-2', name: 'Beta Supply' }),
    supplier({ id: 'supplier-archived', name: 'Old Supply', status: 'archived' }),
  ];

  assert.deepEqual(
    preferredSupplierIds([
      { preferred_supplier_id: 'supplier-1' },
      { preferred_supplier_id: 'supplier-1' },
      { preferred_supplier_id: null },
    ]),
    ['supplier-1'],
  );

  assert.equal(
    suggestSupplierIdForRows(
      [
        { preferred_supplier_id: 'supplier-1' },
        { preferred_supplier_id: 'supplier-1' },
      ],
      suppliers,
    ),
    'supplier-1',
  );

  // Conflicting mapped suppliers must not silently pick one.
  assert.equal(
    suggestSupplierIdForRows(
      [
        { preferred_supplier_id: 'supplier-1' },
        { preferred_supplier_id: 'supplier-2' },
      ],
      suppliers,
    ),
    null,
  );

  // A one-off item with no mapping simply yields no suggestion.
  assert.equal(
    suggestSupplierIdForRows([{ preferred_supplier_id: null }], suppliers),
    null,
  );

  // Archived suppliers are never suggested even if an old mapping points at them.
  assert.equal(
    suggestSupplierIdForRows(
      [{ preferred_supplier_id: 'supplier-archived' }],
      suppliers,
    ),
    null,
  );
});

test('catalogue supplier filter hides unlinked items only when a supplier is active', () => {
  const linked = new Set(['item-1', 'item-3']);

  assert.equal(itemMatchesSupplierFilter('item-1', linked), true);
  assert.equal(itemMatchesSupplierFilter('item-2', linked), false);
  // No supplier selected means no filtering, even if the set is empty.
  assert.equal(itemMatchesSupplierFilter('item-2', null), true);
  assert.equal(itemMatchesSupplierFilter('item-2', new Set()), false);
});

test('receiving suggestion resolves an item preferred supplier but tolerates missing links', () => {
  const clients = [
    supplier({ id: 'supplier-1', name: 'Alpha Supply' }),
    supplier({ id: 'supplier-archived', name: 'Old Supply', status: 'archived' }),
    supplier({ id: 'customer', name: 'Customer Co', types: ['customer'] }),
  ];

  assert.equal(
    preferredSupplierForItem({ preferred_supplier_id: 'supplier-1' }, clients)?.name,
    'Alpha Supply',
  );
  assert.equal(
    preferredSupplierForItem({ preferred_supplier_id: 'supplier-archived' }, clients),
    null,
  );
  assert.equal(
    preferredSupplierForItem({ preferred_supplier_id: 'customer' }, clients),
    null,
  );
  assert.equal(preferredSupplierForItem({ preferred_supplier_id: null }, clients), null);
  assert.equal(preferredSupplierForItem(null, clients), null);
});
