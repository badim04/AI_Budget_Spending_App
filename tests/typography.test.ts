/**
 * Where the display face is allowed.
 *
 * Space Grotesk goes on words and never on money, and the reason is measurable
 * rather than aesthetic: its digits are proportional. Read out of the TTF's
 * `hmtx` table, `1` has an advance of 452 units against `0` at 648 — a 43%
 * difference. In a column of amounts that is visible misalignment, and under
 * `useCountUp`, which animates a headline figure while it counts, it is a
 * number that wobbles.
 *
 * The font does carry a `tnum` feature, so `fontVariant: ['tabular-nums']`
 * would fix it — if the feature is honoured, which differs across iOS, Android
 * and web. This file pins the rule so a later "make it consistent" refactor
 * cannot quietly put the display face on a figure and reintroduce the wobble
 * on one platform only.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type as typeScale } from '@/theme/tokens';

const DISPLAY = /SpaceGrotesk/;

/** The tokens `AmountText` renders money with — see `ui/Primitives`. */
const FIGURE_TOKENS = ['hero', 'display'] as const;
/** Reading sizes, where a display face's quirks become friction. */
const READING_TOKENS = ['body', 'bodyStrong', 'caption', 'micro'] as const;
/** Headings, which is the whole point of adding a face at all. */
const WORD_TOKENS = ['title', 'heading'] as const;

describe('the type scale', () => {
  it.each(FIGURE_TOKENS)('%s stays on the system face, because it carries money', (name) => {
    expect((typeScale[name] as { fontFamily?: string }).fontFamily).toBeUndefined();
  });

  it.each(READING_TOKENS)('%s stays on the system face, because it is read', (name) => {
    expect((typeScale[name] as { fontFamily?: string }).fontFamily).toBeUndefined();
  });

  it.each(WORD_TOKENS)('%s carries the display face', (name) => {
    expect((typeScale[name] as { fontFamily?: string }).fontFamily).toMatch(DISPLAY);
  });

  /**
   * A named weight face plus a `fontWeight` makes Android synthesise a second
   * layer of bold on a font that is already bold.
   */
  it.each(WORD_TOKENS)('%s does not set a weight beside a named face', (name) => {
    expect((typeScale[name] as { fontWeight?: string }).fontWeight).toBeUndefined();
  });

  it('keeps every size and line height', () => {
    for (const token of Object.values(typeScale)) {
      expect(token.fontSize).toBeGreaterThan(0);
      expect(token.lineHeight).toBeGreaterThanOrEqual(token.fontSize);
    }
  });
});

describe('the font itself', () => {
  const face = (weight: string) =>
    join(
      __dirname,
      '..',
      'node_modules',
      '@expo-google-fonts',
      'space-grotesk',
      weight,
      `SpaceGrotesk_${weight}.ttf`
    );

  /** Both faces the type scale names have to actually be on disk. */
  it.each(['600SemiBold', '700Bold'])('ships the %s face', (weight) => {
    expect(readFileSync(face(weight)).length).toBeGreaterThan(10_000);
  });

  /**
   * The measurement the whole rule rests on.
   *
   * If a future version of the font ships tabular digits by default, this test
   * fails and the rule above can be revisited on evidence rather than on a
   * memory of a comment.
   */
  it('still has proportional digits, which is why money is not set in it', () => {
    const buf = readFileSync(face('700Bold'));
    const tables: Record<string, number> = {};
    const count = buf.readUInt16BE(4);
    for (let i = 0; i < count; i++) {
      const off = 12 + i * 16;
      tables[buf.toString('ascii', off, off + 4)] = buf.readUInt32BE(off + 8);
    }

    const numHMetrics = buf.readUInt16BE(tables.hhea + 34);
    const cmap = tables.cmap;
    let sub = 0;
    const n = buf.readUInt16BE(cmap + 2);
    for (let i = 0; i < n; i++) {
      const rec = cmap + 4 + i * 8;
      const o = cmap + buf.readUInt32BE(rec + 4);
      if (buf.readUInt16BE(o) === 4 && buf.readUInt16BE(rec) === 3) {
        sub = o;
        break;
      }
    }

    const segX2 = buf.readUInt16BE(sub + 6);
    const ends = sub + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;

    const gidFor = (code: number) => {
      for (let i = 0; i < segX2 / 2; i++) {
        if (buf.readUInt16BE(ends + i * 2) < code) continue;
        const start = buf.readUInt16BE(starts + i * 2);
        if (start > code) return 0;
        const ro = buf.readUInt16BE(ranges + i * 2);
        if (ro === 0) return (code + buf.readInt16BE(deltas + i * 2)) & 0xffff;
        const g = buf.readUInt16BE(ranges + i * 2 + ro + (code - start) * 2);
        return g === 0 ? 0 : (g + buf.readInt16BE(deltas + i * 2)) & 0xffff;
      }
      return 0;
    };

    const advances = Array.from({ length: 10 }, (_, d) =>
      buf.readUInt16BE(tables.hmtx + Math.min(gidFor(48 + d), numHMetrics - 1) * 4)
    );

    expect(new Set(advances).size, `advances: ${advances.join(' ')}`).toBeGreaterThan(1);
  });
});
