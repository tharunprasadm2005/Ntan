import type { Receipt } from './types';

export interface DraftLineState {
  key: string;
  itemId: string;
  qty: string;
  lotNo: string;
  expiryDate: string;
  serials: string;
  discrepancyReason: string;
  orderedQty?: string;
  remainingQty?: string;
}

export interface ReceivePurchaseOrderLineState {
  itemId: string;
  sku: string;
  itemName: string;
  uom: string;
  lineId: string;
  orderedQty: string;
  receivedQty: string;
  remainingQty: string;
}

export interface ReceiveDraftState {
  lines: DraftLineState[];
  clientId: string | null;
  warehouseId: string | null;
  locationId: string | null;
  supplier: string;
  supplierId: string | null;
  purchaseOrder: string;
  purchaseOrderId: string | null;
  purchaseOrderNumber: string;
  purchaseOrderLines: ReceivePurchaseOrderLineState[];
  deliveryNote: string;
  note: string;
  pendingReceipt: Receipt | null;
  pendingReceiptId?: string | null;
  pendingKey: string | null;
}

/**
 * Persisted drafts are scoped by company, authenticated user and the receiving
 * context (owner/warehouse/location/supplier/purchase order). Only business
 * data needed to rebuild the form is stored; tokens and the server receipt
 * snapshot are never written to disk.
 */
export interface ReceiveDraftScope {
  companyId: string;
  userId: string;
  contextKey: string;
}

export interface StoredReceiveDraft {
  version: number;
  savedAt: string;
  scope: ReceiveDraftScope;
  draft: ReceiveDraftState;
}

export interface DraftPersistence {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const RECEIVE_DRAFT_VERSION = 1;
export const RECEIVE_DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const RECEIVE_DRAFT_MAX_LINES = 200;

const MAX_ID = 200;
const MAX_NAME = 200;
const MAX_NOTE = 4000;
const MAX_SERIALS = 20000;

let activeDraft: ReceiveDraftState | null = null;

export function getReceiveDraft(): ReceiveDraftState | null {
  return activeDraft;
}

export function setReceiveDraft(draft: ReceiveDraftState | null): void {
  activeDraft = draft;
}

export function clearReceiveDraft(): void {
  activeDraft = null;
}

export function receiveDraftContextKey(input: {
  warehouseId?: string | null;
  locationId?: string | null;
  supplierId?: string | null;
  purchaseOrderId?: string | null;
}): string {
  return [
    input.warehouseId ?? '-',
    input.locationId ?? '-',
    input.supplierId ?? '-',
    input.purchaseOrderId ?? '-',
  ].join('|');
}

export function receiveDraftStorageKey(scope: ReceiveDraftScope): string {
  return `receive:${scope.companyId}:${scope.userId}:${scope.contextKey}`;
}

export function receiveDraftPointerKey(companyId: string, userId: string): string {
  return `receive-latest:${companyId}:${userId}`;
}

export function isMeaningfulReceiveDraft(
  draft: ReceiveDraftState | null | undefined,
): boolean {
  if (!draft) {
    return false;
  }
  if (draft.pendingReceiptId) {
    return true;
  }
  return draft.lines.some((line) => Boolean(line.itemId));
}

function text(value: unknown, max: number, fallback = ''): string {
  return typeof value === 'string' ? value.slice(0, max) : fallback;
}

function optionalId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_ID) : null;
}

function sanitizeLine(raw: unknown): DraftLineState {
  const source = (raw ?? {}) as Record<string, unknown>;
  return {
    key: text(source.key, MAX_ID) || 'line',
    itemId: optionalId(source.itemId) ?? '',
    qty: text(source.qty, 64),
    lotNo: text(source.lotNo, 128),
    expiryDate: text(source.expiryDate, 32),
    serials: text(source.serials, MAX_SERIALS),
    discrepancyReason: text(source.discrepancyReason, 500),
    ...(typeof source.orderedQty === 'string'
      ? { orderedQty: source.orderedQty.slice(0, 64) }
      : {}),
    ...(typeof source.remainingQty === 'string'
      ? { remainingQty: source.remainingQty.slice(0, 64) }
      : {}),
  };
}

function sanitizePurchaseOrderLine(raw: unknown): ReceivePurchaseOrderLineState {
  const source = (raw ?? {}) as Record<string, unknown>;
  return {
    itemId: optionalId(source.itemId) ?? '',
    sku: text(source.sku, MAX_NAME),
    itemName: text(source.itemName, MAX_NAME),
    uom: text(source.uom, 32),
    lineId: optionalId(source.lineId) ?? '',
    orderedQty: text(source.orderedQty, 64),
    receivedQty: text(source.receivedQty, 64),
    remainingQty: text(source.remainingQty, 64),
  };
}

/**
 * Rebuilds a clean draft object. `pendingReceipt` is intentionally dropped:
 * the authoritative receipt stays on the server and only its identifier is
 * kept for display/cleanup.
 */
