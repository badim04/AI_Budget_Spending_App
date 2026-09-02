/**
 * The app's lighter register.
 *
 * These are mostly not tests of logic — the logic is one hash and a modulo.
 * They are tests of the editorial rules, because those are the part that rots:
 * someone adds a cheerful line six months from now that leaves the reader with
 * nowhere to go, and nothing catches it.
 */

import { describe, it, expect } from 'vitest';
import { COPY_SLOTS, allCopy, copyFor } from '@/core/copy';

const DAY = '2026-08-31';

describe('copyFor', () => {
  it('is stable within a day', () => {
    for (const slot of COPY_SLOTS) {
      const first = copyFor(slot, DAY);
      for (let i = 0; i < 20; i++) expect(copyFor(slot, DAY)).toEqual(first);
    }
  });

  it('moves across days, so a screen does not read identically forever', () => {
    const seen = new Set<string>();
    for (let d = 1; d <= 28; d++) {
      seen.add(copyFor('noTransactions', `2026-09-${String(d).padStart(2, '0')}`).title);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('covers every slot', () => {
    for (const slot of COPY_SLOTS) {
      expect(allCopy(slot).length, slot).toBeGreaterThan(0);
    }
  });
});

describe('the editorial rules', () => {
  /**
   * An empty state that is only a joke leaves someone where they were.
   */
  it('always says what would change things', () => {
    for (const slot of COPY_SLOTS) {
      for (const line of allCopy(slot)) {
        expect(line.body.length, `${slot}: ${line.title}`).toBeGreaterThan(25);
        expect(line.body.trim().endsWith('.'), `${slot}: ${line.body}`).toBe(true);
      }
    }
  });

  it('keeps titles short enough for a phone', () => {
    for (const slot of COPY_SLOTS) {
      for (const line of allCopy(slot)) {
        expect(line.title.length, `${slot}: ${line.title}`).toBeLessThanOrEqual(24);
      }
    }
  });

  /**
   * These appear when someone has no data, no budgets or nothing to report —
   * the moments where a joke at their expense lands worst.
   */
  it('never scolds, congratulates or exclaims', () => {
    const scolding = /should|must|need to|failed|bad|wrong|oops|uh.?oh|don't forget|shame/i;
    for (const slot of COPY_SLOTS) {
      for (const line of allCopy(slot)) {
        const text = `${line.title} ${line.body}`;
        expect(scolding.test(text), `${slot}: ${text}`).toBe(false);
        expect(text.includes('!'), `${slot}: ${text}`).toBe(false);
      }
    }
  });

  /**
   * The safety rule that separates this module from `voice.ts`.
   *
   * Personality is free when there is no money in the sentence and expensive
   * when there is. A figure here would be a figure written by hand, outside
   * every rule `voice.ts` enforces about bases, ceilings and essentials.
   */
  it('never contains a figure', () => {
    for (const slot of COPY_SLOTS) {
      for (const line of allCopy(slot)) {
        const text = `${line.title} ${line.body}`;
        expect(/[₦$€£]/.test(text), `${slot}: ${text}`).toBe(false);
        expect(/\d+%/.test(text), `${slot}: ${text}`).toBe(false);
      }
    }
  });

  it('has no duplicate lines within a slot', () => {
    for (const slot of COPY_SLOTS) {
      const titles = allCopy(slot).map((l) => l.title);
      expect(new Set(titles).size, slot).toBe(titles.length);
    }
  });
});
