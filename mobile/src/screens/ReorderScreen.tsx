import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { formatQty } from '../format';
import { getReceiveDraft, setReceiveDraft } from '../receiveDraftStore';
import { belowMinimumOrder } from '../receiving';
import { buildPurchaseOrderLines } from '../purchasing';
import { buildReorderDraftLines, reorderRowKey } from '../reorder';
import { suggestSupplierIdForRows } from '../supplierMapping';
import { colors, fonts, neo, palette, radius, spacing } from '../theme';
import { isIsoDate } from '../tracking';
import type {
  PurchaseOrder,
  ReorderNeedRow,
  ReorderSupplierOption,
  ReorderUrgency,
} from '../types';

interface ReorderScreenProps {
  onBack: () => void;
  onOpenReceive: () => void;
  onOpenPurchaseOrders: () => void;
  canReceive: boolean;
  canManagePurchasing: boolean;
}

type StatusFilter = 'all' | ReorderUrgency;

const urgencyTone: Record<ReorderUrgency, 'danger' | 'warning' | 'info'> = {
  stockout: 'danger',
  critical: 'warning',
  low: 'info',
};

const urgencyLabel: Record<ReorderUrgency, string> = {
  stockout: 'Stockout',
  critical: 'Critical',
  low: 'Low',
};

