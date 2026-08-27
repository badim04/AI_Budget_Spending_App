/**
 * Design tokens.
 *
 * Dark-first. Money apps are opened in bed, on the bus, and at the checkout
 * counter, so the dark surface is the designed one and light is derived from
 * the same ramps rather than being an inverted afterthought.
 *
 * Three rules make the whole thing hang together:
 *   1. Numbers are the interface. Everything else recedes — surfaces are near
 *      neutral and borders are barely there.
 *   2. Colour never carries meaning alone. Every series colour is paired with a
 *      label, every status colour with an icon and a word.
 *   3. Data colour is earned, chrome colour is chosen. A series hue encodes a
 *      category and cannot be picked for looks; a `feature` fill is behind a
 *      headline figure to draw the eye and encodes nothing, so it can be as
 *      loud as the brand wants.
 *
 * The categorical series palette is the validated eight-hue set: worst adjacent
 * CVD ΔE 9.1 light / 8.4 dark, worst adjacent normal-vision ΔE 19.6 / 19.3,
 * verified against these exact surfaces. Do not add a ninth hue — an unexpected
 * ninth category folds into "Other".
 */

export type ThemeMode = 'light' | 'dark';

// ------------------------------------------------------------------- palette

/** Categorical series colours, assigned in fixed order and never cycled. */
export const SERIES_LIGHT = [
  '#2a78d6', // 1 blue
  '#eb6834', // 2 orange
  '#1baf7a', // 3 aqua
  '#eda100', // 4 yellow
  '#e87ba4', // 5 magenta
  '#008300', // 6 green
  '#4a3aa7', // 7 violet
  '#e34948', // 8 red
] as readonly string[];

export const SERIES_DARK = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
] as readonly string[];

/** Beyond eight series, everything else is one neutral "Other" slot. */
export const OTHER_SERIES = { light: '#8a8880', dark: '#6f6d66' };

const dark = {
  mode: 'dark' as ThemeMode,

  // Surfaces climb toward the viewer: canvas -> card -> raised.
  canvas: '#0b0d12',
  surface: '#12141a',
  surfaceRaised: '#1a1d25',
  surfaceSunken: '#080a0e',
  /** Behind sheets and modals. */
  scrim: 'rgba(3, 5, 8, 0.72)',

  border: '#242832',
  borderStrong: '#333846',
  /** Hairline on top of a coloured fill, to keep adjacent marks separate. */
  markGap: '#12141a',

  textPrimary: '#f2f4f8',
  textSecondary: '#a2a9b8',
  textMuted: '#6b7285',
  textInverse: '#0b0d12',

  /** The single brand accent. Used for the primary action and nothing else. */
  accent: '#5b8cff',
  accentPressed: '#4b78e0',
  accentSubtle: 'rgba(91, 140, 255, 0.14)',
  onAccent: '#08101f',

  // Status. Reserved — never reused as a series colour.
  good: '#2fbe7e',
  goodSubtle: 'rgba(47, 190, 126, 0.14)',
  warning: '#e0a92c',
  warningSubtle: 'rgba(224, 169, 44, 0.14)',
  critical: '#f2616a',
  criticalSubtle: 'rgba(242, 97, 106, 0.14)',
  info: '#59a6f0',
  infoSubtle: 'rgba(89, 166, 240, 0.14)',

  /** Money direction. Deliberately not the same greens/reds as status, so
   *  "an outflow" never reads as "something is wrong". */
  inflow: '#3ecf8e',
  outflow: '#f0f2f6',

  grid: '#1e222b',
  axis: '#2b3040',

  series: SERIES_DARK,
  otherSeries: OTHER_SERIES.dark,

  /**
   * Saturated card fills, for the one or two things a screen is actually about.
   *
   * The rest of this file spends colour sparingly, and that still holds for
   * data: a chart series means something, so it cannot be chosen for looks.
   * These are different — they are chrome, not encoding. A headline figure sits
   * on a solid block of colour so the eye lands on it before anything else,
   * which is the trick every consumer finance app in this market uses and the
   * reason their dashboards feel navigable at a glance.
   *
   * `sheen` is a translucent white laid over the fill to fake the depth a
   * gradient would give. A real gradient needs `expo-linear-gradient`, which is
   * a native dependency, and this app ships JavaScript-only updates to builds
   * that may be older than the change.
   */
  feature: {
    primary: { bg: '#3d5afe', fg: '#ffffff', muted: 'rgba(255,255,255,0.72)' },
    savings: { bg: '#7c4dff', fg: '#ffffff', muted: 'rgba(255,255,255,0.72)' },
    spend: { bg: '#ff5722', fg: '#ffffff', muted: 'rgba(255,255,255,0.76)' },
    calm: { bg: '#00b686', fg: '#00291d', muted: 'rgba(0,41,29,0.66)' },
  },
  sheen: 'rgba(255,255,255,0.10)',
};

