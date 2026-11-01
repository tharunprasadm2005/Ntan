import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
import { formatDateTime, formatQty, humanize } from '../format';
import {
  calculateOutboundProgress,
  filterStockedItemOptions,
  findItemByScannedCode,
  formatAllocationCoordinates,
  matchAllocationForScan,
  sortAllocationsByWalkingPath,
} from '../outbound';
import { colors, fonts, neo, palette, radius, shadow, spacing } from '../theme';
import { PageHeader, PressableScale } from '../components/ui';
import type { OutboundAllocation, OutboundOrder } from '../types';

interface OutboundScreenProps {
  onBack: () => void;
}

interface DraftLine {
  key: string;
  itemId: string | null;
  qty: string;
}

type OrderFilter = 'all' | 'open' | 'shipped';

function newLine(): DraftLine {
  return { key: randomUUID(), itemId: null, qty: '' };
}

function statusTone(status: string): 'info' | 'warning' | 'success' | 'danger' | 'neutral' {
  if (status === 'allocated') {
    return 'warning';
  }
  if (status === 'shipped') {
    return 'success';
  }
  if (status === 'cancelled') {
    return 'danger';
  }
  return 'info';
}

export function OutboundScreen({ onBack }: OutboundScreenProps) {
  const insets = useSafeAreaInsets();
  const { state } = useAuth();
  const {
    items,
    warehouses,
    clients,
    locations,
    balances,
    inventoryOwners,
    internalClient,
    isMultiOwner,
    activeClientId,
    refresh,
  } = useWorkspace();
  const session = state.status === 'signedIn' ? state.session : null;
  const canIssue = session?.permissions.includes('stock.issue') ?? false;

  const [orders, setOrders] = useState<OutboundOrder[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<OrderFilter>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Dedicated Scanner Modal State
  const [scannerMode, setScannerMode] = useState<'pick' | 'composer' | null>(null);
  const [scannerMessage, setScannerMessage] = useState<string | null>(null);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const scanThrottle = useRef(false);

  const singleOwnerId = internalClient?.id ?? inventoryOwners[0]?.id ?? null;
  const [clientId, setClientId] = useState<string | null>(
    isMultiOwner ? activeClientId : singleOwnerId,
  );
  const [composerOpen, setComposerOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerReference, setCustomerReference] = useState('');
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [lines, setLines] = useState<DraftLine[]>(() => [newLine()]);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isMultiOwner) {
      setClientId(activeClientId);
    } else {
      setClientId(singleOwnerId);
    }
  }, [isMultiOwner, activeClientId, singleOwnerId]);

  const orderClientId = isMultiOwner ? clientId : singleOwnerId;
  const selectedOwner =
    inventoryOwners.find((owner) => owner.id === orderClientId) ?? null;
  const availableCustomers = useMemo(
    () => clients.filter((c) => c.status !== 'archived' && c.types?.includes('customer')),
    [clients],
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await api.outboundOrders({
        clientId: activeClientId,
      });
      setOrders(response.orders);
      setSelectedId((current) =>
        current && response.orders.some((order) => order.id === current)
          ? current
          : response.orders[0]?.id ?? null,
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Outbound orders could not be loaded.',
      );
    }
  }, [activeClientId]);

  useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load]);

  const warehouseOptions = useMemo(
    () =>
      warehouses.map((warehouse) => ({
        value: warehouse.id,
        label: warehouse.name,
        detail: warehouse.address ?? undefined,
      })),
    [warehouses],
  );

  const itemOptions = useMemo(
    () =>
      filterStockedItemOptions(items, balances, {
        warehouseId,
        clientId: orderClientId,
      }),
    [items, balances, warehouseId, orderClientId],
  );

  const selectedOrder = orders.find((order) => order.id === selectedId) ?? null;
  const visibleOrders = orders.filter((order) => {
    if (filter === 'open') {
      return order.status === 'draft' || order.status === 'allocated';
    }
    if (filter === 'shipped') {
      return order.status === 'shipped';
    }
    return true;
  });

  const applyOrder = (updated: OutboundOrder) => {
    setOrders((current) =>
      current.map((order) => (order.id === updated.id ? updated : order)),
    );
  };

  const pullToRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const resetComposer = () => {
    setClientId(activeClientId);
    setCustomerName('');
    setCustomerId(null);
    setCustomerReference('');
    setWarehouseId(null);
    setLines([newLine()]);
    setIdempotencyKey(null);
    setFieldErrors({});
  };

  const updateLine = (key: string, changes: Partial<DraftLine>) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...changes } : line)),
    );
  };

  const removeLine = (key: string) => {
    setLines((current) =>
      current.length === 1 ? current : current.filter((line) => line.key !== key),
    );
  };

  const createOrder = async () => {
    const errors: Record<string, string> = {};
    if (isMultiOwner && (!orderClientId || orderClientId.toLowerCase() === 'all')) {
      errors.client_id = 'Select the inventory owner whose stock is being shipped.';
    }
    if (!customerName.trim()) {
      errors.customer_name = 'Enter the customer name.';
    }
    if (!warehouseId) {
      errors.warehouse_id = 'Select a warehouse.';
    }
    const prepared = lines.map((line, index) => {
      if (!line.itemId) {
        errors[`lines.${index}.item_id`] = 'Select an item.';
      }
      const qty = Number(line.qty);
      if (!Number.isFinite(qty) || qty <= 0) {
        errors[`lines.${index}.qty`] = 'Enter a quantity above zero.';
      }
      return { item_id: line.itemId, qty: line.qty.trim() };
    });
    const itemIds = prepared.map((line) => line.item_id);
    if (new Set(itemIds).size !== itemIds.length) {
      errors.lines = 'Each item can only appear once. Combine the quantities.';
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    if (!warehouseId) {
      return;
    }
    setSaving(true);
    setError(null);
    setFieldErrors({});
    const key = idempotencyKey ?? randomUUID();
    setIdempotencyKey(key);
    try {
      const created = await api.createOutboundOrder(
        {
          client_id: orderClientId ?? undefined,
          customer_id: customerId ?? undefined,
          warehouse_id: warehouseId,
          customer_name: customerName.trim(),
          customer_reference: customerReference.trim() || undefined,
          lines: prepared.map((line) => ({
            item_id: line.item_id as string,
            qty: line.qty,
          })),
        },
        key,
      );
      setOrders((current) => [created, ...current]);
      setSelectedId(created.id);
      setNotice(`Order ${created.number} created as a draft.`);
      setComposerOpen(false);
      resetComposer();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The order could not be created.',
      );
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (
    action: 'allocate' | 'ship' | 'cancel',
    order: OutboundOrder,
  ) => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated =
        action === 'allocate'
          ? await api.allocateOutboundOrder(order.id)
          : action === 'ship'
            ? await api.shipOutboundOrder(order.id)
            : await api.cancelOutboundOrder(order.id);
      applyOrder(updated);
      setNotice(
        action === 'allocate'
          ? `Stock reserved for ${updated.number}.`
          : action === 'ship'
            ? `${updated.number} shipped. On-hand stock reduced.`
            : `${updated.number} cancelled. Reservations released.`,
      );
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'The outbound action could not be completed.',
      );
    } finally {
      setSaving(false);
    }
  };

  const pick = async (order: OutboundOrder, allocation: OutboundAllocation) => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.pickOutboundAllocation(order.id, allocation.id);
      applyOrder(updated);
      setNotice(`${allocation.sku} picked from ${allocation.location_code}.`);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The pick could not be recorded.',
      );
    } finally {
      setSaving(false);
    }
  };

  const allPicked =
    selectedOrder !== null &&
    selectedOrder.allocations.length > 0 &&
    selectedOrder.allocations.every((allocation) => allocation.status === 'picked');

  const pickProgress = useMemo(() => {
    if (!selectedOrder) return null;
    return calculateOutboundProgress(selectedOrder);
  }, [selectedOrder]);

  const sortedAllocations = useMemo(() => {
    if (!selectedOrder?.allocations) return [];
    return sortAllocationsByWalkingPath(selectedOrder.allocations, locations);
  }, [selectedOrder?.allocations, locations]);

  const nextUnpickedAllocation = useMemo(() => {
    return sortedAllocations.find((a) => a.status !== 'picked') ?? null;
  }, [sortedAllocations]);

  const handleBarcodeScanned = (scanResult: BarcodeScanningResult) => {
    if (scanThrottle.current) return;
    scanThrottle.current = true;
    setTimeout(() => {
      scanThrottle.current = false;
    }, 1400);

    const scannedData = scanResult.data.trim();
    if (!scannedData) return;

    if (scannerMode === 'pick') {
      if (!selectedOrder) return;
      setScannerError(null);
      const result = matchAllocationForScan(selectedOrder.allocations, items, scannedData);

      if (result.status === 'match' && result.allocation) {
        setScannerMessage(`✓ ${result.message}`);
        void pick(selectedOrder, result.allocation);
      } else if (result.status === 'already_picked') {
        setScannerError(`"${scannedData}" is already fully picked for this order!`);
      } else {
        setScannerError(`Wrong item! "${scannedData}" is not on this order's pick list.`);
      }
    } else if (scannerMode === 'composer') {
      const matchedItem = findItemByScannedCode(items, scannedData);
      if (!matchedItem) {
        setScannerError(`Item "${scannedData}" not found in catalogue.`);
        return;
      }

      setLines((current) => {
        const existingIndex = current.findIndex((l) => l.itemId === matchedItem.id);
        if (existingIndex >= 0) {
          const updated = [...current];
          const currentQty = Number(updated[existingIndex].qty) || 0;
          updated[existingIndex] = {
            ...updated[existingIndex],
            qty: String(currentQty + 1),
          };
          return updated;
        }
        if (current.length === 1 && !current[0].itemId && !current[0].qty) {
          return [{ key: current[0].key, itemId: matchedItem.id, qty: '1' }];
        }
        return [...current, { key: randomUUID(), itemId: matchedItem.id, qty: '1' }];
      });

      setScannerMessage(`✓ Added ${matchedItem.name} (${matchedItem.sku})`);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.centerText}>Loading outbound orders</Text>
      </View>
    );
  }

  return (
    <ScrollView
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
          onRefresh={() => void pullToRefresh()}
          tintColor="#192338"
          colors={['#192338']}
        />
      }
    >
      {/* Top Header: Pure Logo + Back Button + Title + Actions */}
      <View style={styles.topHeader}>
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
            <Text style={styles.greetingTitle}>Dispatch & Outbound</Text>
            <Text style={styles.greetingSubtitle} numberOfLines={1}>
              {orders.length} Orders · Pick, Pack & Dispatch
            </Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh outbound orders"
            onPress={() => void pullToRefresh()}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <MaterialCommunityIcons name="sync" size={19} color="#192338" />
          </Pressable>

          {canIssue ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={composerOpen ? 'Close new order form' : 'New outbound order'}
              onPress={() => {
                setComposerOpen((current) => !current);
                setError(null);
                if (composerOpen) {
                  resetComposer();
                }
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

      {notice ? (
        <View style={styles.noticeBox}>
          <MaterialCommunityIcons name="check-circle-outline" size={20} color={colors.success} />
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBox}>
          <MaterialCommunityIcons name="alert-circle-outline" size={20} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {!canIssue ? (
        <View style={styles.warningBox}>
          <MaterialCommunityIcons name="lock-outline" size={20} color={colors.warning} />
          <Text style={styles.warningText}>
            Your role can review orders but cannot allocate, pick or ship.
          </Text>
        </View>
      ) : null}

      {composerOpen && canIssue ? (
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>New outbound order</Text>
          {isMultiOwner ? (
            <>
              <SelectField
                label="Inventory owner"
                value={orderClientId}
                options={inventoryOwners.map((owner) => ({
                  value: owner.id,
                  label: owner.name,
                  detail: owner.is_internal ? 'Internal stock' : owner.code,
                }))}
                onChange={(value) => {
                  setClientId(value);
                  setLines([newLine()]);
                }}
                placeholder="Select who owns this stock"
                error={fieldErrors.client_id}
              />
              {selectedOwner ? (
                <Text style={styles.ownerHint}>
                  Shipping from {selectedOwner.name} ({selectedOwner.code}) inventory.
                </Text>
              ) : null}
            </>
          ) : null}
          <Field
            label="Customer name"
            value={customerName}
            onChangeText={(text) => {
              setCustomerName(text);
              setCustomerId(null);
            }}
            placeholder="Acme Distribution"
            autoCapitalize="words"
            error={fieldErrors.customer_name}
          />
          {availableCustomers.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.partnerChipRow}>
              {availableCustomers.map((cust) => (
                <Pressable
                  key={cust.id}
                  style={[styles.partnerChip, customerId === cust.id && styles.partnerChipActive]}
                  onPress={() => {
                    setCustomerName(cust.display_name || cust.name);
                    setCustomerId(cust.id);
                  }}
                >
                  <Text style={[styles.partnerChipText, customerId === cust.id && styles.partnerChipTextActive]}>
                    {cust.display_name || cust.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          <Field
            label="Customer reference"
            value={customerReference}
            onChangeText={setCustomerReference}
            placeholder="PO-1042"
            autoCapitalize="characters"
          />
          <SelectField
            label="Warehouse"
            value={warehouseId}
            options={warehouseOptions}
            onChange={setWarehouseId}
            placeholder="Select a warehouse"
            error={fieldErrors.warehouse_id}
            emptyLabel="No warehouses available"
          />

          {/* 1. SCANNER OPTION PLACED FIRST: Primary Bulk / Single Scan */}
          <View style={styles.primaryScanCard}>
            <View style={styles.primaryScanHeader}>
              <View style={styles.primaryScanIconWrap}>
                <MaterialCommunityIcons name="barcode-scan" size={22} color={palette.ink} />
              </View>
              <View style={styles.primaryScanTitleWrap}>
                <Text style={styles.primaryScanTitle}>Scan items</Text>
                <Text style={styles.primaryScanSubtitle}>
                  Continuous scan adds and counts lines.
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open camera scanner to scan products"
              onPress={() => {
                setScannerMessage(null);
                setScannerError(null);
                setScannerMode('composer');
              }}
              style={({ pressed }) => [styles.primaryScanButton, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons name="camera" size={17} color={colors.white} />
              <Text style={styles.primaryScanButtonText}>Start scanner</Text>
            </Pressable>
          </View>

          {/* Fallback / Manual Item Entry */}
          <View style={styles.orDividerRow}>
            <View style={styles.orDividerLine} />
            <Text style={styles.orDividerText}>OR SELECT STOCKED ITEMS MANUALLY</Text>
            <View style={styles.orDividerLine} />
          </View>

          {lines.map((line, index) => {
            const selectedItem = itemOptions.some((option) => option.value === line.itemId)
              ? items.find((item) => item.id === line.itemId)
              : undefined;
            return (
              <View key={line.key} style={styles.lineCard}>
                <View style={styles.lineHeading}>
                  <Text style={styles.lineNumber}>LINE {index + 1}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove line ${index + 1}`}
                    disabled={lines.length === 1}
                    onPress={() => removeLine(line.key)}
                    style={({ pressed }) => [
                      styles.removeLine,
                      lines.length === 1 && styles.removeDisabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    <MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.danger} />
                  </Pressable>
                </View>
                <SelectField
                  label="Stocked Item"
                  value={line.itemId}
                  options={itemOptions}
                  onChange={(value) => updateLine(line.key, { itemId: value })}
                  placeholder="Select a stocked item"
                  error={fieldErrors[`lines.${index}.item_id`]}
                  emptyLabel="No stocked items available in this warehouse"
                />
                <Field
                  label={`Quantity${selectedItem ? ` (${selectedItem.base_uom})` : ''}`}
                  value={line.qty}
                  onChangeText={(value) => updateLine(line.key, { qty: value })}
                  placeholder="0"
                  keyboardType="decimal-pad"
                  error={fieldErrors[`lines.${index}.qty`]}
                />
              </View>
            );
          })}

          {fieldErrors.lines ? <Text style={styles.fieldError}>{fieldErrors.lines}</Text> : null}

          <View style={styles.composerLineActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add order line"
              onPress={() => setLines((current) => [...current, newLine()])}
              style={({ pressed }) => [styles.addLine, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons name="plus-circle-outline" size={19} color={colors.primary} />
              <Text style={styles.addLineText}>Add line</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Scan barcode to add line"
              onPress={() => {
                setScannerMessage(null);
                setScannerError(null);
                setScannerMode('composer');
              }}
              style={({ pressed }) => [styles.scanAddLine, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons name="barcode-scan" size={17} color={colors.primary} />
              <Text style={styles.scanAddLineText}>Scan Barcode</Text>
            </Pressable>
          </View>

          <Button
            label="Create draft order"
            onPress={() => void createOrder()}
            loading={saving}
            disabled={!canIssue}
          />
        </View>
      ) : null}

      <View style={styles.filterRow}>
        {(['all', 'open', 'shipped'] as OrderFilter[]).map((option) => (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === option }}
            onPress={() => setFilter(option)}
            style={({ pressed }) => [
              styles.filterPill,
              filter === option && styles.filterPillActive,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.filterText, filter === option && styles.filterTextActive]}>
              {humanize(option)}
            </Text>
          </Pressable>
        ))}
      </View>

      {visibleOrders.length === 0 ? (
        <EmptyState
          icon="truck-delivery-outline"
          title="No outbound orders"
          message={
            canIssue
              ? 'Create a draft order to reserve, pick and ship stock.'
              : 'Orders created by staff appear here.'
          }
        />
      ) : (
        <View style={styles.orderList}>
          {visibleOrders.map((order) => (
            <Pressable
              key={order.id}
              accessibilityRole="button"
              accessibilityLabel={`Select order ${order.number}`}
              onPress={() => {
                setSelectedId(order.id);
                setError(null);
                setNotice(null);
              }}
              style={({ pressed }) => [
                styles.orderRow,
                selectedId === order.id && styles.orderRowActive,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.orderIcon}>
                <MaterialCommunityIcons
                  name="truck-delivery-outline"
                  size={20}
                  color={colors.deep}
                />
              </View>
              <View style={styles.orderBody}>
                <Text style={styles.orderNumber}>{order.number}</Text>
                <Text style={styles.orderCustomer} numberOfLines={1}>
                  {order.customer_name}
                  {order.customer_reference ? ` · ${order.customer_reference}` : ''}
                </Text>
                <Text style={styles.orderMeta}>
                  {order.lines.length} line{order.lines.length === 1 ? '' : 's'} ·{' '}
                  {formatDateTime(order.created_at)}
                </Text>
              </View>
              <Badge label={humanize(order.status)} tone={statusTone(order.status)} />
            </Pressable>
          ))}
        </View>
      )}

      {selectedOrder ? (
        <View style={styles.detailCard}>
          <View style={styles.detailHeader}>
            <View style={styles.detailTitleBlock}>
              <Text style={styles.detailEyebrow}>SELECTED ORDER</Text>
              <Text style={styles.detailNumber}>{selectedOrder.number}</Text>
              <Text style={styles.detailCustomer}>{selectedOrder.customer_name}</Text>
            </View>
            <Badge
              label={humanize(selectedOrder.status)}
              tone={statusTone(selectedOrder.status)}
            />
          </View>

          <View style={styles.detailMetaRow}>
            <View style={styles.detailMeta}>
              <Text style={styles.detailMetaLabel}>REFERENCE</Text>
              <Text style={styles.detailMetaValue}>
                {selectedOrder.customer_reference ?? 'None'}
              </Text>
            </View>
            <View style={styles.detailMeta}>
              <Text style={styles.detailMetaLabel}>UNITS</Text>
              <Text style={styles.detailMetaValue}>
                {formatQty(
                  String(
                    selectedOrder.lines.reduce(
                      (total, line) => total + Number(line.base_qty),
                      0,
                    ),
                  ),
                )}
              </Text>
            </View>
          </View>

          <View style={styles.sectionBlock}>
            <Text style={styles.sectionLabel}>ORDER LINES</Text>
            {selectedOrder.lines.map((line) => (
              <View key={line.id} style={styles.lineRow}>
                <View style={styles.lineRowBody}>
                  <Text style={styles.lineRowTitle}>{line.item_name}</Text>
                  <Text style={styles.lineRowMeta}>{line.sku}</Text>
                </View>
                <Text style={styles.lineRowQty}>
                  {formatQty(line.base_qty)} {line.base_uom}
                </Text>
              </View>
            ))}
          </View>

          {selectedOrder.allocations.length > 0 ? (
            <View style={styles.sectionBlock}>
              <View style={styles.pickSectionHeader}>
                <Text style={styles.sectionLabel}>PICK LIST (WALKING PATH ORDER)</Text>
                {pickProgress ? (
                  <Text style={styles.pickSectionProgressText}>
                    {pickProgress.pickedAllocations}/{pickProgress.totalAllocations} picked ({pickProgress.percent}%)
                  </Text>
                ) : null}
              </View>

              {/* Progress bar */}
              {pickProgress && selectedOrder.status === 'allocated' ? (
                <View style={styles.pickProgressBarBg}>
                  <View
                    style={[
                      styles.pickProgressBarFill,
                      { width: `${pickProgress.percent}%` },
                      pickProgress.isComplete && styles.pickProgressBarComplete,
                    ]}
                  />
                </View>
              ) : null}

              {/* Dedicated Scan-to-Pick Launcher Button */}
              {canIssue && selectedOrder.status === 'allocated' && !allPicked ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open Scan-to-Pick scanner"
                  onPress={() => {
                    setScannerMessage(null);
                    setScannerError(null);
                    setScannerMode('pick');
                  }}
                  style={({ pressed }) => [styles.scanPickActionBtn, pressed && styles.pressed]}
                >
                  <View style={styles.scanPickActionIcon}>
                    <MaterialCommunityIcons name="barcode-scan" size={20} color={colors.white} />
                  </View>
                  <View style={styles.scanPickActionTextWrap}>
                    <Text style={styles.scanPickActionTitle}>Open Scan-to-Pick Scanner</Text>
                    <Text style={styles.scanPickActionSubtitle}>
                      {nextUnpickedAllocation
                        ? `Next: ${nextUnpickedAllocation.sku} at ${formatAllocationCoordinates(nextUnpickedAllocation, locations)}`
                        : 'Scan item barcodes to pick continuously'}
                    </Text>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={22} color={colors.white} />
                </Pressable>
              ) : null}

              {sortedAllocations.map((allocation) => {
                const isPicked = allocation.status === 'picked';
                const coords = formatAllocationCoordinates(allocation, locations);
                return (
                  <View
                    key={allocation.id}
                    style={[styles.pickRow, isPicked && styles.pickRowCompleted]}
                  >
                    <View style={styles.pickBody}>
                      <View style={styles.pickTitleRow}>
                        <Text style={[styles.pickTitle, isPicked && styles.pickTitleCompleted]}>
                          {allocation.sku}
                        </Text>
                        <Text style={styles.pickItemName}>{allocation.item_name}</Text>
                      </View>
                      <Text style={styles.pickLocationMeta}>📍 {coords}</Text>
                      <Text style={styles.pickMeta}>
                        Qty: {formatQty(allocation.base_qty)} {allocation.base_uom}
                        {allocation.lot_no ? ` · Lot ${allocation.lot_no}` : ''}
                        {allocation.serial_no ? ` · SN ${allocation.serial_no}` : ''}
                      </Text>
                      {allocation.expiry_date ? (
                        <Text style={styles.pickMeta}>Expires {allocation.expiry_date}</Text>
                      ) : null}
                    </View>
                    {isPicked ? (
                      <Badge label="Picked" tone="success" />
                    ) : canIssue && selectedOrder.status === 'allocated' ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Pick ${allocation.sku} from ${allocation.location_code}`}
                        disabled={saving}
                        onPress={() => void pick(selectedOrder, allocation)}
                        style={({ pressed }) => [
                          styles.pickButton,
                          saving && styles.disabled,
                          pressed && styles.pressed,
                        ]}
                      >
                        <MaterialCommunityIcons name="check" size={14} color={colors.white} />
                        <Text style={styles.pickButtonText}>Pick</Text>
                      </Pressable>
                    ) : (
                      <Badge label="Reserved" tone="warning" />
                    )}
                  </View>
                );
              })}
            </View>
          ) : null}

          {canIssue && selectedOrder.status === 'draft' ? (
            <Button
              label="Allocate stock (FEFO)"
              onPress={() => void runAction('allocate', selectedOrder)}
              loading={saving}
            />
          ) : null}

          {canIssue && selectedOrder.status === 'allocated' ? (
            <View style={styles.actionRow}>
              <Button
                label={allPicked ? 'Ship order' : 'Pick all lines first'}
                onPress={() => void runAction('ship', selectedOrder)}
                loading={saving}
                disabled={!allPicked}
                style={styles.actionButton}
              />
              <Button
                label="Cancel"
                variant="danger"
                onPress={() => void runAction('cancel', selectedOrder)}
                disabled={saving}
                style={styles.actionButton}
              />
            </View>
          ) : null}

          {canIssue && selectedOrder.status === 'draft' ? (
            <Button
              label="Cancel order"
              variant="danger"
              onPress={() => void runAction('cancel', selectedOrder)}
              disabled={saving}
            />
          ) : null}
        </View>
      ) : null}

      <View style={styles.noteBox}>
        <MaterialCommunityIcons name="shield-check-outline" size={21} color={colors.deep} />
        <Text style={styles.noteText}>
          Shipping is atomic: stock leaves on hand, reservations are cleared, and serials
          move to shipped in one transaction.
        </Text>
      </View>

      {/* Dedicated Outbound Scanner Modal (Scan-to-Pick or Composer Add) */}
      <Modal
        visible={scannerMode !== null}
        animationType="fade"
        transparent
        onRequestClose={() => setScannerMode(null)}
      >
        <View style={styles.scannerModalOverlay}>
          <View style={styles.scannerContainer}>
            <View style={styles.scannerHeader}>
              <View style={styles.scannerHeaderTitleWrap}>
                <Text style={styles.scannerTitle}>
                  {scannerMode === 'pick' ? 'Scan to Pick Item' : 'Scan Item Barcode'}
                </Text>
                <Text style={styles.scannerSubtitle}>
                  {scannerMode === 'pick'
                    ? `Order ${selectedOrder?.number ?? ''} · Align item or serial barcode`
                    : 'Scan item barcode to add directly to order'}
                </Text>
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
                  onPress={() => setScannerMode(null)}
                  style={styles.closeScannerButton}
                >
                  <MaterialCommunityIcons name="close" size={22} color={colors.white} />
                </Pressable>
              </View>
            </View>

            {/* In pick mode, display next target item chip */}
            {scannerMode === 'pick' && nextUnpickedAllocation ? (
              <View style={styles.scannerTargetCard}>
                <Text style={styles.scannerTargetEyebrow}>NEXT TARGET ITEM (WALKING PATH)</Text>
                <View style={styles.scannerTargetRow}>
                  <View style={styles.scannerTargetInfo}>
                    <Text style={styles.scannerTargetSku}>{nextUnpickedAllocation.sku}</Text>
                    <Text style={styles.scannerTargetLocation}>
                      📍 {formatAllocationCoordinates(nextUnpickedAllocation, locations)}
                    </Text>
                    {nextUnpickedAllocation.lot_no ? (
                      <Text style={styles.scannerTargetDetail}>Lot: {nextUnpickedAllocation.lot_no}</Text>
                    ) : null}
                    {nextUnpickedAllocation.serial_no ? (
                      <Text style={styles.scannerTargetDetail}>SN: {nextUnpickedAllocation.serial_no}</Text>
                    ) : null}
                  </View>
                  <View style={styles.scannerTargetQtyBadge}>
                    <Text style={styles.scannerTargetQtyNum}>{formatQty(nextUnpickedAllocation.base_qty)}</Text>
                    <Text style={styles.scannerTargetQtyUom}>{nextUnpickedAllocation.base_uom}</Text>
                  </View>
                </View>
              </View>
            ) : null}

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
              </View>
            ) : (
              <View style={styles.scannerPermissionBox}>
                <MaterialCommunityIcons name="camera-off" size={40} color={colors.muted} />
                <Text style={styles.scannerPermissionTitle}>Camera access required</Text>
                <Text style={styles.scannerPermissionText}>
                  Allow camera permission to scan item and package barcodes.
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
                  {scannerMode === 'pick'
                    ? `Pick Progress: ${pickProgress?.pickedAllocations ?? 0} of ${pickProgress?.totalAllocations ?? 0} lines completed`
                    : 'Center item barcode in the frame'}
                </Text>
              )}
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: '#EFF3F8',
  },
  centerText: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 12.5,
    color: palette.muted,
  },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(233,247,240,0.9)',
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  noticeText: {
    flex: 1,
    fontFamily: fonts.dmSansMedium,
    fontSize: 11.5,
    lineHeight: 17,
    color: colors.success,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(253,236,234,0.85)',
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  errorText: {
    flex: 1,
    fontFamily: fonts.dmSansRegular,
    fontSize: 11.5,
    lineHeight: 17,
    color: colors.danger,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(255,249,235,0.92)',
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  warningText: {
    flex: 1,
    fontFamily: fonts.dmSansRegular,
    fontSize: 11.5,
    lineHeight: 17,
    color: colors.warning,
  },
  formCard: {
    backgroundColor: palette.glass,
    borderRadius: radius.xl,
    borderWidth: 1.1,
    borderColor: palette.glassBorder,
    padding: spacing.lg,
    gap: spacing.md,
    ...neo.raised,
  },
  formTitle: {
    fontFamily: fonts.outfitBold,
    fontSize: 17,
    color: palette.ink,
  },
  lineCard: {
    backgroundColor: 'rgba(255,255,255,0.62)',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.glassBorder,
    padding: spacing.md,
    gap: spacing.md,
  },
  lineHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lineNumber: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 8.5,
    letterSpacing: 1.2,
    color: palette.muted,
  },
  removeLine: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: 'rgba(253,236,234,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeDisabled: {
    opacity: 0.4,
  },
  fieldError: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 11.5,
    color: colors.danger,
  },
  addLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  addLineText: {
    fontFamily: fonts.dmSansBold,
    fontSize: 12.5,
    color: palette.blue,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    backgroundColor: 'rgba(226,234,244,0.7)',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  filterPill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: radius.pill,
  },
  filterPillActive: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.glassBorder,
    ...neo.soft,
  },
  filterText: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 11.5,
    color: palette.muted,
  },
  filterTextActive: {
    fontFamily: fonts.dmSansBold,
    color: palette.ink,
  },
  orderList: {
    gap: spacing.sm,
  },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: palette.glass,
    borderRadius: radius.xl,
    borderWidth: 1.1,
    borderColor: palette.glassBorder,
    padding: spacing.lg,
    ...neo.soft,
  },
  orderRowActive: {
    borderColor: 'rgba(25,35,56,0.32)',
    backgroundColor: 'rgba(255,255,255,0.86)',
  },
  orderIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(234,241,252,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderBody: {
    flex: 1,
    gap: 1,
  },
  orderNumber: {
    fontFamily: fonts.outfitBold,
    fontSize: 14,
    color: palette.ink,
  },
  orderCustomer: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 11,
    color: palette.muted,
  },
  orderMeta: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 9.5,
    color: palette.muted,
  },
  detailCard: {
    backgroundColor: palette.glass,
    borderRadius: radius.xxl,
    borderWidth: 1.2,
    borderColor: palette.glassBorder,
    padding: spacing.lg,
    gap: spacing.md,
    ...neo.raised,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  detailTitleBlock: {
    flex: 1,
    gap: 1,
  },
  detailEyebrow: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 8.5,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: palette.muted,
  },
  detailNumber: {
    fontFamily: fonts.outfitBold,
    fontSize: 22,
    color: palette.ink,
  },
  detailCustomer: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 11.5,
    color: palette.muted,
  },
  detailMetaRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  detailMeta: {
    flex: 1,
    backgroundColor: 'rgba(246,249,253,0.9)',
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 2,
  },
  detailMetaLabel: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 8,
    letterSpacing: 0.9,
    color: palette.muted,
  },
  detailMetaValue: {
    fontFamily: fonts.outfitBold,
    fontSize: 13.5,
    color: palette.ink,
  },
  sectionBlock: {
    gap: spacing.sm,
  },
  sectionLabel: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 8.5,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: palette.muted,
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: palette.line,
    paddingTop: spacing.sm,
  },
  lineRowBody: {
    flex: 1,
    gap: 1,
  },
  lineRowTitle: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 12.5,
    color: palette.ink,
  },
  lineRowMeta: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 10,
    color: palette.muted,
  },
  lineRowQty: {
    fontFamily: fonts.dmSansBold,
    fontSize: 12,
    color: palette.ink,
  },
  primaryScanCard: {
    backgroundColor: palette.ink,
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: 1.2,
    borderColor: 'rgba(255,255,255,0.16)',
    gap: spacing.md,
    ...neo.raised,
  },
  primaryScanHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  primaryScanIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: palette.gold,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1.3,
    borderTopColor: 'rgba(255,255,255,0.6)',
  },
  primaryScanTitleWrap: {
    flex: 1,
  },
  primaryScanTitle: {
    fontFamily: fonts.outfitBold,
    fontSize: 14,
    color: palette.white,
  },
  primaryScanSubtitle: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 10.5,
    color: 'rgba(255,255,255,0.56)',
    marginTop: 1,
  },
  primaryScanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: palette.gold,
    paddingVertical: 10,
    borderRadius: radius.pill,
    borderTopWidth: 1.3,
    borderTopColor: 'rgba(255,255,255,0.6)',
  },
  primaryScanButtonText: {
    fontFamily: fonts.outfitBold,
    fontSize: 12.5,
    color: palette.ink,
  },
  orDividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginVertical: 4,
  },
  orDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: palette.line,
  },
  orDividerText: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 8.5,
    letterSpacing: 1,
    color: palette.muted,
  },
  composerLineActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  scanAddLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.glassBorder,
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  scanAddLineText: {
    fontFamily: fonts.dmSansBold,
    fontSize: 11.5,
    color: palette.ink,
  },
  pickSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickSectionProgressText: {
    fontFamily: fonts.dmSansBold,
    fontSize: 10.5,
    color: palette.blue,
  },
  pickProgressBarBg: {
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(226,234,244,0.9)',
    overflow: 'hidden',
    marginTop: -2,
  },
  pickProgressBarFill: {
    height: '100%',
    backgroundColor: palette.gold,
    borderRadius: radius.pill,
  },
  pickProgressBarComplete: {
    backgroundColor: colors.success,
  },
  scanPickActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.ink,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.2,
    borderColor: 'rgba(255,255,255,0.16)',
    gap: spacing.sm,
    ...neo.raised,
  },
  scanPickActionIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: palette.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanPickActionTextWrap: {
    flex: 1,
  },
  scanPickActionTitle: {
    fontFamily: fonts.outfitBold,
    fontSize: 14,
    color: palette.white,
  },
  scanPickActionSubtitle: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 10.5,
    color: 'rgba(255,255,255,0.58)',
    marginTop: 1,
  },
  pickRowCompleted: {
    backgroundColor: 'rgba(233,247,240,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(31,122,92,0.18)',
  },
  pickTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  pickTitleCompleted: {
    color: colors.success,
  },
  pickItemName: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 11,
    color: palette.muted,
  },
  pickLocationMeta: {
    fontFamily: fonts.dmSansBold,
    fontSize: 10.5,
    color: palette.blue,
    marginTop: 2,
  },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.62)',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.glassBorder,
    padding: spacing.md,
  },
  pickBody: {
    flex: 1,
    gap: 1,
  },
  pickTitle: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 12.5,
    color: palette.ink,
  },
  pickMeta: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 10.5,
    color: palette.muted,
  },
  pickButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: palette.ink,
  },
  pickButtonText: {
    fontFamily: fonts.dmSansBold,
    fontSize: 11.5,
    color: palette.white,
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
  },
  scannerTitle: {
    fontFamily: fonts.outfitBold,
    fontSize: 15,
    color: palette.white,
  },
  scannerSubtitle: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 10.5,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 2,
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
  scannerTargetCard: {
    backgroundColor: '#1E293B',
    marginHorizontal: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 4,
  },
  scannerTargetEyebrow: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 8.5,
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.5)',
  },
  scannerTargetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scannerTargetInfo: {
    flex: 1,
    gap: 1,
  },
  scannerTargetSku: {
    fontFamily: fonts.outfitBold,
    fontSize: 14,
    color: palette.white,
  },
  scannerTargetLocation: {
    fontFamily: fonts.dmSansBold,
    fontSize: 10.5,
    color: palette.gold,
  },
  scannerTargetDetail: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
  },
  scannerTargetQtyBadge: {
    backgroundColor: '#334155',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  scannerTargetQtyNum: {
    fontFamily: fonts.outfitBold,
    fontSize: 14,
    color: palette.white,
  },
  scannerTargetQtyUom: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
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
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
  disabled: {
    opacity: 0.5,
  },
  noteBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: 'rgba(234,241,252,0.9)',
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: 'flex-start',
  },
  noteText: {
    flex: 1,
    fontFamily: fonts.dmSansRegular,
    fontSize: 10.5,
    lineHeight: 16,
    color: palette.ink,
  },
  ownerHint: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 11,
    color: palette.muted,
    marginTop: -spacing.xs,
    marginBottom: spacing.xs,
  },
  partnerChipRow: {
    gap: 6,
    paddingVertical: 2,
    marginBottom: spacing.xs,
  },
  partnerChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.62)',
    borderWidth: 1,
    borderColor: palette.glassBorder,
  },
  partnerChipActive: {
    backgroundColor: palette.ink,
    borderColor: palette.ink,
  },
  partnerChipText: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 11,
    color: palette.ink,
  },
  partnerChipTextActive: {
    fontFamily: fonts.dmSansBold,
    color: palette.white,
  },
});