function asNumber(value: string | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function ReorderScreen({
  onBack,
  onOpenReceive,
  onOpenPurchaseOrders,
  canReceive,
  canManagePurchasing,
}: ReorderScreenProps) {
  const insets = useSafeAreaInsets();
  const {
    activeClientId,
    warehouses,
    clients,
    refresh: refreshWorkspace,
  } = useWorkspace();
  const { state: authState } = useAuth();
  const canReadCost =
    authState.status === 'signedIn'
      ? authState.session.permissions.includes('cost.read')
      : false;
  const [rows, setRows] = useState<ReorderNeedRow[]>([]);
  const [assumptions, setAssumptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState<'all' | string>('all');
  const [supplierFilter, setSupplierFilter] = useState<'all' | string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [poWarehouseId, setPoWarehouseId] = useState<string | null>(null);
  const [expectedDate, setExpectedDate] = useState('');
  const [poNote, setPoNote] = useState('');
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [poError, setPoError] = useState<string | null>(null);
  const [createdOrder, setCreatedOrder] = useState<PurchaseOrder | null>(null);

  const availableSuppliers = useMemo(
    () =>
      clients.filter(
        (client) => client.status !== 'archived' && client.types?.includes('supplier'),
      ),
    [clients],
  );

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'initial') {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);
      try {
        const response = await api.reorderNeeded({
          clientId: activeClientId,
          warehouseId: warehouseFilter === 'all' ? null : warehouseFilter,
          supplierId: supplierFilter === 'all' ? null : supplierFilter,
        });
        setRows(response.rows);
        setAssumptions(response.assumptions);
        setQuantities((previous) => {
          const next: Record<string, string> = {};
          for (const row of response.rows) {
            const key = reorderRowKey(row);
            next[key] = previous[key] ?? formatQty(row.suggested_qty);
          }
          return next;
        });
        setSelected((previous) => {
          const keys = new Set(response.rows.map(reorderRowKey));
          return new Set(Array.from(previous).filter((key) => keys.has(key)));
        });
      } catch (caught) {
        setError(
          caught instanceof ApiError
            ? caught.message
            : 'Could not load reorder suggestions. Check your connection and try again.',
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [activeClientId, warehouseFilter, supplierFilter],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (warehouseFilter !== 'all' && row.warehouse_id !== warehouseFilter) {
        return false;
      }
      if (statusFilter !== 'all' && row.urgency !== statusFilter) {
        return false;
      }
      if (query) {
        const supplierText = (row.supplier_options ?? [])
          .map((option) => `${option.supplier_name} ${option.supplier_sku ?? ''}`)
          .join(' ');
        const haystack =
          `${row.item_name} ${row.sku} ${row.warehouse_name ?? ''} ${
            row.preferred_supplier_name ?? ''
          } ${supplierText}`.toLowerCase();
        if (!haystack.includes(query)) {
          return false;
        }
      }
      return true;
    });
  }, [rows, search, statusFilter, warehouseFilter]);

  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(reorderRowKey(row))),
    [rows, selected],
  );

  // Supplier choices for the order dialog: approved mappings first (preferred
  // first), then any other active supplier for a legitimate one-off purchase.
  const purchaseSupplierOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: Array<{ id: string; name: string; detail?: string }> = [];
    for (const row of selectedRows) {
      for (const option of row.supplier_options ?? []) {
        if (seen.has(option.supplier_id)) {
          continue;
        }
        seen.add(option.supplier_id);
        const extras = [
          option.is_preferred ? 'Preferred for this item' : 'Mapped item supplier',
          option.supplier_sku ? `SKU ${option.supplier_sku}` : null,
          option.lead_time_days != null ? `${option.lead_time_days}d lead` : null,
        ].filter(Boolean);
        options.push({
          id: option.supplier_id,
          name: option.supplier_name,
          detail: extras.join(' · '),
        });
      }
    }
    for (const supplier of availableSuppliers) {
      if (seen.has(supplier.id)) {
        continue;
      }
      seen.add(supplier.id);
      options.push({
        id: supplier.id,
        name: supplier.display_name || supplier.name,
        detail: supplier.code ?? undefined,
      });
    }
    return options;
  }, [selectedRows, availableSuppliers]);

  const supplierMoqWarnings = useMemo(() => {
    if (!supplierId) {
      return [] as string[];
    }
    return selectedRows.flatMap((row) => {
      const option = (row.supplier_options ?? []).find(
        (entry) => entry.supplier_id === supplierId,
      );
      if (!option?.min_order_qty) {
        return [];
      }
      const qty = asNumber(quantities[reorderRowKey(row)] ?? row.suggested_qty);
      if (!belowMinimumOrder(option.min_order_qty, qty)) {
        return [];
      }
      return [`${row.item_name}: ${formatQty(String(qty))} ${row.base_uom} is below the supplier MOQ of ${formatQty(option.min_order_qty)}.`];
    });
  }, [supplierId, selectedRows, quantities]);

  const selectedUnits = useMemo(
    () =>
      selectedRows.reduce((total, row) => {
        const key = reorderRowKey(row);
        return total + asNumber(quantities[key] ?? row.suggested_qty);
      }, 0),
    [quantities, selectedRows],
  );

  const totalSuggested = useMemo(
    () => filteredRows.reduce((total, row) => total + asNumber(row.suggested_qty), 0),
    [filteredRows],
  );

  const selectedWarehouses = useMemo(
    () =>
      new Set(
        selectedRows
          .map((row) => row.warehouse_id)
          .filter((warehouseId): warehouseId is string => Boolean(warehouseId)),
      ),
    [selectedRows],
  );

  const allFilteredSelected =
    filteredRows.length > 0 &&
    filteredRows.every((row) => selected.has(reorderRowKey(row)));

  const toggleRow = (row: ReorderNeedRow) => {
    const key = reorderRowKey(row);
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(
      allFilteredSelected ? new Set() : new Set(filteredRows.map((row) => reorderRowKey(row))),
    );
  };

  const updateQuantity = (row: ReorderNeedRow, value: string) => {
    const cleaned = value.replace(/[^0-9.]/g, '');
    setQuantities((previous) => ({ ...previous, [reorderRowKey(row)]: cleaned }));
  };

  const resetQuantity = (row: ReorderNeedRow) => {
    setQuantities((previous) => ({
      ...previous,
      [reorderRowKey(row)]: formatQty(row.suggested_qty),
    }));
  };

  const openPurchaseStep = () => {
    if (selectedRows.length === 0) {
      return;
    }
    const invalid = selectedRows.filter((row) => {
      const key = reorderRowKey(row);
      return asNumber(quantities[key] ?? row.suggested_qty) <= 0;
    });
    if (invalid.length > 0) {
      Alert.alert(
        'Quantity required',
        'Every selected item needs a quantity greater than zero before continuing.',
      );
      return;
    }
    setCreatedOrder(null);
    setPoError(null);
    setSupplierId(suggestSupplierIdForRows(selectedRows, availableSuppliers));
    setPoWarehouseId(
      selectedWarehouses.size === 1 ? Array.from(selectedWarehouses)[0] : null,
    );
    setExpectedDate('');
    setPoNote('');
    setShowPurchaseModal(true);
  };

  const submitPurchaseOrder = async () => {
    const orderLines = buildPurchaseOrderLines(selectedRows, quantities, reorderRowKey);
    if (orderLines.length === 0) {
      setPoError('Enter a quantity greater than zero for at least one item.');
      return;
    }
    if (selectedWarehouses.size !== 1) {
      setPoError(
        'A purchase order is created for one warehouse. Filter by warehouse to narrow the selection.',
      );
      return;
    }
    if (!poWarehouseId) {
      setPoError('Select the destination warehouse.');
      return;
    }
    if (!supplierId) {
      setPoError('Select the supplier for this purchase order.');
      return;
    }
    const selectedClients = new Set(
      selectedRows
        .map((row) => row.client_id)
        .filter((value): value is string => Boolean(value)),
    );
    if (selectedClients.size > 1) {
      setPoError(
        'A purchase order belongs to one inventory owner. Filter by owner before creating the order.',
      );
      return;
    }
    const orderClientId =
      activeClientId ?? (selectedClients.size === 1 ? Array.from(selectedClients)[0] : undefined);
    if (expectedDate.trim() && !isIsoDate(expectedDate.trim())) {
      setPoError('Enter the expected delivery date as YYYY-MM-DD.');
      return;
    }
    setCreatingOrder(true);
    setPoError(null);
    try {
      const order = await api.createPurchaseOrder(
        {
          client_id: orderClientId,
          supplier_id: supplierId,
          warehouse_id: poWarehouseId,
          expected_date: expectedDate.trim() || undefined,
          note: poNote.trim() || undefined,
          lines: orderLines,
        },
        randomUUID(),
      );
      setCreatedOrder(order);
      setSelected(new Set());
      await load('refresh');
      await refreshWorkspace();
    } catch (caught) {
      setPoError(
        caught instanceof ApiError
          ? caught.message
          : 'The purchase order could not be created. Please try again.',
      );
    } finally {
      setCreatingOrder(false);
    }
  };

  const applyReceiptPrefill = (lines: ReturnType<typeof buildReorderDraftLines>) => {
    const clients = new Set(
      selectedRows
        .map((row) => row.client_id)
        .filter((clientId): clientId is string => Boolean(clientId)),
    );
    const preferredSuppliers = new Set(
      selectedRows
        .map((row) => row.preferred_supplier_id)
        .filter((value): value is string => Boolean(value)),
    );
    const prefillSupplierId =
      preferredSuppliers.size === 1 ? Array.from(preferredSuppliers)[0] : null;
    const prefillSupplierRecord = prefillSupplierId
      ? availableSuppliers.find((supplier) => supplier.id === prefillSupplierId)
      : undefined;
    setReceiveDraft({
      lines,
      clientId: clients.size === 1 ? Array.from(clients)[0] : activeClientId,
      warehouseId:
        selectedWarehouses.size === 1 ? Array.from(selectedWarehouses)[0] : null,
      locationId: null,
      supplier: prefillSupplierRecord
        ? prefillSupplierRecord.display_name || prefillSupplierRecord.name
        : '',
      supplierId: prefillSupplierId,
      purchaseOrder: '',
      purchaseOrderId: null,
      purchaseOrderNumber: '',
      purchaseOrderLines: [],
      note: 'Replenishment from Reorder Needed',
      deliveryNote: '',
      pendingReceipt: null,
      pendingKey: null,
    });
    setShowPurchaseModal(false);
    void refreshWorkspace();
    onOpenReceive();
  };

  const receiveSelected = () => {
    if (!canReceive) {
      return;
    }
    if (selectedWarehouses.size !== 1) {
      Alert.alert(
        'One warehouse at a time',
        'Selected items span more than one warehouse, or have no warehouse yet. Filter to a single warehouse before receiving stock.',
      );
      return;
    }
    const invalid = selectedRows.filter((row) => {
      const key = reorderRowKey(row);
      return asNumber(quantities[key] ?? row.suggested_qty) <= 0;
    });
    if (invalid.length > 0) {
      Alert.alert(
        'Quantity required',
        'Every selected item needs a quantity greater than zero before continuing.',
      );
      return;
    }
    const lines = buildReorderDraftLines(selectedRows, quantities, () => randomUUID());
    if (lines.length === 0) {
      Alert.alert('Nothing to receive', 'Enter a quantity greater than zero for at least one item.');
      return;
    }
    const existing = getReceiveDraft();
    const hasDraftContent =
      Boolean(existing?.pendingReceipt) ||
      Boolean(existing?.lines.some((line) => line.itemId || line.qty));
    if (hasDraftContent) {
      Alert.alert(
        'Replace the current receive form?',
        'Your in-progress receipt draft will be replaced by the selected reorder quantities.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Replace and continue',
            style: 'destructive',
            onPress: () => applyReceiptPrefill(lines),
          },
        ],
      );
      return;
    }
    applyReceiptPrefill(lines);
  };

  return (
    <View style={[styles.screen, { paddingTop: Math.max(insets.top + 12, 22) }]}>
      {/* Brand Header */}
      <View style={styles.brandRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={onBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color="#192338" />
        </Pressable>
        <Image
          source={require('../../assets/ntan-hexagon-logo.png')}
          style={styles.logoImage}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
        <View style={styles.greetingBox}>
          <Text style={styles.greetingTitle}>Reorder & Replenish</Text>
          <Text style={styles.greetingSubtitle} numberOfLines={1}>
            {rows.length} Items Below Reorder Point
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Purchase Orders"
          onPress={onOpenPurchaseOrders}
          style={({ pressed }) => [styles.reorderBtn, pressed && styles.pressed]}
        >
          <MaterialCommunityIcons name="clipboard-text-clock-outline" size={20} color="#192338" />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load('refresh')}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >

        <View style={styles.metrics}>
          <View style={[styles.metric, styles.metricPrimary]}>
            <Text style={styles.metricLabelLight}>BELOW POINT</Text>
            <Text style={styles.metricValueLight}>{rows.length}</Text>
            <Text style={styles.metricHintLight}>Visible warehouses</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>SUGGESTED</Text>
            <Text style={styles.metricValue}>{formatQty(String(totalSuggested))}</Text>
            <Text style={styles.metricHint}>{filteredRows.length} matching</Text>
          </View>
        </View>

        <View style={styles.noticeCard}>
          <MaterialCommunityIcons name="information-outline" size={18} color={palette.blue} />
          <Text style={styles.noticeText}>
            Suggestions are read-only. Stock only changes when a receipt is posted.
          </Text>
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <MaterialCommunityIcons name="cloud-alert-outline" size={20} color={colors.danger} />
            <View style={styles.errorTextWrap}>
              <Text style={styles.errorTitle}>Could not load reorder list</Text>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable onPress={() => void load()} accessibilityRole="button">
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={styles.searchBox}>
          <MaterialCommunityIcons name="magnify" size={21} color={colors.muted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search item, SKU or warehouse"
            placeholderTextColor={colors.muted}
            style={styles.searchInput}
            autoCapitalize="none"
          />
          {search ? (
            <Pressable onPress={() => setSearch('')} accessibilityLabel="Clear search">
              <MaterialCommunityIcons name="close-circle" size={19} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.filterBlock}>
          <Text style={styles.filterLabel}>STATUS</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chipRow}>
              {(['all', 'stockout', 'critical', 'low'] as StatusFilter[]).map((status) => (
                <Pressable
                  key={status}
                  accessibilityRole="button"
                  accessibilityState={{ selected: statusFilter === status }}
                  onPress={() => setStatusFilter(status)}
                  style={[styles.chip, statusFilter === status && styles.chipActive]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      statusFilter === status && styles.chipTextActive,
                    ]}
                  >
                    {status === 'all' ? 'All' : urgencyLabel[status]}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
          <Text style={styles.filterLabel}>WAREHOUSE</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chipRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: warehouseFilter === 'all' }}
                onPress={() => setWarehouseFilter('all')}
                style={[styles.chip, warehouseFilter === 'all' && styles.chipActive]}
              >
                <Text
                  style={[styles.chipText, warehouseFilter === 'all' && styles.chipTextActive]}
                >
                  All warehouses
                </Text>
              </Pressable>
              {warehouses.map((warehouse) => (
                <Pressable
                  key={warehouse.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: warehouseFilter === warehouse.id }}
                  onPress={() => setWarehouseFilter(warehouse.id)}
                  style={[styles.chip, warehouseFilter === warehouse.id && styles.chipActive]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      warehouseFilter === warehouse.id && styles.chipTextActive,
                    ]}
                  >
                    {warehouse.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
          <Text style={styles.filterLabel}>SUPPLIER</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chipRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: supplierFilter === 'all' }}
                onPress={() => setSupplierFilter('all')}
                style={[styles.chip, supplierFilter === 'all' && styles.chipActive]}
              >
                <Text
                  style={[styles.chipText, supplierFilter === 'all' && styles.chipTextActive]}
                >
                  All suppliers
                </Text>
              </Pressable>
              {availableSuppliers.map((supplier) => (
                <Pressable
                  key={supplier.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: supplierFilter === supplier.id }}
                  onPress={() => setSupplierFilter(supplier.id)}
                  style={[styles.chip, supplierFilter === supplier.id && styles.chipActive]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      supplierFilter === supplier.id && styles.chipTextActive,
                    ]}
                  >
                    {supplier.display_name || supplier.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>

        <View style={styles.selectRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={allFilteredSelected ? 'Clear selection' : 'Select all visible'}
            onPress={toggleAll}
            style={styles.selectAllButton}
          >
            <View style={[styles.checkbox, allFilteredSelected && styles.checkboxOn]}>
              {allFilteredSelected ? (
                <MaterialCommunityIcons name="check" size={13} color={colors.white} />
              ) : null}
            </View>
            <Text style={styles.selectAllText}>
              {allFilteredSelected ? 'Clear selection' : 'Select all visible'}
            </Text>
          </Pressable>
          <Text style={styles.selectedCount}>
            {selectedRows.length} selected
            {selectedRows.length > 0 ? ` · ${formatQty(String(selectedUnits))} units` : ''}
          </Text>
        </View>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Calculating replenishment needs…</Text>
          </View>
        ) : filteredRows.length === 0 ? (
          <EmptyState
            icon={rows.length === 0 ? 'check-decagram-outline' : 'filter-off-outline'}
            title={rows.length === 0 ? 'Nothing to reorder' : 'No matching items'}
            message={
              rows.length === 0
                ? 'Every tracked item is above its threshold.'
                : 'Adjust the search or filters.'
            }
          />
        ) : (
          <View style={styles.list}>
            {filteredRows.map((row) => {
              const key = reorderRowKey(row);
              const isSelected = selected.has(key);
              return (
                <Pressable
                  key={key}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSelected }}
                  accessibilityLabel={`Select ${row.item_name} in ${row.warehouse_name ?? 'unassigned warehouse'}`}
                  onPress={() => toggleRow(row)}
                  style={[styles.rowCard, isSelected && styles.rowCardSelected]}
                >
                  <View style={styles.rowHeader}>
                    <View style={[styles.checkbox, isSelected && styles.checkboxOn]}>
                      {isSelected ? (
                        <MaterialCommunityIcons name="check" size={13} color={colors.white} />
                      ) : null}
                    </View>
                    <View style={styles.rowTitleWrap}>
                      <Text style={styles.rowTitle}>{row.item_name}</Text>
                      <Text style={styles.rowSku}>
                        {row.sku} · {row.base_uom}
                      </Text>
                    </View>
                    <Badge label={urgencyLabel[row.urgency]} tone={urgencyTone[row.urgency]} />
                  </View>

                  <View style={styles.warehouseRow}>
                    <MaterialCommunityIcons
                      name="warehouse"
                      size={14}
                      color={colors.muted}
                    />
                    <Text style={styles.warehouseText}>
                      {row.warehouse_name ?? 'No warehouse assigned'}
                    </Text>
                  </View>

                  {row.needs_supplier_assignment ? (
                    <View style={styles.needsSupplierRow}>
                      <MaterialCommunityIcons
                        name="truck-alert-outline"
                        size={14}
                        color={colors.warning}
                      />
                      <Text style={styles.needsSupplierText}>No supplier linked</Text>
                    </View>
                  ) : null}

                  {(row.supplier_options ?? []).length > 0 ? (
                    <View style={styles.supplierOptionsWrap}>
                      {(row.supplier_options ?? []).map((option) => (
                        <SupplierOption
                          key={option.supplier_id}
                          option={option}
                          canReadCost={canReadCost}
                        />
                      ))}
                    </View>
                  ) : row.preferred_supplier_name ? (
                    <View style={styles.preferredSupplierRow}>
                      <MaterialCommunityIcons
                        name="truck-delivery-outline"
                        size={14}
                        color={colors.deep}
                      />
                      <Text style={styles.preferredSupplierText}>
                        Preferred supplier: {row.preferred_supplier_name}
                      </Text>
                    </View>
                  ) : null}

                  <View style={styles.metricsGrid}>
                    <Metric label="On hand" value={formatQty(row.on_hand)} />
                    <Metric label="Available" value={formatQty(row.available)} />
                    <Metric label="Reorder point" value={formatQty(row.reorder_point)} />
                    <Metric
                      label="Target"
                      value={`${formatQty(row.target_stock)}${
                        row.target_stock_source === 'fallback' ? '*' : ''
                      }`}
                    />
                    <Metric label="Incoming" value={formatQty(row.incoming_qty)} />
                    <Metric
                      label="Suggested"
                      value={formatQty(row.suggested_qty)}
                      highlight
                    />
                  </View>

                  {row.target_stock_source === 'fallback' ? (
                    <Text style={styles.assumptionText}>
                      * Target assumed at 2 × reorder point, including open orders.
                    </Text>
                  ) : null}

                  {asNumber(row.blocked) > 0 || asNumber(row.reserved) > 0 ? (
                    <Text style={styles.blockedText}>
                      Excluded from available: {formatQty(row.reserved)} reserved ·{' '}
                      {formatQty(row.blocked)} blocked
                    </Text>
                  ) : null}

                  <View style={styles.qtyRow}>
                    <Text style={styles.qtyLabel}>Order qty</Text>
                    <TextInput
                      value={quantities[key] ?? formatQty(row.suggested_qty)}
                      onChangeText={(value) => updateQuantity(row, value)}
                      keyboardType="decimal-pad"
                      selectTextOnFocus
                      style={styles.qtyInput}
                      accessibilityLabel={`Order quantity for ${row.item_name}`}
                    />
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => resetQuantity(row)}
                      style={styles.resetButton}
                    >
                      <Text style={styles.resetText}>
                        Suggested {formatQty(row.suggested_qty)}
                      </Text>
                    </Pressable>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        {assumptions.length > 0 ? (
          <View style={styles.assumptionsCard}>
            <Text style={styles.assumptionsTitle}>Calculation assumptions</Text>
            {assumptions.map((assumption) => (
              <Text key={assumption} style={styles.assumptionLine}>
                • {assumption}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={styles.actionCard}>
          <View style={styles.actionSummary}>
            <Text style={styles.actionTitle}>
              {selectedRows.length} line{selectedRows.length === 1 ? '' : 's'} selected
            </Text>
            <Text style={styles.actionHint}>
              {selectedUnits > 0
                ? `${formatQty(String(selectedUnits))} units across ${
                    selectedWarehouses.size
                  } warehouse${selectedWarehouses.size === 1 ? '' : 's'}`
                : 'Select items and adjust quantities to continue.'}
            </Text>
          </View>
          <Button
            label="Create purchase order"
            onPress={openPurchaseStep}
            disabled={selectedRows.length === 0 || !canManagePurchasing}
          />
          {!canManagePurchasing ? (
            <Text style={styles.assumptionText}>
              Your role can view purchasing activity but cannot create purchase orders.
            </Text>
          ) : null}
          {canReceive ? (
            <Button
              label="Receive selected as stock"
              variant="secondary"
              onPress={receiveSelected}
              disabled={selectedRows.length === 0 || selectedWarehouses.size !== 1}
            />
          ) : null}
          <Button
            label="View purchase orders"
            variant="ghost"
            onPress={onOpenPurchaseOrders}
          />
        </View>
      </ScrollView>

      <Modal
        visible={showPurchaseModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPurchaseModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeading}>
                <Text style={styles.modalEyebrow}>PURCHASING</Text>
                <Text style={styles.modalTitle}>
                  {createdOrder ? 'Purchase order created' : 'Create purchase order'}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close purchase order dialog"
                onPress={() => setShowPurchaseModal(false)}
                style={styles.modalClose}
              >
                <MaterialCommunityIcons name="close" size={20} color={colors.text} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.modalBody}
              showsVerticalScrollIndicator={false}
            >
              {createdOrder ? (
              <>
                <Text style={styles.modalText}>
                  {createdOrder.number} was created for {createdOrder.supplier_name} with{' '}
                  {createdOrder.line_count} line
                  {createdOrder.line_count === 1 ? '' : 's'} ({formatQty(createdOrder.ordered_qty)}{' '}
                  units). No stock has been received yet.
                </Text>
                <View style={styles.modalSummary}>
                  {createdOrder.lines.slice(0, 6).map((line) => (
                    <View key={line.id} style={styles.modalSummaryRow}>
                      <Text numberOfLines={1} style={styles.modalSummaryName}>
                        {line.item_name}
                      </Text>
                      <Text style={styles.modalSummaryQty}>
                        {formatQty(line.ordered_qty)} {line.base_uom}
                      </Text>
                    </View>
                  ))}
                </View>
                <Button label="View purchase orders" onPress={onOpenPurchaseOrders} />
                <Button
                  label="Close"
                  variant="secondary"
                  onPress={() => setShowPurchaseModal(false)}
                />
              </>
            ) : (
              <>
                <Text style={styles.modalText}>
                  {selectedRows.length} selected replenishment line
                  {selectedRows.length === 1 ? '' : 's'} ({formatQty(String(selectedUnits))} units)
                  will be recorded as incoming stock. On-hand quantities stay unchanged until a
                  receipt is posted.
                </Text>

                <SelectField
                  label="Supplier"
                  value={supplierId}
                  onChange={setSupplierId}
                  options={purchaseSupplierOptions.map((supplier) => ({
                    value: supplier.id,
                    label: supplier.name,
                    detail: supplier.detail,
                  }))}
                  placeholder="Select a supplier"
                  emptyLabel="No suppliers yet. Add a supplier in Partners."
                  searchable
                  searchPlaceholder="Search supplier name or code"
                />
                <Text style={styles.supplierSuggestionHint}>
                  Preferred suppliers are suggested from approved item-supplier links.
                  Switching supplier is allowed and never changes existing purchase history.
                </Text>
                {supplierMoqWarnings.length > 0 ? (
                  <View style={styles.moqWarning}>
                    {supplierMoqWarnings.map((warning) => (
                      <Text key={warning} style={styles.moqWarningText}>
                        {warning}
                      </Text>
                    ))}
                  </View>
                ) : null}
                <SelectField
                  label="Destination warehouse"
                  value={poWarehouseId}
                  onChange={setPoWarehouseId}
                  options={warehouses.map((warehouse) => ({
                    value: warehouse.id,
                    label: warehouse.name,
                    detail: warehouse.address ?? undefined,
                  }))}
                  placeholder="Select the receiving warehouse"
                  disabled={selectedWarehouses.size === 1}
                />
                <Field
                  label="Expected delivery date (optional)"
                  value={expectedDate}
                  onChangeText={setExpectedDate}
                  placeholder="YYYY-MM-DD"
                />
                <Field
                  label="Order note (optional)"
                  value={poNote}
                  onChangeText={setPoNote}
                  placeholder="Delivery instructions, reference or buyer notes"
                  multiline
                  autoCapitalize="sentences"
                />

                <View style={styles.modalSummary}>
                  {selectedRows.slice(0, 6).map((row) => (
                    <View key={reorderRowKey(row)} style={styles.modalSummaryRow}>
                      <Text numberOfLines={1} style={styles.modalSummaryName}>
                        {row.item_name}
                      </Text>
                      <Text style={styles.modalSummaryQty}>
                        {formatQty(quantities[reorderRowKey(row)] ?? row.suggested_qty)}{' '}
                        {row.base_uom}
                      </Text>
                    </View>
                  ))}
                  {selectedRows.length > 6 ? (
                    <Text style={styles.modalMore}>+{selectedRows.length - 6} more lines</Text>
                  ) : null}
                </View>

                {selectedWarehouses.size !== 1 ? (
                  <Text style={styles.modalWarning}>
                    A purchase order is created for one warehouse. Use the warehouse filter to
                    narrow the selection to a single warehouse.
                  </Text>
                ) : null}
                {poError ? <Text style={styles.modalWarning}>{poError}</Text> : null}

                <Button
                  label={creatingOrder ? 'Creating purchase order…' : 'Create purchase order'}
                  onPress={() => void submitPurchaseOrder()}
                  loading={creatingOrder}
                  disabled={
                    creatingOrder ||
                    selectedWarehouses.size !== 1 ||
                    !supplierId ||
                    !poWarehouseId
                  }
                />
                {canReceive && selectedWarehouses.size === 1 ? (
                  <Button
                    label="Receive these as stock instead"
                    variant="secondary"
                    onPress={receiveSelected}
                  />
                ) : null}
                <Button
                  label="Cancel"
                  variant="ghost"
                  onPress={() => setShowPurchaseModal(false)}
                />
              </>
            )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Metric({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <View style={[styles.metricCell, highlight && styles.metricCellHighlight]}>
      <Text style={styles.metricCellLabel}>{label}</Text>
      <Text style={[styles.metricCellValue, highlight && styles.metricCellValueHighlight]}>
        {value}
      </Text>
    </View>
  );
}

function SupplierOption({
  option,
  canReadCost,
}: {
  option: ReorderSupplierOption;
  canReadCost: boolean;
}) {
  const details = [
    option.supplier_sku ? `SKU ${option.supplier_sku}` : null,
    option.lead_time_days != null ? `${option.lead_time_days}d lead` : null,
    option.min_order_qty
      ? `MOQ ${formatQty(option.min_order_qty)}`
      : null,
    canReadCost && option.purchase_price
      ? `${option.currency ?? ''} ${formatQty(option.purchase_price)}`.trim()
      : null,
  ].filter(Boolean);

  return (
    <View style={[styles.supplierOption, option.is_preferred && styles.supplierOptionPreferred]}>
      <MaterialCommunityIcons
        name={option.is_preferred ? 'star-circle' : 'truck-delivery-outline'}
        size={14}
        color={option.is_preferred ? colors.warning : colors.muted}
      />
      <View style={styles.supplierOptionBody}>
        <Text style={styles.supplierOptionName}>
          {option.supplier_name}
          {option.is_preferred ? ' · Preferred' : ''}
        </Text>
        {details.length > 0 ? (
          <Text style={styles.supplierOptionDetail}>{details.join(' · ')}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#EFF3F8',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 14,
    gap: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FCFDFE',
    borderWidth: 1.5,
    borderColor: 'rgba(25,35,56,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  logoImage: {
    width: 48,
    height: 48,
  },
  greetingBox: {
    flex: 1,
  },
  greetingTitle: {
    fontFamily: fonts.heading,
    fontSize: 21,
    lineHeight: 25,
    color: '#192338',
    letterSpacing: -0.3,
  },
  greetingSubtitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 11.5,
    lineHeight: 15,
    color: '#55657E',
    marginTop: 2,
  },
  reorderBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FCFDFE',
    borderWidth: 1.5,
    borderColor: 'rgba(25,35,56,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 14,
  },
  pressed: {
    opacity: 0.8,
  },
  metrics: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  metric: {
    flex: 1,
    backgroundColor: palette.glass,
    borderRadius: radius.lg,
    borderWidth: 1.1,
    borderColor: palette.glassBorder,
    padding: spacing.md,
    gap: 2,
    ...neo.soft,
  },
  metricPrimary: {
    backgroundColor: palette.ink,
    borderColor: 'rgba(255,255,255,0.16)',
    ...neo.raised,
  },
  metricLabel: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 8.5,
    letterSpacing: 1.2,
    color: palette.muted,
  },
  metricLabelLight: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 8.5,
    letterSpacing: 1.2,
    color: 'rgba(255,255,255,0.55)',
  },
  metricValue: {
    fontFamily: fonts.outfitBold,
    fontSize: 23,
    color: palette.ink,
  },
  metricValueLight: {
    fontFamily: fonts.outfitExtraBold,
    fontSize: 25,
    color: palette.white,
  },
  metricHint: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 10.5,
    color: palette.muted,
  },
  metricHintLight: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 10.5,
    color: 'rgba(255,255,255,0.55)',
  },
  noticeCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: 'rgba(234,241,252,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(46,91,191,0.1)',
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  noticeText: {
    flex: 1,
    fontFamily: fonts.dmSansRegular,
    fontSize: 11,
    lineHeight: 16,
    color: palette.ink,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: 'rgba(253,236,234,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(180,35,24,0.12)',
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  errorTextWrap: {
    flex: 1,
    gap: 3,
  },
  errorTitle: {
    fontFamily: fonts.dmSansBold,
    fontSize: 12.5,
    color: colors.danger,
  },
  errorText: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 11,
    lineHeight: 17,
    color: colors.danger,
  },
  retryText: {
    fontFamily: fonts.dmSansBold,
    fontSize: 11.5,
    color: colors.danger,
    textDecorationLine: 'underline',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.glassBorder,
    paddingHorizontal: spacing.md,
    minHeight: 46,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.dmSansRegular,
    fontSize: 13.5,
    color: palette.ink,
    paddingVertical: spacing.sm,
  },
  filterBlock: {
    gap: spacing.sm,
  },
  filterLabel: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 8.5,
    letterSpacing: 1.2,
    color: palette.muted,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: 2,
  },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.62)',
    borderWidth: 1,
    borderColor: palette.glassBorder,
  },
  chipActive: {
    backgroundColor: palette.ink,
    borderColor: palette.ink,
  },
  chipText: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 11.5,
    color: palette.muted,
  },
  chipTextActive: {
    fontFamily: fonts.dmSansBold,
    color: palette.white,
  },
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  selectAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 7,
    borderWidth: 1.4,
    borderColor: 'rgba(148,168,194,0.6)',
    backgroundColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: palette.ink,
    borderColor: palette.ink,
  },
  selectAllText: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 11.5,
    color: palette.ink,
  },
  selectedCount: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 11,
    color: palette.muted,
  },
  loading: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  loadingText: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 11.5,
    color: palette.muted,
  },
  list: {
    gap: spacing.md,
  },
  rowCard: {
    backgroundColor: palette.glass,
    borderRadius: radius.xl,
    borderWidth: 1.1,
    borderColor: palette.glassBorder,
    padding: spacing.lg,
    gap: spacing.sm,
    ...neo.soft,
  },
  rowCardSelected: {
    borderColor: 'rgba(25,35,56,0.35)',
    backgroundColor: 'rgba(255,255,255,0.86)',
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowTitleWrap: {
    flex: 1,
    gap: 1,
  },
  rowTitle: {
    fontFamily: fonts.outfitBold,
    fontSize: 15.5,
    color: palette.ink,
  },
  rowSku: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 10.5,
    letterSpacing: 0.5,
    color: palette.muted,
  },
  warehouseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  warehouseText: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 10.5,
    color: palette.muted,
  },
  preferredSupplierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  preferredSupplierText: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 10.5,
    color: palette.blue,
  },
  needsSupplierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  needsSupplierText: {
    flex: 1,
    fontFamily: fonts.dmSansBold,
    fontSize: 9.5,
    letterSpacing: 0.3,
    color: colors.warning,
  },
  supplierOptionsWrap: {
    gap: 4,
  },
  supplierOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    backgroundColor: 'rgba(246,249,253,0.9)',
  },
  supplierOptionPreferred: {
    backgroundColor: 'rgba(255,248,229,0.95)',
  },
  supplierOptionBody: {
    flex: 1,
  },
  supplierOptionName: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 10,
    color: palette.ink,
  },
  supplierOptionDetail: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 9,
    color: palette.muted,
  },
  moqWarning: {
    backgroundColor: colors.warningSoft,
    borderRadius: radius.lg,
    padding: spacing.sm,
    gap: 3,
  },
  moqWarningText: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 11,
    lineHeight: 16,
    color: colors.warning,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  metricCell: {
    flexGrow: 1,
    flexBasis: '30%',
    backgroundColor: 'rgba(246,249,253,0.9)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    gap: 1,
  },
  metricCellHighlight: {
    backgroundColor: 'rgba(234,241,252,0.95)',
  },
  metricCellLabel: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 8.5,
    color: palette.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metricCellValue: {
    fontFamily: fonts.dmSansBold,
    fontSize: 12.5,
    color: palette.ink,
  },
  metricCellValueHighlight: {
    color: palette.blue,
  },
  assumptionText: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 10,
    lineHeight: 15,
    color: palette.muted,
    fontStyle: 'italic',
  },
  blockedText: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 10,
    color: colors.warning,
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: palette.line,
    paddingTop: spacing.sm,
  },
  qtyLabel: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 11,
    color: palette.muted,
  },
  qtyInput: {
    minWidth: 84,
    borderWidth: 1,
    borderColor: palette.glassBorder,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    fontFamily: fonts.dmSansBold,
    fontSize: 14,
    color: palette.ink,
    textAlign: 'right',
    backgroundColor: palette.white,
  },
  resetButton: {
    flex: 1,
    alignItems: 'flex-end',
  },
  resetText: {
    fontFamily: fonts.dmSansBold,
    fontSize: 9.5,
    color: palette.blue,
  },
  assumptionsCard: {
    backgroundColor: 'rgba(246,249,253,0.9)',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.glassBorder,
    padding: spacing.md,
    gap: 5,
  },
  assumptionsTitle: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 10,
    color: palette.ink,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  assumptionLine: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 10,
    lineHeight: 15,
    color: palette.muted,
  },
  actionCard: {
    backgroundColor: palette.glass,
    borderRadius: radius.xl,
    borderWidth: 1.1,
    borderColor: palette.glassBorder,
    padding: spacing.lg,
    gap: spacing.sm,
    ...neo.raised,
  },
  actionSummary: {
    gap: 2,
    marginBottom: spacing.xs,
  },
  actionTitle: {
    fontFamily: fonts.outfitBold,
    fontSize: 16,
    color: palette.ink,
  },
  actionHint: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 11.5,
    color: palette.muted,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: palette.canvas,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
    maxHeight: '92%',
  },
  modalBody: {
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  modalHeading: {
    flex: 1,
    gap: 2,
  },
  modalEyebrow: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 8.5,
    letterSpacing: 1.4,
    color: palette.muted,
  },
  modalTitle: {
    fontFamily: fonts.outfitBold,
    fontSize: 21,
    color: palette.ink,
  },
  modalClose: {
    width: 32,
    height: 32,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderWidth: 1,
    borderColor: palette.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalText: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 12.5,
    lineHeight: 19,
    color: palette.ink,
  },
  supplierSuggestionHint: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 10,
    lineHeight: 15,
    color: palette.muted,
    marginTop: -spacing.xs,
  },
  modalSummary: {
    backgroundColor: 'rgba(255,255,255,0.66)',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.glassBorder,
    padding: spacing.md,
    gap: spacing.xs,
  },
  modalSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  modalSummaryName: {
    flex: 1,
    fontFamily: fonts.dmSansRegular,
    fontSize: 11.5,
    color: palette.ink,
  },
  modalSummaryQty: {
    fontFamily: fonts.dmSansBold,
    fontSize: 11.5,
    color: palette.ink,
  },
  modalMore: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 11,
    color: palette.muted,
  },
  modalWarning: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 11.5,
    lineHeight: 17,
    color: colors.warning,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
});
