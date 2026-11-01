import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts } from '../theme';

export type TabKey = 'home' | 'inventory' | 'operations' | 'reports' | 'more';

interface Tab {
  key: TabKey;
  label: string;
  iconActive: keyof typeof MaterialCommunityIcons.glyphMap;
  iconInactive: keyof typeof MaterialCommunityIcons.glyphMap;
  isCenter?: boolean;
}

const tabs: Tab[] = [
  {
    key: 'home',
    label: 'Home',
    iconActive: 'home-variant',
    iconInactive: 'home-variant-outline',
  },
  {
    key: 'inventory',
    label: 'Inventory',
    iconActive: 'package-variant',
    iconInactive: 'package-variant-closed',
  },
  {
    key: 'operations',
    label: 'Operations',
    iconActive: 'format-list-checks',
    iconInactive: 'clipboard-list-outline',
    isCenter: true,
  },
  {
    key: 'reports',
    label: 'Reports',
    iconActive: 'chart-box',
    iconInactive: 'chart-box-outline',
  },
  {
    key: 'more',
    label: 'More',
    iconActive: 'dots-horizontal-circle',
    iconInactive: 'dots-horizontal-circle-outline',
  },
];

export function TabBar({
  active,
  onChange,
}: {
  active: TabKey;
  onChange: (tab: TabKey) => void;
}) {
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, 12);

  return (
    <View style={[styles.floatingWrapper, { paddingBottom: bottomPadding }]}>
      <View style={styles.hybridCapsule}>
        {tabs.map((tab) => {
          const selected = tab.key === active;

          if (tab.isCenter) {
            return (
              <View key={tab.key} style={styles.centerContainer}>
                {/* Elevated Center Dome & Button */}
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  accessibilityLabel={tab.label}
                  onPress={() => onChange(tab.key)}
                  hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
                  style={({ pressed }) => [
                    styles.centerTabButton,
                    pressed && styles.centerButtonPressed,
                  ]}
                >
                  <View
                    style={[
                      styles.centerIconCircle,
                      selected && styles.centerIconCircleActive,
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={selected ? tab.iconActive : tab.iconInactive}
                      size={24}
                      color={selected ? '#FFBF32' : '#F0F4FA'}
                    />
                  </View>
                  <Text
                    style={[
                      styles.centerLabel,
                      selected && styles.centerLabelActive,
                    ]}
                    numberOfLines={1}
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              </View>
            );
          }

          return (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={tab.label}
              onPress={() => onChange(tab.key)}
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
              style={({ pressed }) => [
                styles.tabItem,
                pressed && styles.tabItemPressed,
              ]}
            >
              <MaterialCommunityIcons
                name={selected ? tab.iconActive : tab.iconInactive}
                size={23}
                color={selected ? colors.primary : '#64748B'}
              />
              <Text
                style={[styles.tabLabel, selected && styles.tabLabelActive]}
                numberOfLines={1}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  floatingWrapper: {
    backgroundColor: 'transparent',
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  hybridCapsule: {
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FCFDFE',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    borderTopWidth: 1.8,
    borderTopColor: 'rgba(255, 255, 255, 0.98)',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 6,
  },
  tabItemPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.94 }],
  },
  tabLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    color: '#64748B',
    fontWeight: '600',
  },
  tabLabelActive: {
    color: colors.primary,
    fontWeight: '700',
  },

  // Center Elevated Button (Matching user's reference image)
  centerContainer: {
    flex: 1.15,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    height: '100%',
  },
  centerTabButton: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -16,
    gap: 2,
  },
  centerButtonPressed: {
    transform: [{ scale: 0.92 }],
    opacity: 0.9,
  },
  centerIconCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#1E2E4F',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3.5,
    borderColor: '#FCFDFE',
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.32,
    shadowRadius: 10,
    elevation: 7,
  },
  centerIconCircleActive: {
    backgroundColor: '#192338',
    borderColor: '#FCFDFE',
    borderTopColor: '#FFBF32',
    shadowColor: '#FFBF32',
    shadowOpacity: 0.45,
    shadowRadius: 12,
  },
  centerLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    color: '#64748B',
    fontWeight: '600',
    marginTop: 1,
  },
  centerLabelActive: {
    color: colors.primary,
    fontWeight: '700',
  },
});
