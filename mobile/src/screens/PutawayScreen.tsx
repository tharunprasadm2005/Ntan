import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  RefreshControl,
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
import { PageHeader } from '../components/ui';
import { SelectField } from '../components/SelectField';
import { useWorkspace } from '../data';
import { formatDate, formatDateTime, formatQty, humanize } from '../format';
import {
  PUTAWAY_SOURCE_TYPES,
  buildCoordinateLocationCode,
  filterDestinationsByHierarchy,
  filterPutawayDestinations,
  findDestinationByCoordinates,
  findDestinationByScannedCode,
  formatLocationCoordinates,
  newPutawayRequestKey,
  parsePutawayQuantity,
  putawayProgress,
  suggestPutawayBinsForItem,
} from '../putaway';
import { colors, fonts, neo, palette, radius, shadow, spacing } from '../theme';
import type { Location, PutawayTask } from '../types';

interface PutawayScreenProps {
  onBack: () => void;
  receiptId?: string | null;
  onOpenItem?: (itemId: string) => void;
  onOpenReceipt?: (receiptId: string) => void;
  onOpenLocations?: () => void;
}

interface AttemptKey {
  key: string;
  signature: string;
}

export function PutawayScreen({
  onBack,
  receiptId,
  onOpenItem,
  onOpenReceipt,
  onOpenLocations,
}: PutawayScreenProps) {
  const insets = useSafeAreaInsets();
  const { state } = useAuth();
  const {
    locations,
    warehouses,
    receipts,
    balances,
    inventoryOwners,
    isMultiOwner,
    activeClientId,
    refresh: refreshWorkspace,
  } = useWorkspace();
  const canPutaway =
    state.status === 'signedIn' && state.session.permissions.includes('stock.putaway');
  const [activeReceiptFilter, setActiveReceiptFilter] = useState<string | null>(
    receiptId ?? null,
  );
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<string | null>(activeClientId);
  const [pending, setPending] = useState<PutawayTask[]>([]);
  const [pendingCursor, setPendingCursor] = useState<string | null>(null);
  const [completed, setCompleted] = useState<PutawayTask[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [destinationId, setDestinationId] = useState<string | null>(null);
  const [quantityInput, setQuantityInput] = useState('');
  const [attempt, setAttempt] = useState<AttemptKey | null>(null);

  // Aisle / Rack / Shelf / Bin manual coordinate inputs
  const [inputAisle, setInputAisle] = useState('');
  const [inputRack, setInputRack] = useState('');
  const [inputShelf, setInputShelf] = useState('');
  const [inputBin, setInputBin] = useState('');
  const [creatingLocation, setCreatingLocation] = useState(false);
  const [coordCreationError, setCoordCreationError] = useState<string | null>(null);

  // Destination Bin Barcode Scanner Modal State
  const [binScannerVisible, setBinScannerVisible] = useState(false);
  const [binScannerMessage, setBinScannerMessage] = useState<string | null>(null);
  const [binScannerError, setBinScannerError] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const scanThrottle = useRef(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorRetryable, setErrorRetryable] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const loadSequence = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setOwnerFilter(activeClientId);
  }, [activeClientId]);

  useEffect(() => {
    setSourceFilter(null);
  }, [warehouseFilter]);

  const queryOptions = useMemo(
    () => ({
      clientId: ownerFilter,
      receiptId: activeReceiptFilter ?? undefined,
      warehouseId: warehouseFilter,
      fromLocationId: sourceFilter,
      search: debouncedSearch || undefined,
    }),
    [ownerFilter, activeReceiptFilter, warehouseFilter, sourceFilter, debouncedSearch],
  );

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setError(null);
    setErrorRetryable(false);
    try {
      const [pendingResponse, completedResponse] = await Promise.all([
        api.putawayTasks({
          ...queryOptions,
          status: 'pending',
          limit: 50,
        }),
        api.putawayTasks({
          ...queryOptions,
          status: 'completed',
          limit: 8,
        }),
      ]);
      if (sequence !== loadSequence.current) {
        return;
      }
      setPending(pendingResponse.tasks);
      setPendingCursor(pendingResponse.next_cursor);
      setCompleted(completedResponse.tasks.slice(0, 8));
      setSelectedId((current) =>
        current && pendingResponse.tasks.some((task) => task.id === current)
          ? current
          : null,
      );
    } catch (caught) {
      if (sequence !== loadSequence.current) {
        return;
      }
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'The put-away queue could not be loaded.',
      );
      setErrorRetryable(!(caught instanceof ApiError) || caught.status !== 403);
    }
  }, [queryOptions]);

  useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load]);

  // Opening the screen for a different receipt should retarget the filter.
  useEffect(() => {
    setActiveReceiptFilter(receiptId ?? null);
  }, [receiptId]);

  const loadMore = async () => {
    if (!pendingCursor || loadingMore) {
      return;
    }
    setLoadingMore(true);
    setError(null);
    setErrorRetryable(false);
    try {
      const response = await api.putawayTasks({
        ...queryOptions,
        status: 'pending',
        limit: 50,
        cursor: pendingCursor,
      });
      setPending((current) => {
        const seen = new Set(current.map((task) => task.id));
        return [...current, ...response.tasks.filter((task) => !seen.has(task.id))];
      });
      setPendingCursor(response.next_cursor);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'More put-away tasks could not be loaded.',
      );
      setErrorRetryable(!(caught instanceof ApiError) || caught.status !== 403);
    } finally {
      setLoadingMore(false);
    }
  };

  const selectedTask = pending.find((task) => task.id === selectedId) ?? null;
  const selectedProgress = selectedTask ? putawayProgress(selectedTask) : null;
  const filterReceiptNumber =
    receipts.find((receipt) => receipt.id === activeReceiptFilter)?.number ??
    pending.find((task) => task.receipt_id === activeReceiptFilter)?.receipt_number ??
    completed.find((task) => task.receipt_id === activeReceiptFilter)?.receipt_number ??
    null;
  const destinationOptions = useMemo(() => {
    if (!selectedTask) {
      return [];
    }
    return filterPutawayDestinations(locations, {
      warehouseId: selectedTask.warehouse_id,
      fromLocationId: selectedTask.from_location_id,
    });
  }, [locations, selectedTask]);

  const suggestedBins = useMemo(() => {
    if (!selectedTask) return [];
    const baseSuggestions = suggestPutawayBinsForItem(selectedTask.item_id, balances, destinationOptions);
    if (selectedTask.suggested_location_id) {
      const prefLoc = destinationOptions.find((d) => d.id === selectedTask.suggested_location_id);
      if (prefLoc) {
        return [prefLoc, ...baseSuggestions.filter((d) => d.id !== prefLoc.id)];
      }
    }
    return baseSuggestions;
  }, [selectedTask, balances, destinationOptions]);

  const hasTypedCoords = Boolean(
    inputAisle.trim() || inputRack.trim() || inputShelf.trim() || inputBin.trim(),
  );

  const suggestedBinCode = useMemo(() => {
    return (
      buildCoordinateLocationCode({
        aisle: inputAisle,
        rack: inputRack,
        shelf: inputShelf,
        bin: inputBin,
      }) || 'BIN-NEW'
    );
  }, [inputAisle, inputRack, inputShelf, inputBin]);

  // Check if current manual coordinates match an existing active bin in this warehouse
  const matchedLocationByCoords = useMemo(() => {
    if (!hasTypedCoords) return null;
    return findDestinationByCoordinates(destinationOptions, {
      aisle: inputAisle,
      rack: inputRack,
      shelf: inputShelf,
      bin: inputBin,
    });
  }, [destinationOptions, hasTypedCoords, inputAisle, inputRack, inputShelf, inputBin]);

  // Filtered destination bins based on coordinates drill-down
  const filteredDestinationOptions = useMemo(() => {
    if (!hasTypedCoords) return destinationOptions;
    return filterDestinationsByHierarchy(destinationOptions, {
      aisle: inputAisle,
      rack: inputRack,
      shelf: inputShelf,
      bin: inputBin,
    });
  }, [destinationOptions, hasTypedCoords, inputAisle, inputRack, inputShelf, inputBin]);

  const selectedDestination =
    destinationOptions.find((location) => location.id === destinationId) ?? null;
  const selectedWarehouse =
    warehouses.find((warehouse) => warehouse.id === selectedTask?.warehouse_id) ?? null;
  const serialTask = Boolean(selectedTask?.serial_id);
  const quantityValidation = selectedTask
    ? parsePutawayQuantity(
        serialTask ? '1' : quantityInput,
        selectedTask.remaining_qty,
      )
    : { quantity: null, error: null };
  const sourceLocationOptions = useMemo(
    () =>
      locations.filter(
        (location) =>
          PUTAWAY_SOURCE_TYPES.has(location.type) &&
          (!warehouseFilter || location.warehouse_id === warehouseFilter),
      ),
    [locations, warehouseFilter],
  );
  const hasFilters =
    Boolean(activeReceiptFilter) ||
    Boolean(search.trim()) ||
    Boolean(warehouseFilter) ||
    Boolean(sourceFilter) ||
    Boolean(isMultiOwner && ownerFilter);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([load(), refreshWorkspace()]);
    setRefreshing(false);
  };

  const handleCoordinateChange = (
    field: 'aisle' | 'rack' | 'shelf' | 'bin',
    val: string,
  ) => {
    const clean = val.toUpperCase();
    const nextCoords = {
      aisle: field === 'aisle' ? clean : inputAisle,
      rack: field === 'rack' ? clean : inputRack,
      shelf: field === 'shelf' ? clean : inputShelf,
      bin: field === 'bin' ? clean : inputBin,
    };

    if (field === 'aisle') setInputAisle(clean);
    if (field === 'rack') setInputRack(clean);
    if (field === 'shelf') setInputShelf(clean);
    if (field === 'bin') setInputBin(clean);

    setCoordCreationError(null);

    const matched = findDestinationByCoordinates(destinationOptions, nextCoords);
    if (matched) {
      setDestinationId(matched.id);
    } else {
      setDestinationId(null);
    }
  };

  const handleSelectDestination = (id: string | null) => {
    setDestinationId(id);
    if (id) {
      const loc = destinationOptions.find((l) => l.id === id);
      if (loc) {
        setInputAisle(loc.aisle ?? '');
        setInputRack(loc.rack ?? '');
        setInputShelf(loc.shelf ?? '');
        setInputBin(loc.bin ?? '');
      }
    }
  };

  const handleCreateCustomBin = async () => {
    if (!selectedTask) return;
    const code =
      buildCoordinateLocationCode({
        aisle: inputAisle,
        rack: inputRack,
        shelf: inputShelf,
        bin: inputBin,
      }) || `BIN-${Date.now().toString().slice(-4)}`;

    setCreatingLocation(true);
    setCoordCreationError(null);
    try {
      const newLoc = await api.createLocation({
        warehouse_id: selectedTask.warehouse_id,
        code,
        type: 'bin',
        aisle: inputAisle.trim() || undefined,
        rack: inputRack.trim() || undefined,
        shelf: inputShelf.trim() || undefined,
        bin: inputBin.trim() || undefined,
        is_pickable: true,
      });
      await refreshWorkspace();
      setDestinationId(newLoc.id);
      setNotice(`Created storage bin ${newLoc.code} and selected it for put-away.`);
    } catch (err) {
      setCoordCreationError(
        err instanceof ApiError ? err.message : 'Could not create bin location.',
      );
    } finally {
      setCreatingLocation(false);
    }
  };

  const chooseTask = (task: PutawayTask) => {
    setSelectedId(task.id);
    setDestinationId(null);
    setInputAisle('');
    setInputRack('');
    setInputShelf('');
    setInputBin('');
    setCoordCreationError(null);
    setQuantityInput(putawayProgress(task).remainingQty);
    setAttempt(null);
    setError(null);
    setErrorRetryable(false);
    setNotice(null);
  };

  const closeTask = () => {
    setSelectedId(null);
    setDestinationId(null);
    setInputAisle('');
    setInputRack('');
    setInputShelf('');
    setInputBin('');
    setCoordCreationError(null);
    setQuantityInput('');
    setAttempt(null);
  };

  const handleDestinationBarcodeScanned = (scanResult: BarcodeScanningResult) => {
    if (scanThrottle.current) return;
    scanThrottle.current = true;
    setTimeout(() => {
      scanThrottle.current = false;
    }, 1200);

    const scannedData = scanResult.data.trim();
    if (!scannedData) return;

    setBinScannerError(null);
    const matched = findDestinationByScannedCode(destinationOptions, scannedData);

    if (matched) {
      setDestinationId(matched.id);
      setInputAisle(matched.aisle ?? '');
      setInputRack(matched.rack ?? '');
      setInputShelf(matched.shelf ?? '');
      setInputBin(matched.bin ?? '');
      setBinScannerMessage(`Selected bin: ${matched.path || matched.code}`);
      setTimeout(() => {
        setBinScannerVisible(false);
        setBinScannerMessage(null);
      }, 700);
    } else {
      setBinScannerError(`"${scannedData}" is not a valid destination bin in this warehouse.`);
    }
  };

  const complete = async () => {
    if (!canPutaway) {
      setError('Your role cannot complete put-away tasks.');
      return;
    }
    if (!selectedTask || !destinationId) {
      setError('Select a destination location.');
      return;
    }
    const validation = parsePutawayQuantity(
      serialTask ? '1' : quantityInput,
      selectedTask.remaining_qty,
    );
    if (validation.error || !validation.quantity) {
      setError(validation.error ?? 'Enter a valid quantity.');
      return;
    }
    const serialIds =
      serialTask && selectedTask.serial_id ? [selectedTask.serial_id] : [];
    const signature = `${selectedTask.id}|${destinationId}|${validation.quantity}|${serialIds.join(
      ',',
    )}`;
    const idempotencyKey =
      attempt?.signature === signature
        ? attempt.key
        : newPutawayRequestKey(selectedTask.id);
    setAttempt({ key: idempotencyKey, signature });
    setSaving(true);
    setError(null);
    setErrorRetryable(false);
    try {
      const updated = await api.completePutaway(selectedTask.id, destinationId, {
        quantity: validation.quantity,
        serialIds: serialIds.length ? serialIds : undefined,
        idempotencyKey,
      });
      setAttempt(null);
      const progress = putawayProgress(updated);
      if (progress.isComplete) {
        setNotice(
          `${formatQty(updated.base_qty)} ${updated.base_uom} of ${updated.item_name} put away to ${
            updated.to_location_code ?? selectedDestination?.code ?? 'the final bin'
          }. The stock is now available from its final location.`,
        );
        closeTask();
      } else {
        setNotice(
          `${formatQty(validation.quantity)} ${updated.base_uom} of ${
            updated.item_name
          } moved to ${
            updated.placements[updated.placements.length - 1]?.location_code ??
            selectedDestination?.code ??
            'the destination bin'
          }. ${formatQty(progress.remainingQty)} ${updated.base_uom} still staged.`,
        );
        setDestinationId(null);
        setQuantityInput(progress.remainingQty);
      }
      await Promise.all([load(), refreshWorkspace()]);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'The put-away task could not be completed.',
      );
      setErrorRetryable(caught instanceof ApiError ? caught.retryable : true);
    } finally {
      setSaving(false);
    }
  };

  const pendingSuffix = pendingCursor ? '+' : '';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: Math.max(insets.top + 12, 22),
          paddingBottom: 16,
        },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          tintColor="#192338"
          colors={['#192338']}
        />
      }
    >
      {/* Top Header: Pure Hexagon Logo + Back Button + Title + Actions */}
      <View style={styles.topHeader}>
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
            <Text style={styles.greetingTitle}>Put-away</Text>
            <Text style={styles.greetingSubtitle} numberOfLines={1}>
              {pending.length} Staged Tasks · Bin Allocation
            </Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh putaway"
          onPress={() => void refresh()}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <MaterialCommunityIcons name="sync" size={19} color="#192338" />
        </Pressable>
      </View>

      <View style={styles.summaryCard}>
        <View style={styles.summaryIcon}>
          <MaterialCommunityIcons name="map-marker-path" size={26} color={colors.navy} />
        </View>
        <View style={styles.summaryBody}>
          <Text style={styles.summaryTitle}>Staged stock</Text>
          <Text style={styles.summaryText}>
            {pending.length === 0
              ? 'All received stock is in storage.'
              : `${pending.length}${pendingSuffix} task${
                  pending.length === 1 && !pendingSuffix ? '' : 's'
                } waiting for a bin.`}
          </Text>
        </View>
        <Badge
          label={pending.length === 0 ? 'Clear' : `${pending.length}${pendingSuffix}`}
          tone={pending.length === 0 ? 'success' : 'warning'}
        />
      </View>

      <View style={styles.searchBox}>
        <MaterialCommunityIcons name="magnify" size={19} color={colors.muted} />
        <TextInput
          accessibilityLabel="Search put-away tasks"
          value={search}
          onChangeText={setSearch}
          placeholder="Search receipt, SKU, item or barcode"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
        />
        {search ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={() => setSearch('')}
            style={({ pressed }) => [styles.searchClear, pressed && styles.pressed]}
          >
            <MaterialCommunityIcons name="close-circle" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.filterGrid}>
        <View style={styles.filterItem}>
          <SelectField
            label="Warehouse"
            value={warehouseFilter ?? 'all'}
            onChange={(value) => setWarehouseFilter(value === 'all' ? null : value)}
            options={[
              { value: 'all', label: 'All warehouses' },
              ...warehouses.map((warehouse) => ({
                value: warehouse.id,
                label: warehouse.name,
                detail: warehouse.code ?? humanize(warehouse.status),
              })),
            ]}
            placeholder="All warehouses"
            searchable
          />
        </View>
        <View style={styles.filterItem}>
          <SelectField
            label="Source location"
            value={sourceFilter ?? 'all'}
            onChange={(value) => setSourceFilter(value === 'all' ? null : value)}
            options={[
              { value: 'all', label: 'All staging locations' },
              ...sourceLocationOptions.map((location) => ({
                value: location.id,
                label: location.path ?? location.code,
                detail: humanize(location.type),
              })),
            ]}
            placeholder="All staging locations"
            searchable
          />
        </View>
        {isMultiOwner ? (
          <View style={styles.filterItem}>
            <SelectField
              label="Inventory owner"
              value={ownerFilter ?? 'all'}
              onChange={(value) => setOwnerFilter(value === 'all' ? null : value)}
              options={[
                { value: 'all', label: 'All owners' },
                ...inventoryOwners.map((owner) => ({
                  value: owner.id,
                  label: owner.name,
                  detail: owner.is_internal ? 'Internal' : '3PL owner',
                })),
              ]}
              placeholder="All owners"
              searchable
            />
          </View>
        ) : null}
      </View>

      {activeReceiptFilter ? (
        <View style={styles.filterBanner}>
          <View style={styles.filterBannerTextRow}>
            <MaterialCommunityIcons name="filter-variant" size={16} color={colors.accent} />
            <Text style={styles.filterBannerText}>
              Filtered by receipt{filterReceiptNumber ? `: ${filterReceiptNumber}` : ''}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show all tasks"
            onPress={() => setActiveReceiptFilter(null)}
            style={({ pressed }) => [styles.filterBannerButton, pressed && styles.pressed]}
          >
            <Text style={styles.filterBannerButtonText}>Show All Tasks</Text>
          </Pressable>
        </View>
      ) : null}

      {!canPutaway ? (
        <View style={styles.permissionBox}>
          <MaterialCommunityIcons name="lock-outline" size={18} color={colors.muted} />
          <Text style={styles.permissionText}>
            Your role can review the queue but cannot complete tasks.
          </Text>
        </View>
      ) : null}

      {notice ? (
        <View style={styles.noticeBox}>
          <MaterialCommunityIcons name="check-circle-outline" size={20} color={colors.success} />
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBox}>
          <MaterialCommunityIcons name="alert-circle-outline" size={20} color={colors.danger} />
          <View style={styles.errorBody}>
            <Text style={styles.errorText}>{error}</Text>
            {errorRetryable ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry loading put-away tasks"
                onPress={() => void load()}
              >
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingText}>Loading put-away work…</Text>
        </View>
      ) : null}

      {!loading && !error && pending.length === 0 ? (
        <EmptyState
          icon={hasFilters ? 'filter-remove-outline' : 'check-decagram-outline'}
          title={hasFilters ? 'No matching put-away tasks' : 'Nothing to put away'}
          message={
            activeReceiptFilter
              ? 'No pending put-away tasks found for this specific receipt.'
              : hasFilters
                ? 'Adjust the search or filters to see other staged stock.'
                : 'Post a receipt into a receiving or staging location to create put-away tasks.'
          }
        />
      ) : null}

      {!loading
        ? pending.map((task) => {
            const selected = task.id === selectedId;
            const progress = putawayProgress(task);
            return (
              <View key={task.id} style={[styles.taskCard, selected && styles.taskCardActive]}>
                <View style={styles.taskHeader}>
                  <View style={styles.taskIcon}>
                    <MaterialCommunityIcons
                      name="package-variant-closed"
                      size={22}
                      color={colors.deep}
                    />
                  </View>
                  <Pressable
                    disabled={!onOpenItem}
                    onPress={() => onOpenItem?.(task.item_id)}
                    style={styles.taskBody}
                  >
                    <Text style={[styles.taskTitle, Boolean(onOpenItem) && styles.taskTitleClickable]}>
                      {task.item_name}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
                      <Text style={styles.taskMeta}>{task.sku}</Text>
                      {task.status === 'in_progress' || progress.isPartial ? (
                        <View style={{ backgroundColor: '#FEF3C7', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 }}>
                          <Text style={{ fontSize: 10, fontWeight: '700', color: '#D97706' }}>IN PROGRESS</Text>
                        </View>
                      ) : (
                        <View style={{ backgroundColor: '#EFF6FF', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 }}>
                          <Text style={{ fontSize: 10, fontWeight: '700', color: '#2563EB' }}>PENDING</Text>
                        </View>
                      )}
                      {task.suggested_location_code ? (
                        <View style={{ backgroundColor: '#ECFDF5', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 }}>
                          <Text style={{ fontSize: 10, fontWeight: '700', color: '#059669' }}>Pref: {task.suggested_location_code}</Text>
                        </View>
                      ) : null}
                    </View>
                  </Pressable>
                  <View style={styles.qtyColumn}>
                    <Text style={styles.taskQty}>
                      {formatQty(progress.remainingQty)} {task.base_uom}
                    </Text>
                    <Text style={styles.taskQtyHint}>
                      {progress.isPartial
                        ? `${formatQty(progress.completedQty)} of ${formatQty(
                            task.base_qty,
                          )} placed`
                        : `${formatQty(task.base_qty)} received`}
                    </Text>
                  </View>
                </View>

                <View style={styles.routeRow}>
                  <View style={styles.routePoint}>
                    <Text style={styles.routeLabel}>FROM STAGING</Text>
                    <Text style={styles.routeCode}>{task.from_location_code}</Text>
                  </View>
                  <MaterialCommunityIcons
                    name="arrow-right"
                    size={18}
                    color={colors.muted}
                  />
                  <View style={styles.routePoint}>
                    <Text style={styles.routeLabel}>FINAL BIN</Text>
                    <Text style={styles.routeCode}>
                      {task.to_location_code ?? 'Not placed yet'}
                    </Text>
                  </View>
                  <Text style={styles.routeTime}>{formatDateTime(task.created_at)}</Text>
                </View>

                {task.lot_no || task.serial_no || task.expiry_date ? (
                  <View style={styles.trackingRow}>
                    {task.lot_no ? (
                      <Text style={styles.trackingChip}>Lot {task.lot_no}</Text>
                    ) : null}
                    {task.serial_no ? (
                      <Text style={styles.trackingChip}>SN {task.serial_no}</Text>
                    ) : null}
                    {task.expiry_date ? (
                      <Text style={styles.trackingChip}>
                        Expires {formatDate(task.expiry_date)}
                      </Text>
                    ) : null}
                  </View>
                ) : null}

                {task.placements.length > 0 ? (
                  <View style={styles.placementRow}>
                    <Text style={styles.placementLabel}>PLACED</Text>
                    {task.placements.map((placement, index) => (
                      <Text
                        key={`${placement.location_id}-${index}`}
                        style={styles.placementChip}
                      >
                        {placement.location_code} × {formatQty(placement.quantity)}
                      </Text>
                    ))}
                  </View>
                ) : null}

                {task.supplier_name || task.purchase_order ? (
                  <View style={styles.attributionRow}>
                    {task.supplier_name ? (
                      <Text style={styles.attributionText}>
                        Supplier: {task.supplier_name}
                      </Text>
                    ) : null}
                    {task.purchase_order ? (
                      <Text style={styles.attributionText}>PO: {task.purchase_order}</Text>
                    ) : null}
                  </View>
                ) : null}

                {onOpenReceipt ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open receipt ${task.receipt_number}`}
                    onPress={() => onOpenReceipt(task.receipt_id)}
                    style={({ pressed }) => [styles.receiptLink, pressed && styles.pressed]}
                  >
                    <MaterialCommunityIcons
                      name="file-document-outline"
                      size={14}
                      color={colors.primary}
                    />
                    <Text style={styles.receiptLinkText}>Receipt {task.receipt_number}</Text>
                    <MaterialCommunityIcons
                      name="chevron-right"
                      size={15}
                      color={colors.primary}
                    />
                  </Pressable>
                ) : (
                  <View style={styles.receiptLink}>
                    <MaterialCommunityIcons
                      name="file-document-outline"
                      size={14}
                      color={colors.muted}
                    />
                    <Text style={styles.receiptText}>Receipt {task.receipt_number}</Text>
                  </View>
                )}

                {selected ? (
                  <View style={styles.destinationBox}>
                    {destinationOptions.length === 0 ? (
                      <View style={styles.setupBox}>
                        <MaterialCommunityIcons
                          name="map-marker-off-outline"
                          size={19}
                          color={colors.warning}
                        />
                        <View style={styles.setupBody}>
                          <Text style={styles.setupTitle}>No storage bin is available</Text>
                          <Text style={styles.setupText}>
                            {selectedWarehouse
                              ? `${selectedWarehouse.name} has no active storage location that can receive this stock.`
                              : 'This warehouse has no active storage location that can receive this stock.'}{' '}
                            Add or activate a bin in Warehouses & Bins before putting this
                            stock away.
                          </Text>
                          {onOpenLocations ? (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel="Open Warehouses and Bins"
                              onPress={onOpenLocations}
                              style={({ pressed }) => [
                                styles.setupLink,
                                pressed && styles.pressed,
                              ]}
                            >
                              <Text style={styles.setupLinkText}>Open Warehouses & Bins</Text>
                              <MaterialCommunityIcons
                                name="arrow-right"
                                size={15}
                                color={colors.primary}
                              />
                            </Pressable>
                          ) : null}
                        </View>
                      </View>
                    ) : (
                      <View style={styles.destinationChooserBox}>
                        {/* Scan destination barcode button */}
                        <View style={styles.destinationActionHeader}>
                          <Text style={styles.destinationChooserTitle}>Destination Bin</Text>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Scan destination bin barcode"
                            onPress={() => {
                              setBinScannerError(null);
                              setBinScannerMessage(null);
                              setBinScannerVisible(true);
                            }}
                            style={({ pressed }) => [styles.scanBinBtn, pressed && styles.pressed]}
                          >
                            <MaterialCommunityIcons name="barcode-scan" size={14} color={colors.primary} />
                            <Text style={styles.scanBinBtnText}>Scan Bin</Text>
                          </Pressable>
                        </View>

                        {/* Smart Suggestion if item is already stocked in a bin */}
                        {selectedTask && suggestedBins.length > 0 && !destinationId ? (
                          <View style={styles.suggestedBinCard}>
                            <View style={styles.suggestedBinHeader}>
                              <MaterialCommunityIcons name="star-circle" size={16} color="#D97706" />
                              <Text style={styles.suggestedBinTitle}>Smart Recommendation</Text>
                            </View>
                            <Text style={styles.suggestedBinText}>
                              {selectedTask.item_name} already has stock in{' '}
                              <Text style={styles.boldText}>
                                {suggestedBins[0].path || suggestedBins[0].code}
                              </Text>
                              . Store here to consolidate inventory:
                            </Text>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Select suggested bin ${suggestedBins[0].code}`}
                              onPress={() => handleSelectDestination(suggestedBins[0].id)}
                              style={({ pressed }) => [styles.useSuggestedBinBtn, pressed && styles.pressed]}
                            >
                              <MaterialCommunityIcons name="checkbox-marked-circle-outline" size={15} color={colors.primary} />
                              <Text style={styles.useSuggestedBinBtnText}>
                                Auto-Fill Bin: {suggestedBins[0].path || suggestedBins[0].code}
                              </Text>
                            </Pressable>
                          </View>
                        ) : null}

                        {/* Aisle · Rack · Shelf · Bin Manual Entry & Drill-Down */}
                        <View style={styles.hierarchyFilterCard}>
                          <View style={styles.hierarchyFilterHeaderRow}>
                            <Text style={styles.hierarchyFilterHeader}>
                              AISLE · RACK · SHELF · BIN (MANUAL COORDINATES)
                            </Text>
                            {hasTypedCoords ? (
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Clear entered coordinates"
                                onPress={() => {
                                  setInputAisle('');
                                  setInputRack('');
                                  setInputShelf('');
                                  setInputBin('');
                                  setCoordCreationError(null);
                                  setDestinationId(null);
                                }}
                                style={({ pressed }) => [styles.clearCoordsBtn, pressed && styles.pressed]}
                              >
                                <MaterialCommunityIcons name="close-circle-outline" size={13} color={colors.primary} />
                                <Text style={styles.clearCoordsBtnText}>Clear</Text>
                              </Pressable>
                            ) : null}
                          </View>
                          <Text style={styles.hierarchyFilterSubtext}>
                            Type where the stock should be stored to auto-match or create the bin:
                          </Text>

                          <View style={styles.coordinateInputsGrid}>
                            <View style={styles.coordinateInputCol}>
                              <Text style={styles.coordinateInputLabel}>Aisle</Text>
                              <TextInput
                                style={styles.coordinateTextInput}
                                value={inputAisle}
                                onChangeText={(t) => handleCoordinateChange('aisle', t)}
                                placeholder="A1"
                                placeholderTextColor={colors.muted}
                                autoCapitalize="characters"
                                autoCorrect={false}
                              />
                            </View>

                            <View style={styles.coordinateInputCol}>
                              <Text style={styles.coordinateInputLabel}>Rack</Text>
                              <TextInput
                                style={styles.coordinateTextInput}
                                value={inputRack}
                                onChangeText={(t) => handleCoordinateChange('rack', t)}
                                placeholder="R02"
                                placeholderTextColor={colors.muted}
                                autoCapitalize="characters"
                                autoCorrect={false}
                              />
                            </View>

                            <View style={styles.coordinateInputCol}>
                              <Text style={styles.coordinateInputLabel}>Shelf</Text>
                              <TextInput
                                style={styles.coordinateTextInput}
                                value={inputShelf}
                                onChangeText={(t) => handleCoordinateChange('shelf', t)}
                                placeholder="S03"
                                placeholderTextColor={colors.muted}
                                autoCapitalize="characters"
                                autoCorrect={false}
                              />
                            </View>

                            <View style={styles.coordinateInputCol}>
                              <Text style={styles.coordinateInputLabel}>Bin</Text>
                              <TextInput
                                style={styles.coordinateTextInput}
                                value={inputBin}
                                onChangeText={(t) => handleCoordinateChange('bin', t)}
                                placeholder="B04"
                                placeholderTextColor={colors.muted}
                                autoCapitalize="characters"
                                autoCorrect={false}
                              />
                            </View>
                          </View>

                          {/* Coordinates Match / Unmatched Status */}
                          {matchedLocationByCoords ? (
                            <View style={styles.coordinateMatchBanner}>
                              <MaterialCommunityIcons name="check-circle" size={15} color={colors.success} />
                              <Text style={styles.coordinateMatchText}>
                                Matches bin:{' '}
                                <Text style={styles.boldText}>
                                  {matchedLocationByCoords.path || matchedLocationByCoords.code}
                                </Text>
                              </Text>
                            </View>
                          ) : hasTypedCoords ? (
                            <View style={styles.coordinateUnmatchedBox}>
                              <Text style={styles.coordinateUnmatchedText}>
                                No bin matches "{suggestedBinCode}" in this warehouse.
                              </Text>
                              {coordCreationError ? (
                                <Text style={styles.coordErrorText}>{coordCreationError}</Text>
                              ) : null}
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`Create and select bin ${suggestedBinCode}`}
                                disabled={creatingLocation}
                                onPress={handleCreateCustomBin}
                                style={({ pressed }) => [
                                  styles.createBinBtn,
                                  creatingLocation && styles.btnDisabled,
                                  pressed && styles.pressed,
                                ]}
                              >
                                {creatingLocation ? (
                                  <ActivityIndicator size="small" color="#fff" />
                                ) : (
                                  <>
                                    <MaterialCommunityIcons name="plus-box" size={15} color="#fff" />
                                    <Text style={styles.createBinBtnText}>
                                      Create & Select Bin "{suggestedBinCode}"
                                    </Text>
                                  </>
                                )}
                              </Pressable>
                            </View>
                          ) : null}
                        </View>

                        <SelectField
                          label="Or choose from available warehouse bins"
                          value={destinationId}
                          onChange={handleSelectDestination}
                          options={filteredDestinationOptions.map((location) => {
                            const coords = formatLocationCoordinates(location);
                            return {
                              value: location.id,
                              label: location.path ?? location.code,
                              detail: [
                                humanize(location.type),
                                coords || location.name,
                              ]
                                .filter(Boolean)
                                .join(' · '),
                            };
                          })}
                          placeholder="Choose a storage location"
                          emptyLabel="No storage locations match the filter"
                          searchable
                          searchPlaceholder="Search bins or codes…"
                        />

                        {/* Selected destination coordinates badge */}
                        {selectedDestination ? (
                          <View style={styles.destinationBadgeCard}>
                            <MaterialCommunityIcons name="map-marker-check" size={18} color={colors.success} />
                            <View style={styles.destinationBadgeTextWrap}>
                              <Text style={styles.destinationBadgeCode}>
                                {selectedDestination.path || selectedDestination.code}
                              </Text>
                              {formatLocationCoordinates(selectedDestination) ? (
                                <Text style={styles.destinationBadgeCoords}>
                                  {formatLocationCoordinates(selectedDestination)}
                                </Text>
                              ) : null}
                            </View>
                          </View>
                        ) : null}
                      </View>
                    )}

                    {serialTask ? (
                      <View style={styles.serialBox}>
                        <MaterialCommunityIcons
                          name="barcode"
                          size={18}
                          color={colors.deep}
                        />
                        <Text style={styles.serialText}>
                          Serial {task.serial_no} is the eligible unit on this task. It will move
                          as one unit.
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.quantityField}>
                        <Text style={styles.quantityLabel}>Quantity to put away</Text>
                        <TextInput
                          accessibilityLabel="Quantity to put away"
                          value={quantityInput}
                          onChangeText={setQuantityInput}
                          keyboardType="decimal-pad"
                          placeholder="0"
                          placeholderTextColor={colors.muted}
                          style={[
                            styles.quantityInput,
                            Boolean(quantityValidation.error) && styles.quantityInputError,
                          ]}
                        />
                        <Text style={styles.quantityHint}>
                          {formatQty(progress.remainingQty)} {task.base_uom} staged · split
                          across bins by moving part of the quantity first.
                        </Text>
                        {quantityValidation.error ? (
                          <Text style={styles.fieldError}>{quantityValidation.error}</Text>
                        ) : null}
                      </View>
                    )}

                    <Button
                      label={progress.isPartial ? 'Move quantity' : 'Confirm put-away'}
                      onPress={() => void complete()}
                      loading={saving}
                      disabled={
                        !destinationId ||
                        destinationOptions.length === 0 ||
                        Boolean(quantityValidation.error)
                      }
                    />
                    <Button label="Cancel" variant="ghost" onPress={closeTask} />
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Put away ${task.item_name}`}
                    accessibilityState={{ disabled: !canPutaway }}
                    disabled={!canPutaway}
                    onPress={() => chooseTask(task)}
                    style={({ pressed }) => [
                      styles.putawayButton,
                      !canPutaway && styles.putawayButtonDisabled,
                      pressed && canPutaway && styles.pressed,
                    ]}
                  >
                    <Text style={styles.putawayButtonText}>
                      {progress.isPartial ? 'Continue put-away' : 'Put away'}
                    </Text>
                    <MaterialCommunityIcons
                      name="arrow-right"
                      size={17}
                      color={colors.white}
                    />
                  </Pressable>
                )}
              </View>
            );
          })
        : null}

      {!loading && pendingCursor ? (
        <Button
          label="Load more tasks"
          variant="ghost"
          onPress={() => void loadMore()}
          loading={loadingMore}
        />
      ) : null}

      {completed.length > 0 ? (
        <View style={styles.completedCard}>
          <View style={styles.completedHeader}>
            <Text style={styles.completedTitle}>Recently completed</Text>
            <Text style={styles.completedSubtitle}>Stock now available in final bins</Text>
          </View>
          {completed.map((task) => (
            <Pressable
              key={task.id}
              accessibilityRole={onOpenReceipt ? 'button' : undefined}
              accessibilityLabel={
                onOpenReceipt ? `Open receipt ${task.receipt_number}` : undefined
              }
              disabled={!onOpenReceipt}
              onPress={() => onOpenReceipt?.(task.receipt_id)}
              style={({ pressed }) => [styles.completedRow, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons
                name="check-circle"
                size={18}
                color={colors.success}
              />
              <View style={styles.completedBody}>
                <Text style={styles.completedName}>{task.item_name}</Text>
                <Text style={styles.completedMeta}>
                  {task.receipt_number} · {formatQty(task.base_qty)} {task.base_uom} ·{' '}
                  {task.from_location_code} to {task.to_location_code}
                </Text>
              </View>
              <Text style={styles.completedTime}>
                {task.completed_at ? formatDateTime(task.completed_at) : ''}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {/* Destination Bin Barcode Scanner Modal */}
      <Modal
        visible={binScannerVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setBinScannerVisible(false)}
      >
        <View style={styles.scannerModalOverlay}>
          <View style={styles.scannerContainer}>
            <View style={styles.scannerHeader}>
              <View>
                <Text style={styles.scannerTitle}>Scan Destination Bin</Text>
                <Text style={styles.scannerSubtitle}>
                  Align the storage rack, shelf or bin barcode
                </Text>
              </View>
              <View style={styles.scannerHeaderControls}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Toggle torch"
                  onPress={() => setTorch((current) => !current)}
                  style={styles.torchButton}
                >
                  <MaterialCommunityIcons
                    name={torch ? 'flashlight' : 'flashlight-off'}
                    size={20}
                    color={colors.white}
                  />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close bin scanner"
                  onPress={() => setBinScannerVisible(false)}
                  style={styles.closeScannerButton}
                >
                  <MaterialCommunityIcons name="close" size={22} color={colors.white} />
                </Pressable>
              </View>
            </View>

            {cameraPermission?.granted ? (
              <View style={styles.cameraFrame}>
                <CameraView
                  style={StyleSheet.absoluteFill}
                  enableTorch={torch}
                  onBarcodeScanned={handleDestinationBarcodeScanned}
                  barcodeScannerSettings={{
                    barcodeTypes: ['qr', 'ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e'],
                  }}
                />
                <View style={styles.reticleContainer}>
                  <View style={styles.reticle} />
                </View>
              </View>
            ) : (
              <View style={styles.scannerPermissionBox}>
                <MaterialCommunityIcons name="camera-off" size={40} color={colors.muted} />
                <Text style={styles.scannerPermissionTitle}>Camera access required</Text>
                <Text style={styles.scannerPermissionText}>
                  Allow camera permission to scan storage bin and shelf barcodes.
                </Text>
                <Button label="Grant permission" onPress={() => void requestCameraPermission()} />
              </View>
            )}

            <View style={styles.scannerFooter}>
              {binScannerError ? (
                <View style={styles.scannerErrorBox}>
                  <MaterialCommunityIcons name="alert-circle" size={16} color={colors.danger} />
                  <Text style={styles.scannerErrorText}>{binScannerError}</Text>
                </View>
              ) : binScannerMessage ? (
                <View style={styles.scannerSuccessBox}>
                  <MaterialCommunityIcons name="check-circle" size={16} color={colors.success} />
                  <Text style={styles.scannerSuccessText}>{binScannerMessage}</Text>
                </View>
              ) : (
                <Text style={styles.scannerHint}>
                  Scan the shelf or bin barcode to auto-select destination.
                </Text>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
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
  iconButton: {
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
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 3,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
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
    fontSize: 25,
    color: colors.navy,
  },
  pressed: {
    opacity: 0.75,
  },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: palette.ink,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1.2,
    borderColor: 'rgba(255,255,255,0.16)',
    ...neo.raised,
  },
  summaryIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: palette.gold,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1.4,
    borderTopColor: 'rgba(255,255,255,0.6)',
  },
  summaryBody: {
    flex: 1,
    gap: 2,
  },
  summaryTitle: {
    fontFamily: fonts.outfitBold,
    fontSize: 15,
    color: colors.white,
  },
  summaryText: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 10.5,
    lineHeight: 15,
    color: 'rgba(255,255,255,0.58)',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.glassBorder,
    paddingHorizontal: spacing.md,
    minHeight: 46,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.dmSansRegular,
    fontSize: 13,
    color: palette.ink,
    paddingVertical: spacing.sm,
  },
  searchClear: {
    padding: 2,
  },
  filterGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  filterItem: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 150,
  },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.successSoft,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  noticeText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.success,
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
  errorBody: {
    flex: 1,
    gap: 3,
  },
  retryText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.primary,
  },
  loadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  loadingText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  taskCard: {
    backgroundColor: palette.glass,
    borderRadius: radius.xl,
    borderWidth: 1.1,
    borderColor: palette.glassBorder,
    padding: spacing.lg,
    gap: spacing.md,
    ...neo.soft,
  },
  taskCardActive: {
    borderColor: colors.primary,
  },
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  taskIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#EAF3FA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskBody: {
    flex: 1,
    gap: 1,
  },
  taskTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.navy,
  },
  taskMeta: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  qtyColumn: {
    alignItems: 'flex-end',
    gap: 1,
  },
  taskQty: {
    fontFamily: fonts.headingSemi,
    fontSize: 14,
    color: colors.navy,
  },
  taskQtyHint: {
    fontFamily: fonts.body,
    fontSize: 9,
    color: colors.muted,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  routePoint: {
    flex: 1,
    gap: 1,
  },
  routeLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 8,
    letterSpacing: 1,
    color: colors.muted,
  },
  routeCode: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  routeTime: {
    fontFamily: fonts.body,
    fontSize: 9,
    color: colors.muted,
  },
  trackingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  trackingChip: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    color: colors.deep,
    backgroundColor: '#EAF3FA',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  placementRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  placementLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 8,
    letterSpacing: 1,
    color: colors.muted,
  },
  placementChip: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    color: colors.success,
    backgroundColor: colors.successSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  attributionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  attributionText: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  receiptLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
  },
  receiptLinkText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.primary,
  },
  receiptText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  putawayButton: {
    minHeight: 42,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  putawayButtonText: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.white,
  },
  putawayButtonDisabled: {
    backgroundColor: colors.border,
  },
  permissionBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  permissionText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 17,
    color: colors.muted,
  },
  destinationBox: {
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  setupBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  setupBody: {
    flex: 1,
    gap: 3,
  },
  setupTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.warning,
  },
  setupText: {
    fontFamily: fonts.body,
    fontSize: 10,
    lineHeight: 15,
    color: colors.navy,
  },
  setupLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: spacing.xs,
  },
  setupLinkText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.primary,
  },
  serialBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#EAF3FA',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  serialText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.navy,
  },
  quantityField: {
    gap: spacing.xs,
  },
  quantityLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    color: colors.navy,
  },
  quantityInput: {
    minHeight: 44,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.headingSemi,
    fontSize: 16,
    color: colors.navy,
  },
  quantityInputError: {
    borderColor: colors.danger,
  },
  quantityHint: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  fieldError: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    color: colors.danger,
  },
  completedCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  completedHeader: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    gap: 1,
  },
  completedTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 15,
    color: colors.navy,
  },
  completedSubtitle: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  completedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  completedBody: {
    flex: 1,
    gap: 1,
  },
  completedName: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  completedMeta: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  completedTime: {
    fontFamily: fonts.body,
    fontSize: 9,
    color: colors.muted,
  },
  filterBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0F2744',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  filterBannerTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flex: 1,
  },
  filterBannerText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.white,
  },
  filterBannerButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  filterBannerButtonText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.accent,
  },
  taskTitleClickable: {
    textDecorationLine: 'underline',
  },
  destinationChooserBox: {
    gap: spacing.sm,
  },
  destinationActionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  destinationChooserTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  scanBinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  scanBinBtnText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.primary,
  },
  suggestedBinCard: {
    backgroundColor: '#FEF3C7',
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#FCD34D',
    gap: 4,
  },
  suggestedBinHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  suggestedBinTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: '#92400E',
  },
  suggestedBinText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#78350F',
    lineHeight: 16,
  },
  useSuggestedBinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    paddingVertical: 5,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.primary,
    marginTop: 2,
  },
  useSuggestedBinBtnText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.primary,
  },
  hierarchyFilterCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hierarchyFilterHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  hierarchyFilterHeader: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.deep,
  },
  hierarchyFilterSubtext: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  clearCoordsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  clearCoordsBtnText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.primary,
  },
  coordinateInputsGrid: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: 2,
  },
  coordinateInputCol: {
    flex: 1,
  },
  coordinateInputLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    color: colors.deep,
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  coordinateTextInput: {
    height: 38,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
    paddingHorizontal: 8,
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.text,
    textAlign: 'center',
  },
  coordinateMatchBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: '#F0FDF4',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    marginTop: 4,
  },
  coordinateMatchText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#166534',
  },
  boldText: {
    fontFamily: fonts.headingSemi,
  },
  coordinateUnmatchedBox: {
    backgroundColor: '#FFFBEB',
    padding: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#FDE68A',
    gap: 6,
    marginTop: 4,
  },
  coordinateUnmatchedText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#92400E',
  },
  coordErrorText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.danger,
  },
  createBinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingVertical: 8,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  createBinBtnText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.white,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  destinationBadgeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#F0FDF4',
    padding: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  destinationBadgeTextWrap: {
    flex: 1,
  },
  destinationBadgeCode: {
    fontFamily: fonts.headingSemi,
    fontSize: 13,
    color: '#166534',
  },
  destinationBadgeCoords: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#15803D',
    marginTop: 1,
  },
  scannerModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  scannerContainer: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#0F172A',
    borderRadius: radius.xl,
    overflow: 'hidden',
    gap: spacing.md,
  },
  scannerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  scannerTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 15,
    color: colors.white,
  },
  scannerSubtitle: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
  scannerHeaderControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  torchButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeScannerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraFrame: {
    width: '100%',
    height: 280,
    backgroundColor: '#000',
    position: 'relative',
  },
  reticleContainer: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reticle: {
    width: 220,
    height: 140,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  scannerPermissionBox: {
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  scannerPermissionTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 16,
    color: colors.white,
  },
  scannerPermissionText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  scannerFooter: {
    padding: spacing.md,
    alignItems: 'center',
  },
  scannerHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#94A3B8',
    textAlign: 'center',
  },
  scannerErrorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.danger,
    width: '100%',
  },
  scannerErrorText: {
    flex: 1,
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: '#FCA5A5',
  },
  scannerSuccessBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.success,
    width: '100%',
  },
  scannerSuccessText: {
    flex: 1,
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: '#86EFAC',
  },
});
