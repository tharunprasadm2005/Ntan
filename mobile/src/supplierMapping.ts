import type { Client, Item, ReorderNeedRow } from './types';

/**
 * Supplier-mapping helpers shared by the catalogue, reorder and receiving
 * screens. These are deliberately suggestion-only: a mapped supplier never
 * blocks a legitimate one-off purchase or receipt from another supplier.
 */

export function activeSupplierPartners(clients: Client[]): Client[] {
  return clients
    .filter(
      (client) =>
        client.status === 'active' && Boolean(client.types?.includes('supplier')),
    )
    .sort((left, right) =>
      (left.display_name || left.name).localeCompare(
        right.display_name || right.name,
      ),
    );
}

export function preferredSupplierIds(
  rows: Array<Pick<ReorderNeedRow, 'preferred_supplier_id'>>,
): string[] {
  return Array.from(
    new Set(
      rows
        .map((row) => row.preferred_supplier_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
}

export function suggestSupplierIdForRows(
  rows: Array<Pick<ReorderNeedRow, 'preferred_supplier_id'>>,
  suppliers: Client[],
): string | null {
  const ids = preferredSupplierIds(rows);
  if (ids.length !== 1) {
    return null;
  }
  const match = suppliers.find(
    (supplier) => supplier.id === ids[0] && supplier.status === 'active',
  );
  return match?.id ?? null;
}

export function itemMatchesSupplierFilter(
  itemId: string,
  linkedItemIds: Set<string> | null,
): boolean {
  if (!linkedItemIds) {
    return true;
  }
  return linkedItemIds.has(itemId);
}

export function preferredSupplierForItem(
  item: Pick<Item, 'preferred_supplier_id'> | null | undefined,
  clients: Client[],
): Client | null {
  if (!item?.preferred_supplier_id) {
    return null;
  }
  return (
    clients.find(
      (client) =>
        client.id === item.preferred_supplier_id &&
        client.status === 'active' &&
        Boolean(client.types?.includes('supplier')),
    ) ?? null
  );
}
