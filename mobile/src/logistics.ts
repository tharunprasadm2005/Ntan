import type { Balance, Location, Receipt, Warehouse } from './types';

export interface WarehouseAvailability {
  warehouse: Warehouse;
  available: number;
  stockedSkus: number;
  locationCount: number;
  share: number;
}

function asNumber(value: string | null | undefined): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function receiptUnits(receipt: Receipt): number {
  return receipt.lines.reduce((total, line) => total + asNumber(line.base_qty), 0);
}

export function draftReceipts(receipts: Receipt[]): Receipt[] {
  return receipts
    .filter((receipt) => receipt.status === 'draft')
    .sort(
      (left, right) =>
        new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
    );
}

export function warehouseAvailability(
  warehouses: Warehouse[],
  locations: Location[],
  balances: Balance[],
): WarehouseAvailability[] {
  const activeLocations = locations.filter((location) => location.status === 'active');
  const rows = warehouses.map((warehouse) => {
    const warehouseBalances = balances.filter(
      (balance) =>
        balance.warehouse_id === warehouse.id && balance.stock_status === 'available',
    );
    const available = warehouseBalances.reduce(
      (total, balance) => total + asNumber(balance.available),
      0,
    );
    return {
      warehouse,
      available,
      stockedSkus: new Set(
        warehouseBalances
          .filter((balance) => asNumber(balance.available) > 0)
          .map((balance) => balance.item_id),
      ).size,
      locationCount: activeLocations.filter(
        (location) => location.warehouse_id === warehouse.id,
      ).length,
      share: 0,
    };
  });
  const highest = rows.reduce((maximum, row) => Math.max(maximum, row.available), 0);
  return rows
    .map((row) => ({
      ...row,
      share: highest > 0 ? Math.max(2, (row.available / highest) * 100) : 0,
    }))
    .sort((left, right) => right.available - left.available);
}
