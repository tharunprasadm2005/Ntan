import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { api, ApiError } from './api';
import { useAuth } from './auth';
import {
  countPendingOperations,
  initializeOffline,
} from './offline/db';
import type {
  Balance,
  Client,
  DashboardSummary,
  Item,
  Location,
  Movement,
  Receipt,
  Warehouse,
} from './types';

interface WorkspaceState {
  items: Item[];
  warehouses: Warehouse[];
  locations: Location[];
  balances: Balance[];
  movements: Movement[];
  receipts: Receipt[];
  dashboard: DashboardSummary | null;
  lastUpdated: string | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
}

interface WorkspaceContextValue extends WorkspaceState {
  clients: Client[];
  inventoryOwners: Client[];
  internalClient: Client | null;
  isMultiOwner: boolean;
  activeClientId: string | null;
  activeClient: Client | null;
  pendingSyncCount: number;
  offlineStoreReady: boolean;
  setActiveClientId(clientId: string | null): void;
  refresh(): Promise<void>;
  refreshOfflineState(): Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { state: authState } = useAuth();
  const session = authState.status === 'signedIn' ? authState.session : null;
  const clients = useMemo(() => session?.clients ?? [], [session]);
  const inventoryOwners = useMemo(
    () => clients.filter((client) => client.is_internal || client.types?.includes('3pl_client')),
    [clients],
  );
  const internalClient = useMemo(
    () => inventoryOwners.find((client) => client.is_internal) ?? null,
    [inventoryOwners],
  );
  const isMultiOwner = useMemo(() => {
    const model = session?.company.inventory_model ?? 'internal';
    return (model === '3pl' || model === 'hybrid') && inventoryOwners.length > 1;
  }, [session?.company.inventory_model, inventoryOwners.length]);

  const defaultClientId = useMemo(() => {
    if (!isMultiOwner) {
      return internalClient?.id ?? inventoryOwners[0]?.id ?? null;
    }
    return null;
  }, [isMultiOwner, internalClient, inventoryOwners]);

  const [selectedClientId, setSelectedClientId] = useState<string | null | undefined>(
    undefined,
  );
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [offlineStoreReady, setOfflineStoreReady] = useState(false);
  const activeClientId = !isMultiOwner
    ? defaultClientId
    : selectedClientId === undefined
      ? null
      : selectedClientId;
  const activeClient =
    inventoryOwners.find((client) => client.id === activeClientId) ?? null;

  const [state, setState] = useState<WorkspaceState>({
    items: [],
    warehouses: [],
    locations: [],
    balances: [],
    movements: [],
    receipts: [],
    dashboard: null,
    lastUpdated: null,
    loading: true,
    refreshing: false,
    error: null,
  });
  const inFlight = useRef<Promise<void> | null>(null);

  const refreshOfflineState = useCallback(async () => {
    const count = await countPendingOperations();
    setPendingSyncCount(count);
  }, []);

  useEffect(() => {
    let active = true;
    void initializeOffline().then(async (ready) => {
      if (!active) {
        return;
      }
      setOfflineStoreReady(ready);
      const count = await countPendingOperations();
      if (active) {
        setPendingSyncCount(count);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (
      selectedClientId &&
      !inventoryOwners.some((client) => client.id === selectedClientId)
    ) {
      setSelectedClientId(undefined);
    }
  }, [inventoryOwners, selectedClientId]);

  const load = useCallback(async (silent: boolean) => {
    if (inFlight.current) {
      return inFlight.current;
    }
    const promise = (async () => {
      if (!silent) {
        setState((current) => ({
          ...current,
          loading: true,
          error: null,
        }));
      }
      try {
        const [
          items,
          warehouses,
          locations,
          balances,
          movements,
          receipts,
          dashboard,
        ] = await Promise.all([
          api.items(activeClientId),
          api.warehouses(),
          api.locations(),
          api.balances(activeClientId),
          api.movements(activeClientId),
          api.receipts(undefined, activeClientId),
          api.dashboard(),
        ]);
        setState({
          items: items.items,
          warehouses: warehouses.warehouses,
          locations: locations.locations,
          balances: balances.balances,
          movements: movements.movements,
          receipts: receipts.receipts,
          dashboard,
          lastUpdated: new Date().toISOString(),
          loading: false,
          refreshing: false,
          error: null,
        });
      } catch (error) {
        setState((current) => ({
          ...current,
          loading: false,
          refreshing: false,
          error:
            error instanceof ApiError
              ? error.message
              : 'The inventory data could not be loaded.',
        }));
      } finally {
        inFlight.current = null;
      }
    })();
    inFlight.current = promise;
    return promise;
  }, [activeClientId]);

  useEffect(() => {
    void load(false);

    // Silent background sync every 60 seconds (non-blocking)
    const interval = setInterval(() => {
      void load(true);
    }, 60000);

    // Silent background sync when app transitions back to active
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        void load(true);
      }
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [load]);

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, refreshing: true }));
    return load(true);
  }, [load]);

  const value = useMemo(
    () => ({
      ...state,
      clients,
      inventoryOwners,
      internalClient,
      isMultiOwner,
      activeClientId,
      activeClient,
      pendingSyncCount,
      offlineStoreReady,
      setActiveClientId: setSelectedClientId,
      refresh,
      refreshOfflineState,
    }),
    [
      state,
      clients,
      inventoryOwners,
      internalClient,
      isMultiOwner,
      activeClientId,
      activeClient,
      pendingSyncCount,
      offlineStoreReady,
      refresh,
      refreshOfflineState,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within WorkspaceProvider');
  }
  return context;
}
