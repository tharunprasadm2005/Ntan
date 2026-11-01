export const palette = {
  canvas: '#EFF3F8',
  canvasDeep: '#E7EDF5',
  ink: '#192338',
  inkSoft: '#31487A',
  muted: '#61738B',
  line: '#DFE8F2',
  glass: 'rgba(252, 253, 254, 0.92)',
  glassStrong: '#FCFDFE',
  glassBorder: 'rgba(255, 255, 255, 0.95)',
  gold: '#F5C542',
  goldSoft: '#FFF6D8',
  blue: '#2E5BBF',
  blueSoft: '#EAF1FC',
  white: '#FFFFFF',
};

export const colors = {
  primary: '#192338',
  navy: '#192338',
  dark: '#192338',
  deep: '#2E5BBF',
  accent: '#F5C542',
  surface: '#EFF3F8',
  text: '#192338',
  muted: '#61738B',
  border: '#DFE8F2',
  white: '#FFFFFF',
  success: '#1F7A5C',
  successSoft: '#E6F4EE',
  warning: '#9A6A00',
  warningSoft: '#FFF5D6',
  danger: '#B42318',
  dangerSoft: '#FDECEA',
};

export const fonts = {
  heading: 'Outfit_700Bold',
  headingSemi: 'Outfit_600SemiBold',
  body: 'DMSans_400Regular',
  bodySemi: 'DMSans_500Medium',
  bodyBold: 'DMSans_700Bold',
  outfitBold: 'Outfit_700Bold',
  outfitExtraBold: 'Outfit_800ExtraBold',
  dmSansRegular: 'DMSans_400Regular',
  dmSansMedium: 'DMSans_500Medium',
  dmSansBold: 'DMSans_700Bold',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 26,
  xxl: 32,
  pill: 999,
};

/** Hybrid elevation: a deep soft shadow plus a light top highlight. */
export const neo = {
  raised: {
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 6,
  },
  soft: {
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 3,
  },
  float: {
    shadowColor: '#102A54',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 8,
  },
};

/** Backwards-compatible alias used by existing screens. */
export const shadow = neo.soft;

export const type = {
  display: {
    fontFamily: fonts.outfitExtraBold,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -0.6,
    color: palette.ink,
  },
  h1: {
    fontFamily: fonts.outfitBold,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.3,
    color: palette.ink,
  },
  h2: {
    fontFamily: fonts.outfitBold,
    fontSize: 20,
    lineHeight: 26,
    color: palette.ink,
  },
  h3: {
    fontFamily: fonts.dmSansBold,
    fontSize: 15,
    lineHeight: 21,
    color: palette.ink,
  },
  body: {
    fontFamily: fonts.dmSansRegular,
    fontSize: 14,
    lineHeight: 21,
    color: palette.inkSoft,
  },
  caption: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 12,
    lineHeight: 17,
    color: palette.muted,
  },
  label: {
    fontFamily: fonts.dmSansMedium,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase' as const,
    color: palette.muted,
  },
};
