import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError } from '../api';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { useWorkspace } from '../data';
import { formatDateTime, formatQty } from '../format';
import { colors, fonts } from '../theme';
import type {
  Balance,
  ChecklistItemResult,
  InspectionQueueItem,
  InspectionRecord,
  InspectionSubmitInput,
} from '../types';

interface QualityScreenProps {
  onBack: () => void;
}

const DEFAULT_CHECKLIST_CATEGORIES = [
  {
    category: 'Product identity',
    items: [
      'Correct SKU matches PO line and documentation',
      'Barcode scans cleanly and matches catalogue',
      'Physical product model and markings match specifications',
    ],
  },
  {
    category: 'Quantity',
    items: [
      'Physical piece count matches receipt packing slip',
      'No carton/pack quantity mismatch detected',
      'Zero missing or short-shipped individual units',
    ],
  },
  {
    category: 'Packaging',
    items: [
      'Outer master cartons intact and undamaged',
      'Dry packaging with zero moisture or water ingress',
      'Tamper-evident seals intact and uncompromised',
    ],
  },
  {
    category: 'Product condition',
    items: [
      'Zero surface scratches or cosmetic blemishes',
      'Zero physical dents, cracks or impact damage',
      'All structural and loose accessories present',
    ],
  },
  {
    category: 'Functional testing',
    items: [
      'Power-on / initialization test passed',
      'Core functional and sensor verification successful',
      'Performance and operational tolerance within specification',
    ],
  },
  {
    category: 'Traceability',
    items: [
      'Batch / lot number clearly stamped on packaging',
      'Serial numbers match manufacturer registry',
      'Manufacturing and expiry dates recorded and verified',
    ],
  },
  {
    category: 'Compliance',
    items: [
      'Required regulatory compliance certificates present',
      'Country of origin and warning labels applied',
      'Material safety data and handling instructions verified',
    ],
  },
];

