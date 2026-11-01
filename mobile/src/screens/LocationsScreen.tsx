import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { Field } from '../components/Field';
import { SelectField } from '../components/SelectField';
import { useWorkspace } from '../data';
import { formatQty, humanize } from '../format';
import { colors, fonts, radius, spacing } from '../theme';
import type {
  Balance,
  BulkLocationPreviewItem,
  InitialLocationCreate,
  Location,
  WarehouseLayout,
  WarehouseTemplateLocationPreview,
  WarehouseType,
} from '../types';

// ============================================================================
// WAREHOUSE METADATA CONFIGURATION
// ============================================================================

export const WAREHOUSE_TYPES_META: ReadonlyArray<{
  readonly key: WarehouseType;
  readonly label: string;
  readonly tagline: string;
  readonly icon: keyof typeof MaterialCommunityIcons.glyphMap;
}> = [
  {
    key: 'general',
    label: 'General Warehouse',
    tagline: 'Standard commercial & general inventory storage facility',
    icon: 'home-city-outline',
  },
  {
    key: 'distribution',
    label: 'Distribution Centre',
    tagline: 'Regional hub for store & branch supply and replenishment',
    icon: 'truck-fast-outline',
  },
  {
    key: 'fulfilment',
    label: 'Fulfilment Centre',
    tagline: 'High-speed piece-picking & direct customer order dispatch',
    icon: 'package-variant-closed',
  },
  {
    key: 'bulk',
    label: 'Bulk Storage Warehouse',
    tagline: 'High-bay pallet racks, heavy raw goods & large volume storage',
    icon: 'warehouse',
  },
  {
    key: 'cold_storage',
    label: 'Cold Storage Warehouse',
    tagline: 'Temperature-controlled perishable foods & pharmaceutical storage',
    icon: 'snowflake',
  },
  {
    key: 'cross_dock',
    label: 'Cross-Dock / Transit Hub',
    tagline: 'Direct transshipment & sorting without long-term putaway storage',
    icon: 'swap-horizontal-bold',
  },
];

export const WAREHOUSE_LAYOUTS_META: ReadonlyArray<{
  readonly key: WarehouseLayout;
  readonly title: string;
  readonly subtitle: string;
  readonly tag: string;
  readonly icon: keyof typeof MaterialCommunityIcons.glyphMap;
  readonly starterLocations: ReadonlyArray<{
    readonly code: string;
    readonly type: string;
    readonly role: string;
    readonly isPickable: boolean;
  }>;
  readonly supportsCoordinates: boolean;
  readonly coordinateHelp: string;
}> = [
  {
    key: 'all_in_one',
    title: 'All-in-One Layout',
    subtitle: 'Unified open floor: receiving, storage, and picking happen in a shared space.',
    tag: 'Flat / SME',
    icon: 'vector-square',
    starterLocations: [
      {
        code: 'FLOOR',
        type: 'main',
        role: 'Unified floor storage & picking area (no internal putaway needed)',
        isPickable: true,
      },
    ],
    supportsCoordinates: false,
    coordinateHelp:
      'Flat / Open Floor Facility: Aisle, rack, and shelf coordinates are not used. Use clear zone or floor area codes (e.g. FLOOR, STAGING, BULK-AREA).',
  },
  {
    key: 'multi_zone',
    title: 'Multi-Zone Layout',
    subtitle: 'Divided into Inbound Dock, Main Storage Racks, Picking Bins, and Dispatch.',
    tag: 'Standard Logistics',
    icon: 'view-dashboard-outline',
    starterLocations: [
      {
        code: 'RECV',
        type: 'receiving',
        role: 'Inbound receiving dock for incoming supplier shipments',
        isPickable: false,
      },
      {
        code: 'MAIN',
        type: 'main',
        role: 'Primary storage racks and high-density reserve aisles',
        isPickable: false,
      },
      {
        code: 'BIN-01',
        type: 'bin',
        role: 'Active forward piece-picking bin under storage rack',
        isPickable: true,
      },
    ],
    supportsCoordinates: true,
    coordinateHelp:
      'Multi-Zone Rack Facility: Structure locations using Aisle, Rack, Shelf, and Bin coordinates.',
  },
  {
    key: 'bulk_storage',
    title: 'Bulk Storage Layout',
    subtitle: 'High-density pallet racks, bulk storage bays, and heavy truck dispatch staging.',
    tag: 'Pallets & Bulk',
    icon: 'dolly',
    starterLocations: [
      {
        code: 'RECV',
        type: 'receiving',
        role: 'Inbound dock for truck delivery, inspection & pallet staging',
        isPickable: false,
      },
      {
        code: 'MAIN',
        type: 'main',
        role: 'Bulk pallet racks for high-volume heavy inventory',
        isPickable: true,
      },
    ],
    supportsCoordinates: true,
    coordinateHelp:
      'Bulk Pallet Storage: Use Aisle, Rack, and Shelf coordinates to identify heavy pallet storage bays.',
  },
];

export interface IndustryZoneItem {
  readonly key: string;
  readonly label: string;
  readonly desc: string;
  readonly icon: keyof typeof MaterialCommunityIcons.glyphMap;
  readonly isOperational: boolean;
}

export interface IndustryTemplateInfo {
  readonly templateName: string;
  readonly description: string;
  readonly defaultZones: string[];
  readonly availableZones: ReadonlyArray<IndustryZoneItem>;
}

export const INDUSTRY_ZONE_TEMPLATES: Record<WarehouseType, IndustryTemplateInfo> = {
  general: {
    templateName: 'Small Parts & General Store Template',
    description: 'Compact flow for spare parts, maintenance stores, or retail operations.',
    defaultZones: ['receiving', 'main', 'bin'],
    availableZones: [
      { key: 'receiving', label: 'Counter / Receiving (RECV)', desc: 'Intake and inspection counter for incoming shipments', icon: 'tray-arrow-down', isOperational: true },
      { key: 'main', label: 'Main Storage Racks (MAIN)', desc: 'General shelf and rack reserve storage area', icon: 'warehouse', isOperational: false },
      { key: 'bin', label: 'Small Parts Bins (BIN-01)', desc: 'Specific piece-picking stock position', icon: 'package-variant', isOperational: false },
      { key: 'dispatch', label: 'Dispatch Counter (DISP)', desc: 'Customer collection or courier pickup area', icon: 'truck-delivery-outline', isOperational: true },
      { key: 'quarantine', label: 'Returns & Hold (QC)', desc: 'Defective or return inspection area', icon: 'shield-alert-outline', isOperational: true },
    ],
  },
  distribution: {
    templateName: 'Distribution Hub Template',
    description: 'High-throughput pallet and case flow with dedicated receiving and shipping docks.',
    defaultZones: ['receiving', 'main', 'picking', 'dispatch'],
    availableZones: [
      { key: 'receiving', label: 'Inbound Receiving Dock (RECV)', desc: 'Truck dock for supplier deliveries and intake verification', icon: 'tray-arrow-down', isOperational: true },
      { key: 'main', label: 'Reserve High-Bay Racks (MAIN)', desc: 'Bulk reserve pallet racking for high-density storage', icon: 'warehouse', isOperational: false },
      { key: 'picking', label: 'Forward Picking Zone (PICK)', desc: 'Dedicated picking positions for fast-moving items', icon: 'package-variant', isOperational: false },
      { key: 'packing', label: 'Packing & Consolidation (PACK)', desc: 'Packing tables and shipment consolidation', icon: 'archive-outline', isOperational: true },
      { key: 'dispatch', label: 'Outbound Shipping Dock (DISP)', desc: 'Staged pallets waiting for transport carriers', icon: 'truck-delivery-outline', isOperational: true },
      { key: 'quarantine', label: 'Quality / Quarantine Hold (QC)', desc: 'Damaged, expired or non-compliant goods isolation', icon: 'shield-alert-outline', isOperational: true },
      { key: 'returns', label: 'Customer Returns Station (RETURNS)', desc: 'Inbound returns triage and return-to-vendor hold', icon: 'keyboard-return', isOperational: true },
    ],
  },
  fulfilment: {
    templateName: 'E-Commerce Fulfilment Template',
    description: 'Optimized for high-velocity piece picking, packing tables, and rapid parcel dispatch.',
    defaultZones: ['receiving', 'main', 'bin', 'packing', 'dispatch'],
    availableZones: [
      { key: 'receiving', label: 'Inbound Ingest Dock (RECV)', desc: 'Goods-in verification, barcode scan, and intake check', icon: 'tray-arrow-down', isOperational: true },
      { key: 'main', label: 'Reserve Storage (MAIN)', desc: 'Bulk overflow storage replenishing pick faces', icon: 'warehouse', isOperational: false },
      { key: 'bin', label: 'Active Pick Bins (BIN-01)', desc: 'Forward ergonomic picking bin addresses', icon: 'package-variant', isOperational: false },
      { key: 'packing', label: 'Packing & Boxing Stations (PACK)', desc: 'Carton pack-out and courier manifest labeling', icon: 'archive-outline', isOperational: true },
      { key: 'dispatch', label: 'Courier Dispatch Staging (DISP)', desc: 'Staging parcels sorted by courier carrier', icon: 'truck-delivery-outline', isOperational: true },
      { key: 'returns', label: 'Returns & Inspection (RETURNS)', desc: 'Customer RMA check-in and re-stock triage', icon: 'keyboard-return', isOperational: true },
    ],
  },
  bulk: {
    templateName: 'Bulk & Pallet Storage / 3PL Template',
    description: 'Heavy raw goods, palletized materials, or 3PL client-allocated storage.',
    defaultZones: ['receiving', 'main', 'dispatch'],
    availableZones: [
      { key: 'receiving', label: 'Inbound Receiving Dock (RECV)', desc: 'Direct pallet unloading and QA intake', icon: 'tray-arrow-down', isOperational: true },
      { key: 'main', label: 'Bulk Pallet Storage (MAIN)', desc: 'Floor bays and heavy pallet drive-in racking', icon: 'warehouse', isOperational: false },
      { key: 'staging', label: 'Cross-Dock & Staging (STAGE)', desc: 'Temporary staging buffer for transshipment', icon: 'swap-horizontal', isOperational: true },
      { key: 'dispatch', label: 'Dispatch Dock (DISP)', desc: 'Flatbed and container truck dispatch staging', icon: 'truck-delivery-outline', isOperational: true },
      { key: 'quarantine', label: 'QA / Quarantine Hold (QC)', desc: 'Damaged or withheld lots isolated from stock', icon: 'shield-alert-outline', isOperational: true },
    ],
  },
  cold_storage: {
    templateName: 'Cold Chain / Controlled Storage Template',
    description: 'Temperature-controlled storage for perishable goods, chemicals, or pharmaceuticals.',
    defaultZones: ['receiving', 'cold_storage', 'dispatch'],
    availableZones: [
      { key: 'receiving', label: 'Chilled Receiving Dock (RECV)', desc: 'Cold chain airlock receiving and temperature logging', icon: 'tray-arrow-down', isOperational: true },
      { key: 'cold_storage', label: 'Cold Vault Storage (COLD)', desc: 'Temperature-monitored refrigerated / freezer racks', icon: 'snowflake', isOperational: false },
      { key: 'dispatch', label: 'Chilled Outbound Dock (DISP)', desc: 'Refrigerated carrier loading dock', icon: 'truck-delivery-outline', isOperational: true },
      { key: 'quarantine', label: 'Quarantine / Expiry Hold (QC)', desc: 'Temperature breach or expired batch quarantine', icon: 'shield-alert-outline', isOperational: true },
    ],
  },
  cross_dock: {
    templateName: 'Cross-Dock & Transit Hub Template',
    description: 'Fast freight transshipment: goods arrive, get sorted, and leave without long-term storage.',
    defaultZones: ['receiving', 'staging', 'dispatch'],
    availableZones: [
      { key: 'receiving', label: 'Inbound Unloading Bay (RECV)', desc: 'Inbound trailer unloading and sorting', icon: 'tray-arrow-down', isOperational: true },
      { key: 'staging', label: 'Cross-Dock Sorting Buffer (STAGE)', desc: 'Sorting lanes organized by outbound destination', icon: 'swap-horizontal', isOperational: true },
      { key: 'dispatch', label: 'Outbound Loading Bays (DISP)', desc: 'Outgoing route consolidation and trailer departure', icon: 'truck-delivery-outline', isOperational: true },
      { key: 'quarantine', label: 'Damaged Transit Hold (QC)', desc: 'Damaged freight held for claim inspection', icon: 'shield-alert-outline', isOperational: true },
    ],
  },
};

// ============================================================================
// LOCATION PURPOSES & OPERATIONAL ROLES
// ============================================================================

export interface LocationPurposeInfo {
  readonly key: string;
  readonly label: string;
  readonly category: 'Storage' | 'Inbound / Outbound' | 'Specialized';
  readonly icon: keyof typeof MaterialCommunityIcons.glyphMap;
  readonly isPickableDefault: boolean;
  readonly operationalRole: string;
  readonly explanation: string;
}

export const LOCATION_PURPOSES: ReadonlyArray<LocationPurposeInfo> = [
  {
    key: 'bin',
    label: 'Picking Bin',
    category: 'Storage',
    icon: 'package-variant',
    isPickableDefault: true,
    operationalRole: 'Forward Picking Location',
    explanation:
      'Dedicated picking bin for fast piece-picking. Automatically eligible for outbound order allocations when active and pickable.',
  },
  {
    key: 'main',
    label: 'Main / Bulk Storage',
    category: 'Storage',
    icon: 'warehouse',
    isPickableDefault: false,
    operationalRole: 'Reserve Storage Rack',
    explanation:
      'High-bay pallet rack or reserve storage location. Holds bulk inventory; replenishes forward picking bins via internal transfers.',
  },
  {
    key: 'receiving',
    label: 'Inbound Receiving Dock',
    category: 'Inbound / Outbound',
    icon: 'tray-arrow-down',
    isPickableDefault: false,
    operationalRole: 'Inbound Intake Dock',
    explanation:
      'Goods arrival dock. Put-away tasks automatically move stock from here to permanent storage racks or bins. Cannot be a put-away destination.',
  },
  {
    key: 'staging',
    label: 'Staging Area',
    category: 'Inbound / Outbound',
    icon: 'swap-horizontal',
    isPickableDefault: false,
    operationalRole: 'Temporary Buffer / Dock',
    explanation:
      'Temporary buffer zone used for pre-sorting, cross-dock consolidation, or pre-dispatch pallet marshalling. Eligible as put-away source.',
  },
  {
    key: 'dispatch',
    label: 'Dispatch / Shipping Dock',
    category: 'Inbound / Outbound',
    icon: 'truck-delivery-outline',
    isPickableDefault: false,
    operationalRole: 'Outbound Shipping Dock',
    explanation:
      'Final departure point where packed orders are staged before loading onto transport carriers.',
  },
  {
    key: 'quarantine',
    label: 'Quarantine / QC Hold',
    category: 'Specialized',
    icon: 'shield-alert-outline',
    isPickableDefault: false,
    operationalRole: 'Quality Inspection Hold',
    explanation:
      'Quality control and inspection area. Inventory here is completely isolated and blocked from customer order picking until released.',
  },
  {
    key: 'line_side',
    label: 'Line-Side / Production',
    category: 'Specialized',
    icon: 'cog-outline',
    isPickableDefault: false,
    operationalRole: 'Manufacturing Assembly Buffer',
    explanation:
      'Work-in-progress parts staging area directly adjacent to manufacturing, assembly, or kitting stations.',
  },
  {
    key: 'finished_goods',
    label: 'Finished Goods',
    category: 'Storage',
    icon: 'check-decagram-outline',
    isPickableDefault: true,
    operationalRole: 'Finished Inventory Storage',
    explanation:
      'Stored completed manufacturing items ready for customer order fulfillment or branch transfer.',
  },
];

import {
  buildCustomSectionBatch,
  compileInitialLocations,
  computeFlatFloorPositions,
  computeRackBins,
  getInitialProposedAreas,
  validateWarehouseAreas,
  type ProposedArea,
  type SetupMethod,
} from '../warehouse_setup';

export { getInitialProposedAreas, type ProposedArea };

type FilterCategory = 'all' | 'storage' | 'operational' | 'quarantine' | 'blocked';
type ViewMode = 'hierarchy' | 'flat';

