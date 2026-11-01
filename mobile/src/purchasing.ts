import type {
  ReceiveDraftState,
  ReceivePurchaseOrderLineState,
} from './receiveDraftStore';
import type { PurchaseOrder, PurchaseOrderStatus, ReorderNeedRow } from './types';

export const purchaseOrderStatusLabels: Record<PurchaseOrderStatus, string> = {
  open: 'Open',
  partially_received: 'Partially received',
  received: 'Received',
  cancelled: 'Cancelled',
};

export const purchaseOrderStatusTones: Record<
  PurchaseOrderStatus,
  'success' | 'warning' | 'info' | 'neutral'
> = {
  open: 'info',
  partially_received: 'warning',
  received: 'success',
  cancelled: 'neutral',
};

function asNumber(value: string | number | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isPurchaseOrderReceivable(order: PurchaseOrder): boolean {
  return (
    (order.status === 'open' || order.status === 'partially_received') &&
    asNumber(order.remaining_qty) > 0
  );
}

/**
 * Builds the receive-stock prefill for an order. Only lines with quantity still
 * on order are pre-filled, and each quantity defaults to the remaining amount.
 * Stock does not change until the resulting receipt is committed.
 */
export function buildPurchaseOrderReceiveDraft(
  order: PurchaseOrder,
  keepKey: () => string,
  note?: string,
): ReceiveDraftState {
  const outstanding = order.lines.filter((line) => asNumber(line.remaining_qty) > 0);
  return {
    lines: outstanding.map((line) => ({
      key: keepKey(),
      itemId: line.item_id,
      qty: String(asNumber(line.remaining_qty)),
      lotNo: '',
      expiryDate: '',
      serials: '',
      discrepancyReason: '',
      orderedQty: line.ordered_qty,
      remainingQty: line.remaining_qty,
    })),
    clientId: order.client_id,
    warehouseId: order.warehouse_id,
    locationId: null,
    supplier: order.supplier_name,
    supplierId: order.supplier_id,
    purchaseOrder: order.number,
    purchaseOrderId: order.id,
    purchaseOrderNumber: order.number,
    purchaseOrderLines: order.lines.map((line) => ({
      itemId: line.item_id,
      sku: line.sku,
      itemName: line.item_name,
      uom: line.base_uom,
      lineId: line.id,
      orderedQty: line.ordered_qty,
      receivedQty: line.received_qty,
      remainingQty: line.remaining_qty,
    })),
    note: note ?? `Receiving against ${order.number}`,
    deliveryNote: '',
    pendingReceipt: null,
    pendingKey: null,
  };
}

/** Selected reorder quantities converted to purchase-order lines. */
export function buildPurchaseOrderLines(
  rows: ReorderNeedRow[],
  quantities: Record<string, string>,
  rowKey: (row: ReorderNeedRow) => string,
): Array<{ item_id: string; qty: string }> {
  const lines: Array<{ item_id: string; qty: string }> = [];
  for (const row of rows) {
    const raw = quantities[rowKey(row)] ?? row.suggested_qty;
    const qty = asNumber(raw);
    if (qty <= 0) {
      continue;
    }
    lines.push({ item_id: row.item_id, qty: String(qty) });
  }
  return lines;
}

export interface PurchaseOrderQuantityLine {
  itemId: string | null;
  qty: string;
}

/**
 * Client-side mirror of the server's receipt checks against a purchase order.
 * The server remains authoritative; this only prevents obviously invalid
 * submissions from being posted.
 */
export function purchaseOrderLineError(
  lines: PurchaseOrderQuantityLine[],
  orderLines: ReceivePurchaseOrderLineState[],
  orderNumber: string,
): string | null {
  const seen = new Set<string>();
  const byItem = new Map(orderLines.map((line) => [line.itemId, line]));
  for (const [index, line] of lines.entries()) {
    if (!line.itemId) {
      continue;
    }
    if (seen.has(line.itemId)) {
      return `Line ${index + 1}: each ordered item can appear only once on a receipt.`;
    }
    seen.add(line.itemId);
    const orderLine = byItem.get(line.itemId);
    if (!orderLine) {
      return `Line ${index + 1}: this item is not on purchase order ${orderNumber}.`;
    }
    const quantity = asNumber(line.qty.replace(',', '.'));
    const remaining = asNumber(orderLine.remainingQty);
    if (quantity > remaining) {
      return `Line ${index + 1}: ${orderLine.itemName} has only ${orderLine.remainingQty} ${orderLine.uom} remaining on ${orderNumber}.`;
    }
  }
  return null;
}

