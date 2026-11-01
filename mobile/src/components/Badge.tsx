import { StyleSheet, Text, View } from 'react-native';

import { fonts, palette, radius } from '../theme';

type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

const toneStyles = {
  success: { backgroundColor: 'rgba(230,244,238,0.9)', color: '#1F7A5C', borderColor: 'rgba(31,122,92,0.14)' },
  warning: { backgroundColor: 'rgba(255,245,214,0.95)', color: '#8A6100', borderColor: 'rgba(154,106,0,0.14)' },
  danger: { backgroundColor: 'rgba(253,236,234,0.95)', color: '#B42318', borderColor: 'rgba(180,35,24,0.14)' },
  neutral: { backgroundColor: 'rgba(238,243,248,0.9)', color: palette.muted, borderColor: palette.glassBorder },
  info: { backgroundColor: 'rgba(234,241,252,0.95)', color: palette.blue, borderColor: 'rgba(46,91,191,0.12)' },
};

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const entry = toneStyles[tone];
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: entry.backgroundColor, borderColor: entry.borderColor },
      ]}
    >
      <Text style={[styles.label, { color: entry.color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  label: {
    fontFamily: fonts.dmSansBold,
    fontSize: 9.5,
    textTransform: 'uppercase',
    letterSpacing: 0.9,
  },
});
