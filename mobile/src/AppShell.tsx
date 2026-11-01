import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from './auth';
import { AiAssistantModal } from './components/AiAssistantModal';
import { TabBar, type TabKey } from './components/TabBar';
import { useWorkspace } from './data';
import { AccountScreen } from './screens/AccountScreen';
import { AdjustmentScreen } from './screens/AdjustmentScreen';
import { ClientsScreen } from './screens/ClientsScreen';
import { CycleCountScreen } from './screens/CycleCountScreen';
import { HelpScreen } from './screens/HelpScreen';
import { HomeScreen } from './screens/HomeScreen';
import { ItemDetailScreen } from './screens/ItemDetailScreen';
import { ItemsScreen } from './screens/ItemsScreen';
import { LocationsScreen } from './screens/LocationsScreen';
import { MoreScreen } from './screens/MoreScreen';
import { OperationsScreen } from './screens/OperationsScreen';
import { OutboundScreen } from './screens/OutboundScreen';
import { PurchaseOrderDetailScreen } from './screens/PurchaseOrderDetailScreen';
import { PurchaseOrdersScreen } from './screens/PurchaseOrdersScreen';
import { PutawayScreen } from './screens/PutawayScreen';
import { QualityScreen } from './screens/QualityScreen';
import { ReceiptDetailScreen } from './screens/ReceiptDetailScreen';
import { ReceiveScreen } from './screens/ReceiveScreen';
import { ReorderScreen } from './screens/ReorderScreen';
import { ReportsScreen } from './screens/ReportsScreen';
import { ScanScreen } from './screens/ScanScreen';
import { StockScreen } from './screens/StockScreen';
import { TeamScreen } from './screens/TeamScreen';
import { TransferScreen } from './screens/TransferScreen';
import { WarehouseRulesScreen } from './screens/WarehouseRulesScreen';
import { colors, fonts, shadow, spacing } from './theme';

type OverlayRoute =
  | 'receive'
  | 'reorder'
  | 'items'
  | 'account'
  | 'team'
  | 'clients'
  | 'locations'
  | 'putaway'
  | 'outbound'
  | 'receipt'
  | 'item'
  | 'transfer'
  | 'purchase-orders'
  | 'purchase-order'
  | 'reports'
  | 'help'
  | 'warehouse-rules'
  | 'quality'
  | 'cycle-count'
  | 'adjustment'
  | null;

