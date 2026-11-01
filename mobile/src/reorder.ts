import type { DraftLineState } from './receiveDraftStore';
import type { ReorderNeedRow, ReorderUrgency } from './types';

function asNumber(value: string | number | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function reorderRowKey(row: Pick<ReorderNeedRow, 'item_id' | 'warehouse_id'>): string {
  return `${row.item_id}:${row.warehouse_id ?? 'unassigned'}`;
}

export interface ReorderSuggestion {
  targetStock: number;
  targetAssumed: boolean;
  projectedStock: number;
  suggestedQty: number;
  urgency: ReorderUrgency | null;
  belowReorderPoint: boolean;
}

/**
 * Mirrors the backend calculation:
 *   projected = available + incoming
 *   suggested = max(0, target - projected)
 * When no target stock is configured, 2 x reorder point is used and flagged.
 */
export function suggestedReorderQty(input: {
  available: number | string;
  reorderPoint: number | string;
  targetStock?: number | string | null;
  incomingQty?: number | string | null;
}): ReorderSuggestion {
  const available = asNumber(input.available);
  const reorderPoint = asNumber(input.reorderPoint);
  const incoming = asNumber(input.incomingQty);
  const targetAssumed = input.targetStock === null || input.targetStock === undefined;
  const targetStock = targetAssumed ? reorderPoint * 2 : asNumber(input.targetStock);
  const projectedStock = available + incoming;
  const belowReorderPoint = available <= reorderPoint;
  let urgency: ReorderUrgency | null = null;
  if (belowReorderPoint) {
    urgency = available <= 0 ? 'stockout' : available <= reorderPoint * 0.5 ? 'critical' : 'low';
  }
  return {
    targetStock,
    targetAssumed,
    projectedStock,
    suggestedQty: Math.max(0, targetStock - projectedStock),
    urgency,
    belowReorderPoint,
  };
}

/**
 * Converts selected reorder rows into receive-draft lines. Only rows with a
 * positive quantity are returned; receiving remains the only stock-increasing
 * action, so this never mutates inventory on its own.
 */
export function buildReorderDraftLines(
  rows: ReorderNeedRow[],
  quantities: Record<string, string>,
  keepKey?: (row: ReorderNeedRow) => string | null,
): DraftLineState[] {
  const lines: DraftLineState[] = [];
  for (const row of rows) {
    const raw = quantities[reorderRowKey(row)] ?? row.suggested_qty;
    const qty = asNumber(raw);
    if (qty <= 0) {
      continue;
    }
    lines.push({
      key: keepKey?.(row) ?? reorderRowKey(row),
      itemId: row.item_id,
      qty: String(qty),
      lotNo: '',
      expiryDate: '',
      serials: '',
      discrepancyReason: '',
    });
  }
  return lines;
}