export function LocationsScreen({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const { state } = useAuth();
  const { warehouses, locations, refresh } = useWorkspace();
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(null);

  // Warehouse creation wizard (Step 1: Details, Step 2: Setup Method, Step 3: Areas & Storage Setup)
  const [createWhModalOpen, setCreateWhModalOpen] = useState(false);
  const [createWhStep, setCreateWhStep] = useState<1 | 2 | 3>(1);
  const [setupMethod, setSetupMethod] = useState<SetupMethod>('quick');
  const [warehouseName, setWarehouseName] = useState('');
  const [warehouseCode, setWarehouseCode] = useState('');
  const [warehouseAddress, setWarehouseAddress] = useState('');
  const [warehouseType, setWarehouseType] = useState<WarehouseType>('general');
  const [warehouseLayout, setWarehouseLayout] = useState<WarehouseLayout>('multi_zone');
  const [starterZones, setStarterZones] = useState<string[]>(['receiving', 'main', 'picking', 'dispatch']);

  // Step 3 state: Configured proposed areas
  const [configuredAreas, setConfiguredAreas] = useState<ProposedArea[]>([]);

  // Step 3 state: Custom section adder form
  const [newSectionName, setNewSectionName] = useState('');
  const [newSectionCode, setNewSectionCode] = useState('');
  const [newSectionType, setNewSectionType] = useState('main');
  const [newSectionPickable, setNewSectionPickable] = useState(true);
  const [newSectionQty, setNewSectionQty] = useState('1');

  // Step 3 state: Physical rack and bin generation
  const [rackConfigEnabled, setRackConfigEnabled] = useState(false);
  const [rackParentCode, setRackParentCode] = useState('STORAGE');
  const [rackAisles, setRackAisles] = useState('2');
  const [rackRacksPerAisle, setRackRacksPerAisle] = useState('3');
  const [rackShelvesPerRack, setRackShelvesPerRack] = useState('4');
  const [rackBinsPerShelf, setRackBinsPerShelf] = useState('2');
  const [rackPrefix, setRackPrefix] = useState('');
  const [rackSeparator, setRackSeparator] = useState('-');
  const [rackZeroPad, setRackZeroPad] = useState('2');
  const [rackPreviewOpen, setRackPreviewOpen] = useState(false);

  // Step 3 state: Flat floor positions generation for all_in_one
  const [floorPositionsEnabled, setFloorPositionsEnabled] = useState(false);
  const [floorPositionCount, setFloorPositionCount] = useState('6');
  const [floorPositionPrefix, setFloorPositionPrefix] = useState('BAY');
  const [floorParentCode, setFloorParentCode] = useState('FLOOR');

  const [showZoneGuide, setShowZoneGuide] = useState(false);
  const [warehouseSaving, setWarehouseSaving] = useState(false);
  const [warehouseError, setWarehouseError] = useState<string | null>(null);
  const [warehouseFieldErrors, setWarehouseFieldErrors] = useState<Record<string, string>>({});

  // Warehouse edit modal
  const [editingWarehouse, setEditingWarehouse] = useState(false);
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editType, setEditType] = useState<WarehouseType>('distribution');
  const [editLayout, setEditLayout] = useState<WarehouseLayout>('multi_zone');
  const [editStatus, setEditStatus] = useState('active');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Template apply on empty warehouse
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templatePreviewModalOpen, setTemplatePreviewModalOpen] = useState(false);
  const [templatePreviewItems, setTemplatePreviewItems] = useState<
    WarehouseTemplateLocationPreview[]
  >([]);

  // Location search, filter & grouping
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterCategory>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('hierarchy');

  // Single Location creation
  const [code, setCode] = useState('');
  const [barcode, setBarcode] = useState('');
  const [locationType, setLocationType] = useState('bin');
  const [parentId, setParentId] = useState<string | null>(null);
  const [isPickable, setIsPickable] = useState(true);
  const [statusVal, setStatusVal] = useState<'active' | 'blocked' | 'archived'>('active');
  const [zone, setZone] = useState('');
  const [aisle, setAisle] = useState('');
  const [rack, setRack] = useState('');
  const [shelf, setShelf] = useState('');
  const [binVal, setBinVal] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Location Inspector Modal
  const [inspectedLocation, setInspectedLocation] = useState<Location | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [copiedBarcode, setCopiedBarcode] = useState(false);
  const [statusActionSaving, setStatusActionSaving] = useState(false);

  // Edit Location Modal
  const [editLocModalOpen, setEditLocModalOpen] = useState(false);
  const [editLocCode, setEditLocCode] = useState('');
  const [editLocBarcode, setEditLocBarcode] = useState('');
  const [editLocType, setEditLocType] = useState('bin');
  const [editLocStatus, setEditLocStatus] = useState<'active' | 'blocked' | 'archived'>('active');
  const [editLocPickable, setEditLocPickable] = useState(true);
  const [editLocZone, setEditLocZone] = useState('');
  const [editLocAisle, setEditLocAisle] = useState('');
  const [editLocRack, setEditLocRack] = useState('');
  const [editLocShelf, setEditLocShelf] = useState('');
  const [editLocBin, setEditLocBin] = useState('');
  const [editLocSaving, setEditLocSaving] = useState(false);
  const [editLocError, setEditLocError] = useState<string | null>(null);

  // Bulk Generator Modal
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkParentId, setBulkParentId] = useState<string | null>(null);
  const [bulkPrefix, setBulkPrefix] = useState('');
  const [bulkSeparator, setBulkSeparator] = useState('-');
  const [bulkPad, setBulkPad] = useState('2');
  const [bulkAisleStart, setBulkAisleStart] = useState('1');
  const [bulkAisleEnd, setBulkAisleEnd] = useState('1');
  const [bulkRackStart, setBulkRackStart] = useState('1');
  const [bulkRackEnd, setBulkRackEnd] = useState('1');
  const [bulkShelfStart, setBulkShelfStart] = useState('1');
  const [bulkShelfEnd, setBulkShelfEnd] = useState('2');
  const [bulkBinStart, setBulkBinStart] = useState('1');
  const [bulkBinEnd, setBulkBinEnd] = useState('4');
  const [bulkType, setBulkType] = useState('bin');
  const [bulkPickable, setBulkPickable] = useState(true);
  const [bulkPreviewLoading, setBulkPreviewLoading] = useState(false);
  const [bulkCreateLoading, setBulkCreateLoading] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkPreviewItems, setBulkPreviewItems] = useState<BulkLocationPreviewItem[] | null>(null);
  const [bulkStats, setBulkStats] = useState<{
    total: number;
    new: number;
    duplicate: number;
  } | null>(null);

  const canWrite =
    state.status === 'signedIn' && state.session.permissions.includes('inventory.write');
  const canManage =
    state.status === 'signedIn' &&
    (state.session.permissions.includes('warehouses.manage') ||
      state.session.permissions.includes('organization.manage'));

  const activeWarehouses = warehouses.filter((w) => w.status === 'active');
  const selectedWarehouse =
    activeWarehouses.find((w) => w.id === selectedWarehouseId) ??
    (activeWarehouses.length > 0 ? activeWarehouses[0] : undefined);
  const activeWarehouseId = selectedWarehouse?.id ?? null;

  // Warehouse metadata lookup
  const currentWarehouseTypeMeta = useMemo(() => {
    const rawType = (selectedWarehouse?.warehouse_type as WarehouseType) || 'general';
    return (
      WAREHOUSE_TYPES_META.find((t) => t.key === rawType) ?? {
        key: 'general' as WarehouseType,
        label: humanize(rawType),
        tagline: 'Standard facility',
        icon: 'home-city-outline' as const,
      }
    );
  }, [selectedWarehouse?.warehouse_type]);

  const currentWarehouseLayoutMeta = useMemo(() => {
    const rawLayout = (selectedWarehouse?.warehouse_layout as WarehouseLayout) || 'multi_zone';
    return (
      WAREHOUSE_LAYOUTS_META.find((l) => l.key === rawLayout) ?? {
        key: 'multi_zone' as WarehouseLayout,
        title: humanize(rawLayout),
        subtitle: 'Multi-zone facility',
        tag: 'Standard',
        icon: 'view-dashboard-outline' as const,
        starterLocations: [],
        supportsCoordinates: true,
        coordinateHelp: 'Use coordinates if applicable to this facility.',
      }
    );
  }, [selectedWarehouse?.warehouse_layout]);

  // Selected purpose info for the Add Location form
  const selectedPurposeInfo = useMemo(() => {
    return (
      LOCATION_PURPOSES.find((p) => p.key === locationType) ?? {
        key: locationType,
        label: humanize(locationType),
        category: 'Storage' as const,
        icon: 'map-marker-outline' as const,
        isPickableDefault: true,
        operationalRole: 'Standard Storage Location',
        explanation: 'Custom location role.',
      }
    );
  }, [locationType]);

  const warehouseLocations = useMemo(
    () =>
      locations
        .filter((location) => location.warehouse_id === activeWarehouseId)
        .sort((left, right) => (left.path ?? left.code).localeCompare(right.path ?? right.code)),
    [locations, activeWarehouseId],
  );

  const parentOptions = useMemo(
    () => warehouseLocations.filter((location) => location.type !== 'bin' || location.id === parentId),
    [warehouseLocations, parentId],
  );

  // Filtered locations (drill-down by operational areas vs storage positions)
  const filteredLocations = useMemo(() => {
    return warehouseLocations.filter((loc) => {
      if (
        activeFilter === 'storage' &&
        !['bin', 'main', 'picking', 'finished_goods', 'cold_storage'].includes(loc.type)
      )
        return false;
      if (
        activeFilter === 'operational' &&
        !['receiving', 'dispatch', 'staging', 'packing', 'line_side', 'returns'].includes(loc.type)
      )
        return false;
      if (
        activeFilter === 'quarantine' &&
        !['quarantine', 'quality_inspection'].includes(loc.type)
      )
        return false;
      if (activeFilter === 'blocked' && !['blocked', 'archived'].includes(loc.status)) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const codeMatch = loc.code.toLowerCase().includes(q);
        const pathMatch = (loc.path ?? '').toLowerCase().includes(q);
        const typeMatch = loc.type.toLowerCase().includes(q);
        const barcodeMatch = (loc.barcode ?? '').toLowerCase().includes(q);
        if (!codeMatch && !pathMatch && !typeMatch && !barcodeMatch) return false;
      }
      return true;
    });
  }, [warehouseLocations, activeFilter, searchQuery]);

  // Hierarchical Grouping
  const groupedLocations = useMemo(() => {
    if (viewMode !== 'hierarchy') return null;

    const topLevel: Location[] = [];
    const childrenMap: Record<string, Location[]> = {};

    filteredLocations.forEach((loc) => {
      if (!loc.parent_id) {
        topLevel.push(loc);
      } else {
        if (!childrenMap[loc.parent_id]) {
          childrenMap[loc.parent_id] = [];
        }
        childrenMap[loc.parent_id].push(loc);
      }
    });

    // Check for orphan children whose parents might be filtered out
    const topLevelIds = new Set(topLevel.map((t) => t.id));
    const orphanChildren: Location[] = [];
    filteredLocations.forEach((loc) => {
      if (loc.parent_id && !topLevelIds.has(loc.parent_id)) {
        orphanChildren.push(loc);
      }
    });

    return { topLevel, childrenMap, orphanChildren };
  }, [filteredLocations, viewMode]);

  // Real KPIs and counts computed strictly from persisted database records
  const counts = useMemo(() => {
    return {
      all: warehouseLocations.length,
      storage: warehouseLocations.filter((l) =>
        ['bin', 'main', 'picking', 'finished_goods', 'cold_storage'].includes(l.type),
      ).length,
      operational: warehouseLocations.filter((l) =>
        ['receiving', 'dispatch', 'staging', 'packing', 'line_side', 'returns'].includes(l.type),
      ).length,
      quarantine: warehouseLocations.filter((l) =>
        ['quarantine', 'quality_inspection'].includes(l.type),
      ).length,
      blocked: warehouseLocations.filter((l) => ['blocked', 'archived'].includes(l.status)).length,
    };
  }, [warehouseLocations]);

  // Initial selection
  useEffect(() => {
    const isCurrentValid =
      Boolean(selectedWarehouseId) && activeWarehouses.some((w) => w.id === selectedWarehouseId);
    if (!isCurrentValid && activeWarehouses.length > 0) {
      const first = activeWarehouses[0];
      setSelectedWarehouseId(first.id);
      const main = locations.find(
        (location) =>
          location.warehouse_id === first.id && location.type === 'main' && !location.parent_id,
      );
      setParentId(main?.id ?? null);
      setBulkParentId(main?.id ?? null);
    } else if (activeWarehouses.length === 0 && selectedWarehouseId) {
      setSelectedWarehouseId(null);
    }
  }, [activeWarehouses, locations, selectedWarehouseId]);

  // Update default pickable when location type changes
  const handleLocationTypeChange = (nextType: string) => {
    setLocationType(nextType);
    const meta = LOCATION_PURPOSES.find((p) => p.key === nextType);
    if (meta) {
      setIsPickable(meta.isPickableDefault);
    }
  };

  const chooseWarehouse = (value: string) => {
    setSelectedWarehouseId(value);
    setEditingWarehouse(false);
    setEditError(null);
    setSearchQuery('');
    setActiveFilter('all');
    const main = locations.find(
      (location) => location.warehouse_id === value && location.type === 'main' && !location.parent_id,
    );
    setParentId(main?.id ?? null);
    setBulkParentId(main?.id ?? null);
  };

  // Helper for computing generated physical bins or flat floor positions during warehouse setup
  const computeGeneratedBins = (): { bins: InitialLocationCreate[]; error: string | null } => {
    if (warehouseLayout === 'all_in_one') {
      if (!floorPositionsEnabled) {
        return { bins: [], error: null };
      }
      const parent = floorParentCode || configuredAreas[0]?.code || 'FLOOR';
      const { positions, error } = computeFlatFloorPositions({
        count: floorPositionCount,
        parentCode: parent,
        prefix: floorPositionPrefix,
      });
      return { bins: positions, error };
    }

    if (!rackConfigEnabled) {
      return { bins: [], error: null };
    }
    const storageArea =
      configuredAreas.find((a) => !a.isOperational && a.code === rackParentCode) ??
      configuredAreas.find((a) => !a.isOperational) ??
      configuredAreas[0];
    const parent = storageArea?.code || 'STORAGE';

    return computeRackBins({
      aisles: rackAisles,
      racksPerAisle: rackRacksPerAisle,
      shelvesPerRack: rackShelvesPerRack,
      binsPerShelf: rackBinsPerShelf,
      parentCode: parent,
      prefix: rackPrefix,
      separator: rackSeparator,
      zeroPad: rackZeroPad,
    });
  };

  // Step 1 -> Step 2 transition
  const handleGoToStep2 = () => {
    setWarehouseError(null);
    setWarehouseFieldErrors({});
    if (!warehouseName.trim()) {
      setWarehouseFieldErrors({ name: 'Enter a warehouse name.' });
      return;
    }
    setCreateWhStep(2);
  };

  // Step 2 Selection: Quick Setup
  const handleSelectQuickSetup = () => {
    setWarehouseError(null);
    setSetupMethod('quick');
    const initialAreas = getInitialProposedAreas(warehouseLayout, warehouseType);
    setConfiguredAreas(initialAreas);
    if (warehouseLayout === 'all_in_one') {
      setRackConfigEnabled(false);
      setFloorPositionsEnabled(false);
      setFloorParentCode(initialAreas[0]?.code || 'FLOOR');
    } else {
      setRackConfigEnabled(true);
      setFloorPositionsEnabled(false);
      setRackBinsPerShelf(warehouseLayout === 'bulk_storage' ? '1' : '2');
      const storageArea =
        initialAreas.find((a) => !a.isOperational && (a.type === 'main' || a.type === 'cold_storage')) ??
        initialAreas[0];
      setRackParentCode(storageArea?.code || 'STORAGE');
    }
    setCreateWhStep(3);
  };

  // Step 2 Selection: Custom Setup
  const handleSelectCustomSetup = () => {
    setWarehouseError(null);
    setSetupMethod('custom');
    setConfiguredAreas([]); // Explicitly zero initial areas!
    setRackConfigEnabled(false);
    setFloorPositionsEnabled(false);
    setNewSectionName('');
    setNewSectionCode('');
    setNewSectionType('main');
    setNewSectionPickable(true);
    setNewSectionQty('1');
    setCreateWhStep(3);
  };

  // Step 3: Add user-defined physical section
  const handleAddCustomSection = () => {
    setWarehouseError(null);
    const code = newSectionCode.trim().toUpperCase();
    const name = newSectionName.trim() || code;
    if (!code) {
      setWarehouseError('Please enter a section code (e.g. ROOM-1, DOCK-A).');
      return;
    }
    const meta = LOCATION_PURPOSES.find((p) => p.key === newSectionType);
    const isOperational = meta ? meta.category !== 'Storage' : false;
    const batch = buildCustomSectionBatch({
      name,
      code,
      type: newSectionType,
      isPickable: newSectionPickable,
      isOperational,
      quantity: newSectionQty,
    });

    const existingCodes = new Set(configuredAreas.map((a) => a.code.toUpperCase()));
    for (const item of batch) {
      if (existingCodes.has(item.code)) {
        setWarehouseError(`Area code '${item.code}' is already added. Area codes must be unique.`);
        return;
      }
      existingCodes.add(item.code);
    }

    setConfiguredAreas((prev) => [...prev, ...batch]);
    setNewSectionName('');
    setNewSectionCode('');
    setNewSectionQty('1');

    // If rack or floor parent not set, default to first storage area
    const storageArea = batch.find((a) => !a.isOperational);
    if (storageArea) {
      if (!rackParentCode || rackParentCode === 'STORAGE' || rackParentCode === 'MAIN') {
        setRackParentCode(storageArea.code);
      }
      if (!floorParentCode || floorParentCode === 'FLOOR') {
        setFloorParentCode(storageArea.code);
      }
    }
  };

  const handleAddArea = () => {
    const nextNum = configuredAreas.length + 1;
    const newArea: ProposedArea = {
      id: `custom-area-${Date.now()}`,
      code: `ZONE-${nextNum.toString().padStart(2, '0')}`,
      name: `Custom Area ${nextNum}`,
      type: 'main',
      isPickable: true,
      isOperational: false,
    };
    setConfiguredAreas((prev) => [...prev, newArea]);
  };

  const handleRemoveArea = (id: string) => {
    setConfiguredAreas((prev) => prev.filter((a) => a.id !== id));
  };

  const handleUpdateArea = (id: string, patch: Partial<ProposedArea>) => {
    setConfiguredAreas((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a;
        const updated = { ...a, ...patch };
        if (patch.type) {
          const meta = LOCATION_PURPOSES.find((p) => p.key === patch.type);
          if (meta) {
            updated.isOperational = meta.category !== 'Storage';
            updated.isPickable = meta.isPickableDefault;
          }
        }
        return updated;
      }),
    );
  };

  // Create Warehouse Submit (supports configured locations or clean blank warehouse)
  const handleCreateWarehouseSubmit = async (skipLocations = false) => {
    setWarehouseError(null);
    setWarehouseFieldErrors({});
    if (!warehouseName.trim()) {
      setWarehouseFieldErrors({ name: 'Enter a warehouse name.' });
      setCreateWhStep(1);
      return;
    }

    let initialLocs: InitialLocationCreate[] = [];
    if (!skipLocations && setupMethod !== 'later') {
      const { bins, error: binErr } = computeGeneratedBins();
      if (binErr) {
        setWarehouseError(binErr);
        return;
      }

      const compiled = compileInitialLocations({
        setupMethod,
        areas: configuredAreas,
        rackBins: bins,
      });
      if (compiled.error) {
        setWarehouseError(compiled.error);
        return;
      }
      initialLocs = compiled.locations;
    }

    setWarehouseSaving(true);
    try {
      const created = await api.createWarehouse({
        name: warehouseName.trim(),
        code: warehouseCode.trim() ? warehouseCode.trim().toUpperCase() : undefined,
        address: warehouseAddress.trim() || undefined,
        warehouse_type: warehouseType,
        warehouse_layout: warehouseLayout,
        initial_locations: initialLocs,
      });

      setWarehouseName('');
      setWarehouseCode('');
      setWarehouseAddress('');
      setCreateWhStep(1);
      setCreateWhModalOpen(false);
      await refresh();

      setSelectedWarehouseId(created.id);
      const allLocations = await api.locations(created.id);
      const main = allLocations.locations.find(
        (loc) => loc.type === 'main' && !loc.parent_id,
      );
      setParentId(main?.id ?? null);
      setBulkParentId(main?.id ?? null);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setWarehouseError(caught.message);
        setWarehouseFieldErrors(caught.fieldErrors);
      } else {
        setWarehouseError('The warehouse could not be created.');
      }
    } finally {
      setWarehouseSaving(false);
    }
  };

  // Edit Warehouse
  const startEditingWarehouse = () => {
    if (!selectedWarehouse) return;
    setEditName(selectedWarehouse.name);
    setEditCode(selectedWarehouse.code ?? '');
    setEditAddress(selectedWarehouse.address ?? '');
    setEditType((selectedWarehouse.warehouse_type as WarehouseType) || 'general');
    setEditLayout((selectedWarehouse.warehouse_layout as WarehouseLayout) || 'multi_zone');
    setEditStatus(selectedWarehouse.status);
    setEditError(null);
    setEditingWarehouse(true);
  };

  const saveWarehouseEdits = async () => {
    if (!selectedWarehouse) return;
    setEditError(null);
    if (!editName.trim()) {
      setEditError('Enter a warehouse name.');
      return;
    }
    setEditSaving(true);
    try {
      await api.updateWarehouse(selectedWarehouse.id, {
        name: editName.trim(),
        code: editCode.trim() ? editCode.trim().toUpperCase() : null,
        address: editAddress.trim() || null,
        warehouse_type: editType,
        warehouse_layout: editLayout,
        status: editStatus,
      });
      setEditingWarehouse(false);
      await refresh();
      if (editStatus === 'archived') {
        setSelectedWarehouseId(null);
        setParentId(null);
      }
    } catch (caught) {
      setEditError(
        caught instanceof ApiError ? caught.message : 'The warehouse could not be updated.',
      );
    } finally {
      setEditSaving(false);
    }
  };

  // Preview & Apply Starter Template on Empty Warehouse
  const handlePreviewTemplate = async () => {
    if (!activeWarehouseId) return;
    setTemplateError(null);
    setTemplateLoading(true);
    try {
      const res = await api.applyWarehouseTemplate(activeWarehouseId, true, starterZones);
      setTemplatePreviewItems(res.locations);
      setTemplatePreviewModalOpen(true);
    } catch (caught) {
      setTemplateError(
        caught instanceof ApiError ? caught.message : 'Could not generate template preview.',
      );
    } finally {
      setTemplateLoading(false);
    }
  };

  const handleApplyTemplate = async () => {
    if (!activeWarehouseId) return;
    setTemplateLoading(true);
    setTemplateError(null);
    try {
      const res = await api.applyWarehouseTemplate(activeWarehouseId, false, starterZones);
      setTemplatePreviewModalOpen(false);
      await refresh();
      const allLocations = await api.locations(activeWarehouseId);
      const main = allLocations.locations.find((l) => l.type === 'main' && !l.parent_id);
      setParentId(main?.id ?? null);
      setBulkParentId(main?.id ?? null);
      alert(`Applied template successfully! Created ${res.created_count} locations.`);
    } catch (caught) {
      setTemplateError(
        caught instanceof ApiError ? caught.message : 'Failed to apply template.',
      );
    } finally {
      setTemplateLoading(false);
    }
  };

  // Create Single Location
  const handleCreateLocation = async () => {
    if (!activeWarehouseId) return;
    setError(null);
    setFieldErrors({});

    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedCode) {
      setFieldErrors({ code: 'Location code is required.' });
      return;
    }

    setSaving(true);
    try {
      const isAllInOne = selectedWarehouse?.warehouse_layout === 'all_in_one';
      await api.createLocation({
        warehouse_id: activeWarehouseId,
        parent_id: parentId ?? undefined,
        code: trimmedCode,
        barcode: barcode.trim() || undefined,
        type: locationType,
        is_pickable: isPickable,
        status: statusVal,
        zone: !isAllInOne && zone.trim() ? zone.trim() : undefined,
        aisle: !isAllInOne && aisle.trim() ? aisle.trim() : undefined,
        rack: !isAllInOne && rack.trim() ? rack.trim() : undefined,
        shelf: !isAllInOne && shelf.trim() ? shelf.trim() : undefined,
        bin: !isAllInOne && binVal.trim() ? binVal.trim() : undefined,
      });

      setCode('');
      setBarcode('');
      setZone('');
      setAisle('');
      setRack('');
      setShelf('');
      setBinVal('');
      setStatusVal('active');
      await refresh();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors);
      } else {
        setError('The location could not be created.');
      }
    } finally {
      setSaving(false);
    }
  };

  // Inspect Location & Live Balances
  const openInspector = async (loc: Location) => {
    setInspectedLocation(loc);
    setBalances([]);
    setLoadingBalances(true);
    setCopiedBarcode(false);
    try {
      const res = await api.locationBalances(loc.id);
      setBalances(res.balances);
    } catch {
      setBalances([]);
    } finally {
      setLoadingBalances(false);
    }
  };

  const toggleLocationStatus = async () => {
    if (!inspectedLocation) return;
    setStatusActionSaving(true);
    try {
      const newStatus = inspectedLocation.status === 'active' ? 'blocked' : 'active';
      const updated = await api.updateLocation(inspectedLocation.id, {
        status: newStatus as 'active' | 'blocked',
      });
      setInspectedLocation(updated);
      await refresh();
    } catch (caught) {
      alert(caught instanceof ApiError ? caught.message : 'Could not update location status.');
    } finally {
      setStatusActionSaving(false);
    }
  };

  const toggleLocationPickable = async () => {
    if (!inspectedLocation) return;
    setStatusActionSaving(true);
    try {
      const updated = await api.updateLocation(inspectedLocation.id, {
        is_pickable: !inspectedLocation.is_pickable,
      });
      setInspectedLocation(updated);
      await refresh();
    } catch (caught) {
      alert(caught instanceof ApiError ? caught.message : 'Could not update pickable status.');
    } finally {
      setStatusActionSaving(false);
    }
  };

  // Edit Location Modal
  const openEditLocationModal = (loc: Location) => {
    setEditLocCode(loc.code);
    setEditLocBarcode(loc.barcode ?? '');
    setEditLocType(loc.type);
    setEditLocStatus(
      (loc.status as 'active' | 'blocked' | 'archived') || 'active',
    );
    setEditLocPickable(loc.is_pickable);
    setEditLocZone(loc.zone ?? '');
    setEditLocAisle(loc.aisle ?? '');
    setEditLocRack(loc.rack ?? '');
    setEditLocShelf(loc.shelf ?? '');
    setEditLocBin(loc.bin ?? '');
    setEditLocError(null);
    setEditLocModalOpen(true);
  };

  const saveEditedLocation = async () => {
    if (!inspectedLocation) return;
    setEditLocError(null);
    if (!editLocCode.trim()) {
      setEditLocError('Location code is required.');
      return;
    }
    setEditLocSaving(true);
    try {
      const isAllInOne = selectedWarehouse?.warehouse_layout === 'all_in_one';
      const updated = await api.updateLocation(inspectedLocation.id, {
        code: editLocCode.trim().toUpperCase(),
        barcode: editLocBarcode.trim() || null,
        type: editLocType,
        status: editLocStatus,
        is_pickable: editLocPickable,
        zone: !isAllInOne && editLocZone.trim() ? editLocZone.trim() : null,
        aisle: !isAllInOne && editLocAisle.trim() ? editLocAisle.trim() : null,
        rack: !isAllInOne && editLocRack.trim() ? editLocRack.trim() : null,
        shelf: !isAllInOne && editLocShelf.trim() ? editLocShelf.trim() : null,
        bin: !isAllInOne && editLocBin.trim() ? editLocBin.trim() : null,
      });
      setInspectedLocation(updated);
      setEditLocModalOpen(false);
      await refresh();
    } catch (caught) {
      setEditLocError(
        caught instanceof ApiError ? caught.message : 'Could not update location.',
      );
    } finally {
      setEditLocSaving(false);
    }
  };

  // Bulk Generator
  const handleBulkPreview = async () => {
    if (!activeWarehouseId) return;
    setBulkError(null);
    setBulkPreviewItems(null);
    setBulkStats(null);
    setBulkPreviewLoading(true);
    try {
      const aStart = parseInt(bulkAisleStart, 10) || 1;
      const aEnd = parseInt(bulkAisleEnd, 10) || 1;
      const rStart = parseInt(bulkRackStart, 10) || 1;
      const rEnd = parseInt(bulkRackEnd, 10) || 1;
      const sStart = parseInt(bulkShelfStart, 10) || 1;
      const sEnd = parseInt(bulkShelfEnd, 10) || 1;
      const bStart = parseInt(bulkBinStart, 10) || 1;
      const bEnd = parseInt(bulkBinEnd, 10) || 1;
      const pad = parseInt(bulkPad, 10) || 2;

      const res = await api.generateBulkLocations({
        warehouse_id: activeWarehouseId,
        parent_id: bulkParentId ?? undefined,
        prefix: bulkPrefix.trim() || undefined,
        separator: bulkSeparator,
        zero_pad: pad,
        aisle_start: aStart,
        aisle_end: aEnd,
        rack_start: rStart,
        rack_end: rEnd,
        shelf_start: sStart,
        shelf_end: sEnd,
        bin_start: bStart,
        bin_end: bEnd,
        type: bulkType,
        is_pickable: bulkPickable,
        preview_only: true,
      });

      setBulkPreviewItems(res.locations);
      setBulkStats({
        total: res.total_generated,
        new: res.new_count,
        duplicate: res.duplicate_count,
      });
    } catch (caught) {
      setBulkError(
        caught instanceof ApiError ? caught.message : 'Could not generate bulk preview.',
      );
    } finally {
      setBulkPreviewLoading(false);
    }
  };

  const handleBulkCreate = async () => {
    if (!activeWarehouseId) return;
    setBulkError(null);
    setBulkCreateLoading(true);
    try {
      const aStart = parseInt(bulkAisleStart, 10) || 1;
      const aEnd = parseInt(bulkAisleEnd, 10) || 1;
      const rStart = parseInt(bulkRackStart, 10) || 1;
      const rEnd = parseInt(bulkRackEnd, 10) || 1;
      const sStart = parseInt(bulkShelfStart, 10) || 1;
      const sEnd = parseInt(bulkShelfEnd, 10) || 1;
      const bStart = parseInt(bulkBinStart, 10) || 1;
      const bEnd = parseInt(bulkBinEnd, 10) || 1;
      const pad = parseInt(bulkPad, 10) || 2;

      const res = await api.generateBulkLocations({
        warehouse_id: activeWarehouseId,
        parent_id: bulkParentId ?? undefined,
        prefix: bulkPrefix.trim() || undefined,
        separator: bulkSeparator,
        zero_pad: pad,
        aisle_start: aStart,
        aisle_end: aEnd,
        rack_start: rStart,
        rack_end: rEnd,
        shelf_start: sStart,
        shelf_end: sEnd,
        bin_start: bStart,
        bin_end: bEnd,
        type: bulkType,
        is_pickable: bulkPickable,
        preview_only: false,
      });
      await refresh();
      setBulkModalOpen(false);
      alert(`Successfully created ${res.created_count} locations!`);
    } catch (caught) {
      setBulkError(
        caught instanceof ApiError ? caught.message : 'Could not create locations.',
      );
    } finally {
      setBulkCreateLoading(false);
    }
  };

  // Helper renderer for a location row
  const renderLocationRow = (location: Location, isChild = false) => {
    const isBlocked = location.status === 'blocked';
    const isArchived = location.status === 'archived';

    return (
      <Pressable
        key={location.id}
        onPress={() => void openInspector(location)}
        style={({ pressed }) => [
          styles.locationRow,
          isChild && styles.locationRowChild,
          isBlocked && styles.locationRowBlocked,
          pressed && styles.pressed,
        ]}
      >
        <View
          style={[
            styles.locationIcon,
            isChild && styles.locationIconChild,
            isBlocked && styles.locationIconBlocked,
          ]}
        >
          <MaterialCommunityIcons
            name={
              location.type === 'bin'
                ? 'package-variant'
                : location.type === 'receiving'
                  ? 'tray-arrow-down'
                  : location.type === 'quarantine'
                    ? 'shield-alert-outline'
                    : location.type === 'dispatch'
                      ? 'truck-delivery-outline'
                      : location.type === 'line_side'
                        ? 'cog-outline'
                        : 'warehouse'
            }
            size={isChild ? 18 : 20}
            color={isBlocked ? colors.warning : colors.deep}
          />
        </View>

        <View style={styles.locationBody}>
          <View style={styles.codeRow}>
            <Text style={[styles.locationCodeText, isChild && styles.locationCodeTextChild]}>
              {location.code}
            </Text>
            {location.path && location.path !== location.code ? (
              <Text style={styles.locationPathBreadcrumb}>
                {location.path.replace(/\//g, ' > ')}
              </Text>
            ) : null}
          </View>

          <View style={styles.badgesRow}>
            <Badge label={humanize(location.type)} tone="neutral" />
            {isBlocked ? (
              <Badge label="Blocked" tone="warning" />
            ) : isArchived ? (
              <Badge label="Archived" tone="neutral" />
            ) : (
              <Badge label="Active" tone="success" />
            )}
            <Badge
              label={location.is_pickable ? 'Pickable' : 'Storage Only'}
              tone={location.is_pickable ? 'success' : 'info'}
            />
          </View>
        </View>

        <MaterialCommunityIcons name="chevron-right" size={20} color={colors.muted} />
      </Pressable>
    );
  };

  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top + 12, 22) }]}>
      {/* Brand Header */}
      <View style={styles.brandRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to more"
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
          <Text style={styles.greetingTitle}>Warehouses & Bins</Text>
          <Text style={styles.greetingSubtitle} numberOfLines={1}>
            {warehouses.length} Facilities • {locations.length} Locations
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >

      {/* Info Card */}
      <View style={styles.infoCard}>
        <MaterialCommunityIcons name="map-marker-radius-outline" size={22} color={colors.deep} />
        <Text style={styles.infoText}>
          Commercial warehouse configuration tailored to your physical facility layout. Manage
          parent storage areas, forward picking bins, receiving docks, and inspect real-time bin
          balances.
        </Text>
      </View>

      {/* ========================================================================= */}
      {/* WAREHOUSE-FIRST FACILITY HEADER */}
      {/* ========================================================================= */}
      {selectedWarehouse ? (
        <View style={styles.warehousePrimaryCard}>
          {/* Header row: Warehouse Name & Status/Edit */}
          <View style={styles.whCardTop}>
            <View style={styles.whTitleBox}>
              <View style={styles.whNameRow}>
                <Text style={styles.whMainTitle}>{selectedWarehouse.name}</Text>
                {selectedWarehouse.code ? (
                  <View style={styles.whCodeBadge}>
                    <Text style={styles.whCodeBadgeText}>{selectedWarehouse.code}</Text>
                  </View>
                ) : null}
              </View>

              {/* Physical site address */}
              <View style={styles.whAddressRow}>
                <MaterialCommunityIcons name="map-marker-outline" size={15} color={colors.muted} />
                <Text style={styles.whAddressText} numberOfLines={2}>
                  {selectedWarehouse.address || 'No physical site address recorded yet'}
                </Text>
              </View>
            </View>

            {canManage ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit warehouse facility settings"
                onPress={startEditingWarehouse}
                style={({ pressed }) => [styles.facilitySettingsBtn, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons name="cog-outline" size={17} color={colors.primary} />
                <Text style={styles.facilitySettingsBtnText}>Facility Settings</Text>
              </Pressable>
            ) : null}
          </View>

          {/* Facility Type & Layout Badges */}
          <View style={styles.whMetaPillsRow}>
            {/* Warehouse Type Badge */}
            <View style={styles.whMetaPill}>
              <MaterialCommunityIcons
                name={currentWarehouseTypeMeta.icon}
                size={16}
                color={colors.primary}
              />
              <View>
                <Text style={styles.whMetaPillTitle}>{currentWarehouseTypeMeta.label}</Text>
                <Text style={styles.whMetaPillSubtitle}>{currentWarehouseTypeMeta.tagline}</Text>
              </View>
            </View>

            {/* Configured Layout Badge */}
            <View style={[styles.whMetaPill, styles.whMetaPillLayout]}>
              <MaterialCommunityIcons
                name={currentWarehouseLayoutMeta.icon}
                size={16}
                color={colors.deep}
              />
              <View>
                <Text style={styles.whMetaPillTitle}>{currentWarehouseLayoutMeta.title}</Text>
                <Text style={styles.whMetaPillSubtitle}>{currentWarehouseLayoutMeta.subtitle}</Text>
              </View>
            </View>
          </View>

          {/* Warehouse Selector & Actions */}
          {activeWarehouses.length > 1 ? (
            <View style={styles.whSelectorRow}>
              <View style={{ flex: 1 }}>
                <SelectField
                  label="Switch Active Warehouse"
                  value={activeWarehouseId}
                  onChange={chooseWarehouse}
                  options={activeWarehouses.map((w) => ({
                    value: w.id,
                    label: w.code ? `${w.name} (${w.code})` : w.name,
                    detail: `${humanize(w.warehouse_type || 'general')} · ${humanize(w.warehouse_layout || 'multi_zone')}`,
                  }))}
                />
              </View>
              {canWrite ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add another warehouse"
                  onPress={() => {
                    setWarehouseName('');
                    setWarehouseCode('');
                    setWarehouseAddress('');
                    setWarehouseError(null);
                    setWarehouseFieldErrors({});
                    setCreateWhModalOpen(true);
                  }}
                  style={({ pressed }) => [styles.newWhButton, pressed && styles.pressed]}
                >
                  <MaterialCommunityIcons name="plus" size={18} color={colors.white} />
                  <Text style={styles.newWhButtonText}>New Facility</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            canWrite && (
              <View style={styles.singleWhActionRow}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setWarehouseName('');
                    setWarehouseCode('');
                    setWarehouseAddress('');
                    setWarehouseError(null);
                    setWarehouseFieldErrors({});
                    setCreateWhModalOpen(true);
                  }}
                  style={({ pressed }) => [styles.addAnotherWhLink, pressed && styles.pressed]}
                >
                  <MaterialCommunityIcons name="plus-circle-outline" size={16} color={colors.primary} />
                  <Text style={styles.addAnotherWhLinkText}>Add another warehouse</Text>
                </Pressable>
              </View>
            )
          )}

          {/* Live Real-time Facility Capacity & Zone KPI Grid (Drill-down interactive filters) */}
          <View style={styles.kpiGrid}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Show all locations"
              onPress={() => setActiveFilter('all')}
              style={({ pressed }) => [
                styles.kpiCard,
                activeFilter === 'all' && styles.kpiCardActive,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.kpiCardTop}>
                <MaterialCommunityIcons name="map-marker-multiple-outline" size={17} color={colors.navy} />
                <Text style={styles.kpiValue}>{counts.all}</Text>
              </View>
              <Text style={styles.kpiLabel}>Total Locations</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Filter storage positions"
              onPress={() => setActiveFilter('storage')}
              style={({ pressed }) => [
                styles.kpiCard,
                activeFilter === 'storage' && styles.kpiCardActive,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.kpiCardTop}>
                <MaterialCommunityIcons name="archive-outline" size={17} color={colors.primary} />
                <Text style={[styles.kpiValue, { color: colors.primary }]}>{counts.storage}</Text>
              </View>
              <Text style={styles.kpiLabel}>Storage Positions</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Filter operational areas"
              onPress={() => setActiveFilter('operational')}
              style={({ pressed }) => [
                styles.kpiCard,
                activeFilter === 'operational' && styles.kpiCardActive,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.kpiCardTop}>
                <MaterialCommunityIcons name="truck-fast-outline" size={17} color={colors.deep} />
                <Text style={[styles.kpiValue, { color: colors.deep }]}>{counts.operational}</Text>
              </View>
              <Text style={styles.kpiLabel}>Operational Areas</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Filter quality inspection and hold locations"
              onPress={() => setActiveFilter('quarantine')}
              style={({ pressed }) => [
                styles.kpiCard,
                activeFilter === 'quarantine' && styles.kpiCardActive,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.kpiCardTop}>
                <MaterialCommunityIcons name="shield-alert-outline" size={17} color={colors.warning} />
                <Text style={[styles.kpiValue, { color: colors.warning }]}>{counts.quarantine}</Text>
              </View>
              <Text style={styles.kpiLabel}>Quality Hold</Text>
            </Pressable>

            {counts.blocked > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Filter blocked locations"
                onPress={() => setActiveFilter('blocked')}
                style={({ pressed }) => [
                  styles.kpiCard,
                  styles.kpiCardFull,
                  activeFilter === 'blocked' && styles.kpiCardActive,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.kpiCardTop}>
                  <MaterialCommunityIcons name="alert-circle-outline" size={17} color={colors.warning} />
                  <Text style={[styles.kpiValue, { color: colors.warning }]}>{counts.blocked}</Text>
                </View>
                <Text style={styles.kpiLabel}>Blocked Locations</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : (
        /* Empty State: No Warehouses Exist */
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Create your first warehouse</Text>
          <Text style={styles.formHint}>
            To start tracking inventory, register your physical warehouse, fulfillment center, or
            commercial store.
          </Text>
          <Button
            label="Setup First Facility"
            onPress={() => {
              setWarehouseName('');
              setWarehouseCode('');
              setWarehouseAddress('');
              setWarehouseError(null);
              setWarehouseFieldErrors({});
              setCreateWhModalOpen(true);
            }}
          />
        </View>
      )}

      {/* ========================================================================= */}
      {/* EMPTY WAREHOUSE STARTER TEMPLATE SETUP BANNER */}
      {/* ========================================================================= */}
      {selectedWarehouse && warehouseLocations.length === 0 ? (
        <View style={styles.templateSetupCard}>
          <View style={styles.templateCardHeader}>
            <View style={styles.templateIconBox}>
              <MaterialCommunityIcons
                name="layers-plus"
                size={24}
                color={colors.primary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.templateCardTitle}>No locations configured yet</Text>
              <Text style={styles.templateCardDesc}>
                This facility is configured with the{' '}
                <Text style={{ fontFamily: fonts.bodySemi }}>
                  {currentWarehouseLayoutMeta.title}
                </Text>
                . You can apply the recommended layout starter template or configure custom
                locations from scratch.
              </Text>
            </View>
          </View>

          {/* Template preview items */}
          <View style={styles.templateItemsBox}>
            <Text style={styles.templateItemsHeading}>
              Recommended locations for {currentWarehouseLayoutMeta.title}:
            </Text>
            {currentWarehouseLayoutMeta.starterLocations.map((item, idx) => (
              <View key={idx} style={styles.templateItemRow}>
                <View style={styles.templateItemCodeBox}>
                  <Text style={styles.templateItemCode}>{item.code}</Text>
                  <Badge label={humanize(item.type)} tone="neutral" />
                </View>
                <Text style={styles.templateItemRole}>{item.role}</Text>
              </View>
            ))}
          </View>

          {templateError ? <Text style={styles.errorText}>{templateError}</Text> : null}

          <View style={styles.templateActionsRow}>
            <Button
              label={`Apply Recommended Starter Areas`}
              onPress={() => void handleApplyTemplate()}
              loading={templateLoading}
            />
            <Button
              label="Preview Starter Details"
              variant="secondary"
              onPress={() => void handlePreviewTemplate()}
              loading={templateLoading}
            />
          </View>
        </View>
      ) : null}

      {/* ========================================================================= */}
      {/* LOCATIONS DIRECTORY & SEARCH */}
      {/* ========================================================================= */}
      {selectedWarehouse && warehouseLocations.length > 0 ? (
        <View style={styles.card}>
          <View style={styles.dirHeaderWrapper}>
            <View style={styles.dirHeaderTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Warehouse Areas & Locations</Text>
                <Text style={styles.locationSubtitle}>
                  Operational areas (Receiving, Dispatch, QA) & physical storage addresses ({warehouseLocations.length} total)
                </Text>
              </View>

              {canWrite && currentWarehouseLayoutMeta.supportsCoordinates ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Bulk setup bins"
                  onPress={() => {
                    setBulkModalOpen(true);
                    setBulkPreviewItems(null);
                    setBulkStats(null);
                    setBulkError(null);
                  }}
                  style={({ pressed }) => [styles.bulkButton, pressed && styles.pressed]}
                >
                  <MaterialCommunityIcons
                    name="plus-box-multiple-outline"
                    size={16}
                    color={colors.primary}
                  />
                  <Text style={styles.bulkButtonText}>Bulk Bins</Text>
                </Pressable>
              ) : null}
            </View>

            {/* View Mode Toggle & Educational Guide Trigger */}
            <View style={styles.dirControlsRow}>
              <View style={styles.viewModeToggle}>
                <Pressable
                  onPress={() => setViewMode('hierarchy')}
                  style={[
                    styles.viewModeBtn,
                    viewMode === 'hierarchy' && styles.viewModeBtnActive,
                  ]}
                >
                  <MaterialCommunityIcons
                    name="file-tree"
                    size={15}
                    color={viewMode === 'hierarchy' ? colors.white : colors.muted}
                  />
                  <Text
                    style={[
                      styles.viewModeBtnText,
                      viewMode === 'hierarchy' && styles.viewModeBtnTextActive,
                    ]}
                  >
                    Hierarchy
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setViewMode('flat')}
                  style={[styles.viewModeBtn, viewMode === 'flat' && styles.viewModeBtnActive]}
                >
                  <MaterialCommunityIcons
                    name="view-list"
                    size={15}
                    color={viewMode === 'flat' ? colors.white : colors.muted}
                  />
                  <Text
                    style={[
                      styles.viewModeBtnText,
                      viewMode === 'flat' && styles.viewModeBtnTextActive,
                    ]}
                  >
                    Flat List
                  </Text>
                </Pressable>
              </View>

              <Pressable
                onPress={() => setShowZoneGuide((prev) => !prev)}
                style={({ pressed }) => [styles.zoneGuideToggleBtn, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons
                  name={showZoneGuide ? 'chevron-up' : 'information-outline'}
                  size={15}
                  color={colors.primary}
                />
                <Text style={styles.zoneGuideToggleText}>
                  {showZoneGuide ? 'Hide Concepts Guide' : 'Operational Areas vs Storage Positions'}
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Facility Zones Educational Guide */}
          {showZoneGuide ? (
            <View style={styles.zoneGuideCard}>
              <Text style={styles.zoneGuideHeading}>Understanding Operational Areas vs Storage Positions</Text>
              <Text style={styles.zoneGuideIntroText}>
                In commercial warehousing, a facility divides into two distinct concepts:
                {'\n'}• <Text style={{ fontFamily: fonts.bodySemi }}>Operational Areas</Text>: Functional zones where workflow tasks occur (Receiving, QA check, Packing, Dispatch).
                {'\n'}• <Text style={{ fontFamily: fonts.bodySemi }}>Storage Positions</Text>: Fixed physical coordinate addresses (Racks, Shelves, Bins) where stock is stored.
              </Text>
              <View style={styles.zoneGuideItem}>
                <MaterialCommunityIcons name="tray-arrow-down" size={16} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.zoneGuideItemTitle}>Receiving Dock (RECV) · Operational Area</Text>
                  <Text style={styles.zoneGuideItemDesc}>
                    Inbound arrival dock for supplier deliveries. Shipments arrive here for inspection and staging before put-away into racks. Not pickable by orders.
                  </Text>
                </View>
              </View>
              <View style={styles.zoneGuideItem}>
                <MaterialCommunityIcons name="warehouse" size={16} color={colors.deep} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.zoneGuideItemTitle}>Main Storage (MAIN) · Storage Reserve</Text>
                  <Text style={styles.zoneGuideItemDesc}>
                    High pallet racks and bulk reserve bays. Stores pallet-loads and replenishes picking bins as stock depletes.
                  </Text>
                </View>
              </View>
              <View style={styles.zoneGuideItem}>
                <MaterialCommunityIcons name="package-variant" size={16} color={colors.success} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.zoneGuideItemTitle}>Picking Bins (BIN-01, BIN-02...) · Storage Position</Text>
                  <Text style={styles.zoneGuideItemDesc}>
                    Low-level, accessible forward bins where staff pick items to fulfill outgoing customer orders. Pickable by default.
                  </Text>
                </View>
              </View>
              <View style={styles.zoneGuideItem}>
                <MaterialCommunityIcons name="truck-delivery-outline" size={16} color="#7C3AED" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.zoneGuideItemTitle}>Dispatch Dock (DISP) · Operational Area</Text>
                  <Text style={styles.zoneGuideItemDesc}>
                    Outbound departure point where packed shipments wait for transport carrier pickup.
                  </Text>
                </View>
              </View>
              <View style={styles.zoneGuideItem}>
                <MaterialCommunityIcons name="shield-alert-outline" size={16} color={colors.warning} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.zoneGuideItemTitle}>Quarantine / QA (QC) · Operational Hold</Text>
                  <Text style={styles.zoneGuideItemDesc}>
                    Isolated zone for damaged, expired, or returned goods. Inventory here is strictly blocked from order picking.
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          {/* Search Box */}
          <View style={styles.searchBox}>
            <MaterialCommunityIcons name="magnify" size={18} color={colors.muted} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search by location code, path, type, or barcode..."
              placeholderTextColor={colors.muted}
              style={styles.searchInput}
            />
            {searchQuery ? (
              <Pressable onPress={() => setSearchQuery('')}>
                <MaterialCommunityIcons name="close-circle" size={16} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>

          {/* Filter Pills */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
            <View style={styles.filterRow}>
              <Pressable
                onPress={() => setActiveFilter('all')}
                style={[styles.filterChip, activeFilter === 'all' && styles.filterChipActive]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    activeFilter === 'all' && styles.filterChipTextActive,
                  ]}
                >
                  All Locations ({counts.all})
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setActiveFilter('storage')}
                style={[styles.filterChip, activeFilter === 'storage' && styles.filterChipActive]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    activeFilter === 'storage' && styles.filterChipTextActive,
                  ]}
                >
                  Storage Positions ({counts.storage})
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setActiveFilter('operational')}
                style={[styles.filterChip, activeFilter === 'operational' && styles.filterChipActive]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    activeFilter === 'operational' && styles.filterChipTextActive,
                  ]}
                >
                  Operational Areas ({counts.operational})
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setActiveFilter('quarantine')}
                style={[
                  styles.filterChip,
                  activeFilter === 'quarantine' && styles.filterChipActive,
                ]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    activeFilter === 'quarantine' && styles.filterChipTextActive,
                  ]}
                >
                  Quality Hold ({counts.quarantine})
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setActiveFilter('blocked')}
                style={[styles.filterChip, activeFilter === 'blocked' && styles.filterChipActive]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    activeFilter === 'blocked' && styles.filterChipTextActive,
                  ]}
                >
                  Blocked / Archived ({counts.blocked})
                </Text>
              </Pressable>
            </View>
          </ScrollView>

          {/* Locations Render List (Hierarchical vs Flat) */}
          <View style={styles.listCard}>
            {viewMode === 'hierarchy' && groupedLocations ? (
              <>
                {groupedLocations.topLevel.map((parent) => {
                  const children = groupedLocations.childrenMap[parent.id] ?? [];
                  return (
                    <View key={parent.id} style={styles.hierarchyGroup}>
                      {renderLocationRow(parent, false)}
                      {children.length > 0 ? (
                        <View style={styles.hierarchyChildrenList}>
                          {children.map((child) => renderLocationRow(child, true))}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
                {groupedLocations.orphanChildren.length > 0 ? (
                  <View style={styles.hierarchyGroup}>
                    <Text style={styles.orphanHeading}>Other Locations</Text>
                    {groupedLocations.orphanChildren.map((loc) => renderLocationRow(loc, false))}
                  </View>
                ) : null}
              </>
            ) : (
              filteredLocations.map((location) => renderLocationRow(location, false))
            )}

            {filteredLocations.length === 0 ? (
              <Text style={styles.emptyText}>
                {searchQuery || activeFilter !== 'all'
                  ? 'No locations match your search or filter.'
                  : 'No locations recorded in this warehouse.'}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* ========================================================================= */}
      {/* ADD SINGLE LOCATION FORM (LAYOUT-AWARE) */}
      {/* ========================================================================= */}
      {canWrite && selectedWarehouse ? (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.cardTitle}>Add Single Location</Text>
              <Text style={styles.formHint}>
                Create a location suited for {currentWarehouseLayoutMeta.title}.
              </Text>
            </View>
            <View style={styles.layoutTagPill}>
              <Text style={styles.layoutTagPillText}>{currentWarehouseLayoutMeta.tag}</Text>
            </View>
          </View>

          {/* Layout Guidance Notice */}
          <View
            style={[
              styles.layoutNoticeBox,
              !currentWarehouseLayoutMeta.supportsCoordinates && styles.layoutNoticeBoxFloor,
            ]}
          >
            <MaterialCommunityIcons
              name={currentWarehouseLayoutMeta.icon}
              size={18}
              color={colors.deep}
            />
            <Text style={styles.layoutNoticeText}>{currentWarehouseLayoutMeta.coordinateHelp}</Text>
          </View>

          {/* Location Code & Barcode */}
          <Field
            label="Location code"
            value={code}
            onChangeText={(val) => {
              setCode(val);
              if (!barcode.trim()) {
                const whCode = selectedWarehouse.code || 'WH';
                setBarcode(`${whCode}:${val.trim().toUpperCase()}`);
              }
            }}
            placeholder={
              currentWarehouseLayoutMeta.key === 'all_in_one'
                ? 'e.g. FLOOR-A, STAGING-01'
                : 'e.g. A01-R01-S01-B01 or BIN-02'
            }
            autoCapitalize="characters"
            error={fieldErrors.code}
          />

          <Field
            label="Barcode / Scan Label (optional)"
            value={barcode}
            onChangeText={setBarcode}
            placeholder={`e.g. ${selectedWarehouse.code || 'WH'}:BIN-02`}
            autoCapitalize="characters"
          />

          {/* Location Purpose Selector */}
          <SelectField
            label="Location Purpose / Operational Role"
            value={locationType}
            onChange={handleLocationTypeChange}
            options={LOCATION_PURPOSES.map((purpose) => ({
              value: purpose.key,
              label: `${purpose.label} (${purpose.category})`,
              detail: purpose.operationalRole,
            }))}
          />

          {/* Purpose Explanation Callout */}
          <View style={styles.purposeExplanationBox}>
            <MaterialCommunityIcons
              name={selectedPurposeInfo.icon}
              size={18}
              color={colors.primary}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.purposeExplanationTitle}>
                {selectedPurposeInfo.label} · {selectedPurposeInfo.operationalRole}
              </Text>
              <Text style={styles.purposeExplanationText}>
                {selectedPurposeInfo.explanation}
              </Text>
            </View>
          </View>

          {/* Parent Location Selector */}
          <SelectField
            label="Parent Location (Hierarchy Area / Rack)"
            value={parentId}
            onChange={(value) => setParentId(value === '__none__' ? null : value)}
            options={[
              { value: '__none__', label: 'No parent (top level zone / floor)' },
              ...parentOptions.map((loc) => ({
                value: loc.id,
                label: loc.path ?? loc.code,
                detail: humanize(loc.type),
              })),
            ]}
          />
          <Text style={styles.fieldHelperText}>
            Parent location groups child bins and creates hierarchical paths (e.g. MAIN &gt; BIN-01).
          </Text>

          {/* Layout-Aware Coordinates Section */}
          {currentWarehouseLayoutMeta.supportsCoordinates ? (
            <View style={styles.coordinatesWrapper}>
              <Text style={styles.coordinatesHeader}>
                Rack &amp; Aisle Coordinates ({currentWarehouseLayoutMeta.title})
              </Text>
              <View style={styles.coordRow}>
                <View style={styles.coordCol}>
                  <Field label="Aisle" value={aisle} onChangeText={setAisle} placeholder="01" />
                </View>
                <View style={styles.coordCol}>
                  <Field label="Rack" value={rack} onChangeText={setRack} placeholder="01" />
                </View>
                <View style={styles.coordCol}>
                  <Field label="Shelf" value={shelf} onChangeText={setShelf} placeholder="02" />
                </View>
                {currentWarehouseLayoutMeta.key !== 'bulk_storage' ? (
                  <View style={styles.coordCol}>
                    <Field label="Bin" value={binVal} onChangeText={setBinVal} placeholder="03" />
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}

          {/* Picking Eligibility Checkbox */}
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isPickable }}
            onPress={() => setIsPickable((current) => !current)}
            style={({ pressed }) => [styles.checkRow, pressed && styles.pressed]}
          >
            <MaterialCommunityIcons
              name={isPickable ? 'checkbox-marked' : 'checkbox-blank-outline'}
              size={22}
              color={isPickable ? colors.primary : colors.muted}
            />
            <View style={styles.checkBody}>
              <Text style={styles.checkTitle}>Pickable location</Text>
              <Text style={styles.checkText}>
                Allow inventory in this location to be allocated for customer outbound orders.
              </Text>
            </View>
          </Pressable>

          {/* Status Selector */}
          <SelectField
            label="Initial Status"
            value={statusVal}
            onChange={(val) => setStatusVal(val as 'active' | 'blocked' | 'archived')}
            options={[
              { value: 'active', label: 'Active (Normal operations allowed)' },
              { value: 'blocked', label: 'Blocked (Temporarily frozen; no picks/receipts)' },
              { value: 'archived', label: 'Archived (Decommissioned)' },
            ]}
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <Button
            label="Create Location"
            onPress={() => void handleCreateLocation()}
            loading={saving}
          />
        </View>
      ) : null}

      {/* ========================================================================= */}
      {/* ========================================================================= */}
      {/* MODAL: CREATE WAREHOUSE (2-STEP SETUP WIZARD) */}
      {/* ========================================================================= */}
      <Modal
        visible={createWhModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setCreateWhStep(1);
          setCreateWhModalOpen(false);
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <View style={styles.wizardStepBadgeRow}>
                  <Text style={styles.wizardStepBadge}>
                    {createWhStep === 1
                      ? 'Step 1 of 3: Warehouse Details'
                      : createWhStep === 2
                      ? 'Step 2 of 3: Setup Method'
                      : 'Step 3 of 3: Configure & Preview'}
                  </Text>
                </View>
                <Text style={styles.modalTitle}>
                  {createWhStep === 1
                    ? 'Add New Warehouse'
                    : createWhStep === 2
                    ? 'Choose Warehouse Setup Method'
                    : 'Configure Areas & Storage'}
                </Text>
                <Text style={styles.modalPath}>
                  {createWhStep === 1
                    ? 'Define facility name, code, physical address, type & layout'
                    : createWhStep === 2
                    ? 'Select how you want to configure your physical areas and locations'
                    : 'Review, customize, and preview all physical locations before saving'}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  setCreateWhStep(1);
                  setCreateWhModalOpen(false);
                }}
                style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons name="close" size={22} color={colors.navy} />
              </Pressable>
            </View>

            {createWhStep === 1 ? (
              <ScrollView contentContainerStyle={styles.modalScroll}>
                <Field
                  label="Warehouse Name"
                  value={warehouseName}
                  onChangeText={setWarehouseName}
                  placeholder="e.g. Bengaluru Regional Hub"
                  autoCapitalize="words"
                  error={warehouseFieldErrors.name}
                />

                <Field
                  label="Warehouse Code (Unique ID)"
                  value={warehouseCode}
                  onChangeText={setWarehouseCode}
                  placeholder="e.g. WH-02, BLR-DC"
                  autoCapitalize="characters"
                  error={warehouseFieldErrors.code}
                />

                <Field
                  label="Site Physical Address"
                  value={warehouseAddress}
                  onChangeText={setWarehouseAddress}
                  placeholder="Street address, industrial park, city, PIN code"
                  autoCapitalize="words"
                  multiline
                  error={warehouseFieldErrors.address}
                />

                {/* Warehouse Type Selection */}
                <Text style={styles.modalSectionHeading}>Warehouse Facility Type</Text>
                <View style={styles.typeSelectionGrid}>
                  {WAREHOUSE_TYPES_META.map((t) => {
                    const isSelected = warehouseType === t.key;
                    return (
                      <Pressable
                        key={t.key}
                        onPress={() => {
                          setWarehouseType(t.key);
                          const tmpl = INDUSTRY_ZONE_TEMPLATES[t.key];
                          if (tmpl) {
                            setStarterZones(tmpl.defaultZones);
                          }
                        }}
                        style={[
                          styles.typeSelectCard,
                          isSelected && styles.typeSelectCardActive,
                        ]}
                      >
                        <MaterialCommunityIcons
                          name={t.icon}
                          size={20}
                          color={isSelected ? colors.primary : colors.muted}
                        />
                        <View style={{ flex: 1 }}>
                          <Text
                            style={[
                              styles.typeSelectTitle,
                              isSelected && styles.typeSelectTitleActive,
                            ]}
                          >
                            {t.label}
                          </Text>
                          <Text style={styles.typeSelectTagline}>{t.tagline}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>

                {/* Warehouse Layout Selection */}
                <Text style={styles.modalSectionHeading}>Warehouse Floor Layout</Text>
                <View style={styles.layoutSelectionList}>
                  {WAREHOUSE_LAYOUTS_META.map((l) => {
                    const isSelected = warehouseLayout === l.key;
                    return (
                      <Pressable
                        key={l.key}
                        onPress={() => setWarehouseLayout(l.key)}
                        style={[
                          styles.layoutSelectCard,
                          isSelected && styles.layoutSelectCardActive,
                        ]}
                      >
                        <MaterialCommunityIcons
                          name={l.icon}
                          size={22}
                          color={isSelected ? colors.primary : colors.muted}
                        />
                        <View style={{ flex: 1 }}>
                          <View style={styles.layoutSelectHeader}>
                            <Text
                              style={[
                                styles.layoutSelectTitle,
                                isSelected && styles.layoutSelectTitleActive,
                              ]}
                            >
                              {l.title}
                            </Text>
                            <Badge label={l.tag} tone={isSelected ? 'info' : 'neutral'} />
                          </View>
                          <Text style={styles.layoutSelectSubtitle}>{l.subtitle}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>

                {warehouseError ? <Text style={styles.errorText}>{warehouseError}</Text> : null}

                {/* Step 1 Actions */}
                <View style={styles.buttonCol}>
                  <Button
                    label="Next: Choose Setup Method →"
                    onPress={handleGoToStep2}
                  />
                  <View style={styles.buttonRow}>
                    <Button
                      label="Cancel"
                      variant="secondary"
                      onPress={() => setCreateWhModalOpen(false)}
                      style={styles.flexButton}
                    />
                    <Button
                      label="Skip & Create Blank"
                      variant="secondary"
                      onPress={() => void handleCreateWarehouseSubmit(true)}
                      loading={warehouseSaving}
                      style={styles.flexButton}
                    />
                  </View>
                </View>
              </ScrollView>
            ) : createWhStep === 2 ? (
              <ScrollView contentContainerStyle={styles.modalScroll}>
                {/* Back to Step 1 Bar */}
                <Pressable
                  onPress={() => setCreateWhStep(1)}
                  style={({ pressed }) => [styles.backStepRow, pressed && styles.pressed]}
                >
                  <MaterialCommunityIcons name="arrow-left" size={16} color={colors.primary} />
                  <Text style={styles.backStepText}>Back to Warehouse Details (Name &amp; Layout)</Text>
                </Pressable>

                <View style={styles.stepHeaderBanner}>
                  <View style={styles.stepHeaderDetails}>
                    <Text style={styles.stepHeaderTitle}>{warehouseName || 'New Warehouse'}</Text>
                    <Text style={styles.stepHeaderSubtitle}>
                      {WAREHOUSE_TYPES_META.find((t) => t.key === warehouseType)?.label || 'General'} ·{' '}
                      {WAREHOUSE_LAYOUTS_META.find((l) => l.key === warehouseLayout)?.title || 'Multi-zone'}
                    </Text>
                  </View>
                </View>

                <Text style={styles.modalSectionHeading}>How would you like to set up physical locations?</Text>
                <Text style={styles.modalSectionSubtext}>
                  Choose how to initialize sections and storage positions for this facility. You have full control before anything is saved.
                </Text>

                {/* Choice 1: Quick Setup */}
                <Pressable
                  onPress={handleSelectQuickSetup}
                  style={({ pressed }) => [
                    styles.methodChoiceCard,
                    setupMethod === 'quick' && styles.methodChoiceCardActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.methodChoiceHeader}>
                    <View style={styles.methodIconBox}>
                      <MaterialCommunityIcons name="lightning-bolt" size={22} color={colors.primary} />
                    </View>
                    <View style={styles.methodTitleRow}>
                      <Text style={styles.methodChoiceTitle}>Quick Setup</Text>
                      <Badge label="Suggested Areas" tone="info" />
                    </View>
                  </View>
                  <Text style={styles.methodChoiceTagline}>
                    Suggested areas based on {warehouseType} / {warehouseLayout}
                  </Text>
                  <Text style={styles.methodChoiceDesc}>
                    Pre-populates editable areas (Receiving, Main Storage, Dispatch). You can rename, add, remove sections, and generate bins before saving.
                  </Text>
                  <View style={styles.methodChoiceActionRow}>
                    <Text style={styles.methodChoiceActionText}>Select Quick Setup</Text>
                    <MaterialCommunityIcons name="arrow-right" size={14} color={colors.primary} />
                  </View>
                </Pressable>

                {/* Choice 2: Custom Setup */}
                <Pressable
                  onPress={handleSelectCustomSetup}
                  style={({ pressed }) => [
                    styles.methodChoiceCard,
                    setupMethod === 'custom' && styles.methodChoiceCardActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.methodChoiceHeader}>
                    <View style={[styles.methodIconBox, styles.methodIconBoxCustom]}>
                      <MaterialCommunityIcons name="pencil-ruler" size={22} color="#16A34A" />
                    </View>
                    <View style={styles.methodTitleRow}>
                      <Text style={styles.methodChoiceTitle}>Custom Setup</Text>
                      <Badge label="Start with 0 Areas" tone="neutral" />
                    </View>
                  </View>
                  <Text style={[styles.methodChoiceTagline, { color: '#16A34A' }]}>
                    User-defined physical sections from scratch
                  </Text>
                  <Text style={styles.methodChoiceDesc}>
                    Starts with zero areas. Define your exact physical sections, human names, unique codes, operational purposes, and quantities with no unwanted defaults.
                  </Text>
                  <View style={styles.methodChoiceActionRow}>
                    <Text style={[styles.methodChoiceActionText, { color: '#16A34A' }]}>Select Custom Setup</Text>
                    <MaterialCommunityIcons name="arrow-right" size={14} color="#16A34A" />
                  </View>
                </Pressable>

                {/* Choice 3: Set Up Later */}
                <Pressable
                  onPress={() => void handleCreateWarehouseSubmit(true)}
                  style={({ pressed }) => [
                    styles.methodChoiceCard,
                    setupMethod === 'later' && styles.methodChoiceCardActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.methodChoiceHeader}>
                    <View style={[styles.methodIconBox, styles.methodIconBoxLater]}>
                      <MaterialCommunityIcons name="clock-outline" size={22} color={colors.muted} />
                    </View>
                    <View style={styles.methodTitleRow}>
                      <Text style={styles.methodChoiceTitle}>Set Up Later</Text>
                      <Badge label="0 Locations" tone="neutral" />
                    </View>
                  </View>
                  <Text style={[styles.methodChoiceTagline, { color: colors.muted }]}>
                    Create warehouse with zero locations
                  </Text>
                  <Text style={styles.methodChoiceDesc}>
                    Creates the warehouse immediately with no locations. You can manually add areas, aisles, or import bins at any time later.
                  </Text>
                  <View style={styles.methodChoiceActionRow}>
                    <Text style={[styles.methodChoiceActionText, { color: colors.navy }]}>
                      {warehouseSaving ? 'Creating...' : 'Create Blank Warehouse Now'}
                    </Text>
                    <MaterialCommunityIcons name="arrow-right" size={14} color={colors.navy} />
                  </View>
                </Pressable>

                {warehouseError ? <Text style={styles.errorText}>{warehouseError}</Text> : null}

                <View style={styles.buttonRow}>
                  <Button
                    label="← Back to Details"
                    variant="secondary"
                    onPress={() => setCreateWhStep(1)}
                    style={styles.flexButton}
                  />
                  <Button
                    label="Cancel"
                    variant="secondary"
                    onPress={() => setCreateWhModalOpen(false)}
                    style={styles.flexButton}
                  />
                </View>
              </ScrollView>
            ) : (
              <ScrollView contentContainerStyle={styles.modalScroll}>
                {/* Back to Step 2 Bar */}
                <Pressable
                  onPress={() => setCreateWhStep(2)}
                  style={({ pressed }) => [styles.backStepRow, pressed && styles.pressed]}
                >
                  <MaterialCommunityIcons name="arrow-left" size={16} color={colors.primary} />
                  <Text style={styles.backStepText}>Back to Setup Method Choice</Text>
                </Pressable>

                {/* Mode Indicator Banner */}
                <View style={styles.stepHeaderBanner}>
                  <View style={styles.stepHeaderDetails}>
                    <Text style={styles.stepHeaderTitle}>
                      {setupMethod === 'quick' ? 'Quick Setup Mode' : 'Custom Setup Mode'}
                    </Text>
                    <Text style={styles.stepHeaderSubtitle}>
                      {setupMethod === 'quick'
                        ? 'Suggested areas loaded. Rename, adjust, add or remove sections freely.'
                        : 'Define your real physical sections below. Zero default areas are assumed.'}
                    </Text>
                  </View>
                  <Badge
                    label={setupMethod === 'quick' ? 'Quick Setup' : 'Custom Setup'}
                    tone={setupMethod === 'quick' ? 'info' : 'success'}
                  />
                </View>

                {/* Custom Section Batch Adder (For Custom Setup) */}
                {setupMethod === 'custom' ? (
                  <View style={styles.sectionAdderBox}>
                    <View style={styles.sectionAdderHeader}>
                      <MaterialCommunityIcons name="plus-circle-outline" size={18} color={colors.primary} />
                      <Text style={styles.sectionAdderTitle}>Add Physical Section / Area</Text>
                    </View>
                    <Text style={styles.sectionAdderDesc}>
                      Define an actual physical area. Enter a quantity &gt; 1 to generate numbered sections at once (e.g. 3 Cold Rooms or 2 Receiving Docks).
                    </Text>
                    <View style={styles.sectionAdderRow}>
                      <View style={{ width: 110 }}>
                        <Field
                          label="Code Prefix"
                          value={newSectionCode}
                          onChangeText={(v) => setNewSectionCode(v.toUpperCase())}
                          placeholder="ROOM"
                          autoCapitalize="characters"
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Field
                          label="Section Name"
                          value={newSectionName}
                          onChangeText={setNewSectionName}
                          placeholder="Cold Storage Room"
                        />
                      </View>
                    </View>
                    <View style={styles.sectionAdderRow}>
                      <View style={{ flex: 1 }}>
                        <SelectField
                          label="Operational Purpose"
                          value={newSectionType}
                          onChange={setNewSectionType}
                          options={LOCATION_PURPOSES.map((p) => ({
                            value: p.key,
                            label: `${p.label} (${p.category})`,
                          }))}
                        />
                      </View>
                      <View style={{ width: 80 }}>
                        <Field
                          label="Quantity"
                          value={newSectionQty}
                          onChangeText={setNewSectionQty}
                          keyboardType="number-pad"
                          placeholder="1"
                        />
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Pressable
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: newSectionPickable }}
                        onPress={() => setNewSectionPickable((p) => !p)}
                        style={styles.pickableInlineCheck}
                      >
                        <MaterialCommunityIcons
                          name={newSectionPickable ? 'checkbox-marked' : 'checkbox-blank-outline'}
                          size={18}
                          color={newSectionPickable ? colors.primary : colors.muted}
                        />
                        <Text style={styles.pickableInlineLabel}>Pickable Area</Text>
                      </Pressable>
                      <Button
                        label="+ Add Section"
                        onPress={handleAddCustomSection}
                        variant="secondary"
                      />
                    </View>
                  </View>
                ) : null}

                {/* SECTION 1: CONFIGURED PHYSICAL AREAS */}
                <View style={styles.wizardSectionBox}>
                  <View style={styles.wizardSectionHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.wizardSectionTitle}>
                        Physical Areas &amp; Sections ({configuredAreas.length})
                      </Text>
                      <Text style={styles.wizardSectionDesc}>
                        {setupMethod === 'quick'
                          ? 'Review and adjust suggested areas. You can customize codes, names, or remove unwanted ones.'
                          : 'Defined physical areas in this facility. Every area requires a unique code.'}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      onPress={handleAddArea}
                      style={({ pressed }) => [styles.addAreaSmallBtn, pressed && styles.pressed]}
                    >
                      <MaterialCommunityIcons name="plus" size={16} color={colors.primary} />
                      <Text style={styles.addAreaSmallBtnText}>Add Area</Text>
                    </Pressable>
                  </View>

                  {configuredAreas.length === 0 ? (
                    <View style={styles.emptyAreasState}>
                      <MaterialCommunityIcons name="map-marker-question-outline" size={28} color={colors.muted} />
                      <Text style={styles.emptyAreasStateText}>
                        No physical areas added yet.{'\n'}Use the &apos;Add Physical Section&apos; form above to define your warehouse areas.
                      </Text>
                    </View>
                  ) : (
                    configuredAreas.map((area) => (
                      <View key={area.id} style={styles.configuredAreaCard}>
                        <View style={styles.configuredAreaTopRow}>
                          <View style={{ flex: 1, flexDirection: 'row', gap: 8 }}>
                            <View style={{ width: 100 }}>
                              <Field
                                label="Code"
                                value={area.code}
                                onChangeText={(val) =>
                                  handleUpdateArea(area.id, { code: val.toUpperCase() })
                                }
                                placeholder="MAIN"
                                autoCapitalize="characters"
                              />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Field
                                label="Display Label"
                                value={area.name}
                                onChangeText={(val) => handleUpdateArea(area.id, { name: val })}
                                placeholder="Main Storage"
                              />
                            </View>
                          </View>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Remove area ${area.code}`}
                            onPress={() => handleRemoveArea(area.id)}
                            style={({ pressed }) => [styles.removeAreaBtn, pressed && styles.pressed]}
                          >
                            <MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.danger} />
                          </Pressable>
                        </View>

                        {/* Purpose selector & pickable checkbox */}
                        <View style={styles.configuredAreaMetaRow}>
                          <View style={{ flex: 1 }}>
                            <SelectField
                              label="Area Purpose"
                              value={area.type}
                              onChange={(val) => handleUpdateArea(area.id, { type: val })}
                              options={LOCATION_PURPOSES.map((p) => ({
                                value: p.key,
                                label: `${p.label} (${p.category})`,
                              }))}
                            />
                          </View>
                          <Pressable
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: area.isPickable }}
                            onPress={() =>
                              handleUpdateArea(area.id, { isPickable: !area.isPickable })
                            }
                            style={styles.pickableInlineCheck}
                          >
                            <MaterialCommunityIcons
                              name={area.isPickable ? 'checkbox-marked' : 'checkbox-blank-outline'}
                              size={18}
                              color={area.isPickable ? colors.primary : colors.muted}
                            />
                            <Text style={styles.pickableInlineLabel}>Pickable</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))
                  )}
                </View>

                {/* SECTION 2: OPTIONAL PHYSICAL STORAGE (RACKS, BINS OR FLAT FLOOR POSITIONS) */}
                <View style={styles.wizardSectionBox}>
                  <Text style={styles.wizardSectionTitle}>
                    Optional Physical Storage (Racks, Shelves &amp; Floor Positions)
                  </Text>

                  {warehouseLayout === 'all_in_one' ? (
                    <View style={{ gap: spacing.sm }}>
                      <View style={styles.flatLayoutNoticeCard}>
                        <MaterialCommunityIcons name="floor-plan" size={24} color={colors.deep} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.flatLayoutNoticeTitle}>Open-Floor / Flat Layout</Text>
                          <Text style={styles.flatLayoutNoticeDesc}>
                            Physical racks and shelves are optional for simple open-floor warehouses. Stock can be placed directly in the configured areas.
                          </Text>
                        </View>
                      </View>

                      <Pressable
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: floorPositionsEnabled }}
                        onPress={() => setFloorPositionsEnabled((prev) => !prev)}
                        style={styles.rackToggleRow}
                      >
                        <MaterialCommunityIcons
                          name={floorPositionsEnabled ? 'checkbox-marked' : 'checkbox-blank-outline'}
                          size={22}
                          color={floorPositionsEnabled ? colors.primary : colors.muted}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rackToggleTitle}>
                            Generate numbered floor positions / bays (optional)
                          </Text>
                          <Text style={styles.rackToggleDesc}>
                            Creates numbered storage positions (e.g. BAY-01 to BAY-06) under a parent area.
                          </Text>
                        </View>
                      </Pressable>

                      {floorPositionsEnabled ? (
                        <View style={styles.rackConfigContainer}>
                          <SelectField
                            label="Parent Storage Area"
                            value={floorParentCode}
                            onChange={setFloorParentCode}
                            options={configuredAreas
                              .filter((a) => !a.isOperational)
                              .map((a) => ({
                                value: a.code,
                                label: `${a.code} — ${a.name} (${humanize(a.type)})`,
                              }))}
                          />
                          <View style={styles.rackInputsGrid}>
                            <View style={{ width: 120 }}>
                              <Field
                                label="Bay Prefix"
                                value={floorPositionPrefix}
                                onChangeText={(v) => setFloorPositionPrefix(v.toUpperCase())}
                                placeholder="BAY"
                                autoCapitalize="characters"
                              />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Field
                                label="Number of Positions"
                                value={floorPositionCount}
                                onChangeText={setFloorPositionCount}
                                keyboardType="number-pad"
                                placeholder="6"
                              />
                            </View>
                          </View>
                        </View>
                      ) : null}
                    </View>
                  ) : (
                    <>
                      <Pressable
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: rackConfigEnabled }}
                        onPress={() => setRackConfigEnabled((prev) => !prev)}
                        style={styles.rackToggleRow}
                      >
                        <MaterialCommunityIcons
                          name={rackConfigEnabled ? 'checkbox-marked' : 'checkbox-blank-outline'}
                          size={22}
                          color={rackConfigEnabled ? colors.primary : colors.muted}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rackToggleTitle}>
                            Generate structured rack and bin positions (optional)
                          </Text>
                          <Text style={styles.rackToggleDesc}>
                            Creates coordinate-based physical bins under a parent storage area.
                          </Text>
                        </View>
                      </Pressable>

                      {rackConfigEnabled ? (
                        <View style={styles.rackConfigContainer}>
                          {/* Parent Area */}
                          <SelectField
                            label="Parent Storage Area"
                            value={rackParentCode}
                            onChange={setRackParentCode}
                            options={configuredAreas
                              .filter((a) => !a.isOperational)
                              .map((a) => ({
                                value: a.code,
                                label: `${a.code} — ${a.name} (${humanize(a.type)})`,
                              }))}
                          />

                          {/* Dimensions 4-column grid */}
                          <Text style={styles.rackGridHeading}>Rack &amp; Bin Dimensions</Text>
                          <View style={styles.rackInputsGrid}>
                            <View style={styles.rackInputCol}>
                              <Field
                                label="Aisles"
                                value={rackAisles}
                                onChangeText={setRackAisles}
                                keyboardType="number-pad"
                                placeholder="2"
                              />
                            </View>
                            <View style={styles.rackInputCol}>
                              <Field
                                label="Racks/Aisle"
                                value={rackRacksPerAisle}
                                onChangeText={setRackRacksPerAisle}
                                keyboardType="number-pad"
                                placeholder="3"
                              />
                            </View>
                            <View style={styles.rackInputCol}>
                              <Field
                                label="Shelves/Rack"
                                value={rackShelvesPerRack}
                                onChangeText={setRackShelvesPerRack}
                                keyboardType="number-pad"
                                placeholder="4"
                              />
                            </View>
                            <View style={styles.rackInputCol}>
                              <Field
                                label="Bins/Shelf"
                                value={rackBinsPerShelf}
                                onChangeText={setRackBinsPerShelf}
                                keyboardType="number-pad"
                                placeholder="2"
                              />
                            </View>
                          </View>

                          {/* Live summary and preview */}
                          {(() => {
                            const { bins, error: binErr } = computeGeneratedBins();
                            return (
                              <View style={styles.rackSummaryBox}>
                                <View style={styles.rackSummaryHeader}>
                                  <MaterialCommunityIcons
                                    name="calculator-variant-outline"
                                    size={18}
                                    color={colors.primary}
                                  />
                                  <Text style={styles.rackSummaryTitle}>
                                    {binErr ? 'Configuration Error' : `Total Physical Bins: ${bins.length}`}
                                  </Text>
                                </View>
                                {binErr ? (
                                  <Text style={styles.errorText}>{binErr}</Text>
                                ) : (
                                  <>
                                    <Text style={styles.rackSummarySample}>
                                      Sample code format:{' '}
                                      <Text style={{ fontFamily: fonts.bodySemi, color: colors.navy }}>
                                        {bins[0]?.code ?? 'A01-R01-S01-B01'}
                                      </Text>
                                    </Text>
                                    <Pressable
                                      onPress={() => setRackPreviewOpen((p) => !p)}
                                      style={styles.previewCodesToggle}
                                    >
                                      <Text style={styles.previewCodesToggleText}>
                                        {rackPreviewOpen ? 'Hide code preview' : `Preview sample codes (${Math.min(bins.length, 12)} of ${bins.length})`}
                                      </Text>
                                      <MaterialCommunityIcons
                                        name={rackPreviewOpen ? 'chevron-up' : 'chevron-down'}
                                        size={16}
                                        color={colors.primary}
                                      />
                                    </Pressable>
                                    {rackPreviewOpen && bins.length > 0 ? (
                                      <View style={styles.sampleCodesChipGrid}>
                                        {bins.slice(0, 12).map((b, i) => (
                                          <View key={i} style={styles.sampleCodeChip}>
                                            <Text style={styles.sampleCodeChipText}>{b.code}</Text>
                                          </View>
                                        ))}
                                        {bins.length > 12 ? (
                                          <Text style={styles.sampleCodesMore}>
                                            ...and {bins.length - 12} more bins
                                          </Text>
                                        ) : null}
                                      </View>
                                    ) : null}
                                  </>
                                )}
                              </View>
                            );
                          })()}
                        </View>
                      ) : null}
                    </>
                  )}
                </View>

                {/* SECTION 3: LIVE PREVIEW BEFORE SAVING */}
                {(() => {
                  const { bins } = computeGeneratedBins();
                  const totalCount = configuredAreas.length + bins.length;
                  return (
                    <View style={styles.previewCardWrapper}>
                      <View style={styles.previewSectionHeader}>
                        <View>
                          <Text style={styles.previewSectionTitle}>
                            Live Location Preview ({totalCount} Total)
                          </Text>
                          <Text style={styles.previewSectionSubtitle}>
                            Confirm exact physical locations before creating warehouse
                          </Text>
                        </View>
                        <Badge
                          label={`${totalCount} to Create`}
                          tone={totalCount > 0 ? 'info' : 'neutral'}
                        />
                      </View>

                      {/* Summary stats */}
                      <View style={styles.previewStatsRow}>
                        <View style={styles.previewStatCol}>
                          <Text style={styles.previewStatNum}>{totalCount}</Text>
                          <Text style={styles.previewStatLabel}>Total Locations</Text>
                        </View>
                        <View style={styles.previewStatCol}>
                          <Text style={styles.previewStatNum}>{configuredAreas.length}</Text>
                          <Text style={styles.previewStatLabel}>Physical Areas</Text>
                        </View>
                        <View style={styles.previewStatCol}>
                          <Text style={styles.previewStatNum}>{bins.length}</Text>
                          <Text style={styles.previewStatLabel}>Sub-Locations / Bins</Text>
                        </View>
                      </View>

                      {/* Area breakdown */}
                      {configuredAreas.length > 0 ? (
                        <View style={styles.previewAreasList}>
                          {configuredAreas.map((area) => (
                            <View key={area.id} style={styles.previewAreaRow}>
                              <View style={styles.previewAreaLeft}>
                                <Text style={styles.previewAreaCode}>{area.code}</Text>
                                <Text style={styles.previewAreaName} numberOfLines={1}>
                                  {area.name}
                                </Text>
                              </View>
                              <View style={styles.previewAreaRight}>
                                <Badge
                                  label={humanize(area.type)}
                                  tone={area.isOperational ? 'neutral' : 'info'}
                                />
                                {area.isPickable ? (
                                  <Badge label="Pickable" tone="success" />
                                ) : null}
                              </View>
                            </View>
                          ))}
                        </View>
                      ) : (
                        <Text style={styles.previewMore}>
                          Zero areas configured. Warehouse will be created completely blank.
                        </Text>
                      )}

                      {bins.length > 0 ? (
                        <Text style={styles.previewMore}>
                          Plus {bins.length} storage positions under {bins[0]?.parent_code || 'storage'} (e.g. {bins[0]?.code})
                        </Text>
                      ) : null}
                    </View>
                  );
                })()}

                {warehouseError ? <Text style={styles.errorText}>{warehouseError}</Text> : null}

                {/* Step 3 Action Buttons */}
                {(() => {
                  const { bins } = computeGeneratedBins();
                  const totalLocs = configuredAreas.length + bins.length;
                  return (
                    <View style={styles.buttonCol}>
                      <Button
                        label={`Confirm & Create Warehouse (${totalLocs} Locations)`}
                        onPress={() => void handleCreateWarehouseSubmit(false)}
                        loading={warehouseSaving}
                      />
                      <View style={styles.buttonRow}>
                        <Button
                          label="← Back to Setup Method"
                          variant="secondary"
                          onPress={() => setCreateWhStep(2)}
                          style={styles.flexButton}
                        />
                        <Button
                          label="Cancel"
                          variant="secondary"
                          onPress={() => setCreateWhModalOpen(false)}
                          style={styles.flexButton}
                        />
                      </View>
                    </View>
                  );
                })()}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL: EDIT WAREHOUSE / FACILITY SETTINGS */}
      {/* ========================================================================= */}
      <Modal
        visible={editingWarehouse}
        transparent
        animationType="slide"
        onRequestClose={() => setEditingWarehouse(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Facility Settings</Text>
                <Text style={styles.modalPath}>
                  Update {selectedWarehouse?.name ?? 'Warehouse'} configuration
                </Text>
              </View>
              <Pressable
                onPress={() => setEditingWarehouse(false)}
                style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons name="close" size={22} color={colors.navy} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalScroll}>
              <Field
                label="Warehouse Name"
                value={editName}
                onChangeText={setEditName}
                placeholder="Warehouse Name"
                autoCapitalize="words"
              />
              <Field
                label="Warehouse Code"
                value={editCode}
                onChangeText={setEditCode}
                placeholder="WH-01"
                autoCapitalize="characters"
              />
              <Field
                label="Site Address"
                value={editAddress}
                onChangeText={setEditAddress}
                placeholder="Street, area, city, PIN"
                autoCapitalize="words"
                multiline
              />

              <SelectField
                label="Warehouse Type"
                value={editType}
                onChange={(val) => setEditType(val as WarehouseType)}
                options={WAREHOUSE_TYPES_META.map((t) => ({
                  value: t.key,
                  label: t.label,
                  detail: t.tagline,
                }))}
              />

              <SelectField
                label="Configured Layout"
                value={editLayout}
                onChange={(val) => setEditLayout(val as WarehouseLayout)}
                options={WAREHOUSE_LAYOUTS_META.map((l) => ({
                  value: l.key,
                  label: l.title,
                  detail: l.subtitle,
                }))}
              />

              <SelectField
                label="Status"
                value={editStatus}
                onChange={setEditStatus}
                options={[
                  { value: 'active', label: 'Active (Operational)' },
                  { value: 'archived', label: 'Archived (Deactivated)' },
                ]}
              />

              {editError ? <Text style={styles.errorText}>{editError}</Text> : null}

              <View style={styles.buttonRow}>
                <Button
                  label="Cancel"
                  variant="secondary"
                  onPress={() => setEditingWarehouse(false)}
                  style={styles.flexButton}
                />
                <Button
                  label="Save Settings"
                  onPress={() => void saveWarehouseEdits()}
                  loading={editSaving}
                  style={styles.flexButton}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL: TEMPLATE PREVIEW MODAL */}
      {/* ========================================================================= */}
      <Modal
        visible={templatePreviewModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setTemplatePreviewModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Starter Template Preview</Text>
                <Text style={styles.modalPath}>
                  {currentWarehouseLayoutMeta.title} ({currentWarehouseLayoutMeta.tag})
                </Text>
              </View>
              <Pressable
                onPress={() => setTemplatePreviewModalOpen(false)}
                style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons name="close" size={22} color={colors.navy} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalScroll}>
              <Text style={styles.formHint}>
                The following locations will be initialized in your warehouse. You can rename,
                adjust, or add more locations at any time.
              </Text>

              {templatePreviewItems.map((item, idx) => (
                <View key={idx} style={styles.templatePreviewCard}>
                  <View style={styles.templatePreviewTop}>
                    <Text style={styles.templatePreviewCode}>{item.code}</Text>
                    <Badge label={humanize(item.type)} tone="neutral" />
                    <Badge
                      label={item.is_pickable ? 'Pickable' : 'Storage'}
                      tone={item.is_pickable ? 'success' : 'info'}
                    />
                  </View>
                  <Text style={styles.templatePreviewDesc}>{item.description}</Text>
                </View>
              ))}

              <View style={styles.buttonRow}>
                <Button
                  label="Cancel"
                  variant="secondary"
                  onPress={() => setTemplatePreviewModalOpen(false)}
                  style={styles.flexButton}
                />
                <Button
                  label="Confirm & Apply"
                  onPress={() => void handleApplyTemplate()}
                  loading={templateLoading}
                  style={styles.flexButton}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL: LOCATION INSPECTOR */}
      {/* ========================================================================= */}
      <Modal
        visible={Boolean(inspectedLocation)}
        transparent
        animationType="slide"
        onRequestClose={() => setInspectedLocation(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>
                  {inspectedLocation?.code ?? 'Location Details'}
                </Text>
                <Text style={styles.modalPath}>
                  {inspectedLocation?.path?.replace(/\//g, ' > ') ?? inspectedLocation?.code}
                </Text>
              </View>
              <Pressable
                onPress={() => setInspectedLocation(null)}
                style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons name="close" size={22} color={colors.navy} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalScroll}>
              {/* QR Code Card */}
              {inspectedLocation ? (
                <View style={styles.qrCard}>
                  <View style={styles.qrWrapper}>
                    <QRCode
                      value={
                        inspectedLocation.barcode ||
                        inspectedLocation.path ||
                        inspectedLocation.code
                      }
                      size={140}
                      color={colors.navy}
                      backgroundColor={colors.white}
                    />
                  </View>
                  <Text style={styles.qrCodeLabel}>
                    BARCODE: {inspectedLocation.barcode || inspectedLocation.code}
                  </Text>
                  <Pressable
                    onPress={async () => {
                      const val = inspectedLocation.barcode || inspectedLocation.code;
                      await Clipboard.setStringAsync(val);
                      setCopiedBarcode(true);
                      setTimeout(() => setCopiedBarcode(false), 2000);
                    }}
                    style={styles.copyBtn}
                  >
                    <MaterialCommunityIcons
                      name={copiedBarcode ? 'check' : 'content-copy'}
                      size={14}
                      color={colors.primary}
                    />
                    <Text style={styles.copyBtnText}>
                      {copiedBarcode ? 'Copied!' : 'Copy Code'}
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              {/* Status and Operations */}
              {inspectedLocation ? (
                <View style={styles.metaBox}>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaKey}>Purpose</Text>
                    <Text style={styles.metaVal}>{humanize(inspectedLocation.type)}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaKey}>Status</Text>
                    <Badge
                      label={humanize(inspectedLocation.status)}
                      tone={
                        inspectedLocation.status === 'active'
                          ? 'success'
                          : inspectedLocation.status === 'blocked'
                            ? 'warning'
                            : 'neutral'
                      }
                    />
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaKey}>Outbound Picking</Text>
                    <Badge
                      label={inspectedLocation.is_pickable ? 'Pickable' : 'Storage Only'}
                      tone={inspectedLocation.is_pickable ? 'success' : 'info'}
                    />
                  </View>
                  {(inspectedLocation.aisle ||
                    inspectedLocation.rack ||
                    inspectedLocation.shelf ||
                    inspectedLocation.bin) && (
                    <View style={styles.metaRow}>
                      <Text style={styles.metaKey}>Coordinates</Text>
                      <Text style={styles.metaVal}>
                        Aisle: {inspectedLocation.aisle || '-'} · Rack:{' '}
                        {inspectedLocation.rack || '-'} · Shelf:{' '}
                        {inspectedLocation.shelf || '-'} · Bin: {inspectedLocation.bin || '-'}
                      </Text>
                    </View>
                  )}
                  {inspectedLocation.capacity ? (
                    <View style={styles.metaRow}>
                      <Text style={styles.metaKey}>Capacity Limit</Text>
                      <Text style={[styles.metaVal, { fontFamily: fonts.bodySemi, color: colors.navy }]}>
                        {formatQty(String(inspectedLocation.capacity))} units
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* Preferred Items Assigned */}
              <View style={styles.balancesSection}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <MaterialCommunityIcons name="star-box-outline" size={17} color={colors.primary} />
                    <Text style={styles.balancesTitle}>Preferred Catalogue Items</Text>
                  </View>
                  <Text style={styles.assignedCountBadge}>
                    {(inspectedLocation?.preferred_items || []).length} assigned
                  </Text>
                </View>

                {inspectedLocation?.preferred_items && inspectedLocation.preferred_items.length > 0 ? (
                  <View style={styles.preferredItemsList}>
                    {inspectedLocation.preferred_items.map((pi, piIdx) => (
                      <View key={`${pi.item_id}-${piIdx}`} style={styles.preferredItemRow}>
                        <View style={styles.preferredItemIcon}>
                          <MaterialCommunityIcons name="package-variant" size={16} color={colors.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.preferredItemSku}>{pi.sku}</Text>
                          <Text style={styles.preferredItemName} numberOfLines={1}>{pi.name}</Text>
                        </View>
                        <Badge label="PREFERRED" tone="info" />
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.emptyBalanceText}>
                    No catalogue items currently assign this location as their preferred bin.
                  </Text>
                )}
              </View>

              {/* Live Inventory Balances */}
              <View style={styles.balancesSection}>
                <Text style={styles.balancesTitle}>Current Stored Inventory</Text>
                {loadingBalances ? (
                  <View style={styles.loadingBox}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={styles.loadingText}>Fetching live balances...</Text>
                  </View>
                ) : balances.length > 0 ? (
                  <View style={styles.balanceList}>
                    {balances.map((b) => (
                      <View key={b.id} style={styles.balanceItem}>
                        <View style={styles.balanceHeader}>
                          <Text style={styles.balanceSku}>{b.sku ?? 'SKU'}</Text>
                          <Text style={styles.balanceQty}>{formatQty(b.on_hand)} on hand</Text>
                        </View>
                        <Text style={styles.balanceName}>{b.item_name ?? 'Item'}</Text>
                        <View style={styles.balanceDetails}>
                          <Text style={styles.balanceSubtext}>
                            Available: {formatQty(b.available)} · Reserved: {formatQty(b.reserved)}
                          </Text>
                          {b.lot_no ? (
                            <Text style={styles.balanceLot}>Lot: {b.lot_no}</Text>
                          ) : null}
                          {b.serial_no ? (
                            <Text style={styles.balanceLot}>Serial: {b.serial_no}</Text>
                          ) : null}
                        </View>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.emptyBalanceText}>
                    No stock currently stored in this location.
                  </Text>
                )}
              </View>

              {/* Actions */}
              {canWrite && inspectedLocation ? (
                <View style={styles.inspectorActions}>
                  <Button
                    label="Edit location details"
                    variant="secondary"
                    onPress={() => openEditLocationModal(inspectedLocation)}
                  />
                  <View style={styles.buttonRow}>
                    <Button
                      label={
                        inspectedLocation.status === 'blocked' ? 'Unblock Location' : 'Block Location'
                      }
                      variant="secondary"
                      loading={statusActionSaving}
                      onPress={() => void toggleLocationStatus()}
                      style={styles.flexButton}
                    />
                    <Button
                      label={inspectedLocation.is_pickable ? 'Make Storage Only' : 'Make Pickable'}
                      variant="secondary"
                      loading={statusActionSaving}
                      onPress={() => void toggleLocationPickable()}
                      style={styles.flexButton}
                    />
                  </View>
                </View>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL: EDIT LOCATION */}
      {/* ========================================================================= */}
      <Modal
        visible={editLocModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setEditLocModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Location</Text>
              <Pressable
                onPress={() => setEditLocModalOpen(false)}
                style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons name="close" size={22} color={colors.navy} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalScroll}>
              <Field
                label="Location code"
                value={editLocCode}
                onChangeText={setEditLocCode}
                autoCapitalize="characters"
              />
              <Field
                label="Barcode label"
                value={editLocBarcode}
                onChangeText={setEditLocBarcode}
                autoCapitalize="characters"
              />
              <SelectField
                label="Purpose / Operational Role"
                value={editLocType}
                onChange={setEditLocType}
                options={LOCATION_PURPOSES.map((t) => ({
                  value: t.key,
                  label: `${t.label} (${t.category})`,
                  detail: t.operationalRole,
                }))}
              />
              <SelectField
                label="Status"
                value={editLocStatus}
                onChange={(val) =>
                  setEditLocStatus(val as 'active' | 'blocked' | 'archived')
                }
                options={[
                  { value: 'active', label: 'Active (Operational)' },
                  { value: 'blocked', label: 'Blocked (Freeze movements)' },
                  { value: 'archived', label: 'Archived (Retired)' },
                ]}
              />

              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: editLocPickable }}
                onPress={() => setEditLocPickable((prev) => !prev)}
                style={styles.checkRow}
              >
                <MaterialCommunityIcons
                  name={editLocPickable ? 'checkbox-marked' : 'checkbox-blank-outline'}
                  size={22}
                  color={editLocPickable ? colors.primary : colors.muted}
                />
                <View style={styles.checkBody}>
                  <Text style={styles.checkTitle}>Pickable location</Text>
                  <Text style={styles.checkText}>Allow picking for outbound order allocations</Text>
                </View>
              </Pressable>

              {currentWarehouseLayoutMeta.supportsCoordinates ? (
                <View style={styles.coordRow}>
                  <View style={styles.coordCol}>
                    <Field
                      label="Aisle"
                      value={editLocAisle}
                      onChangeText={setEditLocAisle}
                      placeholder="01"
                    />
                  </View>
                  <View style={styles.coordCol}>
                    <Field
                      label="Rack"
                      value={editLocRack}
                      onChangeText={setEditLocRack}
                      placeholder="01"
                    />
                  </View>
                  <View style={styles.coordCol}>
                    <Field
                      label="Shelf"
                      value={editLocShelf}
                      onChangeText={setEditLocShelf}
                      placeholder="02"
                    />
                  </View>
                  {currentWarehouseLayoutMeta.key !== 'bulk_storage' ? (
                    <View style={styles.coordCol}>
                      <Field
                        label="Bin"
                        value={editLocBin}
                        onChangeText={setEditLocBin}
                        placeholder="03"
                      />
                    </View>
                  ) : null}
                </View>
              ) : null}

              {editLocError ? <Text style={styles.errorText}>{editLocError}</Text> : null}

              <View style={styles.buttonRow}>
                <Button
                  label="Cancel"
                  variant="secondary"
                  onPress={() => setEditLocModalOpen(false)}
                  style={styles.flexButton}
                />
                <Button
                  label="Save Changes"
                  onPress={() => void saveEditedLocation()}
                  loading={editLocSaving}
                  style={styles.flexButton}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL: BULK GENERATOR */}
      {/* ========================================================================= */}
      <Modal
        visible={bulkModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setBulkModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Bulk Setup Bins</Text>
                <Text style={styles.modalPath}>
                  Generate coordinate-based bin codes in batch
                </Text>
              </View>
              <Pressable
                onPress={() => setBulkModalOpen(false)}
                style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons name="close" size={22} color={colors.navy} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalScroll}>
              <Field
                label="Code Prefix (optional)"
                value={bulkPrefix}
                onChangeText={setBulkPrefix}
                placeholder="A or ZONE1"
                autoCapitalize="characters"
              />
              <SelectField
                label="Parent Location"
                value={bulkParentId}
                onChange={(value) => setBulkParentId(value === '__none__' ? null : value)}
                options={[
                  { value: '__none__', label: 'No parent (top level)' },
                  ...parentOptions.map((location) => ({
                    value: location.id,
                    label: location.path ?? location.code,
                    detail: humanize(location.type),
                  })),
                ]}
              />

              <View style={styles.rangeRow}>
                <View style={styles.rangeCol}>
                  <Field
                    label="Aisle start"
                    value={bulkAisleStart}
                    onChangeText={setBulkAisleStart}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.rangeCol}>
                  <Field
                    label="Aisle end"
                    value={bulkAisleEnd}
                    onChangeText={setBulkAisleEnd}
                    keyboardType="numeric"
                  />
                </View>
              </View>

              <View style={styles.rangeRow}>
                <View style={styles.rangeCol}>
                  <Field
                    label="Rack start"
                    value={bulkRackStart}
                    onChangeText={setBulkRackStart}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.rangeCol}>
                  <Field
                    label="Rack end"
                    value={bulkRackEnd}
                    onChangeText={setBulkRackEnd}
                    keyboardType="numeric"
                  />
                </View>
              </View>

              <View style={styles.rangeRow}>
                <View style={styles.rangeCol}>
                  <Field
                    label="Shelf start"
                    value={bulkShelfStart}
                    onChangeText={setBulkShelfStart}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.rangeCol}>
                  <Field
                    label="Shelf end"
                    value={bulkShelfEnd}
                    onChangeText={setBulkShelfEnd}
                    keyboardType="numeric"
                  />
                </View>
              </View>

              <View style={styles.rangeRow}>
                <View style={styles.rangeCol}>
                  <Field
                    label="Bin start"
                    value={bulkBinStart}
                    onChangeText={setBulkBinStart}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.rangeCol}>
                  <Field
                    label="Bin end"
                    value={bulkBinEnd}
                    onChangeText={setBulkBinEnd}
                    keyboardType="numeric"
                  />
                </View>
              </View>

              <View style={styles.rangeRow}>
                <View style={styles.rangeCol}>
                  <Field
                    label="Separator"
                    value={bulkSeparator}
                    onChangeText={setBulkSeparator}
                    placeholder="-"
                  />
                </View>
                <View style={styles.rangeCol}>
                  <Field
                    label="Zero padding"
                    value={bulkPad}
                    onChangeText={setBulkPad}
                    placeholder="2"
                    keyboardType="numeric"
                  />
                </View>
              </View>

              <SelectField
                label="Location type"
                value={bulkType}
                onChange={setBulkType}
                options={LOCATION_PURPOSES.map((t) => ({
                  value: t.key,
                  label: `${t.label} (${t.category})`,
                }))}
              />

              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: bulkPickable }}
                onPress={() => setBulkPickable((prev) => !prev)}
                style={styles.checkRow}
              >
                <MaterialCommunityIcons
                  name={bulkPickable ? 'checkbox-marked' : 'checkbox-blank-outline'}
                  size={22}
                  color={bulkPickable ? colors.primary : colors.muted}
                />
                <View style={styles.checkBody}>
                  <Text style={styles.checkTitle}>Mark generated bins as pickable</Text>
                  <Text style={styles.checkText}>
                    Enables these bins for outbound order allocation
                  </Text>
                </View>
              </Pressable>

              {bulkError ? <Text style={styles.errorText}>{bulkError}</Text> : null}

              <Button
                label="Preview Bin Generation"
                variant="secondary"
                onPress={() => void handleBulkPreview()}
                loading={bulkPreviewLoading}
              />

              {/* Preview results */}
              {bulkStats ? (
                <View style={styles.previewSummaryCard}>
                  <Text style={styles.previewSummaryTitle}>Generation Summary</Text>
                  <View style={styles.previewStatsRow}>
                    <View style={styles.previewStatCol}>
                      <Text style={styles.previewStatNum}>{bulkStats.total}</Text>
                      <Text style={styles.previewStatLabel}>Total</Text>
                    </View>
                    <View style={styles.previewStatCol}>
                      <Text style={[styles.previewStatNum, { color: colors.success }]}>
                        {bulkStats.new}
                      </Text>
                      <Text style={styles.previewStatLabel}>New to create</Text>
                    </View>
                    <View style={styles.previewStatCol}>
                      <Text style={[styles.previewStatNum, { color: colors.warning }]}>
                        {bulkStats.duplicate}
                      </Text>
                      <Text style={styles.previewStatLabel}>Duplicates</Text>
                    </View>
                  </View>

                  {bulkPreviewItems && bulkPreviewItems.length > 0 ? (
                    <View style={styles.previewList}>
                      <Text style={styles.previewListHeading}>Sample Generated Codes:</Text>
                      {bulkPreviewItems.slice(0, 10).map((item, idx) => (
                        <View key={idx} style={styles.previewRow}>
                          <Text style={styles.previewCode}>{item.code}</Text>
                          <Badge
                            label={item.is_duplicate ? 'Duplicate (skip)' : 'Ready'}
                            tone={item.is_duplicate ? 'warning' : 'success'}
                          />
                        </View>
                      ))}
                      {bulkPreviewItems.length > 10 ? (
                        <Text style={styles.previewMore}>
                          ...and {bulkPreviewItems.length - 10} more
                        </Text>
                      ) : null}
                    </View>
                  ) : null}

                  <Button
                    label={`Confirm & Create ${bulkStats.new} Bins`}
                    onPress={() => void handleBulkCreate()}
                    loading={bulkCreateLoading}
                    disabled={bulkStats.new === 0}
                  />
                </View>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
      </ScrollView>
    </View>
  );
}

// ============================================================================
// STYLES
// ============================================================================

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
  screen: {
    flex: 1,
    backgroundColor: '#EFF3F8',
  },
  content: {
    paddingHorizontal: 16,
    gap: 14,
    paddingBottom: 24,
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
  infoCard: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: '#EAF3FA',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  infoText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 17,
    color: colors.deep,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 17,
    color: colors.navy,
  },
  formHint: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.danger,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },

  // Warehouse Primary Card (Warehouse-First Header)
  warehousePrimaryCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  whCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  whTitleBox: {
    flex: 1,
    minWidth: 160,
    gap: 4,
  },
  whNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  whMainTitle: {
    fontFamily: fonts.heading,
    fontSize: 20,
    color: colors.navy,
  },
  whCodeBadge: {
    backgroundColor: '#E8F1F5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#D0E1EA',
  },
  whCodeBadgeText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.primary,
    letterSpacing: 0.5,
  },
  whAddressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  whAddressText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
    flex: 1,
  },
  facilitySettingsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F3F7FA',
    borderWidth: 1,
    borderColor: '#E2EAF0',
    alignSelf: 'flex-start',
  },
  facilitySettingsBtnText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.primary,
  },

  // Metadata pills
  whMetaPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  whMetaPill: {
    flex: 1,
    minWidth: '47%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#F8FAFC',
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#EDF2F7',
  },
  whMetaPillLayout: {
    backgroundColor: '#F4F8FA',
    borderColor: '#E2ECF2',
  },
  whMetaPillTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  whMetaPillSubtitle: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },

  // Selector row
  whSelectorRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: '#F0F4F8',
  },
  singleWhActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: '#F0F4F8',
  },
  addAnotherWhLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addAnotherWhLinkText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.primary,
  },
  newWhButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    marginBottom: spacing.xs,
  },
  newWhButtonText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.white,
  },

  // Real KPI Grid (Responsive 2x2 layout)
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  kpiCard: {
    flex: 1,
    minWidth: '47%',
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: '#EBF2F7',
    gap: 2,
  },
  kpiCardActive: {
    borderColor: colors.primary,
    backgroundColor: '#EFF6FF',
    borderWidth: 1.5,
  },
  kpiCardFull: {
    minWidth: '100%',
    backgroundColor: '#FFFBEB',
    borderColor: '#FEF3C7',
  },
  kpiCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  kpiValue: {
    fontFamily: fonts.heading,
    fontSize: 18,
    color: colors.navy,
  },
  kpiLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.muted,
  },

  // Template Setup Banner (Empty Warehouse)
  templateSetupCard: {
    backgroundColor: '#F0FDF4',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    padding: spacing.lg,
    gap: spacing.md,
  },
  templateCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  templateIconBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  templateCardTitle: {
    fontFamily: fonts.heading,
    fontSize: 16,
    color: '#166534',
  },
  templateCardDesc: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: '#15803D',
    marginTop: 2,
  },
  templateItemsBox: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: '#DCFCE7',
  },
  templateItemsHeading: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
    marginBottom: 4,
  },
  templateItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F0FDF4',
  },
  templateItemCodeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  templateItemCode: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
  },
  templateItemRole: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    flex: 1,
    textAlign: 'right',
  },
  templateActionsRow: {
    flexDirection: 'column',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },

  // Directory & Lists
  locationSubtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  dirHeaderWrapper: {
    gap: spacing.sm,
  },
  dirHeaderTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  dirControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  zoneGuideToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: '#EFF6FF',
  },
  zoneGuideToggleText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.primary,
  },
  zoneGuideCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  zoneGuideHeading: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
    marginBottom: 2,
  },
  zoneGuideIntroText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.navy,
    lineHeight: 16,
    marginBottom: spacing.xs,
  },
  zoneGuideItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  zoneGuideItemTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.navy,
  },
  zoneGuideItemDesc: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
    lineHeight: 15,
  },
  dirActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  viewModeToggle: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: radius.sm,
    padding: 2,
  },
  viewModeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm - 2,
  },
  viewModeBtnActive: {
    backgroundColor: colors.navy,
  },
  viewModeBtnText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.muted,
  },
  viewModeBtnTextActive: {
    color: colors.white,
  },
  bulkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F0F7FF',
    borderWidth: 1,
    borderColor: '#D0E3F7',
  },
  bulkButtonText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.primary,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.navy,
    padding: 0,
  },
  filterScroll: {
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  filterChipText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.muted,
  },
  filterChipTextActive: {
    color: colors.white,
  },
  listCard: {
    gap: 1,
    backgroundColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  hierarchyGroup: {
    backgroundColor: colors.white,
    marginBottom: 1,
  },
  hierarchyChildrenList: {
    backgroundColor: '#F9FBFC',
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  orphanHeading: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.muted,
    padding: spacing.sm,
    backgroundColor: '#F1F5F9',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.white,
    padding: spacing.md,
  },
  locationRowChild: {
    backgroundColor: '#F9FBFC',
    paddingLeft: spacing.lg + spacing.sm,
  },
  locationRowBlocked: {
    backgroundColor: '#FFFBEB',
  },
  locationIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#EDF5FA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationIconChild: {
    width: 30,
    height: 30,
    backgroundColor: '#E8F1F5',
  },
  locationIconBlocked: {
    backgroundColor: '#FEF3C7',
  },
  locationBody: {
    flex: 1,
    gap: 4,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  locationCodeText: {
    fontFamily: fonts.heading,
    fontSize: 14,
    color: colors.navy,
  },
  locationCodeTextChild: {
    fontFamily: fonts.headingSemi,
    fontSize: 13,
  },
  locationPathBreadcrumb: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
    padding: spacing.xl,
    backgroundColor: colors.white,
  },

  // Add Location Form styling
  layoutTagPill: {
    backgroundColor: '#EBF4F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  layoutTagPillText: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    color: colors.deep,
    textTransform: 'uppercase',
  },
  layoutNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#F0F6FA',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#D8E7F0',
  },
  layoutNoticeBoxFloor: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  layoutNoticeText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.deep,
  },
  purposeExplanationBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: '#F8FAFC',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  purposeExplanationTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  purposeExplanationText: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.muted,
    marginTop: 2,
  },
  fieldHelperText: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
    marginTop: -spacing.xs,
    marginBottom: spacing.xs,
  },
  coordinatesWrapper: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: spacing.sm,
  },
  coordinatesHeader: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  coordRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  coordCol: {
    flex: 1,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  checkBody: {
    flex: 1,
    gap: 2,
  },
  checkTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
  },
  checkText: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.muted,
  },

  // Modals
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontFamily: fonts.heading,
    fontSize: 18,
    color: colors.navy,
  },
  modalPath: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  closeBtn: {
    padding: spacing.xs,
  },
  modalScroll: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  flexButton: {
    flex: 1,
  },

  // Type Selection in Create Warehouse Modal
  modalSectionHeading: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
    marginTop: spacing.xs,
  },
  typeSelectionGrid: {
    gap: spacing.sm,
  },
  typeSelectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  typeSelectCardActive: {
    backgroundColor: '#F0F7FF',
    borderColor: colors.primary,
  },
  typeSelectTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  typeSelectTitleActive: {
    color: colors.primary,
  },
  typeSelectTagline: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  layoutSelectionList: {
    gap: spacing.sm,
  },
  layoutSelectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  layoutSelectCardActive: {
    backgroundColor: '#F0F7FF',
    borderColor: colors.primary,
  },
  layoutSelectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  layoutSelectTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
  },
  layoutSelectTitleActive: {
    color: colors.primary,
  },
  layoutSelectSubtitle: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  templateToggleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: '#F8FAFC',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: spacing.xs,
  },
  templateToggleTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  templateToggleDesc: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  starterZonesBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.md,
    gap: spacing.sm,
  },
  starterZonesHeading: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  starterTemplateHeader: {
    marginBottom: spacing.xs,
  },
  starterZonesSubtitle: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  starterZoneHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  starterZoneCategoryTag: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  starterZoneCategoryOperational: {
    backgroundColor: '#EFF6FF',
    color: '#1D4ED8',
  },
  starterZoneCategoryStorage: {
    backgroundColor: '#ECFDF5',
    color: '#047857',
  },
  starterZoneItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  starterZoneItemChecked: {
    borderColor: colors.primary,
    backgroundColor: '#F0F7FF',
  },
  starterZoneItemTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  starterZoneItemTitleChecked: {
    color: colors.primary,
  },
  starterZoneItemDesc: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
    marginTop: 1,
  },

  // 2-Step Wizard Styles
  wizardStepBadgeRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  wizardStepBadge: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    color: colors.primary,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  buttonCol: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  backStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 4,
    marginBottom: spacing.xs,
  },
  backStepText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.primary,
  },
  wizardSectionBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.md,
    gap: spacing.sm,
  },
  wizardSectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  wizardSectionTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
  },
  wizardSectionDesc: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  addAreaSmallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  addAreaSmallBtnText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.primary,
  },
  configuredAreaCard: {
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.sm,
    gap: spacing.sm,
  },
  configuredAreaTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  removeAreaBtn: {
    padding: 6,
    borderRadius: radius.sm,
    backgroundColor: '#FEF2F2',
  },
  configuredAreaMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pickableInlineCheck: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 10,
    alignSelf: 'flex-end',
  },
  pickableInlineLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.navy,
  },
  flatLayoutNoticeCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: '#F0F9FF',
    borderRadius: radius.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  flatLayoutNoticeTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.deep,
  },
  flatLayoutNoticeDesc: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.deep,
    lineHeight: 16,
    marginTop: 2,
  },
  rackToggleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.white,
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  rackToggleTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  rackToggleDesc: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  rackConfigContainer: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  rackGridHeading: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
    marginTop: spacing.xs,
  },
  rackInputsGrid: {
    flexDirection: 'row',
    gap: 6,
  },
  rackInputCol: {
    flex: 1,
  },
  rackSummaryBox: {
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.md,
    gap: 6,
  },
  rackSummaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rackSummaryTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  rackSummarySample: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  previewCodesToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  previewCodesToggleText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.primary,
  },
  sampleCodesChipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  sampleCodeChip: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  sampleCodeChipText: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    color: colors.navy,
  },
  sampleCodesMore: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
    fontStyle: 'italic',
    alignSelf: 'center',
    width: '100%',
    marginTop: 2,
  },

  // Template Preview Card
  templatePreviewCard: {
    backgroundColor: '#F8FAFC',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 4,
  },
  templatePreviewTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  templatePreviewCode: {
    fontFamily: fonts.heading,
    fontSize: 14,
    color: colors.navy,
  },
  templatePreviewDesc: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },

  // Location Inspector styles
  qrCard: {
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: radius.lg,
  },
  qrWrapper: {
    padding: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.md,
  },
  qrCodeLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.navy,
    letterSpacing: 0.5,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  copyBtnText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.primary,
  },
  metaBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  metaKey: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  metaVal: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  balancesSection: {
    gap: spacing.sm,
  },
  balancesTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 14,
    color: colors.navy,
  },
  loadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  loadingText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  balanceList: {
    gap: spacing.sm,
  },
  balanceItem: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 2,
  },
  balanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  balanceSku: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
  },
  balanceQty: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.primary,
  },
  balanceName: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  balanceDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  balanceSubtext: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  balanceLot: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    color: colors.deep,
  },
  emptyBalanceText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
    fontStyle: 'italic',
    padding: spacing.md,
    textAlign: 'center',
  },
  inspectorActions: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },

  // Bulk generator preview
  rangeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  rangeCol: {
    flex: 1,
  },
  previewSummaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
    marginTop: spacing.md,
  },
  previewSummaryTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 14,
    color: colors.navy,
  },
  previewStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  previewStatCol: {
    alignItems: 'center',
  },
  previewStatNum: {
    fontFamily: fonts.heading,
    fontSize: 18,
    color: colors.navy,
  },
  previewStatLabel: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  previewList: {
    backgroundColor: colors.white,
    padding: spacing.sm,
    borderRadius: radius.sm,
    gap: 4,
  },
  previewListHeading: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.muted,
    marginBottom: 4,
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  previewCode: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  previewMore: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 4,
  },

  // Step 2 & 3: Warehouse Creation Wizard New Styles
  modalSectionSubtext: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
    lineHeight: 16,
    marginBottom: spacing.xs,
  },
  methodChoiceCard: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    padding: spacing.md,
    gap: spacing.xs,
  },
  methodChoiceCardActive: {
    borderColor: colors.primary,
    backgroundColor: '#F8FAFC',
  },
  methodChoiceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  methodIconBox: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodIconBoxCustom: {
    backgroundColor: '#F0FDF4',
  },
  methodIconBoxLater: {
    backgroundColor: '#F8FAFC',
  },
  methodTitleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  methodChoiceTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 14,
    color: colors.navy,
  },
  methodChoiceTagline: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.primary,
    marginTop: 2,
  },
  methodChoiceDesc: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    lineHeight: 16,
    marginTop: 2,
  },
  methodChoiceActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 4,
  },
  methodChoiceActionText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.primary,
  },
  stepHeaderBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    padding: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  stepHeaderDetails: {
    flex: 1,
  },
  stepHeaderTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 13,
    color: colors.navy,
  },
  stepHeaderSubtitle: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  sectionAdderBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    padding: spacing.md,
    gap: spacing.sm,
  },
  sectionAdderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionAdderTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 13,
    color: colors.navy,
  },
  sectionAdderDesc: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    lineHeight: 15,
  },
  sectionAdderRow: {
    flexDirection: 'row',
    gap: 8,
  },
  emptyAreasState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    gap: 6,
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#CBD5E1',
  },
  emptyAreasStateText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
  },
  previewCardWrapper: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.md,
    gap: spacing.sm,
  },
  previewSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  previewSectionTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 13,
    color: colors.navy,
  },
  previewSectionSubtitle: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  previewAreasList: {
    gap: 6,
    marginTop: 4,
  },
  previewAreaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  previewAreaLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  previewAreaCode: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.navy,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  previewAreaName: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.navy,
    flex: 1,
  },
  previewAreaRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  assignedCountBadge: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.primary,
    backgroundColor: '#EDF5FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  preferredItemsList: {
    gap: 6,
  },
  preferredItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  preferredItemIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#EDF5FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  preferredItemSku: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  preferredItemName: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
});
