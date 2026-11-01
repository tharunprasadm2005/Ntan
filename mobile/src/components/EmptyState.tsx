import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { StyleSheet, Text, View } from 'react-native';

import { fonts, neo, palette, radius, spacing } from '../theme';
import { Button } from './Button';

interface EmptyStateProps {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon,
  title,
  message,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <View style={styles.icon}>
        <MaterialCommunityIcons name={icon} size={26} color={palette.ink} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} style={styles.button} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
    backgroundColor: palette.glass,
    borderRadius: radius.xl,
    borderWidth: 1.2,
    borderColor: palette.glassBorder,
    ...neo.raised,
  },
  icon: {
    width: 58,
    height: 58,
    borderRadius: 22,
    backgroundColor: '#EDF2F9',
    borderWidth: 1,
    borderColor: palette.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
    ...neo.soft,
  },
  title: {
    fontFamily: fonts.outfitBold,
    fontSize: 18,
    color: palette.ink,
    textAlign: 'center',
  },
  message: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 13,
    lineHeight: 20,
    color: palette.muted,
    textAlign: 'center',
    maxWidth: 300,
  },
  button: {
    marginTop: spacing.md,
    alignSelf: 'stretch',
  },
});
