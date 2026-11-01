import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { SectionLabel } from '../components/ui';
import { useWorkspace } from '../data';
import { formatDate, formatDateTime, formatQty } from '../format';
import {
  buildPurchaseOrderReceiveDraft,
  isPurchaseOrderReceivable,
  purchaseOrderStatusLabels,
  purchaseOrderStatusTones,
} from '../purchasing';
import { getReceiveDraft, setReceiveDraft } from '../receiveDraftStore';
import { colors, fonts, neo, palette, radius, spacing } from '../theme';
import type { PurchaseOrder } from '../types';

interface PurchaseOrderDetailScreenProps {
  purchaseOrderId: string;
  onBack: () => void;
  onReceiveOrder: () => void;
  onOpenReorder: () => void;
}

export function PurchaseOrderDetailScreen({
  purchaseOrderId,
  onBack,
  onReceiveOrder,
  onOpenReorder,
}: PurchaseOrderDetailScreenProps) {
  const insets = useSafeAreaInsets();
  const { state } = useAuth();
  const { warehouses, refresh: refreshWorkspace } = useWorkspace();
  const [order, setOrder] = useState<PurchaseOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const permissions = state.status === 'signedIn' ? state.session.permissions : [];
  const canReceive = permissions.includes('stock.receive');
  const canManagePurchasing = permissions.includes('purchasing.manage');

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'initial') {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);
      try {
        setOrder(await api.purchaseOrder(purchaseOrderId));
      } catch (caught) {
        setError(
          caught instanceof ApiError
            ? caught.message
            : 'The purchase order could not be loaded.',
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [purchaseOrderId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const warehouse = warehouses.find((entry) => entry.id === order?.warehouse_id);
  const receivable = order ? isPurchaseOrderReceivable(order) : false;
  const receivedAny = order ? Number(order.received_qty) > 0 : false;
  const cancellable = Boolean(
    order && order.status === 'open' && !receivedAny && canManagePurchasing,
  );

  const receive = () => {
    if (!order) {
      return;
    }
    const apply = () => {
      setReceiveDraft(buildPurchaseOrderReceiveDraft(order, () => randomUUID()));
      onReceiveOrder();
    };
    const existing = getReceiveDraft();
    const hasDraftContent =
      Boolean(existing?.pendingReceipt) ||
      Boolean(existing?.lines.some((line) => line.itemId || line.qty));
    if (hasDraftContent) {
      Alert.alert(
        'Replace the current receive form?',
        'Your in-progress receipt will be replaced by the outstanding quantities on this order.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Replace and continue', style: 'destructive', onPress: apply },
        ],
      );
      return;
    }
    apply();
  };

  const cancel = () => {
    if (!order) {
      return;
    }
    Alert.alert(
      'Cancel purchase order?',
      `${order.number} will stop counting towards incoming stock. Orders with received stock cannot be cancelled.`,
      [
        { text: 'Keep order', style: 'cancel' },
        {
          text: 'Cancel order',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setCancelling(true);
              setError(null);
              try {
                const updated = await api.cancelPurchaseOrder(order.id);
                setOrder(updated);
                await refreshWorkspace();
              } catch (caught) {
                setError(
                  caught instanceof ApiError
                    ? caught.message
                    : 'The purchase order could not be cancelled.',
                );
              } finally {
                setCancelling(false);
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top + 12, 22) }]}>
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
          <Text style={styles.greetingTitle} numberOfLines={1}>
            {order?.number ?? 'Purchase Order'}
          </Text>
          <Text style={styles.greetingSubtitle} numberOfLines={1}>
            PO Details & Reconciliation
          </Text>
        </View>
        {order ? (
          <Badge
            label={purchaseOrderStatusLabels[order.status]}
            tone={purchaseOrderStatusTones[order.status]}
          />
        ) : null}
      </View>

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load('refresh')}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBox}>
          <MaterialCommunityIcons name="alert-circle-outline" size={20} color={colors.danger} />
          <View style={styles.errorBody}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => void load()}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {order ? (
        <>
          <View style={styles.statusCard}>
            <View pointerEvents="none" style={styles.statusGlow} />
            <View style={styles.statusIcon}>
              <MaterialCommunityIcons
                name={
                  order.status === 'received'
                    ? 'check-decagram-outline'
                    : order.status === 'cancelled'
                      ? 'cancel'
                      : 'truck-delivery-outline'
                }
                size={24}
                color={palette.ink}
              />
            </View>
            <View style={styles.statusBody}>
              <Text style={styles.statusEyebrow}>
                {purchaseOrderStatusLabels[order.status]}
              </Text>
              <Text style={styles.statusTitle} numberOfLines={1}>
                {order.supplier_name}
              </Text>
              <Text style={styles.statusText}>
                {order.status === 'received'
                  ? 'All quantities received.'
                  : order.status === 'cancelled'
                    ? 'Excluded from incoming stock.'
                    : order.status === 'partially_received'
                      ? 'Balance still outstanding.'
                      : 'Awaiting first receipt.'}
              </Text>
            </View>
          </View>

          <View style={styles.quantityGrid}>
            <QuantityCell label="Ordered" value={order.ordered_qty} />
            <QuantityCell label="Received" value={order.received_qty} />
            <QuantityCell label="Remaining" value={order.remaining_qty} highlight />
          </View>

          <View style={styles.detailCard}>
            <DetailRow label="Supplier" value={order.supplier_name} />
            <DetailRow label="Warehouse" value={warehouse?.name ?? order.warehouse_id} />
            <DetailRow
              label="Expected"
              value={order.expected_date ? formatDate(order.expected_date) : 'Not scheduled'}
            />
            <DetailRow label="Created" value={formatDateTime(order.created_at)} />
            {order.received_at ? (
              <DetailRow label="Fully received" value={formatDateTime(order.received_at)} />
            ) : null}
            {order.cancelled_at ? (
              <DetailRow label="Cancelled" value={formatDateTime(order.cancelled_at)} />
            ) : null}
            {order.note ? <DetailRow label="Note" value={order.note} /> : null}
          </View>

          {receivable && canReceive ? (
            <Button label="Receive against this order" onPress={receive} />
          ) : null}
          {receivable && !canReceive ? (
            <Text style={styles.hint}>
              Your role can view this order but not post receipts.
            </Text>
          ) : null}

          <View style={styles.sectionHeader}>
            <SectionLabel>ORDER LINES</SectionLabel>
            <Text style={styles.sectionTitle}>
              {order.line_count} line{order.line_count === 1 ? '' : 's'}
            </Text>
          </View>

          <View style={styles.linesCard}>
            {order.lines.map((line) => {
              const ordered = Number(line.ordered_qty);
              const received = Number(line.received_qty);
              const progress =
                ordered > 0 ? Math.min(1, Math.max(0, received / ordered)) : 0;
              return (
                <View key={line.id} style={styles.lineRow}>
                  <View style={styles.lineTop}>
                    <View style={styles.lineIcon}>
                      <MaterialCommunityIcons
                        name="package-variant-closed"
                        size={18}
                        color={colors.deep}
                      />
                    </View>
                    <View style={styles.lineBody}>
                      <Text style={styles.lineName}>{line.item_name}</Text>
                      <Text style={styles.lineMeta}>
                        {line.sku}
                        {line.supplier_sku ? ` · Supplier SKU ${line.supplier_sku}` : ''}
                      </Text>
                    </View>
                    <Text style={styles.lineQty}>
                      {formatQty(line.remaining_qty)} left
                    </Text>
                  </View>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
                  </View>
                  <View style={styles.lineStats}>
                    <Text style={styles.lineStat}>
                      Ordered {formatQty(line.ordered_qty)} {line.base_uom}
                    </Text>
                    <Text style={styles.lineStat}>
                      Received {formatQty(line.received_qty)} {line.base_uom}
                    </Text>
                    <Text style={[styles.lineStat, styles.lineStatStrong]}>
                      Remaining {formatQty(line.remaining_qty)} {line.base_uom}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>

          {cancellable ? (
            <Button
              label={cancelling ? 'Cancelling…' : 'Cancel purchase order'}
              variant="danger"
              onPress={cancel}
              loading={cancelling}
            />
          ) : null}
          {order.status === 'open' && receivedAny && canManagePurchasing ? (
            <Text style={styles.hint}>
              Received stock locks cancellation. Receive the balance instead.
            </Text>
          ) : null}

          <Button label="Review reorder needs" variant="ghost" onPress={onOpenReorder} />
        </>
      ) : null}
      </ScrollView>
    </View>
  );
}

function QuantityCell({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <View style={[styles.quantityCell, highlight && styles.quantityCellHighlight]}>
      <Text style={styles.quantityLabel}>{label}</Text>
      <Text style={[styles.quantityValue, highlight && styles.quantityValueHighlight]}>
        {formatQty(value)}
      </Text>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
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
    fontSize: 20,
    lineHeight: 24,
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
  screen: {
    flex: 1,
    backgroundColor: '#EFF3F8',
  },
  content: {
    paddingHorizontal: 16,
    gap: 14,
    paddingBottom: 24,
  },
  pressed: {
    opacity: 0.8,
  },
  loadingBox: {
    padding: spacing.xl,
    alignItems: 'center',
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
  errorBody: {
    flex: 1,
    gap: 3,
  },
  errorText: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 11.5,
    lineHeight: 17,
    color: colors.danger,
  },
  retryText: {
    fontFamily: fonts.dmSansBold,
    fontSize: 11.5,
    color: colors.danger,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: palette.ink,
    borderRadius: radius.xxl,
    borderWidth: 1.2,
    borderColor: 'rgba(255,255,255,0.16)',
    padding: spacing.lg,
    overflow: 'hidden',
    ...neo.raised,
  },
  statusGlow: {
    position: 'absolute',
    top: -70,
    right: -50,
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: 'rgba(245,197,66,0.16)',
  },
  statusIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: palette.gold,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1.4,
    borderTopColor: 'rgba(255,255,255,0.6)',
  },
  statusBody: {
    flex: 1,
    gap: 1,
  },
  statusEyebrow: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 9,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.5)',
  },
  statusTitle: {
    fontFamily: fonts.outfitBold,
    fontSize: 17,
    color: palette.white,
  },
  statusText: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 10.5,
    lineHeight: 15,
    color: 'rgba(255,255,255,0.56)',
  },
  quantityGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  quantityCell: {
    flex: 1,
    backgroundColor: palette.glass,
    borderRadius: radius.lg,
    borderWidth: 1.1,
    borderColor: palette.glassBorder,
    padding: spacing.md,
    gap: 1,
    ...neo.soft,
  },
  quantityCellHighlight: {
    backgroundColor: palette.ink,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  quantityLabel: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 8.5,
    letterSpacing: 1.1,
    color: palette.muted,
    textTransform: 'uppercase',
  },
  quantityValue: {
    fontFamily: fonts.outfitBold,
    fontSize: 21,
    color: palette.ink,
  },
  quantityValueHighlight: {
    color: palette.white,
  },
  detailCard: {
    backgroundColor: palette.glass,
    borderRadius: radius.xl,
    borderWidth: 1.1,
    borderColor: palette.glassBorder,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    ...neo.soft,
  },
  detailRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
  },
  detailLabel: {
    width: 108,
    fontFamily: fonts.dmSansRegular,
    fontSize: 11,
    color: palette.muted,
  },
  detailValue: {
    flex: 1,
    fontFamily: fonts.dmSansMedium,
    fontSize: 11,
    lineHeight: 16,
    color: palette.ink,
    textAlign: 'right',
  },
  hint: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 11,
    lineHeight: 17,
    color: palette.muted,
  },
  sectionHeader: {
    gap: 1,
    marginTop: spacing.xs,
  },
  sectionEyebrow: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 9,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: palette.muted,
  },
  sectionTitle: {
    fontFamily: fonts.outfitBold,
    fontSize: 19,
    letterSpacing: -0.2,
    color: palette.ink,
    marginTop: 2,
  },
  linesCard: {
    backgroundColor: palette.glass,
    borderRadius: radius.xl,
    borderWidth: 1.1,
    borderColor: palette.glassBorder,
    paddingHorizontal: spacing.lg,
    ...neo.soft,
  },
  lineRow: {
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
  },
  lineTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  lineIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(234,241,252,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineBody: {
    flex: 1,
    gap: 1,
  },
  lineName: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 13,
    color: palette.ink,
  },
  lineMeta: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 10,
    color: palette.muted,
  },
  lineQty: {
    fontFamily: fonts.dmSansBold,
    fontSize: 11.5,
    color: palette.blue,
  },
  progressTrack: {
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(226,234,244,0.9)',
    overflow: 'hidden',
  },
  progressFill: {
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: palette.gold,
  },
  lineStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  lineStat: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 10,
    color: palette.muted,
  },
  lineStatStrong: {
    fontFamily: fonts.dmSansBold,
    color: palette.ink,
  },
});
