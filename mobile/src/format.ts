import type { Role } from './types';

const roleLabels: Record<string, string> = {
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

export function roleLabel(role: string): string {
  return roleLabels[role] ?? role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatQty(value: string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return value;
  }
  return number.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function parseDate(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(value);
}

export function formatDate(value: string): string {
  const date = parseDate(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function isExpiredDate(value: string): boolean {
  const date = parseDate(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  date.setHours(23, 59, 59, 999);
  return date.getTime() < Date.now();
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelativeTime(value: string | null): string {
  if (!value) {
    return 'Not synced yet';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 45) {
    return 'Just now';
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m ago`;
  }
  if (seconds < 86400) {
    return `${Math.round(seconds / 3600)}h ago`;
  }
  return formatDateTime(value);
}

export function humanize(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
