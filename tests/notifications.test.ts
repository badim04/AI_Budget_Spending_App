/**
 * The notifications feed.
 *
 * What has to hold: every entry carries the date the thing actually happened,
 * ids stay stable across recomputation (a read marker is stored against them),
 * and the ordering does not reshuffle between renders.
 */

import { describe, it, expect } from 'vitest';
import {
  buildNotices,
  parseReadIds,
  serialiseReadIds,
  unreadCount,
  type NoticeInput,
} from '@/core/notifications';
import type { BudgetStatus, RecurringRule, Transaction } from '@/core/types';

const TODAY = '2026-08-30';

let seq = 0;
function tx(date: string, amountMinor: number, extra: Partial<Transaction> = {}): Transaction {
  seq += 1;
  return {
    id: `t${seq}`,
    accountId: 'acc1',
    kind: amountMinor > 0 ? 'income' : 'expense',
    amountMinor,
    currency: 'NGN',
    date,
    merchant: 'Shop',
    categoryId: 'cat_food',
    source: 'manual',
    confidence: 'high',
    reviewed: true,
    tags: [],
    dedupeKey: `k${seq}`,
    pending: false,
    createdAt: `${date}T10:00:00.000Z`,
    updatedAt: `${date}T10:00:00.000Z`,
    ...extra,
  } as unknown as Transaction;
}

function input(over: Partial<NoticeInput> = {}): NoticeInput {
  return {
    transactions: [],
    budgetStatuses: [],
    recurringRules: [],
    asOf: TODAY,
    ...over,
  };
}

function overBudget(spentMinor: number, allocatedMinor: number): BudgetStatus {
  return {
    budget: { id: 'b1', name: 'Food', amountMinor: allocatedMinor, categoryIds: ['cat_food'] },
    state: 'over',
    range: { start: '2026-08-01', end: '2026-08-31', label: 'August 2026' },
    spent: { minor: spentMinor, currency: 'NGN' },
    effectiveAllocated: { minor: allocatedMinor, currency: 'NGN' },
    utilisation: spentMinor / allocatedMinor,
  } as unknown as BudgetStatus;
}

