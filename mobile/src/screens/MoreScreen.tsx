import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
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
import { humanize, roleLabel } from '../format';
import { fonts, radius, shadow, spacing } from '../theme';

interface MoreScreenProps {
  onOpenAccount: () => void;
  onOpenTeam: () => void;
  onOpenClients: () => void;
  onOpenLocations: () => void;
  onOpenReports: () => void;
  onOpenHelp: () => void;
  onOpenRules: () => void;
}

export function MoreScreen({
  onOpenAccount,
  onOpenTeam,
  onOpenClients,
  onOpenLocations,
  onOpenReports,
  onOpenHelp,
  onOpenRules,
}: MoreScreenProps) {
  const insets = useSafeAreaInsets();
  const { state } = useAuth();
  const {
    inventoryOwners,
    isMultiOwner,
    activeClientId,
    pendingSyncCount,
    offlineStoreReady,
    setActiveClientId,
    refresh,
    refreshing,
  } = useWorkspace();

  const session = state.status === 'signedIn' ? state.session : null;
  const permissions = session?.permissions ?? [];
  const canViewTeam = permissions.includes('members.read');
  const canViewClients = permissions.includes('clients.read');
  const canViewLocations = permissions.includes('inventory.read');
  const canSwitchOwner = isMultiOwner && (canViewClients || permissions.includes('inventory.read'));

  const initials =
    session?.user.name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || 'N';

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
            <View style={styles.greetingBox}>
              <Text style={styles.greetingTitle}>Workspace</Text>
              <Text style={styles.greetingSubtitle} numberOfLines={1}>
                {session?.company.name ?? 'NTAN Workspace'} · {humanize(session?.company.inventory_model ?? 'internal')}
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
            BENTO KPIS AT TOP
            ========================================================================= */}

        {/* HERO OPERATOR CARD (NAVY BLUE FEATURE #1) */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open user account profile"
          onPress={onOpenAccount}
          style={({ pressed }) => [styles.bentoHeroNavy, pressed && { opacity: 0.95 }]}
        >
          <View style={styles.bentoHeroTopRow}>
            <View style={styles.bentoTag}>
              <View style={styles.pulseDot} />
              <Text style={styles.bentoTagText}>OPERATOR PROFILE</Text>
            </View>
            <Text style={styles.bentoWarehouseBadge}>
              {roleLabel(session?.membership.role ?? 'viewer')}
            </Text>
          </View>

          <View style={styles.profileMainRow}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>
            <View style={styles.profileTextGroup}>
              <Text style={styles.bentoHeroNumber} numberOfLines={1}>
                {session?.user.name}
              </Text>
              <Text style={styles.bentoHeroUnit} numberOfLines={1}>
                {session?.user.email}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color="#FFBF32" />
          </View>

          {/* Dual Inset Capsules */}
          <View style={styles.bentoCapsulesRow}>
            <View style={styles.bentoCapsule}>
              <View style={[styles.capsuleIconDot, { backgroundColor: '#10B981' }]}>
                <MaterialCommunityIcons name="shield-check" size={12} color="#FFFFFF" />
              </View>
              <View style={styles.capsuleTextWrap}>
                <Text style={styles.capsuleLabel}>Permissions</Text>
                <Text style={styles.capsuleValue}>{permissions.length} Active Scopes</Text>
              </View>
            </View>

            <View style={styles.bentoCapsule}>
              <View style={[styles.capsuleIconDot, { backgroundColor: '#3B82F6' }]}>
                <MaterialCommunityIcons name="office-building" size={12} color="#FFFFFF" />
              </View>
              <View style={styles.capsuleTextWrap}>
                <Text style={styles.capsuleLabel}>Inventory Model</Text>
                <Text style={styles.capsuleValue} numberOfLines={1}>
                  {humanize(session?.company.inventory_model ?? 'internal')}
                </Text>
              </View>
            </View>
          </View>
        </Pressable>

        {/* BENTO 2-COLUMN DUO */}
        <View style={styles.bentoSplitRow}>
          {/* Tile A: Local Store (Light Hybrid #FCFDFE) */}
          <View style={[styles.bentoTile, styles.bentoTileLight]}>
            <View style={styles.tileHeaderRow}>
              <Text style={styles.tileTitleLight}>Local Store</Text>
              <View
                style={[
                  styles.syncIndicatorDot,
                  { backgroundColor: offlineStoreReady ? '#10B981' : '#F59E0B' },
                ]}
              />
            </View>
            <View style={styles.tileMetricWrap}>
              <Text style={styles.tileNumberLight}>
                {offlineStoreReady ? 'Ready' : 'Offline'}
              </Text>
              <Text style={styles.tileSubLight}>SQLite local storage</Text>
            </View>
          </View>

          {/* Tile B: Cloud Sync (NAVY BLUE FEATURE #2 #192338) */}
          <View style={[styles.bentoTile, styles.bentoTileNavy]}>
            <View style={styles.tileHeaderRow}>
              <Text style={styles.tileTitleNavy}>Cloud Sync</Text>
              <MaterialCommunityIcons name="sync" size={17} color="#FFBF32" />
            </View>
            <View style={styles.tileMetricWrap}>
              <Text style={styles.tileNumberGold}>
                {pendingSyncCount === 0 ? 'Live' : pendingSyncCount}
              </Text>
              <Text style={styles.tileSubNavy}>
                {pendingSyncCount === 0 ? 'All changes synced' : 'Records queued'}
              </Text>
            </View>
          </View>
        </View>

        {/* =========================================================================
            INVENTORY OWNER SCOPE (3PL / Multi-Owner)
            ========================================================================= */}
        {canSwitchOwner ? (
          <View style={styles.sectionWrap}>
            <Text style={styles.sectionHeading}>Inventory Owner Scope</Text>
            <View style={styles.hybridCard}>
              <View style={styles.ownerPillList}>
                <Pressable
                  onPress={() => setActiveClientId(null)}
                  style={[
                    styles.ownerPill,
                    activeClientId === null && styles.ownerPillActive,
                  ]}
                >
                  <MaterialCommunityIcons
                    name="account-multiple-outline"
                    size={16}
                    color={activeClientId === null ? '#FFBF32' : '#65778B'}
                  />
                  <View style={styles.ownerPillTextGroup}>
                    <Text
                      style={[
                        styles.ownerPillName,
                        activeClientId === null && styles.ownerPillNameActive,
                      ]}
                    >
                      All Owners
                    </Text>
                    <Text
                      style={[
                        styles.ownerPillSub,
                        activeClientId === null && styles.ownerPillSubActive,
                      ]}
                    >
                      Combined view across clients
                    </Text>
                  </View>
                  {activeClientId === null ? (
                    <MaterialCommunityIcons name="check-circle" size={17} color="#FFBF32" />
                  ) : null}
                </Pressable>

                {inventoryOwners.map((owner) => {
                  const isSelected = activeClientId === owner.id;
                  return (
                    <Pressable
                      key={owner.id}
                      onPress={() => setActiveClientId(owner.id)}
                      style={[styles.ownerPill, isSelected && styles.ownerPillActive]}
                    >
                      <MaterialCommunityIcons
                        name={owner.is_internal ? 'warehouse' : 'briefcase-outline'}
                        size={16}
                        color={isSelected ? '#FFBF32' : '#65778B'}
                      />
                      <View style={styles.ownerPillTextGroup}>
                        <Text
                          style={[
                            styles.ownerPillName,
                            isSelected && styles.ownerPillNameActive,
                          ]}
                        >
                          {owner.name}
                        </Text>
                        <Text
                          style={[
                            styles.ownerPillSub,
                            isSelected && styles.ownerPillSubActive,
                          ]}
                        >
                          {owner.code} · {owner.is_internal ? 'Internal Stock' : 'Client Stock'}
                        </Text>
                      </View>
                      {isSelected ? (
                        <MaterialCommunityIcons name="check-circle" size={17} color="#FFBF32" />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>
        ) : null}

        {/* =========================================================================
            GOVERNANCE & CONFIGURATION (HYBRID WORKFLOW CARDS)
            ========================================================================= */}
        <View style={styles.sectionWrap}>
          <Text style={styles.sectionHeading}>System Governance</Text>

          {canViewTeam ? (
            <Pressable
              onPress={onOpenTeam}
              style={({ pressed }) => [styles.workflowCard, pressed && styles.cardPressed]}
            >
              <View style={[styles.workflowIconWrap, { backgroundColor: '#EFF6FF' }]}>
                <MaterialCommunityIcons name="account-group-outline" size={24} color="#2563EB" />
              </View>
              <View style={styles.workflowInfo}>
                <Text style={styles.workflowTitle}>Team & Access</Text>
                <Text style={styles.workflowSubtitle}>
                  User invitations, permissions and role governance
                </Text>
              </View>
              <View style={styles.workflowActionWrap}>
                <MaterialCommunityIcons name="chevron-right" size={20} color="#64748B" />
              </View>
            </Pressable>
          ) : null}

          {canViewClients ? (
            <Pressable
              onPress={onOpenClients}
              style={({ pressed }) => [styles.workflowCard, pressed && styles.cardPressed]}
            >
              <View style={[styles.workflowIconWrap, { backgroundColor: '#F5F3FF' }]}>
                <MaterialCommunityIcons name="briefcase-outline" size={24} color="#7C3AED" />
              </View>
              <View style={styles.workflowInfo}>
                <Text style={styles.workflowTitle}>Business Partners</Text>
                <Text style={styles.workflowSubtitle}>
                  Suppliers, vendors and registered 3PL clients
                </Text>
              </View>
              <View style={styles.workflowActionWrap}>
                <MaterialCommunityIcons name="chevron-right" size={20} color="#64748B" />
              </View>
            </Pressable>
          ) : null}

          {canViewLocations ? (
            <Pressable
              onPress={onOpenLocations}
              style={({ pressed }) => [styles.workflowCard, pressed && styles.cardPressed]}
            >
              <View style={[styles.workflowIconWrap, { backgroundColor: '#ECFDF5' }]}>
                <MaterialCommunityIcons name="map-marker-radius-outline" size={24} color="#059669" />
              </View>
              <View style={styles.workflowInfo}>
                <Text style={styles.workflowTitle}>Warehouses & Bins</Text>
                <Text style={styles.workflowSubtitle}>
                  Aisle, rack, shelf, bin topology and zones
                </Text>
              </View>
              <View style={styles.workflowActionWrap}>
                <MaterialCommunityIcons name="chevron-right" size={20} color="#64748B" />
              </View>
            </Pressable>
          ) : null}

          <Pressable
            onPress={onOpenRules}
            style={({ pressed }) => [styles.workflowCard, pressed && styles.cardPressed]}
          >
            <View style={[styles.workflowIconWrap, { backgroundColor: '#FEF3C7' }]}>
              <MaterialCommunityIcons name="tune-vertical" size={24} color="#D97706" />
            </View>
            <View style={styles.workflowInfo}>
              <Text style={styles.workflowTitle}>Warehouse Rules</Text>
              <Text style={styles.workflowSubtitle}>
                FIFO / FEFO picking and receiving policies
              </Text>
            </View>
            <View style={styles.workflowActionWrap}>
              <MaterialCommunityIcons name="chevron-right" size={20} color="#64748B" />
            </View>
          </Pressable>
        </View>

        {/* =========================================================================
            INTELLIGENCE & SUPPORT (UTILITY TILES)
            ========================================================================= */}
        <View style={styles.sectionWrap}>
          <Text style={styles.sectionHeading}>Intelligence & Support</Text>

          <View style={styles.utilityGrid}>
            <Pressable
              onPress={onOpenReports}
              style={({ pressed }) => [styles.utilityCard, pressed && styles.cardPressed]}
            >
              <View style={[styles.utilityIconWrap, { backgroundColor: '#EFF6FF' }]}>
                <MaterialCommunityIcons name="chart-box-outline" size={20} color="#2563EB" />
              </View>
              <View style={styles.utilityInfo}>
                <Text style={styles.utilityTitle}>Reports</Text>
                <Text style={styles.utilitySubtitle}>Valuation & AI</Text>
              </View>
            </Pressable>

            <Pressable
              onPress={onOpenHelp}
              style={({ pressed }) => [styles.utilityCard, pressed && styles.cardPressed]}
            >
              <View style={[styles.utilityIconWrap, { backgroundColor: '#ECFDF5' }]}>
                <MaterialCommunityIcons name="headset" size={20} color="#059669" />
              </View>
              <View style={styles.utilityInfo}>
                <Text style={styles.utilityTitle}>Help & SOPs</Text>
                <Text style={styles.utilitySubtitle}>Procedures & Docs</Text>
              </View>
            </Pressable>
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
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 3,
  },
  iconButtonPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.95 }],
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
  profileMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontFamily: fonts.heading,
    fontSize: 18,
    color: '#FFBF32',
    fontWeight: '800',
  },
  profileTextGroup: {
    flex: 1,
    gap: 2,
  },
  bentoHeroNumber: {
    fontFamily: fonts.heading,
    fontSize: 22,
    color: '#FFFFFF',
    fontWeight: '800',
    letterSpacing: -0.5,
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
  bentoTileNavy: {
    backgroundColor: '#192338',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 20,
    elevation: 6,
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
  tileTitleNavy: {
    fontFamily: fonts.heading,
    fontSize: 14,
    color: '#FFFFFF',
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
  tileNumberGold: {
    fontFamily: fonts.heading,
    fontSize: 22,
    color: '#FFBF32',
    fontWeight: '800',
  },
  tileSubLight: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#64748B',
  },
  tileSubNavy: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#94A3B8',
  },

  // Sections
  sectionWrap: {
    gap: 10,
    marginTop: 4,
  },
  sectionHeading: {
    fontFamily: fonts.heading,
    fontSize: 18,
    color: '#192338',
    letterSpacing: -0.3,
  },

  // Hybrid Card Standard
  hybridCard: {
    backgroundColor: '#FCFDFE',
    borderRadius: 22,
    padding: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderTopColor: '#FFFFFF',
    borderBottomColor: 'rgba(215, 225, 238, 0.75)',
    gap: 12,
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 4,
  },

  // Owner Selection List
  ownerPillList: {
    gap: 8,
  },
  ownerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F6F9FD',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1.2,
    borderColor: '#DFE7F0',
  },
  ownerPillActive: {
    backgroundColor: '#192338',
    borderColor: '#192338',
  },
  ownerPillTextGroup: {
    flex: 1,
  },
  ownerPillName: {
    fontFamily: fonts.heading,
    fontSize: 13,
    color: '#192338',
  },
  ownerPillNameActive: {
    color: '#FFFFFF',
  },
  ownerPillSub: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#64748B',
  },
  ownerPillSubActive: {
    color: '#94A3B8',
  },

  // Workflow Cards (Identical to OperationsScreen)
  workflowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FCFDFE',
    borderRadius: 20,
    padding: 15,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderTopColor: '#FFFFFF',
    borderBottomColor: 'rgba(215, 225, 238, 0.75)',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 3,
    gap: 14,
  },
  cardPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
  },
  workflowIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workflowInfo: {
    flex: 1,
    gap: 2,
  },
  workflowTitle: {
    fontFamily: fonts.heading,
    fontSize: 15,
    color: '#192338',
    fontWeight: '700',
  },
  workflowSubtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: '#64748B',
  },
  workflowActionWrap: {
    paddingLeft: 4,
  },

  // Utility 2-Column Grid
  utilityGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  utilityCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FCFDFE',
    borderRadius: 18,
    padding: 13,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderTopColor: '#FFFFFF',
    borderBottomColor: 'rgba(215, 225, 238, 0.75)',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
    gap: 10,
  },
  utilityIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  utilityInfo: {
    flex: 1,
    gap: 1,
  },
  utilityTitle: {
    fontFamily: fonts.heading,
    fontSize: 13.5,
    color: '#192338',
    fontWeight: '700',
  },
  utilitySubtitle: {
    fontFamily: fonts.body,
    fontSize: 10.5,
    color: '#64748B',
  },
});
