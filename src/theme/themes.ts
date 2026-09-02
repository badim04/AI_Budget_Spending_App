/**
 * The four themes, and the machinery that turns five colours into thirty-five.
 *
 * "Light" and "Dark" describe a setting; they do not describe a look. Choosing
 * between named themes is choosing an aesthetic, and an app someone opens
 * several times a day is worth letting them furnish.
 *
 * Each theme declares only what carries its identity — a canvas, a surface, two
 * accents and a text colour. Everything else is derived in `color.ts`, because
 * a border is the step between a surface and its text and a pressed accent is
 * the accent darkened, and hand-picking a hundred and forty of those is a
 * hundred and forty chances to be slightly wrong with no way to notice.
 *
 * Three constraints outrank the aesthetics, and each is enforced by a test in
 * `tests/themes.test.ts` rather than by care:
 *
 * **1. Text on its background must be readable.** WCAG AA, measured, in every
 * theme. A palette that looks striking in a swatch grid and fails at body size
 * is not a theme, it is a screenshot.
 *
 * **2. The accent must not look like a status colour.** Midnight Tokyo's accent
 * is Jolt Yellow, and this app already uses amber for "ahead of pace". An
 * accent indistinguishable from a warning turns every primary button into a
 * false alarm, so status colours are pushed away from the accent per theme.
 *
 * **3. Series colours stay the validated set.** A chart hue encodes a category,
 * so it cannot be chosen for looks — the eight-hue set is checked for contrast
 * and colour-vision deficiency and a theme is not allowed to redecorate it.
 * Themes pick the light or dark variant and nothing more.
 */

import {
  SERIES_DARK,
  SERIES_LIGHT,
  OTHER_SERIES,
  type Palette,
  type ThemeMode,
} from './tokens';
import { alpha, contrast, darken, distance, lighten, mix, readableOn, separate } from './color';

export type ThemeId = 'tokyo' | 'cyberpunk' | 'agave' | 'vaporwave';

/** What a theme actually has to state about itself. */
export interface ThemeSeed {
  id: ThemeId;
  name: string;
  /** One line, for the picker. Says what it feels like, not what it contains. */
  blurb: string;
  scheme: ThemeMode;
  canvas: string;
  surface: string;
  /** Primary accent: the one action per screen. */
  accent: string;
  /** Secondary accent: the second voice, used by tiles and feature fills. */
  secondary: string;
  text: string;
}

export const THEMES: ThemeSeed[] = [
  {
    id: 'tokyo',
    name: 'Midnight Tokyo',
    blurb: 'Deep slate and a jolt of yellow',
    scheme: 'dark',
    canvas: '#121620',
    surface: '#1E2538',
    accent: '#FFCC00',
    secondary: '#8A2BE2',
    text: '#E6EDF5',
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    blurb: 'Obsidian, neon magenta, electric cyan',
    scheme: 'dark',
    canvas: '#0B0E14',
    surface: '#1A1F2C',
    accent: '#FF007F',
    secondary: '#00F5FF',
    text: '#FFFFFF',
  },
  {
    id: 'vaporwave',
    name: 'Vaporwave',
    blurb: 'Dark velvet, cotton candy, lavender sky',
    scheme: 'dark',
    canvas: '#17151C',
    surface: '#24212E',
    accent: '#FBC2EB',
    secondary: '#A6C1EE',
    text: '#F1F1F1',
  },
  {
    id: 'agave',
    name: 'Agave & Cream',
    blurb: 'Alabaster, deep agave green, terracotta',
    scheme: 'light',
    canvas: '#FDFBF7',
    surface: '#F4F0E6',
    accent: '#2E5A44',
    secondary: '#D4A373',
    text: '#1C2A22',
  },
];

export const DEFAULT_THEME: ThemeId = 'tokyo';

/**
 * What "Match my phone" resolves to.
 *
 * Three of the four are dark, so following the OS needs one nomination on each
 * side rather than a mode flag. Tokyo is the steadiest of the dark three and
 * Agave is the only light one.
 */
export const SYSTEM_THEMES: Record<ThemeMode, ThemeId> = {
  dark: 'tokyo',
  light: 'agave',
};

