/**
 * Smart challenges.
 *
 * One test here matters more than the rest: a day nobody imported must never
 * score as a no-spend day. Get that wrong and the app rewards people for not
 * giving it data, and the streak it shows grows fastest for the user who has
 * stopped using it. Everything else is arithmetic.
 */

import { describe, it, expect } from 'vitest';
import {
  challenges,
  dailyFacts,
  describeChallenges,
  type Challenge,
} from '@/core/challenges';
import type { Transaction } from '@/core/types';

const TODAY = '2026-08-30'; // a Sunday

let seq = 0;
function tx(
  date: string,
  amountMinor: number,
  extra: Partial<Transaction> = {}
): Transaction {
  seq += 1;
  return {
    id: `t${seq}`,
    accountId: 'acc1',
    kind: amountMinor > 0 ? 'income' : 'expense',
    amountMinor,
    currency: 'NGN',
    date,
    merchant: 'x',
    categoryId: 'cat_food',
    source: 'manual',
    confidence: 'high',
    reviewed: true,
    tags: [],
    dedupeKey: `k${seq}`,
    pending: false,
    createdAt: date,
    updatedAt: date,
    ...extra,
  } as unknown as Transaction;
}

const find = (list: Challenge[], id: string) => list.find((x) => x.id === id)!;

/** Spending every day across a fortnight, so the ledger is unambiguously live. */
function busyFortnight(): Transaction[] {
  const rows: Transaction[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.UTC(2026, 7, 17 + i));
    rows.push(tx(d.toISOString().slice(0, 10), -1_000_00));
  }
  return rows;
}

describe('dailyFacts', () => {
  it('marks days outside the ledger as not covered', () => {
    const days = dailyFacts([tx('2026-08-29', -500_00)], TODAY, 30);

    // Days long before the only transaction cannot be judged.
    expect(days.find((d) => d.date === '2026-08-05')!.covered).toBe(false);
    expect(days.find((d) => d.date === '2026-08-29')!.covered).toBe(true);
  });

  it('covers a quiet day sitting between two active ones', () => {
    const days = dailyFacts(
      [tx('2026-08-25', -100_00), tx('2026-08-28', -100_00)],
      TODAY,
      30
    );
    const quiet = days.find((d) => d.date === '2026-08-26')!;
    expect(quiet.covered).toBe(true);
    expect(quiet.spentMinor).toBe(0);
  });
});

