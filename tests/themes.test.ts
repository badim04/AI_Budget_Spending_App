/**
 * The four themes.
 *
 * Almost none of this checks that a colour is the colour it was declared as —
 * that is a copy-paste check and it would pass forever. What is checked is the
 * set of properties a theme can quietly violate while still looking excellent
 * in a swatch grid, because that is how an unreadable theme ships:
 *
 *   - text you cannot read at body size on the surface it sits on
 *   - a primary button whose label disappears into it
 *   - an accent indistinguishable from the colour that means "warning"
 *   - a chart hue repainted for looks, when a hue encodes a category
 *
 * Every one of those is a judgement someone would have to make by eye, four
 * times, on every future theme. Measured instead.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_THEME,
  PALETTE_BY_THEME,
  SYSTEM_THEMES,
  THEMES,
  buildPalette,
  themeSeed,
  type ThemeId,
} from '@/theme/themes';
import { contrast, distance, hexToRgb, luminance, mix, readableOn } from '@/theme/color';
import { SERIES_DARK, SERIES_LIGHT } from '@/theme/tokens';

const IDS = THEMES.map((t) => t.id);

/** WCAG AA for normal text. Body copy is the point of the app. */
const AA = 4.5;
/** WCAG AA for large text and UI furniture. */
const AA_LARGE = 3;

