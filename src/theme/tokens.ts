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

  /**
   * Deep navy, not violet-black (v1.2).
   *
   * The dark ramp used to be a near-black with violet mixed in, chosen so the
   * purple accent sat in the same family as the surfaces. It worked, and it
   * also read as "an app with the lights off". The reference set this release
   * is built against is unambiguous about the alternative: a deep blue night
   * mode, where the canvas has a colour of its own rather than being an absence
   * of one, and every card is a legible step up from it.
   *
   * Blue rather than any other hue because it is the one that can carry both
   * halves of the palette — the violet accent stays in family, and the green
   * and amber of the status colours read as *on* the surface instead of
   * fighting it, which a warm dark ground cannot do.
   *
   * Surfaces climb toward the viewer: canvas -> card -> raised.
   */
  canvas: '#080d1c',
  surface: '#101728',
  surfaceRaised: '#182036',
  surfaceSunken: '#050912',
  /** Behind sheets and modals. */
  scrim: 'rgba(2, 5, 12, 0.74)',

  border: '#1f2942',
  borderStrong: '#2e3a58',
  /** Hairline on top of a coloured fill, to keep adjacent marks separate. */
  markGap: '#101728',

  textPrimary: '#f2f5fc',
  textSecondary: '#a3aec9',
  textMuted: '#6d7996',
  textInverse: '#080d1c',

  /** The single brand accent. Used for the primary action and nothing else. */
  /**
   * Finlo purple.
   *
   * The blue accent was a default, not an identity — it is the colour every
   * banking app reaches for, and it made the product look like a dashboard
   * someone had themed rather than a thing with a point of view. Purple is
   * distinctive in this market, it already appears on the savings card, and it
   * carries the "friendly but serious about money" register the brand wants.
   */
  accent: '#8b6cff',
  accentPressed: '#7454e6',
  accentSubtle: 'rgba(139, 108, 255, 0.18)',
  onAccent: '#0b0620',

  /** The accent at reading weight, for large tinted areas. Now a blue-violet,
   *  so a tinted panel sits on the navy ground rather than floating over it. */
  accentSoft: '#221f45',

  // Status. Reserved — never reused as a series colour.
  good: '#2fbe7e',
  goodSubtle: 'rgba(47, 190, 126, 0.14)',
  warning: '#f5a524',
  warningSubtle: 'rgba(245, 165, 36, 0.14)',
  critical: '#ff6b70',
  criticalSubtle: 'rgba(255, 107, 112, 0.14)',
  info: '#59a6f0',
  infoSubtle: 'rgba(89, 166, 240, 0.14)',

  /** Money direction. Deliberately not the same greens/reds as status, so
   *  "an outflow" never reads as "something is wrong". */
  inflow: '#3ecf8e',
  outflow: '#eef2fa',

  grid: '#1a2338',
  axis: '#26314c',

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
   * `sheen` is a translucent white wash. It used to fake the depth a gradient
   * would give; now that `expo-linear-gradient` is installed the cards carry a
   * real one, and `sheen` is kept for the pills that sit *on* those cards,
   * where a wash of the card's own light is exactly right.
   */
  feature: {
    /**
     * `bg` -> `bgEnd` is a real two-stop gradient (v1.2).
     *
     * These were flat fills with a translucent white circle floated over the
     * top-right corner, standing in for the gradient every app in the reference
     * set uses. That stand-in existed because a gradient needs
     * `expo-linear-gradient` — a native module, and adding one means the next
     * update has to be a full build rather than an over-the-air push.
     *
     * The second stop is the same hue darkened and pushed slightly toward
     * violet, never a different hue: a two-hue gradient reads as a brand
     * flourish and starts competing with the figure printed on top of it, which
     * is the one thing this card exists to make prominent.
     */
    primary: { bg: '#8a5cff', bgEnd: '#5b2fe0', fg: '#ffffff', muted: 'rgba(255,255,255,0.74)' },
    savings: { bg: '#5d4ae8', bgEnd: '#33249e', fg: '#ffffff', muted: 'rgba(255,255,255,0.74)' },
    spend: { bg: '#ff6b70', bgEnd: '#d93a56', fg: '#ffffff', muted: 'rgba(255,255,255,0.78)' },
    calm: { bg: '#16c98c', bgEnd: '#0a8f68', fg: '#04291d', muted: 'rgba(4,41,29,0.68)' },
  },
  sheen: 'rgba(255,255,255,0.10)',

  /**
   * Tile colours, for a grid where every tile is a different one.
   *
   * The app was one column of identical rectangles, which is the layout of a
   * report. What makes a consumer finance app feel navigable is that each
   * destination looks like itself: you learn "the green one is goals" and stop
   * reading labels. That only works if the set is fixed and each tile keeps
   * its colour everywhere it appears.
   *
   * Separate from `series` (which encodes a category and cannot be chosen for
   * looks) and from `feature` (one saturated fill behind a headline figure).
   * These are quiet tinted panels with a bright tag and a faded glyph — legible
   * as a group, distinguishable at a glance.
   */
  tile: {
    violet: { bg: '#241d3d', border: '#3d3266', fg: '#cbb8ff', tag: '#7c4dff' },
    blue:   { bg: '#152740', border: '#22406b', fg: '#a8cbff', tag: '#3d7bff' },
    teal:   { bg: '#0f2f30', border: '#1a4f51', fg: '#8fe3d9', tag: '#0fb5a5' },
    green:  { bg: '#132c1f', border: '#204a33', fg: '#94e0b4', tag: '#12b981' },
    amber:  { bg: '#332512', border: '#573f1d', fg: '#f3cf8f', tag: '#f5a524' },
    pink:   { bg: '#331728', border: '#582844', fg: '#f5aecd', tag: '#ec4899' },
  },
};

