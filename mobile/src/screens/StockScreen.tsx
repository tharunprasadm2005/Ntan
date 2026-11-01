import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useWorkspace } from '../data';
import { formatQty, humanize } from '../format';
import { summarizeStock } from '../inventory';
import { fonts } from '../theme';

type FilterType = 'all' | 'in_stock' | 'low_stock' | 'out_of_stock' | 'tracked';

export function StockScreen({
  onReceive,
  canReceive,
  onOpenItem,
}: {
  onReceive: () => void;
  canReceive: boolean;
  onOpenItem: (itemId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const {
    items,
    warehouses,
    balances,
    locations,
    loading,
    refreshing,
    refresh,
  } = useWorkspace();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [pageSize, setPageSize] = useState(25);

  const activeWarehouse = warehouses[0]?.name ?? 'Central Warehouse';

  const locationMap = useMemo(
    () => new Map(locations.map((location) => [location.id, location])),
    [locations],
  );

  const locationCounts = useMemo(() => {
    const counts = new Map<string, Set<string>>();
    for (const balance of balances) {
      if (Number(balance.on_hand) > 0) {
        const current = counts.get(balance.item_id) ?? new Set<string>();
        current.add(balance.location_id);
        counts.set(balance.item_id, current);
      }
    }
    return counts;
  }, [balances]);

  const summary = useMemo(() => summarizeStock(items, balances), [items, balances]);

  const occupiedLocations = useMemo(
    () =>
      new Set(
        balances.filter((b) => Number(b.on_hand) > 0).map((b) => b.location_id),
      ).size,
    [balances],
  );

  // Filter Counts
  const inStockCount = useMemo(
    () => summary.items.filter((entry) => entry.available > 0).length,
    [summary.items],
  );

  const lowStockTotal = summary.lowStockCount + summary.stockoutCount;

  const trackedCount = useMemo(
    () => summary.items.filter((entry) => entry.item.tracking_mode !== 'none').length,
    [summary.items],
  );

  // Filtered List
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return summary.items
      .filter((entry) => {
        // Search query
        if (query) {
          const matchName = entry.item.name.toLowerCase().includes(query);
          const matchSku = entry.item.sku.toLowerCase().includes(query);
          const matchCategory = entry.item.category?.toLowerCase().includes(query);
          if (!matchName && !matchSku && !matchCategory) {
            return false;
          }
        }

        // Pill filter
        if (filter === 'in_stock') {
          return entry.available > 0;
        }
        if (filter === 'low_stock') {
          return entry.belowReorderPoint && entry.available > 0;
        }
        if (filter === 'out_of_stock') {
          return entry.stockout || entry.available <= 0;
        }
        if (filter === 'tracked') {
          return entry.item.tracking_mode !== 'none';
        }

        return true;
      })
      .sort((a, b) => {
        // Stocked SKUs come first, followed by zero-stock SKUs
        if ((a.available > 0) !== (b.available > 0)) {
          return a.available > 0 ? -1 : 1;
        }
        return a.item.name.localeCompare(b.item.name);
      });
  }, [summary.items, search, filter]);

  const visibleItems = useMemo(
    () => filtered.slice(0, pageSize),
    [filtered, pageSize],
  );

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
        {/* Top Header: Pure Hexagon Logo (NO circle/box) + Title + Actions */}
        <View style={styles.topHeader}>
          <View style={styles.headerLeft}>
            <Image
              source={require('../../assets/ntan-hexagon-logo.png')}
              style={styles.logoImage}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
            <View style={styles.headerTitleBox}>
              <Text style={styles.headerTitle}>Inventory</Text>
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {summary.activeSkus} SKUs · {activeWarehouse}
              </Text>
            </View>
          </View>

          <View style={styles.headerActions}>
            {canReceive ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Receive Stock"
                onPress={onReceive}
                style={({ pressed }) => [styles.receiveButton, pressed && styles.receiveButtonPressed]}
              >
                <MaterialCommunityIcons name="plus" size={18} color="#FFFFFF" />
                <Text style={styles.receiveButtonText}>Receive</Text>
              </Pressable>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh Inventory"
              onPress={refresh}
              style={({ pressed }) => [styles.syncButton, pressed && styles.syncButtonPressed]}
            >
              <MaterialCommunityIcons name="sync" size={18} color="#192338" />
            </Pressable>
          </View>
        </View>

        {/* =========================================================================
            BENTO KPIS AT TOP
            ========================================================================= */}

        {/* BENTO HERO CARD (NAVY BLUE FEATURE #1) */}
        <View style={styles.bentoHeroNavy}>
          <View style={styles.bentoHeroTopRow}>
            <View style={styles.bentoTag}>
              <View style={styles.pulseDot} />
              <Text style={styles.bentoTagText}>STOCKED CATALOGUE</Text>
            </View>
            <Text style={styles.bentoWarehouseBadge}>{activeWarehouse}</Text>
          </View>

          <View style={styles.bentoHeroMainMetric}>
            <Text style={styles.bentoHeroNumber}>
              {summary.stockedSkus}
            </Text>
            <Text style={styles.bentoHeroUnit}>Active Stocked SKUs</Text>
          </View>

          {/* Inset Capsules */}
          <View style={styles.bentoCapsulesRow}>
            <View style={styles.bentoCapsule}>
              <View style={[styles.capsuleIconDot, { backgroundColor: '#10B981' }]}>
                <MaterialCommunityIcons name="check-circle-outline" size={12} color="#FFFFFF" />
              </View>
              <View style={styles.capsuleTextWrap}>
                <Text style={styles.capsuleLabel}>Available Stock</Text>
                <Text style={styles.capsuleValue}>
                  {formatQty(String(summary.totalAvailable))} units
                  {summary.totalOnHand === summary.totalAvailable ? ' · 100% Free' : ''}
                </Text>
              </View>
            </View>

            {summary.totalOnHand > summary.totalAvailable ? (
              <View style={styles.bentoCapsule}>
                <View style={[styles.capsuleIconDot, { backgroundColor: '#F59E0B' }]}>
                  <MaterialCommunityIcons name="lock-outline" size={12} color="#FFFFFF" />
                </View>
                <View style={styles.capsuleTextWrap}>
                  <Text style={styles.capsuleLabel}>Reserved / Held</Text>
                  <Text style={styles.capsuleValue}>
                    {formatQty(String(summary.totalOnHand - summary.totalAvailable))} units
                  </Text>
                </View>
              </View>
            ) : null}
          </View>
        </View>

        {/* BENTO 2-COLUMN DUO (Light Capacity + Navy Alerts) */}
        <View style={styles.bentoSplitRow}>
          {/* Tile A: Locations Footprint (Light Hybrid #FCFDFE) */}
          <View style={[styles.bentoTile, styles.bentoTileLight]}>
            <View style={styles.tileHeaderRow}>
              <Text style={styles.tileTitleLight}>Locations</Text>
              <MaterialCommunityIcons name="map-marker-outline" size={17} color="#2563EB" />
            </View>
            <View style={styles.tileMetricWrap}>
              <Text style={styles.tileNumberLight}>{occupiedLocations}</Text>
              <Text style={styles.tileSubLight}>of {locations.length} Bins Active</Text>
            </View>
          </View>

          {/* Tile B: Stock Alerts (Navy Blue #192338) */}
          <Pressable
            onPress={() => setFilter(filter === 'low_stock' ? 'all' : 'low_stock')}
            style={[styles.bentoTile, styles.bentoTileNavy]}
          >
            <View style={styles.tileHeaderRow}>
              <Text style={styles.tileTitleNavy}>Stock Alerts</Text>
              <View
                style={[
                  styles.alertBadgeDot,
                  { backgroundColor: lowStockTotal > 0 ? '#EF4444' : '#10B981' },
                ]}
              />
            </View>
            <View style={styles.tileMetricWrap}>
              <Text style={styles.tileNumberGold}>{lowStockTotal}</Text>
              <Text style={styles.tileSubNavy}>
                {summary.lowStockCount} Low · {summary.stockoutCount} Out
              </Text>
            </View>
          </Pressable>
        </View>

        {/* =========================================================================
            SEARCH & FILTER PILLS
            ========================================================================= */}
        <View style={styles.searchFilterSection}>
          {/* Search Bar */}
          <View style={styles.searchBar}>
            <MaterialCommunityIcons name="magnify" size={20} color="#64748B" />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search by name, SKU or category"
              placeholderTextColor="#94A3B8"
              style={styles.searchInput}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {search ? (
              <Pressable
                onPress={() => setSearch('')}
                accessibilityLabel="Clear search text"
                hitSlop={8}
              >
                <MaterialCommunityIcons name="close-circle" size={18} color="#94A3B8" />
              </Pressable>
            ) : null}
          </View>

          {/* Filter Pills */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterPillsRow}
          >
            <Pressable
              onPress={() => setFilter('all')}
              style={[styles.filterPill, filter === 'all' && styles.filterPillActive]}
            >
              <Text style={[styles.filterPillText, filter === 'all' && styles.filterPillTextActive]}>
                All ({summary.items.length})
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setFilter('in_stock')}
              style={[styles.filterPill, filter === 'in_stock' && styles.filterPillActive]}
            >
              <Text
                style={[
                  styles.filterPillText,
                  filter === 'in_stock' && styles.filterPillTextActive,
                ]}
              >
                In Stock ({inStockCount})
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setFilter('low_stock')}
              style={[styles.filterPill, filter === 'low_stock' && styles.filterPillActive]}
            >
              <Text
                style={[
                  styles.filterPillText,
                  filter === 'low_stock' && styles.filterPillTextActive,
                ]}
              >
                Low Stock ({summary.lowStockCount})
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setFilter('out_of_stock')}
              style={[styles.filterPill, filter === 'out_of_stock' && styles.filterPillActive]}
            >
              <Text
                style={[
                  styles.filterPillText,
                  filter === 'out_of_stock' && styles.filterPillTextActive,
                ]}
              >
                Out of Stock ({summary.stockoutCount})
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setFilter('tracked')}
              style={[styles.filterPill, filter === 'tracked' && styles.filterPillActive]}
            >
              <Text
                style={[
                  styles.filterPillText,
                  filter === 'tracked' && styles.filterPillTextActive,
                ]}
              >
                Tracked ({trackedCount})
              </Text>
            </Pressable>
          </ScrollView>
        </View>

        {/* =========================================================================
            HYBRID SKU CARDS LIST
            ========================================================================= */}
        <View style={styles.skuListSection}>
          <View style={styles.skuListHeaderRow}>
            <Text style={styles.skuListCount}>
              Showing {filtered.length} {filtered.length === 1 ? 'item' : 'items'}
            </Text>
          </View>

          {loading && !refreshing && filtered.length === 0 ? (
            <View style={styles.centerLoading}>
              <ActivityIndicator size="large" color="#192338" />
            </View>
          ) : filtered.length === 0 ? (
            <View style={styles.emptyStateBox}>
              <MaterialCommunityIcons name="package-variant" size={40} color="#94A3B8" />
              <Text style={styles.emptyStateTitle}>No items found</Text>
              <Text style={styles.emptyStateSub}>
                {search ? 'Try checking your spelling or clear filters' : 'No items match the active filter'}
              </Text>
              {search || filter !== 'all' ? (
                <Pressable
                  onPress={() => {
                    setSearch('');
                    setFilter('all');
                  }}
                  style={styles.resetButton}
                >
                  <Text style={styles.resetButtonText}>Reset Filters</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <>
              {visibleItems.map((entry) => {
                const { item } = entry;
                const itemLocs = locationCounts.get(item.id);
                const primaryLocCode =
                  itemLocs && itemLocs.size > 0
                    ? itemLocs.size === 1
                      ? locationMap.get(Array.from(itemLocs)[0])?.code ?? '1 location'
                      : `${itemLocs.size} locations`
                    : 'Unassigned';

                const isStockout = entry.stockout || entry.available <= 0;
                const isLow = !isStockout && entry.belowReorderPoint;

                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${item.name}`}
                    onPress={() => onOpenItem(item.id)}
                    style={({ pressed }) => [styles.skuCard, pressed && styles.skuCardPressed]}
                  >
                    {/* Card Top: Badges */}
                    <View style={styles.skuCardTopRow}>
                      <View style={styles.skuTagRow}>
                        <View style={styles.skuBadge}>
                          <Text style={styles.skuBadgeText}>{item.sku}</Text>
                        </View>

                        {item.tracking_mode !== 'none' ? (
                          <View style={styles.trackingBadge}>
                            <Text style={styles.trackingBadgeText}>
                              {item.tracking_mode === 'both'
                                ? 'Lot & Serial'
                                : humanize(item.tracking_mode)}
                            </Text>
                          </View>
                        ) : null}
                      </View>

                      {/* Stock Status Badge */}
                      <View
                        style={[
                          styles.statusBadge,
                          isStockout
                            ? styles.statusOut
                            : isLow
                              ? styles.statusLow
                              : styles.statusHealthy,
                        ]}
                      >
                        <View
                          style={[
                            styles.statusDot,
                            {
                              backgroundColor: isStockout
                                ? '#EF4444'
                                : isLow
                                  ? '#F59E0B'
                                  : '#10B981',
                            },
                          ]}
                        />
                        <Text
                          style={[
                            styles.statusText,
                            isStockout
                              ? styles.statusOutText
                              : isLow
                                ? styles.statusLowText
                                : styles.statusHealthyText,
                          ]}
                        >
                          {isStockout ? 'Out of Stock' : isLow ? 'Low Stock' : 'In Stock'}
                        </Text>
                      </View>
                    </View>

                    {/* Card Middle: Item Title & Category */}
                    <View style={styles.skuCardMidRow}>
                      <Text style={styles.skuName} numberOfLines={2}>
                        {item.name}
                      </Text>
                      {item.category ? (
                        <Text style={styles.skuCategory}>{item.category}</Text>
                      ) : null}
                    </View>

                    {/* Card Bottom: Location & Quantities */}
                    <View style={styles.skuCardBottomRow}>
                      <View style={styles.locationPill}>
                        <MaterialCommunityIcons
                          name="map-marker-outline"
                          size={14}
                          color="#64748B"
                        />
                        <Text style={styles.locationPillText} numberOfLines={1}>
                          {primaryLocCode}
                        </Text>
                      </View>

                      <View style={styles.quantityBox}>
                        <View style={styles.qtyStack}>
                          <Text style={styles.qtyValue}>
                            {formatQty(String(entry.available))}
                          </Text>
                          <Text style={styles.qtyUnit}>Avail</Text>
                        </View>

                        <View style={styles.qtyDivider} />

                        <View style={styles.qtyStack}>
                          <Text style={styles.qtyTotalValue}>
                            {formatQty(String(entry.onHand))}
                          </Text>
                          <Text style={styles.qtyUnit}>Total</Text>
                        </View>

                        <MaterialCommunityIcons
                          name="chevron-right"
                          size={18}
                          color="#94A3B8"
                        />
                      </View>
                    </View>
                  </Pressable>
                );
              })}

              {filtered.length > pageSize ? (
                <Pressable
                  onPress={() => setPageSize((prev) => prev + 25)}
                  style={({ pressed }) => [styles.loadMoreButton, pressed && styles.loadMorePressed]}
                >
                  <Text style={styles.loadMoreText}>
                    Load More Items ({filtered.length - pageSize} remaining)
                  </Text>
                </Pressable>
              ) : null}
            </>
          )}
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

  // Top Header: Pure Logo with NO circle/box around it
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
  headerTitleBox: {
    flex: 1,
    gap: 2,
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: fonts.heading,
    fontSize: 27,
    color: '#192338',
    letterSpacing: -0.5,
    lineHeight: 33,
  },
  headerSubtitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: '#64748B',
    marginTop: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  receiveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#192338',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 18,
    gap: 4,
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 3,
  },
  receiveButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.96 }],
  },
  receiveButtonText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  syncButton: {
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
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
  },
  syncButtonPressed: {
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
  bentoTag: {
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
  bentoTagText: {
    fontFamily: fonts.heading,
    fontSize: 10,
    color: '#FFBF32',
    letterSpacing: 1.2,
    fontWeight: '800',
  },
  bentoWarehouseBadge: {
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
  bentoCapsulesRow: {
    flexDirection: 'row',
    gap: 10,
  },
  bentoCapsule: {
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
  tileMetricWrap: {
    gap: 2,
  },
  tileNumberLight: {
    fontFamily: fonts.heading,
    fontSize: 24,
    color: '#192338',
    fontWeight: '800',
  },
  tileSubLight: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#64748B',
  },

  // Tile B: Navy Alerts
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
  alertBadgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  tileNumberGold: {
    fontFamily: fonts.heading,
    fontSize: 24,
    color: '#FFBF32',
    fontWeight: '800',
  },
  tileSubNavy: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#94A3B8',
  },

  // =========================================================================
  // SEARCH & FILTER SECTION
  // =========================================================================
  searchFilterSection: {
    gap: 10,
    marginTop: 2,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FCFDFE',
    borderRadius: 18,
    paddingHorizontal: 14,
    height: 48,
    gap: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderTopColor: '#FFFFFF',
    borderBottomColor: 'rgba(215, 225, 238, 0.75)',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    color: '#192338',
    paddingVertical: 0,
  },
  filterPillsRow: {
    gap: 8,
    paddingVertical: 2,
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#FCFDFE',
    borderWidth: 1.2,
    borderColor: 'rgba(215, 225, 238, 0.8)',
  },
  filterPillActive: {
    backgroundColor: '#192338',
    borderColor: '#192338',
  },
  filterPillText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: '#64748B',
  },
  filterPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // =========================================================================
  // HYBRID SKU CARDS LIST
  // =========================================================================
  skuListSection: {
    gap: 12,
  },
  skuListHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  skuListCount: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: '#64748B',
  },
  skuCard: {
    backgroundColor: '#FCFDFE',
    borderRadius: 22,
    padding: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderTopColor: '#FFFFFF',
    borderBottomColor: 'rgba(215, 225, 238, 0.75)',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 4,
    gap: 12,
  },
  skuCardPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.985 }],
  },
  skuCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  skuTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  skuBadge: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  skuBadgeText: {
    fontFamily: fonts.heading,
    fontSize: 11,
    color: '#2563EB',
    fontWeight: '700',
  },
  trackingBadge: {
    backgroundColor: '#F5F3FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#EDE9FE',
  },
  trackingBadgeText: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    color: '#7C3AED',
    fontWeight: '600',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 5,
  },
  statusHealthy: {
    backgroundColor: '#ECFDF5',
  },
  statusLow: {
    backgroundColor: '#FFFBEB',
  },
  statusOut: {
    backgroundColor: '#FEF2F2',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    fontWeight: '600',
  },
  statusHealthyText: {
    color: '#059669',
  },
  statusLowText: {
    color: '#D97706',
  },
  statusOutText: {
    color: '#EF4444',
  },
  skuCardMidRow: {
    gap: 3,
  },
  skuName: {
    fontFamily: fonts.heading,
    fontSize: 15,
    color: '#192338',
    lineHeight: 20,
    letterSpacing: -0.2,
  },
  skuCategory: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#94A3B8',
  },
  skuCardBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10,
  },
  locationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    maxWidth: '45%',
  },
  locationPillText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#64748B',
  },
  quantityBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  qtyStack: {
    alignItems: 'flex-end',
  },
  qtyValue: {
    fontFamily: fonts.heading,
    fontSize: 14,
    color: '#192338',
    fontWeight: '800',
  },
  qtyTotalValue: {
    fontFamily: fonts.heading,
    fontSize: 14,
    color: '#64748B',
    fontWeight: '600',
  },
  qtyUnit: {
    fontFamily: fonts.body,
    fontSize: 9,
    color: '#94A3B8',
  },
  qtyDivider: {
    width: 1,
    height: 18,
    backgroundColor: '#E2E8F0',
  },
  centerLoading: {
    paddingVertical: 36,
    alignItems: 'center',
  },
  emptyStateBox: {
    backgroundColor: '#FCFDFE',
    borderRadius: 22,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderTopColor: '#FFFFFF',
    borderBottomColor: 'rgba(215, 225, 238, 0.75)',
  },
  emptyStateTitle: {
    fontFamily: fonts.heading,
    fontSize: 16,
    color: '#192338',
  },
  emptyStateSub: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
  resetButton: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  resetButtonText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: '#2563EB',
    fontWeight: '600',
  },
  loadMoreButton: {
    backgroundColor: '#FCFDFE',
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderTopColor: '#FFFFFF',
    borderBottomColor: 'rgba(215, 225, 238, 0.75)',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
    marginTop: 4,
  },
  loadMorePressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  loadMoreText: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: '#2563EB',
    fontWeight: '700',
  },
});
