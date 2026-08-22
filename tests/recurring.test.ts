import { describe, it, expect } from 'vitest';
import {
  candidateToRule,
  detectRecurring,
  missedOccurrences,
  monthlyCommitment,
} from '@/core/recurring';
import type { RecurringRule, Transaction } from '@/core/types';

function tx(over: Partial<Transaction> & { date: string; amountMinor: number }): Transaction {
  return {
    id: `tx_${over.date}_${Math.abs(over.amountMinor)}_${Math.random().toString(36).slice(2, 6)}`,
    accountId: 'acc1',
    kind: over.amountMinor > 0 ? 'income' : 'expense',
    currency: 'NGN',
    merchant: 'Netflix',
    rawDescription: 'NETFLIX.COM',
    source: 'manual',
    confidence: 'high',
    reviewed: true,
    tags: [],
    dedupeKey: Math.random().toString(36),
    pending: false,
    createdAt: '',
    updatedAt: '',
    ...over,
  } as Transaction;
}

/** n monthly charges on the same day. */
function monthly(count: number, day = 18, amount = -7_200_00, merchant = 'NETFLIX.COM') {
  const out: Transaction[] = [];
  for (let i = 0; i < count; i++) {
    const month = String(i + 1).padStart(2, '0');
    out.push(
      tx({
        date: `2026-${month}-${String(day).padStart(2, '0')}`,
        amountMinor: amount,
        merchant,
        rawDescription: merchant,
        categoryId: 'cat_subscriptions',
      })
    );
  }
  return out;
}

describe('detectRecurring', () => {
  it('finds a fixed monthly subscription', () => {
    const found = detectRecurring(monthly(6));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      frequency: 'monthly',
      dayOfMonth: 18,
      amountMinor: -7_200_00,
      occurrences: 6,
      variableAmount: false,
    });
    expect(found[0].confidence).toBeGreaterThan(0.8);
  });

  it('predicts the next occurrence', () => {
    const found = detectRecurring(monthly(6));
    expect(found[0].nextExpected).toBe('2026-07-18');
  });

  it('needs at least three occurrences', () => {
    expect(detectRecurring(monthly(2))).toHaveLength(0);
    expect(detectRecurring(monthly(3)).length).toBeGreaterThan(0);
  });

  it('detects weekly and biweekly cadences', () => {
    const weekly = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'].map((date) =>
      tx({ date, amountMinor: -2_000_00, merchant: 'GYM', rawDescription: 'GYM' })
    );
    expect(detectRecurring(weekly)[0].frequency).toBe('weekly');

    const fortnightly = ['2026-01-05', '2026-01-19', '2026-02-02', '2026-02-16'].map((date) =>
      tx({ date, amountMinor: 250_000_00, merchant: 'WAGES', rawDescription: 'WAGES' })
    );
    expect(detectRecurring(fortnightly)[0].frequency).toBe('biweekly');
  });

  it('tolerates month-length variation on a monthly bill', () => {
    // 31, 28, 31, 30 day gaps — a naive equality check would reject this.
    const rent = ['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05', '2026-05-05'].map(
      (date) => tx({ date, amountMinor: -450_000_00, merchant: 'RENT', rawDescription: 'RENT' })
    );
    expect(detectRecurring(rent)[0].frequency).toBe('monthly');
  });

  it('flags a variable amount but still detects the cadence', () => {
    const power = [
      tx({ date: '2026-01-12', amountMinor: -28_000_00, merchant: 'IKEJA ELECTRIC', rawDescription: 'IKEJA ELECTRIC' }),
      tx({ date: '2026-02-12', amountMinor: -35_000_00, merchant: 'IKEJA ELECTRIC', rawDescription: 'IKEJA ELECTRIC' }),
      tx({ date: '2026-03-12', amountMinor: -31_000_00, merchant: 'IKEJA ELECTRIC', rawDescription: 'IKEJA ELECTRIC' }),
      tx({ date: '2026-04-12', amountMinor: -33_000_00, merchant: 'IKEJA ELECTRIC', rawDescription: 'IKEJA ELECTRIC' }),
    ];
    const found = detectRecurring(power);
    expect(found[0].frequency).toBe('monthly');
    expect(found[0].variableAmount).toBe(true);
  });

  it('rejects amounts that swing wildly', () => {
    const groceries = [
      tx({ date: '2026-01-10', amountMinor: -5_000_00, merchant: 'SHOPRITE', rawDescription: 'SHOPRITE' }),
      tx({ date: '2026-02-10', amountMinor: -90_000_00, merchant: 'SHOPRITE', rawDescription: 'SHOPRITE' }),
      tx({ date: '2026-03-10', amountMinor: -2_000_00, merchant: 'SHOPRITE', rawDescription: 'SHOPRITE' }),
      tx({ date: '2026-04-10', amountMinor: -70_000_00, merchant: 'SHOPRITE', rawDescription: 'SHOPRITE' }),
    ];
    expect(detectRecurring(groceries)).toHaveLength(0);
  });

  it('rejects irregular timing', () => {
    const random = ['2026-01-03', '2026-01-09', '2026-03-22', '2026-03-24', '2026-07-01'].map(
      (date) => tx({ date, amountMinor: -5_000_00, merchant: 'RANDOM', rawDescription: 'RANDOM' })
    );
    expect(detectRecurring(random)).toHaveLength(0);
  });

  it('treats two charges on the same day as one occurrence', () => {
    const doubled = [
      ...monthly(4),
      tx({ date: '2026-03-18', amountMinor: -7_200_00, rawDescription: 'NETFLIX.COM' }),
    ];
    const found = detectRecurring(doubled);
    expect(found[0].occurrences).toBe(4);
  });

  it('clamps a late-month day to 28 so February is never skipped', () => {
    const found = detectRecurring(monthly(4, 30, -10_000_00, 'LATE BILL'));
    expect(found[0].dayOfMonth).toBe(28);
  });

  it('separates the same merchant on two different accounts', () => {
    const all = [
      ...monthly(4),
      ...monthly(4).map((t) => ({ ...t, accountId: 'acc2', id: t.id + '_b' })),
    ];
    const found = detectRecurring(all);
    expect(found).toHaveLength(2);
    expect(new Set(found.map((f) => f.accountId))).toEqual(new Set(['acc1', 'acc2']));
  });

  it('skips merchants that already have a rule', () => {
    const found = detectRecurring(monthly(6), { existingKeys: new Set(['netflix com']) });
    expect(found).toHaveLength(0);
  });

  it('ignores transfers, pending rows and deleted rows', () => {
    expect(detectRecurring(monthly(6).map((t) => ({ ...t, kind: 'transfer' as const })))).toHaveLength(0);
    expect(detectRecurring(monthly(6).map((t) => ({ ...t, pending: true })))).toHaveLength(0);
    expect(detectRecurring(monthly(6).map((t) => ({ ...t, deletedAt: 'x' })))).toHaveLength(0);
  });

  it('carries the most common category onto the candidate', () => {
    expect(detectRecurring(monthly(5))[0].categoryId).toBe('cat_subscriptions');
  });

  it('detects income as well as expenses', () => {
    const salary = monthly(5, 25, 1_150_000_00, 'SALARY');
    const found = detectRecurring(salary);
    expect(found[0].kind).toBe('income');
    expect(found[0].amountMinor).toBeGreaterThan(0);
  });
});

