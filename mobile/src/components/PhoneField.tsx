import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fonts, radius, spacing } from '../theme';

export interface CountryCodeItem {
  code: string;
  name: string;
  dialCode: string;
  flag: string;
}

export const COUNTRY_CODES: CountryCodeItem[] = [
  { code: 'IN', name: 'India', dialCode: '+91', flag: '🇮🇳' },
  { code: 'US', name: 'United States', dialCode: '+1', flag: '🇺🇸' },
  { code: 'GB', name: 'United Kingdom', dialCode: '+44', flag: '🇬🇧' },
  { code: 'AE', name: 'United Arab Emirates', dialCode: '+971', flag: '🇦🇪' },
  { code: 'SA', name: 'Saudi Arabia', dialCode: '+966', flag: '🇸🇦' },
  { code: 'SG', name: 'Singapore', dialCode: '+65', flag: '🇸🇬' },
  { code: 'AU', name: 'Australia', dialCode: '+61', flag: '🇦🇺' },
  { code: 'CA', name: 'Canada', dialCode: '+1', flag: '🇨🇦' },
  { code: 'DE', name: 'Germany', dialCode: '+49', flag: '🇩🇪' },
  { code: 'FR', name: 'France', dialCode: '+33', flag: '🇫🇷' },
  { code: 'QA', name: 'Qatar', dialCode: '+974', flag: '🇶🇦' },
  { code: 'KW', name: 'Kuwait', dialCode: '+965', flag: '🇰🇼' },
  { code: 'OM', name: 'Oman', dialCode: '+968', flag: '🇴🇲' },
  { code: 'BH', name: 'Bahrain', dialCode: '+973', flag: '🇧🇭' },
  { code: 'MY', name: 'Malaysia', dialCode: '+60', flag: '🇲🇾' },
  { code: 'PH', name: 'Philippines', dialCode: '+63', flag: '🇵🇭' },
  { code: 'ID', name: 'Indonesia', dialCode: '+62', flag: '🇮🇩' },
  { code: 'ZA', name: 'South Africa', dialCode: '+27', flag: '🇿🇦' },
  { code: 'NG', name: 'Nigeria', dialCode: '+234', flag: '🇳🇬' },
  { code: 'KE', name: 'Kenya', dialCode: '+254', flag: '🇰🇪' },
  { code: 'EG', name: 'Egypt', dialCode: '+20', flag: '🇪🇬' },
  { code: 'NL', name: 'Netherlands', dialCode: '+31', flag: '🇳🇱' },
  { code: 'IT', name: 'Italy', dialCode: '+39', flag: '🇮🇹' },
  { code: 'ES', name: 'Spain', dialCode: '+34', flag: '🇪🇸' },
  { code: 'CH', name: 'Switzerland', dialCode: '+41', flag: '🇨🇭' },
  { code: 'SE', name: 'Sweden', dialCode: '+46', flag: '🇸🇪' },
  { code: 'NO', name: 'Norway', dialCode: '+47', flag: '🇳🇴' },
  { code: 'DK', name: 'Denmark', dialCode: '+45', flag: '🇩🇰' },
  { code: 'IE', name: 'Ireland', dialCode: '+353', flag: '🇮🇪' },
  { code: 'NZ', name: 'New Zealand', dialCode: '+64', flag: '🇳🇿' },
  { code: 'JP', name: 'Japan', dialCode: '+81', flag: '🇯🇵' },
  { code: 'KR', name: 'South Korea', dialCode: '+82', flag: '🇰🇷' },
  { code: 'CN', name: 'China', dialCode: '+86', flag: '🇨🇳' },
  { code: 'BR', name: 'Brazil', dialCode: '+55', flag: '🇧🇷' },
  { code: 'MX', name: 'Mexico', dialCode: '+52', flag: '🇲🇽' },
  { code: 'LK', name: 'Sri Lanka', dialCode: '+94', flag: '🇱🇰' },
  { code: 'BD', name: 'Bangladesh', dialCode: '+880', flag: '🇧🇩' },
  { code: 'PK', name: 'Pakistan', dialCode: '+92', flag: '🇵🇰' },
  { code: 'NP', name: 'Nepal', dialCode: '+977', flag: '🇳🇵' },
];

