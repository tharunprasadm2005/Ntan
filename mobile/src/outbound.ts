import type { Balance, Item, Location, OutboundAllocation, OutboundOrder } from './types.ts';

export interface OutboundPickProgress {
  totalAllocations: number;
  pickedAllocations: number;
  totalUnits: number;
  pickedUnits: number;
  isComplete: boolean;
  percent: number;
}

export function calculateOutboundProgress(order: OutboundOrder): OutboundPickProgress {
  const allocations = order.allocations || [];
  const totalAllocations = allocations.length;
  const pickedAllocations = allocations.filter((a) => a.status === 'picked').length;

  let totalUnits = 0;
  let pickedUnits = 0;

  for (const a of allocations) {
    const qty = Number(a.base_qty) || 0;
    totalUnits += qty;
    if (a.status === 'picked') {
      pickedUnits += qty;
    }
  }

  const isComplete = totalAllocations > 0 && pickedAllocations === totalAllocations;
  const percent = totalAllocations > 0 ? Math.round((pickedAllocations / totalAllocations) * 100) : 0;

  return {
    totalAllocations,
    pickedAllocations,
    totalUnits,
    pickedUnits,
    isComplete,
    percent,
  };
}

export interface ScanPickMatchResult {
  allocation: OutboundAllocation | null;
  status: 'match' | 'already_picked' | 'not_in_order';
  message: string;
}

export function matchAllocationForScan(
  allocations: OutboundAllocation[],
  items: Item[],
  rawCode: string,
): ScanPickMatchResult {
  const code = rawCode.trim().toUpperCase();
  if (!code) {
    return {
      allocation: null,
      status: 'not_in_order',
      message: 'Empty scan code.',
    };
  }

  // 1. Identify which item IDs match this barcode or SKU
  const matchingItemIds = new Set<string>();
  for (const item of items) {
    if (
      item.sku.trim().toUpperCase() === code ||
      (item.barcode && item.barcode.trim().toUpperCase() === code)
    ) {
      matchingItemIds.add(item.id);
    }
  }

  // 2. Find all allocations matching either the item ID, the SKU, or specific serial_no
  const matchingAllocations = allocations.filter((alloc) => {
    if (alloc.serial_no && alloc.serial_no.trim().toUpperCase() === code) {
      return true;
    }
    if (alloc.sku.trim().toUpperCase() === code) {
      return true;
    }
    if (matchingItemIds.has(alloc.item_id)) {
      return true;
    }
    return false;
  });

  if (matchingAllocations.length === 0) {
    return {
      allocation: null,
      status: 'not_in_order',
      message: `"${rawCode}" is not on this pick list.`,
    };
  }

  // 3. Find first unpicked allocation
  const unpicked = matchingAllocations.find((alloc) => alloc.status !== 'picked');
  if (unpicked) {
    return {
      allocation: unpicked,
      status: 'match',
      message: `Matched ${unpicked.sku} at ${unpicked.location_code}.`,
    };
  }

  return {
    allocation: null,
    status: 'already_picked',
    message: `All units for "${rawCode}" have already been picked.`,
  };
}

export function formatAllocationCoordinates(
  allocation: OutboundAllocation,
  locations: Location[],
): string {
  const loc = locations.find((l) => l.id === allocation.location_id || l.code === allocation.location_code);
  if (!loc) {
    return allocation.location_code;
  }
  const parts: string[] = [];
  if (loc.aisle?.trim()) parts.push(`Aisle: ${loc.aisle.trim()}`);
  if (loc.rack?.trim()) parts.push(`Rack: ${loc.rack.trim()}`);
  if (loc.shelf?.trim()) parts.push(`Shelf: ${loc.shelf.trim()}`);
  if (loc.bin?.trim()) parts.push(`Bin: ${loc.bin.trim()}`);
  return parts.length > 0 ? parts.join(' · ') : (loc.path || loc.code);
}

export function sortAllocationsByWalkingPath(
  allocations: OutboundAllocation[],
  locations: Location[],
): OutboundAllocation[] {
  const locMap = new Map<string, Location>();
  for (const loc of locations) {
    locMap.set(loc.id, loc);
    locMap.set(loc.code, loc);
  }

  return [...allocations].sort((a, b) => {
    // Unpicked allocations always come first
    if (a.status !== 'picked' && b.status === 'picked') return -1;
    if (a.status === 'picked' && b.status !== 'picked') return 1;

    const locA = locMap.get(a.location_id) || locMap.get(a.location_code);
    const locB = locMap.get(b.location_id) || locMap.get(b.location_code);

    const aisleA = locA?.aisle?.toUpperCase() || locA?.code || a.location_code;
    const aisleB = locB?.aisle?.toUpperCase() || locB?.code || b.location_code;
    const cmpAisle = aisleA.localeCompare(aisleB, undefined, { numeric: true });
    if (cmpAisle !== 0) return cmpAisle;

    const rackA = locA?.rack?.toUpperCase() || '';
    const rackB = locB?.rack?.toUpperCase() || '';
    const cmpRack = rackA.localeCompare(rackB, undefined, { numeric: true });
    if (cmpRack !== 0) return cmpRack;

    const shelfA = locA?.shelf?.toUpperCase() || '';
    const shelfB = locB?.shelf?.toUpperCase() || '';
    const cmpShelf = shelfA.localeCompare(shelfB, undefined, { numeric: true });
    if (cmpShelf !== 0) return cmpShelf;

    const binA = locA?.bin?.toUpperCase() || '';
    const binB = locB?.bin?.toUpperCase() || '';
    return binA.localeCompare(binB, undefined, { numeric: true });
  });
}

export function findItemByScannedCode(
  items: Item[],
  rawCode: string,
): Item | null {
  const code = rawCode.trim().toUpperCase();
  if (!code) return null;

  return (
    items.find(
      (item) =>
        (item.barcode && item.barcode.trim().toUpperCase() === code) ||
        item.sku.trim().toUpperCase() === code,
    ) ?? null
  );
}

export interface AvailableStockItemOption {
  value: string;
  label: string;
  detail: string;
  availableQty: string;
}

export function filterStockedItemOptions(
  items: Item[],
  balances: Balance[],
  options: {
    warehouseId?: string | null;
    locationId?: string | null;
    clientId?: string | null;
  } = {},
): AvailableStockItemOption[] {
  const itemStockMap = new Map<string, number>();

  for (const b of balances) {
    if (options.warehouseId && b.warehouse_id !== options.warehouseId) {
      continue;
    }
    if (options.locationId && b.location_id !== options.locationId) {
      continue;
    }
    if (options.clientId && b.client_id !== options.clientId) {
      continue;
    }

    const qty = Number(b.available || b.on_hand || '0');
    if (qty > 0) {
      itemStockMap.set(b.item_id, (itemStockMap.get(b.item_id) || 0) + qty);
    }
  }

  const result: AvailableStockItemOption[] = [];
  for (const item of items) {
    if (item.status !== 'active') continue;
    if (options.clientId && item.client_id && item.client_id !== options.clientId) continue;

    const stock = itemStockMap.get(item.id);
    if (stock && stock > 0) {
      result.push({
        value: item.id,
        label: `${item.sku} · ${item.name}`,
        detail: `${stock} ${item.base_uom} available in store`,
        availableQty: String(stock),
      });
    }
  }

  return result.sort((a, b) => a.label.localeCompare(b.label));
}

