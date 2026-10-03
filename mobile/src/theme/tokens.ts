// "Night Glass" — a dark, calm palette where colour means "on".
// Idle surfaces stay neutral; a device's accent only lights up when active,
// so the home screen reads at a glance.

export const colors = {
  bg: '#0A0C10',
  bgElevated: '#0F1218',
  surface: '#141821',
  surfaceHigh: '#1B2029',
  border: 'rgba(255,255,255,0.07)',
  borderStrong: 'rgba(255,255,255,0.14)',

  text: '#F3F4F7',
  textDim: '#9096A6',
  textMute: '#5C6272',

  amber: '#FFB547',
  amberDeep: '#FF8A3D',
  mint: '#4FE3C1',
  mintDeep: '#1FB894',
  sky: '#6CB8FF',
  skyDeep: '#3D7BFF',
  violet: '#A48BFF',
  violetDeep: '#7353F5',
  rose: '#FF6B81',

  success: '#3DDC97',
  danger: '#FF5C6C',
  overlay: 'rgba(5,6,9,0.72)',
} as const;

export type Accent = 'amber' | 'mint' | 'sky' | 'violet' | 'rose';

export const accents: Record<Accent, { base: string; deep: string; glow: string }> = {
  amber: { base: colors.amber, deep: colors.amberDeep, glow: 'rgba(255,181,71,0.22)' },
  mint: { base: colors.mint, deep: colors.mintDeep, glow: 'rgba(79,227,193,0.20)' },
  sky: { base: colors.sky, deep: colors.skyDeep, glow: 'rgba(108,184,255,0.22)' },
  violet: { base: colors.violet, deep: colors.violetDeep, glow: 'rgba(164,139,255,0.22)' },
  rose: { base: colors.rose, deep: '#E8435E', glow: 'rgba(255,107,129,0.2)' },
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, xxxl: 40 } as const;
export const radius = { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 } as const;

export const font = {
  light: 'Vazirmatn_300Light',
  regular: 'Vazirmatn_400Regular',
  medium: 'Vazirmatn_500Medium',
  semibold: 'Vazirmatn_600SemiBold',
  bold: 'Vazirmatn_700Bold',
  black: 'Vazirmatn_800ExtraBold',
} as const;

export const type = {
  display: { fontFamily: font.bold, fontSize: 44, lineHeight: 56 },
  h1: { fontFamily: font.bold, fontSize: 26, lineHeight: 38 },
  h2: { fontFamily: font.semibold, fontSize: 19, lineHeight: 30 },
  title: { fontFamily: font.semibold, fontSize: 15, lineHeight: 24 },
  body: { fontFamily: font.regular, fontSize: 14, lineHeight: 23 },
  caption: { fontFamily: font.regular, fontSize: 12, lineHeight: 19 },
  label: { fontFamily: font.medium, fontSize: 11, lineHeight: 16 },
} as const;

export type TypeVariant = keyof typeof type;
