import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export interface WarehouseRulesConfig {
  pickStrategy: 'fefo' | 'fifo' | 'lifo';
  allowOverReceiving: boolean;
  quarantineDamaged: boolean;
  consolidationPutaway: boolean;
  strictCoordinates: boolean;
  lastUpdated?: string;
}

export const DEFAULT_WAREHOUSE_RULES: WarehouseRulesConfig = {
  pickStrategy: 'fefo',
  allowOverReceiving: false,
  quarantineDamaged: true,
  consolidationPutaway: true,
  strictCoordinates: true,
};

const RULES_KEY = 'ntan.warehouse_rules.config';

function webStorage(): Storage | null {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      return (globalThis as unknown as { localStorage: Storage }).localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

export async function loadWarehouseRules(): Promise<WarehouseRulesConfig> {
  try {
    let raw: string | null = null;
    if (Platform.OS === 'web') {
      raw = webStorage()?.getItem(RULES_KEY) ?? null;
    } else {
      raw = await SecureStore.getItemAsync(RULES_KEY);
    }

    if (!raw) {
      return DEFAULT_WAREHOUSE_RULES;
    }

    const parsed = JSON.parse(raw) as Partial<WarehouseRulesConfig>;
    return {
      pickStrategy: parsed.pickStrategy ?? 'fefo',
      allowOverReceiving: parsed.allowOverReceiving ?? false,
      quarantineDamaged: parsed.quarantineDamaged ?? true,
      consolidationPutaway: parsed.consolidationPutaway ?? true,
      strictCoordinates: parsed.strictCoordinates ?? true,
      lastUpdated: parsed.lastUpdated,
    };
  } catch {
    return DEFAULT_WAREHOUSE_RULES;
  }
}

export async function saveWarehouseRules(rules: WarehouseRulesConfig): Promise<void> {
  try {
    const payload = JSON.stringify({
      ...rules,
      lastUpdated: new Date().toISOString(),
    });

    if (Platform.OS === 'web') {
      webStorage()?.setItem(RULES_KEY, payload);
    } else {
      await SecureStore.setItemAsync(RULES_KEY, payload);
    }
  } catch {
    // best-effort persistence
  }
}