/**
 * Light mode, designed rather than inverted.
 *
 * It was previously the dark ramp turned inside out — grey canvas, grey cards,
 * grey borders — which is legible and completely lifeless. Three changes give
 * it a spine:
 *
 *   1. **Cards are white, the canvas is not.** A near-white tinted canvas with
 *      pure white cards floating on it is what makes a light UI read as
 *      layered instead of flat. Inverting a dark theme gives the opposite.
 *   2. **A hint of warmth in the neutrals.** Pure grey looks like a wireframe;
 *      a few degrees toward blue-violet reads as considered and matches the
 *      accent instead of fighting it.
 *   3. **Borders barely exist.** In light mode, separation comes from the
 *      surface step and a soft shadow. Hairlines everywhere is a spreadsheet.
 */
const light: typeof dark = {
  mode: 'light',

  // A cool near-white rather than lavender (v1.2). The old canvas carried
  // enough violet to tint every white card sitting on it; the light designs
  // this release follows keep the ground almost neutral and let the colour
  // come from the content — the donut, the category chips, the accent button.
  canvas: '#f6f7fb',
  surface: '#ffffff',
  surfaceRaised: '#ffffff',
  surfaceSunken: '#eef0f7',
  scrim: 'rgba(12, 18, 36, 0.40)',

  border: '#e6e9f2',
  borderStrong: '#c8cee0',
  markGap: '#ffffff',

  // Deep navy, not black: pure black on white is harsh at body size and reads
  // as a wireframe. This keeps the violet family without tinting the text.
  textPrimary: '#111834',
  textSecondary: '#48536f',
  textMuted: '#7b849c',
  textInverse: '#ffffff',

  accent: '#6c4dff',
  accentPressed: '#573ad6',
  accentSubtle: 'rgba(108, 77, 255, 0.10)',
  onAccent: '#ffffff',

  /** Large tinted areas that must stay readable. */
  accentSoft: '#eeeaff',

  good: '#0f9d63',
  goodSubtle: 'rgba(15, 157, 99, 0.10)',
  warning: '#b8760a',
  warningSubtle: 'rgba(184, 118, 10, 0.12)',
  critical: '#d94a52',
  criticalSubtle: 'rgba(217, 74, 82, 0.10)',
  info: '#2a78d6',
  infoSubtle: 'rgba(42, 120, 214, 0.10)',

  inflow: '#0f8f5a',
  outflow: '#111834',

  grid: '#eef0f7',
  axis: '#d5dae8',

  series: SERIES_LIGHT,
  otherSeries: OTHER_SERIES.light,

  /** See the dark palette: chrome, not data encoding. */
  feature: {
    /** See the dark palette: same hue, darkened, never a second hue. */
    primary: { bg: '#7d5cff', bgEnd: '#5330d8', fg: '#ffffff', muted: 'rgba(255,255,255,0.80)' },
    savings: { bg: '#5b48e0', bgEnd: '#3826b0', fg: '#ffffff', muted: 'rgba(255,255,255,0.80)' },
    spend: { bg: '#ff6a6f', bgEnd: '#e0424f', fg: '#ffffff', muted: 'rgba(255,255,255,0.84)' },
    calm: { bg: '#14b881', bgEnd: '#0a8a60', fg: '#04291d', muted: 'rgba(4,41,29,0.72)' },
  },
  sheen: 'rgba(255,255,255,0.16)',

  /** See the dark palette. Pastel fills in light mode, same six identities. */
  tile: {
    violet: { bg: '#f0ebff', border: '#ddd0ff', fg: '#4c2fb8', tag: '#7c4dff' },
    blue:   { bg: '#e8f0ff', border: '#cfe0ff', fg: '#1c4fa8', tag: '#3d7bff' },
    teal:   { bg: '#e2f7f5', border: '#c3ebe6', fg: '#0b6b62', tag: '#0fb5a5' },
    green:  { bg: '#e6f7ee', border: '#c6ebd8', fg: '#0b6b46', tag: '#12b981' },
    amber:  { bg: '#fdf2dd', border: '#f7e0b4', fg: '#8a5a06', tag: '#f5a524' },
    pink:   { bg: '#fdeaf3', border: '#f8cfe2', fg: '#9c1f5c', tag: '#ec4899' },
  },
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
/**
 * The display face, and where it is allowed.
 *
 * Space Grotesk goes on the words and never on the money, and that is a
 * decision rather than caution.
 *
 * Its digits are proportional: read straight out of the TTF's hmtx table, `1`
 * has an advance of 452 units against `0` at 648 — a 43% difference. In a
 * column of amounts that is visible misalignment, and under `useCountUp`, which
 * animates a headline figure digit by digit, it is a number that visibly
 * wobbles while it counts.
 *
 * The font does ship a `tnum` feature, so `fontVariant: ['tabular-nums']` would
 * fix it — if the feature is honoured, which depends on the text engine and
 * differs between iOS, Android and web. Money alignment is not worth staking on
 * an OpenType feature landing identically on three platforms, so figures keep
 * the system face, which is tabular where it counts and cannot fail to load.
 *
 * So: `title` and `heading` carry the character. `hero` and `display` are
 * almost exclusively `AmountText`, and `body` and below are reading sizes where
 * a display face's quirks stop being charm and start being friction.
 */
const DISPLAY_BOLD = 'SpaceGrotesk_700Bold';
const DISPLAY_SEMI = 'SpaceGrotesk_600SemiBold';

export const type = {
  // Figures. System face, so tabular alignment does not depend on a feature.
  hero: { fontSize: 44, lineHeight: 48, fontWeight: '700' as const, letterSpacing: -1.2 },
  display: { fontSize: 32, lineHeight: 38, fontWeight: '700' as const, letterSpacing: -0.8 },

  /*
    Words. `fontWeight` is dropped on these two on purpose: the family already
    names the weight, and leaving a weight beside a named face makes Android
    synthesise a second layer of bold on top of a font that is already bold.
  */
  title: { fontSize: 22, lineHeight: 28, fontFamily: DISPLAY_BOLD, letterSpacing: -0.3 },
  heading: { fontSize: 17, lineHeight: 22, fontFamily: DISPLAY_SEMI, letterSpacing: -0.1 },
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
