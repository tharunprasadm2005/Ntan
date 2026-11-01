import type { Balance, Item, Location } from './types.ts';

export function findLocationByScannedCode(
  locations: Location[],
  rawCode: string,
  warehouseId?: string | null,
): Location | null {
  const code = rawCode.trim().toUpperCase();
  if (!code) return null;

  return (
    locations.find((loc) => {
      if (warehouseId && loc.warehouse_id !== warehouseId) {
        return false;
      }
      if (loc.status !== 'active') {
        return false;
      }
      if (loc.barcode && loc.barcode.trim().toUpperCase() === code) {
        return true;
      }
      if (loc.code.toUpperCase() === code) {
        return true;
      }
      if (loc.path && loc.path.toUpperCase() === code) {
        return true;
      }
      return false;
    }) ?? null
  );
}

export interface AvailableItemAtLocation {
  item: Item;
  availableQty: string;
  lotNo?: string | null;
  serialNo?: string | null;
}

export function getItemsAvailableAtLocation(
  balances: Balance[],
  items: Item[],
  locationId: string,
  clientId?: string | null,
): AvailableItemAtLocation[] {
  const locBalances = balances.filter((b) => {
    if (b.location_id !== locationId) return false;
    if (clientId && b.client_id !== clientId) return false;
    return Number(b.available || b.on_hand || '0') > 0;
  });

  const itemMap = new Map<string, Item>();
  for (const item of items) {
    itemMap.set(item.id, item);
  }

  const results: AvailableItemAtLocation[] = [];
  for (const bal of locBalances) {
    const item = itemMap.get(bal.item_id);
    if (item) {
      results.push({
        item,
        availableQty: bal.available || bal.on_hand || '0',
        lotNo: bal.lot_no,
        serialNo: bal.serial_no,
      });
    }
  }

  return results;
}

export function formatTransferLocation(loc: Location): string {
  const parts: string[] = [];
  if (loc.aisle?.trim()) parts.push(`Aisle: ${loc.aisle.trim()}`);
  if (loc.rack?.trim()) parts.push(`Rack: ${loc.rack.trim()}`);
  if (loc.shelf?.trim()) parts.push(`Shelf: ${loc.shelf.trim()}`);
  if (loc.bin?.trim()) parts.push(`Bin: ${loc.bin.trim()}`);
  return parts.length > 0 ? parts.join(' · ') : (loc.path || loc.code);
}
