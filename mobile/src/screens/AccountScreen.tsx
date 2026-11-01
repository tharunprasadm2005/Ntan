import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { checkPasswordStrength, PasswordStrength } from '../components/PasswordStrength';
import { useWorkspace } from '../data';
import { humanize, roleLabel } from '../format';
import { colors, fonts, radius, shadow, spacing } from '../theme';

interface AccountScreenProps {
  onBack?: () => void;
  onOpenTeam: () => void;
}

// Storage keys for persistent preferences and alerts
const PREF_DATE_FORMAT_KEY = 'ntan.pref.date_format';
const PREF_NUMBER_FORMAT_KEY = 'ntan.pref.number_format';
const PREF_THEME_KEY = 'ntan.pref.theme';
const PREF_LANG_KEY = 'ntan.pref.language';
const ALERT_STOCKOUT_KEY = 'ntan.alert.stockout';
const ALERT_SECURITY_KEY = 'ntan.alert.security';
const ALERT_EMAIL_KEY = 'ntan.alert.email_summary';

type ThemePreference = 'system' | 'light' | 'dark';
type LanguagePreference = 'en' | 'es' | 'fr' | 'ar';
type DateFormatPreference = 'localized' | 'iso' | 'us';
type NumberFormatPreference = 'standard' | 'european' | 'compact';

