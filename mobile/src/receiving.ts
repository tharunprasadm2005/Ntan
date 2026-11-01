import type { Item, ReorderSupplierOption, SupplierItem } from './types';

/**
 * Pure helpers for supplier-aware receiving. They keep the mobile workflow
 * honest: mappings only prioritise/label items, and a one-off delivery from an
 * unmapped supplier is never blocked on the device.
 */

export function activeMappingMap(
  mappings: SupplierItem[],
): Map<string, SupplierItem> {
  const map = new Map<string, SupplierItem>();
  for (const mapping of mappings) {
    if (mapping.status === 'active') {
      map.set(mapping.item_id, mapping);
    }
  }
  return map;
}

export function prioritiseMappedItems(
  items: Item[],
  mappings: Map<string, SupplierItem>,
  supplierId: string | null,
): Item[] {
  if (!supplierId || mappings.size === 0) {
    return items;
  }
  const mapped: Item[] = [];
  const unmapped: Item[] = [];
  for (const item of items) {
    (mappings.has(item.id) ? mapped : unmapped).push(item);
  }
  return [...mapped, ...unmapped];
}

/** Matches internal SKU, name, barcode and the supplier's own SKU. */
export function itemMatchesReceivingSearch(
  item: Item,
  mapping: SupplierItem | undefined,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return [item.sku, item.name, item.barcode ?? '', mapping?.supplier_sku ?? ''].some(
    (value) => value.toLowerCase().includes(needle),
  );
}

/** Exact match used by barcode scanning, including supplier SKUs. */
export function itemMatchesScannedCode(
  item: Item,
  mapping: SupplierItem | undefined,
  code: string,
): boolean {
  const needle = code.trim().toUpperCase();
  if (!needle) {
    return false;
  }
  return [item.sku, item.barcode ?? '', mapping?.supplier_sku ?? ''].some(
    (value) => value.toUpperCase() === needle,
  );
}

export function describeSupplierOption(
  option: ReorderSupplierOption,
  canReadCost: boolean,
): string[] {
  return [
    option.is_preferred ? 'Preferred for this item' : 'Mapped item supplier',
    option.supplier_sku ? `SKU ${option.supplier_sku}` : null,
    option.lead_time_days != null ? `${option.lead_time_days}d lead` : null,
    option.min_order_qty ? `MOQ ${option.min_order_qty}` : null,
    canReadCost && option.purchase_price
      ? `${option.currency ?? ''} ${option.purchase_price}`.trim()
      : null,
  ].filter((value): value is string => Boolean(value));
}

/**
 * A receipt created from a purchase order must use that order's supplier.
 * Returns a user-facing message when the two disagree.
 */
export function purchaseOrderSupplierConflict(
  orderSupplierId: string | null | undefined,
  selectedSupplierId: string | null | undefined,
): string | null {
  if (!orderSupplierId || !selectedSupplierId) {
    return null;
  }
  if (orderSupplierId === selectedSupplierId) {
    return null;
  }
  return 'The selected supplier does not match the purchase order.';
}

/** Whether the supplier's minimum order quantity is met for a line quantity. */
export function belowMinimumOrder(
  minOrderQty: string | null | undefined,
  qty: number,
): boolean {
  if (!minOrderQty) {
    return false;
  }
  const moq = Number(minOrderQty);
  return Number.isFinite(moq) && moq > 0 && qty < moq;
}
