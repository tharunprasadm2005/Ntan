import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { StyleSheet, Text, View } from 'react-native';

import { checkPasswordStrength, type PasswordCriteria, type PasswordStrengthResult } from '../password';
import { colors, fonts, radius, spacing } from '../theme';

export { checkPasswordStrength, type PasswordCriteria, type PasswordStrengthResult };

interface PasswordStrengthProps {
  password: string;
}

export function PasswordStrength({ password }: PasswordStrengthProps) {
  if (!password) {
    return null;
  }

  const { score, label, color, criteria } = checkPasswordStrength(password);

  const criteriaItems = [
    { key: 'length', text: '8+ characters', met: criteria.hasLength },
    { key: 'upper', text: 'Uppercase letter', met: criteria.hasUpper },
    { key: 'lower', text: 'Lowercase letter', met: criteria.hasLower },
    { key: 'number', text: 'At least 1 number', met: criteria.hasNumber },
    { key: 'special', text: 'Special symbol', met: criteria.hasSpecial },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.meterHeader}>
        <View style={styles.bars}>
          {[0, 1, 2, 3].map((index) => {
            const active = index < score;
            return (
              <View
                key={index}
                style={[
                  styles.bar,
                  active && { backgroundColor: color },
                ]}
              />
            );
          })}
        </View>
        <Text style={[styles.label, { color }]}>{label}</Text>
      </View>

      <View style={styles.checklist}>
        {criteriaItems.map((item) => (
          <View key={item.key} style={styles.checkItem}>
            <MaterialCommunityIcons
              name={item.met ? 'check-circle' : 'circle-outline'}
              size={14}
              color={item.met ? colors.success : colors.muted}
            />
            <Text
              style={[
                styles.checkText,
                item.met && styles.checkTextMet,
              ]}
            >
              {item.text}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  meterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  bars: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
    height: 4,
  },
  bar: {
    flex: 1,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: '#E2E8F0',
  },
  label: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    minWidth: 50,
    textAlign: 'right',
  },
  checklist: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  checkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  checkText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  checkTextMet: {
    fontFamily: fonts.bodySemi,
    color: colors.success,
  },
});
