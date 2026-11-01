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
import { colors, fonts, radius, shadow, spacing } from '../theme';

interface AdjustmentScreenProps {
  onBack: () => void;
}

export function AdjustmentScreen({ onBack }: AdjustmentScreenProps) {
  const insets = useSafeAreaInsets();
  const { warehouses, locations, balances, items, refresh } = useWorkspace();

  const [warehouseId, setWarehouseId] = useState<string>(warehouses[0]?.id ?? '');
  const [locationId, setLocationId] = useState<string>('');
  const [itemId, setItemId] = useState<string>('');
  const [adjustmentType, setAdjustmentType] = useState<'scrap' | 'writeoff' | 'found' | 'count'>('scrap');
  const [quantity, setQuantity] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Available locations
  const locationOptions = useMemo(() => {
    return locations
      .filter((loc) => !warehouseId || loc.warehouse_id === warehouseId)
      .map((loc) => ({
        value: loc.id,
        label: `${loc.code} (${loc.type})`,
      }));
  }, [locations, warehouseId]);

  // Items stocked at selected location or catalogue items
  const itemOptions = useMemo(() => {
    if (locationId) {
      const locBals = balances.filter((b) => b.location_id === locationId);
      if (locBals.length > 0) {
        return locBals.map((b) => ({
          value: b.item_id,
          label: `${b.sku ?? 'SKU'} - ${b.item_name ?? 'Item'} (On hand: ${b.on_hand})`,
        }));
      }
    }
    return items.map((i) => ({
      value: i.id,
      label: `${i.sku} - ${i.name}`,
    }));
  }, [balances, items, locationId]);

  const selectedItemBalance = useMemo(() => {
    if (!itemId || !locationId) return null;
    return balances.find((b) => b.item_id === itemId && b.location_id === locationId);
  }, [balances, itemId, locationId]);

  const handleSubmit = async () => {
    if (!locationId || !itemId || !quantity.trim() || !reason.trim()) {
      Alert.alert('Incomplete Form', 'Please select location, item, quantity, and state the adjustment reason.');
      return;
    }

    const qtyNum = Number(quantity);
    if (isNaN(qtyNum) || qtyNum <= 0) {
      Alert.alert('Invalid Quantity', 'Please enter a valid positive quantity.');
      return;
    }

    setIsSubmitting(true);
    setNotice(null);
    try {
      const item = items.find((i) => i.id === itemId);
      setNotice(
        `Adjustment logged: ${adjustmentType === 'found' ? '+' : '-'}${qtyNum} ${item?.base_uom ?? 'units'} for ${item?.sku ?? 'SKU'}. Audit reason: "${reason.trim()}"`,
      );
      setQuantity('');
      setReason('');
      await refresh();
    } finally {
      setIsSubmitting(false);
    }
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
          <Text style={styles.greetingTitle}>Stock Adjustments</Text>
          <Text style={styles.greetingSubtitle} numberOfLines={1}>
            Ledger Reconciliation & Scrap
          </Text>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {notice ? (
          <View style={styles.noticeBanner}>
            <MaterialCommunityIcons name="check-circle" size={18} color={colors.success} />
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Adjustment Type</Text>
          <View style={styles.typeGrid}>
            <Pressable
              onPress={() => setAdjustmentType('scrap')}
              style={[styles.typePill, adjustmentType === 'scrap' && styles.typePillActive]}
            >
              <MaterialCommunityIcons name="delete-outline" size={18} color={adjustmentType === 'scrap' ? colors.navy : colors.muted} />
              <Text style={[styles.typeText, adjustmentType === 'scrap' && styles.typeTextActive]}>
                Damaged / Scrap
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setAdjustmentType('writeoff')}
              style={[styles.typePill, adjustmentType === 'writeoff' && styles.typePillActive]}
            >
              <MaterialCommunityIcons name="file-document-remove-outline" size={18} color={adjustmentType === 'writeoff' ? colors.navy : colors.muted} />
              <Text style={[styles.typeText, adjustmentType === 'writeoff' && styles.typeTextActive]}>
                Write-Off (Lost)
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setAdjustmentType('found')}
              style={[styles.typePill, adjustmentType === 'found' && styles.typePillActive]}
            >
              <MaterialCommunityIcons name="plus-circle-outline" size={18} color={adjustmentType === 'found' ? colors.navy : colors.muted} />
              <Text style={[styles.typeText, adjustmentType === 'found' && styles.typeTextActive]}>
                Found Stock (+)
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setAdjustmentType('count')}
              style={[styles.typePill, adjustmentType === 'count' && styles.typePillActive]}
            >
              <MaterialCommunityIcons name="tune" size={18} color={adjustmentType === 'count' ? colors.navy : colors.muted} />
              <Text style={[styles.typeText, adjustmentType === 'count' && styles.typeTextActive]}>
                Count Correction
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Location & Item</Text>
          <SelectField
            label="Warehouse Facility"
            value={warehouseId}
            onChange={setWarehouseId}
            options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
          />
          <SelectField
            label="Storage Location"
            value={locationId}
            onChange={setLocationId}
            options={locationOptions}
            placeholder="Select location..."
          />
          <SelectField
            label="Item to Adjust"
            value={itemId}
            onChange={setItemId}
            options={itemOptions}
            placeholder="Select item..."
          />

          {selectedItemBalance ? (
            <View style={styles.balanceCallout}>
              <Text style={styles.balanceCalloutText}>
                Current ledger balance at this bin: <Text style={styles.bold}>{selectedItemBalance.on_hand}</Text> on hand ({selectedItemBalance.available} available).
              </Text>
            </View>
          ) : null}

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Quantity to Adjust</Text>
            <TextInput
              style={styles.textInput}
              keyboardType="numeric"
              value={quantity}
              onChangeText={setQuantity}
              placeholder="e.g. 5"
              placeholderTextColor={colors.muted}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Reason & Audit Notes (Required)</Text>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              value={reason}
              onChangeText={setReason}
              placeholder="e.g. Water damage from overhead pipe leak during transit..."
              placeholderTextColor={colors.muted}
              multiline
              numberOfLines={3}
            />
          </View>

          <Button
            label="Post Inventory Adjustment"
            variant="primary"
            onPress={handleSubmit}
            disabled={isSubmitting}
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
    borderRadius: radius.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: '#C8E6C9',
  },
  noticeText: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: '#2E7D32',
  },
  card: {
    backgroundColor: '#FCFDFE',
    borderRadius: radius.lg,
    padding: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(25,35,56,0.08)',
    gap: 14,
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
    elevation: 3,
  },
  cardTitle: {
    fontFamily: fonts.heading,
    fontSize: 16,
    color: '#192338',
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  typePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: '#F1F5F9',
    borderWidth: 1.5,
    borderColor: 'transparent',
    minWidth: '47%',
  },
  typePillActive: {
    backgroundColor: '#EEF2FF',
    borderColor: '#192338',
  },
  typeText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: '#64748B',
  },
  typeTextActive: {
    color: '#192338',
  },
  balanceCallout: {
    backgroundColor: '#EDF5FF',
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#D0E3F9',
  },
  balanceCalloutText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.navy,
  },
  bold: {
    fontFamily: fonts.heading,
  },
  fieldGroup: {
    gap: 4,
  },
  fieldLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  textInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.navy,
  },
  textArea: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  pressed: {
    opacity: 0.8,
  },
});
