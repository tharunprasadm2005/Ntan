import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { colors, fonts, radius, shadow, spacing } from '../theme';
import {
  DEFAULT_WAREHOUSE_RULES,
  loadWarehouseRules,
  saveWarehouseRules,
  type WarehouseRulesConfig,
} from '../warehouseRulesStorage';

interface WarehouseRulesScreenProps {
  onBack: () => void;
}

export function WarehouseRulesScreen({ onBack }: WarehouseRulesScreenProps) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<WarehouseRulesConfig>(DEFAULT_WAREHOUSE_RULES);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void loadWarehouseRules().then((loaded) => {
      setRules(loaded);
      setLoading(false);
    });
  }, []);

  const updateRule = async <K extends keyof WarehouseRulesConfig>(
    key: K,
    val: WarehouseRulesConfig[K],
  ) => {
    const next = { ...rules, [key]: val };
    setRules(next);
    await saveWarehouseRules(next);
    setNotice('Rule updated and saved to warehouse profile.');
    setTimeout(() => setNotice(null), 3000);
  };

  const handleResetDefaults = async () => {
    setRules(DEFAULT_WAREHOUSE_RULES);
    await saveWarehouseRules(DEFAULT_WAREHOUSE_RULES);
    setNotice('Reset all warehouse rules to standard defaults.');
    setTimeout(() => setNotice(null), 3000);
  };

  if (loading) {
    return (
      <View style={styles.centerRoot}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>Loading warehouse rules...</Text>
      </View>
    );
  }

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
          <Text style={styles.greetingTitle}>Warehouse Rules</Text>
          <Text style={styles.greetingSubtitle} numberOfLines={1}>
            Facility & Allocation Governance
          </Text>
        </View>
        <Badge label="Saved" tone="success" />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {notice ? (
          <View style={styles.noticeBanner}>
            <MaterialCommunityIcons name="check-circle" size={18} color={colors.success} />
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        ) : null}

        {/* Section 1: Fulfillment & Picking Strategy */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionEyebrow}>OUTBOUND & ALLOCATION</Text>
          <Text style={styles.sectionTitle}>Picking Strategy</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardDescription}>
            Determines how the allocation engine chooses lots and bins when fulfilling sales orders.
          </Text>

          <View style={styles.optionsGroup}>
            <Pressable
              onPress={() => void updateRule('pickStrategy', 'fefo')}
              style={[styles.strategyRow, rules.pickStrategy === 'fefo' && styles.strategyRowActive]}
            >
              <View style={styles.strategyRadio}>
                {rules.pickStrategy === 'fefo' ? <View style={styles.strategyRadioInner} /> : null}
              </View>
              <View style={styles.strategyBody}>
                <View style={styles.strategyTitleRow}>
                  <Text style={styles.strategyTitle}>FEFO (First Expired, First Out)</Text>
                  <Badge label="Recommended" tone="success" />
                </View>
                <Text style={styles.strategyDesc}>
                  Prioritizes stock with the earliest expiry dates to minimize perishables and expired inventory.
                </Text>
              </View>
            </Pressable>

            <Pressable
              onPress={() => void updateRule('pickStrategy', 'fifo')}
              style={[styles.strategyRow, rules.pickStrategy === 'fifo' && styles.strategyRowActive]}
            >
              <View style={styles.strategyRadio}>
                {rules.pickStrategy === 'fifo' ? <View style={styles.strategyRadioInner} /> : null}
              </View>
              <View style={styles.strategyBody}>
                <Text style={styles.strategyTitle}>FIFO (First In, First Out)</Text>
                <Text style={styles.strategyDesc}>
                  Prioritizes stock by oldest receipt timestamp. Best for general non-perishable goods.
                </Text>
              </View>
            </Pressable>

            <Pressable
              onPress={() => void updateRule('pickStrategy', 'lifo')}
              style={[styles.strategyRow, rules.pickStrategy === 'lifo' && styles.strategyRowActive]}
            >
              <View style={styles.strategyRadio}>
                {rules.pickStrategy === 'lifo' ? <View style={styles.strategyRadioInner} /> : null}
              </View>
              <View style={styles.strategyBody}>
                <Text style={styles.strategyTitle}>LIFO (Last In, First Out)</Text>
                <Text style={styles.strategyDesc}>
                  Prioritizes the most recently received pallets. Ideal for drive-in racks or non-aging stock.
                </Text>
              </View>
            </Pressable>
          </View>
        </View>

        {/* Section 2: Inbound Receiving & Discrepancies */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionEyebrow}>INBOUND DOCK</Text>
          <Text style={styles.sectionTitle}>Receiving Tolerances</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleText}>
              <Text style={styles.toggleTitle}>Allow Over-Receiving against PO</Text>
              <Text style={styles.toggleSub}>
                Permit receiving quantities greater than the approved Purchase Order line count.
              </Text>
            </View>
            <Switch
              value={rules.allowOverReceiving}
              onValueChange={(val) => void updateRule('allowOverReceiving', val)}
              trackColor={{ false: colors.border, true: colors.accent }}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.toggleRow}>
            <View style={styles.toggleText}>
              <Text style={styles.toggleTitle}>Auto-Quarantine Damaged Cartons</Text>
              <Text style={styles.toggleSub}>
                Automatically restrict inspection-failed or damaged items to Quarantine locations.
              </Text>
            </View>
            <Switch
              value={rules.quarantineDamaged}
              onValueChange={(val) => void updateRule('quarantineDamaged', val)}
              trackColor={{ false: colors.border, true: colors.accent }}
            />
          </View>
        </View>

        {/* Section 3: Putaway & Storage Policies */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionEyebrow}>INTERNAL STORAGE</Text>
          <Text style={styles.sectionTitle}>Put-away & Bin Assignment</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleText}>
              <Text style={styles.toggleTitle}>Consolidation-First Allocation</Text>
              <Text style={styles.toggleSub}>
                Suggest bins currently holding the same SKU to prevent fragmented stock across aisles.
              </Text>
            </View>
            <Switch
              value={rules.consolidationPutaway}
              onValueChange={(val) => void updateRule('consolidationPutaway', val)}
              trackColor={{ false: colors.border, true: colors.accent }}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.toggleRow}>
            <View style={styles.toggleText}>
              <Text style={styles.toggleTitle}>Enforce Aisle · Rack · Shelf Coordinates</Text>
              <Text style={styles.toggleSub}>
                Require putaway workers to confirm warehouse coordinates before completing placement.
              </Text>
            </View>
            <Switch
              value={rules.strictCoordinates}
              onValueChange={(val) => void updateRule('strictCoordinates', val)}
              trackColor={{ false: colors.border, true: colors.accent }}
            />
          </View>
        </View>

        {/* Reset Actions */}
        <View style={styles.actionsBlock}>
          <Button
            label="Reset to Standard Defaults"
            variant="secondary"
            onPress={handleResetDefaults}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#EFF3F8',
  },
  centerRoot: {
    flex: 1,
    backgroundColor: '#EFF3F8',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  loadingText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 14,
    paddingBottom: 24,
  },
  noticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    padding: spacing.md,
    borderRadius: radius.sm,
    gap: spacing.sm,
  },
  noticeText: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: '#2E7D32',
  },
  sectionHeader: {
    marginTop: spacing.xs,
  },
  sectionEyebrow: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    letterSpacing: 1.4,
    color: colors.deep,
  },
  sectionTitle: {
    fontFamily: fonts.heading,
    fontSize: 18,
    color: colors.navy,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
    ...shadow,
  },
  cardDescription: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.deep,
    lineHeight: 18,
  },
  optionsGroup: {
    gap: spacing.sm,
  },
  strategyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  strategyRowActive: {
    borderColor: colors.accent,
    backgroundColor: '#F3E8FF',
  },
  strategyRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  strategyRadioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.navy,
  },
  strategyBody: {
    flex: 1,
    gap: 4,
  },
  strategyTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  strategyTitle: {
    fontFamily: fonts.heading,
    fontSize: 14,
    color: colors.navy,
  },
  strategyDesc: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
    lineHeight: 16,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  toggleText: {
    flex: 1,
    gap: 2,
  },
  toggleTitle: {
    fontFamily: fonts.heading,
    fontSize: 14,
    color: colors.navy,
  },
  toggleSub: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
    lineHeight: 16,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  actionsBlock: {
    marginTop: spacing.md,
  },
  pressed: {
    opacity: 0.8,
  },
});
