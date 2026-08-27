/**
 * Tapping a bar in the spending breakdown has to open the transactions behind
 * it — all of them, and only them.
 *
 * The bug this exists for: "Uncategorised · ₦113,120 · 19 transactions" opened
 * an empty list. Two different values mean "no category" and the two ends of
 * the tap disagreed about which one — the chart hands over the sentinel
 * `__uncategorised__`, the list matched the seeded category `cat_uncategorised`.
 *
 * Nothing threw and nothing logged. It just quietly showed nothing.
 */

import { describe, it, expect } from 'vitest';
import { matchesCategorySelection, UNCATEGORISED, withOtherBucket } from '@/core/analytics';
import { UNCATEGORISED_ID } from '@/core/categorize';
import type { CategoryTotal } from '@/core/types';

describe('matchesCategorySelection', () => {
  it('matches an ordinary category', () => {
    expect(matchesCategorySelection('cat_transport', ['cat_transport'])).toBe(true);
    expect(matchesCategorySelection('cat_food', ['cat_transport'])).toBe(false);
  });

  it('matches a multi-category selection, as the Other bucket sends', () => {
    const selection = ['cat_food', 'cat_transport', 'cat_health'];
    expect(matchesCategorySelection('cat_transport', selection)).toBe(true);
    expect(matchesCategorySelection('cat_rent', selection)).toBe(false);
  });

  it('finds unfiled transactions from the chart sentinel', () => {
    // The exact failure: chart says `__uncategorised__`, transaction says null.
    expect(matchesCategorySelection(null, [UNCATEGORISED])).toBe(true);
    expect(matchesCategorySelection(undefined, [UNCATEGORISED])).toBe(true);
  });

  it('finds unfiled transactions from the seeded category id too', () => {
    expect(matchesCategorySelection(null, [UNCATEGORISED_ID])).toBe(true);
    expect(matchesCategorySelection(UNCATEGORISED_ID, [UNCATEGORISED])).toBe(true);
    expect(matchesCategorySelection(UNCATEGORISED_ID, [UNCATEGORISED_ID])).toBe(true);
  });

  it('does not drag filed transactions into the uncategorised bucket', () => {
    expect(matchesCategorySelection('cat_transport', [UNCATEGORISED])).toBe(false);
    expect(matchesCategorySelection('cat_transport', [UNCATEGORISED_ID])).toBe(false);
  });

  it('does not put unfiled transactions under a real category', () => {
    expect(matchesCategorySelection(null, ['cat_transport'])).toBe(false);
  });

  it('an empty selection is no filter at all', () => {
    expect(matchesCategorySelection('cat_transport', [])).toBe(true);
    expect(matchesCategorySelection(null, [])).toBe(true);
  });
});

describe('withOtherBucket', () => {
  const row = (id: string, minor: number): CategoryTotal => ({
    categoryId: id,
    categoryName: id,
    color: '#fff',
    icon: '•',
    total: { minor, currency: 'NGN' },
    transactionCount: 1,
    share: 0.1,
    changeVsPrevious: null,
  });

  it('carries the categories it rolled up, so the bar is not a dead end', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`cat_${i}`, 1000 - i));
    const bucketed = withOtherBucket(rows, 7, 'NGN');
    const other = bucketed[bucketed.length - 1];

    expect(other.categoryId).toBe('__other__');
    expect(other.memberIds).toEqual(['cat_7', 'cat_8', 'cat_9']);
    // Every rolled-up category can be reached from the bucket.
    for (const id of other.memberIds!) {
      expect(matchesCategorySelection(id, other.memberIds!)).toBe(true);
    }
  });

  it('leaves a short list alone, with nothing to expand', () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(`cat_${i}`, 100));
    const bucketed = withOtherBucket(rows, 7, 'NGN');
    expect(bucketed).toHaveLength(5);
    expect(bucketed.some((r) => r.categoryId === '__other__')).toBe(false);
  });
});
