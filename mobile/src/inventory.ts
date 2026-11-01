import type { Balance, Item } from './types';

export interface ItemStockSummary {
  item: Item;
  onHand: number;
  available: number;
  blocked: number;
  quarantine: number;
  hasBalance: boolean;
  stockout: boolean;
  belowReorderPoint: boolean;
}

export interface StockSummary {
  items: ItemStockSummary[];
  totalOnHand: number;
  totalAvailable: number;
  blockedUnits: number;
  quarantineUnits: number;
  activeSkus: number;
  stockedSkus: number;
  stockoutCount: number;
  lowStockCount: number;
  balanceCount: number;
}

function asNumber(value: string | null | undefined): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function summarizeStock(items: Item[], balances: Balance[]): StockSummary {
  const byItem = new Map<string, ItemStockSummary>();
  for (const item of items) {
    byItem.set(item.id, {
      item,
      onHand: 0,
      available: 0,
      blocked: 0,
      quarantine: 0,
      hasBalance: false,
      stockout: false,
      belowReorderPoint: false,
    });
  }

  for (const balance of balances) {
    const summary = byItem.get(balance.item_id);
    if (!summary) {
      continue;
    }
    summary.hasBalance = true;
    const onHand = asNumber(balance.on_hand);
    summary.onHand += onHand;
    if (balance.stock_status === 'available') {
      summary.available += asNumber(balance.available);
      summary.blocked += asNumber(balance.blocked);
    } else if (balance.stock_status === 'quarantine') {
      summary.quarantine += onHand;
    } else if (balance.stock_status === 'blocked') {
      summary.blocked += onHand;
    }
  }

  const summarised = Array.from(byItem.values());
  for (const summary of summarised) {
    const reorderPoint =
      summary.item.reorder_point === null ? null : asNumber(summary.item.reorder_point);
    summary.stockout = summary.item.status === 'active' && summary.available <= 0;
    summary.belowReorderPoint =
      summary.item.status === 'active' &&
      summary.available > 0 &&
      reorderPoint !== null &&
      summary.available <= reorderPoint;
  }

  const active = summarised.filter((summary) => summary.item.status === 'active');
  const withBalance = summarised.filter((summary) => summary.hasBalance);

  return {
    items: summarised,
    totalOnHand: withBalance.reduce((total, summary) => total + summary.onHand, 0),
    totalAvailable: withBalance.reduce((total, summary) => total + summary.available, 0),
    blockedUnits: withBalance.reduce((total, summary) => total + summary.blocked, 0),
    quarantineUnits: withBalance.reduce((total, summary) => total + summary.quarantine, 0),
    activeSkus: active.length,
    stockedSkus: active.filter((summary) => summary.available > 0).length,
    stockoutCount: active.filter((summary) => summary.stockout).length,
    lowStockCount: active.filter((summary) => summary.belowReorderPoint).length,
    balanceCount: balances.length,
  };
}

export function lowStockItems(summary: StockSummary): ItemStockSummary[] {
  return summary.items
    .filter((item) => item.stockout || item.belowReorderPoint)
    .sort((left, right) => {
      if (left.stockout !== right.stockout) {
        return left.stockout ? -1 : 1;
      }
      return left.available - right.available;
    });
}
