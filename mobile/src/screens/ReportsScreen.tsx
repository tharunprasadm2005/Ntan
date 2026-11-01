import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { processWarehouseAssistantQuery } from '../aiAssistant';
import { useAuth } from '../auth';
import { useWorkspace } from '../data';
import { fonts, radius, shadow, spacing } from '../theme';

interface ReportsScreenProps {
  onBack?: () => void;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function ReportsScreen({ onBack }: ReportsScreenProps) {
  const insets = useSafeAreaInsets();
  const { state: authState } = useAuth();
  const {
    items,
    balances,
    receipts,
    warehouses,
    locations,
    clients,
    activeClient,
    refreshing,
    refresh,
  } = useWorkspace();

  const [activeTab, setActiveTab] = useState<'overview' | 'export' | 'assistant'>('overview');
  const [dateFilter, setDateFilter] = useState<'today' | '7days' | 'month' | 'all'>('month');
  const [copiedType, setCopiedType] = useState<string | null>(null);

  // Chatbot state
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-1',
      sender: 'assistant',
      text: 'Hello! I am your NTAN Warehouse Intelligence Assistant. You can ask me about stock valuation, throughput, discrepancy handling, low-stock alerts, or warehouse SOPs.',
      timestamp: 'Just now',
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isBotThinking, setIsBotThinking] = useState(false);

  // Filtered receipts by dateFilter
  const filteredReceipts = useMemo(() => {
    if (dateFilter === 'all') return receipts;
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const cutoff =
      dateFilter === 'today'
        ? now - dayMs
        : dateFilter === '7days'
          ? now - 7 * dayMs
          : now - 30 * dayMs;

    return receipts.filter((r) => {
      const ts = new Date(r.committed_at || r.created_at).getTime();
      return isNaN(ts) || ts >= cutoff;
    });
  }, [receipts, dateFilter]);

  // Compute live warehouse analytics
  const metrics = useMemo(() => {
    let totalOnHandUnits = 0;
    let totalAllocatedUnits = 0;
    let totalAvailableUnits = 0;
    let totalEstimatedValuation = 0;

    const itemCostMap = new Map<string, number>();
    for (const item of items) {
      const cost = Number(item.cost ?? '12.50');
      itemCostMap.set(item.id, isNaN(cost) || cost <= 0 ? 12.5 : cost);
    }

    for (const balance of balances) {
      const onHand = Number(balance.on_hand ?? '0');
      const reserved = Number(balance.reserved ?? '0');
      const available = Number(balance.available ?? '0');

      totalOnHandUnits += onHand;
      totalAllocatedUnits += reserved;
      totalAvailableUnits += available;

      const unitCost = itemCostMap.get(balance.item_id) ?? 12.5;
      totalEstimatedValuation += onHand * unitCost;
    }

    // Receipt activity in active window
    const committedReceipts = filteredReceipts.filter((r) => r.status === 'committed');
    let totalReceivedUnits = 0;
    for (const r of committedReceipts) {
      for (const line of r.lines ?? []) {
        totalReceivedUnits += Number(line.qty ?? '0');
      }
    }

    // Stock health
    const stockoutCount = items.filter((item) => {
      const totalItemBal = balances
        .filter((b) => b.item_id === item.id)
        .reduce((sum, b) => sum + Number(b.on_hand ?? 0), 0);
      return totalItemBal === 0;
    }).length;

    const healthyCount = Math.max(0, items.length - stockoutCount);

    return {
      totalOnHandUnits,
      totalAllocatedUnits,
      totalAvailableUnits,
      totalEstimatedValuation,
      totalReceipts: filteredReceipts.length,
      committedReceiptsCount: committedReceipts.length,
      totalReceivedUnits,
      stockoutCount,
      healthyCount,
      turnoverRate: totalOnHandUnits > 0 ? (totalReceivedUnits / totalOnHandUnits).toFixed(1) : '1.2',
    };
  }, [items, balances, filteredReceipts]);

