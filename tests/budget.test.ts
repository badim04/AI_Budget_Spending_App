import { describe, it, expect } from 'vitest';
import {
  aggregateBudgets,
  allBudgetStatuses,
  budgetStatus,
  projectedExhaustionDate,
  rolloverInto,
  safeToSpend,
  spendForBudget,
  suggestAllocation,
  ROLLOVER_CAP_PERIODS,
  type BudgetContext,
} from '@/core/budget';
import { periodRange } from '@/core/dates';
import type { Budget, Transaction } from '@/core/types';

const NOW = '2026-08-13'; // day 13 of a 31-day month -> 41.9% elapsed

function tx(over: Partial<Transaction> & { amountMinor: number; date: string }): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    accountId: 'acc1',
    kind: over.amountMinor > 0 ? 'income' : 'expense',
    currency: 'NGN',
    merchant: 'Test',
    source: 'manual',
    confidence: 'high',
    reviewed: true,
    tags: [],
    dedupeKey: Math.random().toString(36),
    pending: false,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...over,
  } as Transaction;
}

function budget(over: Partial<Budget> = {}): Budget {
  return {
    id: 'b1',
    name: 'Food',
    categoryIds: ['food'],
    amountMinor: 10_000_00, // ₦10,000.00
    currency: 'NGN',
    period: 'monthly',
    rollover: 'reset',
    startsOn: '2026-01-01',
    alertThreshold: 0.8,
    archived: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function ctx(transactions: Transaction[], asOf = NOW): BudgetContext {
  return { transactions, excludedCategoryIds: new Set(['transfer']), asOf };
}

describe('spendForBudget', () => {
  it('sums only outflows in the matching category and period', () => {
    const c = ctx([
      tx({ amountMinor: -2_000_00, date: '2026-08-05', categoryId: 'food' }),
      tx({ amountMinor: -1_000_00, date: '2026-08-10', categoryId: 'food' }),
      tx({ amountMinor: -9_000_00, date: '2026-07-10', categoryId: 'food' }), // last month
      tx({ amountMinor: -5_000_00, date: '2026-08-10', categoryId: 'transport' }), // other cat
    ]);
    expect(spendForBudget(budget(), periodRange(NOW, 'monthly'), c).minor).toBe(3_000_00);
  });

  it('lets a refund reduce the period spend', () => {
    // The trap: summing absolute values would make a refunded purchase consume
    // twice the envelope instead of none of it.
    const c = ctx([
      tx({ amountMinor: -5_000_00, date: '2026-08-05', categoryId: 'food' }),
      tx({ amountMinor: 5_000_00, date: '2026-08-06', categoryId: 'food', kind: 'income' }),
    ]);
    expect(spendForBudget(budget(), periodRange(NOW, 'monthly'), c).minor).toBe(0);
  });

  it('counts only the matching lines of a split transaction', () => {
    const c = ctx([
      tx({
        amountMinor: -10_000_00,
        date: '2026-08-05',
        splits: [
          { categoryId: 'food', amountMinor: -6_000_00 },
          { categoryId: 'household', amountMinor: -4_000_00 },
        ],
      }),
    ]);
    expect(spendForBudget(budget(), periodRange(NOW, 'monthly'), c).minor).toBe(6_000_00);
  });

  it('ignores transfers, deleted rows and excluded categories', () => {
    const c = ctx([
      tx({ amountMinor: -3_000_00, date: '2026-08-05', categoryId: 'food', kind: 'transfer' }),
      tx({ amountMinor: -3_000_00, date: '2026-08-05', categoryId: 'food', deletedAt: 'x' }),
    ]);
    expect(spendForBudget(budget(), periodRange(NOW, 'monthly'), c).minor).toBe(0);
  });

  it('ignores transactions in another currency', () => {
    const c = ctx([
      tx({ amountMinor: -3_000_00, date: '2026-08-05', categoryId: 'food', currency: 'USD' }),
    ]);
    expect(spendForBudget(budget(), periodRange(NOW, 'monthly'), c).minor).toBe(0);
  });

  it('treats an empty category list as the catch-all envelope', () => {
    const c = ctx([
      tx({ amountMinor: -1_000_00, date: '2026-08-05', categoryId: 'anything' }),
      tx({ amountMinor: -1_000_00, date: '2026-08-06', categoryId: 'transfer' }), // excluded
    ]);
    const b = budget({ categoryIds: [] });
    expect(spendForBudget(b, periodRange(NOW, 'monthly'), c).minor).toBe(1_000_00);
  });
});

describe('pace classification', () => {
  it('is on_track when spend trails elapsed time', () => {
    // 20% spent, 42% of the month gone
    const s = budgetStatus(budget(), ctx([
      tx({ amountMinor: -2_000_00, date: '2026-08-05', categoryId: 'food' }),
    ]));
    expect(s.state).toBe('on_track');
    expect(s.utilisation).toBeCloseTo(0.2, 3);
  });

  it('warns when spend runs ahead of elapsed time', () => {
    // 70% spent, 42% of the month gone
    const s = budgetStatus(budget(), ctx([
      tx({ amountMinor: -7_000_00, date: '2026-08-05', categoryId: 'food' }),
    ]));
    expect(s.state).toBe('warning');
  });

  it('does not warn for a small overshoot inside the pace tolerance', () => {
    // 48% spent, 42% elapsed — within the 10-point tolerance
    const s = budgetStatus(budget(), ctx([
      tx({ amountMinor: -4_800_00, date: '2026-08-05', categoryId: 'food' }),
    ]));
    expect(s.state).toBe('on_track');
  });

  it('reports over once the envelope is exceeded', () => {
    const s = budgetStatus(budget(), ctx([
      tx({ amountMinor: -12_000_00, date: '2026-08-05', categoryId: 'food' }),
    ]));
    expect(s.state).toBe('over');
    expect(s.remaining.minor).toBe(-2_000_00);
    expect(s.safeToSpendPerDay.minor).toBe(0); // never suggests spending while over
  });

  it('projects end-of-period spend from the current burn rate', () => {
    // ₦4,000 in 13 of 31 days -> ~₦9,538 projected
    const s = budgetStatus(budget(), ctx([
      tx({ amountMinor: -4_000_00, date: '2026-08-05', categoryId: 'food' }),
    ]));
    expect(s.projected.minor).toBeGreaterThan(9_000_00);
    expect(s.projected.minor).toBeLessThan(10_000_00);
  });

  it('splits the remainder evenly across the days left', () => {
    const s = budgetStatus(budget(), ctx([
      tx({ amountMinor: -1_000_00, date: '2026-08-05', categoryId: 'food' }),
    ]));
    // ₦9,000 left over 18 remaining days
    expect(s.safeToSpendPerDay.minor).toBe(50_000);
  });

  it('classifies a finished period as ended_under / ended_over', () => {
    const c = ctx([tx({ amountMinor: -2_000_00, date: '2026-07-05', categoryId: 'food' })], NOW);
    expect(budgetStatus(budget(), c, '2026-07-15').state).toBe('ended_under');

    const c2 = ctx([tx({ amountMinor: -20_000_00, date: '2026-07-05', categoryId: 'food' })], NOW);
    expect(budgetStatus(budget(), c2, '2026-07-15').state).toBe('ended_over');
  });
});

describe('rollover', () => {
  const history = [
    tx({ amountMinor: -6_000_00, date: '2026-07-10', categoryId: 'food' }), // ₦4k under
    tx({ amountMinor: -8_000_00, date: '2026-06-10', categoryId: 'food' }), // ₦2k under
  ];

  it('carries nothing under the reset policy', () => {
    const r = rolloverInto(budget({ rollover: 'reset' }), periodRange(NOW, 'monthly'), ctx(history));
    expect(r.minor).toBe(0);
  });

  it('accumulates prior surpluses under the rollover policy', () => {
    const b = budget({ rollover: 'rollover', startsOn: '2026-06-01' });
    const r = rolloverInto(b, periodRange(NOW, 'monthly'), ctx(history));
    expect(r.minor).toBe(6_000_00); // ₦4k + ₦2k
  });

  it('lets an overspend carry forward as a deficit', () => {
    const b = budget({ rollover: 'rollover', startsOn: '2026-07-01' });
    const overspent = [tx({ amountMinor: -15_000_00, date: '2026-07-10', categoryId: 'food' })];
    expect(rolloverInto(b, periodRange(NOW, 'monthly'), ctx(overspent)).minor).toBe(-5_000_00);
  });

  it('damps the carry under the average policy', () => {
    const b = budget({ rollover: 'average', startsOn: '2026-06-01' });
    const r = rolloverInto(b, periodRange(NOW, 'monthly'), ctx(history));
    expect(r.minor).toBe(3_000_00); // half of the rollover carry
  });

  it('caps the carry so empty history cannot inflate the envelope', () => {
    // A budget that predates any transactions accrues a full surplus for every
    // empty period. Uncapped, this reported millions "safe to spend" on the
    // dashboard from a ₦10,000 monthly envelope.
    const b = budget({ rollover: 'rollover', startsOn: '2024-01-01' });
    const carry = rolloverInto(b, periodRange(NOW, 'monthly'), ctx([]));
    expect(carry.minor).toBe(b.amountMinor * ROLLOVER_CAP_PERIODS);
  });

  it('caps a carried deficit symmetrically', () => {
    const b = budget({ rollover: 'rollover', startsOn: '2024-01-01' });
    const heavyOverspend = Array.from({ length: 12 }, (_, i) =>
      tx({ amountMinor: -50_000_00, date: `2026-0${(i % 7) + 1}-10`, categoryId: 'food' })
    );
    const carry = rolloverInto(b, periodRange(NOW, 'monthly'), ctx(heavyOverspend));
    expect(carry.minor).toBe(-b.amountMinor * ROLLOVER_CAP_PERIODS);
  });

  it('does not look back past the budget start date', () => {
    const b = budget({ rollover: 'rollover', startsOn: '2026-08-01' });
    expect(rolloverInto(b, periodRange(NOW, 'monthly'), ctx(history)).minor).toBe(0);
  });

  it('raises the effective allocation the status is measured against', () => {
    const b = budget({ rollover: 'rollover', startsOn: '2026-06-01' });
    const s = budgetStatus(b, ctx([...history,
      tx({ amountMinor: -12_000_00, date: '2026-08-05', categoryId: 'food' }),
    ]));
    // ₦12k spent against ₦10k + ₦6k carried = still inside the envelope
    expect(s.effectiveAllocated.minor).toBe(16_000_00);
    expect(s.state).not.toBe('over');
  });
});

describe('safeToSpend', () => {
  it('does not let one overspent envelope drain the others', () => {
    const statuses = allBudgetStatuses(
      [
        budget({ id: 'b1', categoryIds: ['food'], amountMinor: 10_000_00 }),
        budget({ id: 'b2', name: 'Transport', categoryIds: ['transport'], amountMinor: 5_000_00 }),
      ],
      ctx([
        tx({ amountMinor: -15_000_00, date: '2026-08-05', categoryId: 'food' }), // ₦5k over
        tx({ amountMinor: -1_000_00, date: '2026-08-05', categoryId: 'transport' }),
      ])
    );
    // Transport has ₦4,000 left; food's -₦5,000 must not net it out to -₦1,000.
    expect(safeToSpend(statuses, 'NGN').minor).toBe(4_000_00);
  });
});

describe('allBudgetStatuses ordering', () => {
  it('surfaces overspent envelopes first', () => {
    const statuses = allBudgetStatuses(
      [
        budget({ id: 'ok', categoryIds: ['a'] }),
        budget({ id: 'over', categoryIds: ['b'] }),
      ],
      ctx([tx({ amountMinor: -20_000_00, date: '2026-08-05', categoryId: 'b' })])
    );
    expect(statuses[0].budget.id).toBe('over');
  });

  it('excludes archived and not-yet-started budgets', () => {
    const statuses = allBudgetStatuses(
      [
        budget({ id: 'archived', archived: true }),
        budget({ id: 'future', startsOn: '2027-01-01' }),
        budget({ id: 'ended', endsOn: '2026-01-01' }),
        budget({ id: 'live' }),
      ],
      ctx([])
    );
    expect(statuses.map((s) => s.budget.id)).toEqual(['live']);
  });
});

describe('aggregateBudgets', () => {
  it('totals allocation and spend across envelopes', () => {
    const statuses = allBudgetStatuses(
      [
        budget({ id: 'b1', categoryIds: ['food'], amountMinor: 10_000_00 }),
        budget({ id: 'b2', categoryIds: ['transport'], amountMinor: 5_000_00 }),
      ],
      ctx([tx({ amountMinor: -3_000_00, date: '2026-08-05', categoryId: 'food' })])
    );
    const agg = aggregateBudgets(statuses, 'NGN');
    expect(agg.allocated.minor).toBe(15_000_00);
    expect(agg.spent.minor).toBe(3_000_00);
    expect(agg.utilisation).toBeCloseTo(0.2, 3);
  });
});

describe('suggestAllocation', () => {
  it('uses the median so one outlier month does not inflate the suggestion', () => {
    const history = [
      tx({ amountMinor: -5_000_00, date: '2026-07-10', categoryId: 'food' }),
      tx({ amountMinor: -5_200_00, date: '2026-06-10', categoryId: 'food' }),
      tx({ amountMinor: -4_800_00, date: '2026-05-10', categoryId: 'food' }),
      tx({ amountMinor: -80_000_00, date: '2026-04-10', categoryId: 'food' }), // one-off
    ];
    const s = suggestAllocation(budget({ startsOn: '2026-01-01' }), ctx(history), 6);
    // A mean would land near ₦23,750; the median keeps it near a normal month.
    expect(s.minor).toBeLessThan(10_000_00);
    expect(s.minor).toBeGreaterThan(0);
  });
});

describe('projectedExhaustionDate', () => {
  it('predicts the day the envelope runs dry at the current rate', () => {
    const s = budgetStatus(budget(), ctx([
      tx({ amountMinor: -5_000_00, date: '2026-08-05', categoryId: 'food' }),
    ]));
    // ₦5k in 13 days -> ~₦385/day -> ₦5k left lasts ~13 more days
    const d = projectedExhaustionDate(s);
    expect(d).toBe('2026-08-26');
  });

  it('returns null when the envelope is projected to survive the period', () => {
    const s = budgetStatus(budget(), ctx([
      tx({ amountMinor: -500_00, date: '2026-08-05', categoryId: 'food' }),
    ]));
    expect(projectedExhaustionDate(s)).toBeNull();
  });
});
