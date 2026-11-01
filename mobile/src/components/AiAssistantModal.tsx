import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { processWarehouseAssistantQuery } from '../aiAssistant';
import { useWorkspace } from '../data';
import { formatQty } from '../format';
import { colors, fonts, radius, shadow, spacing } from '../theme';

interface AiAssistantModalProps {
  visible: boolean;
  onClose: () => void;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

export function AiAssistantModal({ visible, onClose }: AiAssistantModalProps) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<any>(null);
  const {
    items,
    balances,
    receipts,
    warehouses,
    locations,
    clients,
    activeClient,
    internalClient,
    isMultiOwner,
  } = useWorkspace();

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-0',
      sender: 'assistant',
      text: 'Hello! I am your NTAN Warehouse AI Assistant. I can look up live stock levels for any SKU, check bin locations, review receipts, guide putaway and inspection, and explain warehouse SOPs.',
      timestamp: 'Now',
    },
  ]);
  const [input, setInput] = useState('');
  const [isBotThinking, setIsBotThinking] = useState(false);

  const executeMessage = (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: trimmed,
      timestamp: 'Just now',
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsBotThinking(true);

    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 50);

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

      setTimeout(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }, 400);
  };

  const handleSend = () => {
    executeMessage(input);
  };

  const handleQuickPrompt = (prompt: string) => {
    executeMessage(prompt);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={[styles.root, { paddingTop: insets.top }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            <View style={styles.aiBadge}>
              <MaterialCommunityIcons name="robot" size={20} color="#FFF" />
            </View>
            <View>
              <Text style={styles.headerTitle}>NTAN Warehouse AI</Text>
              <Text style={styles.headerSub}>
                {activeClient ? activeClient.name : 'Facility Assistant'} · Online
              </Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close assistant"
            onPress={onClose}
            style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
          >
            <MaterialCommunityIcons name="close" size={22} color={colors.navy} />
          </Pressable>
        </View>

        {/* Quick Suggestion Chips */}
        <View style={styles.chipsBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsContent}>
            <Pressable
              onPress={() => handleQuickPrompt('Which items have stockout risk?')}
              style={styles.chip}
            >
              <MaterialCommunityIcons name="alert-circle-outline" size={14} color={colors.danger} />
              <Text style={styles.chipText}>Stockout Risk</Text>
            </Pressable>
            <Pressable
              onPress={() => handleQuickPrompt('What is the stock of CHG-1001?')}
              style={styles.chip}
            >
              <MaterialCommunityIcons name="package-variant" size={14} color={colors.navy} />
              <Text style={styles.chipText}>Check CHG-1001</Text>
            </Pressable>
            <Pressable
              onPress={() => handleQuickPrompt('What is our total inventory valuation?')}
              style={styles.chip}
            >
              <MaterialCommunityIcons name="currency-usd" size={14} color={colors.navy} />
              <Text style={styles.chipText}>Total Valuation</Text>
            </Pressable>
            <Pressable
              onPress={() => handleQuickPrompt('How do I receive stock?')}
              style={styles.chip}
            >
              <MaterialCommunityIcons name="barcode-scan" size={14} color={colors.navy} />
              <Text style={styles.chipText}>Receive Stock SOP</Text>
            </Pressable>
            <Pressable
              onPress={() => handleQuickPrompt('Show recent delivery receipts')}
              style={styles.chip}
            >
              <MaterialCommunityIcons name="receipt" size={14} color={colors.navy} />
              <Text style={styles.chipText}>Recent Receipts</Text>
            </Pressable>
            <Pressable
              onPress={() => handleQuickPrompt('Who are our registered suppliers?')}
              style={styles.chip}
            >
              <MaterialCommunityIcons name="truck-delivery" size={14} color={colors.navy} />
              <Text style={styles.chipText}>Suppliers</Text>
            </Pressable>
            <Pressable
              onPress={() => handleQuickPrompt('How do I do a bulk stock transfer?')}
              style={styles.chip}
            >
              <MaterialCommunityIcons name="swap-horizontal" size={14} color={colors.navy} />
              <Text style={styles.chipText}>Bulk Transfer SOP</Text>
            </Pressable>
            <Pressable
              onPress={() => handleQuickPrompt('How does the putaway queue work?')}
              style={styles.chip}
            >
              <MaterialCommunityIcons name="map-marker-path" size={14} color={colors.navy} />
              <Text style={styles.chipText}>Putaway Guide</Text>
            </Pressable>
            <Pressable
              onPress={() => handleQuickPrompt('What are our warehouse picking rules?')}
              style={styles.chip}
            >
              <MaterialCommunityIcons name="tune-vertical" size={14} color={colors.navy} />
              <Text style={styles.chipText}>FEFO vs FIFO</Text>
            </Pressable>
          </ScrollView>
        </View>

        {/* Chat Stream */}
        <ScrollView
          ref={scrollRef}
          style={styles.chatScroll}
          contentContainerStyle={styles.chatContent}
          keyboardShouldPersistTaps="handled"
        >
          {messages.map((msg) => (
            <View
              key={msg.id}
              style={[
                styles.bubble,
                msg.sender === 'user' ? styles.bubbleUser : styles.bubbleAssistant,
              ]}
            >
              <View style={styles.bubbleHeader}>
                <Text
                  style={[
                    styles.bubbleSender,
                    msg.sender === 'user' ? styles.bubbleSenderUser : styles.bubbleSenderAssistant,
                  ]}
                >
                  {msg.sender === 'user' ? 'You' : 'NTAN Intelligence'}
                </Text>
                <Text style={styles.bubbleTime}>{msg.timestamp}</Text>
              </View>
              <Text
                style={[
                  styles.bubbleText,
                  msg.sender === 'user' ? styles.bubbleTextUser : styles.bubbleTextAssistant,
                ]}
              >
                {msg.text}
              </Text>
            </View>
          ))}

          {isBotThinking ? (
            <View style={[styles.bubble, styles.bubbleAssistant]}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.thinkingText}>Analyzing warehouse ledger...</Text>
            </View>
          ) : null}
        </ScrollView>

        {/* Input Bar */}
        <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ask about inventory, stockouts, transfers, SOPs..."
            placeholderTextColor={colors.muted}
            onSubmitEditing={handleSend}
            returnKeyType="send"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send message"
            disabled={!input.trim() || isBotThinking}
            onPress={handleSend}
            style={({ pressed }) => [
              styles.sendBtn,
              (!input.trim() || isBotThinking) && styles.sendBtnDisabled,
              pressed && styles.pressed,
            ]}
          >
            <MaterialCommunityIcons name="send" size={18} color="#FFF" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  aiBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: fonts.heading,
    fontSize: 16,
    color: colors.navy,
  },
  headerSub: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  closeBtn: {
    padding: spacing.xs,
  },
  chipsBar: {
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
  },
  chipsContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.navy,
  },
  chatScroll: {
    flex: 1,
  },
  chatContent: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  bubble: {
    maxWidth: '85%',
    padding: spacing.md,
    borderRadius: radius.md,
    gap: 4,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: colors.navy,
    borderBottomRightRadius: 2,
  },
  bubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 2,
    ...shadow,
  },
  bubbleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  bubbleSender: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  bubbleSenderUser: {
    color: colors.accent,
  },
  bubbleSenderAssistant: {
    color: colors.deep,
  },
  bubbleTime: {
    fontFamily: fonts.body,
    fontSize: 9,
    color: colors.muted,
  },
  bubbleText: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
  },
  bubbleTextUser: {
    color: '#FFF',
  },
  bubbleTextAssistant: {
    color: colors.navy,
  },
  thinkingText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    fontStyle: 'italic',
    marginTop: 4,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.navy,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.8,
  },
});

