import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError } from '../api';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { SelectField } from '../components/SelectField';
import { useWorkspace } from '../data';
import { formatDate, formatQty, humanize } from '../format';
import type { ScanResolveResult } from '../types';
import { colors, fonts, neo, palette, radius, spacing } from '../theme';

const barcodeTypes = [
  'qr',
  'ean13',
  'ean8',
  'upc_a',
  'upc_e',
  'code128',
  'code39',
  'code93',
  'itf14',
  'codabar',
] as const;

function resultIcon(type: ScanResolveResult['type']) {
  switch (type) {
    case 'location':
      return 'map-marker-outline' as const;
    case 'lot':
      return 'tag-outline' as const;
    case 'serial':
      return 'barcode' as const;
    default:
      return 'package-variant' as const;
  }
}

function resultTitle(result: ScanResolveResult): string {
  if (result.type === 'location') {
    return result.location?.path ?? result.location?.code ?? result.code;
  }
  if (result.type === 'lot') {
    return result.lot?.lot_no ?? result.code;
  }
  if (result.type === 'serial') {
    return result.serial?.serial_no ?? result.code;
  }
  return result.item?.name ?? result.code;
}

export function ScanScreen({ onOpenItem }: { onOpenItem: (itemId: string) => void }) {
  const insets = useSafeAreaInsets();
  const {
    activeClient,
    activeClientId,
    inventoryOwners,
    internalClient,
    isMultiOwner,
    setActiveClientId,
    warehouses,
    locations,
    balances,
    pendingSyncCount,
  } = useWorkspace();
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraActive, setCameraActive] = useState(false);
  const [code, setCode] = useState('');
  const [result, setResult] = useState<ScanResolveResult | null>(null);
  const [history, setHistory] = useState<ScanResolveResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const processing = useRef(false);

  const resolve = useCallback(
    async (rawCode: string) => {
      const value = rawCode.trim();
      if (!value || processing.current) {
        return;
      }
      processing.current = true;
      setSearching(true);
      setError(null);
      setResult(null);
      try {
        const resolved = await api.scanResolve(value, activeClientId);
        setResult(resolved);
        setHistory((current) => [
          resolved,
          ...current.filter((entry) => entry.code !== resolved.code),
        ].slice(0, 5));
        setCode(value);
        setCameraActive(false);
      } catch (caught) {
        setError(
          caught instanceof ApiError
            ? caught.message
            : 'The scan could not be resolved. Check the code and connection.',
        );
      } finally {
        processing.current = false;
        setSearching(false);
      }
    },
    [activeClientId],
  );

  const handleBarcode = useCallback(
    (scan: BarcodeScanningResult) => {
      void resolve(scan.data);
    },
    [resolve],
  );

  const startCamera = async () => {
    setError(null);
    if (!permission?.granted) {
      const next = await requestPermission();
      if (!next.granted) {
        setError('Camera permission is required. Use the code field below instead.');
        return;
      }
    }
    setResult(null);
    setCameraActive(true);
  };

  const reset = () => {
    setResult(null);
    setError(null);
    setCode('');
    setCameraActive(false);
  };

  const chooseClient = (value: string) => {
    setActiveClientId(value);
    reset();
  };

  const location = result?.location ?? null;
  const warehouse = location
    ? warehouses.find((entry) => entry.id === location.warehouse_id)
    : null;
  const locationStock = location
    ? balances.filter((balance) => balance.location_id === location.id)
    : [];
  const locationUnits = locationStock.reduce(
    (total, balance) => total + Number(balance.on_hand || 0),
    0,
  );
  const item = result?.item ?? null;
  const itemLocations = item
    ? locations.filter((entry) =>
        balances.some(
          (balance) => balance.item_id === item.id && balance.location_id === entry.id,
        ),
      )
    : [];

  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top + 12, 22) }]}>
      {/* Brand Header */}
      <View style={styles.brandRow}>
        <Image
          source={require('../../assets/ntan-hexagon-logo.png')}
          style={styles.logoImage}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
        <View style={styles.greetingBox}>
          <Text style={styles.greetingTitle}>Scan Centre</Text>
          <Text style={styles.greetingSubtitle} numberOfLines={1}>
            {activeClient
              ? `${activeClient.name} · ${activeClient.code}`
              : isMultiOwner
                ? 'All visible inventory owners'
                : (internalClient?.name ?? 'Internal stock')}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >

      {isMultiOwner ? (
        <SelectField
          label="Scan within owner"
          value={activeClientId}
          onChange={chooseClient}
          options={inventoryOwners.map((owner) => ({
            value: owner.id,
            label: owner.name,
            detail: owner.is_internal ? 'Internal stock' : owner.code,
          }))}
          placeholder="All visible owners"
        />
      ) : null}

      <View style={styles.scannerFrame}>
        {cameraActive && permission?.granted ? (
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: [...barcodeTypes] }}
            onBarcodeScanned={searching ? undefined : handleBarcode}
          />
        ) : (
          <View style={styles.scannerIdle}>
            <View style={styles.scanIcon}>
              <MaterialCommunityIcons
                name={result ? resultIcon(result.type) : 'line-scan'}
                size={39}
                color={colors.accent}
              />
            </View>
            <Text style={styles.frameTitle}>
              {result ? 'Code resolved' : 'Ready to scan'}
            </Text>
            <Text style={styles.frameText}>
              {result
                ? 'Review the record below.'
                : 'Point at a barcode or enter a code.'}
            </Text>
            {!result ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Start camera"
                onPress={() => void startCamera()}
                style={({ pressed }) => [styles.cameraButton, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons name="camera-outline" size={19} color={colors.navy} />
                <Text style={styles.cameraButtonText}>Start camera</Text>
              </Pressable>
            ) : null}
          </View>
        )}
        <View style={styles.cornerTopLeft} />
        <View style={styles.cornerTopRight} />
        <View style={styles.cornerBottomLeft} />
        <View style={styles.cornerBottomRight} />
        {cameraActive ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop camera"
            onPress={() => setCameraActive(false)}
            style={({ pressed }) => [styles.stopCamera, pressed && styles.pressed]}
          >
            <MaterialCommunityIcons name="close" size={19} color={colors.white} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.card}>
        <Field
          label="Code or SKU"
          value={code}
          onChangeText={setCode}
          placeholder="Scan or type a barcode"
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => void resolve(code)}
        />
        <View style={styles.actions}>
          <Button
            label="Find code"
            onPress={() => void resolve(code)}
            loading={searching}
            disabled={!code.trim()}
            style={styles.action}
          />
          <Button
            label="Clear"
            variant="secondary"
            onPress={reset}
            disabled={!code && !result}
            style={styles.action}
          />
        </View>
        {error ? (
          <View style={styles.errorBox}>
            <MaterialCommunityIcons name="alert-circle-outline" size={19} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
      </View>

      {result ? (
        <View style={styles.resultCard}>
          <View style={styles.resultHeader}>
            <View style={styles.resultIcon}>
              <MaterialCommunityIcons
                name={resultIcon(result.type)}
                size={24}
                color={colors.deep}
              />
            </View>
            <View style={styles.resultHeading}>
              <Text style={styles.resultType}>{humanize(result.type)}</Text>
              <Text style={styles.resultTitle}>{resultTitle(result)}</Text>
            </View>
            <Badge label="Match" tone="success" />
          </View>

          {result.type === 'item' && item ? (
            <>
              <View style={styles.facts}>
                <Fact label="Scanned code" value={result.code} />
                <Fact label="SKU" value={item.sku} />
                <Fact label="Barcode" value={item.barcode ?? 'Not set'} />
                <Fact
                  label="On hand"
                  value={`${formatQty(String(itemUnits(balances, item.id)))} ${item.base_uom}`}
                />
                <Fact
                  label="Tracking"
                  value={
                    item.tracking_mode === 'none'
                      ? 'Not tracked'
                      : `${humanize(item.tracking_mode)}${item.expiry_tracked ? ' + expiry' : ''}`
                  }
                />
                <Fact
                  label="Locations"
                  value={
                    itemLocations.length === 0
                      ? 'No stock location'
                      : itemLocations.map((entry) => entry.code).join(', ')
                  }
                />
              </View>
              <Button label="Open item" onPress={() => onOpenItem(item.id)} />
            </>
          ) : null}

          {result.type === 'location' && location ? (
            <>
              <View style={styles.facts}>
                <Fact label="Code" value={location.code} />
                <Fact label="Path" value={location.path ?? location.code} />
                <Fact label="Type" value={humanize(location.type)} />
                <Fact label="Warehouse" value={warehouse?.name ?? 'Unknown warehouse'} />
                <Fact label="Pickable" value={location.is_pickable ? 'Yes' : 'No'} />
                <Fact
                  label="Stock keys"
                  value={`${locationStock.length}  -  ${formatQty(String(locationUnits))} units`}
                />
              </View>
              {item ? <Button label="Open item" onPress={() => onOpenItem(item.id)} /> : null}
            </>
          ) : null}

          {result.type === 'lot' && result.lot ? (
            <>
              <View style={styles.facts}>
                <Fact label="Lot" value={result.lot.lot_no} />
                <Fact
                  label="Item"
                  value={result.lot.item_name ?? result.lot.sku ?? 'Unknown item'}
                />
                <Fact
                  label="Expiry"
                  value={
                    result.lot.expiry_date
                      ? formatDate(result.lot.expiry_date)
                      : 'Not set'
                  }
                />
                <Fact label="Status" value={humanize(result.lot.status)} />
              </View>
              {item ? <Button label="Open item" onPress={() => onOpenItem(item.id)} /> : null}
            </>
          ) : null}

          {result.type === 'serial' && result.serial ? (
            <>
              <View style={styles.facts}>
                <Fact label="Serial" value={result.serial.serial_no} />
                <Fact
                  label="Item"
                  value={result.serial.item_name ?? result.serial.sku ?? 'Unknown item'}
                />
                <Fact label="Lot" value={result.serial.lot_no ?? 'Not linked'} />
                <Fact label="Status" value={humanize(result.serial.status)} />
              </View>
              {item ? <Button label="Open item" onPress={() => onOpenItem(item.id)} /> : null}
            </>
          ) : null}

          <Button label="Scan next" variant="secondary" onPress={reset} />
        </View>
      ) : null}

      {searching ? (
        <View style={styles.searching}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.searchingText}>Resolving code...</Text>
        </View>
      ) : null}

      {history.length > 0 ? (
        <View style={styles.historyCard}>
          <Text style={styles.historyTitle}>Recent scans</Text>
          {history.map((entry) => (
            <Pressable
              key={`${entry.type}-${entry.code}`}
              accessibilityRole="button"
              accessibilityLabel={`Scan again ${entry.code}`}
              onPress={() => void resolve(entry.code)}
              style={({ pressed }) => [styles.historyRow, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons
                name={resultIcon(entry.type)}
                size={17}
                color={colors.deep}
              />
              <View style={styles.historyBody}>
                <Text style={styles.historyCode}>{resultTitle(entry)}</Text>
                <Text style={styles.historyMeta}>
                  {humanize(entry.type)}  -  {entry.code}
                </Text>
              </View>
              <MaterialCommunityIcons name="refresh" size={17} color={colors.muted} />
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.noteCard}>
        <MaterialCommunityIcons name="database-arrow-down-outline" size={20} color={colors.deep} />
        <Text style={styles.noteText}>
          Scan results use live server data for the selected client and your location
          access. {pendingSyncCount > 0 ? `${pendingSyncCount} queued operation(s) still need sync.` : 'Nothing is queued offline.'}
        </Text>
      </View>
      </ScrollView>
    </View>
  );
}

function itemUnits(
  balances: Array<{ item_id: string; on_hand: string }>,
  itemId: string,
): number {
  return balances
    .filter((balance) => balance.item_id === itemId)
    .reduce((total, balance) => total + Number(balance.on_hand || 0), 0);
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
  screen: {
    flex: 1,
    backgroundColor: '#EFF3F8',
  },
  content: {
    paddingHorizontal: 16,
    gap: 14,
    paddingBottom: 24,
  },
  scannerFrame: {
    minHeight: 255,
    backgroundColor: palette.ink,
    borderRadius: radius.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
    overflow: 'hidden',
    borderWidth: 1.2,
    borderColor: 'rgba(255,255,255,0.16)',
    ...neo.raised,
  },
  camera: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  scannerIdle: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  scanIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameTitle: {
    fontFamily: fonts.outfitBold,
    fontSize: 17,
    color: colors.white,
    textAlign: 'center',
  },
  frameText: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 11.5,
    lineHeight: 17,
    color: 'rgba(255,255,255,0.56)',
    textAlign: 'center',
    maxWidth: 280,
  },
  cameraButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
    minHeight: 42,
    borderRadius: radius.pill,
    backgroundColor: palette.gold,
    paddingHorizontal: spacing.lg,
    borderTopWidth: 1.3,
    borderTopColor: 'rgba(255,255,255,0.6)',
  },
  cameraButtonText: {
    fontFamily: fonts.outfitBold,
    fontSize: 13,
    color: palette.ink,
  },
  stopCamera: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(31, 53, 72, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cornerTopLeft: {
    position: 'absolute',
    top: 22,
    left: 22,
    width: 32,
    height: 32,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderColor: colors.accent,
    borderTopLeftRadius: 7,
  },
  cornerTopRight: {
    position: 'absolute',
    top: 22,
    right: 22,
    width: 32,
    height: 32,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderColor: colors.accent,
    borderTopRightRadius: 7,
  },
  cornerBottomLeft: {
    position: 'absolute',
    bottom: 22,
    left: 22,
    width: 32,
    height: 32,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderColor: colors.accent,
    borderBottomLeftRadius: 7,
  },
  cornerBottomRight: {
    position: 'absolute',
    bottom: 22,
    right: 22,
    width: 32,
    height: 32,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderColor: colors.accent,
    borderBottomRightRadius: 7,
  },
  card: {
    backgroundColor: palette.glass,
    borderRadius: radius.xl,
    borderWidth: 1.1,
    borderColor: palette.glassBorder,
    padding: spacing.lg,
    gap: spacing.md,
    ...neo.raised,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  action: {
    flex: 1,
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
  resultCard: {
    backgroundColor: palette.glass,
    borderRadius: radius.xl,
    borderWidth: 1.1,
    borderColor: 'rgba(31,122,92,0.2)',
    padding: spacing.lg,
    gap: spacing.md,
    ...neo.soft,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  resultIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#EAF3FA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultHeading: {
    flex: 1,
    gap: 1,
  },
  resultType: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    letterSpacing: 1.2,
    color: colors.deep,
    textTransform: 'uppercase',
  },
  resultTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 18,
    color: colors.navy,
  },
  facts: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  fact: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  factLabel: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  factValue: {
    flex: 1,
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
    textAlign: 'right',
  },
  searching: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  searchingText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  historyCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  historyTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 15,
    color: colors.navy,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  historyBody: {
    flex: 1,
    gap: 1,
  },
  historyCode: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  historyMeta: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  pressed: {
    opacity: 0.75,
  },
  noteCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: '#EAF3FA',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  noteText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.deep,
  },
});
