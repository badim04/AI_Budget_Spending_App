/**
 * The notifications centre: a log of what Finlo noticed, and when.
 *
 * The obvious objection first, because it nearly stopped this being built:
 * `generateInsights` already produces a list of things worth knowing, and two
 * lists of the same facts is precisely the "one fact, one register" failure
 * this codebase has been bitten by before — a bar reading "▲ 9.6×" directly
 * above a banner reading "up 858%".
 *
 * What makes this a different register rather than a second copy is **time**.
 * An insight is a statement about how things stand: "eating out is up". A
 * notification is a record that something happened on a date: "on 12 August the
 * Food envelope went over". One is the present tense and one is the past, and
 * only the second survives the thing that caused it being fixed.
 *
 * Every entry here is therefore derived from something with a real date
 * attached — the transaction that crossed a budget, the day a bill falls due,
 * the batch a set of rows was imported in. Nothing is invented, and nothing is
 * stamped "now" just to have a timestamp.
 *
 * Read state is the only thing worth persisting, and it lives in the key/value
 * settings table as a capped list of ids. The notifications themselves are
 * recomputed, so deleting a transaction removes the alert it caused instead of
 * leaving a ghost in a table.
 *
 * Pure: no React, no I/O, no clock of its own.
 */

import type { BudgetStatus, ISODate, RecurringRule, Transaction } from './types';
import { addDays, daysBetween, formatDate, occurrencesBetween } from './dates';
import { median } from './forecast';

export type NoticeKind = 'budget' | 'bill' | 'unusual' | 'import' | 'review';

export interface Notice {
  /**
   * Stable across recomputation.
   *
   * A read marker is stored against this, so an id that changed between renders
   * would make everything unread again on every visit.
   */
  id: string;
  kind: NoticeKind;
  severity: 'critical' | 'warning' | 'positive' | 'neutral';
  title: string;
  body: string;
  /** The date the thing happened, or is due. Never "now". */
  date: ISODate;
  /** Where tapping it should go. */
  action?: { route: string; params?: Record<string, string> };
}

export interface NoticeInput {
  transactions: readonly Transaction[];
  budgetStatuses: readonly BudgetStatus[];
  recurringRules: readonly RecurringRule[];
  asOf: ISODate;
  /** How far back to look. Beyond this it is history, not news. */
  windowDays?: number;
}

const WINDOW_DAYS = 45;
/** A bill further out than this is not news yet. */
const BILL_HORIZON_DAYS = 10;

function money(minor: number): string {
  return `₦${Math.round(Math.abs(minor) / 100).toLocaleString('en-NG')}`;
}