describe('buildNotices', () => {
  /**
   * The point of the whole module.
   *
   * "Your Food budget is over", stamped today, is a status wearing an event's
   * clothes. Dating it by the transaction that crossed the line is what makes
   * it still useful a week later.
   */
  it('dates an overspent envelope by the transaction that crossed it', () => {
    const rows = [
      tx('2026-08-05', -400_00),
      tx('2026-08-12', -400_00), // running total 800 > 700: this is the one
      tx('2026-08-20', -400_00),
    ];
    const notices = buildNotices(input({ transactions: rows, budgetStatuses: [overBudget(1_200_00, 700_00)] }));
    const over = notices.find((n) => n.kind === 'budget')!;

    expect(over.date).toBe('2026-08-12');
    expect(over.body).toContain('12 Aug');
    expect(over.severity).toBe('critical');
  });

  it('gives the same notice the same id on every rebuild', () => {
    const rows = [tx('2026-08-12', -900_00)];
    const args = input({ transactions: rows, budgetStatuses: [overBudget(900_00, 700_00)] });

    const a = buildNotices(args).map((n) => n.id);
    const b = buildNotices(args).map((n) => n.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length); // and no duplicates
  });

  it('flags a charge against that merchant’s own history, not against everything', () => {
    // Rent is always large and is never news; a 10x coffee is.
    const rows = [
      tx('2026-08-01', -500_000_00, { merchant: 'Landlord' }),
      tx('2026-07-01', -500_000_00, { merchant: 'Landlord' }),
      tx('2026-06-01', -500_000_00, { merchant: 'Landlord' }),
      tx('2026-05-01', -500_000_00, { merchant: 'Landlord' }),
      tx('2026-08-02', -1_000_00, { merchant: 'Cafe' }),
      tx('2026-08-09', -1_000_00, { merchant: 'Cafe' }),
      tx('2026-08-16', -1_000_00, { merchant: 'Cafe' }),
      tx('2026-08-23', -12_000_00, { merchant: 'Cafe' }),
    ];
    const notices = buildNotices(input({ transactions: rows }));
    const unusual = notices.filter((n) => n.kind === 'unusual');

    expect(unusual).toHaveLength(1);
    expect(unusual[0].title).toContain('Cafe');
    expect(unusual[0].date).toBe('2026-08-23');
  });

  it('does not flag a merchant with too little history to have a pattern', () => {
    const rows = [tx('2026-08-20', -1_00, { merchant: 'New' }), tx('2026-08-21', -900_00, { merchant: 'New' })];
    expect(buildNotices(input({ transactions: rows })).filter((n) => n.kind === 'unusual')).toEqual([]);
  });

  /**
   * An import of six months of statement is one event on the day it was run,
   * not two hundred events scattered across half a year.
   */
  it('groups an import into one entry on the day it was run', () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      tx(`2026-0${3 + (i % 5)}-1${i % 9}`, -1_00, {
        source: 'csv_import',
        createdAt: '2026-08-28T09:00:00.000Z',
      })
    );
    const imports = buildNotices(input({ transactions: rows })).filter((n) => n.kind === 'import');

    expect(imports).toHaveLength(1);
    expect(imports[0].date).toBe('2026-08-28');
    expect(imports[0].title).toContain('30 transactions');
  });

  it('only mentions bills inside the horizon', () => {
    const rule = {
      id: 'r1',
      name: 'Rent',
      accountId: 'acc1',
      kind: 'expense',
      amountMinor: -450_000_00,
      currency: 'NGN',
      frequency: 'monthly',
      interval: 1,
      startsOn: '2026-01-01',
      dayOfMonth: 1,
      autoDetected: false,
      variableAmount: false,
      active: true,
    } as unknown as RecurringRule;

    // 1 Sep is two days after 30 Aug: inside the horizon.
    const soon = buildNotices(input({ recurringRules: [rule] })).filter((n) => n.kind === 'bill');
    expect(soon).toHaveLength(1);
    expect(soon[0].date).toBe('2026-09-01');

    // From the 2nd, the next one is a month out: outside it.
    const later = buildNotices(
      input({ recurringRules: [rule], asOf: '2026-09-02' })
    ).filter((n) => n.kind === 'bill');
    expect(later).toEqual([]);
  });

  it('sorts newest first and breaks ties without reshuffling', () => {
    const rows = [
      tx('2026-08-12', -900_00),
      tx('2026-08-29', -50_00, { reviewed: false }),
    ];
    const args = input({ transactions: rows, budgetStatuses: [overBudget(950_00, 700_00)] });

    const dates = buildNotices(args).map((n) => n.date);
    expect([...dates]).toEqual([...dates].sort((a, b) => b.localeCompare(a)));
    expect(buildNotices(args)).toEqual(buildNotices(args));
  });

  it('says nothing when nothing has happened', () => {
    expect(buildNotices(input())).toEqual([]);
  });
});

describe('read markers', () => {
  it('round-trips', () => {
    const ids = new Set(['a', 'b', 'c']);
    expect(parseReadIds(serialiseReadIds(ids))).toEqual(ids);
  });

  it('survives a corrupt value rather than breaking the feed', () => {
    expect(parseReadIds('not json')).toEqual(new Set());
    expect(parseReadIds('{"a":1}')).toEqual(new Set());
    expect(parseReadIds(undefined)).toEqual(new Set());
  });

  it('caps the list so one settings row cannot grow forever', () => {
    const many = Array.from({ length: 900 }, (_, i) => `n${i}`);
    const kept = parseReadIds(serialiseReadIds(many));
    expect(kept.size).toBe(400);
    // The newest are the ones kept.
    expect(kept.has('n899')).toBe(true);
    expect(kept.has('n0')).toBe(false);
  });

  it('counts only what has not been read', () => {
    const notices = buildNotices(
      input({ transactions: [tx('2026-08-29', -50_00, { reviewed: false })] })
    );
    expect(unreadCount(notices, new Set())).toBe(notices.length);
    expect(unreadCount(notices, new Set(notices.map((n) => n.id)))).toBe(0);
  });
});
