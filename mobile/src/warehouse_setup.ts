import type { InitialLocationCreate, WarehouseLayout, WarehouseType } from './types';

export type SetupMethod = 'quick' | 'custom' | 'later';

export interface ProposedArea {
  id: string;
  code: string;
  name: string;
  type: string;
  isPickable: boolean;
  isOperational: boolean;
}

export interface CustomSectionBatchInput {
  name: string;
  code: string;
  type: string;
  isPickable: boolean;
  isOperational: boolean;
  quantity?: number | string;
}

export interface RackBinConfigInput {
  aisles: string | number;
  racksPerAisle: string | number;
  shelvesPerRack: string | number;
  binsPerShelf: string | number;
  parentCode: string;
  prefix?: string;
  separator?: string;
  zeroPad?: string | number;
}

export interface FlatFloorConfigInput {
  count: string | number;
  parentCode: string;
  prefix?: string;
  zeroPad?: string | number;
}

/**
 * Returns tailored suggested starter areas for Quick Setup.
 * Note: These are suggestions only; users can freely edit, rename, remove, or expand them.
 */
export function getInitialProposedAreas(
  layout: WarehouseLayout,
  whType: WarehouseType,
): ProposedArea[] {
  if (layout === 'all_in_one') {
    return [
      {
        id: 'area-floor',
        code: 'FLOOR',
        name: 'Main Floor Storage',
        type: 'main',
        isPickable: true,
        isOperational: false,
      },
    ];
  }

  if (layout === 'bulk_storage') {
    return [
      {
        id: 'area-recv',
        code: 'RECV',
        name: 'Inbound Receiving Dock',
        type: 'receiving',
        isPickable: false,
        isOperational: true,
      },
      {
        id: 'area-storage',
        code: 'STORAGE',
        name: 'Bulk Pallet Storage Racks',
        type: 'main',
        isPickable: true,
        isOperational: false,
      },
      {
        id: 'area-disp',
        code: 'DISP',
        name: 'Outbound Dispatch Dock',
        type: 'dispatch',
        isPickable: false,
        isOperational: true,
      },
      {
        id: 'area-qc',
        code: 'QC',
        name: 'Quality Inspection Hold',
        type: 'quarantine',
        isPickable: false,
        isOperational: true,
      },
    ];
  }

  // multi_zone
  if (whType === 'cold_storage') {
    return [
      {
        id: 'area-recv',
        code: 'RECV',
        name: 'Chilled Receiving Dock',
        type: 'receiving',
        isPickable: false,
        isOperational: true,
      },
      {
        id: 'area-cold',
        code: 'COLD',
        name: 'Cold Storage Vault',
        type: 'cold_storage',
        isPickable: true,
        isOperational: false,
      },
      {
        id: 'area-disp',
        code: 'DISP',
        name: 'Chilled Outbound Dock',
        type: 'dispatch',
        isPickable: false,
        isOperational: true,
      },
      {
        id: 'area-qc',
        code: 'QC',
        name: 'Temperature Quarantine Hold',
        type: 'quarantine',
        isPickable: false,
        isOperational: true,
      },
    ];
  }

  const areas: ProposedArea[] = [
    {
      id: 'area-recv',
      code: 'RECV',
      name: 'Inbound Receiving Area',
      type: 'receiving',
      isPickable: false,
      isOperational: true,
    },
    {
      id: 'area-storage',
      code: 'STORAGE',
      name: 'Main Storage Area',
      type: 'main',
      isPickable: false,
      isOperational: false,
    },
    {
      id: 'area-pick',
      code: 'PICK',
      name: 'Forward Picking Area',
      type: 'picking',
      isPickable: true,
      isOperational: false,
    },
    {
      id: 'area-disp',
      code: 'DISP',
      name: 'Outbound Dispatch Area',
      type: 'dispatch',
      isPickable: false,
      isOperational: true,
    },
  ];

  if (whType === 'fulfilment') {
    areas.push({
      id: 'area-pack',
      code: 'PACK',
      name: 'Packing & Boxing Station',
      type: 'packing',
      isPickable: false,
      isOperational: true,
    });
  }

  return areas;
}

