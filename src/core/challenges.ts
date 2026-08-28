/**
 * Smart challenges, and the one thing that makes them honest.
 *
 * The reference designs all carry a challenges screen: "No Spend Weekend",
 * "Save ₦500 Daily", "Track Every Expense For 7 Days", each with a progress bar
 * and a streak. They are the most motivating thing on those screens and the
 * easiest to get quietly wrong, because of a single trap:
 *
 * **An empty day is not a won day.**
 *
 * A no-spend challenge scored off "were there any transactions" rewards you for
 * every day you did not import your statement. Do that and you have built an app
 * that pays people to stop giving it data — and the streak it shows is a lie
 * that gets longer the less you use it. So every challenge here scores only over
 * days it can see, and a day is only visible when the ledger was demonstrably
 * live around it. Days with no evidence either way are excluded from the
 * denominator rather than counted as wins.
 *
 * The other rules follow the health score's, for the same reasons:
 *
 * - A challenge with no evidence is not shown at 0%; it says it needs data.
 * - Streaks are recomputed from the ledger every time, never accumulated and
 *   stored. A stored streak survives a deleted transaction and starts lying.
 * - `target` values are the user's own or a stated default, never invented to
 *   make a bar look good.
 *
 * Pure: no React, no I/O, no clock of its own.
 */

import type { ISODate, Transaction } from './types';
import { addDays, daysBetween } from './dates';

export type ChallengeId =
  | 'no_spend_day'
  | 'no_spend_weekend'
  | 'daily_cap'
  | 'track_everything';

export type ChallengeState =
  /** Running, with something achieved. */
  | 'in_progress'
  /** The full window was met. */
  | 'complete'
  /** Nothing yet, but measurable. */
  | 'not_started'
  /** Not enough visible history to say anything. */
  | 'unmeasurable';

export interface Challenge {
  id: ChallengeId;
  title: string;
  /** What winning means, in one line. */
  blurb: string;
  state: ChallengeState;
  /** 0..1 across the challenge's window. Null when unmeasurable. */
  progress: number | null;
  /** Consecutive wins ending at the most recent visible period. */
  streak: number;
  /** Best run inside the window looked at. */
  best: number;
  /** The count that matters, phrased. */
  detail: string;
  /** How many periods were actually visible, so the UI can say so. */
  measured: number;
}

/** How many days a challenge looks back over. Long enough for a streak to mean something. */
const WINDOW_DAYS = 30;

/**
 * A day is visible if the ledger was demonstrably live near it.
 *
 * Without this, "no spend" and "did not overspend" both score a win on every
 * day the user simply had not imported yet. Three days either side is the
 * smallest gap that still tolerates a normal weekend of no activity in an
 * account that is otherwise being kept up to date.
 */
const COVERAGE_RADIUS_DAYS = 3;

interface DayFacts {
  date: ISODate;
  /** Money out that day, positive minor units. */
  spentMinor: number;
  /** Rows recorded that day. */
  count: number;
  /** Rows that day still awaiting review. */
  unreviewed: number;
  /** Was the ledger live around this date? */
  covered: boolean;
}

/**
 * Turn the ledger into one row per day over the window.
 *
 * Built once and shared by every challenge, because each of them otherwise
 * walks the whole transaction list and the screen shows four at a time.
 */
export function dailyFacts(
  transactions: readonly Transaction[],
  asOf: ISODate,
  windowDays: number = WINDOW_DAYS
): DayFacts[] {
  const live = transactions.filter((tx) => !tx.deletedAt);

  const byDate = new Map<string, { spentMinor: number; count: number; unreviewed: number }>();
  for (const tx of live) {
    const row = byDate.get(tx.date) ?? { spentMinor: 0, count: 0, unreviewed: 0 };
    if (tx.amountMinor < 0) row.spentMinor += -tx.amountMinor;
    row.count += 1;
    if (!tx.reviewed) row.unreviewed += 1;
    byDate.set(tx.date, row);
  }

  const dates = [...byDate.keys()].sort();
  const first = dates[0];
  const last = dates[dates.length - 1];

  const out: DayFacts[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const date = addDays(asOf, -i);
    const row = byDate.get(date);

    /**
     * Covered when the ledger has anything within the radius, and never
     * outside the range the ledger actually spans — a day before the first
     * transaction ever recorded is not a no-spend day, it is a day this app
     * knows nothing about.
     */
    let covered = false;
    if (first && last && date >= first && date <= last) {
      for (let d = -COVERAGE_RADIUS_DAYS; d <= COVERAGE_RADIUS_DAYS; d++) {
        if (byDate.has(addDays(date, d))) {
          covered = true;
          break;
        }
      }
    }

    out.push({
      date,
      spentMinor: row?.spentMinor ?? 0,
      count: row?.count ?? 0,
      unreviewed: row?.unreviewed ?? 0,
      covered,
    });
  }
  return out;
}

