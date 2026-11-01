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
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Field } from '../components/Field';
import { useWorkspace } from '../data';
import { formatDate, formatQty } from '../format';
import {
  isPurchaseOrderReceivable,
  purchaseOrderStatusLabels,
  purchaseOrderStatusTones,
} from '../purchasing';
import { activeSupplierPartners } from '../supplierMapping';
import { colors, fonts, neo, palette, radius, spacing } from '../theme';
import type { PurchaseOrder, PurchaseOrderStatus } from '../types';

interface PurchaseOrdersScreenProps {
  onBack: () => void;
  onOpenOrder: (purchaseOrderId: string) => void;
  onOpenReorder: () => void;
  canReceive: boolean;
}

type StatusFilter = 'all' | PurchaseOrderStatus;

const statusFilters: StatusFilter[] = [
  'all',
  'open',
  'partially_received',
  'received',
  'cancelled',
];

export function PurchaseOrdersScreen({
  onBack,
  onOpenOrder,
  onOpenReorder,
  canReceive,
}: PurchaseOrdersScreenProps) {
  const insets = useSafeAreaInsets();
  const { activeClientId, warehouses, clients } = useWorkspace();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'initial') {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);
      try {
        const response = await api.purchaseOrders({
          status: statusFilter === 'all' ? undefined : statusFilter,
          supplierId: supplierFilter ?? undefined,
          search: searchQuery.trim() || undefined,
          clientId: activeClientId,
        });
        setOrders(response.orders);
      } catch (caught) {
        setError(
          caught instanceof ApiError
            ? caught.message
            : 'Could not load purchase orders. Check your connection and try again.',
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [activeClientId, statusFilter, supplierFilter, searchQuery],
  );

  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    void load();
  }, [load]);

  const supplierOptions = useMemo(() => activeSupplierPartners(clients), [clients]);

  const warehouseNames = useMemo(
    () => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.name])),
    [warehouses],
  );

  const openOrders = orders.filter(isPurchaseOrderReceivable).length;
  const orderedUnits = orders.reduce((total, order) => total + Number(order.ordered_qty), 0);
  const receivedUnits = orders.reduce((total, order) => total + Number(order.received_qty), 0);

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
          <Text style={styles.greetingTitle}>Purchase Orders</Text>
          <Text style={styles.greetingSubtitle} numberOfLines={1}>
            {orders.length} Orders • {openOrders} Awaiting Delivery
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reorder items"
          onPress={onOpenReorder}
          style={({ pressed }) => [styles.reorderBtn, pressed && styles.pressed]}
        >
          <MaterialCommunityIcons name="cart-plus" size={20} color="#192338" />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
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
            <Text style={styles.metricLabelLight}>AWAITING DELIVERY</Text>
            <Text style={styles.metricValueLight}>{openOrders}</Text>
            <Text style={styles.metricHintLight}>Open or partially received</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>RECEIVED / ORDERED</Text>
            <Text style={styles.metricValue}>
              {formatQty(String(receivedUnits))} / {formatQty(String(orderedUnits))}
            </Text>
            <Text style={styles.metricHint}>Across visible orders</Text>
          </View>
        </View>

        <View style={styles.filterBlock}>
          <Text style={styles.filterLabel}>STATUS</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chipRow}>
              {statusFilters.map((status) => (
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
                    {status === 'all' ? 'All orders' : purchaseOrderStatusLabels[status]}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>

        <View style={styles.filterBlock}>
          <Text style={styles.filterLabel}>SUPPLIER</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chipRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: supplierFilter === null }}
                onPress={() => setSupplierFilter(null)}
                style={[styles.chip, supplierFilter === null && styles.chipActive]}
              >
                <Text
                  style={[
                    styles.chipText,
                    supplierFilter === null && styles.chipTextActive,
                  ]}
                >
                  All suppliers
                </Text>
              </Pressable>
              {supplierOptions.map((supplier) => (
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

        <Field
          label="Search orders"
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder="Order number, supplier, item, internal or supplier SKU"
          autoCapitalize="none"
        />

        {error ? (
          <View style={styles.errorBox}>
            <MaterialCommunityIcons name="cloud-alert-outline" size={20} color={colors.danger} />
            <View style={styles.errorTextWrap}>
              <Text style={styles.errorTitle}>Could not load purchase orders</Text>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable onPress={() => void load()} accessibilityRole="button">
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Loading purchase orders…</Text>
          </View>
        ) : orders.length === 0 ? (
          <EmptyState
            icon="clipboard-text-outline"
            title={statusFilter === 'all' ? 'No purchase orders yet' : 'No orders with this status'}
            message={
              statusFilter === 'all'
                ? 'Create an order from Reorder Needed to start tracking incoming stock.'
                : 'Adjust the status filter or review replenishment needs.'
            }
            actionLabel="Review reorder needs"
            onAction={onOpenReorder}
          />
        ) : (
          <View style={styles.list}>
            {orders.map((order) => {
              const receivable = isPurchaseOrderReceivable(order);
              return (
                <Pressable
                  key={order.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open purchase order ${order.number}`}
                  onPress={() => onOpenOrder(order.id)}
                  style={({ pressed }) => [styles.orderCard, pressed && styles.pressed]}
                >
                  <View style={styles.orderHeader}>
                    <View style={styles.orderTitleWrap}>
                      <Text style={styles.orderNumber}>{order.number}</Text>
                      <Text style={styles.orderSupplier}>{order.supplier_name}</Text>
                    </View>
                    <Badge
                      label={purchaseOrderStatusLabels[order.status]}
                      tone={purchaseOrderStatusTones[order.status]}
                    />
                  </View>

                  <View style={styles.orderMetaRow}>
                    <MaterialCommunityIcons name="warehouse" size={14} color={colors.muted} />
                    <Text style={styles.orderMeta}>
                      {warehouseNames.get(order.warehouse_id) ?? 'Warehouse unavailable'}
                    </Text>
                    {order.expected_date ? (
                      <>
                        <MaterialCommunityIcons
                          name="calendar-clock-outline"
                          size={14}
                          color={colors.muted}
                        />
                        <Text style={styles.orderMeta}>
                          Expected {formatDate(order.expected_date)}
                        </Text>
                      </>
                    ) : null}
                  </View>

                  <View style={styles.metricsGrid}>
                    <OrderMetric label="Ordered" value={order.ordered_qty} uom={order.lines[0]?.base_uom} />
                    <OrderMetric
                      label="Received"
                      value={order.received_qty}
                      uom={order.lines[0]?.base_uom}
                    />
                    <OrderMetric
                      label="Remaining"
                      value={order.remaining_qty}
                      uom={order.lines[0]?.base_uom}
                      highlight
                    />
                  </View>

                  <View style={styles.orderFooter}>
                    <Text style={styles.orderFooterText}>
                      {order.line_count} line{order.line_count === 1 ? '' : 's'}
                      {receivable && canReceive ? ' · ready to receive' : ''}
                    </Text>
                    <View style={styles.orderOpen}>
                      <Text style={styles.orderOpenText}>
                        {receivable && canReceive ? 'Receive' : 'View'}
                      </Text>
                      <MaterialCommunityIcons
                        name="chevron-right"
                        size={16}
                        color={colors.primary}
                      />
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        <Button label="Back to receiving" variant="ghost" onPress={onBack} />
      </ScrollView>
    </View>
  );
}

function OrderMetric({
  label,
  value,
  uom,
  highlight = false,
}: {
  label: string;
  value: string;
  uom?: string;
  highlight?: boolean;
}) {
  return (
    <View style={[styles.metricCell, highlight && styles.metricCellHighlight]}>
      <Text style={styles.metricCellLabel}>{label}</Text>
      <Text style={[styles.metricCellValue, highlight && styles.metricCellValueHighlight]}>
        {formatQty(value)}
      </Text>
      {uom ? <Text style={styles.metricCellUom}>{uom}</Text> : null}
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
    opacity: 0.75,
  },
  headingText: {
    flex: 1,
    gap: 2,
  },
  eyebrow: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.8,
    color: colors.muted,
  },
  title: {
    fontFamily: fonts.heading,
    fontSize: 26,
    color: colors.navy,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 20,
    color: colors.muted,
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
    fontSize: 21,
    color: palette.ink,
  },
  metricValueLight: {
    fontFamily: fonts.outfitExtraBold,
    fontSize: 24,
    color: colors.white,
  },
  metricHint: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 10,
    color: palette.muted,
  },
  metricHintLight: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 10,
    color: 'rgba(255,255,255,0.55)',
  },
  filterBlock: {
    gap: spacing.xs,
  },
  filterLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.muted,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingVertical: 2,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.62)',
    borderWidth: 1,
    borderColor: palette.glassBorder,
  },
  chipActive: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  chipText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.muted,
  },
  chipTextActive: {
    color: colors.white,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorTextWrap: {
    flex: 1,
    gap: 3,
  },
  errorTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.danger,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.text,
  },
  retryText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.primary,
    paddingTop: 2,
  },
  loading: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  loadingText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
  list: {
    gap: spacing.md,
  },
  orderCard: {
    backgroundColor: palette.glass,
    borderRadius: radius.xl,
    borderWidth: 1.1,
    borderColor: palette.glassBorder,
    padding: spacing.lg,
    gap: spacing.sm,
    ...neo.soft,
  },
  orderHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  orderTitleWrap: {
    flex: 1,
    gap: 2,
  },
  orderNumber: {
    fontFamily: fonts.heading,
    fontSize: 17,
    color: colors.navy,
  },
  orderSupplier: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
  orderMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  orderMeta: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
    marginRight: spacing.sm,
  },
  metricsGrid: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  metricCell: {
    flex: 1,
    backgroundColor: '#F3F7FA',
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: 1,
  },
  metricCellHighlight: {
    backgroundColor: '#EAF1FF',
  },
  metricCellLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    letterSpacing: 0.8,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  metricCellValue: {
    fontFamily: fonts.heading,
    fontSize: 17,
    color: colors.navy,
  },
  metricCellValueHighlight: {
    color: colors.primary,
  },
  metricCellUom: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  orderFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  orderFooterText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  orderOpen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  orderOpenText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.primary,
  },
});