describe('candidateToRule', () => {
  it('starts the rule at the first observation so projections match history', () => {
    const candidate = detectRecurring(monthly(5))[0];
    const rule = candidateToRule(candidate, 'rec_1', '2026-06-01T00:00:00Z');
    expect(rule).toMatchObject({
      id: 'rec_1',
      frequency: 'monthly',
      dayOfMonth: 18,
      startsOn: '2026-01-18',
      autoDetected: true,
      active: true,
    });
  });
});

describe('monthlyCommitment', () => {
  const rule = (over: Partial<RecurringRule>): RecurringRule => ({
    id: 'r',
    name: 'x',
    accountId: 'acc1',
    kind: 'expense',
    amountMinor: -10_000_00,
    currency: 'NGN',
    frequency: 'monthly',
    interval: 1,
    startsOn: '2026-01-01',
    autoDetected: false,
    variableAmount: false,
    active: true,
    createdAt: '',
    updatedAt: '',
    ...over,
  });

  it('normalises every frequency onto a monthly figure', () => {
    const total = monthlyCommitment(
      [rule({ id: 'a' }), rule({ id: 'b', frequency: 'annually', amountMinor: -1_200_000_00 })],
      'NGN'
    );
    // 10,000/month + 1,200,000/year (=100,000/month)
    expect(total).toBe(110_000_00);
  });

  it('separates income from expenses', () => {
    const rules = [rule({ id: 'a' }), rule({ id: 'b', amountMinor: 500_000_00, kind: 'income' })];
    expect(monthlyCommitment(rules, 'NGN', 'expense')).toBe(10_000_00);
    expect(monthlyCommitment(rules, 'NGN', 'income')).toBe(500_000_00);
  });

  it('ignores inactive rules and other currencies', () => {
    const rules = [rule({ id: 'a', active: false }), rule({ id: 'b', currency: 'USD' })];
    expect(monthlyCommitment(rules, 'NGN')).toBe(0);
  });
});

describe('missedOccurrences', () => {
  const netflix: RecurringRule = {
    id: 'r1',
    name: 'Netflix',
    merchant: 'Netflix',
    accountId: 'acc1',
    kind: 'expense',
    amountMinor: -7_200_00,
    currency: 'NGN',
    frequency: 'monthly',
    interval: 1,
    startsOn: '2026-01-18',
    dayOfMonth: 18,
    lastGeneratedOn: '2026-05-18',
    autoDetected: true,
    variableAmount: false,
    active: true,
    createdAt: '',
    updatedAt: '',
  };

  it('reports a bill that never arrived', () => {
    const missed = missedOccurrences([netflix], [], '2026-07-01');
    expect(missed).toHaveLength(1);
    expect(missed[0].expected).toBe('2026-06-18');
  });

  it('stays quiet when the charge did arrive', () => {
    const paid = [tx({ date: '2026-06-18', amountMinor: -7_200_00, rawDescription: 'NETFLIX.COM' })];
    expect(missedOccurrences([netflix], paid, '2026-07-01')).toHaveLength(0);
  });

  it('allows a grace period before complaining', () => {
    expect(missedOccurrences([netflix], [], '2026-06-19')).toHaveLength(0);
  });
});
