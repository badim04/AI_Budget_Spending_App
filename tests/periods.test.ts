/**
 * Moving around in time, and comparing two stretches of it.
 *
 * The two things that make a period comparison lie:
 *
 *  1. Comparing a third of September against the whole of August, and
 *     announcing that spending has collapsed.
 *  2. Letting someone page into a month that has not happened, where an empty
 *     screen reads as a broken app rather than as "not yet".
 */

import { describe, it, expect } from 'vitest';
import {
  canGoForward,
  customRange,
  describeRange,
  elapsedRange,
  isCurrentMonth,
  matchingSlice,
  monthOf,
  monthsCovering,
  previousMonth,
  sameMonthLastYear,
  shiftMonths,
} from '@/core/periods';
import { comparePeriods, type AnalyticsContext } from '@/core/analytics';
import { FxTable } from '@/core/money';
import type { Account, Category, Transaction } from '@/core/types';

const TODAY = '2026-08-26';

describe('month navigation', () => {
  it('finds the month containing a date', () => {
    const m = monthOf(TODAY);
    expect(m.start).toBe('2026-08-01');
    expect(m.end).toBe('2026-08-31');
  });

  it('steps backwards and forwards', () => {
    const august = monthOf(TODAY);
    expect(shiftMonths(august, -1).start).toBe('2026-07-01');
    expect(shiftMonths(august, 1).start).toBe('2026-09-01');
    expect(previousMonth(august).end).toBe('2026-07-31');
  });

  it('handles the year boundary', () => {
    const january = monthOf('2026-01-15');
    expect(previousMonth(january).start).toBe('2025-12-01');
    expect(shiftMonths(january, 1).start).toBe('2026-02-01');
  });

  it('lands on the right February', () => {
    // 2028 is a leap year; 2026 is not.
    expect(monthOf('2026-02-10').end).toBe('2026-02-28');
    expect(monthOf('2028-02-10').end).toBe('2028-02-29');
  });

  it('will not walk into the future', () => {
    const august = monthOf(TODAY);
    expect(canGoForward(previousMonth(august), TODAY)).toBe(true);
    expect(canGoForward(august, TODAY)).toBe(false);
  });

  it('knows which month is the live one', () => {
    expect(isCurrentMonth(monthOf(TODAY), TODAY)).toBe(true);
    expect(isCurrentMonth(previousMonth(monthOf(TODAY)), TODAY)).toBe(false);
  });

  it('goes back a year for the same month', () => {
    expect(sameMonthLastYear(monthOf(TODAY)).start).toBe('2025-08-01');
    expect(sameMonthLastYear(monthOf(TODAY)).end).toBe('2025-08-31');
  });
});

describe('partial periods', () => {
  it('stops the current month at today', () => {
    const august = monthOf(TODAY);
    expect(elapsedRange(august, TODAY).end).toBe(TODAY);
  });

  it('leaves a finished month whole', () => {
    const july = previousMonth(monthOf(TODAY));
    expect(elapsedRange(july, TODAY).end).toBe('2026-07-31');
  });

  it('compares like with like', () => {
    // 26 days of August have run, so measure the first 26 days of July.
    const august = elapsedRange(monthOf(TODAY), TODAY);
    const july = matchingSlice(previousMonth(monthOf(TODAY)), august);
    expect(july.start).toBe('2026-07-01');
    expect(july.end).toBe('2026-07-26');
  });

  it('never runs a slice past the end of the target month', () => {
    // A 31-day slice mapped onto February has to stop at the 28th.
    const january = monthOf('2026-01-31');
    const elapsed = elapsedRange(january, '2026-01-31');
    const february = matchingSlice(monthOf('2026-02-01'), elapsed);
    expect(february.end).toBe('2026-02-28');
  });
});

describe('labels', () => {
  it('names the live month and the one before it', () => {
    expect(describeRange(monthOf(TODAY), TODAY)).toBe('This month');
    expect(describeRange(previousMonth(monthOf(TODAY)), TODAY)).toBe('Last month');
  });

  it('spells out anything further back', () => {
    const june = shiftMonths(monthOf(TODAY), -2);
    expect(describeRange(june, TODAY)).toBe(june.label);
    expect(describeRange(june, TODAY)).not.toMatch(/this|last/i);
  });

  it('orders a custom range whichever way it is given', () => {
    expect(customRange('2026-08-20', '2026-08-01').start).toBe('2026-08-01');
    expect(customRange('2026-08-20', '2026-08-01').end).toBe('2026-08-20');
  });
});

