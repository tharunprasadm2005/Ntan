import { itemMatchesScannedCode } from './receiving.ts';
import { parseSerialNumbers } from './tracking.ts';
import type { Item, SupplierItem } from './types.ts';

/**
 * Pure helpers for the continuous receive scanner.
 *
 * The camera fires `onBarcodeScanned` on several frames for a single physical
 * barcode. A short per-code window suppresses those duplicate frames while
 * still allowing a deliberate second scan to increment the draft quantity.
 */
export const CAMERA_SCAN_DEDUPE_MS = 1500;
export const MAX_SCAN_QUANTITY = 999999;

export interface CameraScanGate {
  code: string;
  at: number;
}

export interface ScannableLine {
  key: string;
  itemId: string | null;
  qty: string;
  serials?: string;
}

export type ItemScanMode = 'add' | 'increment' | 'replace';

export interface ItemScanPlan {
  mode: ItemScanMode;
  lineKey: string | null;
  quantity: number;
}

export interface ReceiveScanEvent {
  id: string;
  code: string;
  label: string;
  quantity: number;
  mode: 'item' | 'serial';
  status: 'added' | 'incremented' | 'replaced' | 'error';
  at: number;
}

export function normalizeScanCode(value: string): string {
  return value.trim();
}

/** Camera frames are compared case-insensitively because scanners vary casing. */
export function scanGateCode(value: string): string {
  return normalizeScanCode(value).toUpperCase();
}

export function shouldAcceptCameraScan(
  previous: CameraScanGate | null,
  code: string,
  now: number,
  windowMs: number = CAMERA_SCAN_DEDUPE_MS,
): boolean {
  const next = scanGateCode(code);
  if (!next) {
    return false;
  }
  if (!previous) {
    return true;
  }
  if (scanGateCode(previous.code) !== next) {
    return true;
  }
  return now - previous.at >= Math.max(0, windowMs);
}

/**
 * Exact match against barcode, internal SKU and the selected supplier's SKU.
 * Callers pass the already owner/purchase-order filtered catalogue so an
 * unknown code can never resolve to an item outside the receiving context.
 */
export function findScannedItem(
  items: Item[],
  code: string,
  mappingFor: (item: Item) => SupplierItem | undefined,
): Item | null {
  const needle = scanGateCode(code);
  if (!needle) {
    return null;
  }
  return (
    items.find((item) => itemMatchesScannedCode(item, mappingFor(item), needle)) ?? null
  );
}

/**
 * Quantity typed for manual entry or a bulk carton. Blank falls back to one,
 * while zero, negative, non-numeric and absurdly large values are rejected so
 * the scanner never queues a quantity the receipt form cannot submit.
 */
export function parseScanQuantity(
  input: string | number | null | undefined,
  fallback = 1,
): number | null {
  const raw = typeof input === 'number' ? String(input) : (input ?? '').trim();
  if (!raw) {
    return fallback > 0 ? fallback : null;
  }
  const value = Number(raw.replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0 || value > MAX_SCAN_QUANTITY) {
    return null;
  }
  return Math.round(value * 1000) / 1000;
}

/**
 * Decides where a scanned item belongs. Quantity-tracked items merge into the
 * first line for the same item; serial-tracked items open a new unit line
 * unless the operator targeted an existing line.
 */
export function planItemScan(
  lines: ScannableLine[],
  options: {
    itemId: string;
    quantity: number;
    targetKey?: string | null;
    serialTracked?: boolean;
  },
): ItemScanPlan {
  const quantity =
    Number.isFinite(options.quantity) && options.quantity > 0
      ? Math.min(options.quantity, MAX_SCAN_QUANTITY)
      : 1;
  const target = options.targetKey
    ? lines.find((line) => line.key === options.targetKey)
    : undefined;
  if (target) {
    if (target.itemId === options.itemId) {
      return { mode: 'increment', lineKey: target.key, quantity };
    }
    return { mode: 'replace', lineKey: target.key, quantity };
  }
  if (!options.serialTracked) {
    const existing = lines.find((line) => line.itemId === options.itemId);
    if (existing) {
      return { mode: 'increment', lineKey: existing.key, quantity };
    }
  }
  return { mode: 'add', lineKey: null, quantity };
}

export function appendScannedSerial(
  serials: string,
  code: string,
): { serials: string; values: string[]; error: string | null } {
  const normalized = normalizeScanCode(code);
  const values = parseSerialNumbers(serials);
  if (!normalized) {
    return { serials, values, error: 'Enter or scan a serial number.' };
  }
  if (values.includes(normalized)) {
    return {
      serials,
      values,
      error: `Serial "${normalized}" is already on this line.`,
    };
  }
  const nextValue = serials.trim()
    ? `${serials.replace(/\s+$/, '')}\n${normalized}`
    : normalized;
  return {
    serials: nextValue,
    values: [...values, normalized],
    error: null,
  };
}

/** Live hint mirroring the receipt submit rule: one unique serial per unit. */
export function serialQuantityError(qty: string, serialCount: number): string | null {
  const numeric = Number(qty.replace(',', '.'));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 'Enter the received quantity for this line.';
  }
  if (!Number.isInteger(numeric)) {
    return 'Serial-tracked lines need a whole-number quantity.';
  }
  if (numeric !== serialCount) {
    return `Add exactly one serial number per unit (${serialCount} for ${numeric}).`;
  }
  return null;
}

/** Running totals shown in the scanner without touching inventory. */
export function receiveScanSummary(lines: ScannableLine[]): {
  lineCount: number;
  unitCount: number;
} {
  let lineCount = 0;
  let unitCount = 0;
  for (const line of lines) {
    if (!line.itemId) {
      continue;
    }
    lineCount += 1;
    const value = Number((line.qty || '0').replace(',', '.'));
    if (Number.isFinite(value) && value > 0) {
      unitCount += value;
    }
  }
  return { lineCount, unitCount };
}