export function buildNotices(input: NoticeInput): Notice[] {
  const { asOf } = input;
  const window = input.windowDays ?? WINDOW_DAYS;
  const since = addDays(asOf, -window);
  const live = input.transactions.filter((tx) => !tx.deletedAt);

  const out: Notice[] = [];

  // --- envelopes that went over -------------------------------------------
  /**
   * Dated by the transaction that crossed the line, not by today.
   *
   * "Your Food budget is over" with today's date is a status dressed as an
   * event. Walking the envelope's own transactions to find the one that tipped
   * it gives the notice a real date and makes it useful a week later.
   */
  for (const status of input.budgetStatuses) {
    if (status.state !== 'over' || status.budget.amountMinor <= 0) continue;

    const inEnvelope = live
      .filter(
        (tx) =>
          tx.amountMinor < 0 &&
          tx.date >= status.range.start &&
          tx.date <= status.range.end &&
          (status.budget.categoryIds?.includes(tx.categoryId ?? '') ?? false)
      )
      .sort((a, b) => a.date.localeCompare(b.date));

    let running = 0;
    let crossedOn: ISODate | null = null;
    for (const tx of inEnvelope) {
      running += -tx.amountMinor;
      if (running > status.effectiveAllocated.minor) {
        crossedOn = tx.date;
        break;
      }
    }

    const date = crossedOn ?? status.range.start;
    if (date < since) continue;

    out.push({
      id: `budget_over_${status.budget.id}_${status.range.start}`,
      kind: 'budget',
      severity: 'critical',
      title: `${status.budget.name} went over`,
      body: `${money(status.spent.minor)} against ${money(status.effectiveAllocated.minor)} — passed on ${formatDate(date, 'short')}.`,
      date,
      action: { route: '/budgets' },
    });
  }

  // --- envelopes running ahead of pace -------------------------------------
  for (const status of input.budgetStatuses) {
    if (status.state !== 'warning' || status.budget.amountMinor <= 0) continue;
    out.push({
      id: `budget_pace_${status.budget.id}_${status.range.start}`,
      kind: 'budget',
      severity: 'warning',
      title: `${status.budget.name} is ahead of pace`,
      body: `${Math.round((status.utilisation ?? 0) * 100)}% spent with ${daysBetween(asOf, status.range.end)} days to go.`,
      date: asOf,
      action: { route: '/budgets' },
    });
  }

  // --- bills coming up ------------------------------------------------------
  /**
   * Due dates come from `occurrencesBetween`, the same function the dashboard
   * uses. A rule stores its shape, not its next date, so deriving it here is
   * the only way the feed and the "coming up" row can agree.
   */
  for (const rule of input.recurringRules) {
    if (!rule.active) continue;
    const dues = occurrencesBetween(
      rule.startsOn,
      rule.frequency,
      rule.interval,
      asOf,
      addDays(asOf, BILL_HORIZON_DAYS),
      { dayOfMonth: rule.dayOfMonth, dayOfWeek: rule.dayOfWeek }
    );

    for (const due of dues) {
      const days = daysBetween(asOf, due);
      if (days < 0) continue;
      out.push({
        id: `bill_${rule.id}_${due}`,
        kind: 'bill',
        severity: days <= 2 ? 'warning' : 'neutral',
        title: `${rule.name} is due ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}`,
        body: `${money(rule.amountMinor)} on ${formatDate(due, 'medium')}.`,
        date: due,
        action: { route: '/budgets' },
      });
    }
  }

  // --- a charge well outside its own pattern -------------------------------
  /**
   * Compared against the same merchant's own history, not against everything.
   *
   * "That was a big transaction" is true of rent every month and useless. A
   * charge is only worth flagging when it is unlike the other charges from the
   * same place — and only when there are enough of those to have a pattern.
   */
  const byMerchant = new Map<string, Transaction[]>();
  for (const tx of live) {
    if (tx.amountMinor >= 0) continue;
    const key = (tx.merchant || tx.rawDescription || '').toLowerCase().trim();
    if (!key) continue;
    const list = byMerchant.get(key) ?? [];
    list.push(tx);
    byMerchant.set(key, list);
  }

  for (const [, rows] of byMerchant) {
    if (rows.length < 4) continue;
    const recent = rows.filter((tx) => tx.date >= since);
    if (recent.length === 0) continue;

    const amounts = rows.map((tx) => -tx.amountMinor);
    const typical = median(amounts);
    if (typical <= 0) continue;

    for (const tx of recent) {
      const amount = -tx.amountMinor;
      if (amount < typical * 2.5) continue;
      out.push({
        id: `unusual_${tx.id}`,
        kind: 'unusual',
        severity: 'warning',
        title: `Unusual charge at ${tx.merchant}`,
        body: `${money(amount)} against a usual ${money(typical)}.`,
        date: tx.date,
        action: { route: '/transactions' },
      });
    }
  }

  // --- imports -------------------------------------------------------------
  /**
   * Grouped by the day rows were created, not the day they happened.
   *
   * An import of six months of statement is one event on the day it was run,
   * and dating it by the transactions inside would scatter it across half a
   * year of feed.
   */
  const imports = new Map<string, number>();
  for (const tx of live) {
    if (tx.source !== 'csv_import') continue;
    const day = (tx.createdAt ?? '').slice(0, 10);
    if (!day || day < since) continue;
    imports.set(day, (imports.get(day) ?? 0) + 1);
  }
  for (const [day, count] of imports) {
    out.push({
      id: `import_${day}`,
      kind: 'import',
      severity: 'positive',
      title: `${count} transaction${count === 1 ? '' : 's'} imported`,
      body: `From a statement, on ${formatDate(day, 'medium')}.`,
      date: day,
      action: { route: '/transactions' },
    });
  }

  // --- the review queue ----------------------------------------------------
  const unreviewed = live.filter((tx) => !tx.reviewed).length;
  if (unreviewed > 0) {
    out.push({
      id: `review_${unreviewed}`,
      kind: 'review',
      severity: 'neutral',
      title: `${unreviewed} waiting for a category`,
      body: 'Filing them makes every total below more accurate.',
      date: asOf,
      action: { route: '/transactions' },
    });
  }

  /**
   * Newest first, and severity breaks a tie.
   *
   * Two things on the same day should not be ordered by whichever happened to
   * be computed first — that reshuffles between renders and makes the list feel
   * unstable. Severity, then id, is stable.
   */
  const rank = { critical: 0, warning: 1, positive: 2, neutral: 3 } as const;
  return out.sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      rank[a.severity] - rank[b.severity] ||
      a.id.localeCompare(b.id)
  );
}

// ------------------------------------------------------------------ read state

/** Where the read markers live in the key/value settings table. */
export const READ_NOTICES_KEY = 'read_notices';

/** Enough to cover a long feed; beyond this the oldest markers are dropped. */
const MAX_READ_IDS = 400;

export function parseReadIds(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    // A corrupt marker list must never stop the feed rendering.
    return new Set();
  }
}

/**
 * Serialise read markers, newest kept.
 *
 * Capped because this is one row in a key/value table that is read on every
 * launch, and an uncapped list grows for the life of the install.
 */
export function serialiseReadIds(ids: Iterable<string>): string {
  return JSON.stringify([...ids].slice(-MAX_READ_IDS));
}

export function unreadCount(notices: readonly Notice[], read: ReadonlySet<string>): number {
  return notices.reduce((sum, notice) => (read.has(notice.id) ? sum : sum + 1), 0);
}
