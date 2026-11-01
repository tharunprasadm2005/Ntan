import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Field } from '../components/Field';
import { SelectField } from '../components/SelectField';
import { useWorkspace } from '../data';
import { formatDateTime, formatQty } from '../format';
import { colors, fonts, radius, shadow, spacing } from '../theme';
import { filterStockedItemOptions } from '../outbound';
import {
  findLocationByScannedCode,
  formatTransferLocation,
  getItemsAvailableAtLocation,
} from '../transfers';
import type { Balance, CreateTransferInput, Transfer } from '../types';

interface TransferScreenProps {
  onBack: () => void;
}

interface DraftLine {
  key: string;
  itemId: string | null;
  qty: string;
  lotNo: string;
  serials: string;
}

type TransferFilter = 'all' | 'active' | 'completed' | 'cancelled';

function newLine(): DraftLine {
  return { key: randomUUID(), itemId: null, qty: '', lotNo: '', serials: '' };
}

function statusTone(status: string): 'info' | 'warning' | 'success' | 'danger' | 'neutral' {
  switch (status) {
    case 'in_transit':
      return 'warning';
    case 'completed':
      return 'success';
    case 'cancelled':
      return 'danger';
    case 'draft':
      return 'info';
    default:
      return 'neutral';
  }
}

export function TransferScreen({ onBack }: TransferScreenProps) {
  const insets = useSafeAreaInsets();
  const { state: authState } = useAuth();
  const {
    items,
    warehouses,
    locations,
    balances,
    inventoryOwners,
    internalClient,
    isMultiOwner,
    activeClientId,
    refresh,
  } = useWorkspace();

  const session = authState.status === 'signedIn' ? authState.session : null;
  const canTransfer = session?.permissions.includes('stock.transfer') ?? false;

  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<TransferFilter>('active');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Composer State
  const [composerOpen, setComposerOpen] = useState(false);
  const singleOwnerId = internalClient?.id ?? inventoryOwners[0]?.id ?? null;
  const [clientId, setClientId] = useState<string | null>(
    isMultiOwner ? activeClientId : singleOwnerId,
  );
  const [fromWarehouseId, setFromWarehouseId] = useState<string | null>(null);
  const [fromLocationId, setFromLocationId] = useState<string | null>(null);
  const [toWarehouseId, setToWarehouseId] = useState<string | null>(null);
  const [toLocationId, setToLocationId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(() => [newLine()]);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Rapid Transfer Scanner State (Source Bin -> Items -> Destination Bin)
  const [rapidScannerStep, setRapidScannerStep] = useState<
    'source' | 'item' | 'destination' | null
  >(null);
  const [scannerMessage, setScannerMessage] = useState<string | null>(null);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const scanThrottle = useRef(false);

  const handleRapidScan = (scanResult: BarcodeScanningResult) => {
    if (scanThrottle.current) return;
    scanThrottle.current = true;
    setTimeout(() => {
      scanThrottle.current = false;
    }, 1400);

    const code = scanResult.data.trim();
    if (!code) return;

    setScannerError(null);

    // STEP 1: SCAN SOURCE BIN
    if (rapidScannerStep === 'source') {
      const foundSource = findLocationByScannedCode(locations, code);
      if (!foundSource) {
        setScannerError(`Location "${code}" not found in active locations.`);
        return;
      }
      setFromLocationId(foundSource.id);
      setFromWarehouseId(foundSource.warehouse_id);

      const avail = getItemsAvailableAtLocation(balances, items, foundSource.id, clientId);
      if (avail.length === 0) {
        setScannerMessage(`Selected source: ${foundSource.code}. Align item barcode next.`);
      } else {
        setScannerMessage(`✓ Source: ${foundSource.code} (${avail.length} items on hand). Align item barcode next.`);
      }
      setRapidScannerStep('item');
      return;
    }

    // STEP 2: SCAN ITEM
    if (rapidScannerStep === 'item') {
      const matchedItem = items.find(
        (i) =>
          (i.barcode && i.barcode.trim().toUpperCase() === code.toUpperCase()) ||
          i.sku.trim().toUpperCase() === code.toUpperCase(),
      );
      if (!matchedItem) {
        setScannerError(`Item "${code}" not found in catalogue.`);
        return;
      }

      setLines((current) => {
        const existingIdx = current.findIndex((l) => l.itemId === matchedItem.id);
        if (existingIdx >= 0) {
          const updated = [...current];
          const curQty = Number(updated[existingIdx].qty) || 0;
          updated[existingIdx] = {
            ...updated[existingIdx],
            qty: String(curQty + 1),
          };
          return updated;
        }
        if (current.length === 1 && !current[0].itemId && !current[0].qty) {
          return [{ key: current[0].key, itemId: matchedItem.id, qty: '1', lotNo: '', serials: '' }];
        }
        return [
          ...current,
          { key: randomUUID(), itemId: matchedItem.id, qty: '1', lotNo: '', serials: '' },
        ];
      });

      setScannerMessage(`✓ Added ${matchedItem.name}. Scan destination bin next, or scan more items.`);
      return;
    }

    // STEP 3: SCAN DESTINATION BIN
    if (rapidScannerStep === 'destination') {
      const foundDest = findLocationByScannedCode(locations, code);
      if (!foundDest) {
        setScannerError(`Destination location "${code}" not found.`);
        return;
      }
      if (foundDest.id === fromLocationId) {
        setScannerError('Destination location cannot be identical to source location.');
        return;
      }
      setToLocationId(foundDest.id);
      setToWarehouseId(foundDest.warehouse_id);
      setScannerMessage(`✓ Destination: ${foundDest.code}. Ready to execute transfer!`);
      setTimeout(() => {
        setRapidScannerStep(null);
        setComposerOpen(true);
      }, 700);
    }
  };

  useEffect(() => {
    if (isMultiOwner) {
      setClientId(activeClientId);
    } else {
      setClientId(singleOwnerId);
    }
  }, [isMultiOwner, activeClientId, singleOwnerId]);

  // Default warehouse initialization
  useEffect(() => {
    if (warehouses.length > 0) {
      if (!fromWarehouseId) setFromWarehouseId(warehouses[0].id);
      if (!toWarehouseId) setToWarehouseId(warehouses[0].id);
    }
  }, [warehouses, fromWarehouseId, toWarehouseId]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await api.transfers({
        clientId: activeClientId,
      });
      setTransfers(response.transfers);
      setSelectedId((current) =>
        current && response.transfers.some((t) => t.id === current)
          ? current
          : response.transfers[0]?.id ?? null,
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Stock transfers could not be loaded.',
      );
    }
  }, [activeClientId]);

  useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load]);

  const pullToRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([refresh(), load()]);
    } finally {
      setRefreshing(false);
    }
  };

  // Lookup dictionaries
  const warehouseMap = useMemo(() => {
    const map = new Map<string, string>();
    warehouses.forEach((w) => map.set(w.id, w.name));
    return map;
  }, [warehouses]);

  const locationMap = useMemo(() => {
    const map = new Map<string, string>();
    locations.forEach((l) => map.set(l.id, `${l.code} (${l.type})`));
    return map;
  }, [locations]);

  // Filtered dropdown options
  const fromLocationOptions = useMemo(() => {
    return locations
      .filter((l) => l.warehouse_id === fromWarehouseId && l.status === 'active')
      .map((l) => ({
        value: l.id,
        label: l.code,
        detail: formatTransferLocation(l),
      }));
  }, [locations, fromWarehouseId]);

  const toLocationOptions = useMemo(() => {
    return locations
      .filter((l) => l.warehouse_id === toWarehouseId && l.status === 'active' && l.id !== fromLocationId)
      .map((l) => ({
        value: l.id,
        label: l.code,
        detail: formatTransferLocation(l),
      }));
  }, [locations, toWarehouseId, fromLocationId]);

  const itemOptions = useMemo(() => {
    const ownerId = isMultiOwner ? clientId : singleOwnerId;
    return filterStockedItemOptions(items, balances, {
      warehouseId: fromWarehouseId,
      locationId: fromLocationId,
      clientId: ownerId,
    });
  }, [items, balances, fromWarehouseId, fromLocationId, isMultiOwner, clientId, singleOwnerId]);

  // Filtered transfer list
  const visibleTransfers = useMemo(() => {
    return transfers.filter((t) => {
      if (filter === 'active') {
        return t.status === 'draft' || t.status === 'in_transit';
      }
      if (filter === 'completed') {
        return t.status === 'completed';
      }
      if (filter === 'cancelled') {
        return t.status === 'cancelled';
      }
      return true;
    });
  }, [transfers, filter]);

  const selectedTransfer = transfers.find((t) => t.id === selectedId) ?? null;

  // Helper to get available stock at source location
  const getSourceAvailable = useCallback(
    (itemId: string | null) => {
      if (!itemId || !fromLocationId) return null;
      const ownerId = isMultiOwner ? clientId : singleOwnerId;
      const locBalances = balances.filter(
        (b) =>
          b.item_id === itemId &&
          b.location_id === fromLocationId &&
          (!ownerId || b.client_id === ownerId) &&
          b.stock_status === 'available',
      );
      return locBalances.reduce(
        (sum, b) =>
          sum + (Number(b.on_hand) - Number(b.reserved || 0) - Number(b.blocked || 0)),
        0,
      );
    },
    [balances, fromLocationId, isMultiOwner, clientId, singleOwnerId],
  );

  // Line management
  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  };

  const removeLine = (key: string) => {
    setLines((current) => (current.length > 1 ? current.filter((l) => l.key !== key) : current));
  };

  const addLine = () => {
    setLines((current) => [...current, newLine()]);
  };

  const handleTransferAllInSourceBin = () => {
    if (!fromLocationId) {
      Alert.alert('Select Source First', 'Please choose or scan the source location first.');
      return;
    }
    const availItems = getItemsAvailableAtLocation(balances, items, fromLocationId, clientId);
    if (availItems.length === 0) {
      Alert.alert('No Stock Available', 'There are no available stock balances at this source location.');
      return;
    }
    const bulkLines: DraftLine[] = availItems.map((ai) => ({
      key: randomUUID(),
      itemId: ai.item.id,
      qty: ai.availableQty,
      lotNo: ai.lotNo ?? '',
      serials: ai.serialNo ?? '',
    }));
    setLines(bulkLines);
    setNotice(`Loaded all ${bulkLines.length} stocked item(s) from bin for bulk transfer.`);
  };

  // Composer submit
  const handleCreateTransfer = async () => {
    setFieldErrors({});
    setError(null);
    setNotice(null);

    const errors: Record<string, string> = {};
    if (!fromWarehouseId) errors.fromWarehouseId = 'Select source warehouse.';
    if (!fromLocationId) errors.fromLocationId = 'Select source location.';
    if (!toWarehouseId) errors.toWarehouseId = 'Select destination warehouse.';
    if (!toLocationId) errors.toLocationId = 'Select destination location.';
    if (fromLocationId && toLocationId && fromLocationId === toLocationId) {
      errors.toLocationId = 'Destination must differ from source.';
    }

    const preparedLines: CreateTransferInput['lines'] = [];
    lines.forEach((line, index) => {
      if (!line.itemId) {
        errors[`line_${index}_item`] = 'Select an item.';
        return;
      }
      const qtyNum = Number(line.qty);
      if (!qtyNum || qtyNum <= 0) {
        errors[`line_${index}_qty`] = 'Enter valid quantity.';
        return;
      }
      const avail = getSourceAvailable(line.itemId);
      if (avail !== null && qtyNum > avail) {
        errors[`line_${index}_qty`] = `Exceeds available (${avail}).`;
      }

      const itemDoc = items.find((i) => i.id === line.itemId);
      const serialsList = line.serials
        ? line.serials.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
        : [];

      if (itemDoc?.tracking_mode === 'serial' && serialsList.length !== qtyNum) {
        errors[`line_${index}_serials`] = `Requires ${qtyNum} serial numbers.`;
      }

      preparedLines.push({
        item_id: line.itemId,
        qty: line.qty.trim(),
        lot_no: line.lotNo.trim() || undefined,
        serial_numbers: serialsList.length > 0 ? serialsList : undefined,
      });
    });

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSaving(true);
    const key = idempotencyKey || `tr-client-${randomUUID()}`;
    setIdempotencyKey(key);

    try {
      const created = await api.createTransfer(
        {
          client_id: isMultiOwner ? clientId : singleOwnerId,
          from_warehouse_id: fromWarehouseId!,
          from_location_id: fromLocationId!,
          to_warehouse_id: toWarehouseId!,
          to_location_id: toLocationId!,
          note: note.trim() || undefined,
          reason: reason.trim() || undefined,
          lines: preparedLines,
        },
        key,
      );

      setTransfers((current) => [created, ...current]);
      setSelectedId(created.id);
      setComposerOpen(false);
      setLines([newLine()]);
      setNote('');
      setReason('');
      setIdempotencyKey(null);
      setNotice(`Transfer ${created.number} draft created.`);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Could not create transfer draft.',
      );
    } finally {
      setSaving(false);
    }
  };

  // Confirm / Dispatch action
  const handleConfirm = async (transfer: Transfer) => {
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const updated = await api.confirmTransfer(transfer.id);
      setTransfers((current) =>
        current.map((t) => (t.id === updated.id ? updated : t)),
      );
      await refresh();
      setNotice(
        updated.status === 'completed'
          ? `Transfer ${updated.number} completed successfully.`
          : `Transfer ${updated.number} dispatched into transit.`,
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Could not confirm transfer.',
      );
    } finally {
      setSaving(false);
    }
  };

  // Receive action
  const handleReceive = async (transfer: Transfer) => {
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const updated = await api.receiveTransfer(transfer.id);
      setTransfers((current) =>
        current.map((t) => (t.id === updated.id ? updated : t)),
      );
      await refresh();
      setNotice(`Transfer ${updated.number} received at destination.`);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Could not receive transfer.',
      );
    } finally {
      setSaving(false);
    }
  };

  // Cancel action
  const handleCancel = async (transfer: Transfer) => {
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const updated = await api.cancelTransfer(transfer.id);
      setTransfers((current) =>
        current.map((t) => (t.id === updated.id ? updated : t)),
      );
      setNotice(`Transfer ${updated.number} cancelled.`);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Could not cancel transfer.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.screen}>
      {/* Top Header: Pure Hexagon Logo + Back Button + Title + Actions */}
      <View
        style={[
          styles.topHeader,
          {
            paddingTop: Math.max(insets.top + 12, 22),
          },
        ]}
      >
        <View style={styles.headerLeft}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={onBack}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <MaterialCommunityIcons name="arrow-left" size={22} color="#192338" />
          </Pressable>
          <Image
            source={require('../../assets/ntan-hexagon-logo.png')}
            style={styles.logoImage}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
          <View style={styles.greetingBox}>
            <Text style={styles.greetingTitle}>Stock Transfers</Text>
            <Text style={styles.greetingSubtitle} numberOfLines={1}>
              {transfers.length} Transfers · Bin & Site Movement
            </Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh transfers"
            onPress={() => void refresh()}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <MaterialCommunityIcons name="sync" size={19} color="#192338" />
          </Pressable>

          {canTransfer ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Rapid scan transfer"
              onPress={() => {
                setScannerMessage(null);
                setScannerError(null);
                setRapidScannerStep('source');
              }}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons name="barcode-scan" size={19} color="#2563EB" />
            </Pressable>
          ) : null}

          {canTransfer ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={composerOpen ? 'Close transfer form' : 'New transfer'}
              onPress={() => {
                setComposerOpen((c) => !c);
                setError(null);
              }}
              style={({ pressed }) => [
                styles.addButton,
                composerOpen && { backgroundColor: '#192338' },
                pressed && styles.pressed,
              ]}
            >
              <MaterialCommunityIcons
                name={composerOpen ? 'close' : 'plus'}
                size={20}
                color="#FFFFFF"
              />
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={pullToRefresh}
            tintColor="#192338"
            colors={['#192338']}
          />
        }
      >
        {/* Banner Notices / Errors */}
        {error ? (
          <View style={styles.errorBanner}>
            <MaterialCommunityIcons name="alert-circle" size={18} color={colors.danger} />
            <Text style={styles.errorBannerText}>{error}</Text>
          </View>
        ) : null}

        {notice ? (
          <View style={styles.noticeBanner}>
            <MaterialCommunityIcons name="check-circle" size={18} color={colors.success} />
            <Text style={styles.noticeBannerText}>{notice}</Text>
          </View>
        ) : null}

        {/* COMPOSER CARD */}
        {composerOpen ? (
          <View style={styles.composerCard}>
            <View style={styles.composerHeader}>
              <View style={styles.composerIconWrap}>
                <MaterialCommunityIcons name="swap-horizontal-bold" size={22} color={colors.navy} />
              </View>
              <View style={styles.composerHeaderText}>
                <Text style={styles.composerTitle}>New Stock Transfer</Text>
                <Text style={styles.composerSubtitle}>
                  Relocate inventory between bins or cross-facility warehouses.
                </Text>
              </View>
            </View>

            {/* Source Warehouse & Location */}
            <View style={styles.formSection}>
              <Text style={styles.formSectionTitle}>1. Source Location</Text>
              <SelectField
                label="Source Warehouse"
                value={fromWarehouseId}
                options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
                onChange={(val) => {
                  setFromWarehouseId(val);
                  setFromLocationId(null);
                }}
                error={fieldErrors.fromWarehouseId}
              />
              <SelectField
                label="Source Location"
                value={fromLocationId}
                options={fromLocationOptions}
                onChange={setFromLocationId}
                placeholder="Choose source location..."
                error={fieldErrors.fromLocationId}
              />
            </View>

            {/* Destination Warehouse & Location */}
            <View style={styles.formSection}>
              <Text style={styles.formSectionTitle}>2. Destination Location</Text>
              <SelectField
                label="Destination Warehouse"
                value={toWarehouseId}
                options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
                onChange={(val) => {
                  setToWarehouseId(val);
                  setToLocationId(null);
                }}
                error={fieldErrors.toWarehouseId}
              />
              <SelectField
                label="Destination Location"
                value={toLocationId}
                options={toLocationOptions}
                onChange={setToLocationId}
                placeholder="Choose destination location..."
                error={fieldErrors.toLocationId}
              />
            </View>

            {/* Line Items */}
            <View style={styles.formSection}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.formSectionTitle}>3. Transfer Items</Text>
                <Button label="+ Add Item" variant="ghost" onPress={addLine} />
              </View>

              {/* 1. Scanner & Bulk Options Placed First */}
              <View style={styles.scanActionsRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Rapid scan transfer items"
                  onPress={() => {
                    setScannerMessage(null);
                    setScannerError(null);
                    setRapidScannerStep(fromLocationId ? 'item' : 'source');
                  }}
                  style={({ pressed }) => [styles.primaryScanButton, { flex: 1 }, pressed && styles.pressed]}
                >
                  <MaterialCommunityIcons name="barcode-scan" size={17} color={colors.white} />
                  <Text style={styles.primaryScanButtonText}>Scan Barcode</Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Transfer all items in bin"
                  onPress={handleTransferAllInSourceBin}
                  style={({ pressed }) => [styles.bulkAllButton, pressed && styles.pressed]}
                >
                  <MaterialCommunityIcons name="layers-triple-outline" size={17} color={colors.navy} />
                  <Text style={styles.bulkAllButtonText}>Transfer All in Bin</Text>
                </Pressable>
              </View>

              <View style={styles.orDividerRow}>
                <View style={styles.orDividerLine} />
                <Text style={styles.orDividerText}>OR SELECT STOCKED ITEMS</Text>
                <View style={styles.orDividerLine} />
              </View>

              {lines.map((line, idx) => {
                const avail = getSourceAvailable(line.itemId);
                const selectedItem = items.find((i) => i.id === line.itemId);
                return (
                  <View key={line.key} style={styles.lineCard}>
                    <View style={styles.lineCardHeader}>
                      <Text style={styles.lineCardIndex}>Item #{idx + 1}</Text>
                      {lines.length > 1 ? (
                        <Pressable onPress={() => removeLine(line.key)}>
                          <MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.danger} />
                        </Pressable>
                      ) : null}
                    </View>

                    <SelectField
                      label="Select Stocked Item"
                      value={line.itemId}
                      options={itemOptions}
                      onChange={(id) => updateLine(line.key, { itemId: id })}
                      placeholder="Choose a stocked item..."
                      emptyLabel="No stocked items available at source location"
                      error={fieldErrors[`line_${idx}_item`]}
                    />

                    {line.itemId && fromLocationId ? (
                      <View style={styles.availPill}>
                        <MaterialCommunityIcons name="information-outline" size={14} color={colors.deep} />
                        <Text style={styles.availPillText}>
                          Available at source: {avail !== null ? `${formatQty(String(avail))} ${selectedItem?.base_uom ?? ''}` : 'Loading...'}
                        </Text>
                      </View>
                    ) : null}

                    <Field
                      label={`Quantity (${selectedItem?.base_uom ?? 'units'})`}
                      value={line.qty}
                      onChangeText={(qty) => updateLine(line.key, { qty })}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      error={fieldErrors[`line_${idx}_qty`]}
                    />

                    {selectedItem?.tracking_mode === 'lot' ? (
                      <Field
                        label="Lot / Batch #"
                        value={line.lotNo}
                        onChangeText={(lotNo) => updateLine(line.key, { lotNo })}
                        placeholder="e.g. LOT-2026-X"
                      />
                    ) : null}

                    {selectedItem?.tracking_mode === 'serial' ? (
                      <Field
                        label="Serial Numbers (comma or newline separated)"
                        value={line.serials}
                        onChangeText={(serials) => updateLine(line.key, { serials })}
                        placeholder="SN001, SN002"
                        multiline
                        error={fieldErrors[`line_${idx}_serials`]}
                      />
                    ) : null}
                  </View>
                );
              })}
            </View>

            {/* Optional note */}
            <Field
              label="Transfer Note (Optional)"
              value={note}
              onChangeText={setNote}
              placeholder="e.g. Work order requisition or re-slotting"
            />

            <View style={styles.composerActions}>
              <Button
                label="Cancel"
                variant="ghost"
                onPress={() => setComposerOpen(false)}
              />
              <Button
                label="Create Transfer Draft"
                variant="primary"
                loading={saving}
                onPress={handleCreateTransfer}
              />
            </View>
          </View>
        ) : null}

        {/* Filter Tabs */}
        <View style={styles.tabFilterRow}>
          {[
            { key: 'active', label: 'Active Tasks' },
            { key: 'completed', label: 'Completed' },
            { key: 'cancelled', label: 'Cancelled' },
            { key: 'all', label: 'All' },
          ].map((tab) => (
            <Pressable
              key={tab.key}
              onPress={() => setFilter(tab.key as TransferFilter)}
              style={[styles.tabFilterPill, filter === tab.key && styles.tabFilterPillActive]}
            >
              <Text style={[styles.tabFilterText, filter === tab.key && styles.tabFilterTextActive]}>
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Selected Transfer Details Drawer / Card */}
        {selectedTransfer ? (
          <View style={styles.detailCard}>
            <View style={styles.detailCardHeader}>
              <View style={styles.detailHeaderTitleBlock}>
                <Text style={styles.detailNumber}>{selectedTransfer.number}</Text>
                <Text style={styles.detailCreated}>
                  Created {formatDateTime(selectedTransfer.created_at)}
                </Text>
              </View>
              <View style={styles.badgeCluster}>
                <Badge label={selectedTransfer.status.replace('_', ' ')} tone={statusTone(selectedTransfer.status)} />
                <Badge
                  label={selectedTransfer.transfer_type === 'bin_to_bin' ? 'Bin-to-Bin' : 'Cross-WH'}
                  tone="neutral"
                />
              </View>
            </View>

            {/* Route Map */}
            <View style={styles.routeBox}>
              <View style={styles.routeCol}>
                <Text style={styles.routeLabel}>FROM</Text>
                <Text style={styles.routeWarehouse}>{warehouseMap.get(selectedTransfer.from_warehouse_id) ?? 'Warehouse'}</Text>
                <Text style={styles.routeLocation}>{locationMap.get(selectedTransfer.from_location_id) ?? selectedTransfer.from_location_id}</Text>
              </View>

              <MaterialCommunityIcons name="arrow-right-bold" size={24} color={colors.primary} />

              <View style={styles.routeCol}>
                <Text style={styles.routeLabel}>TO</Text>
                <Text style={styles.routeWarehouse}>{warehouseMap.get(selectedTransfer.to_warehouse_id) ?? 'Warehouse'}</Text>
                <Text style={styles.routeLocation}>{locationMap.get(selectedTransfer.to_location_id) ?? selectedTransfer.to_location_id}</Text>
              </View>
            </View>

            {/* Line Items List */}
            <View style={styles.detailLinesSection}>
              <Text style={styles.detailSectionTitle}>Transferred Items ({selectedTransfer.lines.length})</Text>
              {selectedTransfer.lines.map((l) => (
                <View key={l.id} style={styles.detailLineRow}>
                  <View style={styles.detailLineMain}>
                    <Text style={styles.detailLineSku}>{l.sku}</Text>
                    <Text style={styles.detailLineName}>{l.item_name}</Text>
                    {l.lot_no ? (
                      <Text style={styles.detailLineMeta}>Lot: {l.lot_no}</Text>
                    ) : null}
                    {l.serial_numbers && l.serial_numbers.length > 0 ? (
                      <Text style={styles.detailLineMeta}>Serials: {l.serial_numbers.join(', ')}</Text>
                    ) : null}
                  </View>
                  <Text style={styles.detailLineQty}>{formatQty(l.qty)} {l.uom}</Text>
                </View>
              ))}
            </View>

            {/* Operational Actions */}
            {canTransfer ? (
              <View style={styles.detailActionsRow}>
                {selectedTransfer.status === 'draft' ? (
                  <>
                    <Button
                      label="Cancel Draft"
                      variant="danger"
                      loading={saving}
                      onPress={() => handleCancel(selectedTransfer)}
                    />
                    <Button
                      label={
                        selectedTransfer.transfer_type === 'bin_to_bin'
                          ? 'Confirm Transfer'
                          : 'Dispatch to Transit'
                      }
                      variant="primary"
                      loading={saving}
                      onPress={() => handleConfirm(selectedTransfer)}
                    />
                  </>
                ) : null}

                {selectedTransfer.status === 'in_transit' ? (
                  <Button
                    label="Receive at Destination"
                    variant="accent"
                    loading={saving}
                    onPress={() => handleReceive(selectedTransfer)}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Transfer Queue List */}
        <View style={styles.queueSection}>
          <Text style={styles.queueTitle}>
            {filter === 'active' ? 'Active Transfer Queue' : 'Transfer Records'} ({visibleTransfers.length})
          </Text>

          {loading && transfers.length === 0 ? (
            <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.primary} />
          ) : visibleTransfers.length === 0 ? (
            <EmptyState
              icon="swap-horizontal"
              title={filter === 'active' ? 'No active transfers' : 'No transfers found'}
              message={
                filter === 'active'
                  ? 'All transfer queues are clear. Start a new bin-to-bin or cross-warehouse transfer above.'
                  : 'No transfer records match the selected filter.'
              }
            />
          ) : (
            visibleTransfers.map((item) => {
              const isSelected = item.id === selectedId;
              const totalUnits = item.lines.reduce((s, l) => s + Number(l.qty || 0), 0);
              return (
                <Pressable
                  key={item.id}
                  onPress={() => setSelectedId(item.id)}
                  style={[styles.itemCard, isSelected && styles.itemCardSelected]}
                >
                  <View style={styles.itemCardHeader}>
                    <View style={styles.itemCardTitleBlock}>
                      <Text style={styles.itemNumber}>{item.number}</Text>
                      <Text style={styles.itemRoute}>
                        {warehouseMap.get(item.from_warehouse_id) ?? 'WH'} → {warehouseMap.get(item.to_warehouse_id) ?? 'WH'}
                      </Text>
                    </View>
                    <Badge label={item.status.replace('_', ' ')} tone={statusTone(item.status)} />
                  </View>

                  <View style={styles.itemCardFooter}>
                    <Text style={styles.itemFooterText}>
                      {item.lines.length} item{item.lines.length === 1 ? '' : 's'} · {formatQty(String(totalUnits))} units
                    </Text>
                    <Text style={styles.itemFooterDate}>{formatDateTime(item.created_at)}</Text>
                  </View>
                </Pressable>
              );
            })
          )}
        </View>
      </ScrollView>

      {/* Rapid Transfer Scanner Modal (Source -> Items -> Destination) */}
      <Modal
        visible={rapidScannerStep !== null}
        animationType="fade"
        transparent
        onRequestClose={() => setRapidScannerStep(null)}
      >
        <View style={styles.scannerModalOverlay}>
          <View style={styles.scannerContainer}>
            <View style={styles.scannerHeader}>
              <View style={styles.scannerHeaderTitleWrap}>
                <Text style={styles.scannerTitle}>Rapid Scan Transfer</Text>
                <View style={styles.rapidStepRow}>
                  <View
                    style={[
                      styles.rapidStepPill,
                      rapidScannerStep === 'source' && styles.rapidStepPillActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.rapidStepText,
                        rapidScannerStep === 'source' && styles.rapidStepTextActive,
                      ]}
                    >
                      1. Source
                    </Text>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={14} color="#94A3B8" />
                  <View
                    style={[
                      styles.rapidStepPill,
                      rapidScannerStep === 'item' && styles.rapidStepPillActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.rapidStepText,
                        rapidScannerStep === 'item' && styles.rapidStepTextActive,
                      ]}
                    >
                      2. Items
                    </Text>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={14} color="#94A3B8" />
                  <View
                    style={[
                      styles.rapidStepPill,
                      rapidScannerStep === 'destination' && styles.rapidStepPillActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.rapidStepText,
                        rapidScannerStep === 'destination' && styles.rapidStepTextActive,
                      ]}
                    >
                      3. Dest Bin
                    </Text>
                  </View>
                </View>
              </View>
              <View style={styles.scannerHeaderControls}>
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
                  onPress={() => setRapidScannerStep(null)}
                  style={styles.closeScannerButton}
                >
                  <MaterialCommunityIcons name="close" size={22} color={colors.white} />
                </Pressable>
              </View>
            </View>

            {/* Instruction banner for current step */}
            <View style={styles.scannerInstructionCard}>
              <Text style={styles.scannerInstructionText}>
                {rapidScannerStep === 'source'
                  ? 'Step 1: Point camera at SOURCE location/bin barcode'
                  : rapidScannerStep === 'item'
                    ? 'Step 2: Scan product barcodes to add to transfer'
                    : 'Step 3: Point camera at DESTINATION location/bin barcode'}
              </Text>
              {rapidScannerStep === 'item' ? (
                <View style={styles.scannerItemActionsRow}>
                  <View style={styles.scannerCartPill}>
                    <Text style={styles.scannerCartText}>
                      Manifest: {lines.filter((l) => l.itemId).length} SKU(s) (
                      {lines.reduce((s, l) => s + (Number(l.qty) || 0), 0)} units)
                    </Text>
                  </View>
                  <View style={styles.scannerItemBtnGroup}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Add all items in bin"
                      onPress={handleTransferAllInSourceBin}
                      style={({ pressed }) => [styles.scannerBulkAllBtn, pressed && styles.pressed]}
                    >
                      <MaterialCommunityIcons name="layers-triple" size={14} color={colors.navy} />
                      <Text style={styles.scannerBulkAllBtnText}>All in Bin</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Proceed to destination bin"
                      onPress={() => {
                        setScannerMessage(null);
                        setScannerError(null);
                        setRapidScannerStep('destination');
                      }}
                      style={({ pressed }) => [styles.nextStepBtn, pressed && styles.pressed]}
                    >
                      <Text style={styles.nextStepBtnText}>Scan Dest Bin</Text>
                      <MaterialCommunityIcons name="arrow-right" size={15} color={colors.white} />
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>

            {cameraPermission?.granted ? (
              <View style={styles.cameraFrame}>
                <CameraView
                  style={StyleSheet.absoluteFill}
                  enableTorch={torch}
                  onBarcodeScanned={handleRapidScan}
                  barcodeScannerSettings={{
                    barcodeTypes: ['qr', 'ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e'],
                  }}
                />
                <View style={styles.reticleContainer}>
                  <View style={styles.reticle} />
                </View>
              </View>
            ) : (
              <View style={styles.scannerPermissionBox}>
                <MaterialCommunityIcons name="camera-off" size={40} color={colors.muted} />
                <Text style={styles.scannerPermissionTitle}>Camera access required</Text>
                <Text style={styles.scannerPermissionText}>
                  Allow camera permission to scan rack, bin, and item barcodes.
                </Text>
                <Button label="Grant permission" onPress={() => void requestCameraPermission()} />
              </View>
            )}

            <View style={styles.scannerFooter}>
              {scannerError ? (
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
                  {rapidScannerStep === 'source'
                    ? 'Align source rack or bin barcode in reticle'
                    : rapidScannerStep === 'item'
                      ? `${lines.filter((l) => l.itemId).length} item lines added so far`
                      : 'Align destination rack or bin barcode in reticle'}
                </Text>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#EFF3F8',
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 6,
    backgroundColor: '#EFF3F8',
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  pressed: {
    opacity: 0.7,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  navTitleBlock: {
    flex: 1,
  },
  navEyebrow: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    letterSpacing: 1.4,
    color: colors.deep,
  },
  navTitle: {
    fontFamily: fonts.heading,
    fontSize: 20,
    color: colors.navy,
  },
  scrollArea: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#F8B4B4',
  },
  errorBannerText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.danger,
    flex: 1,
  },
  noticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.successSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  noticeBannerText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.success,
    flex: 1,
  },
  composerCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadow,
  },
  composerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
  },
  composerIconWrap: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: '#EDF5FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerHeaderText: {
    flex: 1,
  },
  composerTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 16,
    color: colors.navy,
  },
  composerSubtitle: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  formSection: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  formSectionTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lineCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  lineCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lineCardIndex: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.deep,
  },
  availPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EAF3FA',
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  availPillText: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    color: colors.deep,
  },
  composerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  tabFilterRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  tabFilterPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabFilterPillActive: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  tabFilterText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.navy,
  },
  tabFilterTextActive: {
    color: colors.white,
  },
  detailCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadow,
  },
  detailCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  detailHeaderTitleBlock: {
    gap: 2,
  },
  detailNumber: {
    fontFamily: fonts.headingSemi,
    fontSize: 17,
    color: colors.navy,
  },
  detailCreated: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  badgeCluster: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  routeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F3F7FA',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  routeCol: {
    flex: 1,
    gap: 2,
  },
  routeLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    color: colors.muted,
  },
  routeWarehouse: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
  },
  routeLocation: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.deep,
  },
  detailLinesSection: {
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  detailSectionTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
  },
  detailLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  detailLineMain: {
    flex: 1,
    gap: 1,
  },
  detailLineSku: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  detailLineName: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  detailLineMeta: {
    fontFamily: fonts.body,
    fontSize: 9,
    color: colors.deep,
  },
  detailLineQty: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
  },
  detailActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  queueSection: {
    gap: spacing.sm,
  },
  queueTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 15,
    color: colors.navy,
  },
  itemCard: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  itemCardSelected: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  itemCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  itemCardTitleBlock: {
    gap: 1,
  },
  itemNumber: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
  },
  itemRoute: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  itemCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  itemFooterText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.deep,
  },
  itemFooterDate: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  headingButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  rapidScanHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: '#EDF3FF',
  },
  rapidScanHeaderBtnText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.primary,
  },
  primaryScanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingVertical: 10,
    borderRadius: radius.sm,
    marginTop: spacing.xs,
  },
  primaryScanButtonText: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.white,
  },
  scanActionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  bulkAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: '#EDF5FF',
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: '#CBE0FB',
    marginTop: spacing.xs,
  },
  bulkAllButtonText: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
  },
  scannerItemActionsRow: {
    gap: spacing.xs,
    marginTop: 2,
  },
  scannerCartPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  scannerCartText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.accent,
  },
  scannerItemBtnGroup: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    marginTop: 4,
  },
  scannerBulkAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#E2E8F0',
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  scannerBulkAllBtnText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  orDividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginVertical: spacing.xs,
  },
  orDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  orDividerText: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.muted,
  },
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
  scannerHeaderTitleWrap: {
    flex: 1,
    gap: 4,
  },
  scannerTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 15,
    color: colors.white,
  },
  rapidStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rapidStepPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: '#1E293B',
  },
  rapidStepPillActive: {
    backgroundColor: colors.primary,
  },
  rapidStepText: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    color: '#94A3B8',
  },
  rapidStepTextActive: {
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
  scannerInstructionCard: {
    backgroundColor: '#1E293B',
    marginHorizontal: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 6,
  },
  scannerInstructionText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.white,
  },
  nextStepBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  nextStepBtnText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.white,
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
  scannerPermissionBox: {
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  scannerPermissionTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 16,
    color: colors.white,
  },
  scannerPermissionText: {
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
  scannerHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#94A3B8',
    textAlign: 'center',
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
});
