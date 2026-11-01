import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useMemo } from 'react';
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

import { useAuth } from '../auth';
import { useWorkspace } from '../data';
import { formatQty, formatRelativeTime, humanize } from '../format';
import { summarizeStock } from '../inventory';
import { draftReceipts as pendingReceipts } from '../logistics';
import { fonts } from '../theme';

type Destination =
  | 'inventory'
  | 'operations'
  | 'receive'
  | 'items'
  | 'outbound'
  | 'transfer'
  | 'putaway'
  | 'reorder'
  | 'reports'
  | 'cycle-count';

interface HomeScreenProps {
  onNavigate: (tab: Destination) => void;
}

export function HomeScreen({ onNavigate }: HomeScreenProps) {
  const insets = useSafeAreaInsets();
  const { state } = useAuth();
  const {
    items,
    warehouses,
    locations,
    balances,
    movements,
    receipts,
    dashboard,
    loading,
    refreshing,
    refresh,
  } = useWorkspace();

  const session = state.status === 'signedIn' ? state.session : null;
  const firstName = session?.user.name ? session.user.name.trim().split(/\s+/)[0] : 'there';
  const companyName = session?.company.name ?? 'NTAN Workspace';
  const activeWarehouse = warehouses[0]?.name ?? 'Central Warehouse';

  // 100% Real Live Metrics
  const summary = useMemo(() => summarizeStock(items, balances), [items, balances]);
  const receivingQueue = useMemo(() => pendingReceipts(receipts), [receipts]);
  const recentMovements = useMemo(() => movements.slice(0, 5), [movements]);

  const inStockUnits = summary.totalOnHand;
  const toReceiveCount = receivingQueue.length;
  const toDispatchCount = Number(dashboard?.today.outbound_units ?? 0);

  // 100% Real 7-Day Velocity Data from Movements Ledger
  const weeklyVelocity = useMemo(() => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const today = new Date();
    const result: Array<{
      label: string;
      inbound: number;
      outbound: number;
      isToday: boolean;
    }> = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dayLabel = i === 0 ? 'Today' : days[d.getDay()];
      const dateStr = d.toISOString().split('T')[0];

      let dayIn = 0;
      let dayOut = 0;
      for (const m of movements) {
        const mDate = (m.occurred_at || m.recorded_at || '').split('T')[0];
        if (mDate === dateStr) {
          const delta = Number(m.quantity_delta);
          if (delta > 0) dayIn += delta;
          else if (delta < 0) dayOut += Math.abs(delta);
        }
      }

      if (i === 0 && dashboard?.today) {
        dayIn = Math.max(dayIn, Number(dashboard.today.inbound_units || 0));
        dayOut = Math.max(dayOut, Number(dashboard.today.outbound_units || 0));
      }

      result.push({
        label: dayLabel,
        inbound: dayIn,
        outbound: dayOut,
        isToday: i === 0,
      });
    }

    return result;
  }, [movements, dashboard]);

  const totalWeeklyActivity = useMemo(
    () => weeklyVelocity.reduce((acc, curr) => acc + curr.inbound + curr.outbound, 0),
    [weeklyVelocity],
  );

  const maxVelocity = useMemo(() => {
    let max = 1;
    for (const d of weeklyVelocity) {
      if (d.inbound > max) max = d.inbound;
      if (d.outbound > max) max = d.outbound;
    }
    return max;
  }, [weeklyVelocity]);

  // Real Storage Capacity & Zone Allocation
  const totalLocations = locations.length;
  const occupiedLocationIds = useMemo(
    () =>
      new Set(
        balances.filter((b) => Number(b.on_hand) > 0).map((b) => b.location_id),
      ),
    [balances],
  );

  const occupiedLocations = occupiedLocationIds.size;
  const capacityPct =
    totalLocations > 0 ? Math.round((occupiedLocations / totalLocations) * 100) : 0;

  const zoneBreakdown = useMemo(() => {
    const map = new Map<string, { total: number; occupied: number }>();

    for (const loc of locations) {
      const typeKey = loc.type ? humanize(loc.type) : (loc.zone || 'Storage');
      const current = map.get(typeKey) || { total: 0, occupied: 0 };
      current.total += 1;
      if (occupiedLocationIds.has(loc.id)) {
        current.occupied += 1;
      }
      map.set(typeKey, current);
    }

    const iconMap: Record<
      string,
      { icon: keyof typeof MaterialCommunityIcons.glyphMap; color: string }
    > = {
      Staging: { icon: 'dock-window', color: '#2563EB' },
      Storage: { icon: 'package-variant-closed', color: '#059669' },
      Quarantine: { icon: 'shield-alert-outline', color: '#D97706' },
      Dock: { icon: 'truck-fast-outline', color: '#7C3AED' },
      Floor: { icon: 'view-grid-outline', color: '#6366F1' },
      Rack: { icon: 'format-list-bulleted-square', color: '#0EA5E9' },
    };

    const rows: Array<{
      name: string;
      total: number;
      occupied: number;
      pct: number;
      icon: keyof typeof MaterialCommunityIcons.glyphMap;
      color: string;
    }> = [];

    map.forEach((val, name) => {
      const pct = val.total > 0 ? Math.round((val.occupied / val.total) * 100) : 0;
      const meta = iconMap[name] || { icon: 'warehouse', color: '#64748B' };
      rows.push({
        name,
        total: val.total,
        occupied: val.occupied,
        pct,
        icon: meta.icon,
        color: meta.color,
      });
    });

    if (rows.length === 0) {
      return [
        {
          name: 'General Storage',
          total: Math.max(totalLocations, 1),
          occupied: occupiedLocations,
          pct: capacityPct,
          icon: 'package-variant-closed' as const,
          color: '#059669',
        },
      ];
    }

    return rows.slice(0, 3);
  }, [locations, occupiedLocationIds, totalLocations, occupiedLocations, capacityPct]);

  // Real Stock Health Breakdown
  const totalSkus = Math.max(summary.activeSkus || items.length, 1);
  const stockoutCount = summary.stockoutCount;
  const lowStockCount = summary.lowStockCount;
  const healthyCount = Math.max(0, totalSkus - stockoutCount - lowStockCount);

  const healthyPct = Math.round((healthyCount / totalSkus) * 100);
  const lowStockPct = Math.round((lowStockCount / totalSkus) * 100);
  const stockoutPct = Math.max(0, 100 - healthyPct - lowStockPct);

  if (loading && !refreshing && items.length === 0) {
    return (
      <View style={[styles.loadingScreen, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color="#192338" />
      </View>
    );
  }

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
            onRefresh={refresh}
            tintColor="#192338"
            colors={['#192338']}
          />
        }
      >
        {/* Top Header: Pure Logo (NO box or object around it) + Greeting */}
        <View style={styles.topHeader}>
          <View style={styles.headerLeft}>
            <Image
              source={require('../../assets/ntan-hexagon-logo.png')}
              style={styles.logoImage}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
            <View style={styles.greetingBox}>
              <Text style={styles.greetingTitle}>Hi, {firstName}</Text>
              <Text style={styles.greetingSubtitle} numberOfLines={1}>
                {activeWarehouse} · {companyName}
              </Text>
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh workspace"
            onPress={refresh}
            style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
          >
            <MaterialCommunityIcons name="sync" size={19} color="#192338" />
          </Pressable>
        </View>

        {/* =========================================================================
            BENTO GRID LAYOUT
            ========================================================================= */}

        {/* BENTO CARD 1: HERO COMMAND CARD (NAVY BLUE FEATURE #1) */}
        <View style={styles.bentoHeroNavy}>
          <View style={styles.bentoHeroTopRow}>
            <View style={styles.bentoHeroTag}>
              <View style={styles.pulseDot} />
              <Text style={styles.bentoHeroTagText}>LIVE INVENTORY COMMAND</Text>
            </View>
            <Text style={styles.bentoHeroWarehouseBadge}>{activeWarehouse}</Text>
          </View>

          <View style={styles.bentoHeroMainMetric}>
            <Text style={styles.bentoHeroNumber}>{formatQty(String(inStockUnits))}</Text>
            <Text style={styles.bentoHeroUnit}>Total Units On Hand</Text>
          </View>

          {/* Micro Flow Inset Capsules */}
          <View style={styles.bentoHeroCapsulesRow}>
            <View style={styles.bentoHeroCapsule}>
              <View style={[styles.capsuleIconDot, { backgroundColor: '#10B981' }]}>
                <MaterialCommunityIcons name="arrow-down-left" size={12} color="#FFFFFF" />
              </View>
              <View style={styles.capsuleTextWrap}>
                <Text style={styles.capsuleLabel}>Inbound Pending</Text>
                <Text style={styles.capsuleValue}>+{toReceiveCount} shipments</Text>
              </View>
            </View>

            <View style={styles.bentoHeroCapsule}>
              <View style={[styles.capsuleIconDot, { backgroundColor: '#3B82F6' }]}>
                <MaterialCommunityIcons name="arrow-up-right" size={12} color="#FFFFFF" />
              </View>
              <View style={styles.capsuleTextWrap}>
                <Text style={styles.capsuleLabel}>Today's Dispatched</Text>
                <Text style={styles.capsuleValue}>{toDispatchCount} units</Text>
              </View>
            </View>
          </View>
        </View>

        {/* BENTO ROW 2: ASYMMETRICAL 2-COLUMN DUO (Light Capacity + Navy Health) */}
        <View style={styles.bentoSplitRow}>
          {/* Bento Tile A: Facility Capacity (Light Hybrid #FCFDFE) */}
          <View style={[styles.bentoTile, styles.bentoTileLight]}>
            <View style={styles.tileHeaderRow}>
              <Text style={styles.tileTitleLight}>Facility</Text>
              <View style={styles.capacityBadge}>
                <Text style={styles.capacityBadgeText}>{capacityPct}%</Text>
              </View>
            </View>

            <View style={styles.gaugeTrackLight}>
              <View style={[styles.gaugeFillLight, { width: `${capacityPct}%` }]} />
            </View>

            <Text style={styles.capacitySubLight}>
              {occupiedLocations} of {totalLocations} bins occupied
            </Text>

            {/* Micro zone rows */}
            <View style={styles.zoneMiniStack}>
              {zoneBreakdown.slice(0, 2).map((zone) => (
                <View key={zone.name} style={styles.zoneMiniRow}>
                  <Text style={styles.zoneMiniName} numberOfLines={1}>{zone.name}</Text>
                  <Text style={styles.zoneMiniPct}>{zone.pct}%</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Bento Tile B: Stock Health Radar (NAVY BLUE FEATURE #2) */}
          <View style={[styles.bentoTile, styles.bentoTileNavy]}>
            <View style={styles.tileHeaderRow}>
              <Text style={styles.tileTitleNavy}>Stock Health</Text>
              <Pressable hitSlop={8} onPress={() => onNavigate('inventory')}>
                <Text style={styles.tileLinkGold}>Audit</Text>
              </Pressable>
            </View>

            {/* Segmented Glowing Bar */}
            <View style={styles.healthBarTrackNavy}>
              <View
                style={[
                  styles.healthSegment,
                  { width: `${healthyPct}%`, backgroundColor: '#10B981' },
                ]}
              />
              <View
                style={[
                  styles.healthSegment,
                  { width: `${lowStockPct}%`, backgroundColor: '#F59E0B' },
                ]}
              />
              <View
                style={[
                  styles.healthSegment,
                  { width: `${stockoutPct}%`, backgroundColor: '#EF4444' },
                ]}
              />
            </View>

            {/* Glowing health count chips */}
            <View style={styles.healthMiniList}>
              <View style={styles.healthMiniItem}>
                <View style={[styles.healthDot, { backgroundColor: '#10B981' }]} />
                <Text style={styles.healthMiniLabel}>Healthy</Text>
                <Text style={styles.healthMiniVal}>{healthyCount}</Text>
              </View>

              <View style={styles.healthMiniItem}>
                <View style={[styles.healthDot, { backgroundColor: '#F59E0B' }]} />
                <Text style={styles.healthMiniLabel}>Low</Text>
                <Text style={styles.healthMiniVal}>{lowStockCount}</Text>
              </View>

              <View style={styles.healthMiniItem}>
                <View style={[styles.healthDot, { backgroundColor: '#EF4444' }]} />
                <Text style={styles.healthMiniLabel}>Out</Text>
                <Text style={styles.healthMiniVal}>{stockoutCount}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* BENTO CARD 3: 7-DAY THROUGHPUT VELOCITY CHART (Light Hybrid #FCFDFE) */}
        <View style={styles.bentoCardLight}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.cardTitleWrap}>
              <Text style={styles.cardTitle}>Throughput Velocity</Text>
              <Text style={styles.cardSubtitle}>
                {totalWeeklyActivity > 0
                  ? '7-Day Inbound vs Outbound Flow'
                  : 'No movements in last 7 days'}
              </Text>
            </View>
            <View style={styles.chartLegend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#10B981' }]} />
                <Text style={styles.legendText}>Inbound</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#2563EB' }]} />
                <Text style={styles.legendText}>Outbound</Text>
              </View>
            </View>
          </View>

          {/* Bar Chart Area */}
          <View style={styles.chartCanvas}>
            <View style={styles.chartGridLines}>
              <View style={styles.gridLine} />
              <View style={styles.gridLine} />
              <View style={styles.gridLine} />
            </View>

            <View style={styles.barsContainer}>
              {weeklyVelocity.map((day, idx) => {
                const hasIn = day.inbound > 0;
                const hasOut = day.outbound > 0;
                const inHeight = hasIn ? Math.max(8, Math.round((day.inbound / maxVelocity) * 88)) : 2;
                const outHeight = hasOut ? Math.max(8, Math.round((day.outbound / maxVelocity) * 88)) : 2;

                return (
                  <View key={day.label + idx} style={styles.dayCol}>
                    <View style={styles.barsTrack}>
                      {/* Inbound Bar */}
                      <View
                        style={[
                          styles.bar,
                          hasIn ? styles.barInbound : styles.barZero,
                          { height: inHeight },
                        ]}
                      />
                      {/* Outbound Bar */}
                      <View
                        style={[
                          styles.bar,
                          hasOut ? styles.barOutbound : styles.barZero,
                          { height: outHeight },
                        ]}
                      />
                    </View>
                    <Text
                      style={[
                        styles.dayLabel,
                        day.isToday && styles.dayLabelActive,
                      ]}
                    >
                      {day.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        </View>

        {/* BENTO ROW 4: TACTICAL QUICK ACTION TILES */}
        <View style={styles.sectionWrap}>
          <Text style={styles.sectionHeading}>Quick Actions</Text>

          <View style={styles.bentoActionsGrid}>
            {/* Receive */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Receive Stock"
              onPress={() => onNavigate('receive')}
              style={({ pressed }) => [styles.actionTile, pressed && styles.actionTilePressed]}
            >
              <View style={[styles.actionIconCircle, { backgroundColor: '#ECFDF5' }]}>
                <MaterialCommunityIcons name="arrow-down-left-bold" size={20} color="#059669" />
              </View>
              <Text style={styles.actionTitle}>Receive</Text>
              {toReceiveCount > 0 ? (
                <View style={styles.actionBadge}>
                  <Text style={styles.actionBadgeText}>{toReceiveCount}</Text>
                </View>
              ) : null}
            </Pressable>

            {/* Dispatch */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dispatch Orders"
              onPress={() => onNavigate('outbound')}
              style={({ pressed }) => [styles.actionTile, pressed && styles.actionTilePressed]}
            >
              <View style={[styles.actionIconCircle, { backgroundColor: '#EFF6FF' }]}>
                <MaterialCommunityIcons name="arrow-up-right-bold" size={20} color="#2563EB" />
              </View>
              <Text style={styles.actionTitle}>Dispatch</Text>
            </Pressable>

            {/* Transfer */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Move Stock"
              onPress={() => onNavigate('transfer')}
              style={({ pressed }) => [styles.actionTile, pressed && styles.actionTilePressed]}
            >
              <View style={[styles.actionIconCircle, { backgroundColor: '#F5F3FF' }]}>
                <MaterialCommunityIcons name="swap-horizontal-bold" size={20} color="#7C3AED" />
              </View>
              <Text style={styles.actionTitle}>Transfer</Text>
            </Pressable>

            {/* Cycle Count */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cycle Count"
              onPress={() => onNavigate('cycle-count')}
              style={({ pressed }) => [styles.actionTile, pressed && styles.actionTilePressed]}
            >
              <View style={[styles.actionIconCircle, { backgroundColor: '#FFFBEB' }]}>
                <MaterialCommunityIcons name="clipboard-check-outline" size={20} color="#D97706" />
              </View>
              <Text style={styles.actionTitle}>Count</Text>
            </Pressable>
          </View>
        </View>

        {/* BENTO CARD 5: LIVE OPERATIONAL LEDGER (Light Hybrid #FCFDFE) */}
        <View style={styles.bentoCardLight}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.cardTitleWrap}>
              <Text style={styles.cardTitle}>Recent Activity</Text>
              <Text style={styles.cardSubtitle}>Real-time movement ledger</Text>
            </View>
            <Pressable
              hitSlop={8}
              onPress={() => onNavigate('inventory')}
              style={({ pressed }) => pressed && { opacity: 0.7 }}
            >
              <Text style={styles.cardLink}>View All</Text>
            </Pressable>
          </View>

          <View style={styles.activityFeed}>
            {recentMovements.length === 0 ? (
              <View style={styles.emptyActivity}>
                <Text style={styles.emptyText}>No recent movements</Text>
              </View>
            ) : (
              recentMovements.map((move, index) => {
                const deltaNum = Number(move.quantity_delta);
                const isInbound = deltaNum > 0;
                const isLast = index === recentMovements.length - 1;

                return (
                  <View
                    key={move.id || String(index)}
                    style={[styles.activityRow, isLast && styles.activityRowLast]}
                  >
                    <View
                      style={[
                        styles.activityIconCircle,
                        { backgroundColor: isInbound ? '#ECFDF5' : '#EFF6FF' },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name={isInbound ? 'arrow-down-left' : 'arrow-up-right'}
                        size={16}
                        color={isInbound ? '#059669' : '#2563EB'}
                      />
                    </View>

                    <View style={styles.activityDetails}>
                      <Text style={styles.activityItemName} numberOfLines={1}>
                        {move.item_name || move.sku || 'Inventory SKU'}
                      </Text>
                      <Text style={styles.activityTime}>
                        {formatRelativeTime(move.occurred_at || move.recorded_at)}
                      </Text>
                    </View>

                    <Text
                      style={[
                        styles.activityDelta,
                        isInbound ? styles.activityDeltaIn : styles.activityDeltaOut,
                      ]}
                    >
                      {isInbound ? `+${formatQty(String(deltaNum))}` : formatQty(String(deltaNum))}
                    </Text>
                  </View>
                );
              })
            )}
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
  loadingScreen: {
    flex: 1,
    backgroundColor: '#EFF3F8',
    alignItems: 'center',
    justifyContent: 'center',
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
  // BENTO GRID STYLES
  // =========================================================================

  // BENTO 1: HERO NAVY FEATURE CARD (#192338)
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
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // BENTO 2: ASYMMETRICAL 2-COLUMN SPLIT ROW
  bentoSplitRow: {
    flexDirection: 'row',
    gap: 12,
  },
  bentoTile: {
    flex: 1,
    borderRadius: 22,
    padding: 16,
    gap: 12,
    justifyContent: 'space-between',
  },

  // Left Bento Tile (Light #FCFDFE)
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
  capacityBadge: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  capacityBadgeText: {
    fontFamily: fonts.heading,
    fontSize: 11,
    color: '#2563EB',
    fontWeight: '700',
  },
  gaugeTrackLight: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E2E8F0',
    overflow: 'hidden',
  },
  gaugeFillLight: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: '#2563EB',
  },
  capacitySubLight: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#64748B',
  },
  zoneMiniStack: {
    gap: 4,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 8,
  },
  zoneMiniRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  zoneMiniName: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#64748B',
    flex: 1,
  },
  zoneMiniPct: {
    fontFamily: fonts.heading,
    fontSize: 11,
    color: '#192338',
    fontWeight: '700',
  },

  // Right Bento Tile (NAVY BLUE FEATURE #2 #192338)
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
  tileLinkGold: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: '#FFBF32',
    fontWeight: '700',
  },
  healthBarTrackNavy: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    gap: 2,
  },
  healthSegment: {
    height: '100%',
    borderRadius: 2,
  },
  healthMiniList: {
    gap: 5,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    paddingTop: 8,
  },
  healthMiniItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  healthDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  healthMiniLabel: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#94A3B8',
    flex: 1,
  },
  healthMiniVal: {
    fontFamily: fonts.heading,
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // BENTO FULL CARD: Light Hybrid #FCFDFE
  bentoCardLight: {
    backgroundColor: '#FCFDFE',
    borderRadius: 24,
    padding: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderTopColor: '#FFFFFF',
    borderBottomColor: 'rgba(215, 225, 238, 0.75)',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 4,
    gap: 12,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  cardTitleWrap: {
    gap: 2,
  },
  cardTitle: {
    fontFamily: fonts.heading,
    fontSize: 16,
    color: '#192338',
    letterSpacing: -0.2,
  },
  cardSubtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: '#64748B',
  },
  cardLink: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: '#2563EB',
    paddingVertical: 2,
  },

  // Chart
  chartLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  legendText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#64748B',
  },
  chartCanvas: {
    height: 115,
    justifyContent: 'flex-end',
    position: 'relative',
    marginTop: 4,
  },
  chartGridLines: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 22,
    justifyContent: 'space-between',
  },
  gridLine: {
    height: 1,
    backgroundColor: 'rgba(226, 232, 240, 0.7)',
  },
  barsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    height: 95,
  },
  dayCol: {
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  barsTrack: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: 82,
  },
  bar: {
    width: 8,
    borderRadius: 4,
  },
  barZero: {
    backgroundColor: '#E2E8F0',
    opacity: 0.6,
  },
  barInbound: {
    backgroundColor: '#10B981',
  },
  barOutbound: {
    backgroundColor: '#2563EB',
  },
  dayLabel: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: '#94A3B8',
  },
  dayLabelActive: {
    fontFamily: fonts.bodySemi,
    color: '#192338',
    fontWeight: '700',
  },

  // BENTO ACTIONS GRID
  sectionWrap: {
    gap: 10,
  },
  sectionHeading: {
    fontFamily: fonts.heading,
    fontSize: 15,
    color: '#192338',
    letterSpacing: -0.2,
  },
  bentoActionsGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  actionTile: {
    flex: 1,
    backgroundColor: '#FCFDFE',
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderTopColor: '#FFFFFF',
    borderBottomColor: 'rgba(215, 225, 238, 0.75)',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 3,
    position: 'relative',
  },
  actionTilePressed: {
    opacity: 0.85,
    transform: [{ scale: 0.95 }],
  },
  actionIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: '#192338',
    fontWeight: '700',
  },
  actionBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  actionBadgeText: {
    fontFamily: fonts.heading,
    fontSize: 9,
    color: '#059669',
    fontWeight: '800',
  },

  // Activity Feed
  activityFeed: {
    gap: 0,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    gap: 12,
  },
  activityRowLast: {
    borderBottomWidth: 0,
  },
  activityIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityDetails: {
    flex: 1,
    gap: 2,
  },
  activityItemName: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: '#192338',
    fontWeight: '600',
  },
  activityTime: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#94A3B8',
  },
  activityDelta: {
    fontFamily: fonts.heading,
    fontSize: 14,
    fontWeight: '700',
  },
  activityDeltaIn: {
    color: '#059669',
  },
  activityDeltaOut: {
    color: '#192338',
  },
  emptyActivity: {
    paddingVertical: 18,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: '#94A3B8',
  },
});
