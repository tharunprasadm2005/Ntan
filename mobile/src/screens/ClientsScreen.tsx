import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError, API_BASE_URL } from '../api';
import { useAuth } from '../auth';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Field } from '../components/Field';
import { PhoneField } from '../components/PhoneField';
import { useWorkspace } from '../data';
import { formatDate, formatDateTime, formatQty, humanize } from '../format';
import { colors, fonts, radius, shadow, spacing } from '../theme';
import type {
  Client,
  PartnerAddress,
  PartnerContact,
  PartnerImportConfirmResponse,
  PartnerImportPreviewResponse,
  PartnerRole,
  SupplierItem,
} from '../types';

type PartnerTab = 'all' | 'supplier' | 'customer' | '3pl_client' | 'archived';

export function ClientsScreen({
  onBack,
  initialPartnerId,
  onOpenItem,
}: {
  onBack: () => void;
  initialPartnerId?: string | null;
  onOpenItem?: (itemId: string, supplierId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const { state, refreshSession } = useAuth();
  const { clients } = useWorkspace();
  const session = state.status === 'signedIn' ? state.session : null;
  const canManage = session?.permissions.includes('clients.manage') ?? false;
  const canManageCompany = session?.permissions.includes('company.manage') ?? false;
  const canReadCost = session?.permissions.includes('cost.read') ?? false;

  const clientInventoryEnabled =
    session?.company.inventory_model === '3pl' ||
    session?.company.inventory_model === 'hybrid';

  const [activeTab, setActiveTab] = useState<PartnerTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [partners, setPartners] = useState<Client[]>(clients);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detail Modal
  const [selectedPartner, setSelectedPartner] = useState<Client | null>(null);
  const [suppliedItems, setSuppliedItems] = useState<SupplierItem[]>([]);
  const [suppliedLoading, setSuppliedLoading] = useState(false);
  const [suppliedError, setSuppliedError] = useState<string | null>(null);
  const [initialPartnerOpened, setInitialPartnerOpened] = useState(false);

  // Add / Edit Modal
  const [editorModalOpen, setEditorModalOpen] = useState(false);
  const [editingPartner, setEditingPartner] = useState<Client | null>(null);

  // Form State
  const [formCode, setFormCode] = useState('');
  const [formName, setFormName] = useState('');
  const [formDisplayName, setFormDisplayName] = useState('');
  const [formTypes, setFormTypes] = useState<PartnerRole[]>(['supplier']);
  const [formContactName, setFormContactName] = useState('');
  const [formContactEmail, setFormContactEmail] = useState('');
  const [formContactPhone, setFormContactPhone] = useState('');
  const [formContacts, setFormContacts] = useState<PartnerContact[]>([]);
  const [formTaxId, setFormTaxId] = useState('');
  const [formBillingLine1, setFormBillingLine1] = useState('');
  const [formBillingLine2, setFormBillingLine2] = useState('');
  const [formBillingCity, setFormBillingCity] = useState('');
  const [formBillingState, setFormBillingState] = useState('');
  const [formBillingPostal, setFormBillingPostal] = useState('');
  const [formShippingLine1, setFormShippingLine1] = useState('');
  const [formShippingCity, setFormShippingCity] = useState('');
  const [formShippingType, setFormShippingType] = useState<PartnerAddress['type']>('shipping');
  const [formNotes, setFormNotes] = useState('');
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formFieldErrors, setFormFieldErrors] = useState<Record<string, string>>({});

  // Import / Export Wizard
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importStep, setImportStep] = useState<1 | 2 | 3>(1);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<{ name: string; size?: number } | null>(null);
  const [importPreview, setImportPreview] = useState<PartnerImportPreviewResponse | null>(null);
  const [duplicateStrategy, setDuplicateStrategy] = useState<'skip' | 'update'>('skip');
  const [importResult, setImportResult] = useState<PartnerImportConfirmResponse | null>(null);

  const fetchPartners = useCallback(async () => {
    try {
      setError(null);
      const res = await api.clients({ includeArchived: true });
      setPartners(res.clients);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load business partners.');
    }
  }, []);

  useEffect(() => {
    void fetchPartners();
  }, [fetchPartners]);

  // Deep link from an item's supplier list back into the supplier record.
  useEffect(() => {
    setInitialPartnerOpened(false);
  }, [initialPartnerId]);

  useEffect(() => {
    if (!initialPartnerId || initialPartnerOpened) {
      return;
    }
    const match = partners.find((partner) => partner.id === initialPartnerId);
    if (match) {
      setSelectedPartner(match);
      setInitialPartnerOpened(true);
    }
  }, [initialPartnerId, initialPartnerOpened, partners]);

  // Approved mappings supply the catalogue rows; delivery facts come from
  // committed receipts aggregated by the backend.
  useEffect(() => {
    const supplier = selectedPartner;
    if (!supplier || !supplier.types?.includes('supplier')) {
      setSuppliedItems([]);
      setSuppliedError(null);
      setSuppliedLoading(false);
      return;
    }
    let cancelled = false;
    setSuppliedLoading(true);
    setSuppliedError(null);
    api
      .supplierItems(supplier.id, true)
      .then((response) => {
        if (!cancelled) {
          setSuppliedItems(response.items);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setSuppliedItems([]);
          setSuppliedError(
            caught instanceof ApiError
              ? caught.message
              : 'Supplied items could not be loaded.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSuppliedLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPartner]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchPartners(), refreshSession()]);
    setRefreshing(false);
  };

  const counts = useMemo(() => {
    const active = partners.filter((p) => p.status !== 'archived');
    const archived = partners.filter((p) => p.status === 'archived');
    return {
      all: active.length,
      supplier: active.filter((p) => p.types?.includes('supplier')).length,
      customer: active.filter((p) => p.types?.includes('customer')).length,
      '3pl_client': active.filter((p) => p.types?.includes('3pl_client') || p.is_internal).length,
      archived: archived.length,
    };
  }, [partners]);

  const filteredPartners = useMemo(() => {
    return partners.filter((p) => {
      // Tab filter
      if (activeTab === 'archived') {
        if (p.status !== 'archived') return false;
      } else {
        if (p.status === 'archived') return false;
        if (activeTab === 'supplier' && !p.types?.includes('supplier')) return false;
        if (activeTab === 'customer' && !p.types?.includes('customer')) return false;
        if (activeTab === '3pl_client' && !p.types?.includes('3pl_client') && !p.is_internal) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const codeMatch = p.code.toLowerCase().includes(q);
        const nameMatch = p.name.toLowerCase().includes(q);
        const displayMatch = p.display_name?.toLowerCase().includes(q) ?? false;
        const phoneMatch = p.contact_phone?.toLowerCase().includes(q) ?? false;
        const taxMatch = p.tax_id?.toLowerCase().includes(q) ?? false;
        const contactMatch =
          p.contacts?.some(
            (c) =>
              c.name.toLowerCase().includes(q) ||
              c.phone?.toLowerCase().includes(q) ||
              c.email?.toLowerCase().includes(q) ||
              c.role?.toLowerCase().includes(q) ||
              c.department?.toLowerCase().includes(q),
          ) ?? false;
        return codeMatch || nameMatch || displayMatch || phoneMatch || taxMatch || contactMatch;
      }
      return true;
    });
  }, [partners, activeTab, searchQuery]);

  // Open Create Modal
  const openCreateModal = () => {
    setEditingPartner(null);
    setFormCode('');
    setFormName('');
    setFormDisplayName('');
    setFormTypes(activeTab === 'customer' ? ['customer'] : activeTab === '3pl_client' ? ['3pl_client'] : ['supplier']);
    setFormContactName('');
    setFormContactEmail('');
    setFormContactPhone('');
    setFormContacts([]);
    setFormTaxId('');
    setFormBillingLine1('');
    setFormBillingLine2('');
    setFormBillingCity('');
    setFormBillingState('');
    setFormBillingPostal('');
    setFormShippingLine1('');
    setFormShippingCity('');
    setFormShippingType('shipping');
    setFormNotes('');
    setFormError(null);
    setFormFieldErrors({});
    setEditorModalOpen(true);
  };

  // Open Edit Modal
  const openEditModal = (partner: Client) => {
    setEditingPartner(partner);
    setFormCode(partner.code);
    setFormName(partner.name);
    setFormDisplayName(partner.display_name || '');
    setFormTypes(partner.types?.length ? partner.types : ['supplier']);
    setFormContactName(partner.contact_name || '');
    setFormContactEmail(partner.contact_email || '');
    setFormContactPhone(partner.contact_phone || '');
    setFormContacts(partner.contacts && partner.contacts.length > 0 ? [...partner.contacts] : []);
    setFormTaxId(partner.tax_id || '');
    const b = partner.billing_address;
    setFormBillingLine1(b?.line1 || '');
    setFormBillingLine2(b?.line2 || '');
    setFormBillingCity(b?.city || '');
    setFormBillingState(b?.state || '');
    setFormBillingPostal(b?.postal_code || '');
    const s = partner.addresses && partner.addresses.length > 0 ? partner.addresses[0] : null;
    setFormShippingLine1(s?.line1 || '');
    setFormShippingCity(s?.city || '');
    setFormShippingType(s?.type || 'shipping');
    setFormNotes(partner.notes || '');
    setFormError(null);
    setFormFieldErrors({});
    setEditorModalOpen(true);
  };

  const toggleType = (role: PartnerRole) => {
    if (formTypes.includes(role)) {
      if (formTypes.length === 1) {
        setFormError('At least one relationship role is required.');
        return;
      }
      setFormTypes(formTypes.filter((t) => t !== role));
    } else {
      setFormTypes([...formTypes, role]);
    }
    setFormError(null);
  };

  const handleSavePartner = async () => {
    setFormError(null);
    setFormFieldErrors({});

    if (!formCode.trim()) {
      setFormFieldErrors((prev) => ({ ...prev, code: 'Enter a partner code.' }));
      return;
    }
    if (!formName.trim()) {
      setFormFieldErrors((prev) => ({ ...prev, name: 'Enter business or legal name.' }));
      return;
    }
    if (formTypes.length === 0) {
      setFormError('Select at least one partner role (Supplier, Customer, or 3PL Client).');
      return;
    }

    if (formTypes.includes('3pl_client') && !clientInventoryEnabled) {
      setFormError('3PL Client role requires Hybrid or 3PL inventory mode to be enabled first.');
      return;
    }

    setFormSaving(true);
    try {
      let finalContacts = [...formContacts];
      if (finalContacts.length === 0 && (formContactName.trim() || formContactPhone.trim() || formContactEmail.trim())) {
        finalContacts = [
          {
            name: formContactName.trim() || 'Primary Contact',
            phone: formContactPhone.trim() || null,
            email: formContactEmail.trim() || null,
            is_primary: true,
          },
        ];
      }

      const billing: PartnerAddress | null = formBillingLine1.trim()
        ? {
            name: 'Billing',
            type: 'billing',
            line1: formBillingLine1.trim(),
            line2: formBillingLine2.trim() || null,
            city: formBillingCity.trim() || 'City',
            state: formBillingState.trim() || null,
            postal_code: formBillingPostal.trim() || null,
            country: 'IN',
          }
        : null;

      const operational: PartnerAddress[] = formShippingLine1.trim()
        ? [
            {
              name: formShippingType ? humanize(formShippingType) : 'Shipping',
              type: formShippingType,
              line1: formShippingLine1.trim(),
              city: formShippingCity.trim() || 'City',
              country: 'IN',
            },
          ]
        : [];

      if (editingPartner) {
        await api.updateClient(editingPartner.id, {
          name: formName.trim(),
          display_name: formDisplayName.trim() || undefined,
          types: formTypes,
          contact_name: formContactName.trim() || undefined,
          contact_email: formContactEmail.trim() || undefined,
          contact_phone: formContactPhone.trim() || undefined,
          contacts: finalContacts.length > 0 ? finalContacts : undefined,
          tax_id: formTaxId.trim() || undefined,
          billing_address: billing,
          addresses: operational,
          notes: formNotes.trim() || undefined,
        });
      } else {
        await api.createClient({
          code: formCode.trim().toUpperCase(),
          name: formName.trim(),
          display_name: formDisplayName.trim() || undefined,
          types: formTypes,
          contact_name: formContactName.trim() || undefined,
          contact_email: formContactEmail.trim() || undefined,
          contact_phone: formContactPhone.trim() || undefined,
          contacts: finalContacts.length > 0 ? finalContacts : undefined,
          tax_id: formTaxId.trim() || undefined,
          billing_address: billing,
          addresses: operational,
          notes: formNotes.trim() || undefined,
        });
      }

      setEditorModalOpen(false);
      setSelectedPartner(null);
      await Promise.all([fetchPartners(), refreshSession()]);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setFormError(caught.message);
        setFormFieldErrors(caught.fieldErrors);
      } else {
        setFormError('Failed to save partner record.');
      }
    } finally {
      setFormSaving(false);
    }
  };

  const handleToggleArchive = (partner: Client) => {
    if (partner.is_internal) {
      Alert.alert('Protected Record', 'The internal inventory partner cannot be archived.');
      return;
    }

    const isArchived = partner.status === 'archived';
    const actionWord = isArchived ? 'Reactivate' : 'Archive';

    Alert.alert(
      `${actionWord} Partner`,
      `Are you sure you want to ${actionWord.toLowerCase()} ${partner.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: actionWord,
          style: isArchived ? 'default' : 'destructive',
          onPress: async () => {
            try {
              await api.updateClient(partner.id, {
                status: isArchived ? 'active' : 'archived',
              });
              setSelectedPartner(null);
              await Promise.all([fetchPartners(), refreshSession()]);
            } catch (err) {
              Alert.alert('Action Failed', err instanceof ApiError ? err.message : 'Could not change partner status.');
            }
          },
        },
      ],
    );
  };

  const enableHybridInventory = async () => {
    setLoading(true);
    try {
      await api.updateCompany({ inventory_model: 'hybrid' });
      await refreshSession();
    } catch (err) {
      Alert.alert('Error', err instanceof ApiError ? err.message : 'Could not update inventory mode.');
    } finally {
      setLoading(false);
    }
  };

  // --- Excel Import Handlers ---
  const handleOpenImportModal = () => {
    setImportStep(1);
    setSelectedFile(null);
    setImportPreview(null);
    setImportResult(null);
    setImportError(null);
    setImportModalOpen(true);
  };

  const handleDownloadTemplate = async () => {
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const blob = await api.downloadPartnerTemplateBlob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'NTAN_Business_Partners_Template.xlsx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      } else {
        const url = `${API_BASE_URL}/clients/import/template`;
        await Clipboard.setStringAsync(url);
        Alert.alert(
          'Template URL Copied',
          `The template URL has been copied to your clipboard. Open it in a browser to download:\n\n${url}`,
        );
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Could not download template workbook.');
    }
  };

  const handleExportPartners = async () => {
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const blob = await api.exportPartnersBlob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'NTAN_Business_Partners_Export.xlsx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      } else {
        const url = `${API_BASE_URL}/clients/export`;
        await Clipboard.setStringAsync(url);
        Alert.alert(
          'Export URL Copied',
          `The export URL has been copied to your clipboard. Open it in a browser to download:\n\n${url}`,
        );
      }
    } catch (err) {
      Alert.alert('Export Failed', err instanceof Error ? err.message : 'Could not export partners.');
    }
  };

  const handlePickFile = async () => {
    setImportError(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'text/csv',
          'application/vnd.ms-excel',
        ],
        copyToCacheDirectory: true,
      });

      if (!res.canceled && res.assets && res.assets.length > 0) {
        const asset = res.assets[0];
        setSelectedFile({
          name: asset.name,
          size: asset.size,
        });

        // Upload and preview immediately
        setImporting(true);
        const formData = new FormData();
        try {
          if ((asset as any).file instanceof Blob) {
            formData.append('file', (asset as any).file, asset.name);
          } else if (asset.uri) {
            const blobRes = await fetch(asset.uri);
            const blob = await blobRes.blob();
            formData.append('file', blob, asset.name || 'partners.xlsx');
          } else {
            throw new Error('No valid file selected.');
          }
        } catch {
          formData.append('file', {
            uri: asset.uri,
            name: asset.name,
            type: asset.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          } as any);
        }

        const previewRes = await api.previewPartnerImport(formData);
        setImportPreview(previewRes);
        setImportStep(2);
      }
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : 'Failed to parse spreadsheet file.');
    } finally {
      setImporting(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!importPreview) return;
    setImporting(true);
    setImportError(null);
    try {
      const result = await api.confirmPartnerImport({
        rows: importPreview.rows,
        duplicate_strategy: duplicateStrategy,
      });
      setImportResult(result);
      setImportStep(3);
      await Promise.all([fetchPartners(), refreshSession()]);
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : 'Partner import failed.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top + 12, 22) }]}>
      {/* Brand Header */}
      <View style={styles.brandRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to operations"
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
          <Text style={styles.greetingTitle}>Business Partners</Text>
          <Text style={styles.greetingSubtitle} numberOfLines={1}>
            {clients.length} Suppliers, Customers & 3PLs
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.deep} colors={[colors.deep]} />}
      >

        {/* Action Header Card */}
        <View style={styles.actionCard}>
          <View style={styles.actionCardBody}>
            <Text style={styles.actionTitle}>Directory & Trading Partners</Text>
            <Text style={styles.actionSubtitle}>
              Manage suppliers (inbound goods), customers (outbound dispatch), and 3PL inventory owners.
            </Text>
          </View>
          <View style={styles.actionButtonsRow}>
            {canManage ? (
              <Button
                label="Add Partner"
                onPress={openCreateModal}
              />
            ) : null}
            {canManage ? (
              <Button
                label="Bulk Import"
                variant="secondary"
                onPress={handleOpenImportModal}
              />
            ) : null}
            <Button
              label="Export"
              variant="secondary"
              onPress={() => void handleExportPartners()}
            />
          </View>
        </View>

        {/* Search Input */}
        <View style={styles.searchBar}>
          <MaterialCommunityIcons name="magnify" size={20} color={colors.muted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name, code, phone, or GSTIN..."
            placeholderTextColor={colors.muted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
          {searchQuery ? (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
              <MaterialCommunityIcons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>

        {/* Filter Tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabScrollContent}
          style={styles.tabScroll}
        >
          <View style={styles.tabContainer}>
            <Pressable
              onPress={() => setActiveTab('all')}
              style={[styles.tabButton, activeTab === 'all' && styles.tabButtonActive]}
            >
              <Text style={[styles.tabText, activeTab === 'all' && styles.tabTextActive]}>
                All ({counts.all})
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setActiveTab('supplier')}
              style={[styles.tabButton, activeTab === 'supplier' && styles.tabButtonActive]}
            >
              <Text style={[styles.tabText, activeTab === 'supplier' && styles.tabTextActive]}>
                Suppliers ({counts.supplier})
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setActiveTab('customer')}
              style={[styles.tabButton, activeTab === 'customer' && styles.tabButtonActive]}
            >
              <Text style={[styles.tabText, activeTab === 'customer' && styles.tabTextActive]}>
                Customers ({counts.customer})
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setActiveTab('3pl_client')}
              style={[styles.tabButton, activeTab === '3pl_client' && styles.tabButtonActive]}
            >
              <Text style={[styles.tabText, activeTab === '3pl_client' && styles.tabTextActive]}>
                3PL Clients ({counts['3pl_client']})
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setActiveTab('archived')}
              style={[styles.tabButton, activeTab === 'archived' && styles.tabButtonActive]}
            >
              <Text style={[styles.tabText, activeTab === 'archived' && styles.tabTextActive]}>
                Archived ({counts.archived})
              </Text>
            </Pressable>
          </View>
        </ScrollView>

        {/* 3PL Hybrid Enable Banner if viewing 3PL in Internal Mode */}
        {activeTab === '3pl_client' && !clientInventoryEnabled && canManageCompany ? (
          <View style={styles.noticeCard}>
            <MaterialCommunityIcons name="warehouse" size={22} color={colors.deep} />
            <View style={styles.noticeBody}>
              <Text style={styles.noticeTitle}>3PL Inventory Mode Disabled</Text>
              <Text style={styles.noticeText}>
                Your company is in internal inventory mode. Enable Hybrid inventory to manage 3PL client-owned stock.
              </Text>
              <Pressable
                style={styles.inlineButton}
                onPress={() => void enableHybridInventory()}
              >
                <Text style={styles.inlineButtonText}>Enable Hybrid Inventory</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* Partners List */}
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.deep} />
          </View>
        ) : filteredPartners.length === 0 ? (
          <EmptyState
            icon="account-group-outline"
            title="No Partners Found"
            message={
              searchQuery
                ? `No business partners match '${searchQuery}'.`
                : activeTab === 'supplier'
                ? 'No suppliers added yet. Add a supplier to receive inbound goods.'
                : activeTab === 'customer'
                ? 'No customers added yet. Add a customer for outbound orders.'
                : activeTab === 'archived'
                ? 'No archived business partners.'
                : 'No business partners registered yet.'
            }
          />
        ) : (
          <View style={styles.listCard}>
            {filteredPartners.map((partner) => {
              const isSupplier = partner.types?.includes('supplier');
              const isCustomer = partner.types?.includes('customer');
              const is3pl = partner.types?.includes('3pl_client') || partner.is_internal;

              return (
                <Pressable
                  key={partner.id}
                  style={({ pressed }) => [styles.partnerRow, pressed && styles.rowPressed]}
                  onPress={() => setSelectedPartner(partner)}
                >
                  <View style={styles.partnerIconBox}>
                    <MaterialCommunityIcons
                      name={
                        partner.is_internal
                          ? 'warehouse'
                          : isSupplier && isCustomer
                          ? 'handshake-outline'
                          : isSupplier
                          ? 'truck-delivery-outline'
                          : isCustomer
                          ? 'storefront-outline'
                          : 'briefcase-outline'
                      }
                      size={22}
                      color={colors.deep}
                    />
                  </View>

                  <View style={styles.partnerInfo}>
                    <View style={styles.partnerTitleRow}>
                      <Text style={styles.partnerName} numberOfLines={1}>
                        {partner.display_name || partner.name}
                      </Text>
                      <View style={styles.codeTag}>
                        <Text style={styles.codeTagText}>{partner.code}</Text>
                      </View>
                    </View>

                    {partner.display_name && partner.name !== partner.display_name ? (
                      <Text style={styles.legalName} numberOfLines={1}>
                        {partner.name}
                      </Text>
                    ) : null}

                    <View style={styles.rolesRow}>
                      {partner.is_internal ? (
                        <Badge label="Internal Inventory" tone="info" />
                      ) : (
                        <>
                          {isSupplier ? <Badge label="Supplier" tone="success" /> : null}
                          {isCustomer ? <Badge label="Customer" tone="warning" /> : null}
                          {is3pl && !partner.is_internal ? <Badge label="3PL Client" tone="info" /> : null}
                        </>
                      )}
                      {partner.tax_id ? (
                        <View style={styles.taxTag}>
                          <Text style={styles.taxTagText}>{partner.tax_id}</Text>
                        </View>
                      ) : null}
                    </View>

                    {partner.contact_name || partner.contact_phone ? (
                      <Text style={styles.contactMeta} numberOfLines={1}>
                        {[partner.contact_name, partner.contact_phone, partner.contact_email]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    ) : null}
                  </View>

                  <View style={styles.partnerEnd}>
                    {partner.status === 'archived' ? (
                      <Badge label="Archived" tone="danger" />
                    ) : (
                      <MaterialCommunityIcons name="chevron-right" size={20} color={colors.muted} />
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* PARTNER DETAIL MODAL */}
      <Modal visible={Boolean(selectedPartner)} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <SafeAreaView edges={['bottom']} style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleBlock}>
                <Text style={styles.modalEyebrow}>{selectedPartner?.code}</Text>
                <Text style={styles.modalTitle}>
                  {selectedPartner?.display_name || selectedPartner?.name}
                </Text>
              </View>
              <Pressable
                onPress={() => setSelectedPartner(null)}
                style={styles.modalCloseBtn}
              >
                <MaterialCommunityIcons name="close" size={22} color={colors.navy} />
              </Pressable>
            </View>

            {selectedPartner ? (
              <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailScrollContent}>
                {/* Roles & Status */}
                <View style={styles.detailCard}>
                  <Text style={styles.detailSectionTitle}>Relationship Roles</Text>
                  <View style={styles.rolesRow}>
                    {selectedPartner.is_internal ? (
                      <Badge label="Internal Inventory" tone="info" />
                    ) : (
                      <>
                        {selectedPartner.types?.includes('supplier') ? <Badge label="Supplier (Vendor)" tone="success" /> : null}
                        {selectedPartner.types?.includes('customer') ? <Badge label="Customer (Buyer)" tone="warning" /> : null}
                        {selectedPartner.types?.includes('3pl_client') ? <Badge label="3PL Inventory Owner" tone="info" /> : null}
                      </>
                    )}
                    <Badge
                      label={selectedPartner.status === 'active' ? 'Active' : 'Archived'}
                      tone={selectedPartner.status === 'active' ? 'success' : 'danger'}
                    />
                  </View>
                </View>

                {/* Supplied Items (supplier role) */}
                {selectedPartner.types?.includes('supplier') ? (
                  <View style={styles.detailCard}>
                    <View style={styles.suppliedHeaderRow}>
                      <Text style={styles.detailSectionTitle}>Supplied Items</Text>
                      <Text style={styles.suppliedCount}>{suppliedItems.length}</Text>
                    </View>
                    <Text style={styles.suppliedHint}>
                      Approved catalogue links. Delivery figures come from committed
                      receipts only.
                    </Text>
                    {suppliedLoading ? (
                      <View style={styles.suppliedStatusRow}>
                        <ActivityIndicator color={colors.primary} size="small" />
                        <Text style={styles.detailPlaceholder}>Loading supplied items…</Text>
                      </View>
                    ) : suppliedError ? (
                      <View style={styles.suppliedErrorRow}>
                        <MaterialCommunityIcons
                          name="alert-circle-outline"
                          size={16}
                          color={colors.danger}
                        />
                        <Text style={styles.detailErrorText}>{suppliedError}</Text>
                      </View>
                    ) : suppliedItems.length === 0 ? (
                      <Text style={styles.detailPlaceholder}>
                        No catalogue items are linked to this supplier yet. Link them
                        from an item's Suppliers section.
                      </Text>
                    ) : (
                      <View style={styles.suppliedList}>
                        {suppliedItems.map((row) => (
                          <Pressable
                            key={row.mapping_id}
                            accessibilityRole="button"
                            accessibilityLabel={`Open ${row.item_name}`}
                            disabled={!onOpenItem}
                            onPress={() => {
                              const supplierId = selectedPartner?.id;
                              if (!supplierId) {
                                return;
                              }
                              setSelectedPartner(null);
                              onOpenItem?.(row.item_id, supplierId);
                            }}
                            style={({ pressed }) => [
                              styles.suppliedRow,
                              pressed && styles.rowPressed,
                            ]}
                          >
                            <View style={styles.suppliedItemBody}>
                              <View style={styles.suppliedItemTitleRow}>
                                <Text style={styles.suppliedItemName} numberOfLines={2}>
                                  {row.item_name}
                                </Text>
                                {row.is_preferred ? (
                                  <Badge label="Preferred" tone="success" />
                                ) : null}
                              </View>
                              <Text style={styles.suppliedItemMeta}>
                                {row.item_sku} · Vendor SKU {row.supplier_sku}
                              </Text>
                              {row.status !== 'active' || row.item_status !== 'active' ? (
                                <View style={styles.suppliedBadgeRow}>
                                  {row.status !== 'active' ? (
                                    <Badge label="Link paused" tone="neutral" />
                                  ) : null}
                                  {row.item_status !== 'active' ? (
                                    <Badge label="Item archived" tone="neutral" />
                                  ) : null}
                                </View>
                              ) : null}
                              <Text style={styles.suppliedDeliveryText}>
                                {row.delivery_count > 0
                                  ? `${formatQty(row.delivered_qty)} ${
                                      row.item_base_uom
                                    } received · ${row.delivery_count} ${
                                      row.delivery_count === 1
                                        ? 'delivery'
                                        : 'deliveries'
                                    }${
                                      row.last_delivery_at
                                        ? ` · last ${formatDate(row.last_delivery_at)}`
                                        : ''
                                    }`
                                  : 'No committed deliveries yet'}
                              </Text>
                              {canReadCost && row.purchase_price !== null ? (
                                <Text style={styles.suppliedPriceText}>
                                  Purchase price {formatQty(row.purchase_price)}{' '}
                                  {row.currency}
                                  {row.lead_time_days !== null
                                    ? ` · ${row.lead_time_days} day lead time`
                                    : ''}
                                </Text>
                              ) : row.lead_time_days !== null ? (
                                <Text style={styles.suppliedPriceText}>
                                  {row.lead_time_days} day lead time
                                </Text>
                              ) : null}
                            </View>
                            {onOpenItem ? (
                              <MaterialCommunityIcons
                                name="chevron-right"
                                size={18}
                                color={colors.muted}
                              />
                            ) : null}
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>
                ) : null}

                {/* Legal & Registration Info */}
                <View style={styles.detailCard}>
                  <Text style={styles.detailSectionTitle}>Registration & Legal Details</Text>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Legal Name</Text>
                    <Text style={styles.detailValue}>{selectedPartner.name}</Text>
                  </View>
                  {selectedPartner.display_name ? (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Display Name</Text>
                      <Text style={styles.detailValue}>{selectedPartner.display_name}</Text>
                    </View>
                  ) : null}
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>GSTIN / Tax ID</Text>
                    <Text style={styles.detailValue}>{selectedPartner.tax_id || 'Not provided'}</Text>
                  </View>
                </View>

                {/* Contact Information */}
                <View style={styles.detailCard}>
                  <Text style={styles.detailSectionTitle}>Contact Persons</Text>
                  {selectedPartner.contacts && selectedPartner.contacts.length > 0 ? (
                    <View style={{ gap: spacing.sm }}>
                      {selectedPartner.contacts.map((c, idx) => (
                        <View key={idx} style={styles.contactItemBox}>
                          <View style={styles.contactHeaderRow}>
                            <Text style={styles.contactItemName}>{c.name}</Text>
                            {c.is_primary ? <Badge label="Primary" tone="info" /> : null}
                          </View>
                          {c.role || c.department ? (
                            <Text style={styles.contactRoleText}>
                              {[c.role, c.department].filter(Boolean).join(' · ')}
                            </Text>
                          ) : null}
                          <View style={styles.contactMetaRow}>
                            {c.phone ? (
                              <View style={styles.contactMetaItem}>
                                <MaterialCommunityIcons name="phone-outline" size={13} color={colors.muted} />
                                <Text style={styles.contactMetaValue}>{c.phone}</Text>
                              </View>
                            ) : null}
                            {c.email ? (
                              <View style={styles.contactMetaItem}>
                                <MaterialCommunityIcons name="email-outline" size={13} color={colors.muted} />
                                <Text style={styles.contactMetaValue}>{c.email}</Text>
                              </View>
                            ) : null}
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Contact Person</Text>
                        <Text style={styles.detailValue}>{selectedPartner.contact_name || 'None'}</Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Phone Number</Text>
                        <Text style={styles.detailValue}>{selectedPartner.contact_phone || 'None'}</Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Email Address</Text>
                        <Text style={styles.detailValue}>{selectedPartner.contact_email || 'None'}</Text>
                      </View>
                    </>
                  )}
                </View>

                {/* Addresses */}
                <View style={styles.detailCard}>
                  <Text style={styles.detailSectionTitle}>Addresses</Text>
                  <View style={styles.addressBlock}>
                    <View style={styles.addressTitleRow}>
                      <Text style={styles.addressType}>Billing Address</Text>
                      <Badge label="Billing" tone="neutral" />
                    </View>
                    {selectedPartner.billing_address ? (
                      <Text style={styles.addressText}>
                        {[
                          selectedPartner.billing_address.line1,
                          selectedPartner.billing_address.line2,
                          `${selectedPartner.billing_address.city}, ${selectedPartner.billing_address.state || ''} ${selectedPartner.billing_address.postal_code || ''}`,
                          selectedPartner.billing_address.country,
                        ]
                          .filter(Boolean)
                          .join('\n')}
                      </Text>
                    ) : (
                      <Text style={styles.detailPlaceholder}>No billing address on file</Text>
                    )}
                  </View>

                  {selectedPartner.addresses && selectedPartner.addresses.length > 0 ? (
                    selectedPartner.addresses.map((addr, idx) => (
                      <View key={idx} style={[styles.addressBlock, { marginTop: spacing.md }]}>
                        <View style={styles.addressTitleRow}>
                          <Text style={styles.addressType}>{addr.name || 'Operational Address'}</Text>
                          {addr.type ? <Badge label={humanize(addr.type)} tone="info" /> : null}
                        </View>
                        <Text style={styles.addressText}>
                          {[
                            addr.line1,
                            addr.line2,
                            `${addr.city}${addr.state ? `, ${addr.state}` : ''}${addr.postal_code ? ` ${addr.postal_code}` : ''}`,
                            addr.country,
                          ]
                            .filter(Boolean)
                            .join('\n')}
                        </Text>
                      </View>
                    ))
                  ) : null}
                </View>

                {/* Notes */}
                {selectedPartner.notes ? (
                  <View style={styles.detailCard}>
                    <Text style={styles.detailSectionTitle}>Internal Notes</Text>
                    <Text style={styles.notesText}>{selectedPartner.notes}</Text>
                  </View>
                ) : null}

                {/* Audit Metadata */}
                <View style={styles.auditMetaRow}>
                  <Text style={styles.auditText}>
                    Created {formatDate(selectedPartner.created_at)} · Updated {formatDate(selectedPartner.updated_at)}
                  </Text>
                </View>

                {/* Actions */}
                {canManage && !selectedPartner.is_internal ? (
                  <View style={styles.detailActionsRow}>
                    <Button
                      label="Edit Partner"
                      variant="secondary"
                      onPress={() => {
                        const p = selectedPartner;
                        setSelectedPartner(null);
                        openEditModal(p);
                      }}
                    />
                    <Button
                      label={selectedPartner.status === 'archived' ? 'Reactivate' : 'Archive'}
                      variant={selectedPartner.status === 'archived' ? 'secondary' : 'danger'}
                      onPress={() => handleToggleArchive(selectedPartner)}
                    />
                  </View>
                ) : null}
              </ScrollView>
            ) : null}
          </SafeAreaView>
        </View>
      </Modal>

      {/* ADD / EDIT PARTNER MODAL */}
      <Modal visible={editorModalOpen} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <SafeAreaView edges={['bottom']} style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleBlock}>
                <Text style={styles.modalEyebrow}>
                  {editingPartner ? 'UPDATE EXISTING' : 'DIRECTORY ONBOARDING'}
                </Text>
                <Text style={styles.modalTitle}>
                  {editingPartner ? 'Edit Business Partner' : 'New Business Partner'}
                </Text>
              </View>
              <Pressable
                onPress={() => setEditorModalOpen(false)}
                style={styles.modalCloseBtn}
              >
                <MaterialCommunityIcons name="close" size={22} color={colors.navy} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.detailScroll}
              contentContainerStyle={styles.detailScrollContent}
              keyboardShouldPersistTaps="handled"
            >
              {formError ? <Text style={styles.errorBanner}>{formError}</Text> : null}

              {/* Role Selectors */}
              <View style={styles.formSection}>
                <Text style={styles.formSectionTitle}>Relationship Role(s) *</Text>
                <Text style={styles.formSectionHint}>
                  A partner may have multiple roles (e.g. both a supplier and customer).
                </Text>
                <View style={styles.roleChipsRow}>
                  <Pressable
                    style={[styles.roleChip, formTypes.includes('supplier') && styles.roleChipActive]}
                    onPress={() => toggleType('supplier')}
                  >
                    <MaterialCommunityIcons
                      name={formTypes.includes('supplier') ? 'checkbox-marked-circle' : 'circle-outline'}
                      size={18}
                      color={formTypes.includes('supplier') ? colors.deep : colors.muted}
                    />
                    <Text style={[styles.roleChipText, formTypes.includes('supplier') && styles.roleChipTextActive]}>
                      Supplier (Vendor)
                    </Text>
                  </Pressable>

                  <Pressable
                    style={[styles.roleChip, formTypes.includes('customer') && styles.roleChipActive]}
                    onPress={() => toggleType('customer')}
                  >
                    <MaterialCommunityIcons
                      name={formTypes.includes('customer') ? 'checkbox-marked-circle' : 'circle-outline'}
                      size={18}
                      color={formTypes.includes('customer') ? colors.deep : colors.muted}
                    />
                    <Text style={[styles.roleChipText, formTypes.includes('customer') && styles.roleChipTextActive]}>
                      Customer (Buyer)
                    </Text>
                  </Pressable>

                  <Pressable
                    style={[styles.roleChip, formTypes.includes('3pl_client') && styles.roleChipActive]}
                    onPress={() => toggleType('3pl_client')}
                  >
                    <MaterialCommunityIcons
                      name={formTypes.includes('3pl_client') ? 'checkbox-marked-circle' : 'circle-outline'}
                      size={18}
                      color={formTypes.includes('3pl_client') ? colors.deep : colors.muted}
                    />
                    <Text style={[styles.roleChipText, formTypes.includes('3pl_client') && styles.roleChipTextActive]}>
                      3PL Client (Stock Owner)
                    </Text>
                  </Pressable>
                </View>
              </View>

              {/* Identity & Legal Info */}
              <View style={styles.formSection}>
                <Text style={styles.formSectionTitle}>Identity & Code</Text>
                <Field
                  label="Partner code *"
                  value={formCode}
                  onChangeText={setFormCode}
                  placeholder="e.g. SUP-001 or CUST-104"
                  autoCapitalize="characters"
                  disabled={Boolean(editingPartner)}
                  error={formFieldErrors.code}
                />
                <Field
                  label="Legal / Business name *"
                  value={formName}
                  onChangeText={setFormName}
                  placeholder="Apex Industrial Supplies Pvt Ltd"
                  autoCapitalize="words"
                  error={formFieldErrors.name}
                />
                <Field
                  label="Display name (optional)"
                  value={formDisplayName}
                  onChangeText={setFormDisplayName}
                  placeholder="Apex Supplies"
                  autoCapitalize="words"
                />
                <Field
                  label="GSTIN / Tax ID (optional)"
                  value={formTaxId}
                  onChangeText={setFormTaxId}
                  placeholder="27AAPFU0939F1ZV"
                  autoCapitalize="characters"
                  error={formFieldErrors.tax_id}
                />
              </View>

              {/* Contact Information & Multi-Contacts */}
              <View style={styles.formSection}>
                <View style={styles.formSectionHeaderRow}>
                  <Text style={styles.formSectionTitle}>Contact Persons</Text>
                  <Pressable
                    style={styles.addMiniBtn}
                    onPress={() => {
                      setFormContacts((prev) => [
                        ...prev,
                        {
                          name: '',
                          role: '',
                          department: '',
                          phone: '',
                          email: '',
                          is_primary: prev.length === 0,
                        },
                      ]);
                    }}
                  >
                    <MaterialCommunityIcons name="plus" size={16} color={colors.deep} />
                    <Text style={styles.addMiniBtnText}>Add Contact</Text>
                  </Pressable>
                </View>

                {formContacts.length === 0 ? (
                  <>
                    <Field
                      label="Primary contact person (optional)"
                      value={formContactName}
                      onChangeText={setFormContactName}
                      placeholder="Rajesh Kumar"
                      autoCapitalize="words"
                    />
                    <Field
                      label="Contact email (optional)"
                      value={formContactEmail}
                      onChangeText={setFormContactEmail}
                      placeholder="rajesh@example.com"
                      keyboardType="email-address"
                      autoCapitalize="none"
                      error={formFieldErrors.contact_email}
                    />
                    <PhoneField
                      label="Phone number (optional)"
                      value={formContactPhone}
                      onChangeText={setFormContactPhone}
                      placeholder="98765 43210"
                    />
                  </>
                ) : (
                  <View style={{ gap: spacing.sm }}>
                    {formContacts.map((contact, idx) => (
                      <View key={idx} style={styles.contactFormCard}>
                        <View style={styles.contactFormHeader}>
                          <Text style={styles.contactFormTitle}>
                            Contact #{idx + 1} {contact.is_primary ? '(Primary)' : ''}
                          </Text>
                          <Pressable
                            onPress={() => {
                              setFormContacts((prev) => prev.filter((_, i) => i !== idx));
                            }}
                            hitSlop={8}
                          >
                            <MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.danger} />
                          </Pressable>
                        </View>
                        <Field
                          label="Full Name *"
                          value={contact.name}
                          onChangeText={(val) => {
                            setFormContacts((prev) => {
                              const updated = [...prev];
                              updated[idx] = { ...updated[idx], name: val };
                              return updated;
                            });
                          }}
                          placeholder="e.g. Rajesh Kumar"
                          autoCapitalize="words"
                        />
                        <View style={styles.formRow}>
                          <View style={{ flex: 1 }}>
                            <Field
                              label="Role / Title"
                              value={contact.role || ''}
                              onChangeText={(val) => {
                                setFormContacts((prev) => {
                                  const updated = [...prev];
                                  updated[idx] = { ...updated[idx], role: val };
                                  return updated;
                                });
                              }}
                              placeholder="Manager / Accounts"
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Field
                              label="Department"
                              value={contact.department || ''}
                              onChangeText={(val) => {
                                setFormContacts((prev) => {
                                  const updated = [...prev];
                                  updated[idx] = { ...updated[idx], department: val };
                                  return updated;
                                });
                              }}
                              placeholder="Logistics"
                            />
                          </View>
                        </View>
                        <Field
                          label="Email"
                          value={contact.email || ''}
                          onChangeText={(val) => {
                            setFormContacts((prev) => {
                              const updated = [...prev];
                              updated[idx] = { ...updated[idx], email: val };
                              return updated;
                            });
                          }}
                          placeholder="name@example.com"
                          keyboardType="email-address"
                          autoCapitalize="none"
                        />
                        <PhoneField
                          label="Phone"
                          value={contact.phone || ''}
                          onChangeText={(val) => {
                            setFormContacts((prev) => {
                              const updated = [...prev];
                              updated[idx] = { ...updated[idx], phone: val };
                              return updated;
                            });
                          }}
                          placeholder="98765 43210"
                        />
                        <Pressable
                          style={styles.primaryCheckRow}
                          onPress={() => {
                            setFormContacts((prev) =>
                              prev.map((c, i) => ({
                                ...c,
                                is_primary: i === idx,
                              })),
                            );
                          }}
                        >
                          <MaterialCommunityIcons
                            name={contact.is_primary ? 'checkbox-marked' : 'checkbox-blank-outline'}
                            size={18}
                            color={contact.is_primary ? colors.deep : colors.muted}
                          />
                          <Text style={styles.primaryCheckLabel}>Designate as primary contact</Text>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              {/* Billing Address */}
              <View style={styles.formSection}>
                <Text style={styles.formSectionTitle}>Billing Address (optional)</Text>
                <Field
                  label="Address line 1"
                  value={formBillingLine1}
                  onChangeText={setFormBillingLine1}
                  placeholder="Plot 42, MIDC Industrial Area"
                />
                <Field
                  label="Address line 2"
                  value={formBillingLine2}
                  onChangeText={setFormBillingLine2}
                  placeholder="Andheri East"
                />
                <View style={styles.formRow}>
                  <View style={{ flex: 1 }}>
                    <Field
                      label="City"
                      value={formBillingCity}
                      onChangeText={setFormBillingCity}
                      placeholder="Mumbai"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field
                      label="PIN Code"
                      value={formBillingPostal}
                      onChangeText={setFormBillingPostal}
                      placeholder="400093"
                    />
                  </View>
                </View>
              </View>

              {/* Operational Address */}
              <View style={styles.formSection}>
                <Text style={styles.formSectionTitle}>Operational Address (optional)</Text>
                <Text style={styles.formSectionHint}>
                  Purpose-labelled address for dispatch, receiving, pickups or returns.
                </Text>
                <View style={styles.addressTypeChipsRow}>
                  {(['shipping', 'delivery', 'pickup', 'receiving', 'returns'] as const).map((t) => (
                    <Pressable
                      key={t}
                      style={[styles.addressTypeChip, formShippingType === t && styles.addressTypeChipActive]}
                      onPress={() => setFormShippingType(t)}
                    >
                      <Text
                        style={[
                          styles.addressTypeChipText,
                          formShippingType === t && styles.addressTypeChipTextActive,
                        ]}
                      >
                        {humanize(t)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Field
                  label="Address line 1"
                  value={formShippingLine1}
                  onChangeText={setFormShippingLine1}
                  placeholder="Warehouse Receiving Dock 4"
                />
                <Field
                  label="City"
                  value={formShippingCity}
                  onChangeText={setFormShippingCity}
                  placeholder="Mumbai"
                />
              </View>

              {/* Notes */}
              <View style={styles.formSection}>
                <Text style={styles.formSectionTitle}>Internal Notes (optional)</Text>
                <Field
                  label="Notes"
                  value={formNotes}
                  onChangeText={setFormNotes}
                  placeholder="Special instructions, contract terms or notes..."
                  multiline
                />
              </View>

              <View style={styles.formActionButtons}>
                <Button
                  label={editingPartner ? 'Update Partner' : 'Create Business Partner'}
                  onPress={() => void handleSavePartner()}
                  loading={formSaving}
                />
                <Button
                  label="Cancel"
                  variant="secondary"
                  onPress={() => setEditorModalOpen(false)}
                />
              </View>
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>

      {/* EXCEL BULK IMPORT / EXPORT MODAL */}
      <Modal visible={importModalOpen} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <SafeAreaView edges={['bottom']} style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleBlock}>
                <Text style={styles.modalEyebrow}>SPREADSHEET PIPELINE</Text>
                <Text style={styles.modalTitle}>Bulk Partner Import</Text>
              </View>
              <Pressable
                onPress={() => setImportModalOpen(false)}
                style={styles.modalCloseBtn}
              >
                <MaterialCommunityIcons name="close" size={22} color={colors.navy} />
              </Pressable>
            </View>

            <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailScrollContent}>
              {importError ? <Text style={styles.errorBanner}>{importError}</Text> : null}

              {importStep === 1 ? (
                <View style={styles.wizardContent}>
                  <View style={styles.wizardCard}>
                    <MaterialCommunityIcons name="file-download-outline" size={32} color={colors.deep} />
                    <Text style={styles.wizardCardTitle}>Download Official Template</Text>
                    <Text style={styles.wizardCardText}>
                      Get the pre-formatted Excel template with headers, sample partner rows, and relationship guide.
                    </Text>
                    <Button
                      label="Download Template (.xlsx)"
                      variant="secondary"
                      onPress={() => void handleDownloadTemplate()}
                    />
                  </View>

                  <View style={styles.wizardCard}>
                    <MaterialCommunityIcons name="file-upload-outline" size={32} color={colors.navy} />
                    <Text style={styles.wizardCardTitle}>Upload Completed Spreadsheet</Text>
                    <Text style={styles.wizardCardText}>
                      Select your completed .xlsx or .csv workbook. Rows will be validated before saving.
                    </Text>
                    {importing ? (
                      <ActivityIndicator size="small" color={colors.deep} />
                    ) : (
                      <Button
                        label="Select Excel / CSV File"
                        onPress={() => void handlePickFile()}
                      />
                    )}
                  </View>
                </View>
              ) : null}

              {importStep === 2 && importPreview ? (
                <View style={styles.wizardContent}>
                  {/* Summary Counters */}
                  <View style={styles.importStatsRow}>
                    <View style={styles.importStatBox}>
                      <Text style={styles.importStatNumber}>{importPreview.total_rows}</Text>
                      <Text style={styles.importStatLabel}>Total</Text>
                    </View>
                    <View style={[styles.importStatBox, { backgroundColor: '#ECFDF5' }]}>
                      <Text style={[styles.importStatNumber, { color: '#065F46' }]}>{importPreview.valid_count}</Text>
                      <Text style={styles.importStatLabel}>Valid</Text>
                    </View>
                    <View style={[styles.importStatBox, { backgroundColor: '#FEF2F2' }]}>
                      <Text style={[styles.importStatNumber, { color: '#991B1B' }]}>{importPreview.invalid_count}</Text>
                      <Text style={styles.importStatLabel}>Invalid</Text>
                    </View>
                    <View style={[styles.importStatBox, { backgroundColor: '#FFFBEB' }]}>
                      <Text style={[styles.importStatNumber, { color: '#92400E' }]}>{importPreview.duplicate_count}</Text>
                      <Text style={styles.importStatLabel}>Duplicates</Text>
                    </View>
                  </View>

                  {/* Duplicate Strategy */}
                  <View style={styles.strategyCard}>
                    <Text style={styles.strategyTitle}>Existing Partner Strategy</Text>
                    <View style={styles.strategyRow}>
                      <Pressable
                        style={[styles.strategyOption, duplicateStrategy === 'skip' && styles.strategyOptionActive]}
                        onPress={() => setDuplicateStrategy('skip')}
                      >
                        <MaterialCommunityIcons
                          name={duplicateStrategy === 'skip' ? 'radiobox-marked' : 'radiobox-blank'}
                          size={18}
                          color={duplicateStrategy === 'skip' ? colors.deep : colors.muted}
                        />
                        <Text style={styles.strategyText}>Skip duplicates</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.strategyOption, duplicateStrategy === 'update' && styles.strategyOptionActive]}
                        onPress={() => setDuplicateStrategy('update')}
                      >
                        <MaterialCommunityIcons
                          name={duplicateStrategy === 'update' ? 'radiobox-marked' : 'radiobox-blank'}
                          size={18}
                          color={duplicateStrategy === 'update' ? colors.deep : colors.muted}
                        />
                        <Text style={styles.strategyText}>Update existing</Text>
                      </Pressable>
                    </View>
                  </View>

                  {/* Row List */}
                  <Text style={styles.previewListTitle}>Row Validation Details</Text>
                  {importPreview.rows.map((row) => (
                    <View key={row.row_number} style={styles.previewRowCard}>
                      <View style={styles.previewRowHeader}>
                        <Text style={styles.previewRowCode}>Row {row.row_number}: {row.code || 'NO CODE'}</Text>
                        <Badge
                          label={row.is_valid ? (row.is_duplicate ? 'Duplicate' : 'Valid') : 'Invalid'}
                          tone={row.is_valid ? (row.is_duplicate ? 'warning' : 'success') : 'danger'}
                        />
                      </View>
                      <Text style={styles.previewRowName}>{row.name}</Text>
                      <Text style={styles.previewRowMeta}>
                        Types: {row.types.join(', ')} · Contact: {row.contact_name || 'None'}
                      </Text>
                      {row.errors.map((e, idx) => (
                        <Text key={idx} style={styles.rowErrorText}>• {e}</Text>
                      ))}
                      {row.warnings.map((w, idx) => (
                        <Text key={idx} style={styles.rowWarningText}>• {w}</Text>
                      ))}
                    </View>
                  ))}

                  <View style={styles.wizardConfirmRow}>
                    <Button
                      label={`Confirm & Import (${importPreview.valid_count} Valid Rows)`}
                      onPress={() => void handleConfirmImport()}
                      loading={importing}
                      disabled={importPreview.valid_count === 0}
                    />
                    <Button
                      label="Back to Select File"
                      variant="secondary"
                      onPress={() => setImportStep(1)}
                    />
                  </View>
                </View>
              ) : null}

              {importStep === 3 && importResult ? (
                <View style={styles.wizardResultContent}>
                  <MaterialCommunityIcons name="check-circle-outline" size={56} color="#059669" />
                  <Text style={styles.resultTitle}>Import Completed</Text>
                  <View style={styles.resultDetailsBox}>
                    <Text style={styles.resultRowText}>• Created: {importResult.created_count} partners</Text>
                    <Text style={styles.resultRowText}>• Updated: {importResult.updated_count} partners</Text>
                    <Text style={styles.resultRowText}>• Skipped: {importResult.skipped_count} rows</Text>
                    {importResult.failed_count > 0 ? (
                      <Text style={[styles.resultRowText, { color: colors.danger }]}>
                        • Failed: {importResult.failed_count} rows
                      </Text>
                    ) : null}
                  </View>
                  <Button
                    label="Done & Return to Directory"
                    onPress={() => setImportModalOpen(false)}
                  />
                </View>
              ) : null}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
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
  screen: {
    flex: 1,
    backgroundColor: '#EFF3F8',
  },
  content: {
    paddingHorizontal: 16,
    gap: 14,
    paddingBottom: 24,
  },
  pressed: {
    opacity: 0.75,
  },
  actionCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
    ...shadow,
  },
  actionCardBody: {
    gap: 2,
  },
  actionTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 15,
    color: colors.navy,
  },
  actionSubtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.muted,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    height: 42,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.navy,
  },
  tabScroll: {
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  tabScrollContent: {
    paddingRight: spacing.lg,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: radius.md,
    padding: 3,
    gap: 4,
  },
  tabButton: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  tabButtonActive: {
    backgroundColor: colors.white,
    ...shadow,
  },
  tabText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  tabTextActive: {
    fontFamily: fonts.bodySemi,
    color: colors.navy,
  },
  noticeCard: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: '#EAF3FA',
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'flex-start',
  },
  noticeBody: {
    flex: 1,
    gap: 4,
  },
  noticeTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
  },
  noticeText: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.deep,
  },
  inlineButton: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  inlineButtonText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.deep,
    textDecorationLine: 'underline',
  },
  listCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadow,
  },
  partnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowPressed: {
    backgroundColor: '#F8FAFC',
  },
  partnerIconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#EAF3FA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  partnerInfo: {
    flex: 1,
    gap: 3,
  },
  partnerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  partnerName: {
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.navy,
    flexShrink: 1,
  },
  legalName: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  codeTag: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  codeTagText: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    color: colors.deep,
    letterSpacing: 0.5,
  },
  rolesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 2,
  },
  taxTag: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  taxTagText: {
    fontFamily: fonts.body,
    fontSize: 9,
    color: colors.muted,
  },
  contactMeta: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    marginTop: 1,
  },
  partnerEnd: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  centered: {
    padding: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitleBlock: {
    gap: 1,
    flex: 1,
  },
  modalEyebrow: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    letterSpacing: 1.2,
    color: colors.deep,
  },
  modalTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 18,
    color: colors.navy,
  },
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailScroll: {
    paddingHorizontal: spacing.lg,
  },
  detailScrollContent: {
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  detailCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  detailSectionTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 0.5,
    color: colors.deep,
    marginBottom: 4,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  detailLabel: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  detailValue: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
    textAlign: 'right',
    flexShrink: 1,
  },
  detailPlaceholder: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    fontStyle: 'italic',
  },
  suppliedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  suppliedCount: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.muted,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  suppliedHint: {
    fontFamily: fonts.body,
    fontSize: 10,
    lineHeight: 15,
    color: colors.muted,
  },
  suppliedStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  suppliedErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  detailErrorText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.danger,
  },
  suppliedList: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  suppliedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  suppliedItemBody: {
    flex: 1,
    gap: 2,
  },
  suppliedItemTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  suppliedItemName: {
    flex: 1,
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
  },
  suppliedItemMeta: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  suppliedBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 2,
  },
  suppliedDeliveryText: {
    fontFamily: fonts.body,
    fontSize: 10,
    lineHeight: 15,
    color: colors.deep,
    marginTop: 2,
  },
  suppliedPriceText: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  addressBlock: {
    gap: 2,
  },
  addressTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  contactItemBox: {
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: 3,
  },
  contactHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  contactItemName: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
  },
  contactRoleText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.deep,
  },
  contactMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: 2,
  },
  contactMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  contactMetaValue: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  addressType: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.navy,
  },
  addressText: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.navy,
  },
  notesText: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.navy,
  },
  auditMetaRow: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  auditText: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  detailActionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  formSection: {
    gap: spacing.xs,
  },
  formSectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  addMiniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: '#EAF3FA',
  },
  addMiniBtnText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.deep,
  },
  formSectionTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
  },
  formSectionHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    marginBottom: spacing.xs,
  },
  contactFormCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  contactFormHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  contactFormTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  primaryCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  primaryCheckLabel: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.navy,
  },
  addressTypeChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: spacing.xs,
  },
  addressTypeChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  addressTypeChipActive: {
    borderColor: colors.deep,
    backgroundColor: '#EAF3FA',
  },
  addressTypeChipText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  addressTypeChipTextActive: {
    fontFamily: fonts.bodySemi,
    color: colors.deep,
  },
  roleChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  roleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  roleChipActive: {
    borderColor: colors.deep,
    backgroundColor: '#EAF3FA',
  },
  roleChipText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.navy,
  },
  roleChipTextActive: {
    fontFamily: fonts.bodySemi,
    color: colors.deep,
  },
  formRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  formActionButtons: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  errorBanner: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    color: colors.danger,
    padding: spacing.md,
    borderRadius: radius.md,
    fontFamily: fonts.body,
    fontSize: 12,
  },
  wizardContent: {
    gap: spacing.md,
  },
  wizardCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    textAlign: 'center',
  },
  wizardCardTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 15,
    color: colors.navy,
    textAlign: 'center',
  },
  wizardCardText: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  importStatsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  importStatBox: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  importStatNumber: {
    fontFamily: fonts.headingSemi,
    fontSize: 18,
    color: colors.navy,
  },
  importStatLabel: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  strategyCard: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  strategyTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  strategyRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: 4,
  },
  strategyOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  strategyOptionActive: {},
  strategyText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.navy,
  },
  previewListTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
    marginTop: spacing.xs,
  },
  previewRowCard: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 3,
  },
  previewRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  previewRowCode: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
  },
  previewRowName: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
  },
  previewRowMeta: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  rowErrorText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.danger,
  },
  rowWarningText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#D97706',
  },
  wizardConfirmRow: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  wizardResultContent: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  resultTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 18,
    color: colors.navy,
  },
  resultDetailsBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    width: '100%',
    gap: 4,
  },
  resultRowText: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.navy,
  },
});
