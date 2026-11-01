import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { fonts, neo, palette, radius, spacing } from '../theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'accent' ? palette.ink : palette.white} />
      ) : (
        <Text style={[styles.label, styles[`${variant}Label`]]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  primary: {
    backgroundColor: palette.ink,
    borderTopWidth: 1.6,
    borderTopColor: 'rgba(255,255,255,0.34)',
    borderBottomWidth: 1.2,
    borderBottomColor: 'rgba(0,0,0,0.4)',
    ...neo.raised,
  },
  secondary: {
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 1.2,
    borderColor: palette.glassBorder,
    ...neo.soft,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  danger: {
    backgroundColor: 'rgba(253, 236, 234, 0.9)',
    borderWidth: 1.2,
    borderColor: 'rgba(180,35,24,0.16)',
  },
  accent: {
    backgroundColor: palette.gold,
    borderTopWidth: 1.6,
    borderTopColor: 'rgba(255,255,255,0.5)',
    borderBottomWidth: 1.2,
    borderBottomColor: 'rgba(120,86,0,0.3)',
    ...neo.soft,
  },
  pressed: {
    opacity: 0.92,
    transform: [{ scale: 0.985 }],
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    fontFamily: fonts.outfitBold,
    fontSize: 14.5,
    letterSpacing: 0.3,
  },
  primaryLabel: {
    color: palette.white,
  },
  secondaryLabel: {
    color: palette.ink,
  },
  ghostLabel: {
    color: palette.ink,
  },
  dangerLabel: {
    color: '#B42318',
  },
  accentLabel: {
    color: palette.ink,
  },
});