/**
 * Validates configured area codes.
 * Ensures codes are non-empty and unique.
 * Explicitly allows multiple areas with the SAME operational purpose (e.g. multiple receiving docks).
 */
export function validateWarehouseAreas(areas: ProposedArea[]): { valid: boolean; error: string | null } {
  const seenCodes = new Set<string>();

  for (const area of areas) {
    const trimmed = (area.code || '').trim().toUpperCase();
    if (!trimmed) {
      return { valid: false, error: 'Every area must have a non-empty code.' };
    }
    if (seenCodes.has(trimmed)) {
      return {
        valid: false,
        error: `Duplicate area code '${trimmed}' detected. Each area code must be unique.`,
      };
    }
    seenCodes.add(trimmed);
  }

  return { valid: true, error: null };
}

/**
 * Generates custom section batch based on user input.
 * Supports single sections or batch multi-quantity sections (e.g. 3 bays: BAY-01, BAY-02, BAY-03).
 */
export function buildCustomSectionBatch(input: CustomSectionBatchInput): ProposedArea[] {
  const baseCode = (input.code || '').trim().toUpperCase();
  const baseName = (input.name || '').trim() || baseCode;
  const rawQty = typeof input.quantity === 'number' ? input.quantity : parseInt(String(input.quantity || '1'), 10);
  const qty = Math.max(1, Math.min(50, isNaN(rawQty) ? 1 : rawQty));

  if (qty === 1) {
    return [
      {
        id: `custom-area-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        code: baseCode,
        name: baseName,
        type: input.type,
        isPickable: input.isPickable,
        isOperational: input.isOperational,
      },
    ];
  }

  const results: ProposedArea[] = [];
  const pad = qty > 9 ? 2 : 2;
  for (let i = 1; i <= qty; i++) {
    const numStr = i.toString().padStart(pad, '0');
    results.push({
      id: `custom-area-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      code: `${baseCode}-${numStr}`,
      name: `${baseName} ${i}`,
      type: input.type,
      isPickable: input.isPickable,
      isOperational: input.isOperational,
    });
  }
  return results;
}

/**
 * Computes structured physical rack and bin positions under a parent storage area.
 */
export function computeRackBins(input: RackBinConfigInput): {
  bins: InitialLocationCreate[];
  error: string | null;
} {
  const aCount = Math.max(1, Math.min(20, typeof input.aisles === 'number' ? input.aisles : parseInt(String(input.aisles), 10) || 1));
  const rCount = Math.max(1, Math.min(20, typeof input.racksPerAisle === 'number' ? input.racksPerAisle : parseInt(String(input.racksPerAisle), 10) || 1));
  const sCount = Math.max(1, Math.min(10, typeof input.shelvesPerRack === 'number' ? input.shelvesPerRack : parseInt(String(input.shelvesPerRack), 10) || 1));
  const bCount = Math.max(1, Math.min(20, typeof input.binsPerShelf === 'number' ? input.binsPerShelf : parseInt(String(input.binsPerShelf), 10) || 1));
  const pad = Math.max(1, Math.min(4, typeof input.zeroPad === 'number' ? input.zeroPad : parseInt(String(input.zeroPad || '2'), 10) || 2));
  const sep = input.separator || '-';
  const prefix = (input.prefix || '').trim().toUpperCase();

  const total = aCount * rCount * sCount * bCount;
  if (total > 500) {
    return {
      bins: [],
      error: `Generated ${total} bins, which exceeds the safe batch limit of 500. Reduce aisles, racks, or bins per shelf.`,
    };
  }

  const parentCode = (input.parentCode || '').trim().toUpperCase() || 'STORAGE';
  const bins: InitialLocationCreate[] = [];

  for (let a = 1; a <= aCount; a++) {
    const aStr = a.toString().padStart(pad, '0');
    for (let r = 1; r <= rCount; r++) {
      const rStr = r.toString().padStart(pad, '0');
      for (let s = 1; s <= sCount; s++) {
        const sStr = s.toString().padStart(pad, '0');
        for (let b = 1; b <= bCount; b++) {
          const bStr = b.toString().padStart(pad, '0');
          let codeBody = '';
          if (aCount === 1 && rCount === 1 && sCount === 1) {
            codeBody = prefix ? `${prefix}${sep}${bStr}` : `BIN${sep}${bStr}`;
          } else {
            codeBody = prefix
              ? `${prefix}${sep}${aStr}${sep}${rStr}${sep}${sStr}${sep}${bStr}`
              : `${aStr}${sep}${rStr}${sep}${sStr}${sep}${bStr}`;
          }
          bins.push({
            code: codeBody.toUpperCase(),
            type: 'bin',
            is_pickable: true,
            parent_code: parentCode,
            aisle: aStr,
            rack: rStr,
            shelf: sStr,
            bin: bStr,
          });
        }
      }
    }
  }

  return { bins, error: null };
}