describe('challenges', () => {
  /**
   * The trap this module exists to avoid.
   *
   * A user who imported one transaction a month ago and nothing since has not
   * had a 29-day no-spend streak. They have 29 days nobody can see.
   */
  it('never counts an unimported day as a no-spend day', () => {
    const stale = challenges([tx('2026-08-01', -5_000_00)], TODAY);
    const noSpend = find(stale, 'no_spend_day');

    expect(noSpend.streak).toBe(0);
    expect(noSpend.measured).toBeLessThan(5);
    expect(noSpend.progress === null || noSpend.progress === 0).toBe(true);
  });

  it('says so plainly when there is nothing to measure', () => {
    const empty = challenges([], TODAY);
    for (const challenge of empty) {
      expect(challenge.state).toBe('unmeasurable');
      expect(challenge.progress).toBeNull();
      expect(challenge.detail).toMatch(/Needs a few days/);
    }
    expect(describeChallenges(empty)).toBeNull();
  });

  it('counts a genuine no-spend day inside a live ledger', () => {
    // Spending either side, nothing on the 26th.
    const rows = busyFortnight().filter((t) => t.date !== '2026-08-26');
    const noSpend = find(challenges(rows, TODAY), 'no_spend_day');

    expect(noSpend.measured).toBeGreaterThan(10);
    expect(noSpend.best).toBeGreaterThanOrEqual(1);
  });

  it('credits a quiet weekend sitting inside a live ledger', () => {
    /*
      22 Aug is a Saturday and 23 Aug the Sunday after it, both in the middle of
      the fortnight — so removing their transactions leaves them surrounded by
      activity and therefore visible, which is the only situation in which a
      no-spend weekend can honestly be claimed.
    */
    const rows = busyFortnight().filter(
      (t) => t.date !== '2026-08-22' && t.date !== '2026-08-23'
    );
    const weekend = find(challenges(rows, TODAY), 'no_spend_weekend');

    // Two weekends are visible: 22-23 (quiet) and 29-30 (spent on). So the best
    // run is 1 and the *current* run is 0, because the streak has to end at the
    // most recent weekend or it is not a streak.
    expect(weekend.measured).toBe(2);
    expect(weekend.best).toBe(1);
    expect(weekend.streak).toBe(0);
    expect(weekend.detail).toContain('1 of 2');
  });

  /*
    The counterpart: trimming the END of the ledger does not manufacture a win.
    Dropping the most recent weekend's rows also drops it out of the range the
    ledger covers, so it becomes invisible rather than no-spend.
  */
  it('does not turn the end of the ledger into a no-spend weekend', () => {
    const rows = busyFortnight().filter(
      (t) => t.date !== '2026-08-29' && t.date !== '2026-08-30'
    );
    const weekend = find(challenges(rows, TODAY), 'no_spend_weekend');

    expect(weekend.streak).toBe(0);
    expect(weekend.detail).toContain('0 of 1');
  });

  it('does not credit a weekend it can only half see', () => {
    // A single Saturday transaction, nothing else at all: Sunday is invisible.
    const weekend = find(challenges([tx('2026-08-29', -100_00)], TODAY), 'no_spend_weekend');
    expect(weekend.state).toBe('unmeasurable');
  });

  it('only offers the daily cap when the user has set one', () => {
    const without = challenges(busyFortnight(), TODAY);
    expect(without.find((x) => x.id === 'daily_cap')).toBeUndefined();

    const with_ = challenges(busyFortnight(), TODAY, { dailyCapMinor: 2_000_00 });
    const cap = find(with_, 'daily_cap');
    expect(cap.streak).toBeGreaterThan(0); // 1,000 a day is under a 2,000 cap
  });

  it('breaks the cap streak on the day it was exceeded', () => {
    const rows = busyFortnight();
    rows.push(tx(TODAY, -9_000_00)); // today blows the cap
    const cap = find(challenges(rows, TODAY, { dailyCapMinor: 2_000_00 }), 'daily_cap');

    expect(cap.streak).toBe(0);
    expect(cap.best).toBeGreaterThan(0);
  });

  /**
   * A day with nothing to file is not a day you filed everything.
   *
   * Counting empty days would make this streak grow fastest for someone
   * recording nothing at all, which is the same failure as the no-spend one.
   */
  it('scores filing only over days that had something to file', () => {
    const rows = busyFortnight().map((t, i) =>
      i === 0 ? ({ ...t, reviewed: false } as Transaction) : t
    );
    const filed = find(challenges(rows, TODAY), 'track_everything');

    expect(filed.measured).toBe(rows.length); // one per active day, no empties
    expect(filed.streak).toBeGreaterThan(0);
    expect(filed.best).toBeGreaterThan(0);
  });

  it('keeps a stable order regardless of progress', () => {
    const a = challenges(busyFortnight(), TODAY, { dailyCapMinor: 2_000_00 });
    const b = challenges(busyFortnight().slice(0, 3), TODAY, { dailyCapMinor: 1_00 });
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
  });

  it('never reports progress outside 0..1', () => {
    for (const rows of [[], busyFortnight(), [tx(TODAY, -1)]]) {
      for (const challenge of challenges(rows, TODAY, { dailyCapMinor: 500_00 })) {
        if (challenge.progress == null) continue;
        expect(challenge.progress).toBeGreaterThanOrEqual(0);
        expect(challenge.progress).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('describeChallenges', () => {
  it('is silent rather than encouraging when nothing has happened', () => {
    const rows = busyFortnight(); // spending every day: no streaks going
    const line = describeChallenges(challenges(rows, TODAY));
    // Either a real streak sentence or nothing — never filler.
    if (line != null) expect(line).toMatch(/\d/);
  });

  it('is deterministic', () => {
    const list = challenges(busyFortnight(), TODAY);
    expect(describeChallenges(list)).toBe(describeChallenges(list));
  });
});
