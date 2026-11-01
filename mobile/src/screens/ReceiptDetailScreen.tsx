import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
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
import { useWorkspace } from '../data';
import { formatDateTime, formatQty, humanize } from '../format';
import { colors, fonts, neo, palette, radius, spacing } from '../theme';
import type { PutawayTask, Receipt } from '../types';

interface ReceiptDetailScreenProps {
  receiptId: string;
  onBack: () => void;
  onOpenPutaway: (receiptId?: string) => void;
  onOpenPurchaseOrder?: (purchaseOrderId: string) => void;
  onChanged: () => void;
}

export function ReceiptDetailScreen({
  receiptId,
  onBack,
  onOpenPutaway,
  onOpenPurchaseOrder,
  onChanged,
}: ReceiptDetailScreenProps) {
  const insets = useSafeAreaInsets();
  const { state } = useAuth();
  const { locations, warehouses, clients, internalClient } = useWorkspace();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [tasks, setTasks] = useState<PutawayTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canReceive = state.status === 'signedIn' && state.session.permissions.includes('stock.receive');

  const load = useCallback(async () => {
    setError(null);
    try {
      const [receiptResponse, taskResponse] = await Promise.all([
        api.getReceipt(receiptId),
        api.putawayTasks({ receiptId }),
      ]);
      setReceipt(receiptResponse);
      setTasks(taskResponse.tasks);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'The receipt could not be loaded.',
      );
    }
  }, [receiptId]);

  useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load]);

  const post = async () => {
    if (!receipt) {
      return;
    }
    setPosting(true);
    setError(null);
    try {
      await api.commitReceipt(receipt.id);
      await load();
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The draft could not be posted.',
      );
    } finally {
      setPosting(false);
    }
  };

  const warehouse = warehouses.find((entry) => entry.id === receipt?.warehouse_id);
  const location = locations.find((entry) => entry.id === receipt?.location_id);
  const supplierRecord = clients.find((entry) => entry.id === receipt?.supplier_id);
  const supplierArchived = supplierRecord ? supplierRecord.status !== 'active' : false;
  const ownerRecord = clients.find((entry) => entry.id === receipt?.client_id);
  const ownerName = ownerRecord
    ? ownerRecord.name
    : receipt?.client_id && internalClient?.id === receipt.client_id
      ? internalClient.name
      : null;
  const pendingTasks = tasks.filter((task) => task.status === 'pending');
  const completedTasks = tasks.filter((task) => task.status === 'completed');
  const awaitingPutaway = Boolean(
    receipt?.putaway_required && !receipt.putaway_completed_at,
  );

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
            {receipt?.number ?? 'Receipt Details'}
          </Text>
          <Text style={styles.greetingSubtitle} numberOfLines={1}>
            Inbound Goods Tracking
          </Text>
        </View>
      </View>

      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBox}>
          <MaterialCommunityIcons name="alert-circle-outline" size={20} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {receipt ? (
        <>
          <View style={styles.statusCard}>
            <View style={styles.statusIcon}>
              <MaterialCommunityIcons
                name={awaitingPutaway ? 'map-marker-path' : 'check-decagram-outline'}
                size={26}
                color={awaitingPutaway ? colors.warning : colors.success}
              />
            </View>
            <View style={styles.statusBody}>
              <Text style={styles.statusTitle}>
                {receipt.status === 'draft'
                  ? 'Draft receipt'
                  : awaitingPutaway
                    ? 'Awaiting put-away'
                    : 'Receipt complete'}
              </Text>
              <Text style={styles.statusText}>
                {receipt.status === 'draft'
                  ? 'Draft — no stock posted yet.'
                  : awaitingPutaway
                    ? 'Staged and awaiting a storage bin.'
                    : 'All lines are in final locations.'}
              </Text>
            </View>
            <Badge
              label={humanize(receipt.status)}
              tone={
                receipt.status === 'draft'
                  ? 'warning'
                  : awaitingPutaway
                    ? 'warning'
                    : 'success'
              }
            />
          </View>

          <View style={styles.detailCard}>
            <DetailRow
              label="Supplier"
              value={`${receipt.supplier ?? 'Not supplied'}${
                supplierArchived ? ' · Archived partner' : ''
              }`}
            />
            <DetailRow
              label="Inventory owner"
              value={
                ownerName
                  ? ownerRecord?.is_internal || internalClient?.id === receipt.client_id
                    ? `${ownerName} (internal)`
                    : ownerName
                  : receipt.client_id
                    ? 'Owner unavailable'
                    : 'Internal company stock'
              }
            />
            {receipt.purchase_order ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open purchase order ${receipt.purchase_order}`}
                disabled={!receipt.purchase_order_id || !onOpenPurchaseOrder}
                onPress={() => {
                  if (receipt.purchase_order_id && onOpenPurchaseOrder) {
                    onOpenPurchaseOrder(receipt.purchase_order_id);
                  }
                }}
                style={styles.linkDetailRow}
              >
                <Text style={styles.detailLabel}>Purchase order</Text>
                <View style={styles.linkValueWrap}>
                  <Text style={styles.linkValue}>{receipt.purchase_order}</Text>
                  {receipt.purchase_order_id && onOpenPurchaseOrder ? (
                    <MaterialCommunityIcons
                      name="chevron-right"
                      size={16}
                      color={colors.primary}
                    />
                  ) : null}
                </View>
              </Pressable>
            ) : (
              <DetailRow label="Purchase order" value="None" />
            )}
            {receipt.delivery_note ? (
              <DetailRow label="Delivery note" value={receipt.delivery_note} />
            ) : null}
            <DetailRow label="Warehouse" value={warehouse?.name ?? receipt.warehouse_id} />
            <DetailRow
              label="Receiving location"
              value={
                location ? `${location.code} - ${humanize(location.type)}` : receipt.location_id
              }
            />
            <DetailRow label="Created" value={formatDateTime(receipt.created_at)} />
            <DetailRow
              label="Posted"
              value={receipt.committed_at ? formatDateTime(receipt.committed_at) : 'Not posted'}
            />
            <DetailRow
              label="Put-away completed"
              value={
                receipt.putaway_completed_at
                  ? formatDateTime(receipt.putaway_completed_at)
                  : 'Not completed'
              }
            />
            {receipt.note ? <DetailRow label="Note" value={receipt.note} /> : null}
          </View>

          {receipt.status === 'draft' && canReceive ? (
            <Button label="Post receipt" onPress={() => void post()} loading={posting} />
          ) : null}

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionEyebrow}>CONTENTS</Text>
            <Text style={styles.sectionTitle}>
              {receipt.lines.length} line{receipt.lines.length === 1 ? '' : 's'}
            </Text>
          </View>

          <View style={styles.linesCard}>
            {receipt.lines.map((line) => (
              <View key={line.id} style={styles.lineRow}>
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
                    {line.lot_no ? ` · Lot ${line.lot_no}` : ''}
                    {line.expiry_date ? ` · Expires ${line.expiry_date}` : ''}
                    {line.serial_numbers.length > 0
                      ? ` · ${line.serial_numbers.length} serial${
                          line.serial_numbers.length === 1 ? '' : 's'
                        }`
                      : ''}
                  </Text>
                  {line.serial_numbers.length > 0 ? (
                    <Text style={styles.lineTrace} numberOfLines={2}>
                      {line.serial_numbers.slice(0, 4).join(', ')}
                      {line.serial_numbers.length > 4
                        ? ` +${line.serial_numbers.length - 4} more`
                        : ''}
                    </Text>
                  ) : null}
                  {line.discrepancy_reason ? (
                    <Text style={styles.lineDiscrepancy}>
                      Inspection note: {line.discrepancy_reason}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.lineQty}>
                  {formatQty(line.base_qty)} {line.base_uom}
                </Text>
              </View>
            ))}
          </View>

          {receipt.putaway_required ? (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionEyebrow}>WAREHOUSE FLOW</Text>
                <Text style={styles.sectionTitle}>Put-away</Text>
              </View>

              <View style={styles.putawayCard}>
                <View style={styles.putawaySummary}>
                  <View style={styles.putawayStat}>
                    <Text style={styles.putawayNumber}>{pendingTasks.length}</Text>
                    <Text style={styles.putawayLabel}>Pending</Text>
                  </View>
                  <View style={styles.putawayDivider} />
                  <View style={styles.putawayStat}>
                    <Text style={styles.putawayNumber}>{completedTasks.length}</Text>
                    <Text style={styles.putawayLabel}>Completed</Text>
                  </View>
                </View>
                {tasks.map((task) => (
                  <View key={task.id} style={styles.taskRow}>
                    <MaterialCommunityIcons
                      name={task.status === 'completed' ? 'check-circle' : 'circle-outline'}
                      size={18}
                      color={task.status === 'completed' ? colors.success : colors.warning}
                    />
                    <View style={styles.taskBody}>
                      <Text style={styles.taskName}>{task.item_name}</Text>
                      <Text style={styles.taskMeta}>
                        {task.from_location_code} to {task.to_location_code ?? 'not assigned'}
                      </Text>
                    </View>
                    <Text style={styles.taskQty}>
                      {formatQty(task.base_qty)} {task.base_uom}
                    </Text>
                  </View>
                ))}
                {awaitingPutaway ? (
                  <Button
                    label="Open put-away queue"
                    onPress={() => onOpenPutaway(receipt.id)}
                  />
                ) : null}
              </View>
            </>
          ) : null}
        </>
      ) : null}
      </ScrollView>
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
  headingText: {
    gap: 1,
  },
  eyebrow: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    letterSpacing: 1.3,
    color: colors.deep,
  },
  title: {
    fontFamily: fonts.heading,
    fontSize: 23,
    color: colors.navy,
  },
  pressed: {
    opacity: 0.75,
  },
  loadingBox: {
    padding: spacing.xl,
    alignItems: 'center',
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
    fontSize: 12,
    lineHeight: 18,
    color: colors.danger,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: palette.ink,
    borderRadius: radius.xl,
    borderWidth: 1.2,
    borderColor: 'rgba(255,255,255,0.16)',
    padding: spacing.lg,
    ...neo.raised,
  },
  statusIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBody: {
    flex: 1,
    gap: 2,
  },
  statusTitle: {
    fontFamily: fonts.outfitBold,
    fontSize: 15,
    color: colors.white,
  },
  statusText: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 10.5,
    lineHeight: 15,
    color: 'rgba(255,255,255,0.56)',
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
    borderBottomColor: colors.border,
  },
  detailLabel: {
    width: 112,
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  detailValue: {
    flex: 1,
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    lineHeight: 16,
    color: colors.text,
    textAlign: 'right',
  },
  sectionHeader: {
    gap: 1,
    marginTop: spacing.xs,
  },
  sectionEyebrow: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    letterSpacing: 1.3,
    color: colors.deep,
  },
  sectionTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 18,
    color: colors.navy,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lineIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#EAF3FA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineBody: {
    flex: 1,
    gap: 1,
  },
  lineName: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
  },
  lineMeta: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  lineTrace: {
    fontFamily: fonts.body,
    fontSize: 9,
    lineHeight: 13,
    color: colors.deep,
  },
  lineDiscrepancy: {
    fontFamily: fonts.body,
    fontSize: 10,
    lineHeight: 14,
    color: colors.warning,
  },
  linkDetailRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    alignItems: 'center',
  },
  linkValueWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 2,
  },
  linkValue: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.primary,
    textAlign: 'right',
  },
  lineQty: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  putawayCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  putawaySummary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
  },
  putawayStat: {
    flex: 1,
    alignItems: 'center',
    gap: 1,
  },
  putawayNumber: {
    fontFamily: fonts.headingSemi,
    fontSize: 20,
    color: colors.navy,
  },
  putawayLabel: {
    fontFamily: fonts.body,
    fontSize: 9,
    letterSpacing: 0.6,
    color: colors.muted,
  },
  putawayDivider: {
    width: 1,
    height: 30,
    backgroundColor: colors.border,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  taskBody: {
    flex: 1,
    gap: 1,
  },
  taskName: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  taskMeta: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  taskQty: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.navy,
  },
});