/**
 * Computes flat floor positions / bays (e.g. BAY-01 to BAY-06) for open floor layouts.
 */
export function computeFlatFloorPositions(input: FlatFloorConfigInput): {
  positions: InitialLocationCreate[];
  error: string | null;
} {
  const rawCount = typeof input.count === 'number' ? input.count : parseInt(String(input.count || '6'), 10);
  const count = Math.max(1, Math.min(100, isNaN(rawCount) ? 6 : rawCount));
  const pad = Math.max(1, Math.min(4, typeof input.zeroPad === 'number' ? input.zeroPad : parseInt(String(input.zeroPad || '2'), 10) || 2));
  const prefix = (input.prefix || '').trim().toUpperCase() || 'BAY';
  const parentCode = (input.parentCode || '').trim().toUpperCase() || 'FLOOR';

  const positions: InitialLocationCreate[] = [];
  for (let i = 1; i <= count; i++) {
    const numStr = i.toString().padStart(pad, '0');
    positions.push({
      code: `${prefix}-${numStr}`,
      name: `Floor Position ${numStr}`,
      type: 'main',
      is_pickable: true,
      parent_code: parentCode,
    });
  }

  return { positions, error: null };
}

/**
 * Compiles all initial locations into a unified preview and submission payload.
 * Validates cross-level code conflicts.
 */
export function compileInitialLocations(params: {
  setupMethod: SetupMethod;
  areas: ProposedArea[];
  rackBins: InitialLocationCreate[];
  floorPositions?: InitialLocationCreate[];
}): { locations: InitialLocationCreate[]; error: string | null } {
  if (params.setupMethod === 'later') {
    return { locations: [], error: null };
  }

  const { valid, error: areaErr } = validateWarehouseAreas(params.areas);
  if (!valid) {
    return { locations: [], error: areaErr };
  }

  const areaLocs: InitialLocationCreate[] = params.areas.map((a) => ({
    code: a.code.trim().toUpperCase(),
    name: a.name.trim() || undefined,
    type: a.type,
    is_pickable: a.isPickable,
    parent_code: null,
  }));

  const allCodes = new Set<string>(areaLocs.map((l) => l.code));
  const childLocs = [...(params.rackBins || []), ...(params.floorPositions || [])];

  for (const child of childLocs) {
    const code = child.code.trim().toUpperCase();
    if (allCodes.has(code)) {
      return {
        locations: [],
        error: `Location code '${code}' conflicts with an existing area code. Use a unique prefix.`,
      };
    }
    allCodes.add(code);
  }

  return {
    locations: [...areaLocs, ...childLocs],
    error: null,
  };
}