const light: typeof dark = {
  mode: 'light',

  canvas: '#f6f7f9',
  surface: '#fcfcfb',
  surfaceRaised: '#ffffff',
  surfaceSunken: '#eef0f4',
  scrim: 'rgba(11, 13, 18, 0.44)',

  border: '#e3e6ec',
  borderStrong: '#cbd0da',
  markGap: '#fcfcfb',

  textPrimary: '#0b0b0b',
  textSecondary: '#52514e',
  textMuted: '#84867f',
  textInverse: '#ffffff',

  accent: '#2f5fe0',
  accentPressed: '#2549b8',
  accentSubtle: 'rgba(47, 95, 224, 0.10)',
  onAccent: '#ffffff',

  good: '#0f8f5a',
  goodSubtle: 'rgba(15, 143, 90, 0.10)',
  warning: '#a8730a',
  warningSubtle: 'rgba(168, 115, 10, 0.10)',
  critical: '#c8383f',
  criticalSubtle: 'rgba(200, 56, 63, 0.10)',
  info: '#2a78d6',
  infoSubtle: 'rgba(42, 120, 214, 0.10)',

  inflow: '#0f8f5a',
  outflow: '#0b0b0b',

  grid: '#eaecf1',
  axis: '#d3d7e0',

  series: SERIES_LIGHT,
  otherSeries: OTHER_SERIES.light,

  /** See the dark palette: chrome, not data encoding. */
  feature: {
    primary: { bg: '#3d5afe', fg: '#ffffff', muted: 'rgba(255,255,255,0.78)' },
    savings: { bg: '#7c4dff', fg: '#ffffff', muted: 'rgba(255,255,255,0.78)' },
    spend: { bg: '#f4511e', fg: '#ffffff', muted: 'rgba(255,255,255,0.82)' },
    calm: { bg: '#00a97b', fg: '#00291d', muted: 'rgba(0,41,29,0.7)' },
  },
  sheen: 'rgba(255,255,255,0.16)',
};

export type Palette = typeof dark;
export const PALETTES: Record<ThemeMode, Palette> = { dark, light };

// -------------------------------------------------------------------- layout

/** 4pt base grid. Everything spatial is a multiple of it, no exceptions. */
export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  huge: 64,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

/**
 * Type scale.
 *
 * `tabularNumbers` is not decoration: proportional digits make a column of
 * amounts jitter as values change, and a balance that shifts sideways while
 * you read it feels unreliable.
 */
export const type = {
  hero: { fontSize: 44, lineHeight: 48, fontWeight: '700' as const, letterSpacing: -1.2 },
  display: { fontSize: 32, lineHeight: 38, fontWeight: '700' as const, letterSpacing: -0.8 },
  // 650 is not a valid React Native weight - only hundreds are - and TypeScript
  // rejects it outright. Rounded to 700.
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const, letterSpacing: -0.3 },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const, letterSpacing: -0.1 },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' as const, letterSpacing: 0 },
  bodyStrong: { fontSize: 15, lineHeight: 21, fontWeight: '600' as const, letterSpacing: 0 },
  caption: { fontSize: 13, lineHeight: 17, fontWeight: '500' as const, letterSpacing: 0 },
  micro: { fontSize: 11, lineHeight: 14, fontWeight: '600' as const, letterSpacing: 0.4 },
} as const;

// Not `as const`: RN types FontVariant[] as mutable, so a readonly tuple is
// rejected wherever this is spread into a style.
export const tabularNumbers = { fontVariant: ['tabular-nums'] as ('tabular-nums')[] };

/**
 * Elevation. On dark surfaces a shadow is nearly invisible, so depth is carried
 * mostly by the surface step; the shadow only softens the edge.
 */
export const elevation = {
  none: {},
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  sheet: {
    shadowColor: '#000',
    shadowOpacity: 0.32,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: -8 },
    elevation: 12,
  },
} as const;

/** Chart geometry, so every chart in the app shares the same visual weight. */
export const chart = {
  lineWidth: 2,
  markGapWidth: 2,
  barRadius: 4,
  minMarkerSize: 8,
  gridWidth: 1,
  axisWidth: 1,
  /** Minimum touch target — smaller than this and the hit area is padded out. */
  hitSlop: 44,
} as const;

export const motion = {
  /** Fast enough to feel immediate, slow enough to be followed. */
  fast: 140,
  base: 220,
  slow: 320,
  /** Standard ease-out; things arrive decisively and leave quietly. */
  easing: [0.22, 0.61, 0.36, 1] as const,
} as const;

// -------------------------------------------------------------------- helpers

/**
 * Colour for series index `i`, folding everything past the eighth into the
 * neutral "Other" slot rather than generating a ninth hue that would collide
 * with one already on screen.
 */
export function seriesColor(palette: Palette, i: number): string {
  return i < palette.series.length ? palette.series[i] : palette.otherSeries;
}

/** The status colour for a budget state. Always shipped with a label. */
export function budgetStateColor(
  palette: Palette,
  state: 'on_track' | 'warning' | 'over' | 'ended_under' | 'ended_over'
): string {
  switch (state) {
    case 'on_track':
    case 'ended_under':
      return palette.good;
    case 'warning':
      return palette.warning;
    case 'over':
    case 'ended_over':
      return palette.critical;
  }
}

/** Money direction colour. Outflows use plain ink — most transactions are
 *  outflows, and painting them all red makes normal life look like an alarm. */
export function amountColor(palette: Palette, amountMinor: number): string {
  return amountMinor > 0 ? palette.inflow : palette.outflow;
}