  // Category breakdown
  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; value: number }>();
    let totalVal = 0;
    for (const item of items) {
      const cat = item.category?.trim() || 'General';
      const itemBals = balances.filter((b) => b.item_id === item.id);
      const onHand = itemBals.reduce((sum, b) => sum + Number(b.on_hand ?? 0), 0);
      const cost = Number(item.cost ?? '12.50') || 12.5;
      const val = onHand * cost;
      totalVal += val;

      const curr = map.get(cat) ?? { count: 0, value: 0 };
      map.set(cat, { count: curr.count + 1, value: curr.value + val });
    }

    const arr = Array.from(map.entries()).map(([name, data]) => ({
      name,
      share: totalVal > 0 ? Math.round((data.value / totalVal) * 100) : 0,
      ...data,
    }));
    arr.sort((a, b) => b.value - a.value);
    return arr.slice(0, 5);
  }, [items, balances]);

  // Generate PowerBI DirectQuery/Import Compatible Schema
  const powerBiJson = useMemo(() => {
    return JSON.stringify(
      {
        schema_version: '1.2',
        extracted_at: new Date().toISOString(),
        workspace: {
          company: authState.status === 'signedIn' ? authState.session.company.name : 'NTAN',
          owner: activeClient ? activeClient.name : 'All Owners',
        },
        tables: {
          Items: items.map((i) => ({
            ItemID: i.id,
            SKU: i.sku,
            Barcode: i.barcode ?? '',
            Name: i.name,
            Category: i.category ?? 'General',
            TrackingMode: i.tracking_mode,
            DefaultUOM: i.base_uom,
            ReorderPoint: i.reorder_point ?? 0,
          })),
          CurrentBalances: balances.map((b) => ({
            BalanceID: b.id,
            ItemID: b.item_id,
            WarehouseID: b.warehouse_id,
            LocationID: b.location_id,
            OnHand: Number(b.on_hand ?? 0),
            Reserved: Number(b.reserved ?? 0),
            Available: Number(b.available ?? 0),
          })),
          Receipts: receipts.map((r) => ({
            ReceiptID: r.id,
            Number: r.number,
            SupplierID: r.supplier_id ?? '',
            WarehouseID: r.warehouse_id,
            Status: r.status,
            CommittedAt: r.committed_at ?? r.created_at,
            LineCount: r.lines?.length ?? 0,
          })),
          Warehouses: warehouses.map((w) => ({
            WarehouseID: w.id,
            Code: w.code,
            Name: w.name,
            Address: w.address ?? '',
          })),
          Locations: locations.map((l) => ({
            LocationID: l.id,
            WarehouseID: l.warehouse_id,
            Code: l.code,
            Type: l.type,
            Aisle: l.aisle ?? '',
            Rack: l.rack ?? '',
            Shelf: l.shelf ?? '',
            Bin: l.bin ?? '',
          })),
        },
      },
      null,
      2,
    );
  }, [authState, activeClient, items, balances, receipts, warehouses, locations]);

  // Generate Excel CSV representation
  const excelCsv = useMemo(() => {
    const headers = [
      'SKU',
      'Item Name',
      'Barcode',
      'Category',
      'On Hand Qty',
      'Available Qty',
      'Allocated Qty',
      'Unit of Measure',
      'Estimated Unit Cost ($)',
      'Total Value ($)',
    ];

    const rows = items.map((item) => {
      const itemBalances = balances.filter((b) => b.item_id === item.id);
      const onHand = itemBalances.reduce((s, b) => s + Number(b.on_hand ?? 0), 0);
      const available = itemBalances.reduce((s, b) => s + Number(b.available ?? 0), 0);
      const allocated = itemBalances.reduce((s, b) => s + Number(b.reserved ?? 0), 0);
      const unitCost = Number(item.cost ?? '12.50') || 12.5;
      const totalVal = (onHand * unitCost).toFixed(2);

      return [
        `"${item.sku}"`,
        `"${item.name.replace(/"/g, '""')}"`,
        `"${item.barcode ?? ''}"`,
        `"${item.category ?? 'General'}"`,
        onHand,
        available,
        allocated,
        `"${item.base_uom}"`,
        unitCost.toFixed(2),
        totalVal,
      ].join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  }, [items, balances]);

  const handleCopy = async (type: 'powerbi' | 'excel') => {
    const content = type === 'powerbi' ? powerBiJson : excelCsv;
    await Clipboard.setStringAsync(content);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2500);
  };

  const executeMessage = (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: trimmed,
      timestamp: 'Now',
    };

    setMessages((prev) => [...prev, userMsg]);
    setChatInput('');
    setIsBotThinking(true);

    setTimeout(() => {
      const reply = processWarehouseAssistantQuery(trimmed, {
        items,
        balances,
        receipts,
        warehouses,
        locations,
        clients,
        activeClient,
      });

      setMessages((prev) => [
        ...prev,
        {
          id: `bot-${Date.now()}`,
          sender: 'assistant',
          text: reply,
          timestamp: 'Just now',
        },
      ]);
      setIsBotThinking(false);
    }, 400);
  };

  const handleSendMessage = () => {
    executeMessage(chatInput);
  };

  const handleQuickPrompt = (prompt: string) => {
    executeMessage(prompt);
  };

  const primaryWarehouse = warehouses[0];
  const availablePercent =
    metrics.totalOnHandUnits > 0
      ? Math.round((metrics.totalAvailableUnits / metrics.totalOnHandUnits) * 100)
      : 100;

  return (
    <View style={styles.screen}>
      {/* Top Header & Segment Controls - Padded safely below status bar/notch */}
      <View
        style={[
          styles.headerArea,
          {
            paddingTop: Math.max(insets.top + 12, 22),
          },
        ]}
      >
        {/* Top Header: Pure Hexagon Logo (NO circle/box) + Title + Actions */}
        <View style={styles.topHeader}>
          <View style={styles.headerLeft}>
            <Image
              source={require('../../assets/ntan-hexagon-logo.png')}
              style={styles.logoImage}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
            <View style={styles.greetingBox}>
              <Text style={styles.greetingTitle}>Reports</Text>
              <Text style={styles.greetingSubtitle} numberOfLines={1}>
                {primaryWarehouse?.name || 'All Facilities'} · Valuation & Flow
              </Text>
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh reports"
            onPress={refresh}
            style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
          >
            <MaterialCommunityIcons name="sync" size={19} color="#192338" />
          </Pressable>
        </View>

        {/* Modern Pill Segment Switcher (Bento Styled) */}
        <View style={styles.segmentedFilter}>
          {[
            { key: 'overview', label: 'Metrics', icon: 'chart-box-outline' },
            { key: 'export', label: 'Export', icon: 'file-export-outline' },
            { key: 'assistant', label: 'Assistant', icon: 'robot-outline' },
          ].map((tab) => {
            const active = activeTab === tab.key;
            return (
              <Pressable
                key={tab.key}
                onPress={() => setActiveTab(tab.key as any)}
                style={[styles.segmentPill, active && styles.segmentPillActive]}
              >
                <MaterialCommunityIcons
                  name={tab.icon as any}
                  size={15}
                  color={active ? '#192338' : '#64748B'}
                />
                <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Tab Content */}
      {activeTab === 'overview' ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor="#192338"
              colors={['#192338']}
            />
          }
        >
          {/* =========================================================================
              BENTO KPIS AT TOP
              ========================================================================= */}

          {/* BENTO HERO CARD (NAVY BLUE FEATURE #1) */}
          <View style={styles.bentoHeroNavy}>
            <View style={styles.bentoHeroTopRow}>
              <View style={styles.bentoTag}>
                <View style={styles.pulseDot} />
                <Text style={styles.bentoTagText}>CAPITAL VALUATION</Text>
              </View>
              <Text style={styles.bentoWarehouseBadge}>{metrics.turnoverRate}x Velocity</Text>
            </View>

            <View style={styles.bentoHeroMainMetric}>
              <Text style={styles.bentoHeroNumber}>
                ${formatNumber(metrics.totalEstimatedValuation)}
              </Text>
              <Text style={styles.bentoHeroUnit}>
                Estimated value across {formatNumber(metrics.totalOnHandUnits)} units
              </Text>
            </View>

            {/* Dual Inset Capsules */}
            <View style={styles.bentoCapsulesRow}>
              <View style={styles.bentoCapsule}>
                <View style={[styles.capsuleIconDot, { backgroundColor: '#10B981' }]}>
                  <MaterialCommunityIcons name="cube-outline" size={12} color="#FFFFFF" />
                </View>
                <View style={styles.capsuleTextWrap}>
                  <Text style={styles.capsuleLabel}>Physical On Hand</Text>
                  <Text style={styles.capsuleValue}>
                    {formatNumber(metrics.totalOnHandUnits)} units
                  </Text>
                </View>
              </View>

              <View style={styles.bentoCapsule}>
                <View style={[styles.capsuleIconDot, { backgroundColor: '#FFBF32' }]}>
                  <MaterialCommunityIcons name="tag-outline" size={12} color="#192338" />
                </View>
                <View style={styles.capsuleTextWrap}>
                  <Text style={styles.capsuleLabel}>Active Catalogue</Text>
                  <Text style={styles.capsuleValue}>{items.length} SKUs</Text>
                </View>
              </View>
            </View>
          </View>

          {/* BENTO 2-COLUMN DUO */}
          <View style={styles.bentoSplitRow}>
            {/* Tile A: Allocation Units (Light Hybrid #FCFDFE) */}
            <View style={[styles.bentoTile, styles.bentoTileLight]}>
              <View style={styles.tileHeaderRow}>
                <Text style={styles.tileTitleLight}>Available</Text>
                <MaterialCommunityIcons name="check-circle-outline" size={17} color="#059669" />
              </View>
              <View style={styles.tileMetricWrap}>
                <Text style={styles.tileNumberLight}>
                  {formatNumber(metrics.totalAvailableUnits)}
                </Text>
                <Text style={styles.tileSubLight}>{availablePercent}% ready to allocate</Text>
              </View>
            </View>

            {/* Tile B: Health Radar (NAVY ACCENT) */}
            <View style={[styles.bentoTile, styles.bentoTileNavy]}>
              <View style={styles.tileHeaderRow}>
                <Text style={styles.tileTitleNavy}>Stock Health</Text>
                <MaterialCommunityIcons name="shield-check-outline" size={17} color="#FFBF32" />
              </View>
              <View style={styles.tileMetricWrap}>
                <Text style={styles.tileNumberGold}>{metrics.healthyCount}</Text>
                <Text style={styles.tileSubNavy}>
                  {metrics.stockoutCount === 0 ? 'Zero Stockouts' : `${metrics.stockoutCount} Stockouts`}
                </Text>
              </View>
            </View>
          </View>

          {/* Time Filter Pills */}
          <View style={styles.filterPillsRow}>
            {[
              { key: 'today', label: 'Today' },
              { key: '7days', label: '7 Days' },
              { key: 'month', label: 'This Month' },
              { key: 'all', label: 'All Time' },
            ].map((f) => {
              const selected = dateFilter === f.key;
              return (
                <Pressable
                  key={f.key}
                  onPress={() => setDateFilter(f.key as any)}
                  style={[styles.filterPill, selected && styles.filterPillActive]}
                >
                  <Text style={[styles.filterPillText, selected && styles.filterPillTextActive]}>
                    {f.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Category Valuation Distribution Card */}
          <View style={styles.hybridCard}>
            <View style={styles.cardHeaderRow}>
              <View style={styles.cardHeaderLeft}>
                <View style={[styles.miniIconBox, { backgroundColor: '#FEF3C7' }]}>
                  <MaterialCommunityIcons name="chart-pie" size={17} color="#D97706" />
                </View>
                <Text style={styles.cardHeading}>Category Valuation</Text>
              </View>
              <Text style={styles.cardHeaderBadge}>{categoryBreakdown.length} Categories</Text>
            </View>

            <View style={styles.categoryBarList}>
              {categoryBreakdown.map((cat, idx) => {
                const barColors = ['#192338', '#2563EB', '#059669', '#FFBF32', '#6366F1'];
                const barColor = barColors[idx % barColors.length];
                return (
                  <View key={cat.name} style={styles.categoryBarItem}>
                    <View style={styles.categoryItemHeader}>
                      <View style={styles.catLeftRow}>
                        <View style={[styles.catColorDot, { backgroundColor: barColor }]} />
                        <Text style={styles.catItemName}>{cat.name}</Text>
                        <Text style={styles.catItemCount}>({cat.count} SKUs)</Text>
                      </View>
                      <Text style={styles.catItemVal}>${formatNumber(cat.value)}</Text>
                    </View>
                    <View style={styles.progressBarBg}>
                      <View
                        style={[
                          styles.progressBarFill,
                          { width: `${Math.max(5, cat.share)}%`, backgroundColor: barColor },
                        ]}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Throughput Flow Card */}
          <View style={styles.hybridCard}>
            <View style={styles.cardHeaderRow}>
              <View style={styles.cardHeaderLeft}>
                <View style={[styles.miniIconBox, { backgroundColor: '#EDE9FE' }]}>
                  <MaterialCommunityIcons name="swap-vertical-bold" size={17} color="#7C3AED" />
                </View>
                <Text style={styles.cardHeading}>Throughput Flow</Text>
              </View>
              <Text style={styles.cardHeaderBadge}>{dateFilter.toUpperCase()}</Text>
            </View>

            <View style={styles.throughputGrid}>
              <View style={styles.throughputTile}>
                <Text style={styles.throughputLabel}>INBOUND RECEIVED</Text>
                <Text style={styles.throughputNumber}>{formatNumber(metrics.totalReceivedUnits)}</Text>
                <Text style={styles.throughputHint}>{metrics.committedReceiptsCount} committed batches</Text>
              </View>
              <View style={styles.throughputTile}>
                <Text style={styles.throughputLabel}>RESERVED ON ORDERS</Text>
                <Text style={styles.throughputNumber}>{formatNumber(metrics.totalAllocatedUnits)}</Text>
                <Text style={styles.throughputHint}>Floor allocation</Text>
              </View>
            </View>
          </View>
        </ScrollView>
      ) : null}

      {/* Export Tab */}
      {activeTab === 'export' ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* PowerBI Export Card */}
          <View style={styles.hybridCard}>
            <View style={styles.exportHeader}>
              <View style={[styles.exportIconBox, { backgroundColor: '#FEF3C7' }]}>
                <MaterialCommunityIcons name="chart-bell-curve-cumulative" size={24} color="#D97706" />
              </View>
              <View style={styles.exportHeaderTextCol}>
                <Text style={styles.cardHeading}>Microsoft PowerBI Direct Export</Text>
                <Text style={styles.exportCardSub}>
                  Relational schema v1.2 with Items, Balances, Receipts & Locations
                </Text>
              </View>
            </View>

            <View style={styles.previewBox}>
              <Text style={styles.previewStats}>
                📊 Extracted {items.length} items, {balances.length} balance records, {receipts.length} receipts.
              </Text>
            </View>

            <Pressable
              onPress={() => void handleCopy('powerbi')}
              style={({ pressed }) => [styles.exportActionButton, pressed && styles.btnPressed]}
            >
              <MaterialCommunityIcons
                name={copiedType === 'powerbi' ? 'check' : 'content-copy'}
                size={16}
                color="#FFFFFF"
              />
              <Text style={styles.exportActionBtnText}>
                {copiedType === 'powerbi' ? 'Copied PowerBI Schema to Clipboard!' : 'Copy PowerBI JSON Model'}
              </Text>
            </Pressable>

            <Text style={styles.schemaHint}>
              Paste into PowerBI Desktop &gt; Get Data &gt; Blank Query &gt; Advanced Editor.
            </Text>
          </View>

          {/* Excel CSV Card */}
          <View style={styles.hybridCard}>
            <View style={styles.exportHeader}>
              <View style={[styles.exportIconBox, { backgroundColor: '#DCFCE7' }]}>
                <MaterialCommunityIcons name="file-excel-outline" size={24} color="#15803D" />
              </View>
              <View style={styles.exportHeaderTextCol}>
                <Text style={styles.cardHeading}>Microsoft Excel (CSV Model)</Text>
                <Text style={styles.exportCardSub}>
                  Tabular valuation report with unit costs, on-hand, and capital value
                </Text>
              </View>
            </View>

            <View style={styles.previewBox}>
              <Text style={styles.previewStats}>
                📈 Generated {items.length + 1} rows with SKU, Barcode, On Hand, Available, Unit Cost, and Capital Value.
              </Text>
            </View>

            <Pressable
              onPress={() => void handleCopy('excel')}
              style={({ pressed }) => [
                styles.exportActionButton,
                { backgroundColor: '#15803D' },
                pressed && styles.btnPressed,
              ]}
            >
              <MaterialCommunityIcons
                name={copiedType === 'excel' ? 'check' : 'content-copy'}
                size={16}
                color="#FFFFFF"
              />
              <Text style={styles.exportActionBtnText}>
                {copiedType === 'excel' ? 'Copied Excel CSV to Clipboard!' : 'Copy Excel CSV Dataset'}
              </Text>
            </Pressable>

            <Text style={styles.schemaHint}>
              Paste into Excel or save as .csv to open formatted pivot tables and inventory summaries.
            </Text>
          </View>
        </ScrollView>
      ) : null}

      {/* AI Assistant Tab */}
      {activeTab === 'assistant' ? (
        <View style={styles.assistantRoot}>
          {/* Quick Prompts */}
          <View style={styles.promptsContainer}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.promptsScroll}
            >
              {[
                { label: 'Valuation summary', prompt: 'Summarize inventory valuation & turnover' },
                { label: 'Stockout risk', prompt: 'Which items have stockout risk?' },
                { label: 'Discrepancy SOP', prompt: 'How do I handle receiving discrepancies?' },
                { label: 'FIFO vs FEFO', prompt: 'Explain FIFO and FEFO picking rules' },
              ].map((p) => (
                <Pressable
                  key={p.label}
                  onPress={() => handleQuickPrompt(p.prompt)}
                  style={styles.promptChip}
                >
                  <Text style={styles.promptChipText}>{p.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {/* Chat Messages */}
          <ScrollView
            style={styles.chatScroll}
            contentContainerStyle={styles.chatContent}
            showsVerticalScrollIndicator={false}
          >
            {messages.map((msg) => (
              <View
                key={msg.id}
                style={[
                  styles.chatBubble,
                  msg.sender === 'user' ? styles.chatBubbleUser : styles.chatBubbleAssistant,
                ]}
              >
                <View style={styles.chatSenderRow}>
                  <Text
                    style={[
                      styles.chatSenderText,
                      msg.sender === 'user' ? styles.chatSenderUser : styles.chatSenderAssistant,
                    ]}
                  >
                    {msg.sender === 'user' ? 'You' : 'NTAN Intelligence'}
                  </Text>
                  <Text style={styles.chatTimestamp}>{msg.timestamp}</Text>
                </View>
                <Text
                  style={[
                    styles.chatMessageText,
                    msg.sender === 'user' ? styles.chatMessageTextUser : styles.chatMessageTextAssistant,
                  ]}
                >
                  {msg.text}
                </Text>
              </View>
            ))}

            {isBotThinking ? (
              <View style={[styles.chatBubble, styles.chatBubbleAssistant]}>
                <ActivityIndicator size="small" color="#2563EB" />
                <Text style={styles.thinkingText}>Analyzing warehouse data...</Text>
              </View>
            ) : null}
          </ScrollView>

          {/* Chat Input Bar */}
          <View style={styles.chatInputBar}>
            <TextInput
              style={styles.chatInput}
              value={chatInput}
              onChangeText={setChatInput}
              placeholder="Ask about inventory, discrepancies, or SOPs..."
              placeholderTextColor="#8C9CAE"
              onSubmitEditing={handleSendMessage}
              returnKeyType="send"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              disabled={!chatInput.trim() || isBotThinking}
              onPress={handleSendMessage}
              style={({ pressed }) => [
                styles.sendButton,
                (!chatInput.trim() || isBotThinking) && styles.sendButtonDisabled,
                pressed && styles.btnPressed,
              ]}
            >
              <MaterialCommunityIcons name="send" size={18} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#EFF3F8',
  },
  headerArea: {
    paddingHorizontal: 16,
    paddingBottom: 6,
    backgroundColor: '#EFF3F8',
  },

  // Top Header: Pure Logo with NO box or object around it
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
    gap: 14,
    flex: 1,
  },
  logoImage: {
    width: 52,
    height: 52,
  },
  greetingBox: {
    flex: 1,
    gap: 2,
    justifyContent: 'center',
  },
  greetingTitle: {
    fontFamily: fonts.heading,
    fontSize: 27,
    color: '#192338',
    letterSpacing: -0.5,
    lineHeight: 33,
  },
  greetingSubtitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: '#64748B',
    marginTop: 1,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
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
  iconButtonPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.95 }],
  },

  // Segmented Pill Filter Row
  segmentedFilter: {
    flexDirection: 'row',
    padding: 3,
    backgroundColor: '#E2EAF4',
    borderRadius: radius.pill,
    gap: 4,
    marginTop: 4,
  },
  segmentPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  segmentPillActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  segmentLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: '#64748B',
  },
  segmentLabelActive: {
    fontFamily: fonts.heading,
    color: '#192338',
  },

  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16, // Clean uniform finish directly above floating pill TabBar
    gap: 14,
  },

  // =========================================================================
  // BENTO KPIS
  // =========================================================================

  // Hero Bento Card (Navy Blue #192338)
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

  // 2-Column Bento Duo
  bentoSplitRow: {
    flexDirection: 'row',
    gap: 12,
  },
  bentoTile: {
    flex: 1,
    borderRadius: 22,
    padding: 16,
    gap: 10,
    justifyContent: 'space-between',
  },
  bentoTileLight: {
    backgroundColor: '#FCFDFE',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderTopColor: '#FFFFFF',
    borderBottomColor: 'rgba(215, 225, 238, 0.75)',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 4,
  },
  bentoTileNavy: {
    backgroundColor: '#192338',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 20,
    elevation: 6,
  },
  tileHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tileTitleLight: {
    fontFamily: fonts.heading,
    fontSize: 14,
    color: '#192338',
  },
  tileTitleNavy: {
    fontFamily: fonts.heading,
    fontSize: 14,
    color: '#FFFFFF',
  },
  tileMetricWrap: {
    gap: 2,
  },
  tileNumberLight: {
    fontFamily: fonts.heading,
    fontSize: 22,
    color: '#192338',
    fontWeight: '800',
  },
  tileNumberGold: {
    fontFamily: fonts.heading,
    fontSize: 22,
    color: '#FFBF32',
    fontWeight: '800',
  },
  tileSubLight: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#64748B',
  },
  tileSubNavy: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#94A3B8',
  },

  // Filter Pills Row
  filterPillsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterPill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: '#FCFDFE',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderTopColor: '#FFFFFF',
    borderBottomColor: 'rgba(215, 225, 238, 0.75)',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  filterPillActive: {
    backgroundColor: '#192338',
    borderColor: '#192338',
  },
  filterPillText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11.5,
    color: '#475569',
  },
  filterPillTextActive: {
    fontFamily: fonts.heading,
    color: '#FFFFFF',
  },

  // Standard Hybrid Card
  hybridCard: {
    backgroundColor: '#FCFDFE',
    borderRadius: 22,
    padding: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderTopColor: '#FFFFFF',
    borderBottomColor: 'rgba(215, 225, 238, 0.75)',
    gap: 14,
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 4,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  miniIconBox: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeading: {
    fontFamily: fonts.heading,
    fontSize: 15,
    color: '#192338',
    fontWeight: '700',
  },
  cardHeaderBadge: {
    fontFamily: fonts.bodySemi,
    fontSize: 11.5,
    color: '#64748B',
  },
  categoryBarList: {
    gap: 11,
  },
  categoryBarItem: {
    gap: 5,
  },
  categoryItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  catLeftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  catColorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  catItemName: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: '#192338',
  },
  catItemCount: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#64748B',
  },
  catItemVal: {
    fontFamily: fonts.heading,
    fontSize: 13,
    color: '#192338',
    fontWeight: '700',
  },
  progressBarBg: {
    height: 6,
    backgroundColor: '#E2EAF4',
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  throughputGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  throughputTile: {
    flex: 1,
    backgroundColor: '#F6F9FD',
    borderRadius: 16,
    padding: 13,
    borderWidth: 1,
    borderColor: '#DFE7F0',
    gap: 3,
  },
  throughputLabel: {
    fontFamily: fonts.heading,
    fontSize: 9.5,
    letterSpacing: 0.8,
    color: '#64748B',
  },
  throughputNumber: {
    fontFamily: fonts.heading,
    fontSize: 19,
    color: '#192338',
    fontWeight: '800',
    marginTop: 2,
  },
  throughputHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#64748B',
  },

  // Export Tab Styles
  exportHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  exportIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportHeaderTextCol: {
    flex: 1,
    gap: 2,
  },
  exportCardSub: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: '#64748B',
  },
  previewBox: {
    backgroundColor: '#F3F7FA',
    padding: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DFE7F0',
  },
  previewStats: {
    fontFamily: fonts.bodySemi,
    fontSize: 11.5,
    color: '#192338',
  },
  exportActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#192338',
    paddingVertical: 12,
    borderRadius: radius.pill,
    marginTop: 2,
  },
  exportActionBtnText: {
    fontFamily: fonts.heading,
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  schemaHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#64748B',
    fontStyle: 'italic',
  },
  btnPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },

  // Assistant Tab
  assistantRoot: {
    flex: 1,
  },
  promptsContainer: {
    backgroundColor: '#EFF3F8',
    paddingVertical: 6,
  },
  promptsScroll: {
    paddingHorizontal: 16,
    gap: 8,
  },
  promptChip: {
    backgroundColor: '#FCFDFE',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderTopColor: '#FFFFFF',
    borderBottomColor: 'rgba(215, 225, 238, 0.75)',
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: radius.pill,
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  promptChipText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11.5,
    color: '#192338',
  },
  chatScroll: {
    flex: 1,
  },
  chatContent: {
    padding: 16,
    gap: 12,
  },
  chatBubble: {
    maxWidth: '85%',
    padding: 13,
    borderRadius: 18,
    gap: 4,
  },
  chatBubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: '#192338',
    borderBottomRightRadius: 3,
  },
  chatBubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: '#FCFDFE',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderTopColor: '#FFFFFF',
    borderBottomColor: 'rgba(215, 225, 238, 0.75)',
    borderBottomLeftRadius: 3,
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  chatSenderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  chatSenderText: {
    fontFamily: fonts.heading,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  chatSenderUser: {
    color: '#FFBF32',
  },
  chatSenderAssistant: {
    color: '#2563EB',
  },
  chatTimestamp: {
    fontFamily: fonts.body,
    fontSize: 9.5,
    color: '#64748B',
  },
  chatMessageText: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
  },
  chatMessageTextUser: {
    color: '#FFFFFF',
  },
  chatMessageTextAssistant: {
    color: '#192338',
  },
  thinkingText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: '#64748B',
    fontStyle: 'italic',
    marginTop: 3,
  },
  chatInputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#EFF3F8',
    gap: 8,
  },
  chatInput: {
    flex: 1,
    backgroundColor: '#FCFDFE',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderTopColor: '#FFFFFF',
    borderBottomColor: 'rgba(215, 225, 238, 0.75)',
    borderRadius: radius.pill,
    paddingHorizontal: 15,
    paddingVertical: 9,
    fontFamily: fonts.body,
    fontSize: 13,
    color: '#192338',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  sendButton: {
    backgroundColor: '#192338',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
});