interface PhoneFieldProps {
  label: string;
  value: string;
  onChangeText: (fullNumber: string) => void;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  defaultCountryCode?: string;
}

export function PhoneField({
  label,
  value,
  onChangeText,
  placeholder = '',
  error,
  disabled = false,
  defaultCountryCode = '+91',
}: PhoneFieldProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [focused, setFocused] = useState(false);

  // Parse existing value if it starts with a known dial code
  const { initialDialCode, initialDigits } = useMemo(() => {
    const trimmed = (value || '').trim();
    if (!trimmed) {
      return { initialDialCode: defaultCountryCode, initialDigits: '' };
    }
    // Match against longest dial code first
    const sorted = [...COUNTRY_CODES].sort(
      (a, b) => b.dialCode.length - a.dialCode.length,
    );
    for (const c of sorted) {
      if (trimmed.startsWith(c.dialCode)) {
        const digits = trimmed.slice(c.dialCode.length).trim();
        return { initialDialCode: c.dialCode, initialDigits: digits };
      }
    }
    // If it doesn't match any dial code, assume raw subscriber digits
    return { initialDialCode: defaultCountryCode, initialDigits: trimmed };
  }, [value, defaultCountryCode]);

  const [selectedDialCode, setSelectedDialCode] = useState(initialDialCode);

  const selectedCountry = useMemo(() => {
    return (
      COUNTRY_CODES.find((c) => c.dialCode === selectedDialCode) ||
      COUNTRY_CODES[0]
    );
  }, [selectedDialCode]);

  const handleDigitsChange = (text: string) => {
    const cleanDigits = text.replace(/[^\d\s-]/g, '');
    if (!cleanDigits.trim()) {
      onChangeText('');
    } else {
      onChangeText(`${selectedCountry.dialCode} ${cleanDigits.trim()}`);
    }
  };

  const handleSelectCountry = (country: CountryCodeItem) => {
    setSelectedDialCode(country.dialCode);
    setModalOpen(false);
    setSearch('');
    if (initialDigits.trim()) {
      onChangeText(`${country.dialCode} ${initialDigits.trim()}`);
    }
  };

  const filteredCountries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return COUNTRY_CODES;
    return COUNTRY_CODES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dialCode.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q),
    );
  }, [search]);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View
        style={[
          styles.inputRow,
          focused && styles.inputFocused,
          error ? styles.inputError : null,
          disabled && styles.inputDisabled,
        ]}
      >
        {/* Country Code Trigger */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Select country code"
          disabled={disabled}
          onPress={() => setModalOpen(true)}
          style={({ pressed }) => [
            styles.countryTrigger,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.flagText}>{selectedCountry.flag}</Text>
          <Text style={styles.dialCodeText}>{selectedCountry.dialCode}</Text>
          <MaterialCommunityIcons
            name="chevron-down"
            size={18}
            color={colors.muted}
          />
        </Pressable>

        <View style={styles.divider} />

        {/* Subscriber Number Input */}
        <TextInput
          value={initialDigits}
          onChangeText={handleDigitsChange}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          editable={!disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          selectionColor={colors.primary}
          style={styles.numberInput}
        />
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {/* Country Code Selection Modal */}
      <Modal
        visible={modalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setModalOpen(false);
          setSearch('');
        }}
      >
        <View style={styles.modalRoot}>
          <Pressable
            style={styles.backdrop}
            onPress={() => {
              setModalOpen(false);
              setSearch('');
            }}
          />
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>Select Country Code</Text>
                <Text style={styles.sheetSubtitle}>
                  Choose your telephone dialing code
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => {
                  setModalOpen(false);
                  setSearch('');
                }}
                style={styles.closeBtn}
              >
                <MaterialCommunityIcons
                  name="close"
                  size={22}
                  color={colors.navy}
                />
              </Pressable>
            </View>

            {/* Search Box */}
            <View style={styles.searchBox}>
              <MaterialCommunityIcons
                name="magnify"
                size={20}
                color={colors.muted}
              />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search country or code (e.g. India, +91)..."
                placeholderTextColor={colors.muted}
                autoCorrect={false}
                autoCapitalize="none"
                style={styles.searchInput}
              />
              {search ? (
                <Pressable onPress={() => setSearch('')} hitSlop={8}>
                  <MaterialCommunityIcons
                    name="close-circle"
                    size={18}
                    color={colors.muted}
                  />
                </Pressable>
              ) : null}
            </View>

            <FlatList
              data={filteredCountries}
              keyExtractor={(item) => `${item.code}-${item.dialCode}`}
              style={styles.countryList}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const isSelected = item.dialCode === selectedDialCode;
                return (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => handleSelectCountry(item)}
                    style={({ pressed }) => [
                      styles.countryItem,
                      isSelected && styles.countryItemActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.itemFlag}>{item.flag}</Text>
                    <View style={styles.itemInfo}>
                      <Text
                        style={[
                          styles.itemName,
                          isSelected && styles.itemNameActive,
                        ]}
                      >
                        {item.name}
                      </Text>
                      <Text style={styles.itemIso}>({item.code})</Text>
                    </View>
                    <Text
                      style={[
                        styles.itemDial,
                        isSelected && styles.itemDialActive,
                      ]}
                    >
                      {item.dialCode}
                    </Text>
                    {isSelected ? (
                      <MaterialCommunityIcons
                        name="check"
                        size={18}
                        color={colors.primary}
                        style={{ marginLeft: spacing.sm }}
                      />
                    ) : null}
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>
                    No country found matching &ldquo;{search}&rdquo;
                  </Text>
                </View>
              }
            />
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  label: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.dark,
    marginBottom: spacing.xs,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(241, 245, 249, 0.7)',
    borderWidth: 1.2,
    borderColor: '#CBD5E1',
    borderRadius: 14,
    height: 50,
    paddingHorizontal: spacing.sm,
  },
  inputFocused: {
    backgroundColor: '#FFFFFF',
    borderColor: colors.primary,
    borderWidth: 1.5,
  },
  inputError: {
    borderColor: colors.danger,
    borderWidth: 1.5,
  },
  inputDisabled: {
    backgroundColor: colors.surface,
    opacity: 0.7,
  },
  countryTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  flagText: {
    fontSize: 20,
    marginRight: 6,
  },
  dialCodeText: {
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.text,
    marginRight: 4,
  },
  divider: {
    width: 1,
    height: 26,
    backgroundColor: colors.border,
    marginHorizontal: spacing.sm,
  },
  numberInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.text,
    height: '100%',
    paddingVertical: 0,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.danger,
    marginTop: spacing.xs,
  },
  pressed: {
    opacity: 0.75,
  },
  // Modal Sheet
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  backdrop: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '75%',
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  sheetTitle: {
    fontFamily: fonts.heading,
    fontSize: 18,
    color: colors.navy,
  },
  sheetSubtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  closeBtn: {
    padding: spacing.xs,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 42,
    marginBottom: spacing.md,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.text,
    marginLeft: spacing.xs,
    paddingVertical: 0,
  },
  countryList: {
    marginBottom: spacing.md,
  },
  countryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
    borderRadius: radius.sm,
  },
  countryItemActive: {
    backgroundColor: colors.surface,
  },
  itemFlag: {
    fontSize: 22,
    marginRight: spacing.md,
  },
  itemInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemName: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.text,
    marginRight: 6,
  },
  itemNameActive: {
    fontFamily: fonts.bodySemi,
    color: colors.primary,
  },
  itemIso: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  itemDial: {
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.primary,
  },
  itemDialActive: {
    fontWeight: '700',
  },
  emptyContainer: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
  },
});
