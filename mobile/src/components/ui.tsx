import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityRole,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { fonts, neo, palette, radius, spacing } from '../theme';

const logo = require('../../assets/ntan-hexagon-logo.png');

export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <View
      style={[
        styles.mark,
        {
          width: size + 12,
          height: size + 12,
          borderRadius: (size + 12) / 2.8,
        },
      ]}
    >
      <Image
        source={logo}
        style={{ width: size, height: size }}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  right,
  onBack,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onBack?: () => void;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.brandRow}>
        <View style={styles.brandLeft}>
          {onBack ? (
            <PressableScale
              onPress={onBack}
              accessibilityLabel="Go back"
              style={styles.backButton}
            >
              <MaterialCommunityIcons name="arrow-left" size={19} color={palette.ink} />
            </PressableScale>
          ) : null}
          <BrandMark size={24} />
          <Text style={styles.wordmark}>NTAN</Text>
          {eyebrow ? (
            <>
              <View style={styles.eyebrowDot} />
              <Text style={styles.eyebrow} numberOfLines={1}>
                {eyebrow}
              </Text>
            </>
          ) : null}
        </View>
        {right ? <View style={styles.headerRight}>{right}</View> : null}
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function GlassCard({
  children,
  style,
  tone = 'default',
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: 'default' | 'ink' | 'quiet';
}) {
  return (
    <View style={[styles.card, tone === 'ink' && styles.cardInk, tone === 'quiet' && styles.cardQuiet, style]}>
      {children}
    </View>
  );
}

export function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

export function IconBubble({
  name,
  tone = 'blue',
  size = 38,
}: {
  name: keyof typeof MaterialCommunityIcons.glyphMap;
  tone?: 'blue' | 'gold' | 'success' | 'danger' | 'ink';
  size?: number;
}) {
  const map = {
    blue: { backgroundColor: palette.blueSoft, color: palette.blue },
    gold: { backgroundColor: palette.goldSoft, color: '#8A6A00' },
    success: { backgroundColor: '#E6F4EE', color: '#1F7A5C' },
    danger: { backgroundColor: '#FDECEA', color: '#B42318' },
    ink: { backgroundColor: '#E9EEF6', color: palette.ink },
  }[tone];
  return (
    <View
      style={[
        styles.iconBubble,
        { width: size, height: size, borderRadius: size / 2.6, backgroundColor: map.backgroundColor },
      ]}
    >
      <MaterialCommunityIcons name={name} size={Math.round(size * 0.48)} color={map.color} />
    </View>
  );
}

export function StatTile({
  label,
  value,
  unit,
  tone = 'default',
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: 'default' | 'warning' | 'danger' | 'quiet';
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
}) {
  return (
    <View
      style={[
        styles.stat,
        tone === 'warning' && styles.statWarning,
        tone === 'danger' && styles.statDanger,
        tone === 'quiet' && styles.statQuiet,
      ]}
    >
      {icon ? (
        <IconBubble
          name={icon}
          tone={tone === 'warning' ? 'gold' : tone === 'danger' ? 'danger' : 'ink'}
          size={28}
        />
      ) : null}
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
        {unit ? <Text style={styles.statUnit}> {unit}</Text> : null}
      </Text>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Fade + lift on mount; keeps lists feeling alive without heavy dependencies. */
export function Reveal({
  children,
  delay = 0,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 460,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [delay, progress]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [14, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** Scale-and-settle press feedback used for cards, icons and CTAs. */
export function PressableScale({
  children,
  onPress,
  style,
  accessibilityLabel,
  accessibilityRole = 'button',
  disabled = false,
  hitSlop,
}: {
  children: React.ReactNode;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  disabled?: boolean;
  hitSlop?: number;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (value: number) =>
    Animated.spring(scale, {
      toValue: value,
      useNativeDriver: true,
      speed: 32,
      bounciness: 4,
    }).start();

  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={hitSlop}
      onPress={onPress}
      onPressIn={() => to(0.965)}
      onPressOut={() => to(1)}
    >
      <Animated.View style={[style, { transform: [{ scale }] }, disabled && styles.disabled]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  mark: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.75)',
    borderWidth: 1,
    borderColor: palette.glassBorder,
    ...neo.soft,
  },
  header: {
    gap: spacing.xs,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  brandLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.glass,
    borderWidth: 1.2,
    borderColor: palette.glassBorder,
    marginRight: 2,
    ...neo.soft,
  },
  wordmark: {
    fontFamily: fonts.outfitExtraBold,
    fontSize: 13,
    letterSpacing: 2.6,
    color: palette.ink,
  },
  eyebrowDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: palette.gold,
  },
  eyebrow: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 10,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: palette.muted,
    flexShrink: 1,
  },
  headerRight: {
    marginLeft: spacing.sm,
  },
  title: {
    fontFamily: fonts.outfitBold,
    fontSize: 27,
    lineHeight: 33,
    letterSpacing: -0.4,
    color: palette.ink,
  },
  subtitle: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 13,
    lineHeight: 19,
    color: palette.muted,
    maxWidth: 340,
  },
  card: {
    backgroundColor: palette.glass,
    borderRadius: radius.xl,
    borderWidth: 1.2,
    borderColor: palette.glassBorder,
    padding: spacing.lg,
    ...neo.raised,
  },
  cardInk: {
    backgroundColor: palette.ink,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  cardQuiet: {
    backgroundColor: 'rgba(255,255,255,0.6)',
    ...neo.soft,
  },
  sectionLabel: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: palette.muted,
  },
  divider: {
    height: 1,
    backgroundColor: palette.line,
  },
  iconBubble: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  stat: {
    flex: 1,
    gap: 2,
    backgroundColor: palette.glassStrong,
    borderRadius: radius.lg,
    borderWidth: 1.1,
    borderColor: palette.glassBorder,
    padding: spacing.md,
    ...neo.soft,
  },
  statWarning: {
    backgroundColor: '#FFFAEA',
    borderColor: '#F4E4B4',
  },
  statDanger: {
    backgroundColor: '#FFF8F7',
    borderColor: '#F3CFCA',
  },
  statQuiet: {
    backgroundColor: 'rgba(255,255,255,0.62)',
  },
  statValue: {
    fontFamily: fonts.outfitBold,
    fontSize: 22,
    color: palette.ink,
    marginTop: 4,
  },
  statUnit: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 11,
    color: palette.muted,
  },
  statLabel: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 10,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: palette.muted,
  },
  disabled: {
    opacity: 0.5,
  },
});
