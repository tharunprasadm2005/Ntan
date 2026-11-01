import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { SvgXml } from 'react-native-svg';

import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { Field } from '../components/Field';
import { checkPasswordStrength } from '../components/PasswordStrength';
import { PhoneField } from '../components/PhoneField';
import { formatDateTime, roleLabel } from '../format';
import { cleanInvitationInput } from '../invitation';
import { colors, fonts, radius, spacing } from '../theme';
import type { InvitationPreview } from '../types';

if (
  Platform.OS === 'android' &&
  !(globalThis as unknown as { nativeFabricUIManager?: unknown }).nativeFabricUIManager &&
  typeof UIManager.setLayoutAnimationEnabledExperimental === 'function'
) {
  try {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  } catch {
    // No-op
  }
}

type AuthView = 'welcome' | 'auth';
type MainTab = 'signin_join' | 'create';
type AuthMethod = 'signin' | 'join';
type RegisterStep = 0 | 1;
type JoinStep = 0 | 1;
type ForgotStep = 0 | 1;

const cornerTrSvg = `<svg width="412" height="212" viewBox="0 0 412 212" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#clip0_57_5)">
<path d="M234 0H412V210L302 151C280 139 269 127 261 105L234 0Z" fill="#FFBF32" stroke="black"/>
<path d="M237 0H412V197L308 138C286 126 278 113 270 93L237 0Z" fill="#1E2E4F" stroke="black"/>
<path d="M260 0L286 71C293 91 301 100 318 110L412 165" stroke-width="0.6" stroke="#31487A" stroke-opacity="0.65"/>
<path d="M270 0L295 67C302 86 311 94 327 103L412 153" stroke-width="0.6" stroke="#31487A" stroke-opacity="0.65"/>
</g>
<defs>
<clipPath id="clip0_57_5">
<rect width="412" height="212" fill="white"/>
</clipPath>
</defs>
</svg>`;

const cornerBlSvg = `<svg width="206" height="106" viewBox="0 0 206 106" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#clip0_61_3)">
<g clip-path="url(#clip1_61_3)">
<path d="M89 106H0V1L55 30.5C66 36.5 71.5 42.5 75.5 53.5L89 106Z" fill="#FFBF32" stroke-width="0.5" stroke="black"/>
<path d="M87.5 106H0V7.5L52 37C63 43 67 49.5 71 59.5L87.5 106Z" fill="#1E2E4F" stroke-width="0.5" stroke="black"/>
<path d="M76 106L63 70.5C59.5 60.5 55.5 56 47 51L0 23.5" stroke-width="0.3" stroke="#31487A" stroke-opacity="0.65"/>
<path d="M71 106L58.5 72.5C55 63 50.5 59 42.5 54.5L0 29.5" stroke-width="0.3" stroke="#31487A" stroke-opacity="0.65"/>
</g>
</g>
<defs>
<clipPath id="clip0_61_3">
<rect width="206" height="106" fill="white"/>
</clipPath>
<clipPath id="clip1_61_3">
<rect width="206" height="106" fill="white" transform="matrix(-1 0 0 -1 206 106)"/>
</clipPath>
</defs>
</svg>`;

const cornerBrSvg = `<svg width="124" height="64" viewBox="0 0 124 64" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#clip0_61_8)">
<g clip-path="url(#clip1_61_8)">
<path d="M70.4272 63.8058H124V0.601913L90.8932 18.3592C84.2718 21.9708 80.9611 25.5825 78.5534 32.2039L70.4272 63.8058Z" fill="#FFBF32" stroke-width="0.300971" stroke="black"/>
<path d="M71.3301 63.8058H124V4.51454L92.699 22.2718C86.0777 25.8835 83.6699 29.7961 81.2621 35.8155L71.3301 63.8058Z" fill="#1E2E4F" stroke-width="0.300971" stroke="black"/>
<path d="M78.2524 63.8058L86.0777 42.4369C88.1845 36.4174 90.5922 33.7087 95.7087 30.699L124 14.1456" stroke-width="0.180583" stroke="#31487A" stroke-opacity="0.65"/>
<path d="M81.2621 63.8058L88.7864 43.6407C90.8932 37.9223 93.6019 35.5145 98.4175 32.8058L124 17.7573" stroke-width="0.180583" stroke="#31487A" stroke-opacity="0.65"/>
</g>
</g>
<defs>
<clipPath id="clip0_61_8">
<rect width="123.6" height="63.6" fill="white" transform="scale(1.00324)"/>
</clipPath>
<clipPath id="clip1_61_8">
<rect width="123.6" height="63.6" fill="white" transform="matrix(1.00324 0 0 -1.00324 0 63.8058)"/>
</clipPath>
</defs>
</svg>`;

