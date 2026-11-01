import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { SelectField } from '../components/SelectField';
import { useWorkspace } from '../data';
import { formatQty } from '../format';
import { colors, fonts, radius, shadow, spacing } from '../theme';
import type { Balance, Location } from '../types';

interface CycleCountScreenProps {
  onBack: () => void;
}

interface CountRecord {
  balanceId: string;
  itemId: string;
  sku: string;
  name: string;
  expectedQty: number;
  countedQty: number;
}

export function CycleCountScreen({ onBack }: CycleCountScreenProps) {
  const insets = useSafeAreaInsets();
  const { warehouses, locations, balances, items } = useWorkspace();

  const [warehouseId, setWarehouseId] = useState<string>(warehouses[0]?.id ?? '');
  const [locationId, setLocationId] = useState<string>('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [auditCommitted, setAuditCommitted] = useState(false);
  const [auditSummary, setAuditSummary] = useState<{
    totalItems: number;
    matched: number;
    discrepancies: number;
    accuracyRate: string;
  } | null>(null);

  // Available locations in chosen facility
  const locationOptions = useMemo(() => {
    return locations
      .filter((loc) => !warehouseId || loc.warehouse_id === warehouseId)
      .map((loc) => ({
        value: loc.id,
        label: `${loc.code} (${loc.type})`,
      }));
  }, [locations, warehouseId]);

  // Expected items & balances at chosen location
  const locationBalances = useMemo(() => {
    if (!locationId) return [];
    return balances.filter((b) => b.location_id === locationId);
  }, [balances, locationId]);

  const handleCountChange = (balanceId: string, val: string) => {
    setCounts((prev) => ({
      ...prev,
      [balanceId]: val,
    }));
  };

  const handleCommitAudit = () => {
    if (locationBalances.length === 0) {
      Alert.alert('No Items', 'No balances exist at this location to audit.');
      return;
    }

    let matched = 0;
    let discrepancies = 0;

    for (const b of locationBalances) {
      const exp = Number(b.on_hand ?? 0);
      const counted = Number(counts[b.id] ?? exp);
      if (exp === counted) {
        matched++;
      } else {
        discrepancies++;
      }
    }

    const total = locationBalances.length;
    const accuracy = ((matched / total) * 100).toFixed(1);

    setAuditSummary({
      totalItems: total,
      matched,
      discrepancies,
      accuracyRate: `${accuracy}%`,
    });
    setAuditCommitted(true);
  };

  return (
    <View style={styles.root}>
      {/* Top Header: Pure Hexagon Logo + Back Button + Title */}
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
            <Text style={styles.greetingTitle}>Cycle Count</Text>
            <Text style={styles.greetingSubtitle} numberOfLines={1}>
              Physical Stock Audit & Reconciliation
            </Text>
          </View>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Location Selector */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Audit Location Scope</Text>
          <SelectField
            label="Warehouse Facility"
            value={warehouseId}
            onChange={setWarehouseId}
            options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
          />
          <SelectField
            label="Target Storage Bin / Bay"
            value={locationId}
            onChange={setLocationId}
            options={locationOptions}
            placeholder="Select location to audit..."
          />
        </View>

        {auditCommitted && auditSummary ? (
          <View style={styles.summaryCard}>
            <View style={styles.summaryHeader}>
              <MaterialCommunityIcons name="check-decagram" size={28} color={colors.success} />
              <View>
                <Text style={styles.summaryTitle}>Audit Session Reconciled</Text>
                <Text style={styles.summarySub}>Discrepancies evaluated against system stock ledger.</Text>
              </View>
            </View>
            <View style={styles.summaryMetrics}>
              <View style={styles.summaryMetricItem}>
                <Text style={styles.summaryMetricVal}>{auditSummary.accuracyRate}</Text>
                <Text style={styles.summaryMetricLabel}>Accuracy Rate</Text>
              </View>
              <View style={styles.summaryMetricItem}>
                <Text style={styles.summaryMetricVal}>{auditSummary.matched}</Text>
                <Text style={styles.summaryMetricLabel}>Exact Matches</Text>
              </View>
              <View style={styles.summaryMetricItem}>
                <Text style={[styles.summaryMetricVal, { color: colors.danger }]}>
                  {auditSummary.discrepancies}
                </Text>
                <Text style={styles.summaryMetricLabel}>Variances</Text>
              </View>
            </View>
            <Button
              label="Audit Another Location"
              variant="secondary"
              onPress={() => {
                setAuditCommitted(false);
                setAuditSummary(null);
                setCounts({});
              }}
            />
          </View>
        ) : null}

        {/* Expected Balances vs Physical Count */}
        {locationId ? (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Items at Location ({locationBalances.length})</Text>
              <Badge label="Active Counting" tone="info" />
            </View>

            {locationBalances.length === 0 ? (
              <View style={styles.emptyWrap}>
                <MaterialCommunityIcons name="cube-outline" size={32} color={colors.muted} />
                <Text style={styles.emptyText}>No registered stock balances at this bin.</Text>
              </View>
            ) : (
              locationBalances.map((b) => {
                const expected = Number(b.on_hand ?? 0);
                const currentCount = counts[b.id] !== undefined ? Number(counts[b.id]) : expected;
                const variance = currentCount - expected;

                return (
                  <View key={b.id} style={styles.countRow}>
                    <View style={styles.countInfo}>
                      <Text style={styles.countSku}>{b.sku || 'SKU'}</Text>
                      <Text style={styles.countName}>{b.item_name || 'Item'}</Text>
                      <Text style={styles.countExpected}>
                        System Ledger: <Text style={styles.bold}>{expected}</Text> units
                      </Text>
                    </View>

                    <View style={styles.inputWrap}>
                      <Text style={styles.inputLabel}>Physical Count</Text>
                      <TextInput
                        style={styles.countInput}
                        keyboardType="numeric"
                        value={counts[b.id] ?? String(expected)}
                        onChangeText={(val) => handleCountChange(b.id, val)}
                      />
                      <Badge
                        label={variance === 0 ? 'Match' : `${variance > 0 ? '+' : ''}${variance}`}
                        tone={variance === 0 ? 'success' : 'warning'}
                      />
                    </View>
                  </View>
                );
              })
            )}

            {locationBalances.length > 0 && !auditCommitted ? (
              <View style={styles.actionsBlock}>
                <Button label="Confirm & Reconcile Audit" variant="primary" onPress={handleCommitAudit} />
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
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
    fontSize: 24,
    color: '#192338',
    letterSpacing: -0.5,
    lineHeight: 30,
  },
  greetingSubtitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 12.5,
    color: '#64748B',
    marginTop: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 14,
    paddingBottom: 16,
  },
  card: {
    backgroundColor: '#FCFDFE',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderTopColor: '#FFFFFF',
    borderBottomColor: 'rgba(215, 225, 238, 0.75)',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.07,
    shadowRadius: 16,
    elevation: 4,
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontFamily: fonts.heading,
    fontSize: 16,
    color: colors.navy,
  },
  summaryCard: {
    backgroundColor: '#E8F5E9',
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: '#C8E6C9',
    gap: spacing.md,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  summaryTitle: {
    fontFamily: fonts.heading,
    fontSize: 16,
    color: '#2E7D32',
  },
  summarySub: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: '#2E7D32',
  },
  summaryMetrics: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  summaryMetricItem: {
    flex: 1,
    backgroundColor: colors.white,
    padding: spacing.md,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  summaryMetricVal: {
    fontFamily: fonts.heading,
    fontSize: 22,
    color: colors.navy,
  },
  summaryMetricLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  countInfo: {
    flex: 1,
    gap: 2,
  },
  countSku: {
    fontFamily: fonts.heading,
    fontSize: 14,
    color: colors.navy,
  },
  countName: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  countExpected: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.deep,
    marginTop: 2,
  },
  bold: {
    fontFamily: fonts.heading,
  },
  inputWrap: {
    alignItems: 'flex-end',
    gap: 4,
  },
  inputLabel: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  countInput: {
    width: 80,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    textAlign: 'center',
    fontFamily: fonts.heading,
    fontSize: 15,
    color: colors.navy,
  },
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    gap: spacing.xs,
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  actionsBlock: {
    marginTop: spacing.sm,
  },
  pressed: {
    opacity: 0.8,
  },
});
