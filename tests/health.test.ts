/**
 * The financial health score.
 *
 * These are written against the ways a score like this goes wrong, because the
 * arithmetic is the easy part. A health score is a number people will read as a
 * verdict on themselves, so the failures that matter are: scoring someone down
 * for something the app cannot see, claiming confidence off one month of data,
 * and offering a judgement with no lever attached.
 */

import { describe, it, expect } from 'vitest';
import {
  bandFor,
  describeHealth,
  financialHealth,
  type HealthKey,
} from '@/core/health';
import type { AnalyticsContext } from '@/core/analytics';
import type { Account, BudgetStatus, Category, Transaction } from '@/core/types';

const TODAY = '2026-08-15';

const categories: Category[] = [
  { id: 'cat_food', name: 'Food', kind: 'expense', icon: '🍽️', color: '#f00', archived: false },
  { id: 'cat_pay', name: 'Salary', kind: 'income', icon: '💰', color: '#0f0', archived: false },
] as unknown as Category[];

const account: Account = {
  id: 'acc1',
  name: 'Main',
  kind: 'bank',
  currency: 'NGN',
  openingBalanceMinor: 0,
  openedAt: '2025-01-01',
  archived: false,
} as unknown as Account;

let seq = 0;
function tx(date: string, amountMinor: number, categoryId = 'cat_food'): Transaction {
  seq += 1;
  return {
    id: `t${seq}`,
    accountId: 'acc1',
    kind: amountMinor > 0 ? 'income' : 'expense',
    amountMinor,
    currency: 'NGN',
    date,
    merchant: 'x',
    categoryId,
    source: 'manual',
    confidence: 'high',
    reviewed: true,
    tags: [],
    dedupeKey: `k${seq}`,
    pending: false,
    createdAt: date,
    updatedAt: date,
  } as unknown as Transaction;
}

function ctxOf(transactions: Transaction[]): AnalyticsContext {
  return {
    transactions,
    accounts: [account],
    categories,
    displayCurrency: 'NGN',
    asOf: TODAY,
    rates: {},
  } as unknown as AnalyticsContext;
}

/** Twelve complete months of earning 100k and spending 80k. */
function steadyYear(): Transaction[] {
  const rows: Transaction[] = [];
  for (let m = 8; m <= 19; m++) {
    const year = 2025 + Math.floor(m / 12);
    const month = String((m % 12) + 1).padStart(2, '0');
    if (`${year}-${month}-01` >= '2026-08-01') break;
    rows.push(tx(`${year}-${month}-01`, 10_000_00, 'cat_pay'));
    rows.push(tx(`${year}-${month}-05`, -8_000_00));
  }
  return rows;
}

const noBudgets: BudgetStatus[] = [];

function budget(id: string, state: string, amountMinor = 100_00): BudgetStatus {
  return { budget: { id, name: id, amountMinor }, state } as unknown as BudgetStatus;
}

describe('bandFor', () => {
  it('names each band at its boundary', () => {
    expect(bandFor(80).band).toBe('strong');
    expect(bandFor(79).band).toBe('fine');
    expect(bandFor(60).band).toBe('fine');
    expect(bandFor(59).band).toBe('attention');
    expect(bandFor(40).band).toBe('attention');
    expect(bandFor(39).band).toBe('fragile');
    expect(bandFor(0).band).toBe('fragile');
  });

  it('has a distinct band for no score at all', () => {
    expect(bandFor(null).band).toBe('unknown');
  });
});

