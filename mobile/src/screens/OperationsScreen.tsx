import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { useWorkspace } from '../data';
import { draftReceipts } from '../logistics';
import { fonts } from '../theme';
import type { OutboundOrder, PutawayTask } from '../types';

interface OperationsScreenProps {
  onOpenReceive: () => void;
  onOpenItems: () => void;
  onOpenPutaway: () => void;
  onOpenOutbound: () => void;
  onOpenTransfer: () => void;
  onOpenPurchaseOrders?: () => void;
  onOpenReorder?: () => void;
  onOpenQuality?: () => void;
  onOpenCycleCount?: () => void;
  onOpenAdjustment?: () => void;
}

export function OperationsScreen({
  onOpenReceive,
  onOpenItems,
  onOpenPutaway,
  onOpenOutbound,
  onOpenTransfer,
  onOpenPurchaseOrders,
  onOpenReorder,
  onOpenQuality,
  onOpenCycleCount,
  onOpenAdjustment,
}: OperationsScreenProps) {
  const insets = useSafeAreaInsets();
  const { state: authState } = useAuth();
  const {
    activeClient,
    activeClientId,
    internalClient,
    inventoryOwners,
    isMultiOwner,
    warehouses,
    receipts,
    items,
    pendingSyncCount,
    refresh,
    loading: workspaceLoading,
  } = useWorkspace();

  const session = authState.status === 'signedIn' ? authState.session : null;
  const permissions = session?.permissions ?? [];
  const canReceive = permissions.includes('stock.receive');
  const canPutaway = permissions.includes('stock.putaway');
  const canIssue = permissions.includes('stock.issue');
  const canTransfer = permissions.includes('stock.transfer');
  const canReadInventory = permissions.includes('inventory.read');
  const canWriteItems = permissions.includes('inventory.write');
  const canManagePurchasing = permissions.includes('purchasing.manage');

  const [putawayTasks, setPutawayTasks] = useState<PutawayTask[] | null>(null);
  const [outboundOrders, setOutboundOrders] = useState<OutboundOrder[] | null>(null);
  const [activeTransfersCount, setActiveTransfersCount] = useState<number | null>(null);
  const [pendingInspectionCount, setPendingInspectionCount] = useState<number | null>(null);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const warehouseContext = useMemo(() => {
    const assignedIds = session?.membership?.warehouse_ids ?? [];
    if (assignedIds.length > 0) {
      const assigned = warehouses.filter((w) => assignedIds.includes(w.id));
      if (assigned.length === 1) return assigned[0].name;
      if (assigned.length > 1) return `${assigned.length} facilities`;
    }
    if (warehouses.length === 1) return warehouses[0].name;
    if (warehouses.length > 1) return `${warehouses.length} facilities`;
    return 'Main facility';
  }, [session?.membership?.warehouse_ids, warehouses]);

  const loadCounts = useCallback(async () => {
    if (!session) return;
    setTasksError(null);
    try {
      const promises: [
        Promise<PutawayTask[] | null>,
        Promise<OutboundOrder[] | null>,
        Promise<number | null>,
        Promise<number | null>,
      ] = [
        canReadInventory || canPutaway
          ? api
              .putawayTasks({ status: 'pending', clientId: activeClientId })
              .then((res) => res.tasks)
              .catch((err) => {
                if (err instanceof ApiError && (err.status === 403 || err.status === 401)) {
                  return null;
                }
                throw err;
              })
          : Promise.resolve(null),
        canReadInventory || canIssue
          ? api
              .outboundOrders({ clientId: activeClientId })
              .then((res) => res.orders)
              .catch((err) => {
                if (err instanceof ApiError && (err.status === 403 || err.status === 401)) {
                  return null;
                }
                throw err;
              })
          : Promise.resolve(null),
        canReadInventory || canTransfer
          ? api
              .transfers({ status: 'active', clientId: activeClientId })
              .then((res) => {
                const active = res.transfers.filter(
                  (t) => t.status === 'draft' || t.status === 'in_transit',
                );
                return active.length;
              })
              .catch((err) => {
                if (err instanceof ApiError && (err.status === 403 || err.status === 401)) {
                  return null;
                }
                throw err;
              })
          : Promise.resolve(null),
        canReadInventory
          ? api
              .getInspectionQueue()
              .then((res) => {
                const pending = res.filter(
                  (i) => i.inspection_status === 'pending' || Number(i.pending_quantity) > 0,
                );
                return pending.length;
              })
              .catch((err) => {
                if (err instanceof ApiError && (err.status === 403 || err.status === 401)) {
                  return null;
                }
                throw err;
              })
          : Promise.resolve(null),
      ];

      const [putawayResult, outboundResult, transfersResult, inspectionResult] =
        await Promise.all(promises);
      setPutawayTasks(putawayResult);
      setOutboundOrders(outboundResult);
      setActiveTransfersCount(transfersResult);
      setPendingInspectionCount(inspectionResult);
    } catch (caught) {
      setTasksError(
        caught instanceof ApiError ? caught.message : 'Task queues could not be loaded.',
      );
    } finally {
      setLoadingTasks(false);
    }
  }, [session, canReadInventory, canPutaway, canIssue, canTransfer, activeClientId]);

  useEffect(() => {
    setLoadingTasks(true);
    void loadCounts();
  }, [loadCounts]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([refresh(), loadCounts()]);
    } finally {
      setRefreshing(false);
    }
  };

  const pendingReceiptsCount = useMemo(() => {
    if (!canReadInventory && !canReceive) return null;
    return draftReceipts(receipts).length;
  }, [canReadInventory, canReceive, receipts]);

  const pendingPutawayCount = useMemo(() => {
    if (!canReadInventory && !canPutaway) return null;
    if (putawayTasks === null) return null;
    return putawayTasks.filter((task) => task.status === 'pending').length;
  }, [canReadInventory, canPutaway, putawayTasks]);

  const openOutboundCount = useMemo(() => {
    if (!canReadInventory && !canIssue) return null;
    if (outboundOrders === null) return null;
    return outboundOrders.filter(
      (order) => order.status === 'draft' || order.status === 'allocated',
    ).length;
  }, [canReadInventory, canIssue, outboundOrders]);

  const totalPending =
    (pendingReceiptsCount ?? 0) +
    (pendingPutawayCount ?? 0) +
    (openOutboundCount ?? 0) +
    (activeTransfersCount ?? 0);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Math.max(insets.top + 12, 22),
            paddingBottom: 16,
          },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#192338"
            colors={['#192338']}
          />
        }
      >
        {/* Top Header: Pure Logo (NO box or object around it) + Title */}
        <View style={styles.topHeader}>
          <View style={styles.headerLeft}>
            <Image
              source={require('../../assets/ntan-hexagon-logo.png')}
              style={styles.logoImage}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
            <View style={styles.greetingBox}>
              <Text style={styles.greetingTitle}>Operations</Text>
              <Text style={styles.greetingSubtitle} numberOfLines={1}>
                {totalPending} Tasks in Queue · {warehouseContext}
              </Text>
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh operations queues"
            onPress={handleRefresh}
            style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
          >
            <MaterialCommunityIcons name="sync" size={19} color="#192338" />
          </Pressable>
        </View>

        {/* =========================================================================
            BENTO KPIS AT TOP
            ========================================================================= */}

        {/* HERO COMMAND CARD (NAVY BLUE FEATURE #1) */}
        <View style={styles.bentoHeroNavy}>
          <View style={styles.bentoHeroTopRow}>
            <View style={styles.bentoHeroTag}>
              <View style={styles.pulseDot} />
              <Text style={styles.bentoHeroTagText}>FLOOR WORKFLOW COMMAND</Text>
            </View>
            <Text style={styles.bentoHeroWarehouseBadge}>{warehouseContext}</Text>
          </View>

          <View style={styles.bentoHeroMainMetric}>
            <Text style={styles.bentoHeroNumber}>{loadingTasks ? '—' : totalPending}</Text>
            <Text style={styles.bentoHeroUnit}>Active Tasks Requiring Action</Text>
          </View>

          {/* Dual Inset Capsules */}
          <View style={styles.bentoHeroCapsulesRow}>
            <View style={styles.bentoHeroCapsule}>
              <View style={[styles.capsuleIconDot, { backgroundColor: '#10B981' }]}>
                <MaterialCommunityIcons name="arrow-down-left" size={12} color="#FFFFFF" />
              </View>
              <View style={styles.capsuleTextWrap}>
                <Text style={styles.capsuleLabel}>Inbound Flow</Text>
                <Text style={styles.capsuleValue}>
                  {pendingReceiptsCount ?? 0} draft · {pendingPutawayCount ?? 0} putaway
                </Text>
              </View>
            </View>

            <View style={styles.bentoHeroCapsule}>
              <View style={[styles.capsuleIconDot, { backgroundColor: '#3B82F6' }]}>
                <MaterialCommunityIcons name="arrow-up-right" size={12} color="#FFFFFF" />
              </View>
              <View style={styles.capsuleTextWrap}>
                <Text style={styles.capsuleLabel}>Outbound Flow</Text>
                <Text style={styles.capsuleValue}>
                  {openOutboundCount ?? 0} orders · {activeTransfersCount ?? 0} moves
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* BENTO 2-COLUMN DUO */}
        <View style={styles.bentoSplitRow}>
          {/* Tile A: Sync Status (Light Hybrid #FCFDFE) */}
          <View style={[styles.bentoTile, styles.bentoTileLight]}>
            <View style={styles.tileHeaderRow}>
              <Text style={styles.tileTitleLight}>Terminal Sync</Text>
              <View
                style={[
                  styles.syncIndicatorDot,
                  { backgroundColor: pendingSyncCount === 0 ? '#10B981' : '#F59E0B' },
                ]}
              />
            </View>
            <View style={styles.tileMetricWrap}>
              <Text style={styles.tileNumberLight}>
                {pendingSyncCount === 0 ? 'Live' : pendingSyncCount}
              </Text>
              <Text style={styles.tileSubLight}>
                {pendingSyncCount === 0 ? 'All changes synced' : 'Operations queued'}
              </Text>
            </View>
          </View>

          {/* Tile B: Outbound Wave (NAVY BLUE FEATURE #2 #192338) */}
          <Pressable
            onPress={onOpenOutbound}
            style={[styles.bentoTile, styles.bentoTileNavy]}
          >
            <View style={styles.tileHeaderRow}>
              <Text style={styles.tileTitleNavy}>Outbound Wave</Text>
              <MaterialCommunityIcons name="chevron-right" size={18} color="#FFBF32" />
            </View>
            <View style={styles.tileMetricWrap}>
              <Text style={styles.tileNumberGold}>{openOutboundCount ?? 0}</Text>
              <Text style={styles.tileSubNavy}>Orders Ready for Picking</Text>
            </View>
          </Pressable>
        </View>

        {/* =========================================================================
            PRIMARY WORKFLOWS (HYBRID CARDS)
            ========================================================================= */}
        <View style={styles.sectionWrap}>
          <Text style={styles.sectionHeading}>Primary Workflows</Text>

          <View style={styles.workflowGrid}>
            {/* 1. Item Catalogue */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Item Catalogue"
              onPress={onOpenItems}
              style={({ pressed }) => [styles.workflowCard, pressed && styles.workflowCardPressed]}
            >
              <View style={styles.workflowCardHeader}>
                <View style={[styles.workflowIconCircle, { backgroundColor: '#EFF6FF' }]}>
                  <MaterialCommunityIcons name="format-list-bulleted-square" size={22} color="#2563EB" />
                </View>
                <View style={styles.workflowBadgePrimary}>
                  <Text style={styles.workflowBadgePrimaryText}>
                    {items.length} SKUs
                  </Text>
                </View>
              </View>

              <View style={styles.workflowContent}>
                <Text style={styles.workflowTitle}>Item Catalogue</Text>
                <Text style={styles.workflowSub}>Products, barcodes & tracking modes</Text>
              </View>
            </Pressable>

            {/* 2. Receive Stock */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Receive Stock"
              onPress={onOpenReceive}
              disabled={!canReceive}
              style={({ pressed }) => [styles.workflowCard, pressed && styles.workflowCardPressed]}
            >
              <View style={styles.workflowCardHeader}>
                <View style={[styles.workflowIconCircle, { backgroundColor: '#ECFDF5' }]}>
                  <MaterialCommunityIcons name="barcode-scan" size={22} color="#059669" />
                </View>
                {pendingReceiptsCount && pendingReceiptsCount > 0 ? (
                  <View style={styles.workflowBadgeWarning}>
                    <Text style={styles.workflowBadgeWarningText}>
                      {pendingReceiptsCount} Draft
                    </Text>
                  </View>
                ) : (
                  <View style={styles.workflowBadgeSuccess}>
                    <Text style={styles.workflowBadgeSuccessText}>Clear</Text>
                  </View>
                )}
              </View>

              <View style={styles.workflowContent}>
                <Text style={styles.workflowTitle}>Receive Stock</Text>
                <Text style={styles.workflowSub}>Inbound delivery scan & PO match</Text>
              </View>
            </Pressable>

            {/* 3. Quality & Inspection */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Quality & Inspection"
              onPress={onOpenQuality}
              disabled={!onOpenQuality || !canReadInventory}
              style={({ pressed }) => [styles.workflowCard, pressed && styles.workflowCardPressed]}
            >
              <View style={styles.workflowCardHeader}>
                <View style={[styles.workflowIconCircle, { backgroundColor: '#FEF2F2' }]}>
                  <MaterialCommunityIcons name="shield-check-outline" size={22} color="#EF4444" />
                </View>
                {pendingInspectionCount && pendingInspectionCount > 0 ? (
                  <View style={styles.workflowBadgeWarning}>
                    <Text style={styles.workflowBadgeWarningText}>
                      {pendingInspectionCount} Pending
                    </Text>
                  </View>
                ) : (
                  <View style={styles.workflowBadgeSuccess}>
                    <Text style={styles.workflowBadgeSuccessText}>Clear</Text>
                  </View>
                )}
              </View>

              <View style={styles.workflowContent}>
                <Text style={styles.workflowTitle}>Quality & Inspection</Text>
                <Text style={styles.workflowSub}>Checklists, defect routing & QC approval</Text>
              </View>
            </Pressable>

            {/* 4. Putaway Queue */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Putaway Queue"
              onPress={onOpenPutaway}
              disabled={!canPutaway}
              style={({ pressed }) => [styles.workflowCard, pressed && styles.workflowCardPressed]}
            >
              <View style={styles.workflowCardHeader}>
                <View style={[styles.workflowIconCircle, { backgroundColor: '#EFF6FF' }]}>
                  <MaterialCommunityIcons name="map-marker-path" size={22} color="#2563EB" />
                </View>
                {pendingPutawayCount && pendingPutawayCount > 0 ? (
                  <View style={styles.workflowBadgeWarning}>
                    <Text style={styles.workflowBadgeWarningText}>
                      {pendingPutawayCount} Pending
                    </Text>
                  </View>
                ) : (
                  <View style={styles.workflowBadgeSuccess}>
                    <Text style={styles.workflowBadgeSuccessText}>Clear</Text>
                  </View>
                )}
              </View>

              <View style={styles.workflowContent}>
                <Text style={styles.workflowTitle}>Putaway Queue</Text>
                <Text style={styles.workflowSub}>Staged goods to bin allocations</Text>
              </View>
            </Pressable>

            {/* 5. Pick & Dispatch (Outbound) */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Outbound Picking"
              onPress={onOpenOutbound}
              disabled={!canIssue}
              style={({ pressed }) => [styles.workflowCard, pressed && styles.workflowCardPressed]}
            >
              <View style={styles.workflowCardHeader}>
                <View style={[styles.workflowIconCircle, { backgroundColor: '#F5F3FF' }]}>
                  <MaterialCommunityIcons name="package-variant-closed" size={22} color="#7C3AED" />
                </View>
                {openOutboundCount && openOutboundCount > 0 ? (
                  <View style={styles.workflowBadgePrimary}>
                    <Text style={styles.workflowBadgePrimaryText}>
                      {openOutboundCount} Open
                    </Text>
                  </View>
                ) : (
                  <View style={styles.workflowBadgeSuccess}>
                    <Text style={styles.workflowBadgeSuccessText}>Clear</Text>
                  </View>
                )}
              </View>

              <View style={styles.workflowContent}>
                <Text style={styles.workflowTitle}>Dispatch & Pick</Text>
                <Text style={styles.workflowSub}>Order picking & customer packing</Text>
              </View>
            </Pressable>

            {/* 6. Stock Transfers */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Stock Transfers"
              onPress={onOpenTransfer}
              disabled={!canTransfer}
              style={({ pressed }) => [styles.workflowCard, pressed && styles.workflowCardPressed]}
            >
              <View style={styles.workflowCardHeader}>
                <View style={[styles.workflowIconCircle, { backgroundColor: '#FFFBEB' }]}>
                  <MaterialCommunityIcons name="swap-horizontal" size={22} color="#D97706" />
                </View>
                {activeTransfersCount && activeTransfersCount > 0 ? (
                  <View style={styles.workflowBadgeWarning}>
                    <Text style={styles.workflowBadgeWarningText}>
                      {activeTransfersCount} Active
                    </Text>
                  </View>
                ) : (
                  <View style={styles.workflowBadgeSuccess}>
                    <Text style={styles.workflowBadgeSuccessText}>Clear</Text>
                  </View>
                )}
              </View>

              <View style={styles.workflowContent}>
                <Text style={styles.workflowTitle}>Stock Transfer</Text>
                <Text style={styles.workflowSub}>Bin-to-bin & cross-site transfer</Text>
              </View>
            </Pressable>
          </View>
        </View>

        {/* =========================================================================
            INVENTORY AUDIT & QUALITY WORKFLOWS
            ========================================================================= */}
        <View style={styles.sectionWrap}>
          <Text style={styles.sectionHeading}>Inventory Audit & Management</Text>

          <View style={styles.utilityTilesRow}>
            {/* Cycle Count */}
            {onOpenCycleCount ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cycle Count"
                onPress={onOpenCycleCount}
                style={({ pressed }) => [styles.utilityTile, pressed && styles.utilityTilePressed]}
              >
                <View style={[styles.utilityIconWrap, { backgroundColor: '#FFFBEB' }]}>
                  <MaterialCommunityIcons name="clipboard-check-outline" size={18} color="#D97706" />
                </View>
                <Text style={styles.utilityTitle}>Cycle Count</Text>
              </Pressable>
            ) : null}

            {/* Adjustments */}
            {onOpenAdjustment ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Inventory Adjustments"
                onPress={onOpenAdjustment}
                style={({ pressed }) => [styles.utilityTile, pressed && styles.utilityTilePressed]}
              >
                <View style={[styles.utilityIconWrap, { backgroundColor: '#EFF6FF' }]}>
                  <MaterialCommunityIcons name="tune-variant" size={18} color="#2563EB" />
                </View>
                <Text style={styles.utilityTitle}>Adjustments</Text>
              </Pressable>
            ) : null}

            {/* Purchase Orders */}
            {onOpenPurchaseOrders ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Purchase Orders"
                onPress={onOpenPurchaseOrders}
                disabled={!canReadInventory}
                style={({ pressed }) => [styles.utilityTile, pressed && styles.utilityTilePressed]}
              >
                <View style={[styles.utilityIconWrap, { backgroundColor: '#ECFDF5' }]}>
                  <MaterialCommunityIcons name="file-document-outline" size={18} color="#059669" />
                </View>
                <Text style={styles.utilityTitle}>Orders</Text>
              </Pressable>
            ) : null}

            {/* Quality Inspection */}
            {onOpenQuality ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Quality Inspection"
                onPress={onOpenQuality}
                style={({ pressed }) => [styles.utilityTile, pressed && styles.utilityTilePressed]}
              >
                <View style={[styles.utilityIconWrap, { backgroundColor: '#FEF2F2' }]}>
                  <MaterialCommunityIcons name="shield-check-outline" size={18} color="#EF4444" />
                </View>
                <Text style={styles.utilityTitle}>Quality</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </View>
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

  // Top Header: Pure Logo with NO box or object around it
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
    gap: 14,
    flex: 1,
  },
  logoImage: {
    width: 52,
    height: 52,
  },
  greetingBox: {
    flex: 1,
    gap: 2,
    justifyContent: 'center',
  },
  greetingTitle: {
    fontFamily: fonts.heading,
    fontSize: 27,
    color: '#192338',
    letterSpacing: -0.5,
    lineHeight: 33,
  },
  greetingSubtitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: '#64748B',
    marginTop: 1,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FCFDFE',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderTopColor: '#FFFFFF',
    borderBottomColor: 'rgba(215, 225, 238, 0.7)',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  iconButtonPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.94 }],
  },

  // =========================================================================
  // BENTO KPIS
  // =========================================================================

  // Hero Bento Card (Navy Blue #192338)
  bentoHeroNavy: {
    backgroundColor: '#192338',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.28,
    shadowRadius: 26,
    elevation: 8,
    gap: 16,
  },
  bentoHeroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bentoHeroTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pulseDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  bentoHeroTagText: {
    fontFamily: fonts.heading,
    fontSize: 10,
    color: '#FFBF32',
    letterSpacing: 1.2,
    fontWeight: '800',
  },
  bentoHeroWarehouseBadge: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.75)',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  bentoHeroMainMetric: {
    gap: 2,
  },
  bentoHeroNumber: {
    fontFamily: fonts.heading,
    fontSize: 34,
    color: '#FFFFFF',
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  bentoHeroUnit: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: '#94A3B8',
  },
  bentoHeroCapsulesRow: {
    flexDirection: 'row',
    gap: 10,
  },
  bentoHeroCapsule: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 9,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  capsuleIconDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  capsuleTextWrap: {
    flex: 1,
    gap: 1,
  },
  capsuleLabel: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: '#94A3B8',
  },
  capsuleValue: {
    fontFamily: fonts.heading,
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // 2-Column Bento Duo
  bentoSplitRow: {
    flexDirection: 'row',
    gap: 12,
  },
  bentoTile: {
    flex: 1,
    borderRadius: 22,
    padding: 16,
    gap: 10,
    justifyContent: 'space-between',
  },
  bentoTileLight: {
    backgroundColor: '#FCFDFE',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderTopColor: '#FFFFFF',
    borderBottomColor: 'rgba(215, 225, 238, 0.75)',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 4,
  },
  tileHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tileTitleLight: {
    fontFamily: fonts.heading,
    fontSize: 14,
    color: '#192338',
  },
  syncIndicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  tileMetricWrap: {
    gap: 2,
  },
  tileNumberLight: {
    fontFamily: fonts.heading,
    fontSize: 22,
    color: '#192338',
    fontWeight: '800',
  },
  tileSubLight: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#64748B',
  },

  // Tile B: Navy Outbound Wave
  bentoTileNavy: {
    backgroundColor: '#192338',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 6,
  },
  tileTitleNavy: {
    fontFamily: fonts.heading,
    fontSize: 14,
    color: '#FFFFFF',
  },
  tileNumberGold: {
    fontFamily: fonts.heading,
    fontSize: 22,
    color: '#FFBF32',
    fontWeight: '800',
  },
  tileSubNavy: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#94A3B8',
  },

  // =========================================================================
  // WORKFLOW CARDS GRID (2x2)
  // =========================================================================
  sectionWrap: {
    gap: 12,
  },
  sectionHeading: {
    fontFamily: fonts.heading,
    fontSize: 16,
    color: '#192338',
    letterSpacing: -0.2,
  },
  workflowGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  workflowCard: {
    width: '48%',
    backgroundColor: '#FCFDFE',
    borderRadius: 22,
    padding: 16,
    gap: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderTopColor: '#FFFFFF',
    borderBottomColor: 'rgba(215, 225, 238, 0.75)',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 4,
  },
  workflowCardPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.97 }],
  },
  workflowCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  workflowIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workflowBadgeSuccess: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  workflowBadgeSuccessText: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    color: '#059669',
    fontWeight: '700',
  },
  workflowBadgeWarning: {
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  workflowBadgeWarningText: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    color: '#D97706',
    fontWeight: '700',
  },
  workflowBadgePrimary: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  workflowBadgePrimaryText: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    color: '#2563EB',
    fontWeight: '700',
  },
  workflowContent: {
    gap: 3,
  },
  workflowTitle: {
    fontFamily: fonts.heading,
    fontSize: 15,
    color: '#192338',
    fontWeight: '700',
  },
  workflowSub: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#64748B',
    lineHeight: 15,
  },

  // =========================================================================
  // UTILITY AUDIT TILES
  // =========================================================================
  utilityTilesRow: {
    flexDirection: 'row',
    gap: 10,
  },
  utilityTile: {
    flex: 1,
    backgroundColor: '#FCFDFE',
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderTopColor: '#FFFFFF',
    borderBottomColor: 'rgba(215, 225, 238, 0.75)',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  utilityTilePressed: {
    opacity: 0.85,
    transform: [{ scale: 0.96 }],
  },
  utilityIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  utilityTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: '#192338',
    fontWeight: '600',
    textAlign: 'center',
  },
});
