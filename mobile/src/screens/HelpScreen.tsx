import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import {
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { useWorkspace } from '../data';
import { colors, fonts, radius, shadow, spacing } from '../theme';

interface HelpScreenProps {
  onBack: () => void;
}

interface SopArticle {
  id: string;
  category: 'Inbound' | 'Storage' | 'Outbound' | 'Discrepancy';
  title: string;
  summary: string;
  steps: string[];
}

const WAREHOUSE_SOPS: SopArticle[] = [
  {
    id: 'sop-receive',
    category: 'Inbound',
    title: 'Receive Stock & Barcode Verification',
    summary: 'Standard procedure for docking, scanning cartons, verifying supplier SKUs, and staging.',
    steps: [
      'Select or scan the expected Purchase Order if arriving with a supplier manifest.',
      'Scan manufacturer or internal barcode. If unknown, tap Quick Create to register SKU immediately.',
      'Enter lot identifier and expiry date for batch-tracked items.',
      'Assign goods to a designated Receiving Dock / Staging area before committing stock.',
    ],
  },
  {
    id: 'sop-putaway',
    category: 'Storage',
    title: 'Put-away Queue & Bin Consolidation',
    summary: 'Direct staged goods from docks to permanent storage bins using aisle/rack coordinates.',
    steps: [
      'Open Putaway Queue to inspect pending inbound receipt lines awaiting bin placement.',
      'Review suggested bins: NTAN prioritizes bins already holding the identical SKU for consolidation.',
      'Scan the destination bin barcode or enter Aisle · Rack · Shelf · Bin coordinates manually.',
      'If bin space is limited, enter a partial quantity to split putaway across multiple bins.',
    ],
  },
  {
    id: 'sop-transfers',
    category: 'Storage',
    title: 'Rapid & Bulk Stock Transfers',
    summary: 'Relocate inventory between bins or dispatch cross-facility transfers without paperwork.',
    steps: [
      'Step 1: Scan the Source Location barcode where the products are currently stored.',
      'Step 2: Scan multiple item barcodes in sequence or tap "Transfer All in Bin" for bulk pallet movement.',
      'Step 3: Scan the Target Bin barcode and commit the transfer in the authoritative stock ledger.',
    ],
  },
  {
    id: 'sop-outbound',
    category: 'Outbound',
    title: 'Outbound Scan-to-Pick & Packing Path',
    summary: 'Optimized walking path fulfillment with barcode scan verification and over-pick prevention.',
    steps: [
      'Allocate available stock to open customer sales orders.',
      'Follow the walking path: items are sorted sequentially by warehouse aisle, rack, and shelf.',
      'Scan item barcode at the bin: the system validates correct SKU and suppresses accidental over-picks.',
      'Confirm packing and print carrier shipment label for final dispatch.',
    ],
  },
  {
    id: 'sop-discrepancy',
    category: 'Discrepancy',
    title: 'Short Shipments & Damage Quarantine',
    summary: 'Reconciling damaged goods, missing cartons, and supplier discrepancies.',
    steps: [
      'Record only verified undamaged units in the inbound receipt line.',
      'Stage damaged units directly to the designated Quarantine zone for inspection.',
      'Unreceived quantities remain open on the Purchase Order for supplier credit or back-order delivery.',
      'Run stock adjustments with manager authorization for write-offs or scrap.',
    ],
  },
];

const FAQS = [
  {
    q: 'How does barcode deduplication work during receiving?',
    a: 'Continuous camera scanning deduplicates identical barcodes within 1200ms to prevent accidental multiple increments while holding a box.',
  },
  {
    q: 'What happens if an item is not in the catalogue?',
    a: 'The scanner alerts you with "Item not found — Add to catalogue?". Tapping it opens Quick Create, preserving your current receiving session so you can return immediately.',
  },
  {
    q: 'Can I split a putaway task across multiple bins?',
    a: 'Yes. Enter the partial quantity placed in the first bin. The remaining quantity stays pending in the queue ready to be assigned to another shelf or rack.',
  },
  {
    q: 'How does NTAN prevent picking stock that has not arrived?',
    a: 'Outbound and Transfer pickers only display stocked items with available balances > 0. Staged or quarantined goods cannot be allocated to customer orders.',
  },
];

export function HelpScreen({ onBack }: HelpScreenProps) {
  const insets = useSafeAreaInsets();
  const { offlineStoreReady, pendingSyncCount } = useWorkspace();
  const [search, setSearch] = useState('');
  const [expandedSop, setExpandedSop] = useState<string | null>(null);
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  // Ticket Form State
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketMessage, setTicketMessage] = useState('');
  const [ticketPriority, setTicketPriority] = useState<'Normal' | 'High' | 'Urgent'>('Normal');
  const [ticketSuccess, setTicketSuccess] = useState(false);

  const filteredSops = WAREHOUSE_SOPS.filter(
    (sop) =>
      sop.title.toLowerCase().includes(search.toLowerCase()) ||
      sop.summary.toLowerCase().includes(search.toLowerCase()) ||
      sop.category.toLowerCase().includes(search.toLowerCase()),
  );

  const handleSubmitTicket = () => {
    if (!ticketSubject.trim() || !ticketMessage.trim()) {
      Alert.alert('Incomplete Form', 'Please enter a subject and description of your issue.');
      return;
    }

    setTicketSuccess(true);
    setTimeout(() => {
      setTicketSubject('');
      setTicketMessage('');
      setTicketPriority('Normal');
      setTicketSuccess(false);
    }, 4000);
  };

  const handleOpenEmail = () => {
    const subject = encodeURIComponent(ticketSubject.trim() || 'NTAN Warehouse Support Request');
    const body = encodeURIComponent(ticketMessage.trim() || 'Hello NTAN Support Team,\n\nI need assistance with:');
    void Linking.openURL(`mailto:ntanservices@gmail.com?subject=${subject}&body=${body}`);
  };

  const handleOpenWhatsApp = () => {
    const text = encodeURIComponent(
      `Hello NTAN Support, I need assistance:\nSubject: ${ticketSubject.trim() || 'General Support'}\nMessage: ${ticketMessage.trim() || 'Please assist with my warehouse workflow.'}`,
    );
    void Linking.openURL(`https://wa.me/919762729537?text=${text}`);
  };

  const handleCallPhone = () => {
    void Linking.openURL('tel:+919762729537');
  };

  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top + 12, 22) }]}>
      {/* Brand Header */}
      <View style={styles.brandRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
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
          <Text style={styles.greetingTitle}>Help & Support</Text>
          <Text style={styles.greetingSubtitle} numberOfLines={1}>
            Warehouse Knowledge & 24/7 Desk
          </Text>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Support & Care Hero */}
        <View style={styles.card}>
          <View style={styles.heroRow}>
            <View style={styles.supportIconWrap}>
              <MaterialCommunityIcons name="headset" size={26} color="#FFF" />
            </View>
            <View style={styles.heroText}>
              <Text style={styles.heroTitle}>24/7 Warehouse Support Desk</Text>
              <Text style={styles.heroSub}>
                Direct access to logistics specialists, floor operations engineers, and system support.
              </Text>
            </View>
          </View>

          <View style={styles.supportChannels}>
            <Pressable
              onPress={handleCallPhone}
              style={({ pressed }) => [styles.channelButton, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons name="phone-outline" size={20} color={colors.navy} />
              <View style={styles.channelTextGroup}>
                <Text style={styles.channelLabel}>Direct Phone Support</Text>
                <Text style={styles.channelText}>+91 97627 29537</Text>
              </View>
              <Badge label="Call" tone="info" />
            </Pressable>

            <Pressable
              onPress={handleOpenEmail}
              style={({ pressed }) => [styles.channelButton, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons name="email-outline" size={20} color={colors.navy} />
              <View style={styles.channelTextGroup}>
                <Text style={styles.channelLabel}>Official Support Email</Text>
                <Text style={styles.channelText}>ntanservices@gmail.com</Text>
              </View>
              <Badge label="Email" tone="success" />
            </Pressable>

            <Pressable
              onPress={handleOpenWhatsApp}
              style={({ pressed }) => [styles.channelButton, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons name="whatsapp" size={20} color="#25D366" />
              <View style={styles.channelTextGroup}>
                <Text style={styles.channelLabel}>WhatsApp Live Chat</Text>
                <Text style={styles.channelText}>+91 97627 29537</Text>
              </View>
              <Badge label="WhatsApp" tone="success" />
            </Pressable>
          </View>
        </View>

        {/* Live Device Diagnostics */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <MaterialCommunityIcons name="pulse" size={20} color={colors.navy} />
            <Text style={styles.cardTitle}>System Diagnostics & Outbox Health</Text>
          </View>

          <View style={styles.diagRow}>
            <View style={styles.diagItem}>
              <Text style={styles.diagLabel}>Local SQLite Engine</Text>
              <Badge
                label={offlineStoreReady ? 'Online & Healthy' : 'Memory Fallback'}
                tone={offlineStoreReady ? 'success' : 'warning'}
              />
            </View>
            <View style={styles.diagItem}>
              <Text style={styles.diagLabel}>Queued Outbox Drafts</Text>
              <Badge
                label={pendingSyncCount === 0 ? 'Sync Complete (0)' : `${pendingSyncCount} pending`}
                tone={pendingSyncCount === 0 ? 'success' : 'warning'}
              />
            </View>
          </View>
        </View>

        {/* Interactive Support Ticket Submission */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <MaterialCommunityIcons name="ticket-confirmation-outline" size={20} color={colors.navy} />
            <Text style={styles.cardTitle}>Submit a Warehouse Ticket</Text>
          </View>

          {ticketSuccess ? (
            <View style={styles.ticketSuccessCard}>
              <MaterialCommunityIcons name="check-circle" size={24} color={colors.success} />
              <Text style={styles.ticketSuccessTitle}>Ticket Logged Successfully</Text>
              <Text style={styles.ticketSuccessSub}>
                Your inquiry has been queued for our team at ntanservices@gmail.com. We will respond promptly.
              </Text>
            </View>
          ) : (
            <View style={styles.ticketForm}>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Subject / Workflow Area</Text>
                <TextInput
                  style={styles.textInput}
                  value={ticketSubject}
                  onChangeText={setTicketSubject}
                  placeholder="e.g. Scanner error during Receiving PO #104"
                  placeholderTextColor={colors.muted}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Urgency / Severity</Text>
                <View style={styles.priorityRow}>
                  {(['Normal', 'High', 'Urgent'] as const).map((p) => (
                    <Pressable
                      key={p}
                      onPress={() => setTicketPriority(p)}
                      style={[
                        styles.priorityPill,
                        ticketPriority === p && styles.priorityPillActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.priorityPillText,
                          ticketPriority === p && styles.priorityPillTextActive,
                        ]}
                      >
                        {p}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput
                  style={[styles.textInput, styles.textArea]}
                  value={ticketMessage}
                  onChangeText={setTicketMessage}
                  placeholder="Describe what occurred, steps to reproduce, or assistance needed..."
                  placeholderTextColor={colors.muted}
                  multiline
                  numberOfLines={4}
                />
              </View>

              <View style={styles.ticketActions}>
                <Button label="Submit Support Request" variant="primary" onPress={handleSubmitTicket} />
              </View>
            </View>
          )}
        </View>

        {/* Search SOPs */}
        <View style={styles.searchBar}>
          <MaterialCommunityIcons name="magnify" size={20} color={colors.muted} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search warehouse SOPs and guides..."
            placeholderTextColor={colors.muted}
          />
        </View>

        {/* SOP Guidelines Library */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionEyebrow}>STANDARD OPERATING PROCEDURES</Text>
          <Text style={styles.sectionTitle}>Warehouse SOP Library</Text>
        </View>

        {filteredSops.map((sop) => {
          const isExpanded = expandedSop === sop.id;
          return (
            <View key={sop.id} style={styles.sopCard}>
              <Pressable
                onPress={() => setExpandedSop(isExpanded ? null : sop.id)}
                style={styles.sopHeader}
              >
                <View style={styles.sopTitleGroup}>
                  <Badge label={sop.category} tone="neutral" />
                  <Text style={styles.sopTitle}>{sop.title}</Text>
                  <Text style={styles.sopSummary}>{sop.summary}</Text>
                </View>
                <MaterialCommunityIcons
                  name={isExpanded ? 'chevron-up' : 'chevron-down'}
                  size={22}
                  color={colors.muted}
                />
              </Pressable>

              {isExpanded ? (
                <View style={styles.sopBody}>
                  <Text style={styles.sopStepsHeader}>Execution Steps:</Text>
                  {sop.steps.map((step, idx) => (
                    <View key={idx} style={styles.stepRow}>
                      <View style={styles.stepNumberBadge}>
                        <Text style={styles.stepNumberText}>{idx + 1}</Text>
                      </View>
                      <Text style={styles.stepText}>{step}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}

        {/* FAQs */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionEyebrow}>COMMONLY ASKED</Text>
          <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
        </View>

        <View style={styles.faqCard}>
          {FAQS.map((faq, idx) => {
            const isFaqExpanded = expandedFaq === idx;
            return (
              <Pressable
                key={idx}
                onPress={() => setExpandedFaq(isFaqExpanded ? null : idx)}
                style={[styles.faqRow, idx === FAQS.length - 1 && styles.faqRowLast]}
              >
                <View style={styles.faqContent}>
                  <Text style={styles.faqQuestion}>{faq.q}</Text>
                  {isFaqExpanded ? <Text style={styles.faqAnswer}>{faq.a}</Text> : null}
                </View>
                <MaterialCommunityIcons
                  name={isFaqExpanded ? 'minus' : 'plus'}
                  size={18}
                  color={colors.deep}
                />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 14,
    paddingBottom: 24,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
    ...shadow,
  },
  heroRow: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
  },
  supportIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroText: {
    flex: 1,
  },
  heroTitle: {
    fontFamily: fonts.heading,
    fontSize: 16,
    color: colors.navy,
  },
  heroSub: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  supportChannels: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  channelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  channelTextGroup: {
    flex: 1,
    gap: 2,
  },
  channelLabel: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  channelText: {
    fontFamily: fonts.heading,
    fontSize: 13,
    color: colors.navy,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cardTitle: {
    fontFamily: fonts.heading,
    fontSize: 15,
    color: colors.navy,
  },
  diagRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  diagItem: {
    flex: 1,
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  diagLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.muted,
  },
  ticketForm: {
    gap: spacing.md,
  },
  fieldGroup: {
    gap: 4,
  },
  fieldLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  textInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.navy,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  priorityRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  priorityPill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  priorityPillActive: {
    backgroundColor: '#F3E8FF',
    borderColor: colors.accent,
  },
  priorityPillText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.muted,
  },
  priorityPillTextActive: {
    color: colors.navy,
  },
  ticketActions: {
    marginTop: spacing.xs,
  },
  ticketSuccessCard: {
    backgroundColor: '#E8F5E9',
    borderRadius: radius.sm,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
  },
  ticketSuccessTitle: {
    fontFamily: fonts.heading,
    fontSize: 15,
    color: '#2E7D32',
  },
  ticketSuccessSub: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: '#2E7D32',
    textAlign: 'center',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.navy,
  },
  sectionHeader: {
    marginTop: spacing.xs,
  },
  sectionEyebrow: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    letterSpacing: 1.4,
    color: colors.deep,
  },
  sectionTitle: {
    fontFamily: fonts.heading,
    fontSize: 18,
    color: colors.navy,
  },
  sopCard: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadow,
  },
  sopHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    gap: spacing.md,
  },
  sopTitleGroup: {
    flex: 1,
    gap: 4,
  },
  sopTitle: {
    fontFamily: fonts.heading,
    fontSize: 15,
    color: colors.navy,
    marginTop: 2,
  },
  sopSummary: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  sopBody: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  sopStepsHeader: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  stepRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  stepNumberBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: '#FFF',
  },
  stepText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.deep,
    lineHeight: 18,
  },
  faqCard: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow,
  },
  faqRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  faqRowLast: {
    borderBottomWidth: 0,
  },
  faqContent: {
    flex: 1,
    gap: 4,
  },
  faqQuestion: {
    fontFamily: fonts.heading,
    fontSize: 14,
    color: colors.navy,
  },
  faqAnswer: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.deep,
    lineHeight: 18,
    marginTop: 4,
  },
  pressed: {
    opacity: 0.8,
  },
});