describe('colour arithmetic', () => {
  it('round-trips hex', () => {
    expect(hexToRgb('#FF007F')).toEqual({ r: 255, g: 0, b: 127 });
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('measures contrast against the known extremes', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrast('#123456', '#123456')).toBeCloseTo(1, 5);
  });

  /**
   * The gamma expansion is the whole point of `luminance`.
   *
   * Averaging raw channels would call Jolt Yellow and Neon Violet similarly
   * bright. They are nothing like it, and every `readableOn` decision depends
   * on telling them apart.
   */
  it('knows yellow is bright and violet is not', () => {
    expect(luminance('#FFCC00')).toBeGreaterThan(0.55);
    expect(luminance('#8A2BE2')).toBeLessThan(0.15);
  });

  it('picks readable text over a colour, not a fixed one', () => {
    expect(readableOn('#FFCC00')).toMatch(/^#0/); // yellow needs dark text
    expect(readableOn('#2E5A44')).toBe('#ffffff'); // deep green needs light
    expect(readableOn('#FBC2EB')).toMatch(/^#0/); // pastel pink needs dark
  });

  it('mixes toward the far colour', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

describe('the theme set', () => {
  it('offers four, each with a distinct id and name', () => {
    expect(THEMES).toHaveLength(4);
    expect(new Set(IDS).size).toBe(4);
    expect(new Set(THEMES.map((t) => t.name)).size).toBe(4);
  });

  it('has a default, and one nominated for each side of the OS setting', () => {
    expect(IDS).toContain(DEFAULT_THEME);
    expect(IDS).toContain(SYSTEM_THEMES.dark);
    expect(IDS).toContain(SYSTEM_THEMES.light);
    expect(themeSeed(SYSTEM_THEMES.dark).scheme).toBe('dark');
    expect(themeSeed(SYSTEM_THEMES.light).scheme).toBe('light');
  });

  it('falls back rather than throwing on an id it does not know', () => {
    expect(themeSeed('nope' as ThemeId).id).toBe(THEMES[0].id);
  });

  it('describes each one in the picker without repeating itself', () => {
    for (const seed of THEMES) {
      expect(seed.blurb.length, seed.id).toBeGreaterThan(10);
      expect(seed.blurb.length, seed.id).toBeLessThan(46);
    }
    expect(new Set(THEMES.map((t) => t.blurb)).size).toBe(4);
  });
});

describe.each(IDS)('%s is readable', (id) => {
  const p = PALETTE_BY_THEME[id];

  it('has body text passing AA on the canvas and on a card', () => {
    expect(contrast(p.textPrimary, p.canvas), 'on canvas').toBeGreaterThanOrEqual(AA);
    expect(contrast(p.textPrimary, p.surface), 'on surface').toBeGreaterThanOrEqual(AA);
    expect(contrast(p.textPrimary, p.surfaceRaised), 'on raised').toBeGreaterThanOrEqual(AA);
  });

  it('keeps secondary text legible rather than merely present', () => {
    expect(contrast(p.textSecondary, p.canvas)).toBeGreaterThanOrEqual(AA_LARGE);
    expect(contrast(p.textSecondary, p.surface)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  /**
   * The one that catches Jolt Yellow.
   *
   * `onAccent` is what a primary button's label is painted in. Hardcoding white
   * — which a single-theme app can get away with — gives a 1.7 ratio on
   * `#FFCC00` and a button nobody can read.
   */
  it('puts readable text on the primary button', () => {
    expect(contrast(p.onAccent, p.accent)).toBeGreaterThanOrEqual(AA);
  });

  it('puts readable text on every feature fill', () => {
    for (const [name, fill] of Object.entries(p.feature)) {
      expect(contrast(fill.fg, fill.bg), `feature.${name}`).toBeGreaterThanOrEqual(AA_LARGE);
      // The gradient's far end must not lose the label either.
      expect(contrast(fill.fg, fill.bgEnd), `feature.${name} end`).toBeGreaterThanOrEqual(
        AA_LARGE
      );
    }
  });

  it('keeps every tile label readable on its own tint', () => {
    for (const [name, tile] of Object.entries(p.tile)) {
      expect(contrast(tile.fg, tile.bg), `tile.${name}`).toBeGreaterThanOrEqual(AA_LARGE);
    }
  });

  it('separates a card from the canvas it sits on', () => {
    // Not a contrast ratio — a card is not text. It just has to be visible.
    expect(distance(p.surface, p.canvas), 'surface vs canvas').toBeGreaterThan(0.01);
    expect(distance(p.border, p.surface), 'border vs surface').toBeGreaterThan(0.02);
  });
});

describe.each(IDS)('%s keeps meaning distinct from decoration', (id) => {
  const p = PALETTE_BY_THEME[id];

  /**
   * Midnight Tokyo's accent is Jolt Yellow and this app already uses amber for
   * "ahead of pace". An accent that reads as a warning turns every primary
   * button into a false alarm.
   */
  it('does not let the accent be mistaken for a status colour', () => {
    for (const status of ['good', 'warning', 'critical'] as const) {
      expect(distance(p.accent, p[status]), `accent vs ${status}`).toBeGreaterThan(0.17);
    }
  });

  it('keeps the three status colours apart from each other', () => {
    expect(distance(p.good, p.warning)).toBeGreaterThan(0.17);
    expect(distance(p.good, p.critical)).toBeGreaterThan(0.17);
    expect(distance(p.warning, p.critical)).toBeGreaterThan(0.17);
  });

  /**
   * A chart hue encodes a category, so it cannot be chosen for looks. The
   * eight-hue set is checked for contrast and colour-vision deficiency; a theme
   * redecorating it would silently break that guarantee.
   */
  it('does not repaint the validated series palette', () => {
    expect(p.series).toEqual(p.mode === 'dark' ? SERIES_DARK : SERIES_LIGHT);
    expect(p.series).toHaveLength(8);
  });

  it('does not colour an outflow like a failure', () => {
    expect(distance(p.outflow, p.critical), 'outflow vs critical').toBeGreaterThan(0.17);
  });
});

describe('buildPalette', () => {
  it('produces every token the app reads', () => {
    const built = buildPalette(THEMES[0]);
    for (const key of [
      'canvas', 'surface', 'surfaceRaised', 'surfaceSunken', 'scrim',
      'border', 'borderStrong', 'markGap',
      'textPrimary', 'textSecondary', 'textMuted', 'textInverse',
      'accent', 'accentPressed', 'accentSubtle', 'onAccent', 'accentSoft',
      'good', 'goodSubtle', 'warning', 'warningSubtle', 'critical', 'criticalSubtle',
      'info', 'infoSubtle', 'inflow', 'outflow', 'grid', 'axis',
      'series', 'otherSeries', 'feature', 'sheen', 'tile',
    ] as const) {
      expect(built[key], key).toBeDefined();
    }
  });

  it('is deterministic', () => {
    expect(buildPalette(THEMES[1])).toEqual(buildPalette(THEMES[1]));
  });

  it('gives all six tiles to every theme', () => {
    for (const id of IDS) {
      expect(Object.keys(PALETTE_BY_THEME[id].tile).sort()).toEqual([
        'amber', 'blue', 'green', 'pink', 'teal', 'violet',
      ]);
    }
  });
});