export function AppShell() {
  const { state } = useAuth();
  const { activeClient, refresh } = useWorkspace();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<TabKey>('home');
  const [overlay, setOverlay] = useState<OverlayRoute>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [receiptReturn, setReceiptReturn] = useState<OverlayRoute>('receive');
  const [itemId, setItemId] = useState<string | null>(null);
  const [itemReturn, setItemReturn] = useState<OverlayRoute>(null);
  const [itemReturnBeforeSupplier, setItemReturnBeforeSupplier] =
    useState<OverlayRoute>(null);
  const [clientPartnerId, setClientPartnerId] = useState<string | null>(null);
  const [clientsReturn, setClientsReturn] = useState<OverlayRoute>(null);
  const [supplierItemReturn, setSupplierItemReturn] = useState<{
    supplierId: string;
    clientsReturn: OverlayRoute;
  } | null>(null);
  const [putawayReceiptId, setPutawayReceiptId] = useState<string | null>(null);
  const [putawayReturn, setPutawayReturn] = useState<OverlayRoute>(null);
  const [returnOverlay, setReturnOverlay] = useState<OverlayRoute>(null);
  const [purchaseOrderId, setPurchaseOrderId] = useState<string | null>(null);
  const [purchaseOrdersReturn, setPurchaseOrdersReturn] = useState<OverlayRoute>('receive');
  const [purchaseOrderReturn, setPurchaseOrderReturn] = useState<OverlayRoute>('purchase-orders');
  const [reorderReturn, setReorderReturn] = useState<OverlayRoute>('receive');
  const [aiModalVisible, setAiModalVisible] = useState(false);

  const session = state.status === 'signedIn' ? state.session : null;
  const canReceive = session?.permissions.includes('stock.receive') ?? false;
  const canIssue = session?.permissions.includes('stock.issue') ?? false;
  const canTransfer = session?.permissions.includes('stock.transfer') ?? false;
  const canViewTeam = session?.permissions.includes('members.read') ?? false;
  const canViewClients = session?.permissions.includes('clients.read') ?? false;
  const canViewInventory = session?.permissions.includes('inventory.read') ?? false;
  const canPutaway = session?.permissions.includes('stock.putaway') ?? false;
  const canManagePurchasing =
    session?.permissions.includes('purchasing.manage') ?? false;
  const companyName = session?.company.name ?? '';
  const clientName =
    activeClient && !activeClient.is_internal ? activeClient.name : null;

  useEffect(() => {
    if (overlay === 'receive' && !canReceive) {
      setOverlay(null);
    }
    if (overlay === 'reorder' && !canReceive) {
      setOverlay(null);
    }
    if (overlay === 'outbound' && !canIssue) {
      setOverlay(null);
    }
    if (overlay === 'transfer' && !canTransfer) {
      setOverlay(null);
    }
    if (overlay === 'team' && !canViewTeam) {
      setOverlay(null);
    }
    if (overlay === 'clients' && !canViewClients) {
      setOverlay(null);
    }
    if (overlay === 'putaway' && !canPutaway && !canViewInventory) {
      setOverlay(null);
    }
    if (
      (overlay === 'purchase-orders' || overlay === 'purchase-order') &&
      !canViewInventory
    ) {
      setOverlay(null);
    }
  }, [
    canIssue,
    canPutaway,
    canReceive,
    canTransfer,
    canViewClients,
    canViewInventory,
    canViewTeam,
    overlay,
  ]);

  const [mountedTabs, setMountedTabs] = useState<Record<TabKey, boolean>>({
    home: true,
    inventory: false,
    reports: false,
    operations: false,
    more: false,
  });

  const changeTab = (next: TabKey) => {
    if (tab === next && overlay === null) return;
    setMountedTabs((prev) => (prev[next] ? prev : { ...prev, [next]: true }));
    setOverlay(null);
    setTab(next);
  };

  const openItem = (id: string, returnTo: OverlayRoute = null) => {
    setItemId(id);
    setItemReturn(returnTo);
    setOverlay('item');
  };

  const openClients = (returnTo: OverlayRoute = null) => {
    setClientsReturn(returnTo);
    setOverlay('clients');
  };

  return (
    <View style={styles.root}>
      <View style={styles.body}>
        {overlay === 'receive' && canReceive ? (
          <ReceiveScreen
            onBack={() => setOverlay(null)}
            onGoToItems={() => {
              setReturnOverlay('receive');
              setOverlay('items');
            }}
            onGoToPartners={() => {
              openClients('receive');
            }}
            onGoToLocations={() => {
              setReturnOverlay('receive');
              setOverlay('locations');
            }}
            onOpenPutaway={(targetReceiptId) => {
              setPutawayReceiptId(targetReceiptId ?? null);
              setPutawayReturn('receive');
              setOverlay('putaway');
            }}
            onOpenReceipt={(id) => {
              setReceiptReturn('receive');
              setReceiptId(id);
              setOverlay('receipt');
            }}
            onOpenReorder={() => {
              setReorderReturn('receive');
              setOverlay('reorder');
            }}
            onOpenPurchaseOrders={() => {
              setPurchaseOrdersReturn('receive');
              setOverlay('purchase-orders');
            }}
            onOpenPurchaseOrder={(id) => {
              setPurchaseOrderId(id);
              setPurchaseOrderReturn('receive');
              setOverlay('purchase-order');
            }}
          />
        ) : null}
        {overlay === 'reorder' && canReceive ? (
          <ReorderScreen
            onBack={() => setOverlay(reorderReturn)}
            onOpenReceive={() => setOverlay('receive')}
            onOpenPurchaseOrders={() => {
              setPurchaseOrdersReturn('reorder');
              setOverlay('purchase-orders');
            }}
            canReceive={canReceive}
            canManagePurchasing={canManagePurchasing}
          />
        ) : null}
        {overlay === 'purchase-orders' && canViewInventory ? (
          <PurchaseOrdersScreen
            onBack={() => setOverlay(purchaseOrdersReturn)}
            onOpenOrder={(id) => {
              setPurchaseOrderId(id);
              setPurchaseOrderReturn('purchase-orders');
              setOverlay('purchase-order');
            }}
            onOpenReorder={() => {
              setReorderReturn('purchase-orders');
              setOverlay('reorder');
            }}
            canReceive={canReceive}
          />
        ) : null}
        {overlay === 'purchase-order' && purchaseOrderId && canViewInventory ? (
          <PurchaseOrderDetailScreen
            purchaseOrderId={purchaseOrderId}
            onBack={() => setOverlay(purchaseOrderReturn)}
            onReceiveOrder={() => setOverlay('receive')}
            onOpenReorder={() => {
              setReorderReturn('purchase-order');
              setOverlay('reorder');
            }}
          />
        ) : null}
        {overlay === 'receipt' && receiptId ? (
          <ReceiptDetailScreen
            receiptId={receiptId}
            onBack={() => setOverlay(receiptReturn)}
            onOpenPurchaseOrder={
              canViewInventory
                ? (id) => {
                    setPurchaseOrderId(id);
                    setPurchaseOrderReturn('receipt');
                    setOverlay('purchase-order');
                  }
                : undefined
            }
            onOpenPutaway={(targetReceiptId) => {
              setPutawayReceiptId(targetReceiptId ?? receiptId);
              setPutawayReturn('receipt');
              setOverlay('putaway');
            }}
            onChanged={() => void refresh()}
          />
        ) : null}
        {overlay === 'putaway' ? (
          <PutawayScreen
            receiptId={putawayReceiptId}
            onBack={() => {
              setPutawayReceiptId(null);
              setOverlay(putawayReturn);
            }}
            onOpenItem={canViewInventory ? (id) => openItem(id, 'putaway') : undefined}
            onOpenReceipt={
              canViewInventory
                ? (id) => {
                    setReceiptReturn('putaway');
                    setReceiptId(id);
                    setOverlay('receipt');
                  }
                : undefined
            }
            onOpenLocations={() => {
              setReturnOverlay('putaway');
              setOverlay('locations');
            }}
          />
        ) : null}
        {overlay === 'transfer' && canTransfer ? (
          <TransferScreen
            onBack={() => {
              setOverlay(null);
              void refresh();
            }}
          />
        ) : null}
        {overlay === 'outbound' && canIssue ? (
          <OutboundScreen onBack={() => setOverlay(null)} />
        ) : null}
        {overlay === 'items' ? (
          <ItemsScreen
            onOpenItem={(id) => openItem(id, 'items')}
            onBack={
              returnOverlay
                ? () => {
                    const backTo = returnOverlay;
                    setReturnOverlay(null);
                    setOverlay(backTo);
                  }
                : undefined
            }
          />
        ) : null}
        {overlay === 'item' && itemId ? (
          <ItemDetailScreen
            itemId={itemId}
            onBack={() => {
              if (supplierItemReturn) {
                setClientPartnerId(supplierItemReturn.supplierId);
                setClientsReturn(supplierItemReturn.clientsReturn);
                setSupplierItemReturn(null);
                setOverlay('clients');
                return;
              }
              setOverlay(itemReturn);
            }}
            onChanged={() => void refresh()}
            onOpenSupplier={(supplierId) => {
              const backTarget =
                itemReturn === 'clients' ? clientsReturn : itemReturn;
              setItemReturnBeforeSupplier(backTarget);
              setClientPartnerId(supplierId);
              setClientsReturn('item');
              setOverlay('clients');
            }}
          />
        ) : null}
        {overlay === 'account' ? (
          <AccountScreen
            onBack={() => setOverlay(null)}
            onOpenTeam={() => setOverlay('team')}
          />
        ) : null}
        {overlay === 'team' && canViewTeam ? (
          <TeamScreen onBack={() => setOverlay(null)} />
        ) : null}
        {overlay === 'clients' && canViewClients ? (
          <ClientsScreen
            initialPartnerId={clientPartnerId}
            onOpenItem={(targetItemId, supplierId) => {
              const restoredClientsReturn =
                clientsReturn === 'item' ? itemReturnBeforeSupplier : clientsReturn;
              setSupplierItemReturn({
                supplierId,
                clientsReturn: restoredClientsReturn,
              });
              openItem(targetItemId, 'clients');
            }}
            onBack={() => {
              const backTo = clientsReturn;
              setClientPartnerId(null);
              setClientsReturn(null);
              setOverlay(backTo);
            }}
          />
        ) : null}
        {overlay === 'locations' ? (
          <LocationsScreen
            onBack={() => {
              const backTo = returnOverlay;
              setReturnOverlay(null);
              setOverlay(backTo);
            }}
          />
        ) : null}
        {overlay === 'reports' ? (
          <ReportsScreen onBack={() => setOverlay(null)} />
        ) : null}
        {overlay === 'help' ? (
          <HelpScreen onBack={() => setOverlay(null)} />
        ) : null}
        {overlay === 'warehouse-rules' ? (
          <WarehouseRulesScreen onBack={() => setOverlay(null)} />
        ) : null}
        {overlay === 'quality' ? (
          <QualityScreen onBack={() => setOverlay(null)} />
        ) : null}
        {overlay === 'cycle-count' ? (
          <CycleCountScreen onBack={() => setOverlay(null)} />
        ) : null}
        {overlay === 'adjustment' ? (
          <AdjustmentScreen onBack={() => setOverlay(null)} />
        ) : null}
        {/* Persistent Tab Panes for Instant Zero-Lag Switching (Lazy Mounted) */}
        {mountedTabs.home && (
          <View style={[styles.tabPane, (overlay !== null || tab !== 'home') && styles.tabPaneHidden]}>
            <HomeScreen
              onNavigate={(next) => {
                if (next === 'inventory') {
                  changeTab('inventory');
                } else if (next === 'operations') {
                  changeTab('operations');
                } else if (next === 'reports') {
                  changeTab('reports');
                } else {
                  setOverlay(next);
                }
              }}
            />
          </View>
        )}

        {mountedTabs.inventory && (
          <View style={[styles.tabPane, (overlay !== null || tab !== 'inventory') && styles.tabPaneHidden]}>
            <StockScreen
              onReceive={() => setOverlay('receive')}
              canReceive={canReceive}
              onOpenItem={(id) => openItem(id)}
            />
          </View>
        )}

        {mountedTabs.reports && (
          <View style={[styles.tabPane, (overlay !== null || tab !== 'reports') && styles.tabPaneHidden]}>
            <ReportsScreen />
          </View>
        )}

        {mountedTabs.operations && (
          <View style={[styles.tabPane, (overlay !== null || tab !== 'operations') && styles.tabPaneHidden]}>
            <OperationsScreen
              onOpenReceive={() => setOverlay('receive')}
              onOpenItems={() => setOverlay('items')}
              onOpenPutaway={() => {
                setPutawayReceiptId(null);
                setPutawayReturn(null);
                setOverlay('putaway');
              }}
              onOpenOutbound={() => setOverlay('outbound')}
              onOpenTransfer={() => setOverlay('transfer')}
              onOpenPurchaseOrders={() => {
                setPurchaseOrdersReturn(null);
                setOverlay('purchase-orders');
              }}
              onOpenReorder={() => {
                setReorderReturn(null);
                setOverlay('reorder');
              }}
              onOpenQuality={() => setOverlay('quality')}
              onOpenCycleCount={() => setOverlay('cycle-count')}
              onOpenAdjustment={() => setOverlay('adjustment')}
            />
          </View>
        )}

        {mountedTabs.more && (
          <View style={[styles.tabPane, (overlay !== null || tab !== 'more') && styles.tabPaneHidden]}>
            <MoreScreen
              onOpenAccount={() => setOverlay('account')}
              onOpenTeam={() => setOverlay('team')}
              onOpenClients={() => openClients(null)}
              onOpenLocations={() => setOverlay('locations')}
              onOpenReports={() => changeTab('reports')}
              onOpenHelp={() => setOverlay('help')}
              onOpenRules={() => setOverlay('warehouse-rules')}
            />
          </View>
        )}
      </View>

      {/* Universal Floating AI Assistant Layered Button */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open Warehouse AI Assistant"
        onPress={() => setAiModalVisible(true)}
        style={({ pressed }) => [
          styles.floatingAiButton,
          { bottom: insets.bottom + 84 },
          pressed && styles.pressed,
        ]}
      >
        <MaterialCommunityIcons name="robot" size={24} color={colors.white} />
        <View style={styles.floatingAiDot} />
      </Pressable>

      <AiAssistantModal
        visible={aiModalVisible}
        onClose={() => setAiModalVisible(false)}
      />

      <TabBar active={tab} onChange={changeTab} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#EFF3F8',
  },
  header: {
    backgroundColor: '#FCFDFE',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  mark: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#192338',
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: {
    fontFamily: fonts.heading,
    fontSize: 18,
    color: '#FFBF32',
  },
  brandText: {
    gap: 0,
  },
  brand: {
    fontFamily: fonts.heading,
    fontSize: 16,
    letterSpacing: 1.4,
    color: '#192338',
  },
  brandSub: {
    fontFamily: fonts.bodySemi,
    fontSize: 8,
    letterSpacing: 2.2,
    color: '#64748B',
    marginTop: -2,
  },
  companyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#EFF3F8',
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: 999,
    maxWidth: 230,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  companyName: {
    flexShrink: 1,
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: '#192338',
  },
  body: {
    flex: 1,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  tabPane: {
    flex: 1,
  },
  tabPaneHidden: {
    display: 'none',
  },
  floatingAiButton: {
    position: 'absolute',
    right: spacing.lg,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.accent,
    zIndex: 999,
    ...shadow,
  },
  floatingAiDot: {
    position: 'absolute',
    top: 10,
    right: 12,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  pressed: {
    opacity: 0.8,
  },
});
