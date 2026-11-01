import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Clipboard from 'expo-clipboard';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { randomUUID } from 'expo-crypto';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError } from '../api';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { useAuth } from '../auth';
import { EmptyState } from '../components/EmptyState';
import { Field } from '../components/Field';
import { SelectField } from '../components/SelectField';
import { PageHeader, Reveal } from '../components/ui';
import { useWorkspace } from '../data';
import { formatDateTime, formatQty, humanize } from '../format';
import {
  activeMappingMap,
  itemMatchesScannedCode,
  prioritiseMappedItems,
} from '../receiving';
import {
  clearReceiveDraft,
  clearPersistedReceiveDraft,
  getReceiveDraft,
  loadPersistedReceiveDraft,
  receiveDraftContextKey,
  savePersistedReceiveDraft,
  setReceiveDraft,
  type ReceiveDraftScope,
  type ReceivePurchaseOrderLineState,
} from '../receiveDraftStore';
import { receiveDraftStorage } from '../receiveDraftStorage';
import {
  appendScannedSerial,
  findScannedItem,
  parseScanQuantity,
  planItemScan,
  receiveScanSummary,
  shouldAcceptCameraScan,
  type CameraScanGate,
  type ReceiveScanEvent,
} from '../receiveScanner';
import { purchaseOrderLineError } from '../purchasing';
import { preferredSupplierForItem } from '../supplierMapping';
import { colors, fonts, neo, palette, radius, shadow, spacing } from '../theme';
import { isIsoDate, parseSerialNumbers } from '../tracking';
import type { Item, Receipt, SupplierItem } from '../types';

type ReceiptStatusFilter = 'all' | 'applied' | 'draft' | 'cancelled';

interface ReceiveScreenProps {
  onBack?: () => void;
  onGoToItems: () => void;
  onOpenPutaway: (receiptId?: string) => void;
  onOpenReceipt: (receiptId: string) => void;
  onOpenReorder: () => void;
  onOpenPurchaseOrders: () => void;
  onOpenPurchaseOrder: (purchaseOrderId: string) => void;
  onGoToPartners?: () => void;
  onGoToLocations?: () => void;
}

interface DraftLine {
  key: string;
  itemId: string | null;
  qty: string;
  lotNo: string;
  expiryDate: string;
  serials: string;
  discrepancyReason: string;
  orderedQty?: string;
  remainingQty?: string;
}

function newLine(): DraftLine {
  return {
    key: randomUUID(),
    itemId: null,
    qty: '',
    lotNo: '',
    expiryDate: '',
    serials: '',
    discrepancyReason: '',
  };
}

const receiptStatusLabels: Record<ReceiptStatusFilter, string> = {
  all: 'All',
  applied: 'Received',
  draft: 'Draft',
  cancelled: 'Cancelled',
};

