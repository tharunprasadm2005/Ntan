import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { Badge } from './Badge';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { Field } from './Field';
import { SelectField } from './SelectField';
import { useWorkspace } from '../data';
import { formatQty } from '../format';
import type {
  ItemSupplier,
  ItemSupplierInput,
  ItemSupplierUpdateInput,
} from '../types';
import { colors, fonts, radius, spacing } from '../theme';

type FormMode = { mappingId: string | null };

export function SupplierLinkSection({
  itemId,
  onOpenSupplier,
  onChanged,
}: {
  itemId: string;
  onOpenSupplier?: (supplierId: string) => void;
  onChanged?: () => void;
}) {
  const { state } = useAuth();
  const { clients } = useWorkspace();
  const session = state.status === 'signedIn' ? state.session : null;
  const permissions = session?.permissions ?? [];
  const canWrite = permissions.includes('inventory.write');
  const canReadCost = permissions.includes('cost.read');
  const companyCurrency = session?.company.currency ?? 'USD';

  const [suppliers, setSuppliers] = useState<ItemSupplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormMode | null>(null);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [supplierSku, setSupplierSku] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [currency, setCurrency] = useState(companyCurrency);
  const [leadTimeDays, setLeadTimeDays] = useState('');
  const [minOrderQty, setMinOrderQty] = useState('');
  const [preferred, setPreferred] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const activeSuppliers = useMemo(
    () =>
      clients
        .filter(
          (client) =>
            client.status === 'active' && client.types?.includes('supplier'),
        )
        .sort((a, b) =>
          (a.display_name || a.name).localeCompare(b.display_name || b.name),
        ),
    [clients],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await api.itemSuppliers(itemId, true);
      setSuppliers(response.suppliers);
    } catch (error) {
      setLoadError(
        error instanceof ApiError
          ? error.message
          : 'Supplier links could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setForm(null);
    setSupplierId(null);
    setSupplierSku('');
    setPurchasePrice('');
    setCurrency(companyCurrency);
    setLeadTimeDays('');
    setMinOrderQty('');
    setPreferred(false);
    setFormError(null);
    setFieldErrors({});
  };

  const startLink = () => {
    setForm({ mappingId: null });
    setSupplierId(activeSuppliers[0]?.id ?? null);
    setSupplierSku('');
    setPurchasePrice('');
    setCurrency(companyCurrency);
    setLeadTimeDays('');
    setMinOrderQty('');
    setPreferred(false);
    setFormError(null);
    setFieldErrors({});
  };

  const startEdit = (mapping: ItemSupplier) => {
    setForm({ mappingId: mapping.id });
    setSupplierId(mapping.supplier_id);
    setSupplierSku(mapping.supplier_sku);
    setPurchasePrice(mapping.purchase_price ?? '');
    setCurrency(mapping.currency || companyCurrency);
    setLeadTimeDays(
      mapping.lead_time_days === null ? '' : String(mapping.lead_time_days),
    );
    setMinOrderQty(mapping.min_order_qty ?? '');
    setPreferred(mapping.is_preferred);
    setFormError(null);
    setFieldErrors({});
  };

  const validate = (): string | null => {
    if (!supplierId) {
      return 'Select a supplier.';
    }
    if (!supplierSku.trim()) {
      setFieldErrors({ supplier_sku: 'Supplier SKU is required.' });
      return 'Enter the supplier SKU.';
    }
    if (purchasePrice.trim()) {
      const value = Number(purchasePrice.trim().replace(',', '.'));
      if (!Number.isFinite(value) || value < 0) {
        setFieldErrors({ purchase_price: 'Price must be zero or greater.' });
        return 'Purchase price must be zero or greater.';
      }
    }
    if (leadTimeDays.trim()) {
      const value = Number(leadTimeDays.trim());
      if (!Number.isInteger(value) || value < 0 || value > 3650) {
        setFieldErrors({ lead_time_days: 'Enter 0–3650 days.' });
        return 'Lead time must be a whole number of days.';
      }
    }
    if (minOrderQty.trim()) {
      const value = Number(minOrderQty.trim().replace(',', '.'));
      if (!Number.isFinite(value) || value <= 0) {
        setFieldErrors({ min_order_qty: 'Enter a quantity above zero.' });
        return 'Minimum order quantity must be above zero.';
      }
    }
    if (!/^[A-Z]{3}$/.test(currency.trim().toUpperCase())) {
      setFieldErrors({ currency: 'Use a 3-letter currency code.' });
      return 'Enter a three-letter currency code, for example USD.';
    }
    return null;
  };

  const save = async () => {
    if (!form || !supplierId) {
      return;
    }
    setFormError(null);
    setFieldErrors({});
    const validation = validate();
    if (validation) {
      setFormError(validation);
      return;
    }

    const cleanLeadTime = leadTimeDays.trim() ? Number(leadTimeDays.trim()) : null;
    const cleanCurrency = currency.trim().toUpperCase();
    setSaving(true);
    try {
      if (form.mappingId) {
        const payload: ItemSupplierUpdateInput = {
          supplier_sku: supplierSku.trim(),
          currency: cleanCurrency,
          lead_time_days: cleanLeadTime,
          min_order_qty: minOrderQty.trim()
            ? minOrderQty.trim().replace(',', '.')
            : null,
          is_preferred: preferred,
        };
        if (canReadCost) {
          payload.purchase_price = purchasePrice.trim()
            ? purchasePrice.trim().replace(',', '.')
            : null;
        }
        await api.updateItemSupplier(itemId, form.mappingId, payload);
      } else {
        const payload: ItemSupplierInput = {
          supplier_id: supplierId,
          supplier_sku: supplierSku.trim(),
          currency: cleanCurrency,
          lead_time_days: cleanLeadTime,
          min_order_qty: minOrderQty.trim()
            ? minOrderQty.trim().replace(',', '.')
            : null,
          is_preferred: preferred,
          status: 'active',
        };
        if (canReadCost) {
          payload.purchase_price = purchasePrice.trim()
            ? purchasePrice.trim().replace(',', '.')
            : null;
        }
        await api.linkItemSupplier(itemId, payload);
      }
      resetForm();
      await load();
      onChanged?.();
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.message);
        setFieldErrors(error.fieldErrors);
      } else {
        setFormError('The supplier link could not be saved.');
      }
    } finally {
      setSaving(false);
    }
  };

  const togglePreferred = async (mapping: ItemSupplier) => {
    setLoadError(null);
    try {
      await api.updateItemSupplier(itemId, mapping.id, {
        is_preferred: !mapping.is_preferred,
        // Setting another row preferred clears the previous one server-side.
        status: mapping.status,
      });
      await load();
      onChanged?.();
    } catch (error) {
      setLoadError(
        error instanceof ApiError ? error.message : 'Could not update the link.',
      );
    }
  };

  const toggleStatus = async (mapping: ItemSupplier) => {
    setLoadError(null);
    try {
      await api.updateItemSupplier(itemId, mapping.id, {
        status: mapping.status === 'active' ? 'inactive' : 'active',
        is_preferred:
          mapping.status === 'active' ? false : mapping.is_preferred,
      });
      await load();
      onChanged?.();
    } catch (error) {
      setLoadError(
        error instanceof ApiError ? error.message : 'Could not update the link.',
      );
    }
  };

  const unlink = (mapping: ItemSupplier) => {
    Alert.alert(
      'Remove supplier link',
      `Remove ${mapping.supplier_name} from this item? Committed receipts and delivery history are kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setLoadError(null);
              try {
                await api.unlinkItemSupplier(itemId, mapping.id);
                await load();
                onChanged?.();
              } catch (error) {
                setLoadError(
                  error instanceof ApiError
                    ? error.message
                    : 'Could not remove the link.',
                );
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleWrap}>
          <Text style={styles.sectionTitle}>Suppliers</Text>
          <Text style={styles.sectionCount}>{suppliers.length}</Text>
        </View>
        {canWrite && !form ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Link supplier"
            onPress={startLink}
            style={({ pressed }) => [
              styles.addButton,
              pressed && styles.pressed,
            ]}
          >
            <MaterialCommunityIcons
              name="plus"
              size={17}
              color={colors.navy}
            />
            <Text style={styles.addButtonText}>Link</Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.primary} size="small" />
          <Text style={styles.loadingText}>Loading supplier links…</Text>
        </View>
      ) : null}

      {loadError ? (
        <View style={styles.errorBox}>
          <MaterialCommunityIcons
            name="alert-circle-outline"
            size={17}
            color={colors.danger}
          />
          <Text style={styles.errorText}>{loadError}</Text>
          <Pressable onPress={() => void load()} accessibilityLabel="Retry suppliers">
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {!loading && suppliers.length === 0 ? (
        <EmptyState
          icon="truck-delivery-outline"
          title="No suppliers linked"
          message="Link active supplier partners to keep vendor SKUs and purchasing terms on this item."
        />
      ) : null}

      {suppliers.map((mapping) => (
        <View
          key={mapping.id}
          style={[styles.supplierCard, mapping.status !== 'active' && styles.cardMuted]}
        >
          <View style={styles.supplierHeader}>
            <View style={styles.supplierIcon}>
              <MaterialCommunityIcons
                name="truck-delivery-outline"
                size={18}
                color={colors.deep}
              />
            </View>
            <Pressable
              disabled={!onOpenSupplier}
              onPress={() => onOpenSupplier?.(mapping.supplier_id)}
              style={styles.supplierTitleWrap}
            >
              <Text style={styles.supplierName} numberOfLines={1}>
                {mapping.supplier_name}
              </Text>
              <Text style={styles.supplierMeta} numberOfLines={1}>
                {mapping.supplier_code ?? 'Supplier'} · {mapping.supplier_sku}
              </Text>
            </Pressable>
            <View style={styles.badgeWrap}>
              {mapping.is_preferred ? (
                <Badge label="Preferred" tone="success" />
              ) : null}
              <Badge
                label={mapping.status === 'active' ? 'Active' : 'Inactive'}
                tone={mapping.status === 'active' ? 'info' : 'neutral'}
              />
            </View>
          </View>

          <View style={styles.factGrid}>
            {canReadCost ? (
              <Fact
                label="Purchase price"
                value={
                  mapping.purchase_price !== null
                    ? `${formatQty(mapping.purchase_price)} ${mapping.currency}`
                    : 'Not set'
                }
              />
            ) : null}
            <Fact
              label="Lead time"
              value={
                mapping.lead_time_days !== null
                  ? `${mapping.lead_time_days} days`
                  : 'Not set'
              }
            />
            <Fact
              label="Min order"
              value={
                mapping.min_order_qty !== null
                  ? formatQty(mapping.min_order_qty)
                  : 'Not set'
              }
            />
            {mapping.supplier_is_active === false ? (
              <Fact label="Supplier" value={mapping.supplier_status} />
            ) : null}
          </View>

          {canWrite ? (
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  mapping.is_preferred
                    ? 'Preferred supplier'
                    : 'Make preferred supplier'
                }
                disabled={mapping.is_preferred || mapping.status !== 'active'}
                onPress={() => void togglePreferred(mapping)}
                style={({ pressed }) => [
                  styles.actionButton,
                  mapping.is_preferred && styles.actionButtonActive,
                  pressed && styles.pressed,
                ]}
              >
                <MaterialCommunityIcons
                  name={mapping.is_preferred ? 'star' : 'star-outline'}
                  size={16}
                  color={mapping.is_preferred ? colors.navy : colors.deep}
                />
                <Text style={styles.actionText}>
                  {mapping.is_preferred ? 'Preferred' : 'Prefer'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit supplier link"
                onPress={() => startEdit(mapping)}
                style={({ pressed }) => [
                  styles.actionButton,
                  pressed && styles.pressed,
                ]}
              >
                <MaterialCommunityIcons
                  name="pencil-outline"
                  size={16}
                  color={colors.deep}
                />
                <Text style={styles.actionText}>Edit</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  mapping.status === 'active'
                    ? 'Deactivate supplier link'
                    : 'Activate supplier link'
                }
                onPress={() => void toggleStatus(mapping)}
                style={({ pressed }) => [
                  styles.actionButton,
                  pressed && styles.pressed,
                ]}
              >
                <MaterialCommunityIcons
                  name={
                    mapping.status === 'active'
                      ? 'pause-circle-outline'
                      : 'play-circle-outline'
                  }
                  size={16}
                  color={colors.deep}
                />
                <Text style={styles.actionText}>
                  {mapping.status === 'active' ? 'Pause' : 'Activate'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove supplier link"
                onPress={() => unlink(mapping)}
                style={({ pressed }) => [
                  styles.actionButton,
                  styles.actionDanger,
                  pressed && styles.pressed,
                ]}
              >
                <MaterialCommunityIcons
                  name="link-variant-off"
                  size={16}
                  color={colors.danger}
                />
                <Text style={[styles.actionText, styles.actionDangerText]}>
                  Remove
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ))}

      {form ? (
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>
            {form.mappingId ? 'Edit supplier link' : 'Link supplier'}
          </Text>
          {form.mappingId ? (
            <View style={styles.formSupplierChip}>
              <MaterialCommunityIcons
                name="truck-delivery-outline"
                size={16}
                color={colors.deep}
              />
              <Text style={styles.formSupplierName}>
                {suppliers.find((row) => row.id === form.mappingId)?.supplier_name ??
                  'Supplier'}
              </Text>
            </View>
          ) : (
            <SelectField
              label="Supplier"
              value={supplierId}
              onChange={setSupplierId}
              options={activeSuppliers.map((supplier) => ({
                value: supplier.id,
                label: supplier.display_name || supplier.name,
                hint: supplier.code,
              }))}
              placeholder="Select an active supplier"
              emptyLabel="No active supplier partners"
            />
          )}
          <Field
            label="Supplier SKU"
            value={supplierSku}
            onChangeText={setSupplierSku}
            placeholder="Vendor part number"
            autoCapitalize="characters"
            error={fieldErrors.supplier_sku}
          />
          <View style={styles.formRow}>
            {canReadCost ? (
              <Field
                label="Purchase price"
                value={purchasePrice}
                onChangeText={setPurchasePrice}
                placeholder="0.00"
                keyboardType="decimal-pad"
                error={fieldErrors.purchase_price}
                style={styles.formHalf}
              />
            ) : null}
            <Field
              label="Currency"
              value={currency}
              onChangeText={setCurrency}
              autoCapitalize="characters"
              maxLength={3}
              error={fieldErrors.currency}
              style={styles.formHalf}
            />
          </View>
          <View style={styles.formRow}>
            <Field
              label="Lead time (days)"
              value={leadTimeDays}
              onChangeText={setLeadTimeDays}
              placeholder="Optional"
              keyboardType="number-pad"
              error={fieldErrors.lead_time_days}
              style={styles.formHalf}
            />
            <Field
              label="Min order qty"
              value={minOrderQty}
              onChangeText={setMinOrderQty}
              placeholder="Optional"
              keyboardType="decimal-pad"
              error={fieldErrors.min_order_qty}
              style={styles.formHalf}
            />
          </View>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: preferred }}
            onPress={() => setPreferred((current) => !current)}
            style={styles.checkboxRow}
          >
            <MaterialCommunityIcons
              name={preferred ? 'checkbox-marked' : 'checkbox-blank-outline'}
              size={20}
              color={preferred ? colors.primary : colors.muted}
            />
            <View style={styles.checkboxText}>
              <Text style={styles.checkboxLabel}>Preferred supplier</Text>
              <Text style={styles.checkboxHint}>
                At most one preferred supplier per item. Choosing this supplier
                clears the previous preference.
              </Text>
            </View>
          </Pressable>
          {formError ? (
            <View style={styles.errorBox}>
              <MaterialCommunityIcons
                name="alert-circle-outline"
                size={17}
                color={colors.danger}
              />
              <Text style={styles.errorText}>{formError}</Text>
            </View>
          ) : null}
          <View style={styles.formActions}>
            <Button
              label="Cancel"
              variant="secondary"
              onPress={resetForm}
              style={styles.formAction}
            />
            <Button
              label={form.mappingId ? 'Save link' : 'Link supplier'}
              onPress={() => void save()}
              loading={saving}
              style={styles.formAction}
            />
          </View>
        </View>
      ) : null}

      {!loading && suppliers.length > 0 ? (
        <Text style={styles.footnote}>
          Last delivery dates come from committed receipts, not from this supplier
          link. Delivery history stays available after a link is removed.
        </Text>
      ) : null}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  sectionTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 17,
    color: colors.navy,
  },
  sectionCount: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.muted,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  addButtonText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  pressed: {
    opacity: 0.75,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  loadingText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  supplierCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
  },
  cardMuted: {
    opacity: 0.72,
  },
  supplierHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  supplierIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supplierTitleWrap: {
    flex: 1,
    gap: 1,
  },
  supplierName: {
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.navy,
  },
  supplierMeta: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  badgeWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 4,
    maxWidth: 120,
  },
  factGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  fact: {
    minWidth: 92,
    gap: 2,
  },
  factLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    letterSpacing: 0.6,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  factValue: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.navy,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  actionButtonActive: {
    backgroundColor: colors.accent,
  },
  actionText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.deep,
  },
  actionDanger: {
    backgroundColor: '#FEF2F2',
  },
  actionDangerText: {
    color: colors.danger,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  errorText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.danger,
  },
  retryText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.danger,
  },
  formCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
  },
  formTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 16,
    color: colors.navy,
  },
  formSupplierChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  formSupplierName: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  formRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  formHalf: {
    flex: 1,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  checkboxText: {
    flex: 1,
    gap: 1,
  },
  checkboxLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
  },
  checkboxHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.muted,
  },
  formActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  formAction: {
    flex: 1,
  },
  footnote: {
    fontFamily: fonts.body,
    fontSize: 10,
    lineHeight: 15,
    color: colors.muted,
  },
});
