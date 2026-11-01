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
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Field } from '../components/Field';
import { PhoneField } from '../components/PhoneField';
import { useWorkspace } from '../data';
import { formatDate, formatDateTime, humanize, roleLabel } from '../format';
import {
  memberInitials,
  roleDetail,
  roleOptionsFor,
  scopeLabel,
} from '../team';
import { colors, fonts, radius, shadow, spacing } from '../theme';
import type {
  ExcelImportConfirmResponse,
  ExcelImportPreviewResponse,
  ExcelImportRowPreview,
  Invitation,
  Member,
  PermissionCategory,
  RecentActivityItem,
  Role,
  RoleDefinition,
  TeamOverview,
} from '../types';

interface TeamScreenProps {
  onBack: () => void;
}

type TabType = 'overview' | 'members' | 'invitations' | 'roles';

function confirmAction(
  title: string,
  message: string,
  confirmLabel: string,
  onConfirm: () => void,
) {
  if (Platform.OS === 'web') {
    const confirm = (
      globalThis as unknown as { confirm?: (prompt: string) => boolean }
    ).confirm;
    if (!confirm || confirm(`${title}\n\n${message}`)) {
      onConfirm();
    }
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}

export function TeamScreen({ onBack }: TeamScreenProps) {
  const insets = useSafeAreaInsets();
  const { state } = useAuth();
  const { warehouses, locations } = useWorkspace();
  const session = state.status === 'signedIn' ? state.session : null;
  const permissions = session?.permissions ?? [];

  // Authority checks
  const canReadMembers = permissions.includes('members.read');
  const canManageMembers = permissions.includes('members.manage');
  const canReadInvitations = permissions.includes('invitations.read');
  const canManageInvitations = permissions.includes('invitations.manage');
  const canAssignRoles = permissions.includes('roles.assign');
  const canManageRoles = permissions.includes('roles.manage');
  const canInvite = canManageInvitations && canAssignRoles;
  const isOwner = session?.membership.role === 'owner';

  // Navigation state
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  // Core data states
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [overview, setOverview] = useState<TeamOverview | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [permissionCategories, setPermissionCategories] = useState<PermissionCategory[]>([]);

  // Member filtering
  const [memberSearch, setMemberSearch] = useState('');
  const [memberStatusFilter, setMemberStatusFilter] = useState<string>('all');
  const [memberWarehouseFilter, setMemberWarehouseFilter] = useState<string>('all');

  // Invitation filtering
  const [inviteStatusFilter, setInviteStatusFilter] = useState<string>('pending');

  // Modals
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [bulkImportModalOpen, setBulkImportModalOpen] = useState(false);
  const [customRoleModalOpen, setCustomRoleModalOpen] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [editMemberModalOpen, setEditMemberModalOpen] = useState(false);
  const [suspendModalOpen, setSuspendModalOpen] = useState(false);

  // Active targets for modals
  const [activeInvitation, setActiveInvitation] = useState<Invitation | null>(null);
  const [activeMember, setActiveMember] = useState<Member | null>(null);
  const [suspendReason, setSuspendReason] = useState('');

  // Individual Invitation Form State
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('warehouse_operator');
  const [inviteEmployeeId, setInviteEmployeeId] = useState('');
  const [inviteDepartment, setInviteDepartment] = useState('');
  const [inviteJobTitle, setInviteJobTitle] = useState('');
  const [inviteWarehouseIds, setInviteWarehouseIds] = useState<string[]>([]);
  const [inviteValidFrom, setInviteValidFrom] = useState('');
  const [inviteValidUntil, setInviteValidUntil] = useState('');
  const [submittingInvite, setSubmittingInvite] = useState(false);
  const [inviteFormError, setInviteFormError] = useState<string | null>(null);

  // Bulk Excel Import Wizard State
  const [importStep, setImportStep] = useState<1 | 2 | 3 | 4>(1);
  const [selectedFile, setSelectedFile] = useState<{ uri: string; name: string; size?: number } | null>(null);
  const [importPreview, setImportPreview] = useState<ExcelImportPreviewResponse | null>(null);
  const [importResult, setImportResult] = useState<ExcelImportConfirmResponse | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Custom Role Form State
  const [customRoleName, setCustomRoleName] = useState('');
  const [customRoleSlug, setCustomRoleSlug] = useState('');
  const [customRoleDesc, setCustomRoleDesc] = useState('');
  const [customRolePerms, setCustomRolePerms] = useState<string[]>([]);
  const [savingCustomRole, setSavingCustomRole] = useState(false);
  const [customRoleError, setCustomRoleError] = useState<string | null>(null);

  // Edit Member Assignments State
  const [editRole, setEditRole] = useState<string>('viewer');
  const [editWarehouseIds, setEditWarehouseIds] = useState<string[]>([]);
  const [editValidUntil, setEditValidUntil] = useState('');
  const [savingMemberEdit, setSavingMemberEdit] = useState(false);
  const [editMemberError, setEditMemberError] = useState<string | null>(null);

  // Clipboard copy feedback
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const activeWarehouses = useMemo(
    () => warehouses.filter((w) => w.status === 'active'),
    [warehouses],
  );

  const roleOptions = useMemo(
    () => roleOptionsFor(session?.membership.role ?? 'viewer'),
    [session?.membership.role],
  );

  const activeOwners = useMemo(
    () => members.filter((m) => m.role === 'owner' && m.status === 'active'),
    [members],
  );

  // --------------------------------------------------------------------------
  // Data Loading
  // --------------------------------------------------------------------------
  const loadData = useCallback(async () => {
    if (!canReadMembers) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [overviewData, membersData, rolesData] = await Promise.all([
        api.teamOverview().catch(() => null),
        api.members(),
        api.roles().catch(() => []),
      ]);

      setOverview(overviewData);
      setMembers(membersData.members);
      setRoles(rolesData);

      if (canReadInvitations) {
        const invData = await api.invitations().catch(() => ({ invitations: [] }));
        setInvitations(invData.invitations);
      }

      if (canManageRoles || canAssignRoles) {
        const permsCat = await api.permissionsCatalogue().catch(() => []);
        setPermissionCategories(permsCat);
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to load team data from server.',
      );
    } finally {
      setLoading(false);
    }
  }, [canAssignRoles, canManageRoles, canReadInvitations, canReadMembers]);

  const refreshData = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // --------------------------------------------------------------------------
  // Filtered Lists
  // --------------------------------------------------------------------------
  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      if (memberStatusFilter !== 'all' && m.status !== memberStatusFilter) {
        return false;
      }
      if (memberWarehouseFilter !== 'all') {
        const whIds = m.warehouse_ids ?? m.location_ids ?? [];
        if (!whIds.includes(memberWarehouseFilter)) {
          return false;
        }
      }
      if (memberSearch.trim()) {
        const term = memberSearch.trim().toLowerCase();
        const matchesName = m.name.toLowerCase().includes(term);
        const matchesEmail = m.email.toLowerCase().includes(term);
        const matchesEmp = m.employee_id ? m.employee_id.toLowerCase().includes(term) : false;
        const matchesRole = (m.role_label || m.role).toLowerCase().includes(term);
        return matchesName || matchesEmail || matchesEmp || matchesRole;
      }
      return true;
    });
  }, [memberSearch, memberStatusFilter, memberWarehouseFilter, members]);

  const filteredInvitations = useMemo(() => {
    return invitations.filter((inv) => {
      if (inviteStatusFilter === 'all') return true;
      if (inviteStatusFilter === 'attention') {
        return (
          inv.status === 'failed' ||
          inv.email_delivery_status === 'failed' ||
          (inv.status === 'pending' && new Date(inv.expires_at).getTime() - Date.now() < 86400000)
        );
      }
      return inv.status === inviteStatusFilter;
    });
  }, [inviteStatusFilter, invitations]);

  const activeMembersCount = useMemo(() => {
    return members.filter((m) => m.status === 'active').length;
  }, [members]);

  const suspendedMembersCount = useMemo(() => {
    return members.filter((m) => m.status === 'suspended').length;
  }, [members]);

  const inactiveMembersCount = useMemo(() => {
    return members.filter((m) => m.status === 'inactive').length;
  }, [members]);

  const pendingInvitesCount = useMemo(() => {
    return invitations.filter((i) => i.status === 'pending').length;
  }, [invitations]);

  const attentionInvitesCount = useMemo(() => {
    return invitations.filter((i) => {
      return (
        i.status === 'failed' ||
        i.email_delivery_status === 'failed' ||
        (i.status === 'pending' && new Date(i.expires_at).getTime() - Date.now() < 86400000)
      );
    }).length;
  }, [invitations]);

  const acceptedInvitesCount = useMemo(() => {
    return invitations.filter((i) => i.status === 'accepted').length;
  }, [invitations]);

  const revokedInvitesCount = useMemo(() => {
    return invitations.filter((i) => i.status === 'revoked').length;
  }, [invitations]);

  // --------------------------------------------------------------------------
  // Clipboard & Sharing
  // --------------------------------------------------------------------------
  const copyToClipboard = async (text: string, key: string) => {
    await Clipboard.setStringAsync(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const shareInvitation = async (invitation: Invitation) => {
    const code = invitation.invite_code ?? '';
    const shareUrl = `${api.getImportTemplateUrl().replace('/members/import/template', '')}/auth/join?code=${encodeURIComponent(code)}`;
    const message = `You've been invited to join ${session?.company.name} on NTAN Inventory.\n\nInvitation Code: ${code}\nLink: ${shareUrl}`;
    try {
      await Share.share({
        message,
        url: Platform.OS === 'ios' ? shareUrl : undefined,
        title: `Join ${session?.company.name} on NTAN`,
      });
    } catch {
      // Ignored
    }
  };

  // --------------------------------------------------------------------------
  // Individual Invitation Handlers
  // --------------------------------------------------------------------------
  const handleOpenInvite = () => {
    setInviteName('');
    setInviteEmail('');
    setInvitePhone('');
    setInviteRole('warehouse_operator');
    setInviteEmployeeId('');
    setInviteDepartment('');
    setInviteJobTitle('');
    setInviteWarehouseIds([]);
    setInviteValidFrom('');
    setInviteValidUntil('');
    setInviteFormError(null);
    setInviteModalOpen(true);
  };

  const handleSubmitInvite = async () => {
    if (!inviteEmail.trim() || !inviteEmail.includes('@')) {
      setInviteFormError('Please provide a valid work email address.');
      return;
    }
    setSubmittingInvite(true);
    setInviteFormError(null);
    try {
      await api.createInvitation({
        email: inviteEmail.trim(),
        name: inviteName.trim() || undefined,
        phone: invitePhone.trim() || undefined,
        role: inviteRole,
        employee_id: inviteEmployeeId.trim() || undefined,
        department: inviteDepartment.trim() || undefined,
        job_title: inviteJobTitle.trim() || undefined,
        warehouse_ids: inviteWarehouseIds,
        valid_from: inviteValidFrom.trim() || undefined,
        valid_until: inviteValidUntil.trim() || undefined,
      });
      setInviteModalOpen(false);
      await loadData();
    } catch (err) {
      setInviteFormError(
        err instanceof ApiError ? err.message : 'Failed to create invitation.',
      );
    } finally {
      setSubmittingInvite(false);
    }
  };

  const handleResendInvitation = async (invitationId: string) => {
    setActionError(null);
    try {
      await api.resendInvitation(invitationId);
      await loadData();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : 'Failed to resend invitation.',
      );
    }
  };

  const handleReplaceInvitation = async (invitationId: string) => {
    confirmAction(
      'Replace Invitation?',
      'This will cancel the current invite code and issue a brand new secure invitation.',
      'Replace Invitation',
      async () => {
        setActionError(null);
        try {
          await api.replaceInvitation(invitationId);
          await loadData();
        } catch (err) {
          setActionError(
            err instanceof ApiError ? err.message : 'Failed to replace invitation.',
          );
        }
      },
    );
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    confirmAction(
      'Revoke Invitation?',
      'The recipient will no longer be able to use this invite code or link to join.',
      'Revoke Invitation',
      async () => {
        setActionError(null);
        try {
          await api.revokeInvitation(invitationId);
          await loadData();
        } catch (err) {
          setActionError(
            err instanceof ApiError ? err.message : 'Failed to revoke invitation.',
          );
        }
      },
    );
  };

  // --------------------------------------------------------------------------
  // Member Lifecycle Handlers
  // --------------------------------------------------------------------------
  const handleOpenSuspend = (member: Member) => {
    if (member.role === 'owner' && activeOwners.length <= 1) {
      Alert.alert('Owner Protection', 'The last active owner cannot be suspended.');
      return;
    }
    setActiveMember(member);
    setSuspendReason('');
    setSuspendModalOpen(true);
  };

  const handleConfirmSuspend = async () => {
    if (!activeMember) return;
    setActionError(null);
    try {
      await api.suspendMember(activeMember.id, suspendReason);
      setSuspendModalOpen(false);
      setActiveMember(null);
      await loadData();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : 'Failed to suspend member.',
      );
    }
  };

  const handleReactivateMember = async (memberId: string) => {
    setActionError(null);
    try {
      await api.reactivateMember(memberId);
      await loadData();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : 'Failed to reactivate member.',
      );
    }
  };

  const handleRemoveMember = async (member: Member) => {
    if (member.role === 'owner' && activeOwners.length <= 1) {
      Alert.alert('Owner Protection', 'The last active owner cannot be removed.');
      return;
    }
    confirmAction(
      `Remove ${member.name}?`,
      'This will remove their organization membership and revoke all facility access. Stock movement attribution and audit records will be permanently preserved.',
      'Remove Member',
      async () => {
        setActionError(null);
        try {
          await api.removeMember(member.id);
          await loadData();
        } catch (err) {
          setActionError(
            err instanceof ApiError ? err.message : 'Failed to remove member.',
          );
        }
      },
    );
  };

  const handleOpenEditMember = (member: Member) => {
    setActiveMember(member);
    setEditRole(member.role);
    setEditWarehouseIds(member.warehouse_ids ?? member.location_ids ?? []);
    setEditValidUntil(member.valid_until ?? '');
    setEditMemberError(null);
    setEditMemberModalOpen(true);
  };

  const handleSaveMemberEdit = async () => {
    if (!activeMember) return;
    if (activeMember.role === 'owner' && editRole !== 'owner' && activeOwners.length <= 1) {
      setEditMemberError('Cannot demote the last active owner of the company.');
      return;
    }
    setSavingMemberEdit(true);
    setEditMemberError(null);
    try {
      await api.updateMember(activeMember.id, {
        role: editRole,
        warehouse_ids: editWarehouseIds,
        valid_until: editValidUntil.trim() || null,
      });
      setEditMemberModalOpen(false);
      setActiveMember(null);
      await loadData();
    } catch (err) {
      setEditMemberError(
        err instanceof ApiError ? err.message : 'Failed to update member assignment.',
      );
    } finally {
      setSavingMemberEdit(false);
    }
  };

  // --------------------------------------------------------------------------
  // Bulk Excel Import Handlers
  // --------------------------------------------------------------------------
  const handleOpenBulkImport = () => {
    setImportStep(1);
    setSelectedFile(null);
    setImportPreview(null);
    setImportResult(null);
    setImportError(null);
    setBulkImportModalOpen(true);
  };

  const handleDownloadTemplate = async () => {
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const blob = await api.downloadImportTemplateBlob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'NTAN_Employee_Import_Template.xlsx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      } else {
        const url = api.getImportTemplateUrl();
        await Clipboard.setStringAsync(url);
        Alert.alert(
          'Template URL Copied',
          `The template URL has been copied to your clipboard. Open it in a browser to download:\n\n${url}`,
        );
      }
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : 'Could not download template workbook.',
      );
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
          uri: asset.uri,
          name: asset.name,
          size: asset.size,
        });

        // Automatically trigger preview upload
        await handleUploadFile(asset);
      }
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : 'Failed to select spreadsheet file.',
      );
    }
  };

  const handleUploadFile = async (asset: { uri: string; name: string; mimeType?: string; file?: any }) => {
    setImporting(true);
    setImportError(null);
    try {
      const formData = new FormData();
      try {
        if ((asset as any).file instanceof Blob) {
          formData.append('file', (asset as any).file, asset.name);
        } else if (asset.uri) {
          const blobRes = await fetch(asset.uri);
          const blob = await blobRes.blob();
          formData.append('file', blob, asset.name || 'members.xlsx');
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

      const previewRes = await api.previewExcelImport(formData);
      setImportPreview(previewRes);
      setImportStep(2);
    } catch (err) {
      setImportError(
        err instanceof ApiError ? err.message : 'Spreadsheet validation failed. Ensure correct template format.',
      );
    } finally {
      setImporting(false);
    }
  };

  const handleConfirmBulkImport = async () => {
    if (!importPreview) return;
    setImporting(true);
    setImportError(null);
    try {
      const validRows = importPreview.rows.filter((r) => r.is_valid);
      const payloadRows = validRows.map((r) => ({
        name: r.name,
        email: r.email,
        role: r.role,
        warehouse_codes: r.warehouse_codes,
        phone: r.phone || undefined,
        employee_id: r.employee_id || undefined,
        job_title: r.job_title || undefined,
        department: r.department || undefined,
        valid_from: r.valid_from || undefined,
        valid_until: r.valid_until || undefined,
      }));

      const res = await api.confirmExcelImport({
        rows: payloadRows,
        send_emails: true,
      });

      setImportResult(res);
      setImportStep(4);
      await loadData();
    } catch (err) {
      setImportError(
        err instanceof ApiError ? err.message : 'Failed to execute bulk invitation import.',
      );
    } finally {
      setImporting(false);
    }
  };

  // --------------------------------------------------------------------------
  // Custom Role Builder Handlers
  // --------------------------------------------------------------------------
  const handleOpenCustomRole = () => {
    setCustomRoleName('');
    setCustomRoleSlug('');
    setCustomRoleDesc('');
    setCustomRolePerms([]);
    setCustomRoleError(null);
    setCustomRoleModalOpen(true);
  };

  const toggleCustomRolePerm = (key: string) => {
    setCustomRolePerms((curr) =>
      curr.includes(key) ? curr.filter((p) => p !== key) : [...curr, key],
    );
  };

  const handleSaveCustomRole = async () => {
    if (!customRoleName.trim()) {
      setCustomRoleError('Role name is required.');
      return;
    }
    if (customRolePerms.length === 0) {
      setCustomRoleError('Select at least one permission for this role.');
      return;
    }
    setSavingCustomRole(true);
    setCustomRoleError(null);
    try {
      await api.createCustomRole({
        name: customRoleName.trim(),
        slug: customRoleSlug.trim() || undefined,
        description: customRoleDesc.trim() || undefined,
        permissions: customRolePerms,
      });
      setCustomRoleModalOpen(false);
      await loadData();
    } catch (err) {
      setCustomRoleError(
        err instanceof ApiError ? err.message : 'Failed to create custom role.',
      );
    } finally {
      setSavingCustomRole(false);
    }
  };

  const handleDeleteCustomRole = async (role: RoleDefinition) => {
    confirmAction(
      `Delete ${role.name}?`,
      'This custom role will be permanently removed. Any member assigned this role should be reassigned first.',
      'Delete Role',
      async () => {
        setActionError(null);
        try {
          await api.deleteCustomRole(role.id);
          await loadData();
        } catch (err) {
          setActionError(
            err instanceof ApiError ? err.message : 'Failed to delete custom role.',
          );
        }
      },
    );
  };

  // --------------------------------------------------------------------------
  // Render Tab Content
  // --------------------------------------------------------------------------
  const renderOverviewTab = () => {
    if (!overview) {
      return (
        <View style={styles.errorBox}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingText}>Loading team overview...</Text>
        </View>
      );
    }

    return (
      <View style={styles.tabContent}>
        {/* KPI Grid */}
        <View style={styles.kpiGrid}>
          <View style={[styles.kpiCard, styles.kpiCardBlue]}>
            <MaterialCommunityIcons name="account-group" size={28} color={colors.primary} />
            <Text style={styles.kpiNumber}>{overview.active_members}</Text>
            <Text style={styles.kpiTitle}>Active Members</Text>
          </View>
          <View style={[styles.kpiCard, styles.kpiCardYellow]}>
            <MaterialCommunityIcons name="email-fast-outline" size={28} color={colors.warning} />
            <Text style={styles.kpiNumber}>{overview.pending_invitations}</Text>
            <Text style={styles.kpiTitle}>Pending Invites</Text>
          </View>
          <View style={[styles.kpiCard, overview.attention_invitations > 0 ? styles.kpiCardRed : styles.kpiCardMuted]}>
            <MaterialCommunityIcons name="alert-circle-outline" size={28} color={overview.attention_invitations > 0 ? colors.danger : colors.muted} />
            <Text style={styles.kpiNumber}>{overview.attention_invitations}</Text>
            <Text style={styles.kpiTitle}>Needs Attention</Text>
          </View>
          <View style={[styles.kpiCard, styles.kpiCardNavy]}>
            <MaterialCommunityIcons name="warehouse" size={28} color={colors.navy} />
            <Text style={styles.kpiNumber}>{overview.distinct_warehouses_count}</Text>
            <Text style={styles.kpiTitle}>Warehouses Represented</Text>
          </View>
        </View>

        {/* Quick Actions Row */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionHeading}>Quick Actions</Text>
        </View>
        <View style={styles.actionRow}>
          {canInvite && (
            <>
              <Button
                label="+ Invite Member"
                variant="primary"
                onPress={handleOpenInvite}
                style={styles.actionBtn}
              />
              <Button
                label="Bulk Import (Excel)"
                variant="secondary"
                onPress={handleOpenBulkImport}
                style={styles.actionBtn}
              />
            </>
          )}
          {canManageRoles && (
            <Button
              label="+ Custom Role"
              variant="ghost"
              onPress={handleOpenCustomRole}
              style={styles.actionBtn}
            />
          )}
        </View>

        {/* Recent Audit & Activity Timeline */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionHeading}>Recent Team Activity</Text>
          <Badge label="Live Audit" tone="info" />
        </View>

        {overview.recent_activity.length === 0 ? (
          <EmptyState
            icon="history"
            title="No Recent Activity"
            message="Recent access changes, member invitations, and role assignments will appear here."
          />
        ) : (
          <View style={styles.activityFeed}>
            {overview.recent_activity.map((item) => (
              <View key={item.id} style={styles.activityItem}>
                <View style={styles.activityDot} />
                <View style={styles.activityBody}>
                  <View style={styles.activityTopRow}>
                    <Text style={styles.activityActor}>{item.actor_name}</Text>
                    <Badge label={item.action_label} tone="neutral" />
                  </View>
                  {item.target_name && (
                    <Text style={styles.activityTarget}>Target: {item.target_name}</Text>
                  )}
                  <Text style={styles.activityTime}>{formatDateTime(item.created_at)}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  const renderMembersTab = () => {
    return (
      <View style={styles.tabContent}>
        {/* Members KPI Summary */}
        <View style={styles.membersStatsGrid}>
          <View style={[styles.membersStatCard, styles.membersStatCardActive]}>
            <View style={styles.membersStatTop}>
              <MaterialCommunityIcons name="account-check" size={18} color={colors.success} />
              <Text style={styles.membersStatLabel}>ACTIVE MEMBERS</Text>
            </View>
            <Text style={[styles.membersStatNumber, { color: colors.success }]}>
              {activeMembersCount}
            </Text>
          </View>
          <View style={[styles.membersStatCard, styles.membersStatCardTotal]}>
            <View style={styles.membersStatTop}>
              <MaterialCommunityIcons name="account-group" size={18} color={colors.primary} />
              <Text style={styles.membersStatLabel}>TOTAL MEMBERS</Text>
            </View>
            <Text style={[styles.membersStatNumber, { color: colors.primary }]}>
              {members.length}
            </Text>
          </View>
        </View>

        {/* Search & Warehouse Filter */}
        <View style={styles.filterBar}>
          <View style={styles.searchContainer}>
            <MaterialCommunityIcons name="magnify" size={20} color={colors.muted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name, email, employee ID..."
              placeholderTextColor={colors.muted}
              value={memberSearch}
              onChangeText={setMemberSearch}
            />
            {memberSearch ? (
              <Pressable onPress={() => setMemberSearch('')}>
                <MaterialCommunityIcons name="close-circle" size={18} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* Status Filter Chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          {[
            { key: 'all', label: `All (${members.length})` },
            { key: 'active', label: `Active (${activeMembersCount})` },
            { key: 'suspended', label: `Suspended (${suspendedMembersCount})` },
            { key: 'inactive', label: `Inactive (${inactiveMembersCount})` },
          ].map((st) => (
            <Pressable
              key={st.key}
              onPress={() => setMemberStatusFilter(st.key)}
              style={[styles.chip, memberStatusFilter === st.key && styles.chipActive]}
            >
              <Text style={[styles.chipText, memberStatusFilter === st.key && styles.chipTextActive]}>
                {st.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Member Cards List */}
        {filteredMembers.length === 0 ? (
          <EmptyState
            icon="account-search"
            title="No Members Found"
            message={memberSearch ? 'No team members match your filter criteria.' : 'Company members will appear here.'}
          />
        ) : (
          filteredMembers.map((member, memberIdx) => {
            const isMemberOwner = member.role === 'owner';
            const isSuspended = member.status === 'suspended';
            const isInactive = member.status === 'inactive';
            const assignedWhIds = member.warehouse_ids ?? member.location_ids ?? [];
            const isTemporary = !!member.valid_until;
            const isExpired = isTemporary && new Date(member.valid_until!).getTime() < Date.now();

            return (
              <View key={`member-${member.id || memberIdx}`} style={styles.memberCard}>
                <View style={styles.memberCardHeader}>
                  <View style={styles.memberAvatar}>
                    <Text style={styles.avatarText}>{memberInitials(member.name)}</Text>
                  </View>
                  <View style={styles.memberDetails}>
                    <View style={styles.memberNameRow}>
                      <Text style={styles.memberName}>{member.name}</Text>
                      {member.employee_id && (
                        <Text style={styles.memberEmpId}>ID: {member.employee_id}</Text>
                      )}
                    </View>
                    <Text style={styles.memberEmail}>{member.email}</Text>
                    {member.phone && <Text style={styles.memberPhone}>{member.phone}</Text>}
                  </View>
                  <Badge
                    label={member.status}
                    tone={isSuspended ? 'danger' : isInactive ? 'neutral' : 'success'}
                  />
                </View>

                {/* Role and Department info */}
                <View style={styles.memberBadgeRow}>
                  <Badge label={member.role_label || roleLabel(member.role)} tone="info" />
                  {member.department && (
                    <Badge label={`Dept: ${member.department}`} tone="neutral" />
                  )}
                  {member.job_title && (
                    <Text style={styles.memberJobTitle}>{member.job_title}</Text>
                  )}
                </View>

                {/* Scoped Warehouses */}
                <View style={styles.warehouseScopeContainer}>
                  <MaterialCommunityIcons name="warehouse" size={16} color={colors.muted} />
                  <Text style={styles.warehouseScopeText}>
                    {assignedWhIds.length === 0
                      ? 'All Organization Warehouses'
                      : scopeLabel(assignedWhIds, activeWarehouses, locations)}
                  </Text>
                </View>

                {/* Temporary access alert if configured */}
                {isTemporary && (
                  <View style={[styles.tempAccessBanner, isExpired && styles.tempAccessExpired]}>
                    <MaterialCommunityIcons
                      name={isExpired ? 'alert-octagon' : 'clock-outline'}
                      size={16}
                      color={isExpired ? colors.danger : colors.warning}
                    />
                    <Text style={[styles.tempAccessText, isExpired && styles.tempAccessTextExpired]}>
                      {isExpired
                        ? `Temporary access expired on ${formatDate(member.valid_until!)}`
                        : `Temporary access until ${formatDate(member.valid_until!)}`}
                    </Text>
                  </View>
                )}

                {/* Actions Row */}
                {canManageMembers && (
                  <View style={styles.memberActionRow}>
                    <Pressable
                      style={styles.miniActionBtn}
                      onPress={() => handleOpenEditMember(member)}
                    >
                      <MaterialCommunityIcons name="pencil-outline" size={16} color={colors.primary} />
                      <Text style={styles.miniActionText}>Assignments</Text>
                    </Pressable>

                    {!isSuspended && !isInactive && (
                      <Pressable
                        style={styles.miniActionBtn}
                        onPress={() => handleOpenSuspend(member)}
                      >
                        <MaterialCommunityIcons name="account-cancel-outline" size={16} color={colors.warning} />
                        <Text style={[styles.miniActionText, { color: colors.warning }]}>Suspend</Text>
                      </Pressable>
                    )}

                    {isSuspended && (
                      <Pressable
                        style={styles.miniActionBtn}
                        onPress={() => handleReactivateMember(member.id)}
                      >
                        <MaterialCommunityIcons name="account-check-outline" size={16} color={colors.success} />
                        <Text style={[styles.miniActionText, { color: colors.success }]}>Reactivate</Text>
                      </Pressable>
                    )}

                    {!isMemberOwner && (
                      <Pressable
                        style={styles.miniActionBtn}
                        onPress={() => handleRemoveMember(member)}
                      >
                        <MaterialCommunityIcons name="trash-can-outline" size={16} color={colors.danger} />
                        <Text style={[styles.miniActionText, { color: colors.danger }]}>Remove</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            );
          })
        )}
      </View>
    );
  };

  const renderInvitationsTab = () => {
    return (
      <View style={styles.tabContent}>
        {/* Status Filter Chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          {[
            { key: 'pending', label: `Pending (${pendingInvitesCount})` },
            { key: 'attention', label: `Attention (${attentionInvitesCount})` },
            { key: 'accepted', label: `Accepted (${acceptedInvitesCount})` },
            { key: 'revoked', label: `Revoked (${revokedInvitesCount})` },
            { key: 'all', label: `All (${invitations.length})` },
          ].map((st) => (
            <Pressable
              key={st.key}
              onPress={() => setInviteStatusFilter(st.key)}
              style={[styles.chip, inviteStatusFilter === st.key && styles.chipActive]}
            >
              <Text style={[styles.chipText, inviteStatusFilter === st.key && styles.chipTextActive]}>
                {st.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {filteredInvitations.length === 0 ? (
          <EmptyState
            icon="email-outline"
            title="No Invitations"
            message="No invitations found matching this filter."
          />
        ) : (
          filteredInvitations.map((inv, invIdx) => {
            const isPending = inv.status === 'pending';
            const isAccepted = inv.status === 'accepted';
            const isRevoked = inv.status === 'revoked';
            const isExpired = inv.status === 'expired' || (isPending && new Date(inv.expires_at).getTime() < Date.now());
            const emailDelivered = inv.email_delivery_status === 'sent';
            const emailFailed = inv.email_delivery_status === 'failed';

            return (
              <View key={`invite-${inv.id || invIdx}`} style={styles.inviteCard}>
                <View style={styles.inviteCardHeader}>
                  <View style={styles.inviteDetails}>
                    <Text style={styles.inviteEmail}>{inv.email}</Text>
                    {inv.name && <Text style={styles.inviteName}>{inv.name}</Text>}
                  </View>
                  <Badge
                    label={isExpired ? 'expired' : inv.status}
                    tone={isAccepted ? 'success' : isExpired || isRevoked ? 'neutral' : 'warning'}
                  />
                </View>

                {/* Role and Warehouses */}
                <View style={styles.memberBadgeRow}>
                  <Badge label={inv.role_label || roleLabel(inv.role)} tone="info" />
                  {emailDelivered && <Badge label="Email Dispatched" tone="success" />}
                  {emailFailed && (
                    <Badge
                      label="Delivery Offline"
                      tone="danger"
                    />
                  )}
                </View>

                {/* Delivery failure clarification if SMTP is not configured */}
                {emailFailed && (
                  <View style={styles.emailWarningBanner}>
                    <MaterialCommunityIcons name="alert-circle" size={16} color={colors.danger} />
                    <Text style={styles.emailWarningText}>
                      SMTP server not configured or host unreachable. Share the invite code or QR code directly with the recipient.
                    </Text>
                  </View>
                )}

                {/* Code & Expiry */}
                {inv.invite_code && (
                  <View style={styles.codeSnippetRow}>
                    <View style={styles.codeBox}>
                      <Text style={styles.codeLabel}>INVITE CODE</Text>
                      <Text style={styles.codeValue}>{inv.invite_code}</Text>
                    </View>
                    <Pressable
                      style={styles.iconBtn}
                      onPress={() => copyToClipboard(inv.invite_code!, `code-${inv.id}`)}
                    >
                      <MaterialCommunityIcons
                        name={copiedKey === `code-${inv.id}` ? 'check' : 'content-copy'}
                        size={20}
                        color={copiedKey === `code-${inv.id}` ? colors.success : colors.primary}
                      />
                    </Pressable>
                    <Pressable
                      style={styles.iconBtn}
                      onPress={() => {
                        setActiveInvitation(inv);
                        setQrModalOpen(true);
                      }}
                    >
                      <MaterialCommunityIcons name="qrcode" size={20} color={colors.navy} />
                    </Pressable>
                    <Pressable
                      style={styles.iconBtn}
                      onPress={() => shareInvitation(inv)}
                    >
                      <MaterialCommunityIcons name="share-variant" size={20} color={colors.primary} />
                    </Pressable>
                  </View>
                )}

                <Text style={styles.expiryText}>Expires: {formatDate(inv.expires_at)}</Text>

                {/* Invitation Action Controls */}
                {canManageInvitations && (
                  <View style={styles.memberActionRow}>
                    {isPending && !isExpired && (
                      <Pressable
                        style={styles.miniActionBtn}
                        onPress={() => handleResendInvitation(inv.id)}
                      >
                        <MaterialCommunityIcons name="email-sync-outline" size={16} color={colors.primary} />
                        <Text style={styles.miniActionText}>Resend</Text>
                      </Pressable>
                    )}

                    {(isExpired || isRevoked) && (
                      <Pressable
                        style={styles.miniActionBtn}
                        onPress={() => handleReplaceInvitation(inv.id)}
                      >
                        <MaterialCommunityIcons name="refresh" size={16} color={colors.primary} />
                        <Text style={styles.miniActionText}>Replace</Text>
                      </Pressable>
                    )}

                    {isPending && (
                      <Pressable
                        style={styles.miniActionBtn}
                        onPress={() => handleRevokeInvitation(inv.id)}
                      >
                        <MaterialCommunityIcons name="close-circle-outline" size={16} color={colors.danger} />
                        <Text style={[styles.miniActionText, { color: colors.danger }]}>Revoke</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            );
          })
        )}
      </View>
    );
  };

  const renderRolesTab = () => {
    return (
      <View style={styles.tabContent}>
        <View style={styles.rolesIntroBanner}>
          <Text style={styles.rolesIntroTitle}>Commercial Role & Permission Directory</Text>
          <Text style={styles.rolesIntroDesc}>
            NTAN uses strict warehouse-scoped permissions. Built-in roles provide standardized industry workflows, while custom roles allow company-specific shifts and duty allocations.
          </Text>
        </View>

        {roles.map((r) => (
          <View key={r.id} style={styles.roleCard}>
            <View style={styles.roleHeaderRow}>
              <View style={styles.roleNameCol}>
                <Text style={styles.roleName}>{r.name}</Text>
                <Text style={styles.roleSlug}>{r.slug}</Text>
              </View>
              <Badge
                label={r.is_custom ? 'Custom Role' : 'System Template'}
                tone={r.is_custom ? 'info' : 'neutral'}
              />
            </View>
            <Text style={styles.roleDesc}>{r.description || roleDetail(r.slug)}</Text>

            <View style={styles.roleFooterRow}>
              <Text style={styles.assignedCountText}>
                Assigned: {r.assigned_count ?? r.assigned_members_count ?? 0} member(s)
              </Text>
              {r.is_custom && canManageRoles && (
                <Pressable
                  style={styles.deleteRoleBtn}
                  onPress={() => handleDeleteCustomRole(r)}
                >
                  <MaterialCommunityIcons name="trash-can-outline" size={16} color={colors.danger} />
                  <Text style={styles.deleteRoleText}>Delete Role</Text>
                </Pressable>
              )}
            </View>
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top + 12, 22) }]}>
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
          <Text style={styles.greetingTitle}>Team & Access</Text>
          <Text style={styles.greetingSubtitle} numberOfLines={1}>
            {session?.company.name} • Multi-Warehouse Directory
          </Text>
        </View>
      </View>

      {/* Primary Navigation Tabs */}
      <View style={styles.tabBar}>
        <Pressable
          style={[styles.tabItem, activeTab === 'overview' && styles.tabItemActive]}
          onPress={() => setActiveTab('overview')}
        >
          <MaterialCommunityIcons
            name="view-dashboard-outline"
            size={18}
            color={activeTab === 'overview' ? colors.primary : colors.muted}
          />
          <Text style={[styles.tabLabel, activeTab === 'overview' && styles.tabLabelActive]}>
            Overview
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tabItem, activeTab === 'members' && styles.tabItemActive]}
          onPress={() => setActiveTab('members')}
        >
          <MaterialCommunityIcons
            name="account-multiple"
            size={18}
            color={activeTab === 'members' ? colors.primary : colors.muted}
          />
          <Text style={[styles.tabLabel, activeTab === 'members' && styles.tabLabelActive]}>
            Members ({members.length})
          </Text>
        </Pressable>
        {canReadInvitations && (
          <Pressable
            style={[styles.tabItem, activeTab === 'invitations' && styles.tabItemActive]}
            onPress={() => setActiveTab('invitations')}
          >
            <MaterialCommunityIcons
              name="email-outline"
              size={18}
              color={activeTab === 'invitations' ? colors.primary : colors.muted}
            />
            <Text style={[styles.tabLabel, activeTab === 'invitations' && styles.tabLabelActive]}>
              Invites ({pendingInvitesCount})
            </Text>
          </Pressable>
        )}
        <Pressable
          style={[styles.tabItem, activeTab === 'roles' && styles.tabItemActive]}
          onPress={() => setActiveTab('roles')}
        >
          <MaterialCommunityIcons
            name="shield-account-outline"
            size={18}
            color={activeTab === 'roles' ? colors.primary : colors.muted}
          />
          <Text style={[styles.tabLabel, activeTab === 'roles' && styles.tabLabelActive]}>
            Roles ({roles.length})
          </Text>
        </Pressable>
      </View>

      {/* Global Error Banner */}
      {actionError && (
        <View style={styles.errorBanner}>
          <MaterialCommunityIcons name="alert-circle" size={20} color={colors.danger} />
          <Text style={styles.errorBannerText}>{actionError}</Text>
          <Pressable onPress={() => setActionError(null)}>
            <MaterialCommunityIcons name="close" size={18} color={colors.danger} />
          </Pressable>
        </View>
      )}

      {/* Tab Body */}
      <ScrollView
        contentContainerStyle={styles.scrollBody}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refreshData} colors={[colors.primary]} />
        }
      >
        {loading && !refreshing ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Syncing organization access controls...</Text>
          </View>
        ) : error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorBoxTitle}>Could not load Team & Access</Text>
            <Text style={styles.errorBoxText}>{error}</Text>
            <Button label="Retry" variant="primary" onPress={loadData} style={{ marginTop: spacing.md }} />
          </View>
        ) : (
          <>
            {activeTab === 'overview' && renderOverviewTab()}
            {activeTab === 'members' && renderMembersTab()}
            {activeTab === 'invitations' && renderInvitationsTab()}
            {activeTab === 'roles' && renderRolesTab()}
          </>
        )}
      </ScrollView>

      {/* =========================================================================
          MODAL 1: INDIVIDUAL INVITATION
      ========================================================================== */}
      <Modal visible={inviteModalOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Invite Team Member</Text>
              <Pressable onPress={() => setInviteModalOpen(false)}>
                <MaterialCommunityIcons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>

            {inviteFormError && (
              <View style={styles.modalErrorBox}>
                <Text style={styles.modalErrorText}>{inviteFormError}</Text>
              </View>
            )}

            <ScrollView style={styles.modalScroll}>
              <Field
                label="Full Name"
                value={inviteName}
                onChangeText={setInviteName}
                placeholder="e.g. John Doe"
              />

              <Field
                label="Work Email *"
                value={inviteEmail}
                onChangeText={setInviteEmail}
                placeholder="e.g. j.doe@company.com"
                keyboardType="email-address"
                autoCapitalize="none"
              />

              <PhoneField
                label="Phone Number (Optional)"
                value={invitePhone}
                onChangeText={setInvitePhone}
                placeholder="98765 43210"
              />

              <Field
                label="Employee ID / Badge (Optional)"
                value={inviteEmployeeId}
                onChangeText={setInviteEmployeeId}
                placeholder="e.g. EMP-1049"
              />

              <View style={styles.rowTwoCol}>
                <View style={{ flex: 1, marginRight: spacing.sm }}>
                  <Field
                    label="Department (Optional)"
                    value={inviteDepartment}
                    onChangeText={setInviteDepartment}
                    placeholder="e.g. Logistics"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Job Title (Optional)"
                    value={inviteJobTitle}
                    onChangeText={setInviteJobTitle}
                    placeholder="e.g. Shift Lead"
                  />
                </View>
              </View>

              {/* Role Selection */}
              <Text style={styles.groupLabel}>Select Role *</Text>
              <View style={styles.rolePickerList}>
                {roleOptions.map((opt) => (
                  <Pressable
                    key={opt.value}
                    style={[styles.roleOptionCard, inviteRole === opt.value && styles.roleOptionCardSelected]}
                    onPress={() => setInviteRole(opt.value)}
                  >
                    <View style={styles.roleOptionTop}>
                      <Text style={[styles.roleOptionTitle, inviteRole === opt.value && styles.roleOptionTitleSelected]}>
                        {opt.label}
                      </Text>
                      <MaterialCommunityIcons
                        name={inviteRole === opt.value ? 'radiobox-marked' : 'radiobox-blank'}
                        size={20}
                        color={inviteRole === opt.value ? colors.primary : colors.muted}
                      />
                    </View>
                    <Text style={styles.roleOptionDetail}>{opt.detail}</Text>
                  </Pressable>
                ))}
              </View>

              {/* Multi-Warehouse Assignment */}
              <Text style={styles.groupLabel}>Warehouse Scoping</Text>
              <Text style={styles.groupHint}>
                Select the facility locations this employee is authorized to access. Leave empty to allow all company facilities.
              </Text>
              <View style={styles.whPickerList}>
                {activeWarehouses.map((wh) => {
                  const isChecked = inviteWarehouseIds.includes(wh.id);
                  return (
                    <Pressable
                      key={wh.id}
                      style={[styles.whCheckboxRow, isChecked && styles.whCheckboxRowActive]}
                      onPress={() => {
                        setInviteWarehouseIds((curr) =>
                          isChecked ? curr.filter((id) => id !== wh.id) : [...curr, wh.id],
                        );
                      }}
                    >
                      <MaterialCommunityIcons
                        name={isChecked ? 'checkbox-marked' : 'checkbox-blank-outline'}
                        size={22}
                        color={isChecked ? colors.primary : colors.muted}
                      />
                      <View style={styles.whCheckboxDetails}>
                        <Text style={styles.whCheckboxName}>{wh.name}</Text>
                        <Text style={styles.whCheckboxAddress}>{wh.address || 'Standard Warehouse'}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              {/* Optional Temporary Access */}
              <Field
                label="Temporary Access Expiration (Optional)"
                value={inviteValidUntil}
                onChangeText={setInviteValidUntil}
                placeholder="YYYY-MM-DD (e.g. 2026-12-31)"
              />
            </ScrollView>

            <View style={styles.modalFooter}>
              <Button
                label="Cancel"
                variant="ghost"
                onPress={() => setInviteModalOpen(false)}
                style={{ flex: 1, marginRight: spacing.sm }}
              />
              <Button
                label="Send Invitation"
                variant="primary"
                loading={submittingInvite}
                onPress={handleSubmitInvite}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* =========================================================================
          MODAL 2: BULK EXCEL IMPORT WIZARD
      ========================================================================== */}
      <Modal visible={bulkImportModalOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCardLarge}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Excel Bulk Employee Import</Text>
                <Text style={styles.modalSubtitle}>Stage {importStep} of 4</Text>
              </View>
              <Pressable onPress={() => setBulkImportModalOpen(false)}>
                <MaterialCommunityIcons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>

            {importError && (
              <View style={styles.modalErrorBox}>
                <Text style={styles.modalErrorText}>{importError}</Text>
              </View>
            )}

            {/* STAGE 1: Upload File */}
            {importStep === 1 && (
              <View style={styles.wizardStepContainer}>
                <View style={styles.wizardIntroBox}>
                  <MaterialCommunityIcons name="file-excel-box" size={48} color={colors.success} />
                  <Text style={styles.wizardTitle}>Bulk Import Multiple Employees</Text>
                  <Text style={styles.wizardDesc}>
                    Import team rosters in seconds using an NTAN-compliant .xlsx or .csv workbook. Multi-warehouse codes and temporary access dates are automatically parsed and verified.
                  </Text>
                </View>

                <View style={styles.wizardFileActions}>
                  <Button
                    label="Download Template Workbook (.xlsx)"
                    variant="secondary"
                    onPress={handleDownloadTemplate}
                    style={{ marginBottom: spacing.md }}
                  />
                  <Button
                    label="Select Excel / CSV File"
                    variant="primary"
                    loading={importing}
                    onPress={handlePickFile}
                    style={{ marginBottom: spacing.md }}
                  />
                  <Text style={styles.fileSupportNote}>
                    Supports .xlsx and .csv files up to 500 rows. Formula injection neutralization is automatically applied.
                  </Text>
                </View>
              </View>
            )}

            {/* STAGE 2: Validation & Preview */}
            {importStep === 2 && importPreview && (() => {
              const validCount = importPreview.valid_rows ?? importPreview.valid_count ?? 0;
              const invalidCount = importPreview.invalid_rows ?? importPreview.invalid_count ?? 0;
              const duplicateCount =
                (importPreview.duplicate_rows ?? importPreview.duplicate_count ?? 0) +
                (importPreview.existing_members ?? importPreview.existing_member_count ?? 0);
              return (
                <ScrollView style={styles.modalScroll}>
                  <View style={styles.previewStatsGrid}>
                    <View style={styles.previewStatBox}>
                      <Text style={styles.previewStatNum}>{importPreview.total_rows}</Text>
                      <Text style={styles.previewStatLabel}>Total Rows</Text>
                    </View>
                    <View style={[styles.previewStatBox, { borderColor: colors.success }]}>
                      <Text style={[styles.previewStatNum, { color: colors.success }]}>
                        {validCount}
                      </Text>
                      <Text style={styles.previewStatLabel}>Valid & Ready</Text>
                    </View>
                    <View style={[styles.previewStatBox, { borderColor: colors.danger }]}>
                      <Text style={[styles.previewStatNum, { color: colors.danger }]}>
                        {invalidCount}
                      </Text>
                      <Text style={styles.previewStatLabel}>Errors</Text>
                    </View>
                    <View style={[styles.previewStatBox, { borderColor: colors.warning }]}>
                      <Text style={[styles.previewStatNum, { color: colors.warning }]}>
                        {duplicateCount}
                      </Text>
                      <Text style={styles.previewStatLabel}>Duplicates/Members</Text>
                    </View>
                  </View>

                <Text style={styles.groupLabel}>Row-by-Row Inspection</Text>
                {importPreview.rows.map((row, rowIdx) => (
                  <View key={`preview-row-${row.row_number ?? rowIdx}-${row.email}`} style={[styles.previewRowCard, !row.is_valid && styles.previewRowCardError]}>
                    <View style={styles.previewRowHeader}>
                      <Text style={styles.previewRowIdx}>Row #{row.row_number}</Text>
                      <Badge
                        label={row.is_valid ? 'Valid' : 'Invalid'}
                        tone={row.is_valid ? 'success' : 'danger'}
                      />
                    </View>
                    <Text style={styles.previewRowName}>{row.name || 'No Name Provided'}</Text>
                    <Text style={styles.previewRowEmail}>{row.email}</Text>
                    <Text style={styles.previewRowRole}>Role: {row.role_label || row.role}</Text>
                    {row.warehouse_codes.length > 0 && (
                      <Text style={styles.previewRowWhs}>
                        Warehouses: {row.warehouse_codes.join(', ')}
                      </Text>
                    )}

                    {row.errors.map((e, idx) => (
                      <Text key={`err-${row.row_number}-${idx}`} style={styles.previewErrorText}>• {e}</Text>
                    ))}
                    {row.warnings.map((w, idx) => (
                      <Text key={`warn-${row.row_number}-${idx}`} style={styles.previewWarnText}>• {w}</Text>
                    ))}
                  </View>
                ))}
              </ScrollView>
              );
            })()}

            {/* STAGE 4: Final Results */}
            {importStep === 4 && importResult && (
              <ScrollView style={styles.modalScroll}>
                <View style={styles.wizardIntroBox}>
                  <MaterialCommunityIcons name="check-decagram" size={48} color={colors.success} />
                  <Text style={styles.wizardTitle}>Bulk Import Completed!</Text>
                  <Text style={styles.wizardDesc}>
                    {importResult.created_count} invitations generated successfully. {importResult.skipped_count} skipped, {importResult.failed_count} failed.
                  </Text>
                </View>

                <Text style={styles.groupLabel}>Dispatch Summary</Text>
                {importResult.results.map((res, resIdx) => (
                  <View key={`result-row-${res.row_number ?? resIdx}-${res.email}`} style={styles.importResultCard}>
                    <View style={styles.previewRowHeader}>
                      <Text style={styles.previewRowEmail}>{res.email}</Text>
                      <Badge
                        label={res.status}
                        tone={res.status === 'created' ? 'success' : 'neutral'}
                      />
                    </View>
                    {res.invite_code && (
                      <Text style={styles.importCodeText}>Code: {res.invite_code}</Text>
                    )}
                    {res.message && <Text style={styles.importMsgText}>{res.message}</Text>}
                  </View>
                ))}
              </ScrollView>
            )}

            {/* Footer Buttons */}
            <View style={styles.modalFooter}>
              {importStep === 2 && (() => {
                const validCount = importPreview?.valid_rows ?? importPreview?.valid_count ?? 0;
                return (
                  <>
                    <Button
                      label="Cancel"
                      variant="ghost"
                      onPress={() => setBulkImportModalOpen(false)}
                      style={{ flex: 1, marginRight: spacing.sm }}
                    />
                    <Button
                      label={`Confirm & Send (${validCount})`}
                      variant="primary"
                      disabled={validCount === 0}
                      loading={importing}
                      onPress={handleConfirmBulkImport}
                      style={{ flex: 1 }}
                    />
                  </>
                );
              })()}
              {importStep === 4 && (
                <Button
                  label="Done"
                  variant="primary"
                  onPress={() => setBulkImportModalOpen(false)}
                  style={{ flex: 1 }}
                />
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* =========================================================================
          MODAL 3: QR CODE & SECURE LINK VIEW
      ========================================================================== */}
      <Modal visible={qrModalOpen} animationType="fade" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.qrModalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Scan to Join Organization</Text>
              <Pressable onPress={() => setQrModalOpen(false)}>
                <MaterialCommunityIcons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>

            {activeInvitation && (
              <View style={styles.qrContainer}>
                <View style={styles.qrWrapper}>
                  <QRCode
                    value={`NTAN-JOIN:${activeInvitation.invite_code}`}
                    size={200}
                    color={colors.navy}
                    backgroundColor={colors.white}
                  />
                </View>

                <Text style={styles.qrEmailText}>{activeInvitation.email}</Text>
                <Text style={styles.qrRoleBadge}>{activeInvitation.role_label || roleLabel(activeInvitation.role)}</Text>

                <View style={styles.qrCodeBox}>
                  <Text style={styles.qrCodeLabel}>SECURE INVITATION CODE</Text>
                  <Text style={styles.qrCodeText}>{activeInvitation.invite_code}</Text>
                </View>

                <View style={styles.qrActionsRow}>
                  <Button
                    label={copiedKey === 'qr-code' ? 'Code Copied!' : 'Copy Code'}
                    variant="secondary"
                    onPress={() => copyToClipboard(activeInvitation.invite_code ?? '', 'qr-code')}
                    style={{ flex: 1, marginRight: spacing.sm }}
                  />
                  <Button
                    label="Share Link"
                    variant="primary"
                    onPress={() => shareInvitation(activeInvitation)}
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* =========================================================================
          MODAL 4: EDIT MEMBER ASSIGNMENTS
      ========================================================================== */}
      <Modal visible={editMemberModalOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Member Assignments</Text>
              <Pressable onPress={() => setEditMemberModalOpen(false)}>
                <MaterialCommunityIcons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>

            {editMemberError && (
              <View style={styles.modalErrorBox}>
                <Text style={styles.modalErrorText}>{editMemberError}</Text>
              </View>
            )}

            {activeMember && (
              <ScrollView style={styles.modalScroll}>
                <Text style={styles.editMemberName}>{activeMember.name}</Text>
                <Text style={styles.editMemberEmail}>{activeMember.email}</Text>

                <Text style={styles.groupLabel}>Assigned Role</Text>
                <View style={styles.rolePickerList}>
                  {roleOptions.map((opt) => (
                    <Pressable
                      key={opt.value}
                      style={[styles.roleOptionCard, editRole === opt.value && styles.roleOptionCardSelected]}
                      onPress={() => setEditRole(opt.value)}
                    >
                      <View style={styles.roleOptionTop}>
                        <Text style={[styles.roleOptionTitle, editRole === opt.value && styles.roleOptionTitleSelected]}>
                          {opt.label}
                        </Text>
                        <MaterialCommunityIcons
                          name={editRole === opt.value ? 'radiobox-marked' : 'radiobox-blank'}
                          size={18}
                          color={editRole === opt.value ? colors.primary : colors.muted}
                        />
                      </View>
                      <Text style={styles.roleOptionDetail}>{opt.detail}</Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.groupLabel}>Warehouse Scoping</Text>
                <View style={styles.whPickerList}>
                  {activeWarehouses.map((wh) => {
                    const isChecked = editWarehouseIds.includes(wh.id);
                    return (
                      <Pressable
                        key={wh.id}
                        style={[styles.whCheckboxRow, isChecked && styles.whCheckboxRowActive]}
                        onPress={() => {
                          setEditWarehouseIds((curr) =>
                            isChecked ? curr.filter((id) => id !== wh.id) : [...curr, wh.id],
                          );
                        }}
                      >
                        <MaterialCommunityIcons
                          name={isChecked ? 'checkbox-marked' : 'checkbox-blank-outline'}
                          size={22}
                          color={isChecked ? colors.primary : colors.muted}
                        />
                        <View style={styles.whCheckboxDetails}>
                          <Text style={styles.whCheckboxName}>{wh.name}</Text>
                          <Text style={styles.whCheckboxAddress}>{wh.address || 'Facility'}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>

                <Field
                  label="Temporary Access Expiration (Optional)"
                  value={editValidUntil}
                  onChangeText={setEditValidUntil}
                  placeholder="YYYY-MM-DD"
                />
              </ScrollView>
            )}

            <View style={styles.modalFooter}>
              <Button
                label="Cancel"
                variant="ghost"
                onPress={() => setEditMemberModalOpen(false)}
                style={{ flex: 1, marginRight: spacing.sm }}
              />
              <Button
                label="Save Assignments"
                variant="primary"
                loading={savingMemberEdit}
                onPress={handleSaveMemberEdit}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* =========================================================================
          MODAL 5: CUSTOM ROLE BUILDER
      ========================================================================== */}
      <Modal visible={customRoleModalOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCardLarge}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Custom Company Role</Text>
              <Pressable onPress={() => setCustomRoleModalOpen(false)}>
                <MaterialCommunityIcons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>

            {customRoleError && (
              <View style={styles.modalErrorBox}>
                <Text style={styles.modalErrorText}>{customRoleError}</Text>
              </View>
            )}

            <ScrollView style={styles.modalScroll}>
              <Field
                label="Role Name *"
                value={customRoleName}
                onChangeText={setCustomRoleName}
                placeholder="e.g. Night Shift Supervisor"
              />

              <Field
                label="Custom Slug / Code (Optional)"
                value={customRoleSlug}
                onChangeText={setCustomRoleSlug}
                placeholder="e.g. night_shift_supervisor"
                autoCapitalize="none"
              />

              <Field
                label="Description"
                value={customRoleDesc}
                onChangeText={setCustomRoleDesc}
                placeholder="Summarize this role's duties and boundaries"
              />

              <Text style={styles.groupLabel}>Permission Catalog</Text>
              <Text style={styles.groupHint}>
                Select the exact operations members with this role are authorized to execute.
              </Text>

              {permissionCategories.map((cat) => (
                <View key={cat.category} style={styles.permCategoryBox}>
                  <Text style={styles.permCatTitle}>{cat.category}</Text>
                  <Text style={styles.permCatDesc}>{cat.description}</Text>

                  {cat.permissions.map((p) => {
                    const isChecked = customRolePerms.includes(p.key);
                    return (
                      <Pressable
                        key={p.key}
                        style={[styles.permRow, isChecked && styles.permRowChecked]}
                        onPress={() => toggleCustomRolePerm(p.key)}
                      >
                        <MaterialCommunityIcons
                          name={isChecked ? 'checkbox-marked' : 'checkbox-blank-outline'}
                          size={20}
                          color={isChecked ? colors.primary : colors.muted}
                        />
                        <View style={styles.permTextCol}>
                          <Text style={styles.permLabel}>{p.label}</Text>
                          <Text style={styles.permDesc}>{p.description}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>

            <View style={styles.modalFooter}>
              <Button
                label="Cancel"
                variant="ghost"
                onPress={() => setCustomRoleModalOpen(false)}
                style={{ flex: 1, marginRight: spacing.sm }}
              />
              <Button
                label="Save Custom Role"
                variant="primary"
                loading={savingCustomRole}
                onPress={handleSaveCustomRole}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* =========================================================================
          MODAL 6: SUSPEND MEMBER
      ========================================================================== */}
      <Modal visible={suspendModalOpen} animationType="fade" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Suspend Team Member</Text>
              <Pressable onPress={() => setSuspendModalOpen(false)}>
                <MaterialCommunityIcons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>

            <View style={styles.modalBodyPadding}>
              <Text style={styles.suspendWarningText}>
                Are you sure you want to suspend {activeMember?.name}? Their active sessions will be terminated immediately, and all warehouse inventory actions will be blocked on the server.
              </Text>

              <Field
                label="Suspension Reason (Optional)"
                value={suspendReason}
                onChangeText={setSuspendReason}
                placeholder="e.g. Extended leave, internal audit review"
              />

              <View style={styles.modalFooter}>
                <Button
                  label="Cancel"
                  variant="ghost"
                  onPress={() => setSuspendModalOpen(false)}
                  style={{ flex: 1, marginRight: spacing.sm }}
                />
                <Button
                  label="Confirm Suspension"
                  variant="danger"
                  onPress={handleConfirmSuspend}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
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
  pressed: {
    opacity: 0.8,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#FCFDFE',
    borderBottomWidth: 1.5,
    borderBottomColor: 'rgba(25,35,56,0.08)',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: colors.primary,
  },
  tabLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.muted,
  },
  tabLabelActive: {
    color: colors.primary,
  },
  scrollBody: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2,
  },
  loadingContainer: {
    padding: spacing.xxl,
    alignItems: 'center',
  },
  loadingText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    marginTop: spacing.md,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dangerSoft,
    padding: spacing.md,
    gap: spacing.sm,
  },
  errorBannerText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.danger,
  },
  errorBox: {
    backgroundColor: colors.white,
    padding: spacing.xl,
    borderRadius: radius.md,
    alignItems: 'center',
    ...shadow,
  },
  errorBoxTitle: {
    fontFamily: fonts.heading,
    fontSize: 16,
    color: colors.danger,
    marginBottom: spacing.xs,
  },
  errorBoxText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
  },
  tabContent: {
    gap: spacing.md,
  },

  // Overview Tab
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  kpiCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: colors.white,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow,
  },
  kpiCardBlue: { borderLeftWidth: 4, borderLeftColor: colors.primary },
  kpiCardYellow: { borderLeftWidth: 4, borderLeftColor: colors.warning },
  kpiCardRed: { borderLeftWidth: 4, borderLeftColor: colors.danger },
  kpiCardNavy: { borderLeftWidth: 4, borderLeftColor: colors.navy },
  kpiCardMuted: { borderLeftWidth: 4, borderLeftColor: colors.muted },
  kpiNumber: {
    fontFamily: fonts.heading,
    fontSize: 26,
    color: colors.text,
    marginTop: spacing.sm,
  },
  kpiTitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  sectionHeading: {
    fontFamily: fonts.heading,
    fontSize: 16,
    color: colors.text,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  actionBtn: {
    flex: 1,
    minWidth: 140,
  },
  activityFeed: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  activityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginTop: 6,
  },
  activityBody: {
    flex: 1,
  },
  activityTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  activityActor: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.text,
  },
  activityTarget: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  activityTime: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },

  // Members KPI Cards
  membersStatsGrid: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  membersStatCard: {
    flex: 1,
    backgroundColor: colors.white,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow,
  },
  membersStatCardActive: {
    borderLeftWidth: 4,
    borderLeftColor: colors.success,
  },
  membersStatCardTotal: {
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  membersStatTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  membersStatLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 0.5,
  },
  membersStatNumber: {
    fontFamily: fonts.heading,
    fontSize: 26,
    color: colors.text,
    marginTop: spacing.xs,
  },

  // Filtering
  filterBar: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.text,
  },
  chipRow: {
    flexDirection: 'row',
    marginVertical: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.sm,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.muted,
  },
  chipTextActive: {
    color: colors.white,
  },

  // Member Card
  memberCard: {
    backgroundColor: colors.white,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
    ...shadow,
  },
  memberCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EAF1FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontFamily: fonts.heading,
    fontSize: 16,
    color: colors.primary,
  },
  memberDetails: {
    flex: 1,
  },
  memberNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  memberName: {
    fontFamily: fonts.heading,
    fontSize: 15,
    color: colors.text,
  },
  memberEmpId: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.muted,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  memberEmail: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
  memberPhone: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  memberBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  memberJobTitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
    fontStyle: 'italic',
  },
  warehouseScopeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: '#F8FAFC',
    padding: spacing.sm,
    borderRadius: radius.sm,
  },
  warehouseScopeText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.text,
  },
  tempAccessBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.warningSoft,
    padding: spacing.xs + 2,
    borderRadius: radius.sm,
  },
  tempAccessExpired: {
    backgroundColor: colors.dangerSoft,
  },
  tempAccessText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.warning,
  },
  tempAccessTextExpired: {
    color: colors.danger,
  },
  memberActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: spacing.sm,
  },
  miniActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: spacing.xs,
  },
  miniActionText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.primary,
  },

  // Invitations Card
  inviteCard: {
    backgroundColor: colors.white,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
    ...shadow,
  },
  inviteCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  inviteDetails: {
    flex: 1,
  },
  inviteEmail: {
    fontFamily: fonts.heading,
    fontSize: 14,
    color: colors.text,
  },
  inviteName: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  emailWarningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.dangerSoft,
    padding: spacing.sm,
    borderRadius: radius.sm,
  },
  emailWarningText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.danger,
  },
  codeSnippetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#F8FAFC',
    padding: spacing.sm,
    borderRadius: radius.sm,
  },
  codeBox: {
    flex: 1,
  },
  codeLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    color: colors.muted,
    letterSpacing: 0.5,
  },
  codeValue: {
    fontFamily: fonts.heading,
    fontSize: 14,
    color: colors.navy,
    letterSpacing: 1,
  },
  iconBtn: {
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  expiryText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },

  // Roles Tab
  rolesIntroBanner: {
    backgroundColor: '#EFF6FF',
    padding: spacing.md,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    gap: 4,
  },
  rolesIntroTitle: {
    fontFamily: fonts.heading,
    fontSize: 14,
    color: colors.navy,
  },
  rolesIntroDesc: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
    lineHeight: 18,
  },
  roleCard: {
    backgroundColor: colors.white,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
    ...shadow,
  },
  roleHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  roleNameCol: {
    flex: 1,
  },
  roleName: {
    fontFamily: fonts.heading,
    fontSize: 15,
    color: colors.text,
  },
  roleSlug: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  roleDesc: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
    lineHeight: 16,
  },
  roleFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: spacing.xs,
  },
  assignedCountText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.muted,
  },
  deleteRoleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  deleteRoleText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.danger,
  },

  // Modals
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    maxHeight: '90%',
    ...shadow,
  },
  modalCardLarge: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    maxHeight: '94%',
    ...shadow,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontFamily: fonts.heading,
    fontSize: 17,
    color: colors.text,
  },
  modalSubtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  modalScroll: {
    padding: spacing.lg,
  },
  modalBodyPadding: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  modalFooter: {
    flexDirection: 'row',
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  modalErrorBox: {
    backgroundColor: colors.dangerSoft,
    padding: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    borderRadius: radius.sm,
  },
  modalErrorText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.danger,
  },
  fieldInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.text,
  },
  rowTwoCol: {
    flexDirection: 'row',
  },
  groupLabel: {
    fontFamily: fonts.heading,
    fontSize: 13,
    color: colors.navy,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  groupHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    marginBottom: spacing.sm,
  },
  rolePickerList: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  roleOptionCard: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
  },
  roleOptionCardSelected: {
    borderColor: colors.primary,
    backgroundColor: '#EAF1FF',
  },
  roleOptionTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  roleOptionTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.text,
  },
  roleOptionTitleSelected: {
    color: colors.primary,
  },
  roleOptionDetail: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  whPickerList: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  whCheckboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  whCheckboxRowActive: {
    borderColor: colors.primary,
    backgroundColor: '#F0FDF4',
  },
  whCheckboxDetails: {
    flex: 1,
  },
  whCheckboxName: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.text,
  },
  whCheckboxAddress: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },

  // QR Modal
  qrModalCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    paddingBottom: spacing.lg,
    ...shadow,
  },
  qrContainer: {
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  qrWrapper: {
    padding: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  qrEmailText: {
    fontFamily: fonts.heading,
    fontSize: 15,
    color: colors.text,
    marginTop: spacing.sm,
  },
  qrRoleBadge: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.primary,
  },
  qrCodeBox: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginVertical: spacing.sm,
  },
  qrCodeLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    color: colors.muted,
  },
  qrCodeText: {
    fontFamily: fonts.heading,
    fontSize: 18,
    color: colors.navy,
    letterSpacing: 2,
  },
  qrActionsRow: {
    flexDirection: 'row',
    width: '100%',
    marginTop: spacing.sm,
  },

  // Bulk Wizard
  wizardStepContainer: {
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.lg,
  },
  wizardIntroBox: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  wizardTitle: {
    fontFamily: fonts.heading,
    fontSize: 17,
    color: colors.text,
    textAlign: 'center',
  },
  wizardDesc: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 18,
  },
  wizardFileActions: {
    width: '100%',
    alignItems: 'center',
  },
  fileSupportNote: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    textAlign: 'center',
  },
  previewStatsGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  previewStatBox: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  previewStatNum: {
    fontFamily: fonts.heading,
    fontSize: 18,
    color: colors.text,
  },
  previewStatLabel: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
    textAlign: 'center',
  },
  previewRowCard: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    gap: 2,
  },
  previewRowCardError: {
    borderColor: colors.danger,
    backgroundColor: '#FEF2F2',
  },
  previewRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  previewRowIdx: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.muted,
  },
  previewRowName: {
    fontFamily: fonts.heading,
    fontSize: 13,
    color: colors.text,
  },
  previewRowEmail: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  previewRowRole: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.primary,
  },
  previewRowWhs: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  previewErrorText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.danger,
  },
  previewWarnText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.warning,
  },
  importResultCard: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  importCodeText: {
    fontFamily: fonts.heading,
    fontSize: 13,
    color: colors.navy,
  },
  importMsgText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },

  // Edit Member Modal
  editMemberName: {
    fontFamily: fonts.heading,
    fontSize: 16,
    color: colors.text,
  },
  editMemberEmail: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
    marginBottom: spacing.sm,
  },

  // Custom Role Builder
  permCategoryBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  permCatTitle: {
    fontFamily: fonts.heading,
    fontSize: 14,
    color: colors.navy,
  },
  permCatDesc: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    marginBottom: spacing.xs,
  },
  permRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  permRowChecked: {
    backgroundColor: '#F0F9FF',
  },
  permTextCol: {
    flex: 1,
  },
  permLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.text,
  },
  permDesc: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },

  // Suspend Warning
  suspendWarningText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
  },
});
