import type { Invitation, Location, Role, Warehouse } from './types';

export interface RoleOption {
  value: Role;
  label: string;
  detail: string;
}

export interface ParsedEmailList {
  emails: string[];
  invalid: string[];
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const roleNames: Record<string, string> = {
  // Organization Level
  owner: 'Owner',
  company_admin: 'Company Admin',

  // 14 Operational Roles
  warehouse_manager: 'Warehouse Manager',
  warehouse_supervisor: 'Warehouse Supervisor',
  receiving_operator: 'Receiving Operator',
  quality_inspector: 'Quality Control Inspector',
  qc_inspector: 'Quality Control Inspector',
  putaway_operator: 'Put-away Operator',
  material_handler: 'Material Handling Operator',
  material_handling_operator: 'Material Handling Operator',
  inventory_controller: 'Inventory Controller',
  replenishment_operator: 'Replenishment Operator',
  order_picker: 'Order Picker',
  packing_operator: 'Packing Operator',
  dispatch_operator: 'Dispatch Operator',
  logistics_coordinator: 'Logistics Coordinator',
  cycle_counter: 'Cycle Counter',
  returns_operator: 'Returns Operator',

  // Read-Only Profiles
  viewer: 'Viewer',
  auditor: 'Auditor',

  // Compatible / Legacy Roles
  picker_packer: 'Picker / Packer',
  warehouse_operator: 'Warehouse Operator',
  inventory_manager: 'Inventory Manager',
  inventory_operator: 'Inventory Operator',
  project_manager: 'Project Manager',
  technician: 'Technician',
  purchasing: 'Purchasing',
};

const roleDetails: Record<string, string> = {
  // Organization Level
  owner: 'Full control over company settings, billing, owners, and security policies',
  company_admin: 'Manage company settings, members, warehouses, and operations',

  // 14 Operational Roles
  warehouse_manager: 'Supervise multi-facility warehouse flows, audits, and assignments',
  warehouse_supervisor: 'Manage shift operations, staff execution, stock movements, and count reviews',
  receiving_operator: 'Unload inbound shipments, verify manifests, inspect deliveries, and stage inbound freight',
  quality_inspector: 'Inspect inbound shipments, verify goods on arrival, track batch details, and transfer stock',
  qc_inspector: 'Inspect inbound shipments, verify goods on arrival, track batch details, and transfer stock',
  putaway_operator: 'Direct received stock to racks, bins, reserve locations, and primary storage',
  material_handler: 'Operate handling equipment, transfer pallets, and move stock between warehouse zones',
  material_handling_operator: 'Operate handling equipment, transfer pallets, and move stock between warehouse zones',
  inventory_controller: 'Perform stock adjustments, counts, cycle audits, and reconciliations',
  replenishment_operator: 'Replenish pick bins from reserve bulk storage and monitor forward pick levels',
  order_picker: 'Pick customer orders from bin locations accurately according to pick lists',
  packing_operator: 'Verify picked orders, package goods into cartons, apply shipping labels, and seal containers',
  dispatch_operator: 'Verify outbound loads, process carrier transfers, and record shipping exits',
  logistics_coordinator: 'Coordinate dock appointments, track inbound/outbound freight, and generate manifests',
  cycle_counter: 'Conduct scheduled physical cycle counts, verify bin balances, and report count variances',
  returns_operator: 'Receive returned shipments, verify returned items, and transfer stock to storage or inspection bays',

  // Read-Only Profiles
  viewer: 'Read-only access to view items, locations, and stock balances',
  auditor: 'Read-only audit access to inventory movements, valuation, and security logs',

  // Compatible / Legacy Roles
  picker_packer: 'Pick customer orders from bins, pack shipments, and stage dispatch',
  warehouse_operator: 'Record receipts, scans, bin counts, and transfers',
  inventory_manager: 'Oversee stock balances, catalog items, adjustments, and receipts',
  inventory_operator: 'Record warehouse receipts, internal transfers, and bin counts',
  project_manager: 'View project-allocated stock, reservations, and inventory status',
  technician: 'View and use inventory for maintenance and field jobs',
  purchasing: 'View stock levels, replenishment triggers, and item costs',
};

const assignableRoles: Role[] = [
  // 14 Operational Roles
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

  // Read-Only Profiles
  'viewer',
  'auditor',

  // Organization Level
  'company_admin',
  'owner',

  // Compatible / Legacy Roles
  'picker_packer',
  'warehouse_operator',
  'inventory_manager',
  'purchasing',
  'technician',
  'project_manager',
];

export function roleLabel(role: string): string {
  return roleNames[role] ?? role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function roleDetail(role: string): string {
  return roleDetails[role] ?? 'Custom organization role';
}

export function roleOptionsFor(currentRole: Role): RoleOption[] {
  return assignableRoles
    .filter((role) => role !== 'owner' || currentRole === 'owner')
    .map((role) => ({
      value: role,
      label: roleNames[role],
      detail: roleDetails[role],
    }));
}

export function locationIdsForWarehouseScope(
  warehouseIds: string[],
  warehouses: Warehouse[],
  locations: Location[],
): string[] {
  if (warehouseIds.length === 0) {
    return [];
  }
  const selected = new Set(warehouseIds);
  const known = new Set(warehouses.map((warehouse) => warehouse.id));
  return locations
    .filter(
      (location) =>
        location.status === 'active' &&
        selected.has(location.warehouse_id) &&
        known.has(location.warehouse_id),
    )
    .map((location) => location.id);
}

export function warehouseIdsFromScope(
  locationIds: string[],
  locations: Location[],
): string[] {
  if (locationIds.length === 0) {
    return [];
  }
  const scoped = new Set(locationIds);
  return Array.from(
    new Set(
      locations
        .filter((location) => scoped.has(location.id))
        .map((location) => location.warehouse_id),
    ),
  );
}

export function scopeLabel(
  locationIds: string[],
  warehouses: Warehouse[],
  locations: Location[],
): string {
  if (locationIds.length === 0) {
    return 'All company locations';
  }
  const selected = new Set(locationIds);
  const activeLocations = locations.filter((location) => location.status === 'active');
  const parts: string[] = [];
  const unknownWarehouseIds = new Set(selected);

  for (const warehouse of warehouses) {
    const warehouseLocations = activeLocations.filter(
      (location) => location.warehouse_id === warehouse.id,
    );
    const selectedLocations = warehouseLocations.filter((location) =>
      selected.has(location.id),
    );
    if (selectedLocations.length === 0) {
      continue;
    }
    for (const location of selectedLocations) {
      unknownWarehouseIds.delete(location.id);
    }
    parts.push(
      selectedLocations.length === warehouseLocations.length
        ? warehouse.name
        : `${warehouse.name}: ${selectedLocations
            .map((location) => location.code)
            .join(', ')}`,
    );
  }

  if (parts.length === 0) {
    return `${locationIds.length} assigned location${locationIds.length === 1 ? '' : 's'}`;
  }
  return parts.join(' | ');
}

export function pendingInvitations(invitations: Invitation[]): Invitation[] {
  return invitations
    .filter((invitation) => invitation.status === 'pending')
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}

export function parseEmailList(value: string): ParsedEmailList {
  const emails: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const part of value.split(/[\s,;]+/)) {
    const token = part.trim();
    if (!token) {
      continue;
    }
    const normalized = token.toLowerCase();
    if (!emailPattern.test(normalized)) {
      invalid.push(token);
      continue;
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      emails.push(normalized);
    }
  }

  return { emails, invalid };
}

export function memberInitials(name: string): string {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || 'M'
  );
}
