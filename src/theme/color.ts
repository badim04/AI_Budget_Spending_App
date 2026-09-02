/**
 * Colour arithmetic, so a theme can be five colours instead of thirty-five.
 *
 * A palette in this app has 35 tokens. Four themes written out by hand would be
 * a hundred and forty colours, most of them mechanical — a border is the step
 * between a surface and its text, a pressed accent is the accent darkened, a
 * subtle accent is the accent at low alpha. Hand-picking those means four
 * chances to get each one slightly wrong and no way to tell that you did.
 *
 * So a theme declares the five colours that actually carry its identity, and
 * everything else is derived here. The derivations are dull on purpose; the
 * interesting part is `readableOn`, which is the difference between a theme
 * that works and one that ships unreadable.
 *
 * All sRGB, all pure functions, no dependencies.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : clean;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** Blend two colours. `amount` 0 returns `a`, 1 returns `b`. */
export function mix(a: string, b: string, amount: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const t = Math.max(0, Math.min(1, amount));
  return rgbToHex({
    r: x.r + (y.r - x.r) * t,
    g: x.g + (y.g - x.g) * t,
    b: x.b + (y.b - x.b) * t,
  });
}

export function alpha(hex: string, a: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, a))})`;
}

/**
 * Relative luminance, per WCAG 2.
 *
 * The gamma expansion matters: averaging the raw channels would call
 * `#FFCC00` and `#8A2BE2` similarly bright, and they are nothing like it.
 */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Text that can actually be read on this colour.
 *
 * The one derivation that is not cosmetic. Midnight Tokyo's primary accent is
 * Jolt Yellow `#FFCC00`; white on it has a contrast ratio of 1.7, which is
 * illegible, and hardcoding `onAccent: '#ffffff'` the way a single-theme app
 * can is exactly how a themed one ships a button nobody can read. Whichever of
 * near-black or near-white contrasts better wins, and it is measured rather
 * than guessed at.
 */
export function readableOn(background: string, dark = '#0b0b12', light = '#ffffff'): string {
  return contrast(background, dark) >= contrast(background, light) ? dark : light;
}

/** Toward white by `amount`. */
export function lighten(hex: string, amount: number): string {
  return mix(hex, '#ffffff', amount);
}

/** Toward black by `amount`. */
export function darken(hex: string, amount: number): string {
  return mix(hex, '#000000', amount);
}

/**
 * Push `colour` away from `from` until it is at least `ratio` apart.
 *
 * Used where a theme's own choices would collide — a yellow accent beside an
 * amber warning, say. Steps toward whichever end of the range is further from
 * the thing it must not resemble, and gives up rather than looping forever,
 * because a colour that cannot be separated is a fact about the theme and
 * should surface as a failing contrast test rather than an infinite adjustment.
 */
export function separate(colour: string, from: string, ratio: number, towardLight: boolean): string {
  let out = colour;
  for (let i = 0; i < 20 && contrast(out, from) < ratio; i++) {
    out = towardLight ? lighten(out, 0.08) : darken(out, 0.08);
  }
  return out;
}

/**
 * How different two hues are, 0 (same) to 1 (opposite).
 *
 * Not a contrast ratio: two colours can have identical luminance and be
 * instantly distinguishable, which is the case that matters when checking an
 * accent against a status colour. Compared in RGB space, which is crude but
 * monotonic enough for a guard rail.
 */
export function distance(a: string, b: string): number {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const d = Math.sqrt((x.r - y.r) ** 2 + (x.g - y.g) ** 2 + (x.b - y.b) ** 2);
  return d / Math.sqrt(3 * 255 ** 2);
}
