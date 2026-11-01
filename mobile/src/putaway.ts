import type { Balance, Location, PutawayTask } from './types';

export const PUTAWAY_SOURCE_TYPES = new Set(['receiving', 'staging']);

export interface PutawayDestinationContext {
  warehouseId: string;
  fromLocationId: string;
}

export function isPutawayDestination(
  location: Location,
  context: PutawayDestinationContext,
): boolean {
  return (
    location.warehouse_id === context.warehouseId &&
    location.id !== context.fromLocationId &&
    location.status === 'active' &&
    !PUTAWAY_SOURCE_TYPES.has(location.type)
  );
}

export function filterPutawayDestinations(
  locations: Location[],
  context: PutawayDestinationContext,
): Location[] {
  return locations.filter((location) => isPutawayDestination(location, context));
}

export interface PutawayQuantityValidation {
  quantity: string | null;
  error: string | null;
}

function toMicros(value: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? '').padEnd(6, '0'));
  return whole * 1_000_000n + fraction;
}

export function parsePutawayQuantity(
  raw: string,
  remaining: string,
): PutawayQuantityValidation {
  const value = raw.trim().replace(',', '.');
  if (!value) {
    return { quantity: null, error: 'Enter the quantity to put away.' };
  }
  const quantity = toMicros(value);
  if (quantity === null || quantity <= 0n) {
    return {
      quantity: null,
      error: 'Enter a quantity greater than zero with up to 6 decimal places.',
    };
  }
  const available = toMicros(remaining);
  if (available === null || quantity > available) {
    return { quantity: null, error: `Enter ${remaining} or less.` };
  }
  return { quantity: value, error: null };
}

export interface PutawayProgress {
  completedQty: string;
  remainingQty: string;
  isPartial: boolean;
  isComplete: boolean;
}

export function putawayProgress(
  task: Pick<PutawayTask, 'status' | 'base_qty' | 'completed_qty' | 'remaining_qty'>,
): PutawayProgress {
  const completedQty = task.completed_qty ?? '0';
  const remainingQty = task.remaining_qty ?? task.base_qty;
  const isComplete = task.status === 'completed' || Number(remainingQty) <= 0;
  return {
    completedQty,
    remainingQty,
    isPartial: !isComplete && Number(completedQty) > 0,
    isComplete,
  };
}

export function newPutawayRequestKey(taskId: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${taskId}-${Date.now().toString(36)}-${random}`;
}

export interface HierarchyFilter {
  aisle?: string | null;
  rack?: string | null;
  shelf?: string | null;
  bin?: string | null;
}

export function formatLocationCoordinates(location: Location): string {
  const parts: string[] = [];
  if (location.aisle) parts.push(`Aisle: ${location.aisle}`);
  if (location.rack) parts.push(`Rack: ${location.rack}`);
  if (location.shelf) parts.push(`Shelf: ${location.shelf}`);
  if (location.bin) parts.push(`Bin: ${location.bin}`);
  return parts.join(' · ');
}

export function filterDestinationsByHierarchy(
  locations: Location[],
  filter: HierarchyFilter,
): Location[] {
  const a = filter.aisle?.trim().toUpperCase();
  const r = filter.rack?.trim().toUpperCase();
  const s = filter.shelf?.trim().toUpperCase();
  const b = filter.bin?.trim().toUpperCase();

  return locations.filter((loc) => {
    if (a && loc.aisle?.trim().toUpperCase() !== a) {
      return false;
    }
    if (r && loc.rack?.trim().toUpperCase() !== r) {
      return false;
    }
    if (s && loc.shelf?.trim().toUpperCase() !== s) {
      return false;
    }
    if (b && loc.bin?.trim().toUpperCase() !== b) {
      return false;
    }
    return true;
  });
}

export function buildCoordinateLocationCode(coords: HierarchyFilter): string {
  const parts: string[] = [];
  if (coords.aisle?.trim()) parts.push(coords.aisle.trim().toUpperCase());
  if (coords.rack?.trim()) parts.push(coords.rack.trim().toUpperCase());
  if (coords.shelf?.trim()) parts.push(coords.shelf.trim().toUpperCase());
  if (coords.bin?.trim()) parts.push(coords.bin.trim().toUpperCase());
  return parts.join('-');
}

export function findDestinationByCoordinates(
  locations: Location[],
  coords: HierarchyFilter,
): Location | null {
  const a = coords.aisle?.trim().toUpperCase();
  const r = coords.rack?.trim().toUpperCase();
  const s = coords.shelf?.trim().toUpperCase();
  const b = coords.bin?.trim().toUpperCase();

  if (!a && !r && !s && !b) {
    return null;
  }

  // 1. Check exact match across coordinate fields
  const directMatch = locations.find((loc) => {
    const locA = loc.aisle?.trim().toUpperCase();
    const locR = loc.rack?.trim().toUpperCase();
    const locS = loc.shelf?.trim().toUpperCase();
    const locB = loc.bin?.trim().toUpperCase();

    if (a && locA !== a) return false;
    if (r && locR !== r) return false;
    if (s && locS !== s) return false;
    if (b && locB !== b) return false;

    return true;
  });
  if (directMatch) return directMatch;

  // 2. Check by code / path
  const code = buildCoordinateLocationCode(coords);
  if (code) {
    return (
      locations.find(
        (loc) =>
          loc.code.toUpperCase() === code ||
          loc.code.toUpperCase() === `BIN-${code}` ||
          (loc.path && loc.path.toUpperCase().endsWith(code)),
      ) ?? null
    );
  }

  return null;
}

export function findDestinationByScannedCode(
  locations: Location[],
  rawCode: string,
): Location | null {
  const code = rawCode.trim().toUpperCase();
  if (!code) return null;

  // Exact barcode match first
  const byBarcode = locations.find(
    (loc) => loc.barcode && loc.barcode.trim().toUpperCase() === code,
  );
  if (byBarcode) return byBarcode;

  // Exact code match
  const byCode = locations.find((loc) => loc.code.toUpperCase() === code);
  if (byCode) return byCode;

  // Path suffix or full path match
  const byPath = locations.find(
    (loc) => loc.path && loc.path.toUpperCase() === code,
  );
  if (byPath) return byPath;

  return null;
}

export function suggestPutawayBinsForItem(
  itemId: string,
  balances: Balance[],
  eligibleDestinations: Location[],
): Location[] {
  const matchingLocationIds = new Set<string>();
  for (const b of balances) {
    if (b.item_id === itemId && Number(b.on_hand || '0') > 0) {
      matchingLocationIds.add(b.location_id);
    }
  }

  return eligibleDestinations.filter((loc) => matchingLocationIds.has(loc.id));
}