describe('monthsCovering', () => {
  it('lists every month from the oldest transaction to now, newest first', () => {
    const months = monthsCovering(['2026-06-30', '2026-07-15', '2026-08-02'], TODAY);
    expect(months.map((m) => m.start)).toEqual(['2026-08-01', '2026-07-01', '2026-06-01']);
  });

  it('offers the current month when there is nothing at all', () => {
    expect(monthsCovering([], TODAY).map((m) => m.start)).toEqual(['2026-08-01']);
  });
});

// ------------------------------------------------------------------ compare

const categories: Category[] = [
  { id: 'c_food', name: 'Food', kind: 'expense', icon: '🍚', color: '#f00', excludeFromTotals: false, sortOrder: 1, archived: false, isSystem: true },
  { id: 'c_transport', name: 'Transport', kind: 'expense', icon: '🚕', color: '#00f', excludeFromTotals: false, sortOrder: 2, archived: false, isSystem: true },
];

const accounts: Account[] = [
  {
    id: 'a1',
    name: 'Wallet',
    kind: 'cash',
    currency: 'NGN',
    openingBalanceMinor: 0,
    openedAt: '2026-01-01',
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

function tx(id: string, date: string, minor: number, categoryId: string): Transaction {
  return {
    id, accountId: 'a1', kind: 'expense', amountMinor: minor, currency: 'NGN', date,
    merchant: id, categoryId, source: 'manual', confidence: 'high', reviewed: true,
    tags: [], dedupeKey: id, pending: false, createdAt: date, updatedAt: date,
  };
}

function ctxOf(transactions: Transaction[]): AnalyticsContext {
  return {
    transactions,
    categories,
    accounts,
    displayCurrency: 'NGN',
    fx: new FxTable('NGN'),
    asOf: TODAY,
  };
}

describe('comparePeriods', () => {
  const august = monthOf(TODAY);
  const july = previousMonth(august);

  it('totals both sides and the movement between them', () => {
    const ctx = ctxOf([
      tx('t1', '2026-07-05', -100_00, 'c_food'),
      tx('t2', '2026-08-05', -150_00, 'c_food'),
    ]);
    const result = comparePeriods(august, july, ctx);

    expect(result.current.minor).toBe(150_00);
    expect(result.previous.minor).toBe(100_00);
    expect(result.deltaMinor).toBe(50_00);
    expect(result.change).toBeCloseTo(0.5);
  });

  it('ranks by how much moved, up or down', () => {
    const ctx = ctxOf([
      tx('t1', '2026-07-05', -10_00, 'c_food'),
      tx('t2', '2026-08-05', -20_00, 'c_food'),
      tx('t3', '2026-07-06', -900_00, 'c_transport'),
      tx('t4', '2026-08-06', -100_00, 'c_transport'),
    ]);
    const result = comparePeriods(august, july, ctx);

    // Transport fell by ₦800; food rose by ₦10. The fall is the story.
    expect(result.categories[0].categoryId).toBe('c_transport');
    expect(result.categories[0].deltaMinor).toBe(-800_00);
  });

  it('includes a category that only appears on one side', () => {
    const ctx = ctxOf([tx('t1', '2026-08-05', -50_00, 'c_food')]);
    const result = comparePeriods(august, july, ctx);

    const food = result.categories.find((d) => d.categoryId === 'c_food')!;
    expect(food.previous.minor).toBe(0);
    expect(food.current.minor).toBe(50_00);
    // New, not "up infinity percent".
    expect(food.change).toBeNull();
  });

  it('says nothing rather than dividing by zero', () => {
    const result = comparePeriods(august, july, ctxOf([]));
    expect(result.change).toBeNull();
    expect(result.deltaMinor).toBe(0);
  });

  it('compares equal slices when the current month is unfinished', () => {
    const ctx = ctxOf([
      // July: spending spread across the whole month.
      tx('t1', '2026-07-05', -100_00, 'c_food'),
      tx('t2', '2026-07-30', -900_00, 'c_food'),
      // August: only the early spend has happened yet.
      tx('t3', '2026-08-05', -120_00, 'c_food'),
    ]);

    const elapsed = elapsedRange(august, TODAY);
    const fair = comparePeriods(elapsed, matchingSlice(july, elapsed), ctx);
    const unfair = comparePeriods(elapsed, july, ctx);

    // Like for like, August is slightly ahead. Against the whole of July it
    // looks like an 88% collapse, which is the lie this guards against.
    expect(fair.deltaMinor).toBe(20_00);
    expect(unfair.deltaMinor).toBe(-880_00);
  });
});