const arrowRightSvg = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M4.166 10H15.834M10 15.834L15.834 10L10 4.16602" stroke-width="2" stroke-linecap="round" stroke="#F0F4FA"/>
</svg>`;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function emailError(value: string): string | undefined {
  if (!value.trim()) {
    return 'Enter your email.';
  }
  if (!emailPattern.test(value.trim())) {
    return 'Enter a valid email address.';
  }
  return undefined;
}

type WarehouseType =
  | 'distribution'
  | 'fulfilment'
  | 'general'
  | 'bulk'
  | 'cold_storage'
  | 'cross_dock';

type WarehouseLayout = 'all_in_one' | 'multi_zone' | 'bulk_storage';

const WAREHOUSE_TYPES = [
  {
    key: 'distribution' as const,
    label: 'Distribution Centre',
    detail: 'Regional hub for store & branch replenishment',
    icon: 'truck-fast-outline',
  },
  {
    key: 'fulfilment' as const,
    label: 'Fulfilment Centre',
    detail: 'High-speed piece-picking & customer dispatch',
    icon: 'package-variant-closed',
  },
  {
    key: 'general' as const,
    label: 'General Storage',
    detail: 'Standard commercial & inventory storage',
    icon: 'warehouse',
  },
  {
    key: 'bulk' as const,
    label: 'Bulk Pallet Racks',
    detail: 'Heavy pallet racks, raw goods & volume',
    icon: 'dolly',
  },
  {
    key: 'cold_storage' as const,
    label: 'Cold Storage',
    detail: 'Temperature-controlled & perishable goods',
    icon: 'snowflake',
  },
  {
    key: 'cross_dock' as const,
    label: 'Transit / Cross-Dock',
    detail: 'Direct transshipment & sorting facility',
    icon: 'swap-horizontal-bold',
  },
] as const;

const WAREHOUSE_LAYOUTS = [
  {
    key: 'multi_zone' as const,
    label: 'Multi-Zone Layout',
    detail: 'Receiving, storage, picking and dispatch areas',
    icon: 'view-dashboard-outline',
  },
  {
    key: 'all_in_one' as const,
    label: 'All-in-One Floor',
    detail: 'Single shared floor for receiving, storage & packing',
    icon: 'vector-square',
  },
  {
    key: 'bulk_storage' as const,
    label: 'Bulk Storage Flow',
    detail: 'High-density pallet storage and direct staging',
    icon: 'dolly',
  },
] as const;

/**
 * Minimalist Password Progress Line
 */
function PasswordProgressBar({ password }: { password: string }) {
  if (!password) return null;
  const { score } = checkPasswordStrength(password);
  const colorsList = ['#E2E8F0', '#EF4444', '#F59E0B', '#3B82F6', '#10B981'];
  const activeColor = colorsList[score] ?? '#E2E8F0';

  return (
    <View style={styles.passwordProgressRow}>
      {[1, 2, 3, 4].map((step) => {
        const isFilled = step <= score;
        return (
          <View
            key={step}
            style={[
              styles.passwordProgressSegment,
              isFilled && { backgroundColor: activeColor },
            ]}
          />
        );
      })}
    </View>
  );
}

/**
 * Custom Tactile Inline Dropdown Picker
 */
function InlineGlassDropdown<T extends string>({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: T;
  options: readonly { key: T; label: string; detail?: string; icon?: string }[];
  onSelect: (val: T) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = options.find((o) => o.key === value) ?? options[0];

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsOpen((prev) => !prev);
  };

  return (
    <View style={styles.dropdownGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      
      {/* Trigger Box */}
      <Pressable
        accessibilityRole="button"
        onPress={toggle}
        style={({ pressed }) => [
          styles.dropdownTrigger,
          isOpen && styles.dropdownTriggerActive,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.dropdownTriggerLeft}>
          {selectedOption?.icon ? (
            <MaterialCommunityIcons
              name={selectedOption.icon as any}
              size={18}
              color={colors.primary}
            />
          ) : null}
          <Text style={styles.dropdownTriggerText}>{selectedOption?.label}</Text>
        </View>
        <MaterialCommunityIcons
          name={isOpen ? 'chevron-up' : 'chevron-down'}
          size={20}
          color="#64748B"
        />
      </Pressable>

      {/* Inline Accordion Options Menu */}
      {isOpen ? (
        <View style={styles.dropdownMenu}>
          {options.map((opt, idx) => {
            const isSelected = opt.key === value;
            return (
              <Pressable
                key={opt.key}
                onPress={() => {
                  onSelect(opt.key);
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  setIsOpen(false);
                }}
                style={({ pressed }) => [
                  styles.dropdownMenuItem,
                  isSelected && styles.dropdownMenuItemSelected,
                  idx === options.length - 1 && styles.dropdownMenuItemLast,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.dropdownMenuItemLeft}>
                  {opt.icon ? (
                    <MaterialCommunityIcons
                      name={opt.icon as any}
                      size={18}
                      color={isSelected ? colors.primary : '#64748B'}
                    />
                  ) : null}
                  <View style={styles.dropdownMenuItemTextCol}>
                    <Text
                      style={[
                        styles.dropdownMenuItemTitle,
                        isSelected && styles.dropdownMenuItemTitleSelected,
                      ]}
                    >
                      {opt.label}
                    </Text>
                    {opt.detail ? (
                      <Text style={styles.dropdownMenuItemDetail} numberOfLines={1}>
                        {opt.detail}
                      </Text>
                    ) : null}
                  </View>
                </View>
                {isSelected ? (
                  <MaterialCommunityIcons name="check" size={16} color={colors.primary} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

export function AuthScreen() {
  const { login, registerCompany, joinCompany } = useAuth();
  const [, requestCameraPermission] = useCameraPermissions();

  // Navigation Mode
  const [view, setView] = useState<AuthView>('welcome');
  const [mainTab, setMainTab] = useState<MainTab>('signin_join');
  const [authMethod, setAuthMethod] = useState<AuthMethod>('signin');
  const [isForgot, setIsForgot] = useState(false);

  // Steps
  const [registerStep, setRegisterStep] = useState<RegisterStep>(0);
  const [joinStep, setJoinStep] = useState<JoinStep>(0);
  const [forgotStep, setForgotStep] = useState<ForgotStep>(0);

  // Form Fields
  const [companyName, setCompanyName] = useState('');
  const [warehouseName, setWarehouseName] = useState('');
  const [warehouseCode, setWarehouseCode] = useState('');
  const [warehouseAddress, setWarehouseAddress] = useState('');
  const [warehouseType, setWarehouseType] = useState<WarehouseType>('distribution');
  const [warehouseLayout, setWarehouseLayout] = useState<WarehouseLayout>('multi_zone');
  const [locationCode, setLocationCode] = useState('');
  const [invitationToken, setInvitationToken] = useState('');
  const [preview, setPreview] = useState<InvitationPreview | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Password reset fields
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  const [emailSentNotice, setEmailSentNotice] = useState<string | null>(null);
  const [devCodeHint, setDevCodeHint] = useState<string | null>(null);

  // QR Scanner & camera
  const [scannerOpen, setScannerOpen] = useState(false);

  // Status
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const resetFeedback = () => {
    setError(null);
    setFieldErrors({});
    setEmailSentNotice(null);
  };

  const navigateToAuth = (targetTab: MainTab, method: AuthMethod = 'signin') => {
    setView('auth');
    setMainTab(targetTab);
    setAuthMethod(method);
    setIsForgot(false);
    setRegisterStep(0);
    setJoinStep(0);
    setForgotStep(0);
    setPreview(null);
    setPassword('');
    setConfirmPassword('');
    resetFeedback();
  };

  const switchTab = (tab: MainTab) => {
    setMainTab(tab);
    setIsForgot(false);
    resetFeedback();
  };

  const switchAuthMethod = (method: AuthMethod) => {
    setAuthMethod(method);
    resetFeedback();
  };

  const handleLogin = async () => {
    resetFeedback();
    const nextErrors: Record<string, string> = {};
    const invalidEmail = emailError(email);
    if (invalidEmail) nextErrors.email = invalidEmail;
    if (!password) nextErrors.password = 'Enter your password.';
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setLoading(true);
    try {
      await login(email, password);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(
          caught.code === 'company_selection_required'
            ? 'This account belongs to more than one company. Multi-company sign-in is not available in the app yet.'
            : caught.message,
        );
        setFieldErrors(caught.fieldErrors);
      } else {
        setError('Something went wrong. Please check your connection and try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterAdminContinue = () => {
    resetFeedback();
    const nextErrors: Record<string, string> = {};
    if (!name.trim()) nextErrors.name = 'Enter your name.';
    const invalidEmail = emailError(email);
    if (invalidEmail) nextErrors.email = invalidEmail;
    if (!phone.trim()) nextErrors.phone = 'Enter your number.';

    if (!password) {
      nextErrors.password = 'Create a password.';
    } else {
      const strength = checkPasswordStrength(password);
      if (!strength.isValid) {
        nextErrors.password = 'Password must meet complexity requirements.';
      }
    }
    if (password !== confirmPassword) {
      nextErrors.confirmPassword = 'Passwords do not match.';
    }

    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setRegisterStep(1);
  };

  const handleRegisterSubmit = async () => {
    resetFeedback();
    const nextErrors: Record<string, string> = {};
    if (!companyName.trim()) nextErrors.company_name = 'Enter company name.';
    if (!warehouseName.trim()) nextErrors.warehouse_name = 'Enter warehouse name.';
    if (!warehouseCode.trim()) nextErrors.warehouse_code = 'Enter warehouse code.';
    if (!warehouseAddress.trim()) nextErrors.warehouse_address = 'Enter warehouse address.';

    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setLoading(true);
    try {
      await registerCompany({
        name,
        email,
        phone: phone.trim() ? phone.trim() : undefined,
        password,
        company_name: companyName,
        warehouse_name: warehouseName,
        warehouse_code: warehouseCode,
        warehouse_address: warehouseAddress,
        warehouse_type: warehouseType,
        warehouse_layout: warehouseLayout,
        location_code: locationCode.trim() ? locationCode.trim() : undefined,
      });
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors);
        if (
          caught.fieldErrors.name ||
          caught.fieldErrors.email ||
          caught.fieldErrors.phone ||
          caught.fieldErrors.password
        ) {
          setRegisterStep(0);
        }
      } else {
        setError('Could not create workspace. Please verify your details.');
      }
    } finally {
      setLoading(false);
    }
  };

  const verifyInvitationCode = async (tokenOrCode: string) => {
    resetFeedback();
    const cleaned = cleanInvitationInput(tokenOrCode);
    if (!cleaned) {
      setFieldErrors({ invitation_token: 'Enter your invitation code.' });
      return;
    }

    setLoading(true);
    try {
      const res = await api.previewInvitation(cleaned);
      setPreview(res);
      setInvitationToken(cleaned);
      if (res.name && !name) setName(res.name);
      if (res.phone && !phone) setPhone(res.phone);
      setJoinStep(1);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors);
      } else {
        setError('Could not verify invitation. Please check the code.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePasteInvitationCode = async () => {
    try {
      const clipboardContent = await Clipboard.getStringAsync();
      if (clipboardContent) {
        const cleaned = cleanInvitationInput(clipboardContent);
        setInvitationToken(cleaned);
        await verifyInvitationCode(cleaned);
      }
    } catch {
      // Ignored
    }
  };

  const handleOpenScanner = async () => {
    const perm = await requestCameraPermission();
    if (perm.granted) {
      setScannerOpen(true);
    } else {
      setError('Camera access is required to scan team QR codes.');
    }
  };

  const handleBarcodeScanned = (res: BarcodeScanningResult) => {
    setScannerOpen(false);
    if (res.data) {
      const cleaned = cleanInvitationInput(res.data);
      setInvitationToken(cleaned);
      void verifyInvitationCode(cleaned);
    }
  };

  const handleJoinSubmit = async () => {
    resetFeedback();
    const nextErrors: Record<string, string> = {};
    if (!name.trim()) nextErrors.name = 'Enter your name.';
    if (!password) {
      nextErrors.password = 'Create an account password.';
    } else {
      const strength = checkPasswordStrength(password);
      if (!strength.isValid) {
        nextErrors.password = 'Password must meet complexity requirements.';
      }
    }
    if (password !== confirmPassword) {
      nextErrors.confirmPassword = 'Passwords do not match.';
    }

    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setLoading(true);
    try {
      await joinCompany({
        invitation_token: invitationToken,
        email: preview?.email ?? email,
        name: name.trim(),
        password,
        phone: phone.trim() ? phone.trim() : undefined,
      });
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors);
      } else {
        setError('Could not join workspace. Check your connection.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotRequest = async () => {
    resetFeedback();
    const invalidEmail = emailError(email);
    if (invalidEmail) {
      setFieldErrors({ email: invalidEmail });
      return;
    }

    setLoading(true);
    try {
      const res = await api.forgotPassword(email.trim());
      setEmailSentNotice(res.message);
      if (res.dev_code) {
        setDevCodeHint(res.dev_code);
        setResetCode(res.dev_code);
      }
      setForgotStep(1);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
      } else {
        setError('Failed to send reset code. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResetConfirm = async () => {
    resetFeedback();
    const nextErrors: Record<string, string> = {};
    if (!resetCode.trim()) nextErrors.code = 'Enter verification code.';
    if (!newPassword) {
      nextErrors.newPassword = 'Enter your new password.';
    } else {
      const strength = checkPasswordStrength(newPassword);
      if (!strength.isValid) {
        nextErrors.newPassword = 'Password must meet complexity rules.';
      }
    }
    if (newPassword !== confirmPassword) {
      nextErrors.confirmPassword = 'Passwords do not match.';
    }

    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setLoading(true);
    try {
      const res = await api.resetPassword({
        email: email.trim(),
        code: resetCode.trim(),
        new_password: newPassword,
      });
      setResetSuccess(res.message);
      setIsForgot(false);
      setAuthMethod('signin');
      setPassword('');
      setConfirmPassword('');
      setResetCode('');
      setNewPassword('');
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
      } else {
        setError('Reset failed. Please check the code.');
      }
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // VIEW 1: WELCOME SCREEN (with Exact Hexagon Logo & Corner SVGs)
  // =========================================================================
  if (view === 'welcome') {
    return (
      <View style={styles.canvasSafe}>
        <StatusBar style="dark" />
        {/* Decorative corner accents matching exact coordinates */}
        <View pointerEvents="none" style={styles.cornerTrContainer}>
          <SvgXml xml={cornerTrSvg} width="100%" height="100%" />
        </View>
        <View pointerEvents="none" style={styles.cornerBlContainer}>
          <SvgXml xml={cornerBlSvg} width="100%" height="100%" />
        </View>
        <View pointerEvents="none" style={styles.cornerBrContainer}>
          <SvgXml xml={cornerBrSvg} width="100%" height="100%" />
        </View>

        <ScrollView
          contentContainerStyle={styles.welcomeScroll}
          bounces={false}
          showsVerticalScrollIndicator={false}
        >
          {/* Header Brand */}
          <View style={styles.welcomeHeader}>
            <View style={styles.brandLogoBox}>
              <Image
                source={require('../../assets/ntan-hexagon-logo.png')}
                style={styles.brandLogoImage}
                resizeMode="contain"
                accessibilityIgnoresInvertColors
              />
            </View>
            <Text style={styles.brandTitle}>NTAN</Text>
            <Text style={styles.brandSubtitle}>INVENTORY MANAGEMENT</Text>
            <View style={styles.brandDivider} />
          </View>

          {/* Illustration Section */}
          <View style={styles.welcomeIllustrationBox}>
            <Image
              source={require('../../assets/atelier-illustration.png')}
              style={styles.welcomeIllustration}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
          </View>

          {/* Headline & Subhead */}
          <View style={styles.welcomeTaglineBox}>
            <Text style={styles.welcomeHeadline}>Inventory, simplified.</Text>
            <Text style={styles.welcomeBodyText}>All your stock. One place.</Text>
          </View>

          {/* Actions with Hybrid (Glassmorphic + Neomorphic) Buttons */}
          <View style={styles.welcomeActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Get Started"
              onPress={() => navigateToAuth('create')}
              style={({ pressed }) => [
                styles.hybridCtaButton,
                pressed && styles.hybridCtaButtonPressed,
              ]}
            >
              <Text style={styles.hybridCtaText}>Get Started</Text>
              <SvgXml xml={arrowRightSvg} width={20} height={20} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign In"
              onPress={() => navigateToAuth('signin_join', 'signin')}
              style={({ pressed }) => [
                styles.hybridSecondaryButton,
                pressed && styles.hybridSecondaryButtonPressed,
              ]}
            >
              <Text style={styles.hybridSecondaryText}>Sign In</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    );
  }

  // =========================================================================
  // VIEW 2: AUTHENTICATION SCREEN (Uniform Off-White Background, Instant Tabs)
  // =========================================================================
  return (
    <View style={styles.canvasSafe}>
      <StatusBar style="dark" />
      {/* Exact blue and gold decorative corner assets */}
      <View pointerEvents="none" style={styles.cornerTrContainer}>
        <SvgXml xml={cornerTrSvg} width="100%" height="100%" />
      </View>
      <View pointerEvents="none" style={styles.cornerBlContainer}>
        <SvgXml xml={cornerBlSvg} width="100%" height="100%" />
      </View>
      <View pointerEvents="none" style={styles.cornerBrContainer}>
        <SvgXml xml={cornerBrSvg} width="100%" height="100%" />
      </View>

      <SafeAreaView style={[styles.flex, { zIndex: 10 }]} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          enabled={Platform.OS === 'ios'}
        >
          {/* PERFECTLY CENTERED SCROLL CONTAINER */}
          <ScrollView
            style={styles.authScrollView}
            contentContainerStyle={styles.authScrollCenter}
            keyboardShouldPersistTaps="always"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            {/* Top Logo & Back Action (Exact 56x56 Logo matching Welcome Page) */}
            <View style={styles.authHeaderWrapper}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to Welcome"
                onPress={() => setView('welcome')}
                style={({ pressed }) => [styles.glassBackButton, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons name="arrow-left" size={20} color="#192338" />
              </Pressable>

              <View style={styles.brandLogoBox}>
                <Image
                  source={require('../../assets/ntan-hexagon-logo.png')}
                  style={styles.brandLogoImage}
                  resizeMode="contain"
                  accessibilityIgnoresInvertColors
                />
              </View>
            </View>

            {/* Hybrid (Glassmorphism + Neomorphism) Centered Main Card - UNIFORM OFF-WHITE */}
            <View style={styles.hybridCard}>
              {/* Reset Password View */}
              {isForgot ? (
                <View style={styles.forgotHeader}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setIsForgot(false)}
                    style={styles.forgotBackLink}
                  >
                    <MaterialCommunityIcons name="arrow-left" size={16} color={colors.primary} />
                    <Text style={styles.forgotBackText}>Back to Sign In</Text>
                  </Pressable>
                  <Text style={styles.cardHeaderTitle}>Reset Password</Text>
                </View>
              ) : (
                /* Top Segmented Switcher: [ Sign In or Join ] [ Create Workspace ] */
                <View style={styles.segmentedContainer}>
                  <Pressable
                    accessibilityRole="tab"
                    accessibilityState={{ selected: mainTab === 'signin_join' }}
                    onPress={() => switchTab('signin_join')}
                    style={[
                      styles.segmentedTab,
                      mainTab === 'signin_join' && styles.segmentedTabActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.segmentedTabText,
                        mainTab === 'signin_join' && styles.segmentedTabTextActive,
                      ]}
                    >
                      Sign In or Join
                    </Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="tab"
                    accessibilityState={{ selected: mainTab === 'create' }}
                    onPress={() => switchTab('create')}
                    style={[
                      styles.segmentedTab,
                      mainTab === 'create' && styles.segmentedTabActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.segmentedTabText,
                        mainTab === 'create' && styles.segmentedTabTextActive,
                      ]}
                    >
                      Create Workspace
                    </Text>
                  </Pressable>
                </View>
              )}

              {/* Minimal Step Indicator Line for Create (No bulky words) */}
              {mainTab === 'create' && !isForgot ? (
                <View style={styles.stepProgressLine}>
                  <View
                    style={[
                      styles.stepProgressSegment,
                      styles.stepProgressSegmentActive,
                    ]}
                  />
                  <View
                    style={[
                      styles.stepProgressSegment,
                      registerStep === 1 && styles.stepProgressSegmentActive,
                    ]}
                  />
                </View>
              ) : null}

              {/* Form Content - TRANSPARENT INNER CONTAINER */}
              <View style={styles.formBody}>
                {/* Status Banners */}
                {resetSuccess ? (
                  <View style={styles.statusSuccessBox}>
                    <MaterialCommunityIcons name="check-circle-outline" size={18} color={colors.success} />
                    <Text style={styles.statusSuccessText}>{resetSuccess}</Text>
                  </View>
                ) : null}

                {emailSentNotice ? (
                  <View style={styles.statusInfoBox}>
                    <MaterialCommunityIcons name="email-check-outline" size={18} color={colors.primary} />
                    <Text style={styles.statusInfoText}>{emailSentNotice}</Text>
                  </View>
                ) : null}

                {error ? (
                  <View style={styles.statusErrorBox}>
                    <MaterialCommunityIcons name="alert-circle-outline" size={18} color={colors.danger} />
                    <Text style={styles.statusErrorText}>{error}</Text>
                  </View>
                ) : null}

                {/* =============================================================== */}
                {/* TAB 1: SIGN IN OR JOIN (Professional Labels)                    */}
                {/* =============================================================== */}
                {mainTab === 'signin_join' && !isForgot ? (
                  <>
                    {authMethod === 'signin' ? (
                      /* Sub-mode: Email Sign In */
                      <>
                        <Field
                          label="Email"
                          value={email}
                          onChangeText={setEmail}
                          keyboardType="email-address"
                          autoCapitalize="none"
                          autoComplete="email"
                          textContentType="username"
                          error={fieldErrors.email}
                        />

                        <Field
                          label="Password"
                          value={password}
                          onChangeText={setPassword}
                          secureTextEntry
                          autoComplete="current-password"
                          textContentType="password"
                          error={fieldErrors.password}
                          onSubmitEditing={() => void handleLogin()}
                        />

                        <View style={styles.forgotLinkRow}>
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => setIsForgot(true)}
                            hitSlop={8}
                          >
                            <Text style={styles.forgotText}>Forgot password?</Text>
                          </Pressable>
                        </View>

                        {/* Hybrid CTA Button */}
                        <Pressable
                          accessibilityRole="button"
                          disabled={loading}
                          onPress={() => void handleLogin()}
                          style={({ pressed }) => [
                            styles.hybridCtaButton,
                            styles.fullWidth,
                            pressed && styles.hybridCtaButtonPressed,
                          ]}
                        >
                          {loading ? (
                            <ActivityIndicator color="#F0F4FA" />
                          ) : (
                            <Text style={styles.hybridCtaText}>Sign In</Text>
                          )}
                        </Pressable>

                        {/* Sleek Minimalist Divider */}
                        <View style={styles.dividerRow}>
                          <View style={styles.dividerLine} />
                          <Text style={styles.dividerLabel}>OR</Text>
                          <View style={styles.dividerLine} />
                        </View>

                        {/* Join with Invite Code / QR */}
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => switchAuthMethod('join')}
                          style={({ pressed }) => [
                            styles.hybridJoinButton,
                            pressed && styles.pressed,
                          ]}
                        >
                          <MaterialCommunityIcons name="ticket-confirmation-outline" size={18} color="#1E2E4F" />
                          <Text style={styles.hybridJoinButtonText}>Join with Invitation Code or QR</Text>
                        </Pressable>
                      </>
                    ) : (
                      /* Sub-mode: Join via Code / QR */
                      <>
                        <View style={styles.joinSubHeader}>
                          <Text style={styles.subHeaderTitle}>Join Workspace</Text>
                          <Pressable onPress={() => switchAuthMethod('signin')}>
                            <Text style={styles.switchLink}>Use Email Sign In</Text>
                          </Pressable>
                        </View>

                        {joinStep === 0 ? (
                          <>
                            <View style={styles.inputWithAction}>
                              <View style={styles.flex}>
                                <Field
                                  label="Invitation Code"
                                  value={invitationToken}
                                  onChangeText={setInvitationToken}
                                  autoCapitalize="characters"
                                  autoCorrect={false}
                                  error={fieldErrors.invitation_token}
                                  onSubmitEditing={() => void verifyInvitationCode(invitationToken)}
                                />
                              </View>
                              <Pressable
                                accessibilityRole="button"
                                onPress={() => void handlePasteInvitationCode()}
                                style={({ pressed }) => [styles.pastePill, pressed && styles.pressed]}
                              >
                                <MaterialCommunityIcons name="content-paste" size={15} color={colors.primary} />
                                <Text style={styles.pastePillText}>Paste</Text>
                              </Pressable>
                            </View>

                            <Pressable
                              accessibilityRole="button"
                              onPress={() => void handleOpenScanner()}
                              style={({ pressed }) => [styles.scanQrRow, pressed && styles.pressed]}
                            >
                              <MaterialCommunityIcons name="qrcode-scan" size={18} color={colors.primary} />
                              <Text style={styles.scanQrRowText}>Scan Team QR Code</Text>
                            </Pressable>

                            <Pressable
                              accessibilityRole="button"
                              disabled={loading}
                              onPress={() => void verifyInvitationCode(invitationToken)}
                              style={({ pressed }) => [
                                styles.hybridCtaButton,
                                styles.fullWidth,
                                pressed && styles.hybridCtaButtonPressed,
                              ]}
                            >
                              {loading ? (
                                <ActivityIndicator color="#F0F4FA" />
                              ) : (
                                <Text style={styles.hybridCtaText}>Verify Invitation</Text>
                              )}
                            </Pressable>
                          </>
                        ) : preview ? (
                          <>
                            {/* Invitation Preview Summary - TRANSPARENT UNIFORM BACKGROUND */}
                            <View style={styles.verifiedInviteCard}>
                              <View style={styles.verifiedInviteHeader}>
                                <MaterialCommunityIcons name="check-decagram" size={20} color={colors.primary} />
                                <View style={styles.flex}>
                                  <Text style={styles.verifiedCompanyName}>{preview.company_name}</Text>
                                  <Text style={styles.verifiedEmailText}>Invited: {preview.email}</Text>
                                </View>
                                <View style={styles.roleBadge}>
                                  <Text style={styles.roleBadgeText}>{roleLabel(preview.role)}</Text>
                                </View>
                              </View>
                              <Text style={styles.verifiedExpiryText}>
                                Valid until {formatDateTime(preview.expires_at)}
                              </Text>
                            </View>

                            <Field
                              label="Name"
                              value={name}
                              onChangeText={setName}
                              autoCapitalize="words"
                              textContentType="name"
                              error={fieldErrors.name}
                            />
                            <PhoneField
                              label="Number"
                              value={phone}
                              onChangeText={setPhone}
                              error={fieldErrors.phone}
                            />
                            <Field
                              label="Password"
                              value={password}
                              onChangeText={setPassword}
                              secureTextEntry
                              textContentType="newPassword"
                              error={fieldErrors.password}
                            />
                            {/* Minimalist Progress Line */}
                            <PasswordProgressBar password={password} />

                            <Field
                              label="Confirm Password"
                              value={confirmPassword}
                              onChangeText={setConfirmPassword}
                              secureTextEntry
                              textContentType="newPassword"
                              error={fieldErrors.confirmPassword}
                              onSubmitEditing={() => void handleJoinSubmit()}
                            />

                            <Pressable
                              accessibilityRole="button"
                              disabled={loading}
                              onPress={() => void handleJoinSubmit()}
                              style={({ pressed }) => [
                                styles.hybridCtaButton,
                                styles.fullWidth,
                                pressed && styles.hybridCtaButtonPressed,
                              ]}
                            >
                              {loading ? (
                                <ActivityIndicator color="#F0F4FA" />
                              ) : (
                                <Text style={styles.hybridCtaText}>Activate & Join Workspace</Text>
                              )}
                            </Pressable>

                            <Pressable
                              onPress={() => setJoinStep(0)}
                              style={styles.backStepButton}
                            >
                              <Text style={styles.backStepText}>Back to Invitation Code</Text>
                            </Pressable>
                          </>
                        ) : null}
                      </>
                    )}
                  </>
                ) : null}

                {/* =============================================================== */}
                {/* TAB 2: CREATE WORKSPACE (Professional Labels)                   */}
                {/* =============================================================== */}
                {mainTab === 'create' && !isForgot ? (
                  <>
                    {registerStep === 0 ? (
                      /* Step 1: Admin Credentials */
                      <>
                        <Field
                          label="Name"
                          value={name}
                          onChangeText={setName}
                          autoCapitalize="words"
                          textContentType="name"
                          error={fieldErrors.name}
                        />
                        <Field
                          label="Email"
                          value={email}
                          onChangeText={setEmail}
                          keyboardType="email-address"
                          autoCapitalize="none"
                          textContentType="username"
                          error={fieldErrors.email}
                        />
                        <PhoneField
                          label="Number"
                          value={phone}
                          onChangeText={setPhone}
                          error={fieldErrors.phone}
                        />
                        <Field
                          label="Password"
                          value={password}
                          onChangeText={setPassword}
                          secureTextEntry
                          textContentType="newPassword"
                          error={fieldErrors.password}
                        />
                        {/* Minimalist Progress Line */}
                        <PasswordProgressBar password={password} />

                        <Field
                          label="Confirm Password"
                          value={confirmPassword}
                          onChangeText={setConfirmPassword}
                          secureTextEntry
                          textContentType="newPassword"
                          error={fieldErrors.confirmPassword}
                          onSubmitEditing={handleRegisterAdminContinue}
                        />

                        <Pressable
                          accessibilityRole="button"
                          onPress={handleRegisterAdminContinue}
                          style={({ pressed }) => [
                            styles.hybridCtaButton,
                            styles.fullWidth,
                            pressed && styles.hybridCtaButtonPressed,
                          ]}
                        >
                          <Text style={styles.hybridCtaText}>Continue</Text>
                          <SvgXml xml={arrowRightSvg} width={18} height={18} />
                        </Pressable>
                      </>
                    ) : (
                      /* Step 2: Warehouse Setup with Professional Dropdown Labels */
                      <>
                        <Field
                          label="Company Name"
                          value={companyName}
                          onChangeText={setCompanyName}
                          autoCapitalize="words"
                          error={fieldErrors.company_name}
                        />
                        <Field
                          label="Warehouse Name"
                          value={warehouseName}
                          onChangeText={setWarehouseName}
                          autoCapitalize="words"
                          error={fieldErrors.warehouse_name}
                        />
                        <Field
                          label="Warehouse Code"
                          value={warehouseCode}
                          onChangeText={setWarehouseCode}
                          autoCapitalize="characters"
                          error={fieldErrors.warehouse_code}
                        />
                        <Field
                          label="Warehouse Address"
                          value={warehouseAddress}
                          onChangeText={setWarehouseAddress}
                          autoCapitalize="words"
                          error={fieldErrors.warehouse_address}
                        />

                        {/* DROPDOWN 1: Warehouse Type */}
                        <InlineGlassDropdown
                          label="Warehouse Type"
                          value={warehouseType}
                          options={WAREHOUSE_TYPES}
                          onSelect={setWarehouseType}
                        />

                        {/* DROPDOWN 2: Storage Layout */}
                        <InlineGlassDropdown
                          label="Storage Layout"
                          value={warehouseLayout}
                          options={WAREHOUSE_LAYOUTS}
                          onSelect={setWarehouseLayout}
                        />

                        {warehouseLayout === 'all_in_one' ? (
                          <Field
                            label="Floor Location Code"
                            value={locationCode}
                            onChangeText={setLocationCode}
                            autoCapitalize="characters"
                          />
                        ) : null}

                        <Pressable
                          accessibilityRole="button"
                          disabled={loading}
                          onPress={() => void handleRegisterSubmit()}
                          style={({ pressed }) => [
                            styles.hybridCtaButton,
                            styles.fullWidth,
                            pressed && styles.hybridCtaButtonPressed,
                          ]}
                        >
                          {loading ? (
                            <ActivityIndicator color="#F0F4FA" />
                          ) : (
                            <Text style={styles.hybridCtaText}>Launch Workspace</Text>
                          )}
                        </Pressable>

                        <Pressable
                          onPress={() => setRegisterStep(0)}
                          style={styles.backStepButton}
                        >
                          <Text style={styles.backStepText}>Back to Previous Step</Text>
                        </Pressable>
                      </>
                    )}
                  </>
                ) : null}

                {/* =============================================================== */}
                {/* FORGOT PASSWORD                                                 */}
                {/* =============================================================== */}
                {isForgot ? (
                  <>
                    {forgotStep === 0 ? (
                      <>
                        <Field
                          label="Email"
                          value={email}
                          onChangeText={setEmail}
                          keyboardType="email-address"
                          autoCapitalize="none"
                          error={fieldErrors.email}
                          onSubmitEditing={() => void handleForgotRequest()}
                        />
                        <Pressable
                          accessibilityRole="button"
                          disabled={loading}
                          onPress={() => void handleForgotRequest()}
                          style={({ pressed }) => [
                            styles.hybridCtaButton,
                            styles.fullWidth,
                            pressed && styles.hybridCtaButtonPressed,
                          ]}
                        >
                          {loading ? (
                            <ActivityIndicator color="#F0F4FA" />
                          ) : (
                            <Text style={styles.hybridCtaText}>Send Reset Code</Text>
                          )}
                        </Pressable>
                      </>
                    ) : (
                      <>
                        {devCodeHint ? (
                          <View style={styles.statusInfoBox}>
                            <MaterialCommunityIcons name="developer-board" size={16} color={colors.primary} />
                            <Text style={styles.statusInfoText}>
                              Dev Code: <Text style={styles.bold}>{devCodeHint}</Text>
                            </Text>
                          </View>
                        ) : null}

                        <Field
                          label="Verification Code"
                          value={resetCode}
                          onChangeText={setResetCode}
                          keyboardType="number-pad"
                          error={fieldErrors.code}
                        />
                        <Field
                          label="New Password"
                          value={newPassword}
                          onChangeText={setNewPassword}
                          secureTextEntry
                          error={fieldErrors.newPassword}
                        />
                        <PasswordProgressBar password={newPassword} />
                        <Field
                          label="Confirm Password"
                          value={confirmPassword}
                          onChangeText={setConfirmPassword}
                          secureTextEntry
                          error={fieldErrors.confirmPassword}
                          onSubmitEditing={() => void handleResetConfirm()}
                        />

                        <Pressable
                          accessibilityRole="button"
                          disabled={loading}
                          onPress={() => void handleResetConfirm()}
                          style={({ pressed }) => [
                            styles.hybridCtaButton,
                            styles.fullWidth,
                            pressed && styles.hybridCtaButtonPressed,
                          ]}
                        >
                          {loading ? (
                            <ActivityIndicator color="#F0F4FA" />
                          ) : (
                            <Text style={styles.hybridCtaText}>Update Password & Sign In</Text>
                          )}
                        </Pressable>

                        <Pressable
                          onPress={() => setForgotStep(0)}
                          style={styles.backStepButton}
                        >
                          <Text style={styles.backStepText}>Use a different email</Text>
                        </Pressable>
                      </>
                    )}
                  </>
                ) : null}
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* QR Code Scanner Modal */}
      <Modal
        visible={scannerOpen}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setScannerOpen(false)}
      >
        <SafeAreaView style={styles.scannerRoot}>
          <View style={styles.scannerHeader}>
            <Text style={styles.scannerTitle}>Scan Invitation QR Code</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setScannerOpen(false)}
              style={styles.scannerClose}
            >
              <MaterialCommunityIcons name="close" size={24} color={colors.white} />
            </Pressable>
          </View>

          <View style={styles.cameraBox}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128'] }}
              onBarcodeScanned={handleBarcodeScanned}
            />
            <View style={styles.targetFrame}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
            </View>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  fullWidth: {
    width: '100%',
    maxWidth: '100%',
  },
  bold: {
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.985 }],
  },

  // Background Canvas
  canvasSafe: {
    flex: 1,
    backgroundColor: '#EFF3F8',
    position: 'relative',
  },
  cornerTrContainer: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 412,
    height: 212,
    zIndex: 0,
    pointerEvents: 'none',
  },
  cornerBlContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: 206,
    height: 106,
    zIndex: 0,
    pointerEvents: 'none',
  },
  cornerBrContainer: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 124,
    height: 64,
    zIndex: 0,
    pointerEvents: 'none',
  },

  // Welcome Screen
  welcomeScroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: Math.max(Dimensions.get('window').height * 0.12, 100),
    paddingBottom: Math.max(Dimensions.get('window').height * 0.04, 30),
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 1,
  },
  welcomeHeader: {
    alignItems: 'center',
    width: '100%',
  },
  brandLogoBox: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    backgroundColor: 'transparent',
    shadowColor: '#192338',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
  },
  brandLogoImage: {
    width: 56,
    height: 56,
  },
  brandTitle: {
    fontFamily: fonts.outfitExtraBold,
    fontSize: 30,
    color: '#192338',
    letterSpacing: 6,
    textAlign: 'center',
    fontWeight: '800',
    lineHeight: 38,
  },
  brandSubtitle: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 11,
    color: '#31487A',
    letterSpacing: 3,
    marginTop: 8,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  brandDivider: {
    width: 40,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#8FB3E2',
    marginTop: 22,
  },
  welcomeIllustrationBox: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
  },
  welcomeIllustration: {
    width: Dimensions.get('window').width * 0.95,
    height: Dimensions.get('window').width * 0.95 * 0.87,
    maxHeight: 360,
  },
  welcomeTaglineBox: {
    alignItems: 'center',
    marginBottom: 26,
  },
  welcomeHeadline: {
    fontFamily: fonts.outfitBold,
    fontSize: 28,
    color: '#192338',
    textAlign: 'center',
    fontWeight: '700',
    lineHeight: 38,
  },
  welcomeBodyText: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 14,
    color: '#31487A',
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 22,
  },
  welcomeActions: {
    width: '100%',
    alignItems: 'center',
    gap: 16,
  },

  // Hybrid Glassmorphism + Neomorphism Buttons
  hybridCtaButton: {
    width: '100%',
    height: 52,
    borderRadius: 26,
    backgroundColor: '#192338',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderTopWidth: 2,
    borderTopColor: 'rgba(255, 255, 255, 0.38)',
    borderBottomWidth: 1.5,
    borderBottomColor: 'rgba(0, 0, 0, 0.35)',
    shadowColor: '#192338',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 6,
  },
  hybridCtaButtonPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.985 }],
  },
  hybridCtaText: {
    fontFamily: fonts.outfitBold,
    fontSize: 15,
    color: '#F0F4FA',
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  hybridSecondaryButton: {
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#1E2E4F',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
  },
  hybridSecondaryButtonPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.985 }],
  },
  hybridSecondaryText: {
    fontFamily: fonts.dmSansBold,
    fontSize: 14,
    color: '#1E2E4F',
    textAlign: 'center',
    letterSpacing: 0.3,
  },

  // Centered Auth Screen Layout & Senior Spacing
  authScrollView: {
    flex: 1,
    width: '100%',
  },
  authScrollCenter: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  authHeaderWrapper: {
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    position: 'relative',
  },
  glassBackButton: {
    position: 'absolute',
    left: 0,
    top: 6,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FCFDFE',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1E2E4F',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
    zIndex: 10,
  },

  // Hybrid Glassmorphism + Neomorphism Main Card (Smooth, Uniform Off-White)
  hybridCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#FCFDFE',
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 24,
    paddingVertical: 26,
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 6,
  },

  // Segmented Switcher (Sunken glass trough + Raised convex active pill)
  segmentedContainer: {
    flexDirection: 'row',
    height: 48,
    backgroundColor: 'rgba(226, 235, 246, 0.75)',
    borderRadius: 24,
    padding: 4,
    marginBottom: 20,
    borderWidth: 1.2,
    borderColor: 'rgba(205, 220, 240, 0.65)',
  },
  segmentedTab: {
    flex: 1,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentedTabActive: {
    backgroundColor: '#192338',
    borderTopWidth: 1.5,
    borderTopColor: '#FFBF32',
    shadowColor: '#192338',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  segmentedTabText: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
  },
  segmentedTabTextActive: {
    fontFamily: fonts.dmSansBold,
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // Minimal Step Progress Line (Wordless)
  stepProgressLine: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
    paddingHorizontal: 2,
  },
  stepProgressSegment: {
    flex: 1,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: '#E2E8F0',
  },
  stepProgressSegmentActive: {
    backgroundColor: colors.primary,
  },

  // Form Body (Transparent so outer card shows through uniformly)
  formBody: {
    backgroundColor: 'transparent',
    gap: 16,
  },
  forgotLinkRow: {
    alignItems: 'flex-end',
    marginTop: -6,
    marginBottom: 2,
  },
  forgotText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
  },

  // Minimalist Password Progress Bar
  passwordProgressRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: -8,
    marginBottom: 2,
    paddingHorizontal: 2,
  },
  passwordProgressSegment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E2E8F0',
  },

  // Divider between Sign In and Join
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(203, 213, 225, 0.7)',
  },
  dividerLabel: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '700',
    letterSpacing: 1,
  },

  // Join Secondary Button (Hybrid Glass)
  hybridJoinButton: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 24,
    backgroundColor: 'rgba(241, 245, 249, 0.85)',
    borderWidth: 1.2,
    borderColor: '#CBD5E1',
  },
  hybridJoinButtonText: {
    fontSize: 13,
    color: '#1E2E4F',
    fontWeight: '600',
  },

  // Join Sub-header
  joinSubHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  subHeaderTitle: {
    fontSize: 15,
    color: '#192338',
    fontWeight: '700',
  },
  switchLink: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
  },

  // Input with Paste Action
  inputWithAction: {
    position: 'relative',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  pastePill: {
    position: 'absolute',
    right: 12,
    top: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  pastePillText: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '700',
  },
  scanQrRow: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(238, 242, 255, 0.7)',
    borderWidth: 1.2,
    borderColor: '#C7D2FE',
  },
  scanQrRowText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
  },

  // Verified Invite Card (Transparent - Uniform with outer card)
  verifiedInviteCard: {
    backgroundColor: 'transparent',
    borderRadius: 14,
    borderWidth: 1.2,
    borderColor: '#CBD5E1',
    padding: 14,
    gap: 6,
  },
  verifiedInviteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  verifiedCompanyName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  verifiedEmailText: {
    fontSize: 12,
    color: '#64748B',
  },
  roleBadge: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  verifiedExpiryText: {
    fontSize: 11,
    color: '#94A3B8',
  },

  // CUSTOM INLINE GLASS DROPDOWN STYLES
  dropdownGroup: {
    gap: 6,
    backgroundColor: 'transparent',
  },
  fieldLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.navy,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  dropdownTrigger: {
    height: 50,
    borderRadius: 14,
    borderWidth: 1.2,
    borderColor: '#CBD5E1',
    backgroundColor: 'rgba(241, 245, 249, 0.7)',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownTriggerActive: {
    backgroundColor: '#FFFFFF',
    borderColor: colors.primary,
    borderWidth: 1.5,
  },
  dropdownTriggerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  dropdownTriggerText: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: '#0F172A',
  },
  dropdownMenu: {
    borderRadius: 14,
    borderWidth: 1.2,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    marginTop: 4,
    shadowColor: '#1E2E4F',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  dropdownMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  dropdownMenuItemSelected: {
    backgroundColor: 'rgba(238, 242, 255, 0.5)',
  },
  dropdownMenuItemLast: {
    borderBottomWidth: 0,
  },
  dropdownMenuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  dropdownMenuItemTextCol: {
    flex: 1,
  },
  dropdownMenuItemTitle: {
    fontFamily: fonts.dmSansBold,
    fontSize: 13,
    color: '#1E293B',
    fontWeight: '700',
  },
  dropdownMenuItemTitleSelected: {
    color: colors.primary,
  },
  dropdownMenuItemDetail: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },

  // Back Step Button
  backStepButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  backStepText: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
  },

  // Status Boxes
  statusSuccessBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 12,
    padding: 12,
  },
  statusSuccessText: {
    flex: 1,
    fontSize: 13,
    color: '#065F46',
  },
  statusInfoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 12,
    padding: 12,
  },
  statusInfoText: {
    flex: 1,
    fontSize: 13,
    color: '#1E40AF',
  },
  statusErrorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    padding: 12,
  },
  statusErrorText: {
    flex: 1,
    fontSize: 13,
    color: '#991B1B',
  },

  // Forgot Header
  forgotHeader: {
    marginBottom: 16,
    gap: 4,
  },
  forgotBackLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  forgotBackText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
  },
  cardHeaderTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#192338',
  },

  // Camera Scanner Modal
  scannerRoot: {
    flex: 1,
    backgroundColor: '#000000',
  },
  scannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  scannerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  scannerClose: {
    padding: 6,
  },
  cameraBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  targetFrame: {
    width: 250,
    height: 250,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderColor: '#FBCC00',
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
  },
});