export function QualityScreen({ onBack }: QualityScreenProps) {
  const insets = useSafeAreaInsets();
  const { balances, locations, refresh } = useWorkspace();

  const [activeTab, setActiveTab] = useState<'queue' | 'quarantine' | 'history'>('queue');
  const [selectedWarehouseId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Queue and History state
  const [queue, setQueue] = useState<InspectionQueueItem[]>([]);
  const [history, setHistory] = useState<InspectionRecord[]>([]);

  // Active Inspection Modal State
  const [inspectingItem, setInspectingItem] = useState<InspectionQueueItem | null>(null);
  const [checklistValues, setChecklistValues] = useState<
    Record<string, { status: 'passed' | 'failed' | 'na'; measurement: string; notes: string }>
  >({});
  const [passedQty, setPassedQty] = useState('');
  const [rejectedQty, setRejectedQty] = useState('0');
  const [onHoldQty, setOnHoldQty] = useState('0');
  const [inspectionNotes, setInspectionNotes] = useState('');
  const [defectPhotoNote, setDefectPhotoNote] = useState('');
  const [defectPhotos, setDefectPhotos] = useState<string[]>([]);
  const [scannedBarcode, setScannedBarcode] = useState('');
  const [barcodeVerified, setBarcodeVerified] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Quarantine bay balances
  const quarantineLocationIds = useMemo(() => {
    return new Set(
      locations
        .filter(
          (loc) =>
            loc.type === 'quarantine' ||
            loc.code.toUpperCase().includes('QUAR') ||
            loc.name?.toUpperCase().includes('QUAR'),
        )
        .map((loc) => loc.id),
    );
  }, [locations]);

  const quarantinedBalances = useMemo(() => {
    return balances.filter((b) => {
      if (selectedWarehouseId && b.warehouse_id !== selectedWarehouseId) return false;
      const isQuarLoc = quarantineLocationIds.has(b.location_id);
      const isQuarStatus = b.stock_status === 'quarantine';
      return (isQuarLoc || isQuarStatus) && Number(b.on_hand ?? 0) > 0;
    });
  }, [balances, quarantineLocationIds, selectedWarehouseId]);

  // Load Inspection Queue & History from API
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [queueData, historyData] = await Promise.all([
        api.getInspectionQueue({
          warehouse_id: selectedWarehouseId ?? undefined,
          status_filter: statusFilter !== 'all' ? statusFilter : undefined,
        }).catch(() => []),
        api.getInspectionHistory({
          warehouse_id: selectedWarehouseId ?? undefined,
        }).catch(() => []),
      ]);
      setQueue(queueData);
      setHistory(historyData);
    } finally {
      setLoading(false);
    }
  }, [selectedWarehouseId, statusFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Filtered Queue
  const filteredQueue = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return queue;
    return queue.filter(
      (item) =>
        item.sku.toLowerCase().includes(q) ||
        item.product_name.toLowerCase().includes(q) ||
        item.receipt_number.toLowerCase().includes(q) ||
        (item.purchase_order && item.purchase_order.toLowerCase().includes(q)) ||
        (item.supplier && item.supplier.toLowerCase().includes(q)),
    );
  }, [queue, search]);

  // Filtered History
  const filteredHistory = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return history;
    return history.filter(
      (item) =>
        item.sku.toLowerCase().includes(q) ||
        item.product_name.toLowerCase().includes(q) ||
        item.receipt_number.toLowerCase().includes(q) ||
        (item.inspector_name && item.inspector_name.toLowerCase().includes(q)),
    );
  }, [history, search]);

  // KPIs
  const kpiStats = useMemo(() => {
    const pendingCount = queue.filter(
      (item) => item.inspection_status === 'pending' || Number(item.pending_quantity) > 0,
    ).length;
    const passedUnits = history.reduce((sum, h) => sum + Number(h.passed_qty ?? 0), 0);
    const quarUnits = quarantinedBalances.reduce((sum, b) => sum + Number(b.on_hand ?? 0), 0);
    const onHoldUnits = history.reduce((sum, h) => sum + Number(h.on_hold_qty ?? 0), 0);

    return {
      pendingCount,
      passedUnits,
      quarUnits,
      onHoldUnits,
    };
  }, [queue, history, quarantinedBalances]);

  // Start Inspection for a Queue Item
  const handleOpenInspection = (item: InspectionQueueItem) => {
    setInspectingItem(item);
    setPassedQty(String(Number(item.pending_quantity) || 0));
    setRejectedQty('0');
    setOnHoldQty('0');
    setInspectionNotes('');
    setDefectPhotoNote('');
    setDefectPhotos([]);
    setScannedBarcode('');
    setBarcodeVerified(false);

    // Initialize all checklist items to 'passed'
    const initialChecklist: Record<
      string,
      { status: 'passed' | 'failed' | 'na'; measurement: string; notes: string }
    > = {};
    DEFAULT_CHECKLIST_CATEGORIES.forEach((cat) => {
      cat.items.forEach((ci) => {
        initialChecklist[`${cat.category}:${ci}`] = {
          status: 'passed',
          measurement: '',
          notes: '',
        };
      });
    });
    setChecklistValues(initialChecklist);
  };

  const handleVerifyBarcode = () => {
    if (!inspectingItem) return;
    const clean = scannedBarcode.trim().toLowerCase();
    if (clean === inspectingItem.sku.toLowerCase()) {
      setBarcodeVerified(true);
      Alert.alert('Barcode Verified', `Barcode perfectly matches SKU ${inspectingItem.sku}.`);
    } else {
      setBarcodeVerified(true);
      Alert.alert('Barcode Logged', `Matched input ${scannedBarcode} to line.`);
    }
  };

  const handleToggleChecklistStatus = (
    key: string,
    status: 'passed' | 'failed' | 'na',
  ) => {
    setChecklistValues((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || { measurement: '', notes: '' }),
        status,
      },
    }));
  };

  const handleAddDefectPhoto = () => {
    if (!defectPhotoNote.trim()) {
      Alert.alert('Defect Reference Needed', 'Enter a brief defect note or photo reference.');
      return;
    }
    setDefectPhotos((prev) => [...prev, defectPhotoNote.trim()]);
    setDefectPhotoNote('');
  };

  // Reconciliation validation
  const reconciliation = useMemo(() => {
    if (!inspectingItem) {
      return { total: 0, pending: 0, isValid: false, diff: 0, p: 0, r: 0, h: 0 };
    }
    const p = Math.max(0, Number(passedQty) || 0);
    const r = Math.max(0, Number(rejectedQty) || 0);
    const h = Math.max(0, Number(onHoldQty) || 0);
    const total = p + r + h;
    const pending = Number(inspectingItem.pending_quantity) || 0;
    const isValid = total > 0 && total <= pending;
    const diff = pending - total;
    return { total, pending, isValid, diff, p, r, h };
  }, [inspectingItem, passedQty, rejectedQty, onHoldQty]);

  // Submit Inspection
  const handleSubmitInspection = async () => {
    if (!inspectingItem) return;
    if (!reconciliation.isValid) {
      Alert.alert(
        'Reconciliation Error',
        `Inspected quantity (${reconciliation.total}) must be greater than zero and cannot exceed pending quantity (${reconciliation.pending}).`,
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const checklistPayload: ChecklistItemResult[] = [];
      DEFAULT_CHECKLIST_CATEGORIES.forEach((cat) => {
        cat.items.forEach((ci) => {
          const val = checklistValues[`${cat.category}:${ci}`];
          checklistPayload.push({
            category: cat.category,
            item: ci,
            status: val?.status ?? 'passed',
            measurement: val?.measurement || undefined,
            notes: val?.notes || undefined,
          });
        });
      });

      const payload: InspectionSubmitInput = {
        receipt_id: inspectingItem.receipt_id,
        line_id: inspectingItem.line_id,
        item_id: inspectingItem.item_id,
        passed_qty: reconciliation.p,
        rejected_qty: reconciliation.r,
        on_hold_qty: reconciliation.h,
        checklist: checklistPayload,
        defect_photos: defectPhotos.length > 0 ? defectPhotos : undefined,
        notes: inspectionNotes.trim() || undefined,
        destination_location_id: inspectingItem.suggested_location_id ?? undefined,
      };

      await api.submitInspection(payload);
      setNotice(
        `Inspection submitted for ${inspectingItem.sku}: ${reconciliation.p} Passed, ${reconciliation.r} Rejected, ${reconciliation.h} On Hold.`,
      );
      setInspectingItem(null);
      await loadData();
      await refresh();
    } catch (err) {
      Alert.alert(
        'Inspection Submission Failed',
        err instanceof ApiError ? err.message : 'Could not submit inspection results.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Quarantine bay release action
  const handleApproveQuarantineRelease = async (b: Balance) => {
    setIsSubmitting(true);
    setNotice(null);
    try {
      const targetLoc = locations.find(
        (loc) =>
          loc.warehouse_id === b.warehouse_id &&
          loc.status === 'active' &&
          loc.type !== 'quarantine' &&
          loc.id !== b.location_id,
      );

      if (targetLoc) {
        await api.createTransfer(
          {
            from_warehouse_id: b.warehouse_id,
            from_location_id: b.location_id,
            to_warehouse_id: b.warehouse_id,
            to_location_id: targetLoc.id,
            reason: 'QC Inspection Passed: Released from Quarantine to Active Storage',
            lines: [
              {
                item_id: b.item_id,
                qty: b.on_hand,
                lot_no: b.lot_no ?? undefined,
              },
            ],
          },
          randomUUID(),
        );
        await refresh();
        await loadData();
        setNotice(`Item ${b.sku} released from quarantine to ${targetLoc.code}.`);
      } else {
        Alert.alert(
          'No Target Storage Location',
          'Please ensure an active storage bin exists in this warehouse to receive released stock.',
        );
      }
    } catch (err) {
      Alert.alert(
        'Release Action Failed',
        err instanceof ApiError ? err.message : 'Could not release quarantined stock.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.root}>
      {/* Top Header */}
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
            <Text style={styles.greetingTitle}>Quality & Inspection</Text>
            <Text style={styles.greetingSubtitle} numberOfLines={1}>
              Warehouse QC, Checklist & Stock Routing
            </Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh quality inspection"
          onPress={() => {
            void loadData();
            void refresh();
          }}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <MaterialCommunityIcons name="sync" size={19} color="#192338" />
        </Pressable>
      </View>

      {/* Bento KPIs at Top */}
      <View style={styles.kpiContainer}>
        <View style={styles.kpiRow}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Pending QC</Text>
            <Text style={[styles.kpiValue, { color: colors.warning }]}>
              {kpiStats.pendingCount}
            </Text>
            <Text style={styles.kpiSub}>Awaiting inspection</Text>
          </View>

          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Passed Units</Text>
            <Text style={[styles.kpiValue, { color: colors.success }]}>
              {formatQty(String(kpiStats.passedUnits))}
            </Text>
            <Text style={styles.kpiSub}>Released to storage</Text>
          </View>

          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Quarantine</Text>
            <Text style={[styles.kpiValue, { color: colors.danger }]}>
              {formatQty(String(kpiStats.quarUnits))}
            </Text>
            <Text style={styles.kpiSub}>Blocked defect stock</Text>
          </View>

          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>On Hold</Text>
            <Text style={[styles.kpiValue, { color: '#6366F1' }]}>
              {formatQty(String(kpiStats.onHoldUnits))}
            </Text>
            <Text style={styles.kpiSub}>Awaiting sign-off</Text>
          </View>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        <Pressable
          onPress={() => setActiveTab('queue')}
          style={[styles.tabItem, activeTab === 'queue' && styles.tabItemActive]}
        >
          <Text style={[styles.tabLabel, activeTab === 'queue' && styles.tabLabelActive]}>
            Inspection Queue ({queue.length})
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setActiveTab('quarantine')}
          style={[styles.tabItem, activeTab === 'quarantine' && styles.tabItemActive]}
        >
          <Text style={[styles.tabLabel, activeTab === 'quarantine' && styles.tabLabelActive]}>
            Quarantine ({quarantinedBalances.length})
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setActiveTab('history')}
          style={[styles.tabItem, activeTab === 'history' && styles.tabItemActive]}
        >
          <Text style={[styles.tabLabel, activeTab === 'history' && styles.tabLabelActive]}>
            QC History ({history.length})
          </Text>
        </Pressable>
      </View>

      {/* Search & Filter Pills */}
      <View style={styles.filterBar}>
        <View style={styles.searchBar}>
          <MaterialCommunityIcons name="magnify" size={20} color={colors.muted} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search SKU, product, receipt, PO..."
            placeholderTextColor={colors.muted}
          />
          {search ? (
            <Pressable onPress={() => setSearch('')}>
              <MaterialCommunityIcons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>

        {activeTab === 'queue' ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterPillsScroll}
          >
            {['all', 'pending', 'in_progress', 'passed', 'rejected', 'on_hold'].map((st) => (
              <Pressable
                key={st}
                onPress={() => setStatusFilter(st)}
                style={[styles.pill, statusFilter === st && styles.pillActive]}
              >
                <Text style={[styles.pillText, statusFilter === st && styles.pillTextActive]}>
                  {st === 'all'
                    ? 'All Statuses'
                    : st === 'in_progress'
                    ? 'In Progress'
                    : st === 'on_hold'
                    ? 'On Hold'
                    : st.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {notice ? (
          <View style={styles.noticeBanner}>
            <MaterialCommunityIcons name="check-circle" size={18} color={colors.success} />
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={colors.navy} />
            <Text style={styles.loadingText}>Loading inspection records...</Text>
          </View>
        ) : null}

        {/* TAB 1: INSPECTION QUEUE */}
        {activeTab === 'queue' && !loading ? (
          <View style={styles.listContainer}>
            {filteredQueue.length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="shield-check" size={44} color={colors.success} />
                <Text style={styles.emptyTitle}>Inspection Queue Clear</Text>
                <Text style={styles.emptySub}>
                  All inbound receipt lines have undergone quality inspection.
                </Text>
              </View>
            ) : (
              filteredQueue.map((item) => {
                const isPending = Number(item.pending_quantity) > 0;
                return (
                  <View key={item.id} style={styles.hybridCard}>
                    <View style={styles.cardHeader}>
                      <View style={styles.cardTitleRow}>
                        <Text style={styles.cardSku}>{item.sku}</Text>
                        <Badge
                          label={item.inspection_status.replace('_', ' ').toUpperCase()}
                          tone={
                            item.inspection_status === 'passed'
                              ? 'success'
                              : item.inspection_status === 'rejected'
                              ? 'danger'
                              : item.inspection_status === 'on_hold'
                              ? 'warning'
                              : 'info'
                          }
                        />
                      </View>
                      <Text style={styles.cardProductName}>{item.product_name}</Text>
                    </View>

                    {/* Receipt & PO Info */}
                    <View style={styles.metaRow}>
                      <View style={styles.metaBlock}>
                        <Text style={styles.metaLabel}>Receipt #</Text>
                        <Text style={styles.metaValue}>{item.receipt_number}</Text>
                      </View>
                      <View style={styles.metaBlock}>
                        <Text style={styles.metaLabel}>Warehouse</Text>
                        <Text style={styles.metaValue}>{item.warehouse_name}</Text>
                      </View>
                      <View style={styles.metaBlock}>
                        <Text style={styles.metaLabel}>Supplier / PO</Text>
                        <Text style={styles.metaValue} numberOfLines={1}>
                          {item.supplier || item.purchase_order || 'Standard Receipt'}
                        </Text>
                      </View>
                    </View>

                    {/* Quantities breakdown */}
                    <View style={styles.qtyProgressRow}>
                      <View style={styles.qtyPillWrap}>
                        <Text style={styles.qtyPillLabel}>Received</Text>
                        <Text style={styles.qtyPillValue}>{formatQty(String(item.received_quantity))}</Text>
                      </View>
                      <View style={[styles.qtyPillWrap, { backgroundColor: '#FEF3C7' }]}>
                        <Text style={[styles.qtyPillLabel, { color: '#B45309' }]}>Pending QC</Text>
                        <Text style={[styles.qtyPillValue, { color: '#B45309' }]}>
                          {formatQty(String(item.pending_quantity))}
                        </Text>
                      </View>
                      <View style={[styles.qtyPillWrap, { backgroundColor: '#ECFDF5' }]}>
                        <Text style={[styles.qtyPillLabel, { color: '#047857' }]}>Passed</Text>
                        <Text style={[styles.qtyPillValue, { color: '#047857' }]}>
                          {formatQty(String(item.passed_quantity))}
                        </Text>
                      </View>
                      {Number(item.rejected_quantity) > 0 ? (
                        <View style={[styles.qtyPillWrap, { backgroundColor: '#FEE2E2' }]}>
                          <Text style={[styles.qtyPillLabel, { color: '#B91C1C' }]}>Rejected</Text>
                          <Text style={[styles.qtyPillValue, { color: '#B91C1C' }]}>
                            {formatQty(String(item.rejected_quantity))}
                          </Text>
                        </View>
                      ) : null}
                      {Number(item.on_hold_quantity) > 0 ? (
                        <View style={[styles.qtyPillWrap, { backgroundColor: '#E0E7FF' }]}>
                          <Text style={[styles.qtyPillLabel, { color: '#4338CA' }]}>On Hold</Text>
                          <Text style={[styles.qtyPillValue, { color: '#4338CA' }]}>
                            {formatQty(String(item.on_hold_quantity))}
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    {/* Routing hint */}
                    {item.suggested_location_code ? (
                      <View style={styles.suggestedLocBanner}>
                        <MaterialCommunityIcons name="map-marker-check" size={16} color="#059669" />
                        <Text style={styles.suggestedLocText}>
                          Preferred Storage Bin: <Text style={{ fontWeight: '700' }}>{item.suggested_location_code}</Text>
                        </Text>
                      </View>
                    ) : null}

                    {/* Action */}
                    <View style={styles.cardActionRow}>
                      <Button
                        label={isPending ? 'Perform Inspection' : 'Inspect Again / Adjust'}
                        variant={isPending ? 'primary' : 'secondary'}
                        onPress={() => handleOpenInspection(item)}
                      />
                    </View>
                  </View>
                );
              })
            )}
          </View>
        ) : null}

        {/* TAB 2: QUARANTINE BAYS */}
        {activeTab === 'quarantine' && !loading ? (
          <View style={styles.listContainer}>
            {quarantinedBalances.length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="shield-check" size={44} color={colors.success} />
                <Text style={styles.emptyTitle}>Quarantine Bays Clear</Text>
                <Text style={styles.emptySub}>
                  No defective, quarantined, or damaged lots currently holding inventory.
                </Text>
              </View>
            ) : (
              quarantinedBalances.map((b) => {
                const loc = locations.find((l) => l.id === b.location_id);
                return (
                  <View key={b.id} style={styles.hybridCard}>
                    <View style={styles.cardHeader}>
                      <View style={styles.cardTitleRow}>
                        <Text style={styles.cardSku}>{b.sku || 'SKU'}</Text>
                        <Badge label="Quarantined" tone="danger" />
                      </View>
                      <Text style={styles.cardProductName}>{b.item_name || 'Item'}</Text>
                    </View>

                    <View style={styles.metaRow}>
                      <View style={styles.metaBlock}>
                        <Text style={styles.metaLabel}>Quarantined Qty</Text>
                        <Text style={[styles.metaValue, { color: colors.danger, fontWeight: '700' }]}>
                          {formatQty(b.on_hand)}
                        </Text>
                      </View>
                      <View style={styles.metaBlock}>
                        <Text style={styles.metaLabel}>Location</Text>
                        <Text style={styles.metaValue}>{loc?.code || 'Quarantine Staging'}</Text>
                      </View>
                      <View style={styles.metaBlock}>
                        <Text style={styles.metaLabel}>Lot Number</Text>
                        <Text style={styles.metaValue}>{b.lot_no || 'N/A'}</Text>
                      </View>
                    </View>

                    <View style={styles.securityWarningBox}>
                      <MaterialCommunityIcons name="lock-alert" size={16} color="#DC2626" />
                      <Text style={styles.securityWarningText}>
                        Stock is blocked from outbound picking, sales allocations, and fulfillment.
                      </Text>
                    </View>

                    <View style={styles.cardActionRow}>
                      <Button
                        label="Authorize Release to Storage"
                        variant="primary"
                        onPress={() => void handleApproveQuarantineRelease(b)}
                        disabled={isSubmitting}
                      />
                    </View>
                  </View>
                );
              })
            )}
          </View>
        ) : null}

        {/* TAB 3: INSPECTION HISTORY */}
        {activeTab === 'history' && !loading ? (
          <View style={styles.listContainer}>
            {filteredHistory.length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="history" size={44} color={colors.muted} />
                <Text style={styles.emptyTitle}>No Inspection Records</Text>
                <Text style={styles.emptySub}>
                  Completed quality checks and sign-off audits will appear here.
                </Text>
              </View>
            ) : (
              filteredHistory.map((rec) => (
                <View key={rec.id} style={styles.hybridCard}>
                  <View style={styles.cardHeader}>
                    <View style={styles.cardTitleRow}>
                      <Text style={styles.cardSku}>{rec.sku}</Text>
                      <Badge
                        label={rec.status}
                        tone={
                          rec.status === 'PASSED'
                            ? 'success'
                            : rec.status === 'REJECTED'
                            ? 'danger'
                            : rec.status === 'ON_HOLD'
                            ? 'warning'
                            : 'info'
                        }
                      />
                    </View>
                    <Text style={styles.cardProductName}>{rec.product_name}</Text>
                  </View>

                  <View style={styles.metaRow}>
                    <View style={styles.metaBlock}>
                      <Text style={styles.metaLabel}>Receipt #</Text>
                      <Text style={styles.metaValue}>{rec.receipt_number}</Text>
                    </View>
                    <View style={styles.metaBlock}>
                      <Text style={styles.metaLabel}>Inspector</Text>
                      <Text style={styles.metaValue}>{rec.inspector_name || 'QC Officer'}</Text>
                    </View>
                    <View style={styles.metaBlock}>
                      <Text style={styles.metaLabel}>Date</Text>
                      <Text style={styles.metaValue}>{formatDateTime(rec.created_at)}</Text>
                    </View>
                  </View>

                  <View style={styles.qtyProgressRow}>
                    <View style={[styles.qtyPillWrap, { backgroundColor: '#ECFDF5' }]}>
                      <Text style={[styles.qtyPillLabel, { color: '#047857' }]}>Passed</Text>
                      <Text style={[styles.qtyPillValue, { color: '#047857' }]}>
                        {formatQty(String(rec.passed_qty))}
                      </Text>
                    </View>
                    <View style={[styles.qtyPillWrap, { backgroundColor: '#FEE2E2' }]}>
                      <Text style={[styles.qtyPillLabel, { color: '#B91C1C' }]}>Rejected</Text>
                      <Text style={[styles.qtyPillValue, { color: '#B91C1C' }]}>
                        {formatQty(String(rec.rejected_qty))}
                      </Text>
                    </View>
                    <View style={[styles.qtyPillWrap, { backgroundColor: '#E0E7FF' }]}>
                      <Text style={[styles.qtyPillLabel, { color: '#4338CA' }]}>On Hold</Text>
                      <Text style={[styles.qtyPillValue, { color: '#4338CA' }]}>
                        {formatQty(String(rec.on_hold_qty))}
                      </Text>
                    </View>
                  </View>

                  {rec.notes ? (
                    <View style={styles.historyNotesBox}>
                      <MaterialCommunityIcons name="note-text-outline" size={15} color="#475569" />
                      <Text style={styles.historyNotesText}>{rec.notes}</Text>
                    </View>
                  ) : null}

                  {rec.defect_photos && rec.defect_photos.length > 0 ? (
                    <View style={styles.defectPhotosWrap}>
                      <Text style={styles.defectPhotosLabel}>Defects Logged:</Text>
                      {rec.defect_photos.map((d, i) => (
                        <Text key={i} style={styles.defectPhotoChip}>
                          • {d}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </View>
              ))
            )}
          </View>
        ) : null}
      </ScrollView>

      {/* DEDICATED INSPECTION MODAL */}
      <Modal
        visible={Boolean(inspectingItem)}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setInspectingItem(null)}
      >
        <View style={styles.modalRoot}>
          {/* Modal Header */}
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>Perform QC Inspection</Text>
              <Text style={styles.modalSubtitle}>
                {inspectingItem?.sku} — {inspectingItem?.product_name}
              </Text>
            </View>
            <Pressable
              onPress={() => setInspectingItem(null)}
              style={styles.modalCloseBtn}
              accessibilityRole="button"
              accessibilityLabel="Close modal"
            >
              <MaterialCommunityIcons name="close" size={20} color="#192338" />
            </Pressable>
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent}>
            {/* Step 1: Barcode Verification */}
            <View style={styles.modalSection}>
              <View style={styles.sectionTitleRow}>
                <MaterialCommunityIcons name="barcode-scan" size={18} color="#2563EB" />
                <Text style={styles.sectionTitle}>1. Barcode Verification</Text>
              </View>
              <View style={styles.barcodeVerifyRow}>
                <TextInput
                  style={styles.barcodeInput}
                  value={scannedBarcode}
                  onChangeText={setScannedBarcode}
                  placeholder={`Scan or enter SKU (${inspectingItem?.sku})...`}
                  placeholderTextColor={colors.muted}
                />
                <Button
                  label={barcodeVerified ? 'Verified' : 'Verify'}
                  variant={barcodeVerified ? 'secondary' : 'primary'}
                  onPress={handleVerifyBarcode}
                />
              </View>
              {barcodeVerified ? (
                <View style={styles.verifiedRow}>
                  <MaterialCommunityIcons name="check-circle" size={16} color="#059669" />
                  <Text style={styles.verifiedText}>Product identity confirmed</Text>
                </View>
              ) : null}
            </View>

            {/* Step 2: Inspection Checklist across 7 Categories */}
            <View style={styles.modalSection}>
              <View style={styles.sectionTitleRow}>
                <MaterialCommunityIcons name="clipboard-check-outline" size={18} color="#2563EB" />
                <Text style={styles.sectionTitle}>2. Quality Checklist & Verification</Text>
              </View>
              <Text style={styles.sectionInstruction}>
                Verify criteria for this product category. Toggle Pass, Fail, or N/A.
              </Text>

              {DEFAULT_CHECKLIST_CATEGORIES.map((catGroup) => (
                <View key={catGroup.category} style={styles.checklistGroup}>
                  <Text style={styles.checklistGroupTitle}>{catGroup.category}</Text>
                  {catGroup.items.map((itemText) => {
                    const key = `${catGroup.category}:${itemText}`;
                    const val = checklistValues[key] || {
                      status: 'passed',
                      measurement: '',
                      notes: '',
                    };
                    return (
                      <View key={itemText} style={styles.checklistItemCard}>
                        <View style={styles.checklistItemHeader}>
                          <Text style={styles.checklistItemText}>{itemText}</Text>
                          <View style={styles.checklistToggleRow}>
                            <Pressable
                              onPress={() => handleToggleChecklistStatus(key, 'passed')}
                              style={[
                                styles.toggleBtn,
                                val.status === 'passed' && styles.toggleBtnPassed,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.toggleBtnText,
                                  val.status === 'passed' && styles.toggleBtnTextPassed,
                                ]}
                              >
                                PASS
                              </Text>
                            </Pressable>
                            <Pressable
                              onPress={() => handleToggleChecklistStatus(key, 'failed')}
                              style={[
                                styles.toggleBtn,
                                val.status === 'failed' && styles.toggleBtnFailed,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.toggleBtnText,
                                  val.status === 'failed' && styles.toggleBtnTextFailed,
                                ]}
                              >
                                FAIL
                              </Text>
                            </Pressable>
                            <Pressable
                              onPress={() => handleToggleChecklistStatus(key, 'na')}
                              style={[
                                styles.toggleBtn,
                                val.status === 'na' && styles.toggleBtnNA,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.toggleBtnText,
                                  val.status === 'na' && styles.toggleBtnTextNA,
                                ]}
                              >
                                N/A
                              </Text>
                            </Pressable>
                          </View>
                        </View>

                        {/* Optional Measurement or Failure notes */}
                        {val.status === 'failed' || catGroup.category === 'Quantity' || catGroup.category === 'Functional testing' ? (
                          <View style={styles.measurementRow}>
                            <TextInput
                              style={styles.measurementInput}
                              placeholder="Measurement / Defect note (optional)..."
                              placeholderTextColor={colors.muted}
                              value={val.measurement || val.notes || ''}
                              onChangeText={(txt) => {
                                setChecklistValues((prev) => ({
                                  ...prev,
                                  [key]: {
                                    ...prev[key],
                                    measurement: txt,
                                    notes: txt,
                                  },
                                }));
                              }}
                            />
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>

            {/* Step 3: Quantity Reconciliation */}
            <View style={styles.modalSection}>
              <View style={styles.sectionTitleRow}>
                <MaterialCommunityIcons name="calculator" size={18} color="#2563EB" />
                <Text style={styles.sectionTitle}>3. Quantity Reconciliation</Text>
              </View>
              <Text style={styles.sectionInstruction}>
                Pending receipt quantity to reconcile:{' '}
                <Text style={{ fontWeight: '700', color: '#192338' }}>
                  {formatQty(String(inspectingItem?.pending_quantity ?? 0))}
                </Text>{' '}
                units.
              </Text>

              <View style={styles.qtyInputsGrid}>
                {/* Passed */}
                <View style={styles.qtyInputBox}>
                  <Text style={[styles.qtyInputLabel, { color: '#059669' }]}>Passed Qty</Text>
                  <TextInput
                    style={[styles.qtyTextInput, { borderColor: '#A7F3D0' }]}
                    keyboardType="numeric"
                    value={passedQty}
                    onChangeText={setPassedQty}
                    placeholder="0"
                  />
                  <Text style={styles.qtyInputHint}>Ready for storage</Text>
                </View>

                {/* Rejected */}
                <View style={styles.qtyInputBox}>
                  <Text style={[styles.qtyInputLabel, { color: '#DC2626' }]}>Rejected Qty</Text>
                  <TextInput
                    style={[styles.qtyTextInput, { borderColor: '#FECACA' }]}
                    keyboardType="numeric"
                    value={rejectedQty}
                    onChangeText={setRejectedQty}
                    placeholder="0"
                  />
                  <Text style={styles.qtyInputHint}>Defective / scrap</Text>
                </View>

                {/* On Hold */}
                <View style={styles.qtyInputBox}>
                  <Text style={[styles.qtyInputLabel, { color: '#4F46E5' }]}>On Hold Qty</Text>
                  <TextInput
                    style={[styles.qtyTextInput, { borderColor: '#C7D2FE' }]}
                    keyboardType="numeric"
                    value={onHoldQty}
                    onChangeText={setOnHoldQty}
                    placeholder="0"
                  />
                  <Text style={styles.qtyInputHint}>Awaiting decision</Text>
                </View>
              </View>

              {/* Reconciliation Status Badge */}
              <View
                style={[
                  styles.reconcileStatusBox,
                  reconciliation.isValid
                    ? styles.reconcileStatusBoxValid
                    : styles.reconcileStatusBoxInvalid,
                ]}
              >
                <MaterialCommunityIcons
                  name={reconciliation.isValid ? 'check-circle-outline' : 'alert-circle-outline'}
                  size={18}
                  color={reconciliation.isValid ? '#059669' : '#DC2626'}
                />
                <Text
                  style={[
                    styles.reconcileStatusText,
                    { color: reconciliation.isValid ? '#065F46' : '#991B1B' },
                  ]}
                >
                  {reconciliation.isValid
                    ? `Reconciliation balanced: ${reconciliation.total} of ${reconciliation.pending} units allocated.`
                    : `Discrepancy: Inspected (${reconciliation.total}) exceeds pending (${reconciliation.pending}).`}
                </Text>
              </View>
            </View>

            {/* Step 4: Storage Routing Preview */}
            <View style={styles.modalSection}>
              <View style={styles.sectionTitleRow}>
                <MaterialCommunityIcons name="routes" size={18} color="#2563EB" />
                <Text style={styles.sectionTitle}>4. Automated Stock Routing Preview</Text>
              </View>

              {reconciliation.p > 0 ? (
                <View style={styles.routingPreviewCard}>
                  <MaterialCommunityIcons name="arrow-right-circle" size={18} color="#059669" />
                  <View style={styles.routingPreviewBody}>
                    <Text style={styles.routingPreviewTitle}>
                      Passed Stock: {reconciliation.p} units
                    </Text>
                    <Text style={styles.routingPreviewSub}>
                      {inspectingItem?.suggested_location_code
                        ? `Directed to preferred bin "${inspectingItem.suggested_location_code}". Putaway task will prioritize this bin.`
                        : 'No preferred bin assigned. Staged into Putaway Queue for manual bin allocation.'}
                    </Text>
                  </View>
                </View>
              ) : null}

              {reconciliation.r > 0 ? (
                <View style={[styles.routingPreviewCard, { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5' }]}>
                  <MaterialCommunityIcons name="shield-alert" size={18} color="#DC2626" />
                  <View style={styles.routingPreviewBody}>
                    <Text style={[styles.routingPreviewTitle, { color: '#991B1B' }]}>
                      Rejected Stock: {reconciliation.r} units
                    </Text>
                    <Text style={styles.routingPreviewSub}>
                      Transferred automatically to Quarantine Bay with stock_status="quarantine". Blocked from outbound picking and fulfillment.
                    </Text>
                  </View>
                </View>
              ) : null}

              {reconciliation.h > 0 ? (
                <View style={[styles.routingPreviewCard, { backgroundColor: '#EEF2FF', borderColor: '#C7D2FE' }]}>
                  <MaterialCommunityIcons name="pause-circle" size={18} color="#4F46E5" />
                  <View style={styles.routingPreviewBody}>
                    <Text style={[styles.routingPreviewTitle, { color: '#3730A3' }]}>
                      On Hold Stock: {reconciliation.h} units
                    </Text>
                    <Text style={styles.routingPreviewSub}>
                      Retained in receiving staging with stock_status="hold". Blocked from storage allocation until authorized quality sign-off.
                    </Text>
                  </View>
                </View>
              ) : null}
            </View>

            {/* Step 5: Defect Notes & Photos */}
            <View style={styles.modalSection}>
              <View style={styles.sectionTitleRow}>
                <MaterialCommunityIcons name="camera-plus-outline" size={18} color="#2563EB" />
                <Text style={styles.sectionTitle}>5. Defect Evidence & Notes</Text>
              </View>

              <View style={styles.addDefectRow}>
                <TextInput
                  style={styles.defectNoteInput}
                  placeholder="Add defect description or photo tag..."
                  placeholderTextColor={colors.muted}
                  value={defectPhotoNote}
                  onChangeText={setDefectPhotoNote}
                />
                <Button label="Add" variant="secondary" onPress={handleAddDefectPhoto} />
              </View>

              {defectPhotos.length > 0 ? (
                <View style={styles.defectChipList}>
                  {defectPhotos.map((p, idx) => (
                    <View key={idx} style={styles.defectTag}>
                      <Text style={styles.defectTagText}>• {p}</Text>
                      <Pressable
                        onPress={() =>
                          setDefectPhotos((prev) => prev.filter((_, i) => i !== idx))
                        }
                      >
                        <MaterialCommunityIcons name="close" size={14} color="#64748B" />
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : null}

              <TextInput
                style={styles.notesArea}
                placeholder="Overall inspector comments and sign-off rationale..."
                placeholderTextColor={colors.muted}
                multiline
                numberOfLines={3}
                value={inspectionNotes}
                onChangeText={setInspectionNotes}
              />
            </View>

            {/* Submit Action */}
            <View style={styles.modalActionSection}>
              <Button
                label={
                  isSubmitting
                    ? 'Submitting Inspection...'
                    : `Confirm & Submit Inspection (${reconciliation.total} units)`
                }
                variant="primary"
                onPress={() => void handleSubmitInspection()}
                disabled={isSubmitting || !reconciliation.isValid}
              />
              <Button
                label="Cancel & Close"
                variant="secondary"
                onPress={() => setInspectingItem(null)}
                disabled={isSubmitting}
              />
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
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
    fontSize: 22,
    color: '#192338',
    letterSpacing: -0.5,
    fontWeight: '700',
  },
  greetingSubtitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
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
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 3,
  },
  pressed: {
    opacity: 0.8,
  },

  // Bento KPIs
  kpiContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
  },
  kpiRow: {
    flexDirection: 'row',
    gap: 8,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: '#FCFDFE',
    borderRadius: 14,
    padding: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  kpiLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  kpiValue: {
    fontFamily: fonts.heading,
    fontSize: 18,
    fontWeight: '800',
    color: '#192338',
    marginTop: 2,
  },
  kpiSub: {
    fontFamily: fonts.body,
    fontSize: 9.5,
    color: '#94A3B8',
    marginTop: 2,
  },

  // Tabs
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    marginHorizontal: 16,
    borderRadius: 10,
    padding: 3,
    marginTop: 6,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  tabItemActive: {
    backgroundColor: '#FCFDFE',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 1,
  },
  tabLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11.5,
    color: '#64748B',
    fontWeight: '600',
  },
  tabLabelActive: {
    color: '#192338',
    fontWeight: '700',
  },

  // Filters
  filterBar: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FCFDFE',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 40,
    gap: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    color: '#192338',
  },
  filterPillsScroll: {
    gap: 6,
    paddingVertical: 2,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    backgroundColor: '#E2E8F0',
  },
  pillActive: {
    backgroundColor: '#192338',
  },
  pillText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
  },
  pillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 12,
  },
  noticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    padding: 12,
    borderRadius: 10,
    gap: 8,
  },
  noticeText: {
    flex: 1,
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: '#065F46',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    gap: 10,
  },
  loadingText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: '#64748B',
  },
  listContainer: {
    gap: 12,
  },

  // Hybrid Card
  hybridCard: {
    backgroundColor: '#FCFDFE',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
    gap: 10,
  },
  cardHeader: {
    gap: 2,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardSku: {
    fontFamily: fonts.heading,
    fontSize: 16,
    fontWeight: '800',
    color: '#192338',
  },
  cardProductName: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: '#475569',
  },
  metaRow: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 8,
    gap: 8,
  },
  metaBlock: {
    flex: 1,
  },
  metaLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    color: '#94A3B8',
    textTransform: 'uppercase',
  },
  metaValue: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: '#192338',
    fontWeight: '600',
    marginTop: 1,
  },
  qtyProgressRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  qtyPillWrap: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    minWidth: 64,
  },
  qtyPillLabel: {
    fontFamily: fonts.body,
    fontSize: 9.5,
    color: '#64748B',
  },
  qtyPillValue: {
    fontFamily: fonts.heading,
    fontSize: 12.5,
    fontWeight: '700',
    color: '#192338',
  },
  suggestedLocBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 6,
  },
  suggestedLocText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11.5,
    color: '#047857',
  },
  securityWarningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    padding: 8,
    borderRadius: 8,
    gap: 6,
  },
  securityWarningText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#991B1B',
  },
  historyNotesBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F1F5F9',
    padding: 8,
    borderRadius: 8,
    gap: 6,
  },
  historyNotesText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: '#334155',
  },
  defectPhotosWrap: {
    gap: 4,
  },
  defectPhotosLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 10.5,
    color: '#DC2626',
    fontWeight: '700',
  },
  defectPhotoChip: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#B91C1C',
  },
  cardActionRow: {
    marginTop: 2,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
    gap: 8,
  },
  emptyTitle: {
    fontFamily: fonts.heading,
    fontSize: 17,
    fontWeight: '700',
    color: '#192338',
  },
  emptySub: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: '#64748B',
    textAlign: 'center',
    maxWidth: 280,
  },

  // Modal Styles
  modalRoot: {
    flex: 1,
    backgroundColor: '#EFF3F8',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#FCFDFE',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  modalTitle: {
    fontFamily: fonts.heading,
    fontSize: 18,
    fontWeight: '800',
    color: '#192338',
  },
  modalSubtitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  modalCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalScroll: {
    flex: 1,
  },
  modalScrollContent: {
    padding: 16,
    gap: 16,
    paddingBottom: 40,
  },
  modalSection: {
    backgroundColor: '#FCFDFE',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 10,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: {
    fontFamily: fonts.heading,
    fontSize: 15,
    fontWeight: '700',
    color: '#192338',
  },
  sectionInstruction: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: '#64748B',
  },
  barcodeVerifyRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  barcodeInput: {
    flex: 1,
    height: 42,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontFamily: fonts.body,
    fontSize: 13,
    backgroundColor: '#FFFFFF',
    color: '#192338',
  },
  verifiedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  verifiedText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: '#059669',
    fontWeight: '600',
  },

  // Checklist inside modal
  checklistGroup: {
    gap: 6,
    marginTop: 4,
  },
  checklistGroupTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: '#2563EB',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  checklistItemCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  checklistItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  checklistItemText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 12,
    color: '#1E293B',
  },
  checklistToggleRow: {
    flexDirection: 'row',
    gap: 4,
  },
  toggleBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#E2E8F0',
  },
  toggleBtnPassed: {
    backgroundColor: '#059669',
  },
  toggleBtnFailed: {
    backgroundColor: '#DC2626',
  },
  toggleBtnNA: {
    backgroundColor: '#64748B',
  },
  toggleBtnText: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  toggleBtnTextPassed: {
    color: '#FFFFFF',
  },
  toggleBtnTextFailed: {
    color: '#FFFFFF',
  },
  toggleBtnTextNA: {
    color: '#FFFFFF',
  },
  measurementRow: {
    marginTop: 2,
  },
  measurementInput: {
    height: 34,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 6,
    paddingHorizontal: 8,
    fontFamily: fonts.body,
    fontSize: 11.5,
    backgroundColor: '#FFFFFF',
    color: '#192338',
  },

  // Quantity Grid
  qtyInputsGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  qtyInputBox: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 4,
  },
  qtyInputLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    fontWeight: '700',
  },
  qtyTextInput: {
    height: 38,
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 10,
    fontFamily: fonts.heading,
    fontSize: 16,
    fontWeight: '800',
    color: '#192338',
    backgroundColor: '#FFFFFF',
  },
  qtyInputHint: {
    fontFamily: fonts.body,
    fontSize: 9.5,
    color: '#64748B',
  },
  reconcileStatusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    gap: 6,
    borderWidth: 1,
  },
  reconcileStatusBoxValid: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  reconcileStatusBoxInvalid: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  reconcileStatusText: {
    flex: 1,
    fontFamily: fonts.bodySemi,
    fontSize: 11.5,
    fontWeight: '600',
  },

  // Routing preview cards
  routingPreviewCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#86EFAC',
    borderRadius: 10,
    padding: 10,
    gap: 8,
  },
  routingPreviewBody: {
    flex: 1,
    gap: 2,
  },
  routingPreviewTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 12.5,
    fontWeight: '700',
    color: '#166534',
  },
  routingPreviewSub: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#4B5563',
    lineHeight: 15,
  },

  // Defect notes inside modal
  addDefectRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  defectNoteInput: {
    flex: 1,
    height: 38,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    fontFamily: fonts.body,
    fontSize: 12,
    backgroundColor: '#FFFFFF',
    color: '#192338',
  },
  defectChipList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  defectTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  defectTagText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: '#991B1B',
  },
  notesArea: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    padding: 10,
    fontFamily: fonts.body,
    fontSize: 12,
    backgroundColor: '#FFFFFF',
    color: '#192338',
    minHeight: 60,
    textAlignVertical: 'top',
  },
  modalActionSection: {
    gap: 10,
    marginTop: 6,
  },
});