export function ReceiveScreen({
  onBack,
  onGoToItems,
  onOpenPutaway,
  onOpenReceipt,
  onOpenReorder,
  onOpenPurchaseOrders,
  onOpenPurchaseOrder,
  onGoToPartners,
  onGoToLocations,
}: ReceiveScreenProps) {
  const insets = useSafeAreaInsets();
  const { state: authState, refreshSession } = useAuth();
  const session = authState.status === 'signedIn' ? authState.session : null;
  const canManagePartners = session?.permissions.includes('clients.manage') ?? false;
  const canWriteInventory = session?.permissions.includes('inventory.write') ?? false;
  const canReadCost = session?.permissions.includes('cost.read') ?? false;

  const {
    items,
    warehouses,
    locations,
    receipts,
    clients,
    inventoryOwners,
    internalClient,
    isMultiOwner,
    activeClientId,
    refreshing,
    refresh,
  } = useWorkspace();

  const singleOwnerId = internalClient?.id ?? inventoryOwners[0]?.id ?? null;
  const initialDraft = getReceiveDraft();

  const [lines, setLines] = useState<DraftLine[]>(() =>
    initialDraft?.lines && initialDraft.lines.length > 0
      ? initialDraft.lines.map((l) => ({ ...l, itemId: l.itemId || null }))
      : [newLine()],
  );
  const [clientId, setClientId] = useState<string | null>(
    initialDraft?.clientId !== undefined
      ? initialDraft.clientId
      : isMultiOwner
        ? activeClientId
        : singleOwnerId,
  );
  const [warehouseId, setWarehouseId] = useState<string | null>(
    initialDraft?.warehouseId ?? null,
  );
  const [locationId, setLocationId] = useState<string | null>(
    initialDraft?.locationId ?? null,
  );
  const [supplier, setSupplier] = useState(initialDraft?.supplier ?? '');
  const [supplierId, setSupplierId] = useState<string | null>(
    initialDraft?.supplierId ?? null,
  );
  const [purchaseOrder, setPurchaseOrder] = useState(
    initialDraft?.purchaseOrder ?? '',
  );
  const [purchaseOrderId, setPurchaseOrderId] = useState<string | null>(
    initialDraft?.purchaseOrderId ?? null,
  );
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState(
    initialDraft?.purchaseOrderNumber ?? '',
  );
  const [purchaseOrderLines, setPurchaseOrderLines] = useState<
    ReceivePurchaseOrderLineState[]
  >(initialDraft?.purchaseOrderLines ?? []);
  const [note, setNote] = useState(initialDraft?.note ?? '');
  const [deliveryNote, setDeliveryNote] = useState(initialDraft?.deliveryNote ?? '');
  const [supplierMappings, setSupplierMappings] = useState<SupplierItem[]>([]);
  const [supplierMappingsLoading, setSupplierMappingsLoading] = useState(false);
  const [receiptSearch, setReceiptSearch] = useState('');
  const [receiptSupplierFilter, setReceiptSupplierFilter] = useState<string | null>(null);
  const [receiptItemFilter, setReceiptItemFilter] = useState<string | null>(null);
  const [receiptWarehouseFilter, setReceiptWarehouseFilter] = useState<string | null>(null);
  const [receiptOwnerFilter, setReceiptOwnerFilter] = useState<string | null>(null);
  const [receiptStatusFilter, setReceiptStatusFilter] =
    useState<ReceiptStatusFilter>('all');
  const [receiptDateFrom, setReceiptDateFrom] = useState('');
  const [receiptDateTo, setReceiptDateTo] = useState('');
  const [receiptFiltersOpen, setReceiptFiltersOpen] = useState(false);
  const [receiptHistory, setReceiptHistory] = useState<Receipt[]>([]);
  const [receiptHistoryLoading, setReceiptHistoryLoading] = useState(false);
  const [receiptHistoryError, setReceiptHistoryError] = useState<string | null>(null);
  const [receiptExporting, setReceiptExporting] = useState(false);
  const [warehouseName, setWarehouseName] = useState('');
  const [creatingWarehouse, setCreatingWarehouse] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [cancellingDraftId, setCancellingDraftId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pendingReceipt, setPendingReceipt] = useState<Receipt | null>(
    initialDraft?.pendingReceipt ?? null,
  );
  const [pendingKey, setPendingKey] = useState<string | null>(
    initialDraft?.pendingKey ?? null,
  );
  const [completedReceipt, setCompletedReceipt] = useState<Receipt | null>(null);
  const [postingDraftId, setPostingDraftId] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  // Review & Confirmation Modal
  const [showReviewModal, setShowReviewModal] = useState(false);

  // Barcode Scanner Modal State
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scanMode, setScanMode] = useState<'item' | 'serial'>('item');
  const [scanTargetLineKey, setScanTargetLineKey] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [scanningPaused, setScanningPaused] = useState(false);
  const [scannerMessage, setScannerMessage] = useState<string | null>(null);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [unmatchedBarcode, setUnmatchedBarcode] = useState<string | null>(null);
  const [manualCodeInput, setManualCodeInput] = useState('');
  const [manualQtyInput, setManualQtyInput] = useState('1');
  const [recentScans, setRecentScans] = useState<ReceiveScanEvent[]>([]);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const lastScanGate = useRef<CameraScanGate | null>(null);
  const lastLineStateBeforeScan = useRef<DraftLine[] | null>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const formTop = useRef(0);
  const recentTop = useRef(0);

  // Draft persistence prompt state
  const [persistedDraftOffer, setPersistedDraftOffer] = useState<{
    savedAt: string;
    lineCount: number;
    draft: any;
    scope: ReceiveDraftScope;
  } | null>(null);

  // Check for saved uncommitted draft on mount
  useEffect(() => {
    if (!session?.company?.id || !session?.user?.id) return;
    let isCancelled = false;
    void (async () => {
      const stored = await loadPersistedReceiveDraft(
        receiveDraftStorage,
        session.company.id,
        session.user.id,
      );
      if (isCancelled || !stored) return;
      // Only offer restore if current lines are blank/single empty line
      const hasUnsavedWork = lines.some((l) => Boolean(l.itemId));
      if (!hasUnsavedWork) {
        setPersistedDraftOffer({
          savedAt: stored.savedAt,
          lineCount: stored.draft.lines.filter((l) => Boolean(l.itemId)).length,
          draft: stored.draft,
          scope: stored.scope,
        });
      }
    })();
    return () => {
      isCancelled = true;
    };
  }, [session?.company?.id, session?.user?.id]);

  // Quick Create Supplier Modal State
  const [quickSupplierModal, setQuickSupplierModal] = useState(false);
  const [quickSupplierName, setQuickSupplierName] = useState('');
  const [quickSupplierCode, setQuickSupplierCode] = useState('');
  const [quickSupplierPhone, setQuickSupplierPhone] = useState('');
  const [quickSupplierSaving, setQuickSupplierSaving] = useState(false);
  const [quickSupplierError, setQuickSupplierError] = useState<string | null>(null);

  // Quick Create Item Modal State
  const [quickItemModal, setQuickItemModal] = useState(false);
  const [quickItemSku, setQuickItemSku] = useState('');
  const [quickItemName, setQuickItemName] = useState('');
  const [quickItemBarcode, setQuickItemBarcode] = useState('');
  const [quickItemUom, setQuickItemUom] = useState('ea');
  const [quickItemTracking, setQuickItemTracking] = useState<'none' | 'lot' | 'serial'>('none');
  const [quickItemSaving, setQuickItemSaving] = useState(false);
  const [quickItemError, setQuickItemError] = useState<string | null>(null);
  const [quickItemTargetLineKey, setQuickItemTargetLineKey] = useState<string | null>(null);

  // Auto-save draft on any change (memory + persistent device storage)
  useEffect(() => {
    if (completedReceipt) {
      clearReceiveDraft();
      if (session?.company?.id && session?.user?.id) {
        const scope: ReceiveDraftScope = {
          companyId: session.company.id,
          userId: session.user.id,
          contextKey: receiveDraftContextKey({
            warehouseId,
            locationId,
            supplierId,
            purchaseOrderId,
          }),
        };
        void clearPersistedReceiveDraft(receiveDraftStorage, scope);
      }
      return;
    }

    const draftState = {
      lines: lines.map((l) => ({ ...l, itemId: l.itemId || '' })),
      clientId,
      warehouseId,
      locationId,
      supplier,
      supplierId,
      purchaseOrder,
      purchaseOrderId,
      purchaseOrderNumber,
      purchaseOrderLines,
      note,
      deliveryNote,
      pendingReceipt,
      pendingKey,
    };

    setReceiveDraft(draftState);

    // Persist to offline storage if has meaningful content
    if (session?.company?.id && session?.user?.id) {
      const scope: ReceiveDraftScope = {
        companyId: session.company.id,
        userId: session.user.id,
        contextKey: receiveDraftContextKey({
          warehouseId,
          locationId,
          supplierId,
          purchaseOrderId,
        }),
      };
      void savePersistedReceiveDraft(receiveDraftStorage, scope, draftState);
    }
  }, [
    lines,
    clientId,
    warehouseId,
    locationId,
    supplier,
    supplierId,
    purchaseOrder,
    purchaseOrderId,
    purchaseOrderNumber,
    purchaseOrderLines,
    note,
    deliveryNote,
    pendingReceipt,
    pendingKey,
    completedReceipt,
  ]);

  useEffect(() => {
    if (isMultiOwner) {
      if (clientId === undefined || clientId === null) {
        setClientId(activeClientId);
      }
    } else {
      setClientId(singleOwnerId);
    }
  }, [isMultiOwner, activeClientId, singleOwnerId, clientId]);

  const receiptClientId = isMultiOwner ? clientId : singleOwnerId;
  const selectedClient =
    inventoryOwners.find((client) => client.id === receiptClientId) ?? null;

  const warehouseLocations = useMemo(
    () => locations.filter((location) => location.warehouse_id === warehouseId),
    [locations, warehouseId],
  );

  const selectedLocation = warehouseLocations.find((location) => location.id === locationId);
  const isStagingLocation =
    selectedLocation?.type === 'receiving' || selectedLocation?.type === 'staging';

  // Pre-filled receipts (for example from a purchase order) arrive with a
  // warehouse but no location; pick the receiving dock so the form is usable.
  useEffect(() => {
    if (!warehouseId || locationId) return;
    const options = locations.filter((location) => location.warehouse_id === warehouseId);
    if (options.length === 0) return;
    const receiving =
      options.find((location) => location.type === 'receiving') ??
      options.find((location) => location.type === 'staging') ??
      options[0];
    setLocationId(receiving.id);
  }, [warehouseId, locationId, locations]);

  const completedLocation =
    locations.find((location) => location.id === completedReceipt?.location_id) ??
    selectedLocation;

  const activeItems = useMemo(
    () =>
      items.filter(
        (item) =>
          item.status === 'active' &&
          (!receiptClientId || item.client_id === receiptClientId),
      ),
    [items, receiptClientId],
  );

  const lineItemOptions = useMemo(() => {
    if (purchaseOrderLines.length === 0) {
      return activeItems;
    }
    const allowed = new Set(purchaseOrderLines.map((line) => line.itemId));
    return activeItems.filter((item) => allowed.has(item.id));
  }, [activeItems, purchaseOrderLines]);

  const availableSuppliers = useMemo(
    () =>
      clients
        .filter((c) => c.status === 'active' && c.types?.includes('supplier'))
        .sort((left, right) =>
          (left.display_name || left.name).localeCompare(
            right.display_name || right.name,
          ),
        ),
    [clients],
  );

  const receiptSupplierFilterOptions = useMemo(
    () =>
      clients
        .filter((c) => c.types?.includes('supplier'))
        .sort((left, right) =>
          (left.display_name || left.name).localeCompare(
            right.display_name || right.name,
          ),
        ),
    [clients],
  );

  const supplierItemMap = useMemo(
    () => activeMappingMap(supplierMappings),
    [supplierMappings],
  );

  // Mapped items are listed first so supplier-specific receiving is faster;
  // unmapped items remain selectable for legitimate one-off deliveries.
  const prioritisedLineItemOptions = useMemo(
    () => prioritiseMappedItems(lineItemOptions, supplierItemMap, supplierId),
    [lineItemOptions, supplierId, supplierItemMap],
  );

  useEffect(() => {
    let cancelled = false;
    if (!supplierId) {
      setSupplierMappings([]);
      setSupplierMappingsLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setSupplierMappingsLoading(true);
    api
      .supplierItems(supplierId, true)
      .then((response) => {
        if (!cancelled) {
          setSupplierMappings(response.items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSupplierMappings([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSupplierMappingsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [supplierId]);

  const receiptHistoryFilters = useMemo(
    () => ({
      status: receiptStatusFilter,
      supplierId: receiptSupplierFilter,
      itemId: receiptItemFilter,
      warehouseId: receiptWarehouseFilter,
      clientId: isMultiOwner ? receiptOwnerFilter : null,
      dateFrom: isIsoDate(receiptDateFrom) ? receiptDateFrom : null,
      dateTo: isIsoDate(receiptDateTo) ? receiptDateTo : null,
      search: receiptSearch,
    }),
    [
      receiptStatusFilter,
      receiptSupplierFilter,
      receiptItemFilter,
      receiptWarehouseFilter,
      receiptOwnerFilter,
      receiptDateFrom,
      receiptDateTo,
      receiptSearch,
      isMultiOwner,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    setReceiptHistoryLoading(true);
    setReceiptHistoryError(null);
    api
      .receiptHistory({ ...receiptHistoryFilters, limit: 25 })
      .then((response) => {
        if (!cancelled) {
          setReceiptHistory(response.receipts);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setReceiptHistoryError(
            caught instanceof ApiError
              ? caught.message
              : 'Could not load receipt history.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setReceiptHistoryLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [receiptHistoryFilters]);

  const completedClient =
    clients.find((client) => client.id === completedReceipt?.client_id) ?? null;
  const activeWarehouses = warehouses.filter((warehouse) => warehouse.status === 'active');
  const draftReceipts = receipts.filter((receipt) => receipt.status === 'draft');

  const chooseClient = (value: string) => {
    setClientId(value);
    setLines([newLine()]);
    setPendingReceipt(null);
    setPendingKey(null);
    setPurchaseOrderId(null);
    setPurchaseOrderNumber('');
    setPurchaseOrderLines([]);
    setError(null);
    setFieldErrors({});
  };

  const chooseWarehouse = (value: string) => {
    setWarehouseId(value);
    if (purchaseOrderId) {
      setPurchaseOrderId(null);
      setPurchaseOrderNumber('');
      setPurchaseOrderLines([]);
    }
    const options = locations.filter((location) => location.warehouse_id === value);
    const receiving =
      options.find((location) => location.type === 'receiving') ??
      options.find((location) => location.type === 'staging') ??
      options[0];
    setLocationId(receiving?.id ?? null);
  };

  const updateLine = (key: string, changes: Partial<DraftLine>) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...changes } : line)),
    );
  };

  const removeLine = (key: string) => {
    setLines((current) => {
      if (current.length === 1) {
        return current;
      }
      return current.filter((line) => line.key !== key);
    });
  };

  // Approved supplier mappings are a suggestion only. A one-off purchase can
  // still be received from any supplier, including one with no mapping.
  const suggestSupplierForItem = (item: Item | undefined) => {
    if (!item?.preferred_supplier_id || supplierId || purchaseOrderId) {
      return;
    }
    const supplierRecord = preferredSupplierForItem(item, clients);
    if (!supplierRecord) {
      return;
    }
    setSupplierId(supplierRecord.id);
    setSupplier(
      supplierRecord.display_name || supplierRecord.name,
    );
  };

  const addPurchaseOrderLine = () => {
    const used = new Set(lines.map((line) => line.itemId));
    const next = purchaseOrderLines.find(
      (line) => Number(line.remainingQty) > 0 && !used.has(line.itemId),
    );
    if (!next) {
      Alert.alert(
        'All order lines added',
        `Every item with a remaining quantity on ${purchaseOrderNumber} is already on this receipt.`,
      );
      return;
    }
    setLines((current) => [
      ...current,
      {
        ...newLine(),
        itemId: next.itemId,
        qty: String(Number(next.remainingQty)),
        orderedQty: next.orderedQty,
        remainingQty: next.remainingQty,
      },
    ]);
  };

  const addLine = () => {
    if (purchaseOrderId) {
      addPurchaseOrderLine();
      return;
    }
    setLines((current) => [...current, newLine()]);
  };

  // Barcode / Serial Scanner Handlers
  const openItemScanner = (lineKey?: string) => {
    setScanMode('item');
    setScanTargetLineKey(lineKey ?? null);
    setScannerMessage(null);
    setScannerError(null);
    setUnmatchedBarcode(null);
    setManualCodeInput('');
    setManualQtyInput('1');
    lastScanGate.current = null;
    setScannerVisible(true);
  };

  const openSerialScanner = (lineKey: string) => {
    setScanMode('serial');
    setScanTargetLineKey(lineKey);
    setScannerMessage(null);
    setScannerError(null);
    setUnmatchedBarcode(null);
    setManualCodeInput('');
    setManualQtyInput('1');
    lastScanGate.current = null;
    setScannerVisible(true);
  };

  const processScanCode = (
    rawCode: string,
    quantityOverride?: number,
    source: 'camera' | 'manual' = 'camera',
  ) => {
    const code = rawCode.trim();
    if (!code) return;

    const now = Date.now();
    if (
      source === 'camera' &&
      !shouldAcceptCameraScan(lastScanGate.current, code, now)
    ) {
      return;
    }
    lastScanGate.current = { code, at: now };

    setScannerError(null);

    if (scanMode === 'item') {
      const candidates = purchaseOrderId ? lineItemOptions : activeItems;
      const matched = findScannedItem(candidates, code, (it) =>
        supplierItemMap.get(it.id),
      );

      if (matched) {
        // Save undo snapshot
        lastLineStateBeforeScan.current = [...lines];

        const parsedQty = quantityOverride ?? parseScanQuantity(manualQtyInput, 1) ?? 1;
        const isSerial = matched.tracking_mode === 'serial';

        const plan = planItemScan(
          lines.map((l) => ({
            key: l.key,
            itemId: l.itemId,
            qty: l.qty,
            serials: l.serials,
          })),
          {
            itemId: matched.id,
            quantity: parsedQty,
            targetKey: scanTargetLineKey,
            serialTracked: isSerial,
          },
        );

        if (plan.mode === 'increment' && plan.lineKey) {
          const target = lines.find((l) => l.key === plan.lineKey);
          const currentQty = Number((target?.qty || '0').replace(',', '.'));
          const nextQty = Math.max(1, (Number.isFinite(currentQty) ? currentQty : 0) + plan.quantity);
          updateLine(plan.lineKey, { qty: String(nextQty) });

          setScannerMessage(
            `+${plan.quantity} ${matched.name} (Total: ${nextQty} ${matched.base_uom})`,
          );
          setRecentScans((prev) => [
            {
              id: randomUUID(),
              code,
              label: matched.name,
              quantity: plan.quantity,
              mode: 'item',
              status: 'incremented',
              at: now,
            },
            ...prev.slice(0, 9),
          ]);
        } else if (plan.mode === 'replace' && plan.lineKey) {
          updateLine(plan.lineKey, {
            itemId: matched.id,
            qty: String(plan.quantity),
            lotNo: '',
            expiryDate: '',
            serials: '',
          });
          setScannerMessage(`Selected ${matched.name} (${plan.quantity} ${matched.base_uom})`);
          setRecentScans((prev) => [
            {
              id: randomUUID(),
              code,
              label: matched.name,
              quantity: plan.quantity,
              mode: 'item',
              status: 'replaced',
              at: now,
            },
            ...prev.slice(0, 9),
          ]);
        } else {
          // Add new line or populate initial blank line
          setLines((current) => {
            if (current.length === 1 && !current[0].itemId) {
              return [
                {
                  ...current[0],
                  itemId: matched.id,
                  qty: String(plan.quantity),
                  lotNo: '',
                  expiryDate: '',
                  serials: '',
                },
              ];
            }
            return [
              ...current,
              {
                ...newLine(),
                itemId: matched.id,
                qty: String(plan.quantity),
              },
            ];
          });
          setScannerMessage(`Added ${matched.name} (${plan.quantity} ${matched.base_uom})`);
          setRecentScans((prev) => [
            {
              id: randomUUID(),
              code,
              label: matched.name,
              quantity: plan.quantity,
              mode: 'item',
              status: 'added',
              at: now,
            },
            ...prev.slice(0, 9),
          ]);
        }

        setUnmatchedBarcode(null);
        suggestSupplierForItem(matched);
      } else {
        setUnmatchedBarcode(code);
        setScannerError(
          purchaseOrderId
            ? `"${code}" is not an outstanding item on order ${purchaseOrderNumber}.`
            : `Product "${code}" is not in item catalogue.`,
        );
      }
    } else if (scanMode === 'serial' && scanTargetLineKey) {
      const targetLine = lines.find((l) => l.key === scanTargetLineKey);
      if (!targetLine) {
        setScannerError('Target line not found.');
        return;
      }

      const result = appendScannedSerial(targetLine.serials, code);
      if (result.error) {
        setScannerError(result.error);
        return;
      }

      // Save undo snapshot
      lastLineStateBeforeScan.current = [...lines];

      updateLine(scanTargetLineKey, { serials: result.serials });
      const totalSerials = result.values.length;
      setScannerMessage(`Added serial: ${code} (${totalSerials} total recorded)`);
      setRecentScans((prev) => [
        {
          id: randomUUID(),
          code,
          label: `Serial: ${code}`,
          quantity: 1,
          mode: 'serial',
          status: 'added',
          at: now,
        },
        ...prev.slice(0, 9),
      ]);
    }
  };

  const handleBarcodeScanned = (scanResult: BarcodeScanningResult) => {
    if (scanningPaused) return;
    processScanCode(scanResult.data, undefined, 'camera');
  };

  const handleManualScanSubmit = () => {
    const code = manualCodeInput.trim();
    if (!code) {
      setScannerError('Enter a barcode or SKU.');
      return;
    }
    const qty = parseScanQuantity(manualQtyInput, 1);
    if (!qty) {
      setScannerError('Enter a valid positive quantity.');
      return;
    }
    processScanCode(code, qty, 'manual');
    setManualCodeInput('');
  };

  const handleUndoLastScan = () => {
    if (lastLineStateBeforeScan.current) {
      setLines(lastLineStateBeforeScan.current);
      lastLineStateBeforeScan.current = null;
      setRecentScans((prev) => prev.slice(1));
      setScannerMessage('Last scan reverted.');
      setScannerError(null);
    }
  };

  const handleCreateQuickSupplier = async () => {
    if (!quickSupplierName.trim()) {
      setQuickSupplierError('Enter a supplier name.');
      return;
    }
    setQuickSupplierSaving(true);
    setQuickSupplierError(null);
    try {
      const code = (
        quickSupplierCode.trim() || `SUP-${Date.now().toString().slice(-4)}`
      ).toUpperCase();
      const created = await api.createClient({
        name: quickSupplierName.trim(),
        code,
        types: ['supplier'],
        contact_phone: quickSupplierPhone.trim() || undefined,
      });
      await Promise.all([refreshSession(), refresh()]);
      setSupplier(created.display_name || created.name);
      setSupplierId(created.id);
      setQuickSupplierName('');
      setQuickSupplierCode('');
      setQuickSupplierPhone('');
      setQuickSupplierModal(false);
    } catch (caught) {
      setQuickSupplierError(
        caught instanceof ApiError ? caught.message : 'Could not create supplier.',
      );
    } finally {
      setQuickSupplierSaving(false);
    }
  };

  const openQuickItemModal = (prefillBarcode?: string, targetKey?: string | null) => {
    setQuickItemBarcode(prefillBarcode ?? '');
    setQuickItemSku(prefillBarcode ? prefillBarcode.toUpperCase() : '');
    setQuickItemName('');
    setQuickItemUom('ea');
    setQuickItemTracking('none');
    setQuickItemError(null);
    setQuickItemTargetLineKey(targetKey ?? null);
    setQuickItemModal(true);
  };

  const handleCreateQuickItem = async () => {
    if (!quickItemSku.trim()) {
      setQuickItemError('Enter a product SKU.');
      return;
    }
    if (!quickItemName.trim()) {
      setQuickItemError('Enter a product name.');
      return;
    }
    setQuickItemSaving(true);
    setQuickItemError(null);
    try {
      const created = await api.createItem({
        sku: quickItemSku.trim().toUpperCase(),
        name: quickItemName.trim(),
        barcode: quickItemBarcode.trim() || undefined,
        base_uom: quickItemUom.trim().toLowerCase() || 'ea',
        tracking_mode: quickItemTracking,
        client_id: receiptClientId || undefined,
      });
      await refresh();
      if (quickItemTargetLineKey) {
        updateLine(quickItemTargetLineKey, {
          itemId: created.id,
          qty: '1',
          lotNo: '',
          expiryDate: '',
          serials: '',
        });
      } else {
        setLines((current) => {
          if (current.length === 1 && !current[0].itemId) {
            return [{ ...current[0], itemId: created.id, qty: '1', lotNo: '', expiryDate: '', serials: '' }];
          }
          return [...current, { ...newLine(), itemId: created.id, qty: '1' }];
        });
      }
      setQuickItemModal(false);
      setUnmatchedBarcode(null);
      // Return to scanner and log event
      setScannerMessage(`Created and added "${created.name}" (1 ${created.base_uom})`);
      setScannerVisible(true);
      setRecentScans((prev) => [
        {
          id: randomUUID(),
          code: created.barcode || created.sku,
          label: created.name,
          quantity: 1,
          mode: 'item',
          status: 'added',
          at: Date.now(),
        },
        ...prev.slice(0, 9),
      ]);
    } catch (caught) {
      setQuickItemError(
        caught instanceof ApiError ? caught.message : 'Could not create item.',
      );
    } finally {
      setQuickItemSaving(false);
    }
  };

  const createWarehouse = async () => {
    if (!warehouseName.trim()) {
      setError('Enter a warehouse name.');
      return;
    }
    setCreatingWarehouse(true);
    setError(null);
    try {
      const warehouse = await api.createWarehouse({ name: warehouseName.trim() });
      setWarehouseName('');
      await refresh();
      setWarehouseId(warehouse.id);
      const allLocations = await api.locations(warehouse.id);
      const receiving =
        allLocations.locations.find((location) => location.type === 'receiving') ??
        allLocations.locations[0];
      setLocationId(receiving?.id ?? null);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The warehouse could not be created.',
      );
    } finally {
      setCreatingWarehouse(false);
    }
  };

  const resumeDraft = (draft: Receipt) => {
    setPendingReceipt(draft);
    setPendingKey(randomUUID());
    setWarehouseId(draft.warehouse_id);
    setLocationId(draft.location_id);
    if (draft.client_id) {
      setClientId(draft.client_id);
    }
    setSupplier(draft.supplier || '');
    setSupplierId(draft.supplier_id ?? null);
    setPurchaseOrder(draft.purchase_order || '');
    setPurchaseOrderId(draft.purchase_order_id ?? null);
    setPurchaseOrderNumber(draft.purchase_order || '');
    setPurchaseOrderLines([]);
    setNote(draft.note || '');
    setDeliveryNote(draft.delivery_note || '');

    // Reload the linked order so resumed drafts keep ordered/remaining context
    // and cannot add items that were never ordered.
    if (draft.purchase_order_id) {
      void api
        .purchaseOrder(draft.purchase_order_id)
        .then((order) => {
          setPurchaseOrderNumber(order.number);
          setPurchaseOrderLines(
            order.lines.map((line) => ({
              itemId: line.item_id,
              sku: line.sku,
              itemName: line.item_name,
              uom: line.base_uom,
              lineId: line.id,
              orderedQty: line.ordered_qty,
              receivedQty: line.received_qty,
              remainingQty: line.remaining_qty,
            })),
          );
          setLines((current) =>
            current.map((line) => {
              const orderLine = order.lines.find(
                (entry) => entry.item_id === line.itemId,
              );
              if (!orderLine) {
                return line;
              }
              return {
                ...line,
                orderedQty: orderLine.ordered_qty,
                remainingQty: orderLine.remaining_qty,
              };
            }),
          );
        })
        .catch(() => {
          // The order may have been cancelled or removed; the server still
          // validates the draft when it is posted, so keep the draft usable.
        });
    }

    if (draft.lines.length > 0) {
      setLines(
        draft.lines.map((l) => ({
          key: randomUUID(),
          itemId: l.item_id,
          qty: String(l.qty),
          lotNo: l.lot_no || '',
          expiryDate: l.expiry_date ? String(l.expiry_date).split('T')[0] : '',
          serials: (l.serial_numbers || []).join('\n'),
          discrepancyReason: l.discrepancy_reason || '',
        })),
      );
    }
    setError(null);
    setFieldErrors({});
  };

  const cancelDraft = async (receiptId: string) => {
    setCancellingDraftId(receiptId);
    setDraftError(null);
    try {
      await api.cancelReceipt(receiptId);
      if (pendingReceipt?.id === receiptId) {
        resetForm();
      }
      await refresh();
    } catch (caught) {
      setDraftError(
        caught instanceof ApiError ? caught.message : 'The draft receipt could not be cancelled.',
      );
    } finally {
      setCancellingDraftId(null);
    }
  };

  const postDraft = async (receipt: Receipt) => {
    setPostingDraftId(receipt.id);
    setDraftError(null);
    try {
      const committed = await api.commitReceipt(receipt.id);
      setCompletedReceipt(committed);
      clearReceiveDraft();
      await refresh();
    } catch (caught) {
      setDraftError(
        caught instanceof ApiError
          ? caught.message
          : 'The draft receipt could not be posted. Please try again.',
      );
    } finally {
      setPostingDraftId(null);
    }
  };

  const resetForm = () => {
    clearReceiveDraft();
    setLines([newLine()]);
    setSupplier('');
    setSupplierId(null);
    setPurchaseOrder('');
    setPurchaseOrderId(null);
    setPurchaseOrderNumber('');
    setPurchaseOrderLines([]);
    setNote('');
    setDeliveryNote('');
    setPendingReceipt(null);
    setPendingKey(null);
    setCompletedReceipt(null);
    setError(null);
    setFieldErrors({});
    setShowReviewModal(false);
  };

  const scrollToNewReceipt = () => {
    scrollRef.current?.scrollTo({ y: Math.max(formTop.current - 12, 0), animated: true });
  };

  const scrollToRecentReceipts = () => {
    if (receiptHistory.length === 0 && !receiptSearch.trim()) {
      Alert.alert(
        'No recent receipts',
        'Posted deliveries will appear here after a receipt is committed.',
      );
      return;
    }
    scrollRef.current?.scrollTo({ y: Math.max(recentTop.current - 12, 0), animated: true });
  };

  const clearReceiptFilters = () => {
    setReceiptSearch('');
    setReceiptSupplierFilter(null);
    setReceiptItemFilter(null);
    setReceiptWarehouseFilter(null);
    setReceiptOwnerFilter(null);
    setReceiptStatusFilter('all');
    setReceiptDateFrom('');
    setReceiptDateTo('');
  };

  const exportReceiptHistory = async () => {
    setReceiptExporting(true);
    try {
      const csvData = await api.exportReceiptsCsv(receiptHistoryFilters);
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `receipt-history_${Date.now()}.csv`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
      }
      await Clipboard.setStringAsync(csvData);
      Alert.alert(
        'Receipt history exported',
        `${receiptHistory.length} recent receipts exported as CSV and copied to the clipboard.`,
      );
    } catch (caught) {
      Alert.alert(
        'Export failed',
        caught instanceof ApiError ? caught.message : 'Could not export receipt history.',
      );
    } finally {
      setReceiptExporting(false);
    }
  };

  const explainPurchaseOrders = () => {
    onOpenPurchaseOrders();
  };

  const validateAndPrepare = () => {
    setError(null);
    setFieldErrors({});
    if (!receiptClientId || receiptClientId.toLowerCase() === 'all') {
      setError('Select the inventory owner whose stock is being received.');
      return null;
    }
    if (!warehouseId || !locationId) {
      setError('Select a warehouse and receiving location.');
      return null;
    }
    if (activeItems.length === 0) {
      setError('Create an active item before receiving stock.');
      return null;
    }
    if (purchaseOrder.trim() && !supplier.trim()) {
      setError('A supplier must be specified when entering a purchase order reference.');
      return null;
    }

    if (purchaseOrderId && purchaseOrderLines.length > 0) {
      const poError = purchaseOrderLineError(
        lines,
        purchaseOrderLines,
        purchaseOrderNumber || purchaseOrder,
      );
      if (poError) {
        setError(poError);
        return null;
      }
    }

    const preparedLines: Array<{
      item_id: string;
      qty: string;
      uom: string;
      lot_no?: string;
      expiry_date?: string;
      serial_numbers?: string[];
      discrepancy_reason?: string;
    }> = [];

    const seenSerialsInBatch = new Set<string>();

    for (const [index, line] of lines.entries()) {
      if (!line.itemId) {
        setError(`Select an item on line ${index + 1}.`);
        return null;
      }
      const numericQuantity = Number(line.qty.replace(',', '.'));
      if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) {
        setError(`Enter a quantity greater than zero on line ${index + 1}.`);
        return null;
      }
      const item = activeItems.find((entry) => entry.id === line.itemId);
      if (!item) {
        setError(`The item on line ${index + 1} is no longer active.`);
        return null;
      }
      const preparedLine: (typeof preparedLines)[number] = {
        item_id: line.itemId,
        qty: String(numericQuantity),
        uom: item.base_uom,
      };

      if (line.discrepancyReason.trim()) {
        preparedLine.discrepancy_reason = line.discrepancyReason.trim();
      }

      if (item.tracking_mode === 'lot') {
        if (!line.lotNo.trim()) {
          setError(`Enter a lot number on line ${index + 1}.`);
          return null;
        }
        preparedLine.lot_no = line.lotNo.trim();
      }

      if (item.tracking_mode === 'serial') {
        const serials = parseSerialNumbers(line.serials);
        if (!Number.isInteger(numericQuantity) || serials.length !== numericQuantity) {
          setError(`Add exactly one serial number per unit on line ${index + 1} (${serials.length} serials for ${numericQuantity} units).`);
          return null;
        }
        // Check within-line and cross-line duplicates
        for (const sn of serials) {
          if (seenSerialsInBatch.has(`${item.id}:${sn}`)) {
            setError(`Serial number "${sn}" appears more than once in this delivery.`);
            return null;
          }
          seenSerialsInBatch.add(`${item.id}:${sn}`);
        }
        preparedLine.serial_numbers = serials;
      }

      if (item.expiry_tracked) {
        if (!line.expiryDate.trim()) {
          setError(`Enter an expiry date on line ${index + 1}.`);
          return null;
        }
        if (!isIsoDate(line.expiryDate.trim())) {
          setError(`Use YYYY-MM-DD for the expiry date on line ${index + 1}.`);
          return null;
        }
      }

      if (line.expiryDate.trim()) {
        if (!isIsoDate(line.expiryDate.trim())) {
          setError(`Use YYYY-MM-DD for the expiry date on line ${index + 1}.`);
          return null;
        }
        preparedLine.expiry_date = line.expiryDate.trim();
      }

      preparedLines.push(preparedLine);
    }

    return preparedLines;
  };

  const handleOpenReview = () => {
    const prepared = validateAndPrepare();
    if (!prepared) return;
    setShowReviewModal(true);
  };

  const handleSaveDraft = async () => {
    const preparedLines = validateAndPrepare();
    if (!preparedLines) return;

    setSavingDraft(true);
    setError(null);
    try {
      // Receipt drafts cannot be edited in place, so a resumed draft is
      // cancelled and re-created with the current form values and a new key.
      if (pendingReceipt) {
        await api.cancelReceipt(pendingReceipt.id);
        setPendingReceipt(null);
        setPendingKey(null);
      }
      const key = randomUUID();
      const draft = await api.createReceipt(
        {
          client_id: receiptClientId!,
          warehouse_id: warehouseId!,
          location_id: locationId!,
          supplier_id: supplierId ?? undefined,
          supplier: supplier.trim() || undefined,
          purchase_order: purchaseOrder.trim() || undefined,
          purchase_order_id: purchaseOrderId ?? undefined,
          note: note.trim() || undefined,
          delivery_note: deliveryNote.trim() || undefined,
          lines: preparedLines,
        },
        key,
      );
      setPendingReceipt(draft);
      setPendingKey(key);
      await refresh();
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors);
      } else {
        setError('The draft could not be saved. Please try again.');
      }
    } finally {
      setSavingDraft(false);
    }
  };

  const submitCommit = async () => {
    const preparedLines = validateAndPrepare();
    if (!preparedLines) {
      setShowReviewModal(false);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      // A resumed draft may have been edited. Replace it so the posted receipt
      // always matches what is visible in the form.
      if (pendingReceipt) {
        await api.cancelReceipt(pendingReceipt.id);
        setPendingReceipt(null);
        setPendingKey(null);
      }
      const key = randomUUID();
      const receipt = await api.createReceipt(
        {
          client_id: receiptClientId!,
          warehouse_id: warehouseId!,
          location_id: locationId!,
          supplier_id: supplierId ?? undefined,
          supplier: supplier.trim() || undefined,
          purchase_order: purchaseOrder.trim() || undefined,
          purchase_order_id: purchaseOrderId ?? undefined,
          note: note.trim() || undefined,
          delivery_note: deliveryNote.trim() || undefined,
          lines: preparedLines,
        },
        key,
      );
      setPendingReceipt(receipt);
      setPendingKey(key);
      const committed = await api.commitReceipt(receipt.id);
      setCompletedReceipt(committed);
      setPendingReceipt(null);
      setPendingKey(null);
      setShowReviewModal(false);
      clearReceiveDraft();
      try {
        await refresh();
      } catch {
        // Non-blocking background sync
      }
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors);
      } else {
        setError('The receipt could not be posted. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Review Summary Totals
  const totalUnits = useMemo(() => {
    return lines.reduce((acc, line) => {
      const val = Number(line.qty.replace(',', '.'));
      return acc + (Number.isFinite(val) ? val : 0);
    }, 0);
  }, [lines]);

  if (completedReceipt) {
    const awaitingPutaway =
      completedReceipt.putaway_required && !completedReceipt.putaway_completed_at;
    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Math.max(insets.top + 12, 22),
            paddingBottom: 32,
          },
        ]}
      >
        <View style={styles.successCard}>
          <View style={styles.successIcon}>
            <MaterialCommunityIcons
              name={awaitingPutaway ? 'map-marker-path' : 'check'}
              size={34}
              color={awaitingPutaway ? colors.warning : colors.success}
            />
          </View>
          <Text style={styles.successEyebrow}>
            {awaitingPutaway ? 'AWAITING PUT-AWAY' : 'RECEIPT POSTED'}
          </Text>
          <Text style={styles.successTitle}>{completedReceipt.number}</Text>
          <Text style={styles.successText}>
            {completedReceipt.lines.map((line, lineIndex) => (
              <Text key={line.id || `${line.sku}-${lineIndex}`}>
                {formatQty(line.base_qty)} {line.base_uom} of {line.item_name}
                {awaitingPutaway
                  ? ` is staged in ${completedLocation?.code || 'receiving'} and ready to put away.`
                  : ` is now on hand in ${completedLocation?.code || 'storage'}.`}
                {'\n'}
              </Text>
            ))}
          </Text>
          <View style={styles.successDetails}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Destination location</Text>
              <Text style={styles.detailValue}>
                {completedLocation
                  ? `${completedLocation.code} (${humanize(completedLocation.type || 'storage')})`
                  : 'Location unavailable'}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Inventory owner</Text>
              <Text style={styles.detailValue}>
                {completedClient ? `${completedClient.name} (${completedClient.code})` : 'Internal'}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Lines received</Text>
              <Text style={styles.detailValue}>{completedReceipt.lines.length}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Supplier reference</Text>
              <Text style={styles.detailValue}>
                {completedReceipt.supplier ?? 'Not specified'}
              </Text>
            </View>
            {completedReceipt.purchase_order ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Purchase order</Text>
                <Text style={styles.detailValue}>
                  {completedReceipt.purchase_order}
                  {completedReceipt.purchase_order_id ? ' · received quantities updated' : ''}
                </Text>
              </View>
            ) : null}
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Storage method</Text>
              <Text style={styles.detailValue}>
                {awaitingPutaway ? 'Staging -> Put-away required' : 'Direct storage (On hand)'}
              </Text>
            </View>
          </View>
          {awaitingPutaway ? (
            <Button
              label={`View Put-Away Tasks (${completedReceipt.number})`}
              onPress={() => onOpenPutaway(completedReceipt.id)}
            />
          ) : (
            <View style={styles.directStorageBanner}>
              <MaterialCommunityIcons name="check-circle" size={18} color={colors.success} />
              <Text style={styles.directStorageBannerText}>
                Direct Storage: Stock is immediately available in {completedLocation?.code ?? 'storage'}. No put-away required.
              </Text>
            </View>
          )}
          <Button label="View receipt details" variant="secondary" onPress={() => onOpenReceipt(completedReceipt.id)} />
          {completedReceipt.purchase_order_id ? (
            <Button
              label={`View ${completedReceipt.purchase_order ?? 'purchase order'}`}
              variant="secondary"
              onPress={() => onOpenPurchaseOrder(completedReceipt.purchase_order_id as string)}
            />
          ) : null}
          <Button label="Receive another delivery" variant="ghost" onPress={resetForm} />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: Math.max(insets.top + 12, 22),
          paddingBottom: 16,
        },
      ]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          tintColor="#192338"
          colors={['#192338']}
        />
      }
    >
      {/* Top Header: Pure Logo + Back Button + Title + Actions */}
      <View style={styles.topHeader}>
        <View style={styles.headerLeft}>
          {onBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              onPress={onBack}
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons name="arrow-left" size={22} color="#192338" />
            </Pressable>
          ) : null}
          <Image
            source={require('../../assets/ntan-hexagon-logo.png')}
            style={styles.logoImage}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
          <View style={styles.greetingBox}>
            <Text style={styles.greetingTitle}>Receive Stock</Text>
            <Text style={styles.greetingSubtitle} numberOfLines={1}>
              {activeWarehouses[0]?.name ?? 'Inbound Dock'} · Receiving Dock
            </Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh receive"
          onPress={() => void refresh()}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <MaterialCommunityIcons name="sync" size={19} color="#192338" />
        </Pressable>
      </View>

      {/* Primary Receive Scanner Hero Card */}
      <Reveal>
        <View style={styles.scannerHeroCard}>
          <View pointerEvents="none" style={styles.scannerHeroGlow} />
          <View style={styles.scannerHeroTop}>
            <View style={styles.scannerHeroIconWrap}>
              <MaterialCommunityIcons name="barcode-scan" size={24} color={palette.ink} />
            </View>
            <View style={styles.scannerHeroTextWrap}>
              <Text style={styles.scannerHeroTitle}>Scan deliveries</Text>
              <Text style={styles.scannerHeroDesc}>
                Continuous scan, live matching and serial checks.
              </Text>
            </View>
          </View>

          <View style={styles.scannerHeroStats}>
            <View style={styles.scannerHeroStat}>
              <Text style={styles.scannerHeroStatValue}>
                {receiveScanSummary(lines).lineCount}
              </Text>
              <Text style={styles.scannerHeroStatLabel}>Lines</Text>
            </View>
            <View style={styles.scannerHeroStatDivider} />
            <View style={styles.scannerHeroStat}>
              <Text style={styles.scannerHeroStatValue}>
                {receiveScanSummary(lines).unitCount}
              </Text>
              <Text style={styles.scannerHeroStatLabel}>Units</Text>
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Launch Full Screen Receive Scanner"
            onPress={() => openItemScanner()}
            style={({ pressed }) => [styles.scannerHeroLaunchBtn, pressed && styles.pressed]}
          >
            <MaterialCommunityIcons name="camera" size={20} color={palette.ink} />
            <Text style={styles.scannerHeroLaunchBtnText}>Open scanner</Text>
          </Pressable>
        </View>
      </Reveal>

      {/* Persisted Draft Recovery Banner */}
      {persistedDraftOffer ? (
        <View style={styles.draftRecoveryBanner}>
          <View style={styles.draftRecoveryHeader}>
            <MaterialCommunityIcons name="restore" size={20} color={colors.primary} />
            <View style={styles.draftRecoveryTextWrap}>
              <Text style={styles.draftRecoveryTitle}>Uncommitted Draft Found</Text>
              <Text style={styles.draftRecoverySubtitle}>
                Saved {formatDateTime(persistedDraftOffer.savedAt)} with {persistedDraftOffer.lineCount} item line{persistedDraftOffer.lineCount === 1 ? '' : 's'}.
              </Text>
            </View>
          </View>
          <View style={styles.draftRecoveryActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Restore saved draft"
              onPress={() => {
                const d = persistedDraftOffer.draft;
                if (d.lines?.length) {
                  setLines(d.lines.map((l: any) => ({ ...l, itemId: l.itemId || null })));
                }
                if (d.clientId !== undefined) setClientId(d.clientId);
                if (d.warehouseId !== undefined) setWarehouseId(d.warehouseId);
                if (d.locationId !== undefined) setLocationId(d.locationId);
                if (d.supplier !== undefined) setSupplier(d.supplier);
                if (d.supplierId !== undefined) setSupplierId(d.supplierId);
                if (d.purchaseOrder !== undefined) setPurchaseOrder(d.purchaseOrder);
                if (d.purchaseOrderId !== undefined) setPurchaseOrderId(d.purchaseOrderId);
                if (d.purchaseOrderNumber !== undefined) setPurchaseOrderNumber(d.purchaseOrderNumber);
                if (d.purchaseOrderLines !== undefined) setPurchaseOrderLines(d.purchaseOrderLines);
                if (d.note !== undefined) setNote(d.note);
                if (d.deliveryNote !== undefined) setDeliveryNote(d.deliveryNote);
                setPersistedDraftOffer(null);
              }}
              style={({ pressed }) => [styles.draftRecoveryBtn, styles.draftRecoveryBtnPrimary, pressed && styles.pressed]}
            >
              <Text style={styles.draftRecoveryBtnTextPrimary}>Restore Draft</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Discard saved draft"
              onPress={() => {
                void clearPersistedReceiveDraft(receiveDraftStorage, persistedDraftOffer.scope);
                setPersistedDraftOffer(null);
              }}
              style={({ pressed }) => [styles.draftRecoveryBtn, styles.draftRecoveryBtnGhost, pressed && styles.pressed]}
            >
              <Text style={styles.draftRecoveryBtnTextGhost}>Discard</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.quickActionsCard}>
        <Text style={styles.quickActionsTitle}>Workspace</Text>
        <Text style={styles.quickActionsHint}>Start a delivery, replenish or review receipts.</Text>
        <View style={styles.quickGrid}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New receipt"
            onPress={scrollToNewReceipt}
            style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}
          >
            <View style={styles.quickIcon}>
              <MaterialCommunityIcons name="file-plus-outline" size={20} color={colors.deep} />
            </View>
            <Text style={styles.quickLabel}>New receipt</Text>
            <Text style={styles.quickDetail}>Blank form</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Receive purchase orders"
            onPress={explainPurchaseOrders}
            style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}
          >
            <View style={styles.quickIcon}>
              <MaterialCommunityIcons
                name="clipboard-text-clock-outline"
                size={20}
                color={colors.deep}
              />
            </View>
            <Text style={styles.quickLabel}>Purchase orders</Text>
            <Text style={styles.quickDetail}>Open orders</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reorder needed"
            onPress={onOpenReorder}
            style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}
          >
            <View style={[styles.quickIcon, styles.quickIconWarning]}>
              <MaterialCommunityIcons
                name="alert-decagram-outline"
                size={20}
                color={colors.warning}
              />
            </View>
            <Text style={styles.quickLabel}>Replenish</Text>
            <Text style={styles.quickDetail}>Low-stock items</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Recent receipts"
            onPress={scrollToRecentReceipts}
            style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}
          >
            <View style={[styles.quickIcon, styles.quickIconSuccess]}>
              <MaterialCommunityIcons name="history" size={20} color={colors.success} />
            </View>
            <Text style={styles.quickLabel}>Recent</Text>
            <Text style={styles.quickDetail}>Posted receipts</Text>
          </Pressable>
        </View>
      </View>

      {/* Draft Receipts Queue */}
      {draftReceipts.length > 0 ? (
        <View style={styles.draftsCard}>
          <View style={styles.draftsHeader}>
            <View style={styles.draftsHeading}>
              <MaterialCommunityIcons
                name="file-document-multiple-outline"
                size={21}
                color={colors.deep}
              />
              <View style={styles.draftsHeadingText}>
                <Text style={styles.draftsTitle}>Draft queue</Text>
                <Text style={styles.draftsSubtitle}>Saved on server, awaiting posting.</Text>
              </View>
            </View>
            <View style={styles.draftsCount}>
              <Text style={styles.draftsCountText}>{draftReceipts.length}</Text>
            </View>
          </View>
          {draftReceipts.map((receipt) => (
            <View key={receipt.id} style={styles.draftRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Resume draft receipt ${receipt.number}`}
                onPress={() => resumeDraft(receipt)}
                style={({ pressed }) => [styles.draftBody, pressed && styles.pressed]}
              >
                <View style={styles.draftRowTitleWrap}>
                  <Text style={styles.draftNumber}>{receipt.number}</Text>
                  {pendingReceipt?.id === receipt.id ? (
                    <Badge label="Active in form" tone="info" />
                  ) : null}
                </View>
                <Text style={styles.draftMeta}>
                  {receipt.lines.length} line{receipt.lines.length === 1 ? '' : 's'} ·{' '}
                  {receipt.supplier ?? 'No supplier'} · {formatDateTime(receipt.created_at)}
                </Text>
              </Pressable>
              <View style={styles.draftActionRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Post draft ${receipt.number}`}
                  disabled={postingDraftId !== null}
                  onPress={() => void postDraft(receipt)}
                  style={({ pressed }) => [
                    styles.draftButton,
                    styles.draftPostButton,
                    pressed && styles.draftButtonPressed,
                    postingDraftId !== null && styles.draftButtonDisabled,
                  ]}
                >
                  {postingDraftId === receipt.id ? (
                    <ActivityIndicator size="small" color={colors.white} />
                  ) : (
                    <Text style={styles.draftPostButtonText}>Post</Text>
                  )}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Discard draft ${receipt.number}`}
                  disabled={cancellingDraftId === receipt.id}
                  onPress={() => void cancelDraft(receipt.id)}
                  style={({ pressed }) => [
                    styles.draftDiscardButton,
                    pressed && styles.pressed,
                  ]}
                >
                  {cancellingDraftId === receipt.id ? (
                    <ActivityIndicator size="small" color={colors.danger} />
                  ) : (
                    <MaterialCommunityIcons name="close" size={16} color={colors.danger} />
                  )}
                </Pressable>
              </View>
            </View>
          ))}
          {draftError ? <Text style={styles.draftError}>{draftError}</Text> : null}
        </View>
      ) : null}

      {activeItems.length === 0 ? (
        <EmptyState
          icon="tag-plus-outline"
          title="Add catalogue items first"
          message="Items define the SKU, name, base unit and tracking rules used by receiving."
          actionLabel="Go to item catalogue"
          onAction={onGoToItems}
        />
      ) : null}

      <View
        style={styles.card}
        onLayout={(event) => {
          formTop.current = event.nativeEvent.layout.y;
        }}
      >
        <View style={styles.cardHeadingRow}>
          <View>
            <Text style={styles.cardTitle}>Delivery header</Text>
            <Text style={styles.cardHint}>Destination, owner and supplier.</Text>
          </View>
          <View style={styles.lineCount}>
            <Text style={styles.lineCountText}>{lines.length}</Text>
          </View>
        </View>

        {isMultiOwner ? (
          <>
            <SelectField
              label="Inventory owner"
              value={receiptClientId}
              onChange={chooseClient}
              options={inventoryOwners.map((owner) => ({
                value: owner.id,
                label: owner.name,
                detail: owner.is_internal ? 'Internal company stock' : owner.code,
              }))}
              placeholder="Select inventory owner"
              error={fieldErrors.client_id}
            />
            {selectedClient ? (
              <Text style={styles.locationHint}>
                Stock will be owned by {selectedClient.name} ({selectedClient.code}).
              </Text>
            ) : null}
          </>
        ) : null}

        {activeWarehouses.length === 0 ? (
          <View style={styles.missingFacilityBox}>
            <MaterialCommunityIcons name="warehouse" size={32} color={colors.warning} />
            <Text style={styles.missingFacilityTitle}>No active warehouses</Text>
            <Text style={styles.missingFacilityText}>
              Set up your authorized warehouse facilities and storage bins before receiving stock.
            </Text>
            {onGoToLocations ? (
              <Button
                label="Configure Warehouses & Bins"
                onPress={onGoToLocations}
              />
            ) : null}
          </View>
        ) : (
          <>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.fieldSectionLabel}>DESTINATION FACILITY</Text>
              {onGoToLocations ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Manage warehouses and bins"
                  onPress={onGoToLocations}
                  style={({ pressed }) => [styles.quickLinkButton, pressed && styles.pressed]}
                >
                  <MaterialCommunityIcons name="map-marker-outline" size={13} color={colors.navy} />
                  <Text style={styles.quickLinkButtonText}>Facilities & Bins</Text>
                </Pressable>
              ) : null}
            </View>
            <SelectField
              label="Destination warehouse"
              value={warehouseId}
              onChange={chooseWarehouse}
              options={activeWarehouses.map((warehouse) => ({
                value: warehouse.id,
                label: warehouse.name,
                detail: warehouse.address ?? undefined,
              }))}
              placeholder="Select a warehouse"
              error={fieldErrors.warehouse_id}
            />
            <SelectField
              label="Receiving / Storage location"
              value={locationId}
              onChange={setLocationId}
              options={warehouseLocations.map((location) => {
                const isStaging = location.type === 'receiving' || location.type === 'staging';
                return {
                  value: location.id,
                  label: `${location.code} · ${humanize(location.type)}`,
                  detail: isStaging ? 'Staging (Triggers Put-Away)' : 'Direct Storage (On-Hand)',
                };
              })}
              placeholder="Select destination location"
              disabled={!warehouseId}
              emptyLabel="This warehouse has no active locations"
              error={fieldErrors.location_id}
            />
            {selectedLocation ? (
              <View style={[styles.locationNoticeBox, isStagingLocation ? styles.noticeStaging : styles.noticeDirect]}>
                <MaterialCommunityIcons
                  name={isStagingLocation ? 'map-marker-path' : 'archive-arrow-down-outline'}
                  size={16}
                  color={isStagingLocation ? colors.warning : colors.success}
                />
                <Text style={styles.locationNoticeText}>
                  {isStagingLocation
                    ? `Staging area: Stock received in ${selectedLocation.code} triggers automated put-away tasks.`
                    : `Direct storage: Stock placed directly on hand in ${selectedLocation.code} without put-away.`}
                </Text>
              </View>
            ) : null}
          </>
        )}

        {purchaseOrderId ? (
          <View style={styles.poBanner}>
            <View style={styles.poBannerTop}>
              <View style={styles.poBannerIcon}>
                <MaterialCommunityIcons
                  name="clipboard-text-outline"
                  size={18}
                  color={colors.primary}
                />
              </View>
              <View style={styles.poBannerText}>
                <Text style={styles.poBannerEyebrow}>
                  RECEIVING AGAINST PURCHASE ORDER
                </Text>
                <Text style={styles.poBannerTitle}>
                  {purchaseOrderNumber || purchaseOrder}
                </Text>
                <Text style={styles.poBannerMeta}>
                  {purchaseOrderLines.length > 0
                    ? `${purchaseOrderLines.length} ordered line${
                        purchaseOrderLines.length === 1 ? '' : 's'
                      } · quantities cannot exceed the remaining order`
                    : 'Resumed draft · ordered quantities are verified when you post'}
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="View purchase order"
              onPress={() => onOpenPurchaseOrder(purchaseOrderId)}
              style={({ pressed }) => [styles.poBannerLinkButton, pressed && styles.pressed]}
            >
              <Text style={styles.poBannerLink}>View order</Text>
              <MaterialCommunityIcons name="chevron-right" size={16} color={colors.primary} />
            </Pressable>
          </View>
        ) : null}

        <View style={styles.linesHeader}>
          <Text style={styles.linesTitle}>RECEIPT LINES</Text>
          <View style={styles.linesActionButtons}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Scan catalogue item to add line"
              onPress={() => openItemScanner()}
              style={({ pressed }) => [styles.scanButton, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons name="barcode-scan" size={15} color={colors.primary} />
              <Text style={styles.scanButtonText}>Scan</Text>
            </Pressable>
            {canWriteInventory ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Create item"
                onPress={() => openQuickItemModal()}
                style={({ pressed }) => [styles.scanButton, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons name="plus" size={15} color={colors.primary} />
                <Text style={styles.scanButtonText}>New Item</Text>
              </Pressable>
            ) : null}
            {onGoToItems ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open catalogue"
                onPress={onGoToItems}
                style={({ pressed }) => [styles.quickLinkButton, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons name="format-list-bulleted" size={14} color={colors.navy} />
                <Text style={styles.quickLinkButtonText}>Catalogue</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={purchaseOrderId ? 'Add ordered item' : 'Add receipt line'}
              onPress={addLine}
              style={({ pressed }) => [styles.addLine, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons name="plus" size={15} color={colors.primary} />
              <Text style={styles.addLineText}>
                {purchaseOrderId ? 'Add ordered item' : 'Add line'}
              </Text>
            </Pressable>
          </View>
        </View>

        {lines.map((line, index) => {
          const selectedItem = activeItems.find((item) => item.id === line.itemId);
          const selectedMapping = line.itemId
            ? supplierItemMap.get(line.itemId)
            : undefined;
          const selectedSupplier = availableSuppliers.find(
            (entry) => entry.id === supplierId,
          );
          return (
            <View key={line.key} style={styles.lineCard}>
              <View style={styles.lineHeading}>
                <View style={styles.lineHeadingTitleWrap}>
                  <Text style={styles.lineNumber}>LINE {index + 1}</Text>
                  {selectedItem ? (
                    <Badge
                      label={selectedItem.tracking_mode === 'serial' ? 'Serial-tracked' : selectedItem.tracking_mode === 'lot' ? 'Lot-tracked' : 'Standard'}
                      tone={selectedItem.tracking_mode === 'none' ? 'neutral' : 'info'}
                    />
                  ) : null}
                </View>
                <View style={styles.lineHeadingButtons}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Scan barcode for line ${index + 1}`}
                    onPress={() => openItemScanner(line.key)}
                    style={({ pressed }) => [styles.lineScanButton, pressed && styles.pressed]}
                  >
                    <MaterialCommunityIcons name="barcode-scan" size={16} color={colors.primary} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove line ${index + 1}`}
                    disabled={lines.length === 1}
                    onPress={() => removeLine(line.key)}
                    style={({ pressed }) => [
                      styles.removeLine,
                      lines.length === 1 && styles.removeLineDisabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    <MaterialCommunityIcons
                      name="trash-can-outline"
                      size={16}
                      color={colors.danger}
                    />
                  </Pressable>
                </View>
              </View>

              <SelectField
                label="Item"
                value={line.itemId}
                onChange={(value) => {
                  const poLine = purchaseOrderLines.find(
                    (orderLine) => orderLine.itemId === value,
                  );
                  updateLine(line.key, {
                    itemId: value,
                    lotNo: '',
                    expiryDate: '',
                    serials: '',
                    orderedQty: poLine?.orderedQty,
                    remainingQty: poLine?.remainingQty,
                  });
                  suggestSupplierForItem(
                    activeItems.find((item) => item.id === value),
                  );
                }}
                options={prioritisedLineItemOptions.map((item) => {
                  const mapping = supplierItemMap.get(item.id);
                  const price =
                    canReadCost && mapping?.purchase_price
                      ? ` · Price: ${mapping.currency ?? ''} ${mapping.purchase_price}`
                      : '';
                  return {
                    value: item.id,
                    label: `${item.name}${mapping ? ' · Mapped' : ''}`,
                    detail: `${item.sku} · Unit: ${item.base_uom}${
                      item.barcode ? ` · Barcode: ${item.barcode}` : ''
                    }${
                      mapping?.supplier_sku
                        ? ` · Supplier SKU: ${mapping.supplier_sku}`
                        : ''
                    }${price}`,
                  };
                })}
                placeholder="Select catalogue item"
                searchable
                searchPlaceholder="Search SKU, name, barcode or supplier SKU"
                error={fieldErrors[`lines.${index}.item_id`]}
                emptyLabel={
                  purchaseOrderId
                    ? 'No ordered items available for this owner'
                    : 'No active items available'
                }
              />

              {supplierId && selectedItem ? (
                selectedMapping ? (
                  <View style={[styles.mappingNotice, styles.mappingNoticeMapped]}>
                    <MaterialCommunityIcons
                      name="link-variant"
                      size={15}
                      color={colors.success}
                    />
                    <Text style={styles.mappingNoticeText}>
                      Mapped to {selectedSupplier?.display_name || selectedSupplier?.name}
                      {selectedMapping.supplier_sku
                        ? ` · Supplier SKU ${selectedMapping.supplier_sku}`
                        : ''}
                      {selectedMapping.lead_time_days != null
                        ? ` · ${selectedMapping.lead_time_days}d lead`
                        : ''}
                      {canReadCost && selectedMapping.purchase_price
                        ? ` · ${selectedMapping.currency ?? ''} ${selectedMapping.purchase_price}`
                        : ''}
                    </Text>
                  </View>
                ) : (
                  <View style={[styles.mappingNotice, styles.mappingNoticeUnmapped]}>
                    <MaterialCommunityIcons
                      name="link-variant-off"
                      size={15}
                      color={colors.warning}
                    />
                    <Text style={styles.mappingNoticeText}>
                      Not mapped to{' '}
                      {selectedSupplier?.display_name || selectedSupplier?.name}. This is
                      a valid one-off receipt; link the supplier from the item catalogue
                      to keep SKUs and prices aligned.
                    </Text>
                  </View>
                )
              ) : null}

              {selectedItem?.preferred_supplier_name ? (
                <Text style={styles.poLineHint}>
                  Preferred supplier: {selectedItem.preferred_supplier_name}
                  {supplierId === selectedItem.preferred_supplier_id
                    ? ''
                    : ' (mapped suggestion; another supplier can still be used)'}
                </Text>
              ) : null}

              <Field
                label={`Quantity${selectedItem ? ` (${selectedItem.base_uom})` : ''}`}
                value={line.qty}
                onChangeText={(value) => updateLine(line.key, { qty: value })}
                placeholder="0"
                keyboardType="decimal-pad"
                error={fieldErrors[`lines.${index}.qty`]}
              />

              {purchaseOrderId ? (
                line.remainingQty ? (
                  <Text style={styles.poLineHint}>
                    Ordered {formatQty(line.orderedQty ?? line.remainingQty)} ·{' '}
                    {formatQty(line.remainingQty)} remaining on {purchaseOrderNumber}
                  </Text>
                ) : (
                  <Text style={styles.poLineHint}>
                    Confirm this item belongs to {purchaseOrderNumber}; the server will reject
                    items that were not ordered.
                  </Text>
                )
              ) : null}

              {selectedItem?.tracking_mode === 'lot' ? (
                <Field
                  label="Lot / Batch number"
                  value={line.lotNo}
                  onChangeText={(value) => updateLine(line.key, { lotNo: value })}
                  placeholder="LOT-2027-A"
                  autoCapitalize="characters"
                  error={fieldErrors[`lines.${index}.lot_no`]}
                />
              ) : null}

              {selectedItem?.tracking_mode === 'serial' ? (
                <View style={styles.serialInputBlock}>
                  <View style={styles.serialHeaderRow}>
                    <Text style={styles.serialLabel}>Serial numbers (1 per unit)</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Scan serial barcode"
                      onPress={() => openSerialScanner(line.key)}
                      style={({ pressed }) => [styles.scanSerialButton, pressed && styles.pressed]}
                    >
                      <MaterialCommunityIcons name="barcode-scan" size={14} color={colors.primary} />
                      <Text style={styles.scanSerialButtonText}>Scan serials</Text>
                    </Pressable>
                  </View>
                  <Field
                    label="Serial numbers"
                    value={line.serials}
                    onChangeText={(value) => updateLine(line.key, { serials: value })}
                    placeholder={'SN-1001\nSN-1002'}
                    multiline
                    autoCapitalize="characters"
                    error={fieldErrors[`lines.${index}.serial_numbers`]}
                  />
                  <Text style={styles.trackingHint}>
                    {parseSerialNumbers(line.serials).length} serial
                    {parseSerialNumbers(line.serials).length === 1 ? '' : 's'} recorded for{' '}
                    {line.qty.trim() || '0'} units
                  </Text>
                </View>
              ) : null}

              {selectedItem?.expiry_tracked ? (
                <Field
                  label="Expiry date"
                  value={line.expiryDate}
                  onChangeText={(value) => updateLine(line.key, { expiryDate: value })}
                  placeholder="YYYY-MM-DD"
                  keyboardType="numbers-and-punctuation"
                  error={fieldErrors[`lines.${index}.expiry_date`]}
                />
              ) : null}

              <Field
                label="Inspection / Discrepancy note (optional)"
                value={line.discrepancyReason}
                onChangeText={(value) => updateLine(line.key, { discrepancyReason: value })}
                placeholder="e.g. Minor carton scuff, short-shipped, QC approved"
                autoCapitalize="sentences"
              />
            </View>
          );
        })}

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.fieldSectionLabel}>SUPPLIER / VENDOR</Text>
          <View style={styles.sectionHeaderActions}>
            {canManagePartners ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Create supplier"
                onPress={() => {
                  setQuickSupplierName('');
                  setQuickSupplierCode('');
                  setQuickSupplierPhone('');
                  setQuickSupplierError(null);
                  setQuickSupplierModal(true);
                }}
                style={({ pressed }) => [styles.quickCreateButton, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons name="plus" size={13} color={colors.primary} />
                <Text style={styles.quickCreateButtonText}>New Supplier</Text>
              </Pressable>
            ) : null}
            {onGoToPartners ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Manage partners in More"
                onPress={onGoToPartners}
                style={({ pressed }) => [styles.quickLinkButton, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons name="account-group-outline" size={13} color={colors.navy} />
                <Text style={styles.quickLinkButtonText}>Partners</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {purchaseOrderId ? (
          <>
            <Field
              label="Supplier (from purchase order)"
              value={supplier}
              onChangeText={() => undefined}
              placeholder="Supplier or vendor name"
              error={fieldErrors.supplier}
              disabled
            />
            <Text style={styles.poLineHint}>
              The supplier and order reference come from {purchaseOrderNumber || purchaseOrder}.
              Discard this draft to receive without an order.
            </Text>
          </>
        ) : availableSuppliers.length > 0 ? (
          <>
            <SelectField
              label="Supplier / vendor (optional)"
              value={supplierId ?? '__none__'}
              onChange={(value) => {
                const nextId = value === '__none__' ? null : value;
                const supplierRecord = availableSuppliers.find(
                  (entry) => entry.id === nextId,
                );
                setSupplierId(nextId);
                setSupplier(
                  supplierRecord
                    ? supplierRecord.display_name || supplierRecord.name
                    : '',
                );
              }}
              options={[
                { value: '__none__', label: 'No supplier selected', detail: 'One-off receipt without a supplier partner' },
                ...availableSuppliers.map((sup) => ({
                  value: sup.id,
                  label: sup.display_name || sup.name,
                  detail: [sup.code, sup.contact_name, sup.contact_phone]
                    .filter(Boolean)
                    .join(' · '),
                })),
              ]}
              placeholder="Select an active supplier"
              searchable
              searchPlaceholder="Search supplier name, code or contact"
              error={fieldErrors.supplier}
            />
            {supplierMappingsLoading ? (
              <Text style={styles.poLineHint}>Loading supplier item mappings…</Text>
            ) : supplierId ? (
              <Text style={styles.poLineHint}>
                {supplierItemMap.size} mapped item
                {supplierItemMap.size === 1 ? '' : 's'} prioritised. Unmapped items can
                still be received with a warning.
              </Text>
            ) : null}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.partnerChipRow}>
              {availableSuppliers.map((sup) => (
                <Pressable
                  key={sup.id}
                  style={[styles.partnerChip, supplierId === sup.id && styles.partnerChipActive]}
                  onPress={() => {
                    setSupplier(sup.display_name || sup.name);
                    setSupplierId(sup.id);
                  }}
                >
                  <Text style={[styles.partnerChipText, supplierId === sup.id && styles.partnerChipTextActive]}>
                    {sup.display_name || sup.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        ) : (
          <View style={styles.noSuppliersBox}>
            <Text style={styles.noSuppliersText}>No active suppliers registered yet.</Text>
            {canManagePartners ? (
              <Button
                label="+ Create Supplier"
                variant="secondary"
                onPress={() => {
                  setQuickSupplierName('');
                  setQuickSupplierCode('');
                  setQuickSupplierPhone('');
                  setQuickSupplierError(null);
                  setQuickSupplierModal(true);
                }}
              />
            ) : null}
          </View>
        )}

        <Field
          label="Purchase order reference (optional)"
          value={purchaseOrder}
          onChangeText={setPurchaseOrder}
          placeholder="PO reference number"
          autoCapitalize="characters"
          error={fieldErrors.purchase_order}
          disabled={Boolean(purchaseOrderId)}
        />
        <Field
          label="Delivery note reference (optional)"
          value={deliveryNote}
          onChangeText={setDeliveryNote}
          placeholder="Supplier delivery note, docket or carrier reference"
          autoCapitalize="characters"
        />
        <Field
          label="Receipt remarks (optional)"
          value={note}
          onChangeText={setNote}
          placeholder="Driver notes, receiving remarks or internal comments"
          multiline
          autoCapitalize="sentences"
        />

        {pendingReceipt && !completedReceipt ? (
          <View style={styles.pendingBox}>
            <MaterialCommunityIcons
              name="file-document-outline"
              size={20}
              color={colors.warning}
            />
            <View style={styles.pendingTextWrap}>
              <Text style={styles.pendingTitle}>Draft {pendingReceipt.number} active</Text>
              <Text style={styles.pendingText}>
                Draft is saved on the server. You can review and post it now.
              </Text>
            </View>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorBox}>
            <MaterialCommunityIcons
              name="alert-circle-outline"
              size={19}
              color={colors.danger}
            />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.formButtonStack}>
          <Button
            label={pendingReceipt ? 'Review & Post active draft' : 'Review & Post delivery'}
            onPress={handleOpenReview}
            disabled={activeItems.length === 0 || activeWarehouses.length === 0}
          />
          <View style={styles.secondaryButtonRow}>
            <Button
              label={savingDraft ? 'Saving draft...' : 'Save as draft'}
              variant="secondary"
              onPress={() => void handleSaveDraft()}
              loading={savingDraft}
              disabled={submitting}
            />
            {pendingReceipt ? (
              <Button
                label="Discard form"
                variant="ghost"
                onPress={resetForm}
              />
            ) : null}
          </View>
        </View>
      </View>

      {/* Receipt history with supplier, owner, status and date filters */}
      <View
        style={styles.recentCard}
        onLayout={(event) => {
          recentTop.current = event.nativeEvent.layout.y;
        }}
      >
        <View style={styles.recentHeaderRow}>
          <Text style={styles.recentTitle}>Receipt history</Text>
          <View style={styles.recentHeaderActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Toggle receipt filters"
              onPress={() => setReceiptFiltersOpen((current) => !current)}
              style={({ pressed }) => [styles.historyAction, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons name="filter-variant" size={15} color={colors.navy} />
              <Text style={styles.historyActionText}>
                {receiptFiltersOpen ? 'Hide' : 'Filters'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Export receipt history CSV"
              disabled={receiptExporting || receiptHistory.length === 0}
              onPress={() => void exportReceiptHistory()}
              style={({ pressed }) => [
                styles.historyAction,
                pressed && styles.pressed,
                (receiptExporting || receiptHistory.length === 0) && styles.historyActionDisabled,
              ]}
            >
              <MaterialCommunityIcons
                name={receiptExporting ? 'progress-download' : 'download-outline'}
                size={15}
                color={colors.navy}
              />
              <Text style={styles.historyActionText}>
                {receiptExporting ? 'Exporting…' : 'Export CSV'}
              </Text>
            </Pressable>
          </View>
        </View>

        <Field
          label="Search receipts"
          value={receiptSearch}
          onChangeText={setReceiptSearch}
          placeholder="Receipt no, supplier, item, supplier SKU or delivery note"
          autoCapitalize="none"
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.statusChipRow}>
            {(['all', 'applied', 'draft', 'cancelled'] as ReceiptStatusFilter[]).map(
              (status) => (
                <Pressable
                  key={status}
                  accessibilityRole="button"
                  accessibilityState={{ selected: receiptStatusFilter === status }}
                  onPress={() => setReceiptStatusFilter(status)}
                  style={[
                    styles.statusChip,
                    receiptStatusFilter === status && styles.statusChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusChipText,
                      receiptStatusFilter === status && styles.statusChipTextActive,
                    ]}
                  >
                    {receiptStatusLabels[status]}
                  </Text>
                </Pressable>
              ),
            )}
          </View>
        </ScrollView>

        {receiptFiltersOpen ? (
          <View style={styles.historyFilters}>
            <SelectField
              label="Supplier"
              value={receiptSupplierFilter}
              onChange={setReceiptSupplierFilter}
              options={receiptSupplierFilterOptions.map((supplierRecord) => ({
                value: supplierRecord.id,
                label: supplierRecord.display_name || supplierRecord.name,
                detail: `${supplierRecord.code}${
                  supplierRecord.status !== 'active' ? ' · Archived' : ''
                }`,
              }))}
              placeholder="All suppliers"
              searchable
              searchPlaceholder="Search supplier name or code"
              emptyLabel="No supplier partners"
            />
            <SelectField
              label="Item"
              value={receiptItemFilter}
              onChange={setReceiptItemFilter}
              options={items.map((item) => ({
                value: item.id,
                label: item.name,
                detail: `${item.sku} · ${item.base_uom}`,
              }))}
              placeholder="All items"
              searchable
              searchPlaceholder="Search SKU, name or barcode"
            />
            <SelectField
              label="Warehouse"
              value={receiptWarehouseFilter}
              onChange={setReceiptWarehouseFilter}
              options={warehouses.map((warehouse) => ({
                value: warehouse.id,
                label: warehouse.name,
                detail: warehouse.code ?? undefined,
              }))}
              placeholder="All warehouses"
            />
            {isMultiOwner ? (
              <SelectField
                label="Inventory owner"
                value={receiptOwnerFilter}
                onChange={setReceiptOwnerFilter}
                options={inventoryOwners.map((owner) => ({
                  value: owner.id,
                  label: owner.name,
                  detail: owner.is_internal ? 'Internal company stock' : owner.code,
                }))}
                placeholder="All owners"
              />
            ) : null}
            <View style={styles.historyDateRow}>
              <View style={styles.historyDateField}>
                <Field
                  label="From date"
                  value={receiptDateFrom}
                  onChangeText={setReceiptDateFrom}
                  placeholder="YYYY-MM-DD"
                  keyboardType="numbers-and-punctuation"
                  autoCapitalize="none"
                />
              </View>
              <View style={styles.historyDateField}>
                <Field
                  label="To date"
                  value={receiptDateTo}
                  onChangeText={setReceiptDateTo}
                  placeholder="YYYY-MM-DD"
                  keyboardType="numbers-and-punctuation"
                  autoCapitalize="none"
                />
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear receipt filters"
              onPress={clearReceiptFilters}
              style={({ pressed }) => [styles.clearFilters, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons name="filter-remove-outline" size={15} color={colors.navy} />
              <Text style={styles.clearFiltersText}>Clear filters</Text>
            </Pressable>
          </View>
        ) : null}

        {receiptHistoryLoading ? (
          <View style={styles.historyStatusRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.historyStatusText}>Loading receipt history…</Text>
          </View>
        ) : receiptHistoryError ? (
          <Text style={styles.historyError}>{receiptHistoryError}</Text>
        ) : receiptHistory.length === 0 ? (
          <Text style={styles.historyEmpty}>
            No receipts match these filters. Posted deliveries appear here after commit.
          </Text>
        ) : (
          receiptHistory.map((receipt) => {
            const deliveredQty = receipt.lines.reduce(
              (sum, line) => sum + Number(line.base_qty || 0),
              0,
            );
            const pendingPutaway =
              receipt.putaway_required && !receipt.putaway_completed_at;
            const statusLabel =
              receipt.status === 'applied'
                ? pendingPutaway
                  ? 'Put-away'
                  : 'Received'
                : receipt.status === 'draft'
                  ? 'Draft'
                  : 'Cancelled';
            const statusTone =
              receipt.status === 'applied'
                ? pendingPutaway
                  ? 'warning'
                  : 'success'
                : receipt.status === 'draft'
                  ? 'info'
                  : 'neutral';
            return (
              <Pressable
                key={receipt.id}
                accessibilityRole="button"
                onPress={() => onOpenReceipt(receipt.id)}
                style={({ pressed }) => [styles.recentRow, pressed && styles.pressed]}
              >
                <View style={styles.recentBody}>
                  <Text style={styles.recentNumber}>
                    {receipt.number}
                    {receipt.purchase_order ? ` · ${receipt.purchase_order}` : ''}
                  </Text>
                  <Text style={styles.recentMeta}>
                    {receipt.supplier ?? 'No supplier'} · {receipt.lines.length} line
                    {receipt.lines.length === 1 ? '' : 's'} ·{' '}
                    {formatQty(String(deliveredQty))}{' '}
                    {receipt.lines[0]?.base_uom ?? ''} · {formatDateTime(receipt.created_at)}
                  </Text>
                  {receipt.delivery_note ? (
                    <Text style={styles.recentMeta}>
                      Delivery note: {receipt.delivery_note}
                    </Text>
                  ) : null}
                </View>
                <Badge label={statusLabel} tone={statusTone} />
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={18}
                  color={colors.muted}
                />
              </Pressable>
            );
          })
        )}
      </View>

      <View style={styles.noteCard}>
        <MaterialCommunityIcons name="shield-check-outline" size={21} color={colors.deep} />
        <Text style={styles.noteText}>
          Receiving commits are atomic and idempotent. Retrying will not double-post inventory movements.
        </Text>
      </View>

      {/* Pre-Commit Review Modal */}
      <Modal
        visible={showReviewModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowReviewModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalEyebrow}>CONFIRMATION</Text>
                <Text style={styles.modalTitle}>Review Delivery Receipt</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close review modal"
                onPress={() => setShowReviewModal(false)}
                style={styles.modalCloseButton}
              >
                <MaterialCommunityIcons name="close" size={20} color={colors.text} />
              </Pressable>
            </View>

            <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent}>
              <View style={styles.reviewMetaCard}>
                <View style={styles.reviewMetaRow}>
                  <Text style={styles.reviewMetaLabel}>Destination</Text>
                  <Text style={styles.reviewMetaValue}>
                    {selectedLocation ? `${selectedLocation.code} (${humanize(selectedLocation.type)})` : 'Not selected'}
                  </Text>
                </View>
                <View style={styles.reviewMetaRow}>
                  <Text style={styles.reviewMetaLabel}>Storage method</Text>
                  <Text style={[styles.reviewMetaValue, isStagingLocation ? styles.textWarning : styles.textSuccess]}>
                    {isStagingLocation ? 'Staging (Put-away required)' : 'Direct Storage (Immediate on-hand)'}
                  </Text>
                </View>
                <View style={styles.reviewMetaRow}>
                  <Text style={styles.reviewMetaLabel}>Inventory owner</Text>
                  <Text style={styles.reviewMetaValue}>
                    {selectedClient ? `${selectedClient.name}` : 'Internal company stock'}
                  </Text>
                </View>
                {supplier.trim() ? (
                  <View style={styles.reviewMetaRow}>
                    <Text style={styles.reviewMetaLabel}>Supplier</Text>
                    <Text style={styles.reviewMetaValue}>{supplier.trim()}</Text>
                  </View>
                ) : null}
                {purchaseOrder.trim() ? (
                  <View style={styles.reviewMetaRow}>
                    <Text style={styles.reviewMetaLabel}>Purchase order</Text>
                    <Text style={styles.reviewMetaValue}>
                      {purchaseOrder.trim()}
                      {purchaseOrderId ? ' · ordered quantities advance on post' : ''}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.reviewMetaRow}>
                  <Text style={styles.reviewMetaLabel}>Total summary</Text>
                  <Text style={styles.reviewMetaValueBold}>
                    {lines.length} line{lines.length === 1 ? '' : 's'} · {totalUnits} total units
                  </Text>
                </View>
              </View>

              <Text style={styles.reviewLinesTitle}>Receipt Lines Breakdown</Text>
              {lines.map((line, idx) => {
                const item = activeItems.find((it) => it.id === line.itemId);
                const serials = parseSerialNumbers(line.serials);
                return (
                  <View key={line.key} style={styles.reviewLineItem}>
                    <View style={styles.reviewLineTop}>
                      <Text style={styles.reviewLineName}>{item?.name ?? 'Unknown item'}</Text>
                      <Text style={styles.reviewLineQty}>
                        {line.qty || '0'} {item?.base_uom}
                      </Text>
                    </View>
                    <Text style={styles.reviewLineSku}>SKU: {item?.sku ?? 'N/A'}</Text>
                    {line.lotNo ? (
                      <Text style={styles.reviewLineTrace}>
                        Lot: {line.lotNo}{line.expiryDate ? ` · Exp: ${line.expiryDate}` : ''}
                      </Text>
                    ) : null}
                    {serials.length > 0 ? (
                      <Text style={styles.reviewLineTrace}>
                        Serials ({serials.length}): {serials.slice(0, 3).join(', ')}{serials.length > 3 ? ` +${serials.length - 3} more` : ''}
                      </Text>
                    ) : null}
                    {line.discrepancyReason.trim() ? (
                      <Text style={styles.reviewLineDiscrepancy}>
                        Note: {line.discrepancyReason.trim()}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>

            <View style={styles.modalActionButtons}>
              <Button
                label={submitting ? 'Posting to ledger...' : 'Confirm & Post stock'}
                onPress={() => void submitCommit()}
                loading={submitting}
              />
              <Button
                label="Back to editing"
                variant="ghost"
                onPress={() => setShowReviewModal(false)}
                disabled={submitting}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Barcode / QR Scanner Modal */}
      <Modal
        visible={scannerVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setScannerVisible(false)}
      >
        <View style={styles.scannerModalOverlay}>
          <View style={styles.scannerContainer}>
            <View style={styles.scannerHeader}>
              <View>
                <Text style={styles.scannerTitle}>
                  {scanMode === 'item' ? 'Continuous Receive Scanner' : 'Serial Number Scanner'}
                </Text>
                <Text style={styles.scannerSubtitle}>
                  {receiveScanSummary(lines).lineCount} lines · {receiveScanSummary(lines).unitCount} total units
                </Text>
              </View>
              <View style={styles.scannerHeaderControls}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={scanningPaused ? 'Resume scanning' : 'Pause scanning'}
                  onPress={() => setScanningPaused((p) => !p)}
                  style={[styles.torchButton, scanningPaused && { backgroundColor: palette.gold }]}
                >
                  <MaterialCommunityIcons
                    name={scanningPaused ? 'play' : 'pause'}
                    size={20}
                    color={colors.white}
                  />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Toggle torch"
                  onPress={() => setTorch((current) => !current)}
                  style={styles.torchButton}
                >
                  <MaterialCommunityIcons
                    name={torch ? 'flashlight' : 'flashlight-off'}
                    size={20}
                    color={colors.white}
                  />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close scanner"
                  onPress={() => setScannerVisible(false)}
                  style={styles.closeScannerButton}
                >
                  <MaterialCommunityIcons name="close" size={22} color={colors.white} />
                </Pressable>
              </View>
            </View>

            {cameraPermission?.granted ? (
              <View style={styles.cameraFrame}>
                <CameraView
                  style={StyleSheet.absoluteFill}
                  enableTorch={torch}
                  onBarcodeScanned={handleBarcodeScanned}
                  barcodeScannerSettings={{
                    barcodeTypes: ['qr', 'ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e'],
                  }}
                />
                <View style={styles.reticleContainer}>
                  <View style={styles.reticle} />
                </View>
                {scanningPaused ? (
                  <View style={styles.pausedOverlay}>
                    <MaterialCommunityIcons name="pause-circle" size={44} color={palette.gold} />
                    <Text style={styles.pausedOverlayTitle}>SCANNING PAUSED</Text>
                    <Text style={styles.pausedOverlaySubtitle}>Tap Play in top bar to resume</Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <View style={styles.permissionBox}>
                <MaterialCommunityIcons name="camera-off" size={40} color={colors.muted} />
                <Text style={styles.permissionTitle}>Camera access required</Text>
                <Text style={styles.permissionText}>
                  Allow camera permission to scan item barcodes and serial numbers directly.
                </Text>
                <Button label="Grant permission" onPress={() => void requestCameraPermission()} />
              </View>
            )}

            {/* Manual entry / Wedge Scanner bar */}
            <View style={styles.scannerManualBar}>
              <View style={styles.scannerManualInputWrap}>
                <TextInput
                  style={styles.scannerManualInput}
                  placeholder="Type/wedge barcode or SKU…"
                  placeholderTextColor="#64748B"
                  value={manualCodeInput}
                  onChangeText={setManualCodeInput}
                  onSubmitEditing={handleManualScanSubmit}
                  autoCapitalize="characters"
                  returnKeyType="done"
                />
              </View>
              {scanMode === 'item' ? (
                <View style={styles.scannerQtyInputWrap}>
                  <TextInput
                    style={styles.scannerQtyInput}
                    placeholder="Qty"
                    placeholderTextColor="#64748B"
                    value={manualQtyInput}
                    onChangeText={setManualQtyInput}
                    keyboardType="numeric"
                  />
                </View>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Enter code manually"
                onPress={handleManualScanSubmit}
                style={({ pressed }) => [styles.scannerManualSubmitBtn, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons name="arrow-right-bold" size={18} color={colors.white} />
              </Pressable>
            </View>

            <View style={styles.scannerFooter}>
              {unmatchedBarcode && canWriteInventory ? (
                <View style={styles.unmatchedBarcodeBox}>
                  <View style={styles.unmatchedHeaderRow}>
                    <MaterialCommunityIcons name="alert-circle-outline" size={20} color={colors.warning} />
                    <Text style={styles.unmatchedBarcodeTitle}>
                      Product not found in Item Catalogue. Would you like to add this item?
                    </Text>
                  </View>
                  <Text style={styles.unmatchedBarcodeDesc}>
                    Barcode "{unmatchedBarcode}" is not recognized in your catalogue.
                  </Text>
                  <View style={styles.unmatchedBtnRow}>
                    <Button
                      label="Add New Item"
                      variant="primary"
                      onPress={() => {
                        setScannerVisible(false);
                        openQuickItemModal(unmatchedBarcode, scanTargetLineKey);
                      }}
                    />
                    {onGoToItems ? (
                      <Button
                        label="Search Catalogue"
                        variant="secondary"
                        onPress={() => {
                          setScannerVisible(false);
                          onGoToItems();
                        }}
                      />
                    ) : null}
                    <Button
                      label="Cancel"
                      variant="ghost"
                      onPress={() => setUnmatchedBarcode(null)}
                    />
                  </View>
                </View>
              ) : scannerError ? (
                <View style={styles.scannerErrorBox}>
                  <MaterialCommunityIcons name="alert-circle" size={16} color={colors.danger} />
                  <Text style={styles.scannerErrorText}>{scannerError}</Text>
                </View>
              ) : scannerMessage ? (
                <View style={styles.scannerSuccessBox}>
                  <MaterialCommunityIcons name="check-circle" size={16} color={colors.success} />
                  <Text style={styles.scannerSuccessText}>{scannerMessage}</Text>
                </View>
              ) : (
                <Text style={styles.scannerHint}>
                  {scanMode === 'item'
                    ? 'Scan barcode to add or increment line. Rapid scans auto-merge.'
                    : 'Align serial barcodes to append to active line.'}
                </Text>
              )}

              {/* Running recent scans & Undo */}
              {recentScans.length > 0 ? (
                <View style={styles.scannerRecentWrap}>
                  <View style={styles.scannerRecentHeader}>
                    <Text style={styles.scannerRecentTitle}>Recent scans:</Text>
                    {lastLineStateBeforeScan.current ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Undo last scan"
                        onPress={handleUndoLastScan}
                        style={({ pressed }) => [styles.scannerUndoBtn, pressed && styles.pressed]}
                      >
                        <MaterialCommunityIcons name="undo" size={14} color={colors.accent} />
                        <Text style={styles.scannerUndoText}>Undo scan</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scannerRecentScroll}>
                    {recentScans.slice(0, 5).map((scan) => (
                      <View key={scan.id} style={styles.scannerRecentPill}>
                        <Text style={styles.scannerRecentPillQty}>+{scan.quantity}</Text>
                        <Text style={styles.scannerRecentPillLabel} numberOfLines={1}>
                          {scan.label}
                        </Text>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>

      {/* Quick Create Supplier Modal */}
      <Modal
        visible={quickSupplierModal}
        animationType="slide"
        transparent
        onRequestClose={() => {
          if (!quickSupplierSaving) setQuickSupplierModal(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.quickModalBox}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.quickModalEyebrow}>PARTNER MASTER</Text>
                <Text style={styles.modalTitle}>New Supplier</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => !quickSupplierSaving && setQuickSupplierModal(false)}
                style={styles.modalCloseButton}
              >
                <MaterialCommunityIcons name="close" size={20} color={colors.navy} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.quickModalForm}>
              {quickSupplierError ? (
                <View style={styles.modalErrorBox}>
                  <MaterialCommunityIcons name="alert-circle-outline" size={16} color={colors.danger} />
                  <Text style={styles.modalErrorText}>{quickSupplierError}</Text>
                </View>
              ) : null}

              <Field
                label="Supplier Name"
                value={quickSupplierName}
                onChangeText={setQuickSupplierName}
                placeholder="e.g. Acme Industrial Supplies"
                autoCapitalize="words"
              />
              <Field
                label="Supplier Code (optional)"
                value={quickSupplierCode}
                onChangeText={setQuickSupplierCode}
                placeholder="Auto-generated if empty (e.g. SUP-1001)"
                autoCapitalize="characters"
              />
              <Field
                label="Contact Phone (optional)"
                value={quickSupplierPhone}
                onChangeText={setQuickSupplierPhone}
                placeholder="+1 555 0100"
                keyboardType="phone-pad"
              />
            </ScrollView>

            <View style={styles.modalActionButtons}>
              <Button
                label={quickSupplierSaving ? 'Registering supplier...' : 'Create & Select Supplier'}
                onPress={() => void handleCreateQuickSupplier()}
                loading={quickSupplierSaving}
              />
              <Button
                label="Cancel"
                variant="ghost"
                onPress={() => setQuickSupplierModal(false)}
                disabled={quickSupplierSaving}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Quick Create Item Modal */}
      <Modal
        visible={quickItemModal}
        animationType="slide"
        transparent
        onRequestClose={() => {
          if (!quickItemSaving) setQuickItemModal(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.quickModalBox}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.quickModalEyebrow}>ITEM CATALOGUE</Text>
                <Text style={styles.modalTitle}>New Product</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => !quickItemSaving && setQuickItemModal(false)}
                style={styles.modalCloseButton}
              >
                <MaterialCommunityIcons name="close" size={20} color={colors.navy} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.quickModalForm}>
              {quickItemError ? (
                <View style={styles.modalErrorBox}>
                  <MaterialCommunityIcons name="alert-circle-outline" size={16} color={colors.danger} />
                  <Text style={styles.modalErrorText}>{quickItemError}</Text>
                </View>
              ) : null}

              <Field
                label="Item SKU"
                value={quickItemSku}
                onChangeText={setQuickItemSku}
                placeholder="e.g. SKU-1002"
                autoCapitalize="characters"
              />
              <Field
                label="Item Name"
                value={quickItemName}
                onChangeText={setQuickItemName}
                placeholder="e.g. M8 Stainless Bolt (100pk)"
                autoCapitalize="words"
              />
              <Field
                label="Barcode / EAN (optional)"
                value={quickItemBarcode}
                onChangeText={setQuickItemBarcode}
                placeholder="Barcode number"
                autoCapitalize="characters"
              />
              <SelectField
                label="Unit of Measure (Base UOM)"
                value={quickItemUom}
                onChange={setQuickItemUom}
                options={[
                  { value: 'ea', label: 'ea · Each / Single Unit' },
                  { value: 'box', label: 'box · Box / Case' },
                  { value: 'kg', label: 'kg · Kilogram' },
                  { value: 'pack', label: 'pack · Package' },
                  { value: 'set', label: 'set · Set / Kit' },
                  { value: 'm', label: 'm · Metre' },
                  { value: 'l', label: 'l · Litre' },
                ]}
                placeholder="Select base unit"
              />
              <SelectField
                label="Tracking Mode"
                value={quickItemTracking}
                onChange={(val) => setQuickItemTracking(val as 'none' | 'lot' | 'serial')}
                options={[
                  { value: 'none', label: 'Standard (No Lot or Serial tracking)' },
                  { value: 'lot', label: 'Lot-tracked (Batch / Expiry tracking)' },
                  { value: 'serial', label: 'Serial-tracked (Unique serial numbers)' },
                ]}
                placeholder="Select tracking mode"
              />
            </ScrollView>

            <View style={styles.modalActionButtons}>
              <Button
                label={quickItemSaving ? 'Saving item...' : 'Create & Select Item'}
                onPress={() => void handleCreateQuickItem()}
                loading={quickItemSaving}
              />
              <Button
                label="Cancel"
                variant="ghost"
                onPress={() => setQuickItemModal(false)}
                disabled={quickItemSaving}
              />
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#EFF3F8',
  },
  content: {
    paddingHorizontal: 16,
    gap: 14,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    marginTop: 8,
    marginBottom: 4,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FCFDFE',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  logoImage: {
    width: 48,
    height: 48,
  },
  greetingBox: {
    flex: 1,
    gap: 2,
    justifyContent: 'center',
  },
  greetingTitle: {
    fontFamily: fonts.heading,
    fontSize: 24,
    color: '#192338',
    letterSpacing: -0.5,
    lineHeight: 30,
  },
  greetingSubtitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 12.5,
    color: '#64748B',
    marginTop: 1,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FCFDFE',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderTopColor: '#FFFFFF',
    borderBottomColor: 'rgba(215, 225, 238, 0.7)',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 3,
  },
  quickActionsCard: {
    backgroundColor: palette.glass,
    borderRadius: radius.xl,
    borderWidth: 1.1,
    borderColor: palette.glassBorder,
    padding: spacing.lg,
    gap: spacing.xs,
    ...neo.soft,
  },
  quickActionsTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 15,
    color: colors.navy,
  },
  quickActionsHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  quickAction: {
    flexGrow: 1,
    flexBasis: '46%',
    backgroundColor: 'rgba(255,255,255,0.66)',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.glassBorder,
    padding: spacing.md,
    gap: 3,
  },
  quickIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: '#EAF1FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  quickIconMuted: {
    backgroundColor: '#EEF3F7',
  },
  quickIconWarning: {
    backgroundColor: colors.warningSoft,
  },
  quickIconSuccess: {
    backgroundColor: colors.successSoft,
  },
  quickLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  quickDetail: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  eyebrow: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 2,
    color: colors.deep,
  },
  title: {
    fontFamily: fonts.heading,
    fontSize: 28,
    color: colors.navy,
    marginTop: 2,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 21,
    color: colors.muted,
    marginTop: spacing.xs,
    maxWidth: 360,
  },
  card: {
    backgroundColor: palette.glass,
    borderRadius: radius.xl,
    borderWidth: 1.1,
    borderColor: palette.glassBorder,
    padding: spacing.lg,
    gap: spacing.md,
    ...neo.raised,
  },
  cardHeadingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  cardTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 18,
    color: colors.navy,
  },
  cardHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  lineCount: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#EAF3FA',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
  },
  lineCountText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.deep,
  },
  locationHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.muted,
    marginTop: -spacing.xs,
  },
  locationNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: -spacing.xs,
  },
  noticeStaging: {
    backgroundColor: '#FEF9EE',
    borderColor: '#F8D88A',
  },
  noticeDirect: {
    backgroundColor: '#F0F9F4',
    borderColor: '#A8E3C0',
  },
  locationNoticeText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.text,
  },
  serialInputBlock: {
    gap: spacing.xs,
  },
  serialHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  serialLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.text,
  },
  scanSerialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    backgroundColor: '#EAF3FA',
  },
  scanSerialButtonText: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    color: colors.primary,
  },
  trackingHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.muted,
    marginTop: -spacing.xs,
  },
  draftsCard: {
    backgroundColor: palette.glass,
    borderRadius: radius.xl,
    borderWidth: 1.1,
    borderColor: palette.glassBorder,
    padding: spacing.lg,
    gap: spacing.sm,
    ...neo.soft,
  },
  draftsHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  draftsHeading: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  draftsHeadingText: {
    flex: 1,
    gap: 1,
  },
  draftsTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 15,
    color: colors.navy,
  },
  draftsSubtitle: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.muted,
  },
  draftsCount: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#EAF3FA',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  draftsCountText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.deep,
  },
  draftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  draftRowTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  draftBody: {
    flex: 1,
    gap: 2,
  },
  draftNumber: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  draftMeta: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  draftActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  draftButton: {
    minWidth: 48,
    minHeight: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  draftPostButton: {
    backgroundColor: colors.primary,
  },
  draftPostButtonText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.white,
  },
  draftDiscardButton: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  draftButtonPressed: {
    opacity: 0.8,
  },
  draftButtonDisabled: {
    opacity: 0.5,
  },
  draftError: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 17,
    color: colors.danger,
  },
  setupBox: {
    backgroundColor: '#F1F6FC',
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: '#D8E5F3',
  },
  setupHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  setupTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 15,
    color: colors.navy,
  },
  setupText: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
  linesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  linesTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1,
    color: colors.deep,
  },
  linesActionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    backgroundColor: '#EAF3FA',
  },
  scanButtonText: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    color: colors.primary,
  },
  addLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    backgroundColor: '#EAF3FA',
  },
  addLineText: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    color: colors.primary,
  },
  lineCard: {
    backgroundColor: 'rgba(255,255,255,0.62)',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.glassBorder,
    padding: spacing.md,
    gap: spacing.sm,
  },
  lineHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lineHeadingTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  lineNumber: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    letterSpacing: 1.2,
    color: colors.deep,
  },
  lineHeadingButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  lineScanButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#EAF3FA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeLine: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeLineDisabled: {
    opacity: 0.35,
  },
  partnerChipRow: {
    gap: 6,
    paddingVertical: 2,
  },
  partnerChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.md,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: colors.border,
  },
  partnerChipActive: {
    backgroundColor: '#EAF3FA',
    borderColor: colors.deep,
  },
  partnerChipText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.navy,
  },
  partnerChipTextActive: {
    fontFamily: fonts.bodySemi,
    color: colors.deep,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.danger,
  },
  pendingBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  pendingTextWrap: {
    flex: 1,
    gap: 2,
  },
  pendingTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.warning,
  },
  pendingText: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.warning,
  },
  formButtonStack: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  secondaryButtonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  noteCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: '#EAF3FA',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  noteText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.deep,
  },
  recentCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  recentTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 15,
    color: colors.navy,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  recentBody: {
    flex: 1,
    gap: 1,
  },
  recentNumber: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  recentMeta: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  recentHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  recentHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  historyAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  historyActionDisabled: {
    opacity: 0.4,
  },
  historyActionText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.navy,
  },
  statusChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.xs,
  },
  statusChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#F1F5F9',
  },
  statusChipActive: {
    backgroundColor: '#EAF3FA',
    borderColor: colors.deep,
  },
  statusChipText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.navy,
  },
  statusChipTextActive: {
    fontFamily: fonts.bodySemi,
    color: colors.deep,
  },
  historyFilters: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  historyDateRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  historyDateField: {
    flex: 1,
  },
  clearFilters: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
  },
  clearFiltersText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.navy,
  },
  historyStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  historyStatusText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  historyError: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.danger,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  historyEmpty: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.muted,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  mappingNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  mappingNoticeMapped: {
    backgroundColor: colors.successSoft,
  },
  mappingNoticeUnmapped: {
    backgroundColor: colors.warningSoft,
  },
  mappingNoticeText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 10,
    lineHeight: 15,
    color: colors.navy,
  },
  pressed: {
    opacity: 0.7,
  },
  successCard: {
    backgroundColor: palette.glass,
    borderRadius: radius.xxl,
    padding: spacing.xl,
    borderWidth: 1.2,
    borderColor: palette.glassBorder,
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xl,
    ...neo.raised,
  },
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successEyebrow: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 2,
    color: colors.success,
  },
  successTitle: {
    fontFamily: fonts.heading,
    fontSize: 26,
    color: colors.navy,
  },
  successText: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 21,
    color: colors.muted,
    textAlign: 'center',
  },
  successDetails: {
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  detailLabel: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  detailValue: {
    flex: 1,
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.text,
    textAlign: 'right',
  },

  // Modal Review Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '85%',
    padding: spacing.lg,
    gap: spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
  },
  modalEyebrow: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.deep,
  },
  modalTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 18,
    color: colors.navy,
  },
  modalCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalScroll: {
    maxHeight: 380,
  },
  modalScrollContent: {
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  reviewMetaCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reviewMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reviewMetaLabel: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  reviewMetaValue: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.text,
  },
  reviewMetaValueBold: {
    fontFamily: fonts.headingSemi,
    fontSize: 13,
    color: colors.navy,
  },
  textWarning: {
    color: colors.warning,
  },
  textSuccess: {
    color: colors.success,
  },
  reviewLinesTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 1,
    color: colors.deep,
  },
  reviewLineItem: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reviewLineTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reviewLineName: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
  },
  reviewLineQty: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.primary,
  },
  reviewLineSku: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  reviewLineTrace: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.deep,
  },
  reviewLineDiscrepancy: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.warning,
  },
  modalActionButtons: {
    gap: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },

  // Scanner Modal Styles
  scannerModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  scannerContainer: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#0F172A',
    borderRadius: radius.xl,
    overflow: 'hidden',
    gap: spacing.md,
  },
  scannerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  scannerTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 15,
    color: colors.white,
  },
  scannerHeaderControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  torchButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeScannerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraFrame: {
    width: '100%',
    height: 280,
    backgroundColor: '#000',
    position: 'relative',
  },
  reticleContainer: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reticle: {
    width: 220,
    height: 140,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  permissionBox: {
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  permissionTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 16,
    color: colors.white,
  },
  permissionText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  scannerFooter: {
    padding: spacing.md,
    alignItems: 'center',
  },
  scannerMessageText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.warning,
    textAlign: 'center',
  },
  scannerHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#94A3B8',
    textAlign: 'center',
  },
  directStorageBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  directStorageBannerText: {
    flex: 1,
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: '#166534',
    lineHeight: 18,
  },
  missingFacilityBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  missingFacilityTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 15,
    color: colors.navy,
  },
  missingFacilityText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  fieldSectionLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.deep,
  },
  sectionHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  quickCreateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  quickCreateButtonText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.primary,
  },
  quickLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  quickLinkButtonText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.navy,
  },
  noSuppliersBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  noSuppliersText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  unmatchedBarcodeBox: {
    alignItems: 'stretch',
    gap: spacing.sm,
    width: '100%',
    backgroundColor: '#1E293B',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  unmatchedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  unmatchedBarcodeTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 14,
    color: colors.warning,
  },
  unmatchedBarcodeDesc: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: '#CBD5E1',
    lineHeight: 18,
  },
  unmatchedBtnRow: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pausedOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.lg,
  },
  pausedOverlayTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 16,
    letterSpacing: 1.2,
    color: palette.gold,
  },
  pausedOverlaySubtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: '#CBD5E1',
    textAlign: 'center',
  },
  scannerSubtitle: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
  scannerManualBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  scannerManualInputWrap: {
    flex: 1,
  },
  scannerManualInput: {
    backgroundColor: '#1E293B',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    color: colors.white,
    fontFamily: fonts.body,
    fontSize: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  scannerQtyInputWrap: {
    width: 54,
  },
  scannerQtyInput: {
    backgroundColor: '#1E293B',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    color: colors.white,
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  scannerManualSubmitBtn: {
    backgroundColor: colors.primary,
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scannerErrorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.danger,
    width: '100%',
  },
  scannerErrorText: {
    flex: 1,
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: '#FCA5A5',
  },
  scannerSuccessBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.success,
    width: '100%',
  },
  scannerSuccessText: {
    flex: 1,
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: '#86EFAC',
  },
  scannerRecentWrap: {
    width: '100%',
    marginTop: spacing.sm,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    gap: 6,
  },
  scannerRecentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scannerRecentTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: '#94A3B8',
  },
  scannerUndoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#1E293B',
  },
  scannerUndoText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.accent,
  },
  scannerRecentScroll: {
    flexDirection: 'row',
  },
  scannerRecentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1E293B',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    marginRight: 6,
    maxWidth: 180,
  },
  scannerRecentPillQty: {
    fontFamily: fonts.headingSemi,
    fontSize: 11,
    color: colors.accent,
  },
  scannerRecentPillLabel: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#E2E8F0',
  },
  scannerHeroCard: {
    backgroundColor: palette.ink,
    borderRadius: radius.xxl,
    padding: spacing.xl,
    gap: spacing.lg,
    borderWidth: 1.2,
    borderColor: 'rgba(255,255,255,0.16)',
    overflow: 'hidden',
    ...neo.raised,
  },
  scannerHeroGlow: {
    position: 'absolute',
    top: -70,
    right: -50,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(245,197,66,0.18)',
  },
  scannerHeroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  scannerHeroIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 17,
    backgroundColor: palette.gold,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1.4,
    borderTopColor: 'rgba(255,255,255,0.6)',
  },
  scannerHeroTextWrap: {
    flex: 1,
  },
  scannerHeroTitle: {
    fontFamily: fonts.outfitBold,
    fontSize: 18,
    color: colors.white,
  },
  scannerHeroDesc: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 12,
    lineHeight: 17,
    color: 'rgba(255,255,255,0.58)',
    marginTop: 2,
  },
  scannerHeroStats: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  scannerHeroStat: {
    flex: 1,
    alignItems: 'center',
  },
  scannerHeroStatDivider: {
    width: 1,
    height: '70%',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  scannerHeroStatValue: {
    fontFamily: fonts.outfitBold,
    fontSize: 19,
    color: colors.white,
  },
  scannerHeroStatLabel: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.5)',
    marginTop: 2,
  },
  scannerHeroLaunchBtn: {
    backgroundColor: palette.gold,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    gap: spacing.sm,
    borderTopWidth: 1.4,
    borderTopColor: 'rgba(255,255,255,0.6)',
  },
  scannerHeroLaunchBtnText: {
    fontFamily: fonts.outfitBold,
    fontSize: 14,
    letterSpacing: 0.3,
    color: palette.ink,
  },
  draftRecoveryBanner: {
    backgroundColor: 'rgba(255,250,234,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(245,197,66,0.5)',
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.sm,
    ...neo.soft,
  },
  draftRecoveryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  draftRecoveryTextWrap: {
    flex: 1,
  },
  draftRecoveryTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 14,
    color: colors.navy,
  },
  draftRecoverySubtitle: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  draftRecoveryActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  draftRecoveryBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  draftRecoveryBtnPrimary: {
    backgroundColor: colors.primary,
  },
  draftRecoveryBtnTextPrimary: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.white,
  },
  draftRecoveryBtnGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  draftRecoveryBtnTextGhost: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  quickModalBox: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 440,
    maxHeight: '90%',
    gap: spacing.md,
  },
  quickModalEyebrow: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.deep,
  },
  quickModalForm: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  modalErrorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.dangerSoft,
    padding: spacing.sm,
    borderRadius: radius.sm,
  },
  modalErrorText: {
    flex: 1,
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.danger,
  },
  poBanner: {
    backgroundColor: '#EAF1FF',
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  poBannerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  poBannerIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  poBannerText: {
    flex: 1,
    gap: 2,
  },
  poBannerEyebrow: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    letterSpacing: 1.2,
    color: colors.deep,
  },
  poBannerTitle: {
    fontFamily: fonts.heading,
    fontSize: 17,
    color: colors.navy,
  },
  poBannerMeta: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.deep,
  },
  poBannerLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 2,
  },
  poBannerLink: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.primary,
  },
  poLineHint: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.muted,
  },
});
