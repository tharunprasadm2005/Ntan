import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fonts, neo, palette, radius, spacing } from '../theme';

export interface SelectOption {
  value: string;
  label: string;
  detail?: string;
}

export function filterSelectOptions(
  options: SelectOption[],
  query: string,
): SelectOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return options;
  }
  return options.filter(
    (option) =>
      option.label.toLowerCase().includes(needle) ||
      (option.detail ?? '').toLowerCase().includes(needle),
  );
}

interface SelectFieldProps {
  label: string;
  value: string | null;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  emptyLabel?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder = 'Select an option',
  error,
  disabled,
  emptyLabel = 'No options available',
  searchable = false,
  searchPlaceholder = 'Search…',
}: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((option) => option.value === value);
  const visibleOptions = searchable ? filterSelectOptions(options, query) : options;
  const close = () => {
    setOpen(false);
    setQuery('');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.control,
          pressed && styles.pressed,
          disabled && styles.disabled,
          error ? styles.controlError : null,
        ]}
      >
        <View style={styles.valueContainer}>
          <Text style={selected ? styles.value : styles.placeholder}>
            {selected?.label ?? placeholder}
          </Text>
          {selected?.detail ? <Text style={styles.detail}>{selected.detail}</Text> : null}
        </View>
        <MaterialCommunityIcons name="chevron-down" size={22} color={colors.muted} />
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={close}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={close} />
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{label}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={close}
                style={styles.closeButton}
              >
                <MaterialCommunityIcons name="close" size={22} color={colors.navy} />
              </Pressable>
            </View>
            {searchable ? (
              <TextInput
                accessibilityLabel={`Search ${label}`}
                value={query}
                onChangeText={setQuery}
                placeholder={searchPlaceholder}
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.search}
              />
            ) : null}
            <FlatList
              data={visibleOptions}
              keyExtractor={(item) => item.value}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Text style={styles.empty}>{emptyLabel}</Text>}
              renderItem={({ item }) => {
                const active = item.value === value;
                return (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      onChange(item.value);
                      close();
                    }}
                    style={({ pressed }) => [
                      styles.option,
                      active && styles.optionActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.optionText}>
                      <Text style={styles.optionLabel}>{item.label}</Text>
                      {item.detail ? <Text style={styles.optionDetail}>{item.detail}</Text> : null}
                    </View>
                    {active ? (
                      <MaterialCommunityIcons
                        name="check-circle"
                        size={22}
                        color={colors.primary}
                      />
                    ) : null}
                  </Pressable>
                );
              }}
            />
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 7,
  },
  label: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 10.5,
    color: palette.inkSoft,
    textTransform: 'uppercase',
    letterSpacing: 1.3,
    marginLeft: 2,
  },
  control: {
    minHeight: 52,
    borderRadius: radius.lg,
    borderWidth: 1.1,
    borderTopColor: 'rgba(148, 168, 194, 0.35)',
    borderBottomColor: palette.glassBorder,
    borderLeftColor: 'rgba(255,255,255,0.8)',
    borderRightColor: 'rgba(255,255,255,0.8)',
    backgroundColor: 'rgba(243, 247, 251, 0.9)',
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  controlError: {
    borderColor: colors.danger,
    borderWidth: 1.4,
  },
  valueContainer: {
    flex: 1,
    gap: 2,
  },
  value: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 15,
    color: palette.ink,
  },
  placeholder: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 15,
    color: palette.muted,
  },
  detail: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 11.5,
    color: palette.muted,
  },
  pressed: {
    opacity: 0.82,
  },
  disabled: {
    opacity: 0.5,
  },
  error: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 11.5,
    color: colors.danger,
    marginLeft: 2,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(16, 32, 56, 0.42)',
  },
  sheet: {
    maxHeight: '78%',
    backgroundColor: palette.canvas,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: palette.glassBorder,
    paddingHorizontal: spacing.lg,
    ...neo.float,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.lg,
  },
  sheetTitle: {
    fontFamily: fonts.outfitBold,
    fontSize: 20,
    color: palette.ink,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.glass,
    borderWidth: 1,
    borderColor: palette.glassBorder,
  },
  list: {
    marginBottom: spacing.md,
  },
  search: {
    minHeight: 48,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.glassBorder,
    backgroundColor: palette.white,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
    fontFamily: fonts.dmSansRegular,
    fontSize: 15,
    color: palette.ink,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
    backgroundColor: palette.glass,
    borderWidth: 1,
    borderColor: palette.glassBorder,
  },
  optionActive: {
    borderColor: palette.ink,
    backgroundColor: palette.white,
  },
  optionText: {
    flex: 1,
    gap: 2,
  },
  optionLabel: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 15,
    color: palette.ink,
  },
  optionDetail: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 11.5,
    color: palette.muted,
  },
  empty: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 14,
    color: palette.muted,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
});