export function AccountScreen({ onBack, onOpenTeam }: AccountScreenProps) {
  const insets = useSafeAreaInsets();
  const { state, logout, refreshSession } = useAuth();
  const { locations, refreshing, refresh } = useWorkspace();

  // Profile Edit Modal State
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);

  // Change Password Modal State
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Help & Support Modal State
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [activeHelpTab, setActiveHelpTab] = useState<'receiving' | 'roles' | 'security' | 'faq'>('receiving');

  // Preferences & Alerts (Persistent)
  const [stockoutAlerts, setStockoutAlerts] = useState(true);
  const [securityAlerts, setSecurityAlerts] = useState(true);
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [themePref, setThemePref] = useState<ThemePreference>('system');
  const [langPref, setLangPref] = useState<LanguagePreference>('en');
  const [dateFormat, setDateFormat] = useState<DateFormatPreference>('localized');
  const [numberFormat, setNumberFormat] = useState<NumberFormatPreference>('standard');
  const [alertNotice, setAlertNotice] = useState<string | null>(null);
  const [overReceiptSaving, setOverReceiptSaving] = useState(false);

  // Permissions collapse toggle
  const [showAllPermissions, setShowAllPermissions] = useState(false);

  // Load persistent preferences on mount
  useEffect(() => {
    async function loadSettings() {
      try {
        const getVal = async (key: string) => {
          if (Platform.OS === 'web') {
            return (globalThis as unknown as { localStorage?: { getItem: (k: string) => string | null } }).localStorage?.getItem(key) ?? null;
          }
          return SecureStore.getItemAsync(key);
        };

        const [df, nf, th, lg, so, sec, em] = await Promise.all([
          getVal(PREF_DATE_FORMAT_KEY),
          getVal(PREF_NUMBER_FORMAT_KEY),
          getVal(PREF_THEME_KEY),
          getVal(PREF_LANG_KEY),
          getVal(ALERT_STOCKOUT_KEY),
          getVal(ALERT_SECURITY_KEY),
          getVal(ALERT_EMAIL_KEY),
        ]);

        if (df) setDateFormat(df as DateFormatPreference);
        if (nf) setNumberFormat(nf as NumberFormatPreference);
        if (th) setThemePref(th as ThemePreference);
        if (lg) setLangPref(lg as LanguagePreference);
        if (so !== null) setStockoutAlerts(so === 'true');
        if (sec !== null) setSecurityAlerts(sec === 'true');
        if (em !== null) setEmailAlerts(em === 'true');
      } catch {
        // Fallback to defaults
      }
    }
    void loadSettings();
  }, []);

  const saveSetting = async (key: string, value: string) => {
    try {
      if (Platform.OS === 'web') {
        (globalThis as unknown as { localStorage?: { setItem: (k: string, v: string) => void } }).localStorage?.setItem(key, value);
      } else {
        await SecureStore.setItemAsync(key, value);
      }
    } catch {
      // Ignored
    }
  };

  const showEphemeralNotice = (msg: string) => {
    setAlertNotice(msg);
    setTimeout(() => {
      setAlertNotice(null);
    }, 2800);
  };

  // Preference Handlers
  const handleToggleStockout = (val: boolean) => {
    setStockoutAlerts(val);
    void saveSetting(ALERT_STOCKOUT_KEY, String(val));
    showEphemeralNotice(val ? 'Low stock & stockout push alerts enabled' : 'Low stock alerts muted');
  };

  const handleToggleSecurity = (val: boolean) => {
    setSecurityAlerts(val);
    void saveSetting(ALERT_SECURITY_KEY, String(val));
    showEphemeralNotice(val ? 'Security alert notifications enabled' : 'Security alerts muted');
  };

  const handleToggleEmail = (val: boolean) => {
    setEmailAlerts(val);
    void saveSetting(ALERT_EMAIL_KEY, String(val));
    showEphemeralNotice(val ? 'Weekly operations email summaries enabled' : 'Email summaries disabled');
  };

  const cycleDateFormat = () => {
    const next: DateFormatPreference =
      dateFormat === 'localized' ? 'iso' : dateFormat === 'iso' ? 'us' : 'localized';
    setDateFormat(next);
    void saveSetting(PREF_DATE_FORMAT_KEY, next);
    showEphemeralNotice(`Date format updated to: ${next === 'iso' ? 'YYYY-MM-DD' : next === 'us' ? 'MM/DD/YYYY' : 'DD/MM/YYYY'}`);
  };

  const cycleNumberFormat = () => {
    const next: NumberFormatPreference =
      numberFormat === 'standard' ? 'european' : numberFormat === 'european' ? 'compact' : 'standard';
    setNumberFormat(next);
    void saveSetting(PREF_NUMBER_FORMAT_KEY, next);
    showEphemeralNotice(`Number format updated to: ${next === 'european' ? '1.234,56' : next === 'compact' ? '1.2K / 1.2M' : '1,234.56'}`);
  };

  const cycleTheme = () => {
    const next: ThemePreference =
      themePref === 'system' ? 'light' : themePref === 'light' ? 'dark' : 'system';
    setThemePref(next);
    void saveSetting(PREF_THEME_KEY, next);
    showEphemeralNotice(`Theme set to: ${humanize(next)}`);
  };

  const cycleLanguage = () => {
    const next: LanguagePreference =
      langPref === 'en' ? 'es' : langPref === 'es' ? 'fr' : langPref === 'fr' ? 'ar' : 'en';
    setLangPref(next);
    void saveSetting(PREF_LANG_KEY, next);
    const names = { en: 'English (US)', es: 'Español', fr: 'Français', ar: 'العربية' };
    showEphemeralNotice(`Preferred language: ${names[next]}`);
  };

  useEffect(() => {
    if (state.status === 'signedIn') {
      void refreshSession().catch(() => undefined);
    }
  }, [refreshSession, state.status]);

  if (state.status !== 'signedIn') {
    return null;
  }

  const { session } = state;
  const canViewTeam = session.permissions.includes('members.read');
  const canManageCompany = session.permissions.includes('company.manage');
  const allowOverReceipt = Boolean(session.company.allow_over_receipt);

  const toggleOverReceipt = async (next: boolean) => {
    setOverReceiptSaving(true);
    try {
      await api.updateCompany({ allow_over_receipt: next });
      await refreshSession();
      setAlertNotice(
        next
          ? 'Purchase orders can now be over-received. Receiving more than ordered requires this explicit company policy.'
          : 'Over-receipt is disabled. Receipts and commits above the ordered quantity will be rejected.',
      );
    } catch (caught) {
      setAlertNotice(
        caught instanceof ApiError
          ? caught.message
          : 'The receiving policy could not be updated.',
      );
    } finally {
      setOverReceiptSaving(false);
    }
  };
  const initials = session.user.name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  // Scoped warehouse / location access display
  const scopedLocationCodes = session.membership.location_ids
    .map((locationId) => locations.find((location) => location.id === locationId)?.code)
    .filter((code): code is string => Boolean(code));
  const locationSummary =
    session.membership.location_ids.length === 0
      ? 'All company warehouses & facility locations'
      : scopedLocationCodes.join(', ') ||
        `${session.membership.location_ids.length} assigned location(s)`;

  const confirmLogout = () => {
    if (Platform.OS === 'web') {
      void logout();
      return;
    }
    Alert.alert('Sign out?', 'Your local session will be securely cleared from this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void logout() },
    ]);
  };

  const openProfileModal = () => {
    setProfileName(session.user.name);
    setProfilePhone(session.user.phone || '');
    setProfileError(null);
    setProfileSuccess(null);
    setShowProfileModal(true);
  };

  const handleUpdateProfile = async () => {
    if (!profileName.trim()) {
      setProfileError('Please enter your full name.');
      return;
    }
    setProfileLoading(true);
    setProfileError(null);
    setProfileSuccess(null);
    try {
      await api.updateProfile({
        name: profileName.trim(),
        phone: profilePhone.trim() || null,
      });
      await refreshSession();
      setProfileSuccess('Profile updated successfully.');
      setTimeout(() => {
        setShowProfileModal(false);
      }, 1000);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setProfileError(caught.message);
      } else {
        setProfileError('Failed to update profile. Please try again.');
      }
    } finally {
      setProfileLoading(false);
    }
  };

  const openPasswordModal = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError(null);
    setPasswordSuccess(null);
    setFieldErrors({});
    setShowPasswordModal(true);
  };

  const handleChangePassword = async () => {
    setPasswordError(null);
    setPasswordSuccess(null);
    const errors: Record<string, string> = {};

    if (!currentPassword) {
      errors.current_password = 'Enter your current password.';
    }
    if (!newPassword) {
      errors.new_password = 'Enter a new password.';
    } else {
      const strength = checkPasswordStrength(newPassword);
      if (!strength.isValid) {
        errors.new_password = 'Password must be 8+ characters with letters and numbers/symbols.';
      }
    }
    if (!confirmPassword) {
      errors.confirm_password = 'Confirm your new password.';
    } else if (confirmPassword !== newPassword) {
      errors.confirm_password = 'Passwords do not match.';
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setPasswordLoading(true);
    try {
      const res = await api.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      setPasswordSuccess(res.message || 'Your password has been changed successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        setShowPasswordModal(false);
      }, 1400);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setPasswordError(caught.message);
        setFieldErrors(caught.fieldErrors || {});
      } else {
        setPasswordError('Failed to change password. Please check your connection and try again.');
      }
    } finally {
      setPasswordLoading(false);
    }
  };

  // Group permissions display
  const permissionsCount = session.permissions.length;
  const displayedPermissions = showAllPermissions
    ? session.permissions
    : session.permissions.slice(0, 6);

  const langDisplayMap: Record<LanguagePreference, string> = {
    en: 'English (US)',
    es: 'Español (ES)',
    fr: 'Français (FR)',
    ar: 'العربية (AR)',
  };

  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top + 12, 22) }]}>
      {/* Brand Header */}
      <View style={styles.brandRow}>
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={onBack}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <MaterialCommunityIcons name="arrow-left" size={24} color="#192338" />
          </Pressable>
        ) : null}
        <Image
          source={require('../../assets/ntan-hexagon-logo.png')}
          style={styles.logoImage}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
        <View style={styles.greetingBox}>
          <Text style={styles.greetingTitle}>My Account</Text>
          <Text style={styles.greetingSubtitle} numberOfLines={1}>
            Profile, Security & Settings
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          onPress={confirmLogout}
          style={({ pressed }) => [styles.signOutTopButton, pressed && styles.pressed]}
        >
          <MaterialCommunityIcons name="logout" size={17} color={colors.danger} />
          <Text style={styles.signOutTopText}>Sign out</Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >

      {/* Ephemeral Real Alert / Notice Banner */}
      {alertNotice ? (
        <View style={styles.noticeToast}>
          <MaterialCommunityIcons name="check-circle" size={18} color="#15803D" />
          <Text style={styles.noticeToastText}>{alertNotice}</Text>
        </View>
      ) : null}

      {/* 1. Personal Profile Card (P0) */}
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials || 'N'}</Text>
        </View>
        <View style={styles.profileBody}>
          <View style={styles.profileHeader}>
            <Text style={styles.profileName}>{session.user.name}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit personal details"
              onPress={openProfileModal}
              style={({ pressed }) => [styles.editProfilePill, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons name="pencil-outline" size={14} color={colors.primary} />
              <Text style={styles.editProfilePillText}>Edit</Text>
            </Pressable>
          </View>
          <Text style={styles.profileEmail}>{session.user.email}</Text>
          {session.user.phone ? (
            <View style={styles.profilePhoneRow}>
              <MaterialCommunityIcons name="phone-outline" size={13} color={colors.muted} />
              <Text style={styles.profilePhone}>{session.user.phone}</Text>
            </View>
          ) : (
            <Text style={styles.profileNoPhone}>No phone number added · Tap Edit</Text>
          )}
          <View style={styles.badgeRow}>
            <Badge label={roleLabel(session.membership.role)} tone="info" />
            <Badge label={humanize(session.user.status || 'active')} tone="success" />
          </View>
        </View>
      </View>

      {/* 2. Company & Assigned Role (P0) */}
      <View style={styles.companyCard}>
        <View style={styles.companyHeader}>
          <View style={styles.companyMark}>
            <MaterialCommunityIcons name="office-building-outline" size={24} color={colors.white} />
          </View>
          <View style={styles.companyText}>
            <Text style={styles.companyLabel}>Company Workspace</Text>
            <Text style={styles.companyName}>{session.company.name}</Text>
            <Text style={styles.companyMeta}>
              {session.company.currency} · {session.company.timezone}
            </Text>
          </View>
          <Badge label={session.company.status} tone="success" />
        </View>

        <View style={styles.companyAccessBox}>
          <View style={styles.companyAccessRow}>
            <MaterialCommunityIcons name="account-tie-outline" size={18} color="#C7D5EB" />
            <Text style={styles.companyAccessLabel}>Assigned Role:</Text>
            <Text style={styles.companyAccessValue}>{roleLabel(session.membership.role)}</Text>
          </View>
          <View style={styles.companyAccessRow}>
            <MaterialCommunityIcons name="warehouse" size={18} color="#C7D5EB" />
            <Text style={styles.companyAccessLabel}>Permitted Access:</Text>
            <Text style={styles.companyAccessValue}>{locationSummary}</Text>
          </View>
        </View>

        {canManageCompany ? (
          <View style={styles.policyBox}>
            <View style={styles.policyText}>
              <Text style={styles.policyTitle}>Allow over-receipt on purchase orders</Text>
              <Text style={styles.policyHint}>
                {allowOverReceipt
                  ? 'Receivers may post more than the ordered quantity. Shortages and damages are still recorded per line.'
                  : 'Receipts above the ordered quantity are rejected at draft and commit. This is the safe default.'}
              </Text>
            </View>
            <Switch
              accessibilityLabel="Allow over-receipt on purchase orders"
              value={allowOverReceipt}
              disabled={overReceiptSaving}
              onValueChange={(value) => void toggleOverReceipt(value)}
              trackColor={{ false: '#43597F', true: colors.primary }}
            />
          </View>
        ) : null}
      </View>

      {/* Quick Team Management Entry for Managers/Admins */}
      {canViewTeam ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open team and access"
          onPress={onOpenTeam}
          style={({ pressed }) => [styles.teamCard, pressed && styles.pressed]}
        >
          <View style={styles.teamIcon}>
            <MaterialCommunityIcons name="account-group-outline" size={24} color={colors.deep} />
          </View>
          <View style={styles.teamBody}>
            <Text style={styles.teamTitle}>Team & access</Text>
            <Text style={styles.teamDescription}>
              Manage members, roles, warehouse access, and invitations in More.
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={22} color={colors.muted} />
        </Pressable>
      ) : null}

      {/* 3. Sign-in & Security (P0) */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionHeaderLeft}>
            <MaterialCommunityIcons name="shield-lock-outline" size={20} color={colors.navy} />
            <Text style={styles.sectionTitle}>Sign-in & Security</Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Password</Text>
          <Text style={styles.infoValue}>••••••••••••</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Session Token</Text>
          <Badge label="Encrypted JWT" tone="success" />
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Recovery Verification</Text>
          <Text style={styles.infoValue}>6-digit code via email</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change password"
          onPress={openPasswordModal}
          style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
        >
          <MaterialCommunityIcons name="key-change" size={17} color={colors.primary} />
          <Text style={styles.actionButtonText}>Change Password</Text>
        </Pressable>
      </View>

      {/* 4. Active Role Capabilities & Operational Scope (P0) */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionHeaderLeft}>
            <MaterialCommunityIcons name="badge-account-outline" size={20} color={colors.navy} />
            <Text style={styles.sectionTitle}>Operational Permissions</Text>
          </View>
          <Badge label={`${permissionsCount} Active`} tone="info" />
        </View>

        <Text style={styles.sectionNotice}>
          Permissions are governed centrally by company policy. To request scope changes, contact your workspace administrator.
        </Text>

        <View style={styles.permissionsWrap}>
          {displayedPermissions.map((perm) => (
            <View key={perm} style={styles.permissionPill}>
              <MaterialCommunityIcons name="check" size={12} color={colors.success} />
              <Text style={styles.permissionPillText}>{perm}</Text>
            </View>
          ))}
        </View>

        {permissionsCount > 6 ? (
          <Pressable
            onPress={() => setShowAllPermissions((prev) => !prev)}
            style={({ pressed }) => [styles.showMoreButton, pressed && styles.pressed]}
          >
            <Text style={styles.showMoreText}>
              {showAllPermissions ? 'Show fewer permissions' : `Show all ${permissionsCount} permissions`}
            </Text>
            <MaterialCommunityIcons
              name={showAllPermissions ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.primary}
            />
          </Pressable>
        ) : null}
      </View>

      {/* 5. Real Notifications & Alerts (P1) */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionHeaderLeft}>
            <MaterialCommunityIcons name="bell-outline" size={20} color={colors.navy} />
            <Text style={styles.sectionTitle}>Notifications & Alerts</Text>
          </View>
        </View>

        <View style={styles.toggleRow}>
          <View style={styles.toggleText}>
            <Text style={styles.toggleTitle}>Low Stock & Stockout Alerts</Text>
            <Text style={styles.toggleSubtitle}>Flag reorder items when below safety thresholds</Text>
          </View>
          <Switch
            value={stockoutAlerts}
            onValueChange={handleToggleStockout}
            trackColor={{ false: '#CBD5E1', true: colors.primary }}
          />
        </View>

        <View style={styles.toggleRow}>
          <View style={styles.toggleText}>
            <Text style={styles.toggleTitle}>Security & Login Notifications</Text>
            <Text style={styles.toggleSubtitle}>Alert when password changes or new devices sign in</Text>
          </View>
          <Switch
            value={securityAlerts}
            onValueChange={handleToggleSecurity}
            trackColor={{ false: '#CBD5E1', true: colors.primary }}
          />
        </View>

        <View style={styles.toggleRow}>
          <View style={styles.toggleText}>
            <Text style={styles.toggleTitle}>Email Summaries</Text>
            <Text style={styles.toggleSubtitle}>Weekly operations summary to {session.user.email}</Text>
          </View>
          <Switch
            value={emailAlerts}
            onValueChange={handleToggleEmail}
            trackColor={{ false: '#CBD5E1', true: colors.primary }}
          />
        </View>
      </View>

      {/* 6. Real App Preferences (P1) */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionHeaderLeft}>
            <MaterialCommunityIcons name="tune-variant" size={20} color={colors.navy} />
            <Text style={styles.sectionTitle}>App Preferences</Text>
          </View>
        </View>

        {/* Theme Preference */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change theme preference"
          onPress={cycleTheme}
          style={({ pressed }) => [styles.prefRowInteractive, pressed && styles.pressed]}
        >
          <View style={styles.prefLeft}>
            <MaterialCommunityIcons name="theme-light-dark" size={18} color={colors.muted} />
            <Text style={styles.prefLabel}>Theme</Text>
          </View>
          <View style={styles.prefRightInteractive}>
            <Text style={styles.prefActiveValue}>{humanize(themePref)}</Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color={colors.muted} />
          </View>
        </Pressable>

        {/* Language Preference */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change preferred language"
          onPress={cycleLanguage}
          style={({ pressed }) => [styles.prefRowInteractive, pressed && styles.pressed]}
        >
          <View style={styles.prefLeft}>
            <MaterialCommunityIcons name="translate" size={18} color={colors.muted} />
            <Text style={styles.prefLabel}>Language</Text>
          </View>
          <View style={styles.prefRightInteractive}>
            <Text style={styles.prefActiveValue}>{langDisplayMap[langPref]}</Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color={colors.muted} />
          </View>
        </Pressable>

        {/* Date Format Preference */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change date format"
          onPress={cycleDateFormat}
          style={({ pressed }) => [styles.prefRowInteractive, pressed && styles.pressed]}
        >
          <View style={styles.prefLeft}>
            <MaterialCommunityIcons name="calendar-clock" size={18} color={colors.muted} />
            <Text style={styles.prefLabel}>Date Format</Text>
          </View>
          <View style={styles.prefRightInteractive}>
            <Text style={styles.prefActiveValue}>
              {dateFormat === 'iso' ? 'YYYY-MM-DD' : dateFormat === 'us' ? 'MM/DD/YYYY' : 'DD/MM/YYYY'}
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color={colors.muted} />
          </View>
        </Pressable>

        {/* Number Format Preference */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change number format"
          onPress={cycleNumberFormat}
          style={({ pressed }) => [styles.prefRowInteractive, pressed && styles.pressed]}
        >
          <View style={styles.prefLeft}>
            <MaterialCommunityIcons name="numeric" size={18} color={colors.muted} />
            <Text style={styles.prefLabel}>Number Format</Text>
          </View>
          <View style={styles.prefRightInteractive}>
            <Text style={styles.prefActiveValue}>
              {numberFormat === 'standard' ? '1,234.56' : numberFormat === 'european' ? '1.234,56' : '1.2K (Compact)'}
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color={colors.muted} />
          </View>
        </Pressable>
      </View>

      {/* 7. Real User Guides, Help Center & About NTAN (P1) */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionHeaderLeft}>
            <MaterialCommunityIcons name="help-circle-outline" size={20} color={colors.navy} />
            <Text style={styles.sectionTitle}>Help & Support</Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open user guides and help center"
          onPress={() => setShowHelpModal(true)}
          style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
        >
          <View style={styles.menuLeft}>
            <MaterialCommunityIcons name="book-open-page-variant" size={19} color={colors.primary} />
            <View>
              <Text style={styles.menuTitle}>User Guides & Help Center</Text>
              <Text style={styles.menuSubtitle}>Complete walkthroughs for receiving, stock & safety</Text>
            </View>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={colors.muted} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Email support"
          onPress={() => void Linking.openURL('mailto:ntanservices@gmail.com?subject=NTAN%20Inventory%20Support%20Request')}
          style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
        >
          <View style={styles.menuLeft}>
            <MaterialCommunityIcons name="email-outline" size={19} color={colors.primary} />
            <View>
              <Text style={styles.menuTitle}>Contact Support Desk</Text>
              <Text style={styles.menuSubtitle}>ntanservices@gmail.com</Text>
            </View>
          </View>
          <MaterialCommunityIcons name="open-in-new" size={18} color={colors.muted} />
        </Pressable>

        <View style={styles.aboutDivider} />

        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Product Version</Text>
          <Text style={styles.aboutValue}>NTAN Inventory 1.0.0 (Build 240)</Text>
        </View>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>License Type</Text>
          <Text style={styles.aboutValue}>Commercial Enterprise Cloud</Text>
        </View>
      </View>

      {/* 8. Dedicated Sign Out Section (P0) */}
      <View style={styles.signOutCard}>
        <View style={styles.signOutCardHeader}>
          <MaterialCommunityIcons name="shield-alert-outline" size={22} color={colors.danger} />
          <View style={styles.signOutCardText}>
            <Text style={styles.signOutCardTitle}>Session Control</Text>
            <Text style={styles.signOutCardSubtitle}>
              Securely end this session and invalidate local authentication tokens on this device.
            </Text>
          </View>
        </View>
        <Button
          label="Sign Out of NTAN Inventory"
          variant="danger"
          onPress={confirmLogout}
        />
      </View>

      {/* Sync Refresh */}
      <Pressable
        accessibilityRole="button"
        onPress={() => void refresh()}
        style={({ pressed }) => [styles.refreshRow, pressed && styles.pressed]}
      >
        <MaterialCommunityIcons name="refresh" size={18} color={colors.primary} />
        <Text style={styles.refreshText}>Sync workspace data</Text>
      </Pressable>

      {/* Profile Edit Modal */}
      <Modal
        visible={showProfileModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!profileLoading) setShowProfileModal(false);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderIcon}>
                <MaterialCommunityIcons name="account-edit-outline" size={22} color={colors.primary} />
              </View>
              <View style={styles.modalHeaderText}>
                <Text style={styles.modalTitle}>Edit Profile Details</Text>
                <Text style={styles.modalSubtitle}>Update your display name and contact phone</Text>
              </View>
              <Pressable
                accessibilityLabel="Close modal"
                disabled={profileLoading}
                onPress={() => setShowProfileModal(false)}
                style={styles.modalCloseButton}
              >
                <MaterialCommunityIcons name="close" size={20} color={colors.muted} />
              </Pressable>
            </View>

            {profileSuccess ? (
              <View style={styles.successBox}>
                <MaterialCommunityIcons name="check-circle" size={20} color={colors.success} />
                <Text style={styles.successText}>{profileSuccess}</Text>
              </View>
            ) : null}

            {profileError ? (
              <View style={styles.errorBox}>
                <MaterialCommunityIcons name="alert-circle-outline" size={20} color={colors.danger} />
                <Text style={styles.errorText}>{profileError}</Text>
              </View>
            ) : null}

            <Field
              label="Full Name"
              value={profileName}
              onChangeText={setProfileName}
              placeholder="e.g. John Doe"
              disabled={profileLoading}
            />

            <Field
              label="Phone Number"
              value={profilePhone}
              onChangeText={setProfilePhone}
              placeholder="+1 555 123 4567"
              keyboardType="phone-pad"
              disabled={profileLoading}
            />

            <View style={styles.infoRowModal}>
              <Text style={styles.infoLabel}>Email (Read-only)</Text>
              <Text style={styles.infoValue}>{session.user.email}</Text>
            </View>

            <View style={styles.modalActions}>
              <Button
                label="Cancel"
                variant="secondary"
                disabled={profileLoading}
                onPress={() => setShowProfileModal(false)}
              />
              <Button
                label="Save Profile"
                loading={profileLoading}
                onPress={() => void handleUpdateProfile()}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Change Password Modal */}
      <Modal
        visible={showPasswordModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!passwordLoading) setShowPasswordModal(false);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderIcon}>
                <MaterialCommunityIcons name="key-outline" size={22} color={colors.primary} />
              </View>
              <View style={styles.modalHeaderText}>
                <Text style={styles.modalTitle}>Change Password</Text>
                <Text style={styles.modalSubtitle}>
                  Update credentials for {session.user.email}
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Close modal"
                disabled={passwordLoading}
                onPress={() => setShowPasswordModal(false)}
                style={styles.modalCloseButton}
              >
                <MaterialCommunityIcons name="close" size={20} color={colors.muted} />
              </Pressable>
            </View>

            {passwordSuccess ? (
              <View style={styles.successBox}>
                <MaterialCommunityIcons name="check-circle" size={20} color={colors.success} />
                <Text style={styles.successText}>{passwordSuccess}</Text>
              </View>
            ) : null}

            {passwordError ? (
              <View style={styles.errorBox}>
                <MaterialCommunityIcons name="alert-circle-outline" size={20} color={colors.danger} />
                <Text style={styles.errorText}>{passwordError}</Text>
              </View>
            ) : null}

            <Field
              label="Current Password"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              placeholder="Enter existing password"
              secureTextEntry
              error={fieldErrors.current_password}
              disabled={passwordLoading}
            />

            <Field
              label="New Password"
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="Min. 8 characters"
              secureTextEntry
              error={fieldErrors.new_password}
              disabled={passwordLoading}
            />

            {newPassword ? <PasswordStrength password={newPassword} /> : null}

            <Field
              label="Confirm New Password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Re-enter new password"
              secureTextEntry
              error={fieldErrors.confirm_password}
              disabled={passwordLoading}
            />

            <View style={styles.modalActions}>
              <Button
                label="Cancel"
                variant="secondary"
                disabled={passwordLoading}
                onPress={() => setShowPasswordModal(false)}
              />
              <Button
                label="Save New Password"
                loading={passwordLoading}
                onPress={() => void handleChangePassword()}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Comprehensive User Guides & Help Center Modal */}
      <Modal
        visible={showHelpModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowHelpModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalContent, styles.helpModalContent]}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderIcon}>
                <MaterialCommunityIcons name="book-open-page-variant" size={22} color={colors.primary} />
              </View>
              <View style={styles.modalHeaderText}>
                <Text style={styles.modalTitle}>User Guides & Help Center</Text>
                <Text style={styles.modalSubtitle}>NTAN Commercial Inventory Knowledge Base</Text>
              </View>
              <Pressable onPress={() => setShowHelpModal(false)} style={styles.modalCloseButton}>
                <MaterialCommunityIcons name="close" size={20} color={colors.muted} />
              </Pressable>
            </View>

            {/* Guide Category Tabs */}
            <View style={styles.helpTabsRow}>
              <Pressable
                onPress={() => setActiveHelpTab('receiving')}
                style={[styles.helpTab, activeHelpTab === 'receiving' && styles.helpTabActive]}
              >
                <Text style={[styles.helpTabText, activeHelpTab === 'receiving' && styles.helpTabTextActive]}>
                  Receiving
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setActiveHelpTab('roles')}
                style={[styles.helpTab, activeHelpTab === 'roles' && styles.helpTabActive]}
              >
                <Text style={[styles.helpTabText, activeHelpTab === 'roles' && styles.helpTabTextActive]}>
                  Roles & Scope
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setActiveHelpTab('security')}
                style={[styles.helpTab, activeHelpTab === 'security' && styles.helpTabActive]}
              >
                <Text style={[styles.helpTabText, activeHelpTab === 'security' && styles.helpTabTextActive]}>
                  Security
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setActiveHelpTab('faq')}
                style={[styles.helpTab, activeHelpTab === 'faq' && styles.helpTabActive]}
              >
                <Text style={[styles.helpTabText, activeHelpTab === 'faq' && styles.helpTabTextActive]}>
                  FAQ & Support
                </Text>
              </Pressable>
            </View>

            <ScrollView style={styles.helpBodyScroll} contentContainerStyle={styles.helpBodyContent}>
              {activeHelpTab === 'receiving' ? (
                <View style={styles.helpTabSection}>
                  <Text style={styles.helpArticleHeading}>Warehouse Receiving & Stock Verification</Text>
                  <Text style={styles.helpArticlePara}>
                    1. Navigate to <Text style={styles.helpBold}>Operations → Receive</Text> to check in inbound shipments from business partners.
                  </Text>
                  <Text style={styles.helpArticlePara}>
                    2. Select the destination facility (e.g., Receiving Dock or Main Storage Rack) and choose whether items track Lot numbers or Serial IDs.
                  </Text>
                  <Text style={styles.helpArticlePara}>
                    3. Items requiring quality review will land in quarantine before put-away into pickable bins.
                  </Text>
                </View>
              ) : null}

              {activeHelpTab === 'roles' ? (
                <View style={styles.helpTabSection}>
                  <Text style={styles.helpArticleHeading}>Access Control & Warehouse Policies</Text>
                  <Text style={styles.helpArticlePara}>
                    NTAN features 14 operational warehouse roles (Warehouse Supervisor, Quality Inspector, Order Picker, Dispatch Operator, etc.).
                  </Text>
                  <Text style={styles.helpArticlePara}>
                    • <Text style={styles.helpBold}>Operators:</Text> Restricted strictly to their assigned facilities or bins.
                  </Text>
                  <Text style={styles.helpArticlePara}>
                    • <Text style={styles.helpBold}>Supervisors & Admins:</Text> Can invite team members and modify warehouse directories under More → Team & Access.
                  </Text>
                </View>
              ) : null}

              {activeHelpTab === 'security' ? (
                <View style={styles.helpTabSection}>
                  <Text style={styles.helpArticleHeading}>Authentication & Session Security</Text>
                  <Text style={styles.helpArticlePara}>
                    • NTAN issues cryptographically encrypted JSON Web Tokens stored in hardware-backed secure storage.
                  </Text>
                  <Text style={styles.helpArticlePara}>
                    • Password resets require a real 6-digit verification code delivered from <Text style={styles.helpBold}>ntanservices@gmail.com</Text>.
                  </Text>
                  <Text style={styles.helpArticlePara}>
                    • Tapping <Text style={styles.helpBold}>Sign out</Text> clears your cryptographic session token from this device immediately.
                  </Text>
                </View>
              ) : null}

              {activeHelpTab === 'faq' ? (
                <View style={styles.helpTabSection}>
                  <Text style={styles.helpArticleHeading}>Frequently Asked Questions & Contact</Text>
                  <Text style={styles.helpArticlePara}>
                    <Text style={styles.helpBold}>Q: How do I change my assigned warehouse?</Text>{'\n'}
                    A: Ask your warehouse manager or company administrator to adjust your location scope in Team & Access.
                  </Text>
                  <Text style={styles.helpArticlePara}>
                    <Text style={styles.helpBold}>Q: Why am I not receiving email codes?</Text>{'\n'}
                    A: Check your spam folder or contact your administrator to verify that Gmail SMTP is enabled for ntanservices@gmail.com.
                  </Text>
                  <Pressable
                    onPress={() => void Linking.openURL('mailto:ntanservices@gmail.com?subject=NTAN%20Support%20Ticket')}
                    style={styles.contactSupportPill}
                  >
                    <MaterialCommunityIcons name="email-fast-outline" size={16} color={colors.primary} />
                    <Text style={styles.contactSupportPillText}>Email Support: ntanservices@gmail.com</Text>
                  </Pressable>
                </View>
              ) : null}
            </ScrollView>

            <Button label="Close Guides" onPress={() => setShowHelpModal(false)} />
          </View>
        </View>
      </Modal>
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
  screen: {
    flex: 1,
    backgroundColor: '#EFF3F8',
  },
  content: {
    paddingHorizontal: 16,
    gap: 14,
    paddingBottom: 24,
  },
  signOutTopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(239, 68, 68, 0.2)',
    backgroundColor: '#FEF2F2',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  signOutTopText: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.danger,
  },
  eyebrow: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 2,
    color: colors.deep,
  },
  title: {
    fontFamily: fonts.heading,
    fontSize: 28,
    color: colors.navy,
    marginTop: 2,
  },
  noticeToast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#86EFAC',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  noticeToastText: {
    flex: 1,
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: '#166534',
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  avatar: {
    width: 62,
    height: 62,
    borderRadius: 20,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: fonts.heading,
    fontSize: 23,
    color: colors.accent,
  },
  profileBody: {
    flex: 1,
    gap: 2,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  profileName: {
    fontFamily: fonts.headingSemi,
    fontSize: 18,
    color: colors.navy,
  },
  editProfilePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  editProfilePillText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.primary,
  },
  profileEmail: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  profilePhoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 1,
  },
  profilePhone: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.text,
  },
  profileNoPhone: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    fontStyle: 'italic',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  companyCard: {
    backgroundColor: colors.navy,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  companyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  companyMark: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  companyText: {
    flex: 1,
    gap: 1,
  },
  companyLabel: {
    fontFamily: fonts.body,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: '#AFC4E3',
  },
  companyName: {
    fontFamily: fonts.headingSemi,
    fontSize: 18,
    color: colors.white,
  },
  companyMeta: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: '#C7D5EB',
  },
  companyAccessBox: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 8,
  },
  companyAccessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  companyAccessLabel: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: '#AFC4E3',
  },
  companyAccessValue: {
    flex: 1,
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.white,
  },
  policyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  policyText: {
    flex: 1,
    gap: 3,
  },
  policyTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.white,
  },
  policyHint: {
    fontFamily: fonts.body,
    fontSize: 10,
    lineHeight: 15,
    color: '#C7D5EB',
  },
  teamCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  teamIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#EDF3FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamBody: {
    flex: 1,
    gap: 2,
  },
  teamTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 15,
    color: colors.navy,
  },
  teamDescription: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.muted,
  },
  sectionCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 16,
    color: colors.navy,
  },
  sectionNotice: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  infoRowModal: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    marginTop: 4,
  },
  infoLabel: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  infoValue: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.text,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: '#EFF6FF',
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  actionButtonText: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.primary,
  },
  permissionsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  permissionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F1F5F9',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  permissionPillText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.navy,
  },
  showMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  showMoreText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.primary,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: 4,
  },
  toggleText: {
    flex: 1,
    gap: 2,
  },
  toggleTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.text,
  },
  toggleSubtitle: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  prefRowInteractive: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  prefLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  prefLabel: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.text,
  },
  prefRightInteractive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  prefActiveValue: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.primary,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  menuLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  menuTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.text,
  },
  menuSubtitle: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    marginTop: 1,
  },
  aboutDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  aboutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  aboutLabel: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  aboutValue: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.text,
  },
  signOutCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.dangerSoft,
    padding: spacing.lg,
    gap: spacing.md,
  },
  signOutCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  signOutCardText: {
    flex: 1,
    gap: 2,
  },
  signOutCardTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 15,
    color: colors.danger,
  },
  signOutCardSubtitle: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    lineHeight: 16,
  },
  refreshRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
  refreshText: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.primary,
  },
  // Modal Styles
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(11, 17, 32, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalContent: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
    ...shadow,
  },
  helpModalContent: {
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  modalHeaderIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalHeaderText: {
    flex: 1,
  },
  modalTitle: {
    fontFamily: fonts.headingSemi,
    fontSize: 17,
    color: colors.navy,
  },
  modalSubtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  modalCloseButton: {
    padding: 6,
    borderRadius: radius.pill,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: '#FECDD3',
    padding: spacing.md,
    borderRadius: radius.md,
  },
  errorText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.danger,
  },
  successBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#86EFAC',
    padding: spacing.md,
    borderRadius: radius.md,
  },
  successText: {
    flex: 1,
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: '#166534',
  },
  helpTabsRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 4,
  },
  helpTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  helpTabActive: {
    borderBottomColor: colors.primary,
  },
  helpTabText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  helpTabTextActive: {
    fontFamily: fonts.bodySemi,
    color: colors.primary,
  },
  helpBodyScroll: {
    maxHeight: 280,
  },
  helpBodyContent: {
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  helpTabSection: {
    gap: 8,
  },
  helpArticleHeading: {
    fontFamily: fonts.headingSemi,
    fontSize: 14,
    color: colors.navy,
  },
  helpArticlePara: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.text,
  },
  helpBold: {
    fontFamily: fonts.bodySemi,
    color: colors.navy,
  },
  contactSupportPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    padding: spacing.md,
    borderRadius: radius.md,
    marginTop: 8,
  },
  contactSupportPillText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.primary,
  },
});