export function themeSeed(id: ThemeId): ThemeSeed {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

// ------------------------------------------------------------------- derive

/**
 * Status colours, nudged until they cannot be mistaken for the accent.
 *
 * Green, amber and red mean something in a finance app, and they have to keep
 * meaning it after a theme paints the primary button yellow. When the accent
 * sits too close to one of them, the *status* colour moves — never the accent,
 * because the accent is the theme's identity and the status colour is
 * furniture that only has to stay recognisable.
 */
function statusColours(seed: ThemeSeed) {
  const dark = seed.scheme === 'dark';
  const base = {
    good: dark ? '#2fbe7e' : '#0f9d63',
    warning: dark ? '#f5a524' : '#b8760a',
    critical: dark ? '#ff6b70' : '#d94a52',
    info: dark ? '#59a6f0' : '#2a78d6',
  };

  const apart = (colour: string) =>
    distance(colour, seed.accent) < 0.18
      ? separate(colour, seed.accent, 2.2, !dark)
      : colour;

  return {
    good: apart(base.good),
    warning: apart(base.warning),
    critical: apart(base.critical),
    info: apart(base.info),
  };
}

/**
 * The six tinted destination panels.
 *
 * Their job is identity — you learn "the green one is goals" and stop reading
 * labels — so the six hues stay fixed across themes and only their treatment
 * changes: mixed into the theme's own surface, so a tile on obsidian and a tile
 * on cream are recognisably the same tile without either looking pasted on.
 */
const TILE_HUES = {
  violet: '#7c4dff',
  blue: '#3d7bff',
  teal: '#0fb5a5',
  green: '#12b981',
  amber: '#f5a524',
  pink: '#ec4899',
} as const;

function tiles(seed: ThemeSeed): Palette['tile'] {
  const dark = seed.scheme === 'dark';
  const out = {} as Palette['tile'];

  for (const [key, hue] of Object.entries(TILE_HUES) as Array<
    [keyof typeof TILE_HUES, string]
  >) {
    out[key] = {
      bg: mix(seed.surface, hue, dark ? 0.14 : 0.12),
      border: mix(seed.surface, hue, dark ? 0.3 : 0.26),
      // The readable foreground: the hue pulled toward the text end far enough
      // to sit on its own tinted panel.
      fg: dark ? lighten(hue, 0.42) : darken(hue, 0.34),
      tag: hue,
    };
  }
  return out;
}

/**
 * The saturated fills behind a headline figure.
 *
 * `primary` and `savings` come from the theme's two accents so a hero card is
 * unmistakably part of the theme. `spend` and `calm` stay red and green: they
 * are the only feature fills that carry a meaning — money going the wrong way,
 * money going the right way — and a theme that recoloured those would be
 * choosing decoration over sense.
 */
function features(seed: ThemeSeed): Palette['feature'] {
  /*
    The label has to survive the whole gradient, not just the end it was
    measured against.

    Picking `fg` with `readableOn(bg)` chose against the light end only, and on
    a mid-tone fill like Neon Magenta dark text wins there and then falls to a
    2.98 ratio by the time the gradient reaches `bgEnd`. Two themes failed on
    exactly that. So both candidates are scored on their *worst* end and the
    better of the two wins — which is what "readable on this card" actually
    means when the card is not one colour.
  */
  const build = (bg: string) => {
    const bgEnd = darken(bg, 0.28);
    const worst = (candidate: string) =>
      Math.min(contrast(candidate, bg), contrast(candidate, bgEnd));

    const dark = '#0b0b12';
    const light = '#ffffff';
    const fg = worst(dark) >= worst(light) ? dark : light;

    return { bg, bgEnd, fg, muted: alpha(fg, 0.76) };
  };

  return {
    primary: build(seed.accent),
    savings: build(seed.secondary),
    spend: build(seed.scheme === 'dark' ? '#ff5a5f' : '#e0424f'),
    calm: build(seed.scheme === 'dark' ? '#12b981' : '#0fa873'),
  };
}

/**
 * Five colours in, a whole palette out.
 */
export function buildPalette(seed: ThemeSeed): Palette {
  const dark = seed.scheme === 'dark';
  const { canvas, surface, accent, secondary, text } = seed;
  const status = statusColours(seed);

  // Surfaces step toward the text end of the range, so depth reads the same way
  // on cream as it does on obsidian.
  const raised = mix(surface, text, dark ? 0.06 : 0.03);
  const sunken = dark ? darken(canvas, 0.35) : mix(canvas, text, 0.05);

  return {
    mode: seed.scheme,

    canvas,
    surface,
    surfaceRaised: raised,
    surfaceSunken: sunken,
    scrim: alpha(dark ? '#000000' : '#0c1224', dark ? 0.74 : 0.4),

    border: mix(surface, text, dark ? 0.12 : 0.1),
    borderStrong: mix(surface, text, dark ? 0.26 : 0.22),
    markGap: surface,

    textPrimary: text,
    textSecondary: mix(text, canvas, dark ? 0.34 : 0.3),
    textMuted: mix(text, canvas, dark ? 0.55 : 0.48),
    textInverse: canvas,

    accent,
    accentPressed: dark ? darken(accent, 0.16) : darken(accent, 0.12),
    accentSubtle: alpha(accent, dark ? 0.18 : 0.12),
    // Measured, never assumed: white on Jolt Yellow is a 1.7 contrast ratio.
    onAccent: readableOn(accent),
    accentSoft: mix(surface, accent, dark ? 0.16 : 0.14),

    good: status.good,
    goodSubtle: alpha(status.good, dark ? 0.16 : 0.11),
    warning: status.warning,
    warningSubtle: alpha(status.warning, dark ? 0.16 : 0.12),
    critical: status.critical,
    criticalSubtle: alpha(status.critical, dark ? 0.16 : 0.11),
    info: status.info,
    infoSubtle: alpha(status.info, dark ? 0.16 : 0.11),

    /*
      Money direction, deliberately not the status greens and reds: an outflow
      is not a problem, and colouring it like one makes every ordinary purchase
      look like an alert.
    */
    inflow: dark ? '#3ecf8e' : '#0f8f5a',
    outflow: text,

    grid: mix(canvas, text, dark ? 0.1 : 0.08),
    axis: mix(canvas, text, dark ? 0.2 : 0.16),

    // Not the theme's to change — see the header.
    series: dark ? SERIES_DARK : SERIES_LIGHT,
    otherSeries: dark ? OTHER_SERIES.dark : OTHER_SERIES.light,

    feature: features(seed),
    sheen: alpha('#ffffff', dark ? 0.1 : 0.16),
    tile: tiles(seed),
  };
}

/** Every theme, built. Computed once at module load; palettes never change. */
export const PALETTE_BY_THEME: Record<ThemeId, Palette> = THEMES.reduce(
  (acc, seed) => {
    acc[seed.id] = buildPalette(seed);
    return acc;
  },
  {} as Record<ThemeId, Palette>
);

/** Contrast of body text on its own canvas — used by the picker and the tests. */
export function textContrast(id: ThemeId): number {
  const palette = PALETTE_BY_THEME[id];
  return contrast(palette.textPrimary, palette.canvas);
}