/** Longest run of `true`, and the run ending at the last element. */
function runs(flags: boolean[]): { best: number; current: number } {
  let best = 0;
  let run = 0;
  for (const flag of flags) {
    run = flag ? run + 1 : 0;
    if (run > best) best = run;
  }
  let current = 0;
  for (let i = flags.length - 1; i >= 0 && flags[i]; i--) current += 1;
  return { best, current };
}

function build(
  id: ChallengeId,
  title: string,
  blurb: string,
  wins: boolean[],
  detail: (won: number, measured: number) => string,
  target: number
): Challenge {
  const measured = wins.length;
  if (measured === 0) {
    return {
      id,
      title,
      blurb,
      state: 'unmeasurable',
      progress: null,
      streak: 0,
      best: 0,
      detail: 'Needs a few days of transactions before this can be scored.',
      measured: 0,
    };
  }

  const won = wins.filter(Boolean).length;
  const { best, current } = runs(wins);
  const progress = Math.max(0, Math.min(1, current / target));

  return {
    id,
    title,
    blurb,
    state: current >= target ? 'complete' : current > 0 ? 'in_progress' : 'not_started',
    progress,
    streak: current,
    best,
    detail: detail(won, measured),
    measured,
  };
}

export interface ChallengeOptions {
  /** Daily spending cap for the cap challenge. The user's own figure. */
  dailyCapMinor?: number;
  windowDays?: number;
}

/**
 * Every challenge, scored against the visible ledger.
 *
 * Order is fixed rather than sorted by progress: a list that reshuffles as you
 * improve makes it impossible to learn where anything is, and the point of a
 * streak is that you come back to check the same one.
 */
export function challenges(
  transactions: readonly Transaction[],
  asOf: ISODate,
  opts: ChallengeOptions = {}
): Challenge[] {
  const window = opts.windowDays ?? WINDOW_DAYS;
  const days = dailyFacts(transactions, asOf, window);
  const visible = days.filter((d) => d.covered);

  const out: Challenge[] = [];

  // --- a day with nothing spent -------------------------------------------
  out.push(
    build(
      'no_spend_day',
      'No-spend day',
      'A whole day without money leaving the account.',
      visible.map((d) => d.spentMinor === 0),
      (won, measured) => `${won} of the last ${measured} days you could see were no-spend.`,
      3
    )
  );

  // --- a weekend with nothing spent ---------------------------------------
  /**
   * Saturday and Sunday, scored as a pair.
   *
   * A weekend only counts when both of its days are visible: crediting a
   * weekend on the strength of one covered day is the same mistake as
   * crediting an unimported one.
   */
  const weekends: boolean[] = [];
  for (let i = 0; i < days.length - 1; i++) {
    const a = days[i];
    const b = days[i + 1];
    if (dayOfWeek(a.date) !== 6 || dayOfWeek(b.date) !== 0) continue;
    if (!a.covered || !b.covered) continue;
    weekends.push(a.spentMinor === 0 && b.spentMinor === 0);
  }
  out.push(
    build(
      'no_spend_weekend',
      'No-spend weekend',
      'Saturday and Sunday with nothing going out.',
      weekends,
      (won, measured) => `${won} of ${measured} full weekends in view were no-spend.`,
      1
    )
  );

  // --- staying under a daily cap ------------------------------------------
  if (opts.dailyCapMinor && opts.dailyCapMinor > 0) {
    const cap = opts.dailyCapMinor;
    out.push(
      build(
        'daily_cap',
        'Under your daily cap',
        'Spending less than your cap, day after day.',
        visible.map((d) => d.spentMinor <= cap),
        (won, measured) => `${won} of ${measured} days came in under the cap.`,
        7
      )
    );
  }

  // --- everything filed ----------------------------------------------------
  /**
   * Only days that actually had transactions.
   *
   * A day with nothing to file is not a day you filed everything, and counting
   * it would make the streak grow fastest for someone recording nothing.
   */
  const withRows = visible.filter((d) => d.count > 0);
  out.push(
    build(
      'track_everything',
      'Everything filed',
      'No transaction left waiting for a category.',
      withRows.map((d) => d.unreviewed === 0),
      (won, measured) => `${won} of ${measured} days with activity were fully filed.`,
      7
    )
  );

  return out;
}

/** 0 = Sunday, 6 = Saturday, in UTC like every other date in this codebase. */
function dayOfWeek(date: ISODate): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/**
 * One sentence for the section header.
 *
 * Says nothing rather than something empty — a challenges strip that always
 * has a line of encouragement under it teaches people to skip the line.
 */
export function describeChallenges(list: Challenge[]): string | null {
  const live = list.filter((x) => x.state !== 'unmeasurable');
  if (live.length === 0) return null;

  const done = live.filter((x) => x.state === 'complete');
  if (done.length > 0) {
    return `${done.length} of ${live.length} running — ${done[0].title.toLowerCase()} is done.`;
  }

  const best = [...live].sort((a, b) => b.streak - a.streak)[0];
  if (best.streak === 0) return null;
  return `${best.streak} day${best.streak === 1 ? '' : 's'} into ${best.title.toLowerCase()}.`;
}
