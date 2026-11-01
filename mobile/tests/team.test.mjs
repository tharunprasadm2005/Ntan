import assert from 'node:assert/strict';
import test from 'node:test';

import {
  locationIdsForWarehouseScope,
  memberInitials,
  parseEmailList,
  pendingInvitations,
  roleOptionsFor,
  scopeLabel,
  warehouseIdsFromScope,
} from '../src/team.ts';

const warehouses = [
  { id: 'wh-1', name: 'Main Warehouse', status: 'active' },
  { id: 'wh-2', name: 'North Warehouse', status: 'active' },
];

const locations = [
  { id: 'loc-1', warehouse_id: 'wh-1', code: 'RECV', status: 'active' },
  { id: 'loc-2', warehouse_id: 'wh-1', code: 'BIN-A', status: 'active' },
  { id: 'loc-3', warehouse_id: 'wh-2', code: 'RECV', status: 'active' },
  { id: 'loc-4', warehouse_id: 'wh-2', code: 'BIN-B', status: 'inactive' },
];

test('owner role options include owner while admins cannot assign it', () => {
  assert.equal(roleOptionsFor('owner').some((option) => option.value === 'owner'), true);
  assert.equal(
    roleOptionsFor('company_admin').some((option) => option.value === 'owner'),
    false,
  );
  assert.equal(
    roleOptionsFor('company_admin').some((option) => option.value === 'company_admin'),
    true,
  );
});

test('role options catalogue includes all 14 operational warehouse and logistics roles', () => {
  const options = roleOptionsFor('owner');
  const values = new Set(options.map((opt) => opt.value));
  const expected14Roles = [
    'warehouse_manager',
    'warehouse_supervisor',
    'receiving_operator',
    'quality_inspector',
    'putaway_operator',
    'material_handler',
    'inventory_controller',
    'replenishment_operator',
    'order_picker',
    'packing_operator',
    'dispatch_operator',
    'logistics_coordinator',
    'cycle_counter',
    'returns_operator',
  ];
  for (const role of expected14Roles) {
    assert.equal(values.has(role), true, `Role ${role} should be in roleOptionsFor`);
    const opt = options.find((o) => o.value === role);
    assert.ok(opt?.label, `Role ${role} should have a non-empty label`);
    assert.ok(opt?.detail, `Role ${role} should have a non-empty detail`);
  }
});

test('warehouse selection expands to current active locations only', () => {
  assert.deepEqual(locationIdsForWarehouseScope([], warehouses, locations), []);
  assert.deepEqual(locationIdsForWarehouseScope(['wh-1'], warehouses, locations), [
    'loc-1',
    'loc-2',
  ]);
  assert.deepEqual(
    locationIdsForWarehouseScope(['wh-1', 'wh-2'], warehouses, locations),
    ['loc-1', 'loc-2', 'loc-3'],
  );
  assert.deepEqual(warehouseIdsFromScope(['loc-1', 'loc-3'], locations), ['wh-1', 'wh-2']);
});

test('scope labels distinguish all, whole warehouse, and partial warehouse access', () => {
  assert.equal(scopeLabel([], warehouses, locations), 'All company locations');
  assert.equal(scopeLabel(['loc-1', 'loc-2'], warehouses, locations), 'Main Warehouse');
  assert.equal(
    scopeLabel(['loc-1', 'loc-3'], warehouses, locations),
    'Main Warehouse: RECV | North Warehouse',
  );
  assert.equal(scopeLabel(['missing'], warehouses, locations), '1 assigned location');
});

test('pending invitations exclude resolved invitations and sort newest first', () => {
  const invitations = [
    { id: 'old', status: 'pending', created_at: '2026-01-01T00:00:00Z' },
    { id: 'accepted', status: 'accepted', created_at: '2026-01-03T00:00:00Z' },
    { id: 'new', status: 'pending', created_at: '2026-01-02T00:00:00Z' },
    { id: 'revoked', status: 'revoked', created_at: '2026-01-04T00:00:00Z' },
  ];
  assert.deepEqual(
    pendingInvitations(invitations).map((invitation) => invitation.id),
    ['new', 'old'],
  );
});

test('member initials are stable for empty and multi-part names', () => {
  assert.equal(memberInitials('Amina Okafor'), 'AO');
  assert.equal(memberInitials('  '), 'M');
});

test('bulk email parsing normalizes, deduplicates, and reports invalid addresses', () => {
  assert.deepEqual(
    parseEmailList(
      'First@Company.com, second@company.com\nfirst@company.com; not-an-email',
    ),
    {
      emails: ['first@company.com', 'second@company.com'],
      invalid: ['not-an-email'],
    },
  );
  assert.deepEqual(parseEmailList('  ,  '), { emails: [], invalid: [] });
});
