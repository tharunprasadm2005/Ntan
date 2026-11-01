import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
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
import { Field } from '../components/Field';
import { SelectField } from '../components/SelectField';
import { PageHeader } from '../components/ui';
import { useWorkspace } from '../data';
import { formatQty, humanize } from '../format';
import { SAMPLE_PRODUCTS_CSV } from '../sampleCatalogue';
import {
  activeSupplierPartners,
  itemMatchesSupplierFilter,
} from '../supplierMapping';
import { colors, fonts, neo, palette, radius, shadow, spacing } from '../theme';
import type { BulkImportError, BulkImportResponse, Item } from '../types';

export function ItemsScreen({
  onOpenItem,
  onBack,
}: {
  onOpenItem: (itemId: string) => void;
  onBack?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { state } = useAuth();
  const { items, balances, clients, refreshing, refresh, activeClientId, activeClient } = useWorkspace();
  const canWrite =
    state.status === 'signedIn' && state.session.permissions.includes('inventory.write');

  // Search and Filter State
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedTracking, setSelectedTracking] = useState<'all' | 'none' | 'lot' | 'serial'>('all');
  const [selectedHealth, setSelectedHealth] = useState<'all' | 'low_stock' | 'archived'>('all');
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('all');
  const [supplierItemIds, setSupplierItemIds] = useState<Set<string> | null>(null);
  const [supplierFilterLoading, setSupplierFilterLoading] = useState(false);
  const [supplierFilterError, setSupplierFilterError] = useState<string | null>(null);

  // Single Item Creation Modal / Form
  const [showForm, setShowForm] = useState(false);
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [barcode, setBarcode] = useState('');
  const [category, setCategory] = useState('');
  const [trackingMode, setTrackingMode] = useState<'none' | 'lot' | 'serial'>('none');
  const [expiryTracked, setExpiryTracked] = useState(false);
  const [uom, setUom] = useState('EA');
  const [reorderPoint, setReorderPoint] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Quick Barcode Scan State & Camera Scanner
  const [showScanInput, setShowScanInput] = useState(false);
  const [scanCode, setScanCode] = useState('');
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraTorch, setCameraTorch] = useState(false);
  const [scanContext, setScanContext] = useState<'search' | 'form'>('search');

  // Bulk Import State
  const [showImportModal, setShowImportModal] = useState(false);
  const [importMode, setImportMode] = useState<'upsert' | 'create_only'>('upsert');
  const [csvText, setCsvText] = useState('');
  const [pickedFileName, setPickedFileName] = useState<string | null>(null);
  const [pickedFileBase64, setPickedFileBase64] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<BulkImportResponse | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Export State
  const [exporting, setExporting] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);

  // Compute on-hand stock by item from balances
  const stockByItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of balances) {
      const cur = map.get(b.item_id) ?? 0;
      map.set(b.item_id, cur + Number(b.on_hand || 0));
    }
    return map;
  }, [balances]);

  // Extract unique categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if (item.category && item.category.trim()) {
        set.add(item.category.trim());
      }
    }
    return Array.from(set).sort();
  }, [items]);

  // Active supplier partners available for catalogue filtering.
  const suppliers = useMemo(() => activeSupplierPartners(clients), [clients]);

  useEffect(() => {
    let cancelled = false;
    if (selectedSupplierId === 'all') {
      setSupplierItemIds(null);
      setSupplierFilterError(null);
      setSupplierFilterLoading(false);
      return;
    }
    setSupplierFilterLoading(true);
    setSupplierFilterError(null);
    api
      .supplierItems(selectedSupplierId, false)
      .then((response) => {
        if (!cancelled) {
          setSupplierItemIds(new Set(response.items.map((row) => row.item_id)));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSupplierItemIds(new Set());
          setSupplierFilterError(
            error instanceof ApiError
              ? error.message
              : 'Could not filter by supplier.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSupplierFilterLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSupplierId]);

  // Tracking counts for badges
  const trackingCounts = useMemo(() => {
    let lot = 0;
    let serial = 0;
    let standard = 0;
    for (const item of items) {
      const mode = String(item.tracking_mode || 'none').toLowerCase();
      if (mode === 'lot') lot++;
      else if (mode === 'serial') serial++;
      else standard++;
    }
    return { all: items.length, lot, serial, standard };
  }, [items]);

  // Low stock count for alert badge
  const lowStockCount = useMemo(() => {
    let count = 0;
    for (const item of items) {
      if (item.status === 'archived') continue;
      const reorder = item.reorder_point !== null ? Number(item.reorder_point) : null;
      if (reorder !== null) {
        const onHand = stockByItem.get(item.id) ?? 0;
        if (onHand <= reorder) count++;
      }
    }
    return count;
  }, [items, stockByItem]);

  // Filtered Items with multi-word search token matching
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const tokens = query ? query.split(/\s+/).filter(Boolean) : [];

    return items.filter((item) => {
      // Search text: all tokens must match
      if (tokens.length > 0) {
        const haystack = `${item.name} ${item.sku} ${item.barcode ?? ''} ${item.category ?? ''} ${item.description ?? ''} ${item.tracking_mode ?? ''}`.toLowerCase();
        const matches = tokens.every((t) => haystack.includes(t));
        if (!matches) return false;
      }

      // Category filter
      if (selectedCategory !== 'all') {
        if ((item.category || '').toLowerCase() !== selectedCategory.toLowerCase()) {
          return false;
        }
      }

      // Tracking mode filter
      if (selectedTracking !== 'all') {
        const mode = String(item.tracking_mode || 'none').toLowerCase();
        if (selectedTracking === 'none') {
          if (mode !== 'none' && mode !== 'standard') return false;
        } else if (mode !== selectedTracking) {
          return false;
        }
      }

      // Health / Status filter
      if (selectedHealth === 'low_stock') {
        const onHand = stockByItem.get(item.id) ?? 0;
        const reorder = item.reorder_point !== null ? Number(item.reorder_point) : null;
        if (reorder === null || onHand > reorder) {
          return false;
        }
      } else if (selectedHealth === 'archived') {
        if (item.status !== 'archived') {
          return false;
        }
      } else {
        // Default: only show active unless searching for archived
        if (item.status === 'archived') {
          return false;
        }
      }

      // Supplier link filter
      if (!itemMatchesSupplierFilter(item.id, supplierItemIds)) {
        return false;
      }

      return true;
    });
  }, [
    items,
    search,
    selectedCategory,
    selectedTracking,
    selectedHealth,
    selectedSupplierId,
    supplierItemIds,
    stockByItem,
  ]);

  // Single Item Creation
  const createItem = async () => {
    setError(null);
    setFieldErrors({});
    if (!sku.trim() || !name.trim()) {
      setError('Enter a SKU and item name.');
      return;
    }
    const normalizedReorderPoint = reorderPoint.trim().replace(',', '.');
    if (normalizedReorderPoint) {
      const parsed = Number(normalizedReorderPoint);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError('Reorder point must be zero or greater.');
        setFieldErrors({ reorder_point: 'Enter a number of zero or greater.' });
        return;
      }
    }
    setSaving(true);
    try {
      await api.createItem({
        client_id: activeClientId ?? undefined,
        sku: sku.trim().toUpperCase(),
        name: name.trim(),
        barcode: barcode.trim() || undefined,
        tracking_mode: trackingMode,
        expiry_tracked: expiryTracked,
        base_uom: uom.trim().toUpperCase() || 'EA',
        reorder_point: normalizedReorderPoint || undefined,
      });
      setSku('');
      setName('');
      setBarcode('');
      setCategory('');
      setTrackingMode('none');
      setExpiryTracked(false);
      setUom('EA');
      setReorderPoint('');
      setShowForm(false);
      await refresh();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors);
      } else {
        setError('The item could not be created.');
      }
    } finally {
      setSaving(false);
    }
  };

  // Open Camera Scanner
  const openScanner = async (target: 'search' | 'form') => {
    setScanContext(target);
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        Alert.alert(
          'Camera Permission Required',
          'Please allow camera access in your device settings to scan product barcodes directly.',
        );
        return;
      }
    }
    setCameraActive(true);
  };

  // Handle Barcode Scanned by Camera
  const handleBarcodeScanned = (scanningResult: BarcodeScanningResult) => {
    const raw = scanningResult.data;
    if (!raw) return;
    const code = raw.trim();
    setCameraActive(false);

    if (scanContext === 'form') {
      setBarcode(code);
      Alert.alert('Barcode Scanned', `Scanned barcode "${code}" into New Item form.`);
      return;
    }

    // Lookup barcode or SKU in catalogue
    const matched = items.find(
      (i) => (i.barcode && i.barcode.toLowerCase() === code.toLowerCase()) || i.sku.toLowerCase() === code.toLowerCase(),
    );
    if (matched) {
      Alert.alert(
        'Product Found',
        `Matched "${matched.name}" (SKU: ${matched.sku}).`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'View Item', onPress: () => onOpenItem(matched.id) },
        ],
      );
    } else {
      Alert.alert(
        'Barcode Not in Catalogue',
        `No existing product has barcode or SKU "${code}". Would you like to create a new product with this barcode?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Create Product',
            onPress: () => {
              setBarcode(code);
              setShowForm(true);
            },
          },
        ],
      );
    }
  };

  // Barcode Lookup / Add Handler (manual input)
  const handleBarcodeLookup = () => {
    const code = scanCode.trim();
    if (!code) return;
    const matched = items.find(
      (i) => (i.barcode && i.barcode.toLowerCase() === code.toLowerCase()) || i.sku.toLowerCase() === code.toLowerCase(),
    );
    if (matched) {
      setShowScanInput(false);
      setScanCode('');
      onOpenItem(matched.id);
    } else {
      setShowScanInput(false);
      setBarcode(code);
      setShowForm(true);
      setScanCode('');
      Alert.alert(
        'Barcode Not Found',
        `No existing product has barcode or SKU "${code}". We've opened the New Item form with this barcode pre-filled.`,
      );
    }
  };

  // File Picker for Bulk Import (supports .xlsx, .xls, .csv)
  const handlePickDocument = async () => {
    try {
      setImportError(null);
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'text/csv',
          'text/comma-separated-values',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          '*/*',
        ],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        const fileName = file.name || 'imported_file';
        setPickedFileName(fileName);

        // Fetch file content and convert to base64
        const res = await fetch(file.uri);
        const blob = await res.blob();
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
          setPickedFileBase64(b64);
        };
        reader.readAsDataURL(blob);

        if (fileName.toLowerCase().endsWith('.csv') || fileName.toLowerCase().endsWith('.txt')) {
          const textRes = await fetch(file.uri);
          const text = await textRes.text();
          setCsvText(text);
        } else {
          setCsvText('');
        }
      }
    } catch (err) {
      setImportError(`Could not read file: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Load 105 Sample Products
  const handleLoadSample = () => {
    setCsvText(SAMPLE_PRODUCTS_CSV);
    setPickedFileName('sample_products_105.csv');
    setPickedFileBase64(null);
    setImportError(null);
    setImportResult(null);
  };

  // Copy CSV Template
  const handleCopyTemplate = async () => {
    try {
      const template = await api.getItemTemplate();
      await Clipboard.setStringAsync(template);
      Alert.alert('Template Copied', 'Standard CSV template has been copied to your clipboard!');
    } catch {
      Alert.alert('Notice', 'Failed to fetch online template, copying standard fallback template.');
      await Clipboard.setStringAsync(
        'sku,name,barcode,category,item_type,base_uom,tracking_mode,expiry_tracked,reorder_point,cost,description,warehouse_code,zone_code,aisle_code,rack_code,shelf_code,bin_code,storage_type,preferred_location\n' +
        'CHG-1001,Charger,89010001,Electronics,stocked_material,EA,none,false,20.0,35.50,Fast charging adapter,CHN-WH,A,A03,R05,S02,B08,bin,B08\n'
      );
    }
  };

  // Execute Bulk Import
  const handleExecuteImport = async () => {
    if (!csvText.trim() && !pickedFileBase64) {
      setImportError('Please pick an Excel (.xlsx) or CSV file, paste CSV content, or load sample products.');
      return;
    }
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const response = await api.bulkImportItems({
        client_id: activeClientId ?? undefined,
        mode: importMode,
        csv_data: csvText.trim() || undefined,
        file_base64: pickedFileBase64 || undefined,
        file_name: pickedFileName || undefined,
      });
      setImportResult(response);
      await refresh();
    } catch (caught) {
      setImportError(caught instanceof ApiError ? caught.message : 'Bulk import request failed.');
    } finally {
      setImporting(false);
    }
  };

  // Export Catalogue to CSV
  const handleExportCsv = async () => {
    setExporting(true);
    setExportFeedback(null);
    try {
      const csvData = await api.exportItemsCsv(activeClientId);
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ntan_products_${Date.now()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
      await Clipboard.setStringAsync(csvData);
      setExportFeedback(`Exported ${filtered.length} products to CSV! Downloaded & copied to clipboard.`);
      setTimeout(() => setExportFeedback(null), 6000);
    } catch (caught) {
      Alert.alert('Export Failed', caught instanceof ApiError ? caught.message : 'Could not export catalogue.');
    } finally {
      setExporting(false);
    }
  };

  // Export Catalogue to Excel (.xlsx)
  const handleExportExcel = async () => {
    setExporting(true);
    setExportFeedback(null);
    try {
      const blob = await api.exportItemsExcelBlob(activeClientId);
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ntan_products_${Date.now()}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setExportFeedback(`Exported ${filtered.length} products to Excel (.xlsx)!`);
      } else {
        setExportFeedback(`Exported ${filtered.length} products to Excel workbook.`);
      }
      setTimeout(() => setExportFeedback(null), 6000);
    } catch (caught) {
      Alert.alert('Export Failed', caught instanceof ApiError ? caught.message : 'Could not export Excel workbook.');
    } finally {
      setExporting(false);
    }
  };

  // Unified Export Action Prompt
  const handleExportPrompt = () => {
    Alert.alert(
      'Export Catalogue',
      'Select format for catalogue export:',
      [
        { text: 'Export CSV', onPress: () => void handleExportCsv() },
        { text: 'Export Excel (.xlsx)', onPress: () => void handleExportExcel() },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  // Count lines in csvText for preview
  const csvLineCount = useMemo(() => {
    if (!csvText.trim()) return 0;
    return csvText.trim().split('\n').filter((l) => l.trim().length > 0).length - 1; // exclude header
  }, [csvText]);

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
      keyboardShouldPersistTaps="handled"
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
          {onBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              onPress={onBack}
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons name="arrow-left" size={22} color="#192338" />
            </Pressable>
          ) : null}
          <Image
            source={require('../../assets/ntan-hexagon-logo.png')}
            style={styles.logoImage}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
          <View style={styles.greetingBox}>
            <Text style={styles.greetingTitle}>Item Catalogue</Text>
            <Text style={styles.greetingSubtitle} numberOfLines={1}>
              {items.length} Products · {activeClient?.name ?? 'Internal Store'}
            </Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          {canWrite ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Bulk import products"
              onPress={() => {
                setImportResult(null);
                setImportError(null);
                setShowImportModal(true);
              }}
              style={({ pressed }) => [styles.iconAction, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons
                name="file-upload-outline"
                size={19}
                color="#192338"
              />
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Export products catalogue"
            onPress={handleExportPrompt}
            disabled={exporting}
            style={({ pressed }) => [styles.iconAction, pressed && styles.pressed]}
          >
            {exporting ? (
              <ActivityIndicator size="small" color="#192338" />
            ) : (
              <MaterialCommunityIcons
                name="file-download-outline"
                size={19}
                color="#192338"
              />
            )}
          </Pressable>
          {canWrite ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add single item"
              onPress={() => setShowForm((value) => !value)}
              style={({ pressed }) => [
                styles.addButton,
                showForm && { backgroundColor: '#192338' },
                pressed && styles.pressed,
              ]}
            >
              <MaterialCommunityIcons
                name={showForm ? 'close' : 'plus'}
                size={20}
                color="#FFFFFF"
              />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Hero Bento Card (Navy Blue #192338 Feature) */}
      <View style={styles.bentoHeroNavy}>
        <View style={styles.bentoHeroTopRow}>
          <View style={styles.bentoTag}>
            <View style={styles.pulseDot} />
            <Text style={styles.bentoTagText}>CATALOGUE DIRECTORY</Text>
          </View>
          <Text style={styles.bentoWarehouseBadge}>
            {activeClient?.name ?? 'Internal Store'}
          </Text>
        </View>

        <View style={styles.bentoHeroMainMetric}>
          <Text style={styles.bentoHeroNumber}>{items.length}</Text>
          <Text style={styles.bentoHeroUnit}>Active Master Catalogue Items</Text>
        </View>

        {/* Dual Inset Capsules */}
        <View style={styles.bentoCapsulesRow}>
          <View style={styles.bentoCapsule}>
            <View style={[styles.capsuleIconDot, { backgroundColor: '#10B981' }]}>
              <MaterialCommunityIcons name="tag-outline" size={12} color="#FFFFFF" />
            </View>
            <View style={styles.capsuleTextWrap}>
              <Text style={styles.capsuleLabel}>Categories</Text>
              <Text style={styles.capsuleValue}>{categories.length} Groups</Text>
            </View>
          </View>

          <View style={styles.bentoCapsule}>
            <View
              style={[
                styles.capsuleIconDot,
                { backgroundColor: lowStockCount > 0 ? '#F59E0B' : '#3B82F6' },
              ]}
            >
              <MaterialCommunityIcons
                name={lowStockCount > 0 ? 'alert-octagon-outline' : 'shield-check-outline'}
                size={12}
                color="#FFFFFF"
              />
            </View>
            <View style={styles.capsuleTextWrap}>
              <Text style={styles.capsuleLabel}>Stock Alerts</Text>
              <Text style={styles.capsuleValue}>
                {lowStockCount === 0 ? 'All Healthy' : `${lowStockCount} Low Stock`}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Export Feedback Banner */}
      {exportFeedback ? (
        <View style={styles.feedbackBanner}>
          <MaterialCommunityIcons name="check-circle" size={18} color="#0B6B38" />
          <Text style={styles.feedbackText}>{exportFeedback}</Text>
        </View>
      ) : null}

      {/* Single Item Creation Form */}
      {showForm && canWrite ? (
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>New item</Text>
          <Field
            label="SKU"
            value={sku}
            onChangeText={setSku}
            placeholder="BOLT-M8-30"
            autoCapitalize="characters"
            error={fieldErrors.sku}
          />
          <Field
            label="Item name"
            value={name}
            onChangeText={setName}
            placeholder="M8 hex bolt, 30 mm"
            autoCapitalize="words"
            error={fieldErrors.name}
          />
          <Field
            label="Category (optional)"
            value={category}
            onChangeText={setCategory}
            placeholder="Fasteners, Electrical, etc."
            autoCapitalize="words"
          />

          {/* Barcode Field with Camera Scanner Trigger */}
          <View style={styles.barcodeFieldRow}>
            <View style={{ flex: 1 }}>
              <Field
                label="Barcode (optional)"
                value={barcode}
                onChangeText={setBarcode}
                placeholder="Scannable supplier or product barcode"
                autoCapitalize="none"
                error={fieldErrors.barcode}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Scan barcode with camera"
              onPress={() => void openScanner('form')}
              style={({ pressed }) => [styles.fieldScanButton, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons name="camera-outline" size={20} color={colors.navy} />
              <Text style={styles.fieldScanButtonText}>Scan</Text>
            </Pressable>
          </View>

          <SelectField
            label="Tracking"
            value={trackingMode}
            options={[
              { value: 'none', label: 'Not tracked', detail: 'Counted as a single stock pool' },
              { value: 'lot', label: 'Lot / batch', detail: 'Track lot numbers and expiry' },
              { value: 'serial', label: 'Serial number', detail: 'One recorded unit per serial' },
            ]}
            onChange={(value) =>
              setTrackingMode(value === 'lot' || value === 'serial' ? value : 'none')
            }
          />
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: expiryTracked }}
            onPress={() => setExpiryTracked((value) => !value)}
            style={styles.toggleRow}
          >
            <MaterialCommunityIcons
              name={expiryTracked ? 'checkbox-marked' : 'checkbox-blank-outline'}
              size={23}
              color={expiryTracked ? colors.primary : colors.muted}
            />
            <Text style={styles.toggleLabel}>Require expiry date when receiving</Text>
          </Pressable>
          <Field
            label="Base unit"
            value={uom}
            onChangeText={setUom}
            placeholder="EA"
            autoCapitalize="characters"
            error={fieldErrors.base_uom}
          />
          <Field
            label="Reorder point (optional)"
            value={reorderPoint}
            onChangeText={setReorderPoint}
            placeholder="10"
            keyboardType="decimal-pad"
            error={fieldErrors.reorder_point}
          />
          <Text style={styles.formHint}>
            Belongs to {activeClient?.name ?? 'the internal inventory client'}. The
            dashboard flags this item when available stock reaches this level.
          </Text>
          {error ? (
            <View style={styles.errorBox}>
              <MaterialCommunityIcons
                name="alert-circle-outline"
                size={18}
                color={colors.danger}
              />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          <Button label="Create item" onPress={() => void createItem()} loading={saving} />
        </View>
      ) : null}

      {/* Search Box with Barcode Camera Scan */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <MaterialCommunityIcons name="magnify" size={21} color={colors.muted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search SKU, name, barcode, category..."
            placeholderTextColor={colors.muted}
            style={styles.searchInput}
            autoCapitalize="none"
          />
          {search ? (
            <Pressable onPress={() => setSearch('')} accessibilityLabel="Clear search">
              <MaterialCommunityIcons name="close-circle" size={19} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>

        {/* Live Camera Scanner Button */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scan barcode with camera"
          onPress={() => void openScanner('search')}
          style={({ pressed }) => [styles.scanTriggerButton, pressed && styles.pressed]}
        >
          <MaterialCommunityIcons
            name="camera-outline"
            size={20}
            color={colors.white}
          />
          <Text style={styles.scanTriggerText}>Scan</Text>
        </Pressable>

        {/* Keyboard Input Trigger */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Type barcode or SKU"
          onPress={() => setShowScanInput((v) => !v)}
          style={[styles.scanQuickTrigger, showScanInput && styles.scanQuickTriggerActive]}
        >
          <MaterialCommunityIcons
            name="keyboard-outline"
            size={20}
            color={showScanInput ? colors.white : colors.navy}
          />
        </Pressable>
      </View>

      {/* Barcode Quick Input / Scanner Bar */}
      {showScanInput ? (
        <View style={styles.scanQuickBar}>
          <MaterialCommunityIcons name="barcode" size={22} color={colors.primary} />
          <TextInput
            value={scanCode}
            onChangeText={setScanCode}
            placeholder="Scan or type barcode / SKU..."
            placeholderTextColor={colors.muted}
            style={styles.scanQuickInput}
            autoCapitalize="characters"
            onSubmitEditing={handleBarcodeLookup}
            returnKeyType="search"
            autoFocus
          />
          <Button label="Find / Add" variant="primary" onPress={handleBarcodeLookup} />
        </View>
      ) : null}

      {/* Filter Chips: Categories */}
      <View style={styles.filterSection}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsScroll}
        >
          <Pressable
            onPress={() => setSelectedCategory('all')}
            style={[styles.filterChip, selectedCategory === 'all' && styles.filterChipActive]}
          >
            <Text style={[styles.filterChipText, selectedCategory === 'all' && styles.filterChipTextActive]}>
              All Categories
            </Text>
          </Pressable>
          {categories.map((cat) => (
            <Pressable
              key={cat}
              onPress={() => setSelectedCategory(cat)}
              style={[styles.filterChip, selectedCategory === cat && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, selectedCategory === cat && styles.filterChipTextActive]}>
                {cat}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Filter Chips: Tracking & Health with Real Live Counts */}
      <View style={styles.filterSection}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsScroll}
        >
          {/* Tracking Modes */}
          <Pressable
            onPress={() => setSelectedTracking('all')}
            style={[styles.subFilterChip, selectedTracking === 'all' && styles.subFilterChipActive]}
          >
            <Text style={[styles.subFilterChipText, selectedTracking === 'all' && styles.subFilterChipTextActive]}>
              All ({trackingCounts.all})
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setSelectedTracking('lot')}
            style={[styles.subFilterChip, selectedTracking === 'lot' && styles.subFilterChipActive]}
          >
            <Text style={[styles.subFilterChipText, selectedTracking === 'lot' && styles.subFilterChipTextActive]}>
              Lot-tracked ({trackingCounts.lot})
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setSelectedTracking('serial')}
            style={[styles.subFilterChip, selectedTracking === 'serial' && styles.subFilterChipActive]}
          >
            <Text style={[styles.subFilterChipText, selectedTracking === 'serial' && styles.subFilterChipTextActive]}>
              Serial-tracked ({trackingCounts.serial})
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setSelectedTracking('none')}
            style={[styles.subFilterChip, selectedTracking === 'none' && styles.subFilterChipActive]}
          >
            <Text style={[styles.subFilterChipText, selectedTracking === 'none' && styles.subFilterChipTextActive]}>
              Standard ({trackingCounts.standard})
            </Text>
          </Pressable>

          {/* Health & Status */}
          <Pressable
            onPress={() => setSelectedHealth((h) => (h === 'low_stock' ? 'all' : 'low_stock'))}
            style={[styles.subFilterChip, selectedHealth === 'low_stock' && styles.subFilterChipDanger]}
          >
            <MaterialCommunityIcons
              name="alert-octagon-outline"
              size={13}
              color={selectedHealth === 'low_stock' ? colors.white : colors.danger}
            />
            <Text
              style={[
                styles.subFilterChipText,
                selectedHealth === 'low_stock' && styles.subFilterChipTextActive,
                selectedHealth !== 'low_stock' && { color: colors.danger },
              ]}
            >
              Low Stock Alert ({lowStockCount})
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setSelectedHealth((h) => (h === 'archived' ? 'all' : 'archived'))}
            style={[styles.subFilterChip, selectedHealth === 'archived' && styles.subFilterChipActive]}
          >
            <Text style={[styles.subFilterChipText, selectedHealth === 'archived' && styles.subFilterChipTextActive]}>
              Archived
            </Text>
          </Pressable>
        </ScrollView>
      </View>

      {/* Filter Chips: Suppliers */}
      {suppliers.length > 0 ? (
        <View style={styles.filterSection}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsScroll}
          >
            <Pressable
              onPress={() => setSelectedSupplierId('all')}
              style={[
                styles.filterChip,
                selectedSupplierId === 'all' && styles.filterChipActive,
              ]}
            >
              <Text
                style={[
                  styles.filterChipText,
                  selectedSupplierId === 'all' && styles.filterChipTextActive,
                ]}
              >
                All suppliers
              </Text>
            </Pressable>
            {suppliers.map((supplier) => {
              const active = selectedSupplierId === supplier.id;
              return (
                <Pressable
                  key={supplier.id}
                  onPress={() => setSelectedSupplierId(supplier.id)}
                  style={[
                    styles.filterChip,
                    styles.supplierFilterChip,
                    active && styles.filterChipActive,
                  ]}
                >
                  <MaterialCommunityIcons
                    name="truck-delivery-outline"
                    size={13}
                    color={active ? colors.white : colors.deep}
                  />
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.filterChipText,
                      active && styles.filterChipTextActive,
                    ]}
                  >
                    {supplier.display_name || supplier.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {supplierFilterLoading ? (
            <Text style={styles.supplierFilterHint}>Filtering by supplier…</Text>
          ) : supplierFilterError ? (
            <Text style={styles.supplierFilterError}>{supplierFilterError}</Text>
          ) : null}
        </View>
      ) : null}

      {/* Item Count Indicator */}
      <View style={styles.countRow}>
        <Text style={styles.count}>
          Showing {filtered.length} of {items.length} {items.length === 1 ? 'product' : 'products'}
        </Text>
        {(selectedCategory !== 'all' ||
          selectedTracking !== 'all' ||
          selectedHealth !== 'all' ||
          selectedSupplierId !== 'all' ||
          search) ? (
          <Pressable
            onPress={() => {
              setSearch('');
              setSelectedCategory('all');
              setSelectedTracking('all');
              setSelectedHealth('all');
              setSelectedSupplierId('all');
            }}
          >
            <Text style={styles.resetFiltersText}>Reset filters</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Empty State */}
      {filtered.length === 0 ? (
        <EmptyState
          icon="tag-multiple-outline"
          title={items.length === 0 ? 'Your catalogue is empty' : 'No matching products'}
          message={
            items.length === 0
              ? 'Import an Excel/CSV catalogue or add items to start managing warehouse stock.'
              : 'Try clearing search filters or checking spelling.'
          }
          actionLabel={
            items.length === 0 && canWrite ? 'Bulk Import Products' : undefined
          }
          onAction={
            items.length === 0 && canWrite
              ? () => {
                  setImportResult(null);
                  setShowImportModal(true);
                }
              : undefined
          }
        />
      ) : (
        /* Items List */
        <View style={styles.list}>
          {filtered.map((item) => {
            const onHand = stockByItem.get(item.id) ?? 0;
            const hasReorder = item.reorder_point !== null && item.reorder_point !== undefined;
            const reorderThreshold = hasReorder ? Number(item.reorder_point) : null;
            const isLowStock = reorderThreshold !== null && onHand <= reorderThreshold;

            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`Open ${item.name}`}
                onPress={() => onOpenItem(item.id)}
                style={({ pressed }) => [
                  styles.itemCard,
                  isLowStock && styles.itemCardLowStock,
                  pressed && styles.cardPressed,
                ]}
              >
                <View style={[styles.itemIcon, isLowStock && styles.itemIconLowStock]}>
                  <MaterialCommunityIcons
                    name={
                      item.tracking_mode === 'lot'
                        ? 'tag-outline'
                        : item.tracking_mode === 'serial'
                        ? 'barcode-scan'
                        : 'package-variant'
                    }
                    size={23}
                    color={isLowStock ? colors.danger : colors.navy}
                  />
                </View>

                <View style={styles.itemBody}>
                  <View style={styles.itemTitleRow}>
                    <Text style={styles.itemName} numberOfLines={2}>
                      {item.name}
                    </Text>
                    {isLowStock ? (
                      <Badge label="Low Stock" tone="danger" />
                    ) : (
                      <Badge
                        label={item.status}
                        tone={item.status === 'active' ? 'success' : 'neutral'}
                      />
                    )}
                  </View>

                  <View style={styles.skuRow}>
                    <Text style={styles.itemSku}>{item.sku}</Text>
                    {item.category ? (
                      <View style={styles.categoryBadge}>
                        <Text style={styles.categoryBadgeText}>{item.category}</Text>
                      </View>
                    ) : null}
                  </View>

                  <View style={styles.metaRow}>
                    <Text style={styles.meta}>UOM: {item.base_uom}</Text>
                    <Text style={styles.metaDot}>·</Text>
                    <Text style={styles.meta}>On Hand: {formatQty(String(onHand))}</Text>
                    {item.tracking_mode !== 'none' ? (
                      <>
                        <Text style={styles.metaDot}>·</Text>
                        <Text style={styles.metaTracking}>
                          {item.tracking_mode.toUpperCase()}
                        </Text>
                      </>
                    ) : null}
                  </View>

                  {hasReorder ? (
                    <View style={styles.reorderRow}>
                      <MaterialCommunityIcons
                        name="bell-outline"
                        size={13}
                        color={isLowStock ? colors.danger : colors.muted}
                      />
                      <Text
                        style={[
                          styles.reorderText,
                          isLowStock && { color: colors.danger, fontFamily: fonts.bodySemi },
                        ]}
                      >
                        Reorder threshold: {formatQty(String(item.reorder_point))} {item.base_uom}
                      </Text>
                    </View>
                  ) : null}

                  {(item.supplier_count ?? 0) > 0 ? (
                    <View style={styles.supplierBadgeRow}>
                      <MaterialCommunityIcons
                        name="truck-delivery-outline"
                        size={13}
                        color={colors.deep}
                      />
                      <Text style={styles.supplierBadgeText} numberOfLines={1}>
                        {item.preferred_supplier_name
                          ? `${item.preferred_supplier_name} · preferred`
                          : `${item.supplier_count} ${
                              item.supplier_count === 1 ? 'supplier' : 'suppliers'
                            }`}
                      </Text>
                    </View>
                  ) : null}
                </View>

                <MaterialCommunityIcons
                  name="chevron-right"
                  size={20}
                  color={colors.muted}
                />
              </Pressable>
            );
          })}
        </View>
      )}

      {/* BULK IMPORT MODAL */}
      <Modal
        visible={showImportModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowImportModal(false)}
      >
        <ScrollView style={styles.modalScreen} contentContainerStyle={styles.modalContent}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalEyebrow}>BULK INGESTION</Text>
              <Text style={styles.modalTitle}>Import Product Catalogue</Text>
            </View>
            <Pressable onPress={() => setShowImportModal(false)} style={styles.modalCloseButton}>
              <MaterialCommunityIcons name="close" size={24} color={colors.navy} />
            </Pressable>
          </View>

          {/* Mode Selector */}
          <View style={styles.importModeCard}>
            <Text style={styles.importSectionTitle}>Import Mode</Text>
            <View style={styles.modeToggleRow}>
              <Pressable
                onPress={() => setImportMode('upsert')}
                style={[styles.modeTogglePill, importMode === 'upsert' && styles.modeTogglePillActive]}
              >
                <Text style={[styles.modeToggleText, importMode === 'upsert' && styles.modeToggleTextActive]}>
                  Upsert (Update & Insert)
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setImportMode('create_only')}
                style={[styles.modeTogglePill, importMode === 'create_only' && styles.modeTogglePillActive]}
              >
                <Text style={[styles.modeToggleText, importMode === 'create_only' && styles.modeToggleTextActive]}>
                  Create Only (Skip existing)
                </Text>
              </Pressable>
            </View>
            <Text style={styles.modeExplanation}>
              {importMode === 'upsert'
                ? 'Adds brand new SKUs, and updates details (name, category, cost, reorder point) for existing SKUs.'
                : 'Only adds brand new SKUs. Existing SKUs in the catalogue are skipped.'}
            </Text>
          </View>

          {/* Ingestion Sources */}
          <View style={styles.importSectionCard}>
            <Text style={styles.importSectionTitle}>Select or Load Product Data</Text>

            <View style={styles.importButtonsRow}>
              <Button
                label="Pick CSV or Excel (.xlsx) File"
                variant="primary"
                onPress={handlePickDocument}
              />
              <Button
                label="Load 100+ Sample Products"
                variant="secondary"
                onPress={handleLoadSample}
              />
            </View>

            {/* Selected File Badge */}
            {pickedFileName ? (
              <View style={styles.pickedFileBadge}>
                <MaterialCommunityIcons
                  name={
                    pickedFileName.toLowerCase().endsWith('.xlsx') ||
                    pickedFileName.toLowerCase().endsWith('.xls')
                      ? 'file-excel-box'
                      : 'file-delimited'
                  }
                  size={24}
                  color={
                    pickedFileName.toLowerCase().endsWith('.xlsx') ||
                    pickedFileName.toLowerCase().endsWith('.xls')
                      ? '#107C41'
                      : colors.primary
                  }
                />
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={styles.pickedFileName} numberOfLines={1}>
                    {pickedFileName}
                  </Text>
                  <Text style={styles.pickedFileMeta}>
                    {pickedFileName.toLowerCase().endsWith('.xlsx') ||
                    pickedFileName.toLowerCase().endsWith('.xls')
                      ? 'Excel workbook ready for import'
                      : `${csvLineCount} product lines detected`}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove selected file"
                  onPress={() => {
                    setPickedFileName(null);
                    setPickedFileBase64(null);
                    setCsvText('');
                  }}
                  style={styles.pickedFileRemove}
                >
                  <MaterialCommunityIcons name="close-circle" size={20} color={colors.muted} />
                </Pressable>
              </View>
            ) : null}

            <Pressable onPress={handleCopyTemplate} style={styles.templateLinkRow}>
              <MaterialCommunityIcons name="content-copy" size={16} color={colors.primary} />
              <Text style={styles.templateLinkText}>Copy sample CSV headers & template</Text>
            </Pressable>

            {/* CSV Editor / Preview */}
            <Text style={styles.csvInputLabel}>
              CSV Data ({csvLineCount > 0 ? `${csvLineCount} items detected` : 'No text pasted'})
            </Text>
            <TextInput
              value={csvText}
              onChangeText={(text) => {
                setCsvText(text);
                setImportResult(null);
                setImportError(null);
              }}
              placeholder="Paste comma-separated CSV rows here, or tap 'Pick CSV or Excel' above..."
              placeholderTextColor={colors.muted}
              multiline
              numberOfLines={8}
              style={styles.csvTextInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {/* Import Error Message */}
          {importError ? (
            <View style={styles.errorBox}>
              <MaterialCommunityIcons name="alert-circle-outline" size={20} color={colors.danger} />
              <Text style={styles.errorText}>{importError}</Text>
            </View>
          ) : null}

          {/* Import Result Summary */}
          {importResult ? (
            <View style={styles.resultCard}>
              <View style={styles.resultHeader}>
                <MaterialCommunityIcons name="check-decagram" size={24} color="#0B6B38" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.resultTitle}>Import Completed</Text>
                  <Text style={styles.resultSubtitle}>
                    Mode: {importMode === 'upsert' ? 'Upsert (Update & Create)' : 'Create Only (Preserve Existing)'}
                  </Text>
                </View>
              </View>

              <View style={styles.resultMetricsRow}>
                <View style={styles.resultMetricPill}>
                  <Text style={styles.resultMetricVal}>{importResult.created_count}</Text>
                  <Text style={styles.resultMetricLabel}>Created</Text>
                </View>
                <View style={styles.resultMetricPill}>
                  <Text style={styles.resultMetricVal}>{importResult.updated_count}</Text>
                  <Text style={styles.resultMetricLabel}>Updated</Text>
                </View>
                <View style={styles.resultMetricPill}>
                  <Text style={styles.resultMetricVal}>{importResult.skipped_count}</Text>
                  <Text style={styles.resultMetricLabel}>Skipped</Text>
                </View>
                <View style={styles.resultMetricPill}>
                  <Text style={[styles.resultMetricVal, importResult.error_count > 0 && { color: colors.danger }]}>
                    {importResult.error_count}
                  </Text>
                  <Text style={styles.resultMetricLabel}>Errors</Text>
                </View>
              </View>

              {/* Informational notices */}
              {importResult.skipped_count > 0 && importMode === 'create_only' ? (
                <View style={styles.skippedNotice}>
                  <MaterialCommunityIcons name="information-outline" size={16} color="#0B6B38" />
                  <Text style={styles.skippedNoticeText}>
                    {importResult.skipped_count} existing {importResult.skipped_count === 1 ? 'product was' : 'products were'} preserved without overwrite (Create-only mode).
                  </Text>
                </View>
              ) : null}

              {importResult.updated_count > 0 && importMode === 'upsert' ? (
                <View style={styles.updatedNotice}>
                  <MaterialCommunityIcons name="sync" size={16} color="#0369A1" />
                  <Text style={styles.updatedNoticeText}>
                    {importResult.updated_count} existing {importResult.updated_count === 1 ? 'product was' : 'products were'} updated with latest information (Upsert mode).
                  </Text>
                </View>
              ) : null}

              {importResult.errors.length > 0 ? (
                <View style={styles.resultErrorsList}>
                  <Text style={styles.resultErrorsTitle}>Line-by-line issues:</Text>
                  {importResult.errors.slice(0, 10).map((e, idx) => (
                    <Text key={idx} style={styles.resultErrorLine}>
                      Row {e.row} {e.sku ? `[${e.sku}]` : ''}: {e.message}
                    </Text>
                  ))}
                  {importResult.errors.length > 10 ? (
                    <Text style={styles.resultErrorLineMuted}>
                      ... and {importResult.errors.length - 10} more rows
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Commit Button */}
          <Button
            label={
              importing
                ? 'Ingesting catalogue...'
                : pickedFileName
                ? `Import ${pickedFileName} Now`
                : csvLineCount > 0
                ? `Import ${csvLineCount} Products Now`
                : 'Import Products'
            }
            onPress={handleExecuteImport}
            loading={importing}
            disabled={importing || (!pickedFileBase64 && csvLineCount === 0)}
          />
        </ScrollView>
      </Modal>

      {/* FULL CAMERA SCANNER MODAL */}
      <Modal
        visible={cameraActive}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setCameraActive(false)}
      >
        <View style={styles.cameraModalContainer}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            enableTorch={cameraTorch}
            barcodeScannerSettings={{
              barcodeTypes: ['qr', 'ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e', 'itf14'],
            }}
            onBarcodeScanned={handleBarcodeScanned}
          />
          <View style={styles.cameraOverlay}>
            <View style={styles.cameraTopBar}>
              <Text style={styles.cameraTitle}>
                {scanContext === 'form' ? 'Scan Barcode for New Item' : 'Scan Product Barcode / SKU'}
              </Text>
              <View style={styles.cameraTopActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Toggle flashlight"
                  onPress={() => setCameraTorch((t) => !t)}
                  style={styles.cameraIconButton}
                >
                  <MaterialCommunityIcons
                    name={cameraTorch ? 'flashlight' : 'flashlight-off'}
                    size={24}
                    color={colors.white}
                  />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close camera"
                  onPress={() => setCameraActive(false)}
                  style={styles.cameraIconButton}
                >
                  <MaterialCommunityIcons name="close" size={26} color={colors.white} />
                </Pressable>
              </View>
            </View>

            <View style={styles.cameraTargetFrame}>
              <View style={[styles.cornerBox, styles.cornerTL]} />
              <View style={[styles.cornerBox, styles.cornerTR]} />
              <View style={[styles.cornerBox, styles.cornerBL]} />
              <View style={[styles.cornerBox, styles.cornerBR]} />
            </View>

            <View style={styles.cameraBottomBar}>
              <Text style={styles.cameraHint}>
                Align barcode or QR code inside the frame to scan automatically
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel scan"
                onPress={() => setCameraActive(false)}
                style={styles.cameraCancelButton}
              >
                <Text style={styles.cameraCancelText}>Cancel</Text>
              </Pressable>
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  iconAction: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FCFDFE',
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
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
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
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.82,
  },
  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#E6F8EE',
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#A1E5BF',
  },
  feedbackText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: '#0B6B38',
    flex: 1,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderTopColor: '#FFFFFF',
    borderBottomColor: 'rgba(215, 225, 238, 0.75)',
    backgroundColor: '#FCFDFE',
    paddingHorizontal: 14,
    minHeight: 46,
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 14,
    color: '#192338',
    paddingVertical: 8,
  },
  scanTriggerButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#192338',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  scanTriggerButtonActive: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  scanQuickBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#EDF3FF',
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  scanQuickInput: {
    flex: 1,
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    backgroundColor: colors.white,
    borderRadius: radius.sm,
  },
  filterSection: {
    marginHorizontal: -spacing.lg,
  },
  chipsScroll: {
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
  },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.62)',
    borderWidth: 1,
    borderColor: palette.glassBorder,
  },
  filterChipActive: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  filterChipText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.text,
  },
  filterChipTextActive: {
    color: colors.white,
  },
  supplierFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: 190,
  },
  supplierFilterHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
  },
  supplierFilterError: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.danger,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
  },
  subFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: '#F3F6FA',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  subFilterChipActive: {
    backgroundColor: '#1E3A8A',
    borderColor: '#1E3A8A',
  },
  subFilterChipDanger: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
  subFilterChipText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.text,
  },
  subFilterChipTextActive: {
    color: colors.white,
    fontFamily: fonts.bodySemi,
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    marginTop: spacing.xs,
  },
  count: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.muted,
  },
  resetFiltersText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.primary,
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
  formHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 17,
    color: colors.muted,
    marginTop: -spacing.sm,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  toggleLabel: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.text,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#F8B4B4',
  },
  errorText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.danger,
  },
  list: {
    gap: spacing.sm,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#FCFDFE',
    borderRadius: 20,
    padding: 15,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderTopColor: '#FFFFFF',
    borderBottomColor: 'rgba(215, 225, 238, 0.75)',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.07,
    shadowRadius: 16,
    elevation: 4,
  },
  itemCardLowStock: {
    borderColor: 'rgba(239, 68, 68, 0.35)',
    backgroundColor: '#FFFDFD',
  },
  cardPressed: {
    opacity: 0.84,
  },
  itemIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: '#EDF3FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemIconLowStock: {
    backgroundColor: '#FED7D7',
  },
  itemBody: {
    flex: 1,
    gap: 2,
  },
  itemTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  itemName: {
    flex: 1,
    fontFamily: fonts.headingSemi,
    fontSize: 15,
    color: colors.navy,
  },
  skuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 1,
  },
  itemSku: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.deep,
    letterSpacing: 0.4,
  },
  categoryBadge: {
    backgroundColor: '#F1F5F9',
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  categoryBadgeText: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  supplierBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  supplierBadgeText: {
    flexShrink: 1,
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.deep,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 3,
  },
  meta: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  metaTracking: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    color: colors.primary,
  },
  metaDot: {
    color: colors.border,
  },
  reorderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  reorderText: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  // Modal styles
  modalScreen: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  modalContent: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  modalEyebrow: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.deep,
  },
  modalTitle: {
    fontFamily: fonts.heading,
    fontSize: 22,
    color: colors.navy,
  },
  modalCloseButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: '#EDF3FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  importModeCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  importSectionTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 14,
    color: colors.navy,
  },
  modeToggleRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  modeTogglePill: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  modeTogglePillActive: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  modeToggleText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.text,
    textAlign: 'center',
  },
  modeToggleTextActive: {
    color: colors.white,
  },
  modeExplanation: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.muted,
  },
  importSectionCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  importButtonsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  templateLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  templateLinkText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.primary,
  },
  csvInputLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
    marginTop: spacing.xs,
  },
  csvTextInput: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.text,
    textAlignVertical: 'top',
    minHeight: 130,
  },
  resultCard: {
    backgroundColor: '#F0FDF4',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    padding: spacing.md,
    gap: spacing.sm,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  resultTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 16,
    color: '#0B6B38',
  },
  resultMetricsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  resultMetricPill: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#DCFCE7',
  },
  resultMetricVal: {
    fontFamily: fonts.heading,
    fontSize: 18,
    color: '#0B6B38',
  },
  resultMetricLabel: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  resultErrorsList: {
    marginTop: spacing.xs,
    padding: spacing.sm,
    backgroundColor: '#FEF2F2',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#FECACA',
    gap: 2,
  },
  resultErrorsTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.danger,
    marginBottom: 2,
  },
  resultErrorLine: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.danger,
  },
  resultErrorLineMuted: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
    fontStyle: 'italic',
  },
  resultSubtitle: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#166534',
    marginTop: 1,
  },
  barcodeFieldRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  fieldScanButton: {
    marginTop: 22,
    height: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: '#EDF3FF',
    borderWidth: 1,
    borderColor: '#C7D9FB',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fieldScanButtonText: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
  },
  scanTriggerText: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.white,
  },
  scanQuickTrigger: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanQuickTriggerActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  pickedFileBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: radius.md,
  },
  pickedFileName: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
  },
  pickedFileMeta: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#166534',
    marginTop: 1,
  },
  pickedFileRemove: {
    padding: 4,
  },
  skippedNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: '#DCFCE7',
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  skippedNoticeText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#166534',
  },
  updatedNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: '#E0F2FE',
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  updatedNoticeText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#0369A1',
  },
  cameraModalContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  cameraOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: 54,
    paddingBottom: 40,
  },
  cameraTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cameraTitle: {
    flex: 1,
    fontFamily: fonts.headingSemi,
    fontSize: 16,
    color: colors.white,
  },
  cameraTopActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cameraIconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraTargetFrame: {
    alignSelf: 'center',
    width: 260,
    height: 260,
    position: 'relative',
  },
  cornerBox: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderColor: '#38BDF8',
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
  },
  cameraBottomBar: {
    alignItems: 'center',
    gap: spacing.md,
  },
  cameraHint: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
  },
  cameraCancelButton: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: radius.pill,
  },
  cameraCancelText: {
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.white,
  },
});