export function sanitizeReceiveDraft(raw: unknown): ReceiveDraftState {
  const source = (raw ?? {}) as Record<string, unknown>;
  const lines = Array.isArray(source.lines)
    ? source.lines.slice(0, RECEIVE_DRAFT_MAX_LINES).map(sanitizeLine)
    : [];
  const purchaseOrderLines = Array.isArray(source.purchaseOrderLines)
    ? source.purchaseOrderLines
        .slice(0, RECEIVE_DRAFT_MAX_LINES)
        .map(sanitizePurchaseOrderLine)
    : [];
  return {
    lines,
    clientId: optionalId(source.clientId),
    warehouseId: optionalId(source.warehouseId),
    locationId: optionalId(source.locationId),
    supplier: text(source.supplier, MAX_NAME),
    supplierId: optionalId(source.supplierId),
    purchaseOrder: text(source.purchaseOrder, MAX_NAME),
    purchaseOrderId: optionalId(source.purchaseOrderId),
    purchaseOrderNumber: text(source.purchaseOrderNumber, MAX_NAME),
    purchaseOrderLines,
    deliveryNote: text(source.deliveryNote, MAX_NOTE),
    note: text(source.note, MAX_NOTE),
    pendingReceipt: null,
    pendingReceiptId:
      optionalId(source.pendingReceiptId) ??
      optionalId((source.pendingReceipt as Record<string, unknown> | null)?.id),
    pendingKey: optionalId(source.pendingKey),
  };
}

export function serializeReceiveDraft(
  scope: ReceiveDraftScope,
  draft: ReceiveDraftState,
  now: number = Date.now(),
): string {
  const record: StoredReceiveDraft = {
    version: RECEIVE_DRAFT_VERSION,
    savedAt: new Date(now).toISOString(),
    scope: {
      companyId: scope.companyId,
      userId: scope.userId,
      contextKey: scope.contextKey,
    },
    draft: sanitizeReceiveDraft(draft),
  };
  return JSON.stringify(record);
}

export function parseStoredReceiveDraft(
  raw: string | null,
  options: {
    now?: number;
    companyId?: string;
    userId?: string;
    maxAgeMs?: number;
  } = {},
): StoredReceiveDraft | null {
  if (!raw) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  const record = parsed as Partial<StoredReceiveDraft>;
  if (record.version !== RECEIVE_DRAFT_VERSION) {
    return null;
  }
  const saved = Date.parse(typeof record.savedAt === 'string' ? record.savedAt : '');
  if (!Number.isFinite(saved)) {
    return null;
  }
  const now = options.now ?? Date.now();
  const age = now - saved;
  const maxAge = options.maxAgeMs ?? RECEIVE_DRAFT_MAX_AGE_MS;
  if (age > maxAge || age < -24 * 60 * 60 * 1000) {
    return null;
  }
  const scope = record.scope;
  if (
    !scope ||
    typeof scope.companyId !== 'string' ||
    typeof scope.userId !== 'string' ||
    typeof scope.contextKey !== 'string'
  ) {
    return null;
  }
  if (options.companyId && scope.companyId !== options.companyId) {
    return null;
  }
  if (options.userId && scope.userId !== options.userId) {
    return null;
  }
  const draft = sanitizeReceiveDraft(record.draft);
  if (!isMeaningfulReceiveDraft(draft)) {
    return null;
  }
  return {
    version: RECEIVE_DRAFT_VERSION,
    savedAt: new Date(saved).toISOString(),
    scope: {
      companyId: scope.companyId.slice(0, MAX_ID),
      userId: scope.userId.slice(0, MAX_ID),
      contextKey: scope.contextKey.slice(0, 1024),
    },
    draft,
  };
}

export async function savePersistedReceiveDraft(
  storage: DraftPersistence,
  scope: ReceiveDraftScope,
  draft: ReceiveDraftState,
  now: number = Date.now(),
): Promise<boolean> {
  if (!scope.companyId || !scope.userId || !isMeaningfulReceiveDraft(draft)) {
    return false;
  }
  try {
    await storage.setItem(
      receiveDraftStorageKey(scope),
      serializeReceiveDraft(scope, draft, now),
    );
    await storage.setItem(
      receiveDraftPointerKey(scope.companyId, scope.userId),
      receiveDraftStorageKey(scope),
    );
    return true;
  } catch {
    return false;
  }
}

export async function loadPersistedReceiveDraft(
  storage: DraftPersistence,
  companyId: string,
  userId: string,
  options: { now?: number; maxAgeMs?: number } = {},
): Promise<StoredReceiveDraft | null> {
  try {
    const pointer = await storage.getItem(receiveDraftPointerKey(companyId, userId));
    if (!pointer) {
      return null;
    }
    const raw = await storage.getItem(pointer);
    return parseStoredReceiveDraft(raw, { companyId, userId, ...options });
  } catch {
    return null;
  }
}

export async function clearPersistedReceiveDraft(
  storage: DraftPersistence,
  scope: ReceiveDraftScope,
): Promise<void> {
  try {
    await storage.removeItem(receiveDraftStorageKey(scope));
    const pointerKey = receiveDraftPointerKey(scope.companyId, scope.userId);
    const pointer = await storage.getItem(pointerKey);
    if (pointer === receiveDraftStorageKey(scope)) {
      await storage.removeItem(pointerKey);
    }
  } catch {
    // Local persistence is best-effort; a failure must never block receiving.
  }
}
