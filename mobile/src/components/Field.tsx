import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { colors, fonts, neo, palette, radius, spacing } from '../theme';

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoCorrect?: boolean;
  error?: string;
  multiline?: boolean;
  autoComplete?: TextInputProps['autoComplete'];
  textContentType?: TextInputProps['textContentType'];
  returnKeyType?: TextInputProps['returnKeyType'];
  onSubmitEditing?: TextInputProps['onSubmitEditing'];
  disabled?: boolean;
  maxLength?: number;
  style?: StyleProp<ViewStyle>;
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  autoCapitalize = 'none',
  autoCorrect,
  error,
  multiline,
  autoComplete,
  textContentType,
  returnKeyType,
  onSubmitEditing,
  disabled = false,
  maxLength,
  style,
}: FieldProps) {
  const [revealed, setRevealed] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<any>(null);
  const canReveal = Boolean(secureTextEntry);

  const handleFocus = () => {
    if (!disabled) {
      inputRef.current?.focus();
    }
  };

  return (
    <View style={[styles.container, style]}>
      <Text
        style={styles.label}
        onPress={handleFocus}
        suppressHighlighting
      >
        {label}
      </Text>
      <Pressable
        onPress={handleFocus}
        style={[
          styles.inputShell,
          multiline && styles.multilineShell,
          focused && styles.inputFocused,
          error && styles.inputError,
          disabled && styles.inputDisabled,
        ]}
      >
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          secureTextEntry={canReveal ? !revealed : undefined}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          autoComplete={autoComplete}
          textContentType={textContentType}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          editable={!disabled}
          multiline={multiline}
          maxLength={maxLength}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel={label}
          accessibilityHint={placeholder}
          accessibilityState={{ disabled }}
          style={[styles.input, multiline && styles.multiline]}
          selectionColor={colors.primary}
        />
        {canReveal ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
            accessibilityState={{ selected: revealed }}
            hitSlop={12}
            onPress={() => setRevealed((current) => !current)}
            style={({ pressed }) => [styles.reveal, pressed && styles.pressed]}
          >
            <MaterialCommunityIcons
              name={revealed ? 'eye-off-outline' : 'eye-outline'}
              size={21}
              color={colors.muted}
            />
          </Pressable>
        ) : null}
      </Pressable>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
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
  inputShell: {
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
  },
  multilineShell: {
    minHeight: 108,
    alignItems: 'flex-start',
  },
  inputFocused: {
    backgroundColor: palette.white,
    borderColor: palette.ink,
    borderWidth: 1.4,
    borderBottomColor: palette.gold,
    ...neo.soft,
  },
  inputError: {
    borderColor: colors.danger,
    borderWidth: 1.4,
  },
  inputDisabled: {
    backgroundColor: 'rgba(238,243,248,0.8)',
    opacity: 0.65,
  },
  input: {
    flex: 1,
    height: '100%',
    minHeight: 48,
    paddingHorizontal: 0,
    paddingVertical: 0,
    fontFamily: fonts.dmSansRegular,
    fontSize: 15,
    color: palette.ink,
  },
  multiline: {
    minHeight: 100,
    paddingTop: spacing.md,
    textAlignVertical: 'top',
  },
  reveal: {
    width: 36,
    height: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  error: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 11.5,
    color: colors.danger,
    marginLeft: 2,
  },
});