describe('financialHealth', () => {
  /**
   * The rule that matters most.
   *
   * Finlo cannot see your insurance or your pension. A score that counted those
   * as zero would tell someone with excellent finances that they are failing.
   */
  it('leaves an unmeasurable component out of the average instead of scoring it zero', () => {
    // No budgets at all: the budgets component cannot be measured.
    const health = financialHealth(ctxOf(steadyYear()), noBudgets);

    const budgets = health.components.find((x) => x.key === 'budgets')!;
    expect(budgets.score).toBeNull();
    expect(health.untracked).toContain<HealthKey>('budgets');

    // And the total is the mean of the ones that could be measured.
    const measured = health.components.filter((x) => x.score != null);
    const expected = Math.round(
      measured.reduce((sum, x) => sum + (x.score ?? 0), 0) / measured.length
    );
    expect(health.score).toBe(expected);
  });

  it('scores nothing at all when there is no data to score', () => {
    const health = financialHealth(ctxOf([]), noBudgets);
    expect(health.score).toBeNull();
    expect(health.band).toBe('unknown');
    expect(describeHealth(health)).toMatch(/Add a month of transactions/);
  });

  it('reports low confidence on thin history and high on a full year', () => {
    const thin = financialHealth(ctxOf([tx('2026-07-01', -5_000_00)]), noBudgets);
    expect(thin.confidence).toBe('low');

    const full = financialHealth(ctxOf(steadyYear()), [budget('b1', 'on_track')]);
    expect(full.monthsOfHistory).toBeGreaterThanOrEqual(6);
    expect(full.confidence).toBe('high');
  });

  it('scores saving from what actually survived the month', () => {
    // Earned 100k, spent 80k last month -> kept 20% -> the target -> 100.
    const health = financialHealth(ctxOf(steadyYear()), noBudgets);
    const saving = health.components.find((x) => x.key === 'saving')!;
    expect(saving.score).toBe(100);
    expect(saving.detail).toContain('20%');
  });

  it('does not score saving below zero when someone overspends', () => {
    const rows = [tx('2026-07-01', 1_000_00, 'cat_pay'), tx('2026-07-02', -5_000_00)];
    const health = financialHealth(ctxOf(rows), noBudgets);
    const saving = health.components.find((x) => x.key === 'saving')!;
    expect(saving.score).toBe(0);
    expect(saving.detail).toMatch(/spent more than you earned/);
  });

  /**
   * Steady spending is most of what financial health looks like.
   *
   * An earlier version ramped symmetrically about zero, so a perfectly stable
   * month scored 50 while the sentence beside it read "last month tracked your
   * usual". The number and the words disagreed, and the words were right.
   */
  it('rewards a month that tracks the usual rather than calling it average', () => {
    const health = financialHealth(ctxOf(steadyYear()), noBudgets);
    const trend = health.components.find((x) => x.key === 'spending')!;

    expect(trend.detail).toMatch(/tracked your usual/);
    expect(trend.score).toBeGreaterThanOrEqual(70);
  });

  it('marks a month well above the usual as the weakest part', () => {
    const rows = steadyYear();
    rows.push(tx('2026-07-20', -8_000_00)); // doubles July's spend
    const health = financialHealth(ctxOf(rows), noBudgets);
    const trend = health.components.find((x) => x.key === 'spending')!;

    expect(trend.score).toBe(0);
    expect(trend.detail).toMatch(/above your usual/);
  });

  it('counts an overspent envelope as worse than one merely ahead of pace', () => {
    const rows = steadyYear();
    const over = financialHealth(ctxOf(rows), [budget('a', 'over'), budget('b', 'on_track')]);
    const warn = financialHealth(ctxOf(rows), [budget('a', 'warning'), budget('b', 'on_track')]);

    const scoreOf = (h: ReturnType<typeof financialHealth>) =>
      h.components.find((x) => x.key === 'budgets')!.score;

    expect(scoreOf(over)).toBe(50);
    expect(scoreOf(warn)).toBe(75);
  });

  /**
   * A score with no lever is a judgement rather than advice.
   */
  it('gives every imperfect component something the user could do about it', () => {
    const rows = [tx('2026-07-01', 1_000_00, 'cat_pay'), tx('2026-07-02', -5_000_00)];
    const health = financialHealth(ctxOf(rows), [budget('a', 'over')]);

    const actionable = health.components.filter((x) => x.score != null && x.score < 100);
    expect(actionable.length).toBeGreaterThan(0);
    for (const component of actionable) {
      expect(component.lever, `${component.key} has no lever`).toBeTruthy();
    }
  });

  it('never returns a score outside 0-100', () => {
    for (const rows of [[], steadyYear(), [tx('2026-07-01', -900_000_00)]]) {
      const health = financialHealth(ctxOf(rows), [budget('a', 'over')]);
      if (health.score != null) {
        expect(health.score).toBeGreaterThanOrEqual(0);
        expect(health.score).toBeLessThanOrEqual(100);
      }
      for (const component of health.components) {
        if (component.score == null) continue;
        expect(component.score, component.key).toBeGreaterThanOrEqual(0);
        expect(component.score, component.key).toBeLessThanOrEqual(100);
      }
    }
  });

  /** The current month is incomplete by definition and would inflate the score. */
  it('ignores the current partial month', () => {
    const withPartial = steadyYear().concat(tx('2026-08-02', -50_00));
    const without = financialHealth(ctxOf(steadyYear()), noBudgets);
    const with_ = financialHealth(ctxOf(withPartial), noBudgets);
    expect(with_.monthsOfHistory).toBe(without.monthsOfHistory);
  });
});

describe('describeHealth', () => {
  it('names the weakest measured component, not the total', () => {
    const rows = [tx('2026-07-01', 1_000_00, 'cat_pay'), tx('2026-07-02', -5_000_00)];
    const health = financialHealth(ctxOf(rows), noBudgets);
    const sentence = describeHealth(health);

    const measured = health.components.filter((x) => x.score != null);
    const weakest = [...measured].sort((a, b) => (a.score ?? 0) - (b.score ?? 0))[0];
    expect(sentence).toContain(weakest.label);
  });

  it('is deterministic', () => {
    const health = financialHealth(ctxOf(steadyYear()), noBudgets);
    expect(describeHealth(health)).toBe(describeHealth(health));
  });
});
