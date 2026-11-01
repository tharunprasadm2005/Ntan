import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Field } from '../components/Field';
import { SelectField } from '../components/SelectField';
import { SupplierLinkSection } from '../components/SupplierLinkSection';
import { useWorkspace } from '../data';
import {
  formatDate,
  formatDateTime,
  formatQty,
  humanize,
  isExpiredDate,
} from '../format';
import type { Item, ItemUpdateInput, Lot, Movement, Serial } from '../types';
import { colors, fonts, neo, palette, radius, spacing } from '../theme';

type DetailTab = 'overview' | 'lots' | 'serials' | 'ledger';

export function ItemDetailScreen({
  itemId,
  onBack,
  onChanged,
  onOpenSupplier,
}: {
  itemId: string;
  onBack: () => void;
  onChanged: () => void;
  onOpenSupplier?: (supplierId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const { state } = useAuth();
  const { balances, locations, warehouses, activeClientId } = useWorkspace();
  const session = state.status === 'signedIn' ? state.session : null;
  const permissions = session?.permissions ?? [];
  const canWrite = permissions.includes('inventory.write');
  const canReadCost = permissions.includes('cost.read');

  const [item, setItem] = useState<Item | null>(null);
  const [lots, setLots] = useState<Lot[]>([]);
  const [serials, setSerials] = useState<Serial[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>('overview');
  const [editing, setEditing] = useState(false);

  // Preferred location assignment modal state
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [locSearch, setLocSearch] = useState('');
  const [savingLocation, setSavingLocation] = useState(false);
  const [locSaveError, setLocSaveError] = useState<string | null>(null);

  const [editName, setEditName] = useState('');
  const [editBarcode, setEditBarcode] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editReorderPoint, setEditReorderPoint] = useState('');
  const [editCost, setEditCost] = useState('');
  const [editExpiryTracked, setEditExpiryTracked] = useState(false);
  const [editStatus, setEditStatus] = useState<'active' | 'archived'>('active');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [itemResponse, lotResponse, serialResponse, movementResponse] =
        await Promise.all([
          api.getItem(itemId),
          api.lots(itemId, activeClientId),
          api.serials(itemId, activeClientId),
          api.itemMovements(itemId, activeClientId),
        ]);
      setItem(itemResponse);
      setLots(lotResponse.lots);
      setSerials(serialResponse.serials);
      setMovements(movementResponse.movements);
    } catch (error) {
      setLoadError(
        error instanceof ApiError ? error.message : 'The item could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, [activeClientId, itemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const itemBalances = useMemo(
    () => balances.filter((balance) => balance.item_id === itemId),
    [balances, itemId],
  );
  const locationMap = useMemo(
    () => new Map(locations.map((location) => [location.id, location])),
    [locations],
  );
  const lotStock = useMemo(() => {
    const stock = new Map<string, { qty: number; locations: Set<string> }>();
    for (const balance of itemBalances) {
      if (!balance.lot_id) {
        continue;
      }
      const current = stock.get(balance.lot_id) ?? {
        qty: 0,
        locations: new Set<string>(),
      };
      current.qty += Number(balance.on_hand) || 0;
      current.locations.add(balance.location_id);
      stock.set(balance.lot_id, current);
    }
    return stock;
  }, [itemBalances]);
  const serialBalance = useMemo(() => {
    const stock = new Map<string, (typeof itemBalances)[number]>();
    for (const balance of itemBalances) {
      if (balance.serial_id) {
        stock.set(balance.serial_id, balance);
      }
    }
    return stock;
  }, [itemBalances]);
  const totals = useMemo(() => {
    return itemBalances.reduce(
      (total, balance) => {
        total.onHand += Number(balance.on_hand) || 0;
        total.reserved += Number(balance.reserved) || 0;
        if (balance.stock_status === 'available') {
          total.available += Number(balance.available) || 0;
          total.blocked += Number(balance.blocked) || 0;
        } else {
          total.blocked += Number(balance.on_hand) || 0;
        }
        total.locations.add(balance.location_id);
        return total;
      },
      {
        onHand: 0,
        available: 0,
        blocked: 0,
        reserved: 0,
        locations: new Set<string>(),
      },
    );
  }, [itemBalances]);

  const startEditing = () => {
    if (!item) {
      return;
    }
    setEditName(item.name);
    setEditBarcode(item.barcode ?? '');
    setEditDescription(item.description ?? '');
    setEditCategory(item.category ?? '');
    setEditReorderPoint(item.reorder_point ?? '');
    setEditCost(item.cost ?? '');
    setEditExpiryTracked(item.expiry_tracked);
    setEditStatus(item.status === 'archived' ? 'archived' : 'active');
    setSaveError(null);
    setFieldErrors({});
    setEditing(true);
  };

  const saveItem = async () => {
    if (!item) {
      return;
    }
    setSaveError(null);
    setFieldErrors({});
    if (!editName.trim()) {
      setSaveError('Enter an item name.');
      setFieldErrors({ name: 'Enter an item name.' });
      return;
    }
    const reorderPoint = editReorderPoint.trim().replace(',', '.');
    const cost = editCost.trim().replace(',', '.');
    for (const [field, value, label] of [
      ['reorder_point', reorderPoint, 'Reorder point'],
      ['cost', cost, 'Unit cost'],
    ] as const) {
      if (value && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
        setSaveError(`${label} must be zero or greater.`);
        setFieldErrors({ [field]: `${label} must be zero or greater.` });
        return;
      }
    }
    const payload: ItemUpdateInput = {
      name: editName.trim(),
      barcode: editBarcode.trim() || null,
      description: editDescription.trim() || null,
      category: editCategory.trim() || null,
      reorder_point: reorderPoint || null,
      status: editStatus,
    };
    if (item.tracking_mode !== 'none') {
      payload.expiry_tracked = editExpiryTracked;
    }
    if (canReadCost) {
      payload.cost = cost || null;
    }
    setSaving(true);
    try {
      const updated = await api.updateItem(item.id, payload);
      setItem(updated);
      setEditing(false);
      onChanged();
    } catch (error) {
      if (error instanceof ApiError) {
        setSaveError(error.message);
        setFieldErrors(error.fieldErrors);
      } else {
        setSaveError('The item could not be updated.');
      }
    } finally {
      setSaving(false);
    }
  };

  const openLocationModal = () => {
    const existingPref = item?.preferred_locations?.[0];
    const defaultWhId = existingPref?.warehouse_id || warehouses[0]?.id || '';
    setSelectedWarehouseId(defaultWhId);
    setSelectedLocationId(existingPref?.location_id || '');
    setLocSearch('');
    setLocSaveError(null);
    setShowLocationModal(true);
  };

  const handleSaveLocation = async () => {
    if (!item) return;
    if (!selectedWarehouseId || !selectedLocationId) {
      setLocSaveError('Please select both a warehouse and destination bin.');
      return;
    }
    const wh = warehouses.find((w) => w.id === selectedWarehouseId);
    const loc = locations.find((l) => l.id === selectedLocationId);
    if (!loc) {
      setLocSaveError('Selected location was not found.');
      return;
    }

    setSavingLocation(true);
    setLocSaveError(null);
    try {
      const newLocEntry = {
        warehouse_id: selectedWarehouseId,
        warehouse_code: wh?.code || wh?.name || null,
        warehouse_name: wh?.name || null,
        location_id: loc.id,
        location_code: loc.code,
        location_path: loc.path || loc.code,
        zone: loc.zone || null,
        aisle: loc.aisle || null,
        rack: loc.rack || null,
        shelf: loc.shelf || null,
        bin: loc.bin || null,
        storage_type: loc.type,
        is_primary: true,
      };

      const currentLocs = item.preferred_locations || [];
      const updatedLocs = currentLocs.filter((l) => l.warehouse_id !== selectedWarehouseId);
      updatedLocs.push(newLocEntry);

      const updated = await api.updateItem(item.id, {
        preferred_locations: updatedLocs,
      });
      setItem(updated);
      setShowLocationModal(false);
      onChanged();
    } catch (err) {
      setLocSaveError(err instanceof ApiError ? err.message : 'Failed to update preferred location.');
    } finally {
      setSavingLocation(false);
    }
  };

  const handleRemoveLocation = async (warehouseId: string) => {
    if (!item) return;
    setSavingLocation(true);
    try {
      const currentLocs = item.preferred_locations || [];
      const updatedLocs = currentLocs.filter((l) => l.warehouse_id !== warehouseId);
      const updated = await api.updateItem(item.id, {
        preferred_locations: updatedLocs,
      });
      setItem(updated);
      setShowLocationModal(false);
      onChanged();
    } catch (err) {
      Alert.alert('Error', err instanceof ApiError ? err.message : 'Failed to remove preferred location.');
    } finally {
      setSavingLocation(false);
    }
  };

  if (loading && !item) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.centeredText}>Loading item…</Text>
      </View>
    );
  }

  if (!item) {
    return (
      <View style={styles.centered}>
        <EmptyState
          icon="package-variant-closed-remove"
          title="Item not available"
          message={loadError ?? 'This item could not be found for the active client.'}
        />
        <Button label="Back to inventory" variant="secondary" onPress={onBack} />
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
          <Text style={styles.greetingTitle} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.greetingSubtitle} numberOfLines={1}>
            {item.sku} • {item.category ?? 'General'}
          </Text>
        </View>
        {canWrite ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={editing ? 'Cancel editing' : 'Edit item'}
            onPress={editing ? () => setEditing(false) : startEditing}
            style={({ pressed }) => [
              styles.editButton,
              editing && styles.editButtonActive,
              pressed && styles.pressed,
            ]}
          >
            <MaterialCommunityIcons
              name={editing ? 'close' : 'pencil-outline'}
              size={19}
              color={editing ? colors.white : '#192338'}
            />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

      <View style={styles.heroCard}>
        <View style={styles.heroIcon}>
          <MaterialCommunityIcons name="package-variant" size={28} color={colors.navy} />
        </View>
        <View style={styles.heroBody}>
          <Text style={styles.heroName}>{item.name}</Text>
          <Text style={styles.heroSku}>{item.sku}</Text>
          <View style={styles.heroBadges}>
            <Badge
              label={item.status}
              tone={item.status === 'active' ? 'success' : 'neutral'}
            />
            <Badge
              label={
                item.tracking_mode === 'none'
                  ? 'No tracking'
                  : `${humanize(item.tracking_mode)} tracked`
              }
              tone={item.tracking_mode === 'none' ? 'neutral' : 'info'}
            />
            {item.expiry_tracked ? <Badge label="Expiry" tone="warning" /> : null}
          </View>
        </View>
      </View>

      {editing ? (
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Edit item</Text>
          <Field
            label="Item name"
            value={editName}
            onChangeText={setEditName}
            error={fieldErrors.name}
            autoCapitalize="words"
          />
          <Field
            label="Barcode"
            value={editBarcode}
            onChangeText={setEditBarcode}
            placeholder="Optional"
            error={fieldErrors.barcode}
          />
          <Field
            label="Category"
            value={editCategory}
            onChangeText={setEditCategory}
            placeholder="Optional"
            error={fieldErrors.category}
          />
          <Field
            label="Description"
            value={editDescription}
            onChangeText={setEditDescription}
            placeholder="Optional notes"
            multiline
            error={fieldErrors.description}
          />
          <View style={styles.formRow}>
            <View style={styles.formHalf}>
              <Field
                label="Reorder point"
                value={editReorderPoint}
                onChangeText={setEditReorderPoint}
                placeholder="0"
                keyboardType="decimal-pad"
                error={fieldErrors.reorder_point}
              />
            </View>
            {canReadCost ? (
              <View style={styles.formHalf}>
                <Field
                  label="Unit cost"
                  value={editCost}
                  onChangeText={setEditCost}
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                  error={fieldErrors.cost}
                />
              </View>
            ) : null}
          </View>
          {item.tracking_mode !== 'none' ? (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: editExpiryTracked }}
              onPress={() => setEditExpiryTracked((current) => !current)}
              style={styles.checkboxRow}
            >
              <MaterialCommunityIcons
                name={editExpiryTracked ? 'checkbox-marked' : 'checkbox-blank-outline'}
                size={23}
                color={editExpiryTracked ? colors.primary : colors.muted}
              />
              <View style={styles.checkboxText}>
                <Text style={styles.checkboxLabel}>Track expiry dates</Text>
                <Text style={styles.checkboxHint}>
                  Requires an expiry date on tracked stock.
                </Text>
              </View>
            </Pressable>
          ) : (
            <Text style={styles.formHint}>
              Tracking mode is fixed after creation. Expiry tracking is available for
              lot and serial tracked items.
            </Text>
          )}
          <SelectField
            label="Status"
            value={editStatus}
            onChange={(value) => setEditStatus(value === 'archived' ? 'archived' : 'active')}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'archived', label: 'Archived' },
            ]}
          />
          {saveError ? (
            <View style={styles.errorBox}>
              <MaterialCommunityIcons
                name="alert-circle-outline"
                size={18}
                color={colors.danger}
              />
              <Text style={styles.errorText}>{saveError}</Text>
            </View>
          ) : null}
          <View style={styles.formActions}>
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => setEditing(false)}
              style={styles.formAction}
            />
            <Button
              label="Save changes"
              onPress={() => void saveItem()}
              loading={saving}
              style={styles.formAction}
            />
          </View>
        </View>
      ) : null}

      <View style={styles.metrics}>
        <View style={[styles.metric, styles.metricPrimary]}>
          <Text style={styles.metricLabelLight}>AVAILABLE</Text>
          <Text style={styles.metricValueLight}>
            {formatQty(String(totals.available))}
          </Text>
          <Text style={styles.metricHintLight}>{item.base_uom}</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>ON HAND</Text>
          <Text style={styles.metricValue}>{formatQty(String(totals.onHand))}</Text>
          <Text style={styles.metricHint}>
            {totals.blocked > 0
              ? `${formatQty(String(totals.blocked))} blocked`
              : 'All available'}
          </Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>LOCATIONS</Text>
          <Text style={styles.metricValue}>{totals.locations.size}</Text>
          <Text style={styles.metricHint}>
            {itemBalances.length} stock {itemBalances.length === 1 ? 'key' : 'keys'}
          </Text>
        </View>
      </View>

      <View style={styles.segment}>
        {(
          [
            ['overview', 'Overview'],
            ['lots', `Lots${lots.length ? ` ${lots.length}` : ''}`],
            ['serials', `Serials${serials.length ? ` ${serials.length}` : ''}`],
            ['ledger', 'Ledger'],
          ] as const
        ).map(([value, label]) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === value }}
            onPress={() => setTab(value)}
            style={[styles.segmentItem, tab === value && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, tab === value && styles.segmentTextActive]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'overview' ? (
        <>
          {/* PREFERRED STORAGE LOCATION */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <MaterialCommunityIcons name="map-marker-star" size={20} color={colors.primary} />
                <Text style={styles.sectionTitle}>Preferred Storage Location</Text>
              </View>
              {canWrite ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={openLocationModal}
                  style={({ pressed }) => [styles.actionButtonSmall, pressed && styles.pressed]}
                >
                  <MaterialCommunityIcons name="pencil-outline" size={14} color={colors.primary} />
                  <Text style={styles.actionButtonSmallText}>
                    {item?.preferred_locations && item.preferred_locations.length > 0 ? 'Edit' : 'Assign'}
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {item?.preferred_locations && item.preferred_locations.length > 0 ? (
              <View style={styles.card}>
                {item.preferred_locations.map((pl, idx) => (
                  <View key={`${pl.warehouse_id}-${pl.location_id}-${idx}`} style={[styles.prefLocCard, idx > 0 && styles.prefLocCardBorder]}>
                    <View style={styles.prefLocHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                        <View style={styles.prefLocIconBox}>
                          <MaterialCommunityIcons name="warehouse" size={18} color={colors.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.prefWarehouseName}>
                            {pl.warehouse_name || pl.warehouse_code || 'Warehouse'}
                          </Text>
                          <Text style={styles.prefLocPath} numberOfLines={1}>
                            Path: {pl.location_path || pl.location_code}
                          </Text>
                        </View>
                      </View>
                      <Badge
                        label={pl.is_primary ? 'PREFERRED' : 'SECONDARY'}
                        tone={pl.is_primary ? 'info' : 'neutral'}
                      />
                    </View>

                    <View style={styles.prefGrid}>
                      <View style={styles.prefGridItem}>
                        <Text style={styles.prefGridLabel}>ZONE</Text>
                        <Text style={styles.prefGridValue}>{pl.zone || '-'}</Text>
                      </View>
                      <View style={styles.prefGridItem}>
                        <Text style={styles.prefGridLabel}>AISLE</Text>
                        <Text style={styles.prefGridValue}>{pl.aisle || '-'}</Text>
                      </View>
                      <View style={styles.prefGridItem}>
                        <Text style={styles.prefGridLabel}>RACK</Text>
                        <Text style={styles.prefGridValue}>{pl.rack || '-'}</Text>
                      </View>
                      <View style={styles.prefGridItem}>
                        <Text style={styles.prefGridLabel}>SHELF</Text>
                        <Text style={styles.prefGridValue}>{pl.shelf || '-'}</Text>
                      </View>
                      <View style={styles.prefGridItem}>
                        <Text style={styles.prefGridLabel}>BIN</Text>
                        <Text style={[styles.prefGridValue, { color: colors.primary, fontFamily: fonts.headingSemi }]}>
                          {pl.bin || pl.location_code}
                        </Text>
                      </View>
                      <View style={styles.prefGridItem}>
                        <Text style={styles.prefGridLabel}>TYPE</Text>
                        <Text style={styles.prefGridValue}>{humanize(pl.storage_type || 'Bin')}</Text>
                      </View>
                    </View>

                    {canWrite ? (
                      <View style={styles.prefLocActions}>
                        <Pressable
                          onPress={() => void handleRemoveLocation(pl.warehouse_id)}
                          style={({ pressed }) => [styles.prefRemoveButton, pressed && styles.pressed]}
                        >
                          <MaterialCommunityIcons name="trash-can-outline" size={14} color={colors.danger} />
                          <Text style={styles.prefRemoveText}>Remove</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.emptyPrefCard}>
                <MaterialCommunityIcons name="map-marker-question-outline" size={32} color={colors.muted} />
                <Text style={styles.emptyPrefTitle}>No Preferred Location Configured</Text>
                <Text style={styles.emptyPrefSubtitle}>
                  Link a dedicated bin to direct warehouse staff automatically during receiving and putaway.
                </Text>
                {canWrite ? (
                  <Button
                    label="Assign Preferred Location"
                    variant="primary"
                    onPress={openLocationModal}
                    style={{ marginTop: spacing.xs }}
                  />
                ) : null}
              </View>
            )}
          </View>

          {/* STOCK BY LOCATION */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Stock by location</Text>
              <Text style={styles.sectionCount}>{itemBalances.length}</Text>
            </View>
          {itemBalances.length === 0 ? (
            <EmptyState
              icon="map-marker-off-outline"
              title="No stock on hand"
              message="This item has no location balances yet."
            />
          ) : (
            <View style={styles.card}>
              {itemBalances.map((balance, index) => {
                const location = locationMap.get(balance.location_id);
                return (
                  <View
                    key={balance.id}
                    style={[
                      styles.balanceRow,
                      index < itemBalances.length - 1 && styles.rowBorder,
                    ]}
                  >
                    <View style={styles.balanceLocation}>
                      <View style={styles.locationIcon}>
                        <MaterialCommunityIcons
                          name="map-marker-outline"
                          size={17}
                          color={colors.deep}
                        />
                      </View>
                      <View style={styles.balanceLocationText}>
                        <Text style={styles.balanceLocationCode}>
                          {location?.code ?? 'Location'}
                        </Text>
                        <Text style={styles.balanceLocationMeta} numberOfLines={1}>
                          {balance.lot_no
                            ? `Lot ${balance.lot_no}`
                            : balance.serial_no
                              ? `Serial ${balance.serial_no}`
                              : humanize(location?.type ?? 'stock')}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.balanceQty}>
                      <Text style={styles.balanceOnHand}>
                        {formatQty(balance.on_hand)}
                      </Text>
                      <Text style={styles.balanceAvailable}>
                        {formatQty(balance.available)} available
                      </Text>
                    </View>
                    <Badge
                      label={humanize(balance.stock_status)}
                      tone={balance.stock_status === 'available' ? 'success' : 'warning'}
                    />
                  </View>
                );
              })}
            </View>
          )}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Item information</Text>
            </View>
            <View style={styles.card}>
              <InfoRow label="SKU" value={item.sku} />
              <InfoRow label="Barcode" value={item.barcode ?? '—'} />
              <InfoRow label="Category" value={item.category ?? '—'} />
              <InfoRow label="Item type" value={humanize(item.item_type)} />
              <InfoRow label="Base unit" value={item.base_uom} />
              <InfoRow label="Tracking" value={humanize(item.tracking_mode)} />
              <InfoRow
                label="Expiry"
                value={item.expiry_tracked ? 'Tracked' : 'Not tracked'}
              />
              <InfoRow
                label="Reorder point"
                value={
                  item.reorder_point !== null
                    ? `${formatQty(item.reorder_point)} ${item.base_uom}`
                    : 'Not set'
                }
              />
              {canReadCost ? (
                <InfoRow
                  label="Unit cost"
                  value={item.cost !== null ? formatQty(item.cost) : 'Not set'}
                />
              ) : null}
              <InfoRow label="Description" value={item.description ?? '—'} last />
            </View>

            <SupplierLinkSection
              itemId={item.id}
              onOpenSupplier={onOpenSupplier}
              onChanged={onChanged}
            />
          </View>
        </>
      ) : null}

      {tab === 'lots' ? (
        <View style={styles.section}>
          {lots.length === 0 ? (
            <EmptyState
              icon="tag-outline"
              title={
                item.tracking_mode === 'lot' ? 'No lots recorded' : 'Lot tracking is off'
              }
              message={
                item.tracking_mode === 'lot'
                  ? 'Lots will appear here when tracked stock is received.'
                  : 'This item is not configured for lot tracking.'
              }
            />
          ) : (
            lots.map((lot) => {
              const stock = lotStock.get(lot.id);
              const expired =
                lot.expiry_date !== null && isExpiredDate(lot.expiry_date);
              return (
                <View key={lot.id} style={styles.traceCard}>
                  <View style={styles.traceHeader}>
                    <View style={styles.traceTitleWrap}>
                      <Text style={styles.traceTitle}>{lot.lot_no}</Text>
                      <Text style={styles.traceMeta}>
                        {stock
                          ? `${formatQty(String(stock.qty))} ${item.base_uom} · ${stock.locations.size} ${
                              stock.locations.size === 1 ? 'location' : 'locations'
                            }`
                          : 'No stock on hand'}
                      </Text>
                    </View>
                    <Badge
                      label={humanize(lot.status)}
                      tone={lot.status === 'active' ? 'success' : 'neutral'}
                    />
                  </View>
                  <View style={styles.traceFooter}>
                    <View style={styles.traceFact}>
                      <MaterialCommunityIcons
                        name="calendar-outline"
                        size={15}
                        color={expired ? colors.danger : colors.muted}
                      />
                      <Text
                        style={[
                          styles.traceFactText,
                          expired && styles.traceFactDanger,
                        ]}
                      >
                        {lot.expiry_date
                          ? `${expired ? 'Expired' : 'Expires'} ${formatDate(lot.expiry_date)}`
                          : 'No expiry date'}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </View>
      ) : null}

      {tab === 'serials' ? (
        <View style={styles.section}>
          {serials.length === 0 ? (
            <EmptyState
              icon="barcode-scan"
              title={
                item.tracking_mode === 'serial'
                  ? 'No serials recorded'
                  : 'Serial tracking is off'
              }
              message={
                item.tracking_mode === 'serial'
                  ? 'Serial numbers will appear here when tracked stock is received.'
                  : 'This item is not configured for serial tracking.'
              }
            />
          ) : (
            serials.map((serial) => {
              const balance = serialBalance.get(serial.id);
              const location = balance ? locationMap.get(balance.location_id) : null;
              return (
                <View key={serial.id} style={styles.traceCard}>
                  <View style={styles.traceHeader}>
                    <View style={styles.traceTitleWrap}>
                      <Text style={styles.traceTitle}>{serial.serial_no}</Text>
                      <Text style={styles.traceMeta}>
                        {location?.code ?? 'Not in stock'}
                        {serial.lot_no ? ` · Lot ${serial.lot_no}` : ''}
                      </Text>
                    </View>
                    <Badge
                      label={humanize(serial.status)}
                      tone={serial.status === 'active' ? 'success' : 'neutral'}
                    />
                  </View>
                  <View style={styles.traceFooter}>
                    <View style={styles.traceFact}>
                      <MaterialCommunityIcons
                        name="package-variant-closed"
                        size={15}
                        color={colors.muted}
                      />
                      <Text style={styles.traceFactText}>
                        {balance
                          ? `${formatQty(balance.on_hand)} ${item.base_uom} on hand`
                          : 'No active balance'}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </View>
      ) : null}

      {tab === 'ledger' ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Movement ledger</Text>
            <Text style={styles.sectionCount}>{movements.length}</Text>
          </View>
          {movements.length === 0 ? (
            <EmptyState
              icon="history"
              title="No movements yet"
              message="Receipts, put-aways and adjustments for this item appear here."
            />
          ) : (
            movements.map((movement) => {
              const positive = Number(movement.quantity_delta) >= 0;
              const from = movement.from_location_id
                ? locationMap.get(movement.from_location_id)?.code
                : null;
              const to = movement.to_location_id
                ? locationMap.get(movement.to_location_id)?.code
                : null;
              return (
                <View key={movement.id} style={styles.movementCard}>
                  <View style={styles.movementHeader}>
                    <View
                      style={[
                        styles.movementIcon,
                        positive ? styles.movementIconIn : styles.movementIconOut,
                      ]}
                    >
                      <MaterialCommunityIcons
                        name={positive ? 'arrow-down' : 'arrow-up'}
                        size={19}
                        color={positive ? colors.success : colors.danger}
                      />
                    </View>
                    <View style={styles.movementTitleWrap}>
                      <Text style={styles.movementTitle}>{humanize(movement.type)}</Text>
                      <Text style={styles.movementMeta}>
                        {movement.source_number} · {formatDateTime(movement.recorded_at)}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.movementQty,
                        { color: positive ? colors.success : colors.danger },
                      ]}
                    >
                      {positive ? '+' : ''}
                      {formatQty(movement.quantity_delta)} {movement.uom}
                    </Text>
                  </View>
                  <View style={styles.movementFacts}>
                    <MovementFact
                      icon="map-marker-path"
                      text={
                        from || to
                          ? `${from ?? 'External'} → ${to ?? 'External'}`
                          : 'No location change'
                      }
                    />
                    {movement.lot_no || movement.serial_no ? (
                      <MovementFact
                        icon="tag-outline"
                        text={
                          movement.serial_no
                            ? `Serial ${movement.serial_no}`
                            : `Lot ${movement.lot_no}`
                        }
                      />
                    ) : null}
                    <MovementFact
                      icon="shield-check-outline"
                      text={humanize(movement.stock_status)}
                    />
                    {movement.reason ? (
                      <MovementFact icon="note-text-outline" text={movement.reason} />
                    ) : null}
                  </View>
                </View>
              );
            })
          )}
        </View>
      ) : null}

      {loadError ? (
        <View style={styles.errorBox}>
          <MaterialCommunityIcons name="cloud-alert-outline" size={18} color={colors.danger} />
          <Text style={styles.errorText}>{loadError}</Text>
          <Pressable onPress={() => void load()} accessibilityLabel="Retry loading">
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      </ScrollView>

      {/* PREFERRED LOCATION ASSIGNMENT MODAL */}
      <Modal
        visible={showLocationModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowLocationModal(false)}
      >
        <View style={styles.modalScreen}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalEyebrow}>STORAGE LOCATION</Text>
              <Text style={styles.modalTitle}>Assign Preferred Bin</Text>
            </View>
            <Pressable
              onPress={() => setShowLocationModal(false)}
              style={styles.modalCloseButton}
            >
              <MaterialCommunityIcons name="close" size={24} color={colors.navy} />
            </Pressable>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
            {locSaveError ? (
              <View style={styles.modalErrorBox}>
                <Text style={styles.modalErrorText}>{locSaveError}</Text>
              </View>
            ) : null}

            {/* Warehouse Selector */}
            <View style={styles.modalSection}>
              <Text style={styles.modalSectionLabel}>1. Select Warehouse</Text>
              <View style={styles.whPillsRow}>
                {warehouses.map((wh) => {
                  const isSelected = selectedWarehouseId === wh.id;
                  return (
                    <Pressable
                      key={wh.id}
                      onPress={() => {
                        setSelectedWarehouseId(wh.id);
                        setSelectedLocationId('');
                      }}
                      style={[styles.whPill, isSelected && styles.whPillActive]}
                    >
                      <MaterialCommunityIcons
                        name="warehouse"
                        size={16}
                        color={isSelected ? colors.white : colors.navy}
                      />
                      <Text style={[styles.whPillText, isSelected && styles.whPillTextActive]}>
                        {wh.name} {wh.code ? `(${wh.code})` : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Location / Bin Search & Selector */}
            <View style={styles.modalSection}>
              <Text style={styles.modalSectionLabel}>2. Select Destination Bin</Text>
              <View style={styles.modalSearchBox}>
                <MaterialCommunityIcons name="magnify" size={18} color={colors.muted} />
                <TextInput
                  value={locSearch}
                  onChangeText={setLocSearch}
                  placeholder="Search bin, rack, or aisle..."
                  placeholderTextColor={colors.muted}
                  style={styles.modalSearchInput}
                />
                {locSearch ? (
                  <Pressable onPress={() => setLocSearch('')}>
                    <MaterialCommunityIcons name="close-circle" size={16} color={colors.muted} />
                  </Pressable>
                ) : null}
              </View>

              <View style={styles.modalLocList}>
                {locations
                  .filter((l) => (!selectedWarehouseId || l.warehouse_id === selectedWarehouseId) && l.status !== 'archived')
                  .filter((l) => {
                    if (!locSearch) return true;
                    const q = locSearch.toLowerCase();
                    return (
                      l.code.toLowerCase().includes(q) ||
                      (l.path && l.path.toLowerCase().includes(q)) ||
                      (l.bin && l.bin.toLowerCase().includes(q)) ||
                      (l.rack && l.rack.toLowerCase().includes(q))
                    );
                  })
                  .slice(0, 50)
                  .map((loc) => {
                    const isSelected = selectedLocationId === loc.id;
                    return (
                      <Pressable
                        key={loc.id}
                        onPress={() => setSelectedLocationId(loc.id)}
                        style={[styles.modalLocItem, isSelected && styles.modalLocItemActive]}
                      >
                        <View style={{ flex: 1, gap: 2 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={[styles.modalLocCode, isSelected && styles.modalLocCodeActive]}>
                              {loc.code}
                            </Text>
                            <Badge label={loc.type.toUpperCase()} tone={isSelected ? 'info' : 'neutral'} />
                          </View>
                          <Text style={styles.modalLocMeta}>
                            Zone: {loc.zone || '-'} · Aisle: {loc.aisle || '-'} · Rack: {loc.rack || '-'} · Shelf: {loc.shelf || '-'} · Bin: {loc.bin || '-'}
                          </Text>
                        </View>
                        {isSelected ? (
                          <MaterialCommunityIcons name="check-circle" size={20} color={colors.primary} />
                        ) : null}
                      </Pressable>
                    );
                  })}
              </View>
            </View>

            <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
              <Button
                label="Save Preferred Location"
                variant="primary"
                loading={savingLocation}
                disabled={!selectedLocationId || savingLocation}
                onPress={() => void handleSaveLocation()}
              />
              <Button
                label="Cancel"
                variant="secondary"
                onPress={() => setShowLocationModal(false)}
              />
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function InfoRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.infoRow, !last && styles.rowBorder]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function MovementFact({
  icon,
  text,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  text: string;
}) {
  return (
    <View style={styles.movementFact}>
      <MaterialCommunityIcons name={icon} size={13} color={colors.muted} />
      <Text style={styles.movementFactText}>{text}</Text>
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
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surface,
  },
  centeredText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  topBarText: {
    flex: 1,
  },
  eyebrow: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    letterSpacing: 1.6,
    color: colors.deep,
  },
  topBarTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 20,
    color: colors.navy,
  },
  editButton: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 1,
    borderColor: palette.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
    ...neo.soft,
  },
  editButtonActive: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  pressed: {
    opacity: 0.8,
  },
  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: palette.ink,
    borderRadius: radius.xxl,
    padding: spacing.lg,
    borderWidth: 1.2,
    borderColor: 'rgba(255,255,255,0.16)',
    ...neo.raised,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: palette.gold,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1.4,
    borderTopColor: 'rgba(255,255,255,0.6)',
  },
  heroBody: {
    flex: 1,
    gap: 2,
  },
  heroName: {
    fontFamily: fonts.outfitBold,
    fontSize: 21,
    color: colors.white,
  },
  heroSku: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 11,
    color: 'rgba(255,255,255,0.58)',
    letterSpacing: 0.6,
  },
  heroBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  formCard: {
    backgroundColor: palette.glass,
    borderRadius: radius.xl,
    borderWidth: 1.1,
    borderColor: palette.glassBorder,
    padding: spacing.lg,
    gap: spacing.md,
    ...neo.raised,
  },
  formTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 18,
    color: colors.navy,
  },
  formRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  formHalf: {
    flex: 1,
  },
  formHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 17,
    color: colors.muted,
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
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
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
  retryText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.danger,
  },
  metrics: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metric: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    minHeight: 94,
    justifyContent: 'space-between',
  },
  metricPrimary: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  metricLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    letterSpacing: 0.8,
    color: colors.muted,
  },
  metricLabelLight: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    letterSpacing: 0.8,
    color: '#AFC4E3',
  },
  metricValue: {
    fontFamily: fonts.heading,
    fontSize: 23,
    color: colors.navy,
  },
  metricValueLight: {
    fontFamily: fonts.heading,
    fontSize: 23,
    color: colors.white,
  },
  metricHint: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  metricHintLight: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: '#C7D5EB',
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: '#E5EDF5',
    borderRadius: radius.md,
    padding: 4,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: radius.sm,
  },
  segmentActive: {
    backgroundColor: colors.white,
  },
  segmentText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.muted,
  },
  segmentTextActive: {
    color: colors.navy,
  },
  section: {
    gap: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    backgroundColor: '#E5EDF5',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  card: {
    backgroundColor: palette.glass,
    borderRadius: radius.xl,
    borderWidth: 1.1,
    borderColor: palette.glassBorder,
    paddingHorizontal: spacing.md,
    ...neo.soft,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  balanceLocation: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  locationIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#EAF3FA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceLocationText: {
    flex: 1,
    gap: 1,
  },
  balanceLocationCode: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
  },
  balanceLocationMeta: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  balanceQty: {
    alignItems: 'flex-end',
  },
  balanceOnHand: {
    fontFamily: fonts.headingSemi,
    fontSize: 15,
    color: colors.navy,
  },
  balanceAvailable: {
    fontFamily: fonts.body,
    fontSize: 9,
    color: colors.muted,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  infoLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.muted,
  },
  infoValue: {
    flex: 1,
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
    textAlign: 'right',
  },
  traceCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  traceHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  traceTitleWrap: {
    flex: 1,
    gap: 2,
  },
  traceTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 16,
    color: colors.navy,
  },
  traceMeta: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  traceFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  traceFact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  traceFactText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  traceFactDanger: {
    color: colors.danger,
  },
  movementCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  movementHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  movementIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  movementIconIn: {
    backgroundColor: colors.successSoft,
  },
  movementIconOut: {
    backgroundColor: colors.dangerSoft,
  },
  movementTitleWrap: {
    flex: 1,
    gap: 1,
  },
  movementTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
  },
  movementMeta: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  movementQty: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
  },
  movementFacts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  movementFact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  movementFactText: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  actionButtonSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EAF0F8',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  actionButtonSmallText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.primary,
  },
  prefLocCard: {
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  prefLocCardBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  prefLocHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  prefLocIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#E8F0FE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  prefWarehouseName: {
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.navy,
  },
  prefLocPath: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  prefGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    borderRadius: radius.md,
    marginTop: 2,
  },
  prefGridItem: {
    minWidth: '28%',
    flex: 1,
    gap: 1,
  },
  prefGridLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    letterSpacing: 0.8,
    color: colors.muted,
  },
  prefGridValue: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  prefLocActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  prefRemoveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  prefRemoveText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.danger,
  },
  emptyPrefCard: {
    backgroundColor: palette.glass,
    borderRadius: radius.xl,
    borderWidth: 1.1,
    borderColor: palette.glassBorder,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
    ...neo.soft,
  },
  emptyPrefTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 15,
    color: colors.navy,
    marginTop: 4,
  },
  emptyPrefSubtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 280,
  },
  modalScreen: {
    flex: 1,
    backgroundColor: palette.canvas,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.white,
  },
  modalEyebrow: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.primary,
  },
  modalTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 18,
    color: colors.navy,
  },
  modalCloseButton: {
    padding: 6,
  },
  modalErrorBox: {
    backgroundColor: colors.dangerSoft,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  modalErrorText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.danger,
  },
  modalSection: {
    gap: spacing.xs,
  },
  modalSectionLabel: {
    fontFamily: fonts.headingSemi,
    fontSize: 13,
    color: colors.navy,
  },
  whPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: 4,
  },
  whPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  whPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  whPillText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  whPillTextActive: {
    color: colors.white,
  },
  modalSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    marginTop: 4,
  },
  modalSearchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.navy,
    padding: 0,
  },
  modalLocList: {
    maxHeight: 280,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginTop: 6,
  },
  modalLocItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalLocItemActive: {
    backgroundColor: '#EDF5FF',
  },
  modalLocCode: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
  },
  modalLocCodeActive: {
    color: colors.primary,
  },
  modalLocMeta: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
});
