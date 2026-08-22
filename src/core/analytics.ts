/**
 * Analytics — the numbers behind the dashboard.
 *
 * Everything here is a pure function from transactions to a shape a chart can
 * render. No formatting, no colours, no React: the UI decides how to draw it.
 *
 * The recurring theme is comparison. A total on its own ("₦184,200 this month")
 * tells you almost nothing; the same total against last month, against your own
 * median, or against the same month last year is where the meaning is.
 */

import {
  FxTable,
  add,
  formatMoney,
  money,
  ratio,
  subtract,
  sum,
  zero,
  type CurrencyCode,
  type Money,
} from './money';
import {
  daysBetween,
  endOfMonth,
  periodRange,
  periodsBetween,
  startOfMonth,
} from './dates';
import { anomalyScore, median } from './forecast';
import type {
  Account,
  BudgetPeriod,
  BudgetStatus,
  CashflowPoint,
  Category,
  CategoryTotal,
  ID,
  Insight,
  ISODate,
  NetWorthPoint,
  PeriodRange,
  Transaction,
} from './types';

export interface AnalyticsContext {
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  /** Everything is converted into this before being aggregated. */
  displayCurrency: CurrencyCode;
  fx: FxTable;
  asOf: ISODate;
}

/** Convert a transaction into the display currency, tolerating a missing rate. */
function inDisplay(t: Transaction, ctx: AnalyticsContext): Money | null {
  const native = money(t.amountMinor, t.currency);
  if (t.currency === ctx.displayCurrency) return native;
  try {
    return ctx.fx.convert(native, ctx.displayCurrency);
  } catch {
    // A missing rate must not zero out the figure or crash the dashboard —
    // the transaction is skipped and the UI reports the gap separately.
    return null;
  }
}

function isSpending(t: Transaction, excluded: Set<ID>): boolean {
  if (t.deletedAt || t.kind === 'transfer') return false;
  if (t.categoryId && excluded.has(t.categoryId)) return false;
  return true;
}

export function excludedCategoryIds(categories: Category[]): Set<ID> {
  return new Set(categories.filter((c) => c.excludeFromTotals).map((c) => c.id));
}

/** Transactions we couldn't convert — surfaced so a stale FX table is visible
 *  rather than silently shrinking every total. */
export function unconvertibleCurrencies(ctx: AnalyticsContext): CurrencyCode[] {
  const missing = new Set<CurrencyCode>();
  for (const t of ctx.transactions) {
    if (t.currency !== ctx.displayCurrency && !ctx.fx.has(t.currency)) {
      missing.add(t.currency);
    }
  }
  return [...missing];
}

// ------------------------------------------------------------ category totals

/**
 * Spend by category for a range, with each category's change against the
 * previous comparable period.
 *
 * Split transactions are decomposed into their lines, so a ₦40,000 supermarket
 * run that was half groceries and half household appears in both categories at
 * the right weight instead of landing entirely in whichever was picked first.
 */
export function categoryTotals(
  range: PeriodRange,
  ctx: AnalyticsContext,
  kind: 'expense' | 'income' = 'expense'
): CategoryTotal[] {
  const excluded = excludedCategoryIds(ctx.categories);
  const current = accumulateByCategory(range, ctx, excluded, kind);
  const previous = accumulateByCategory(
    previousComparable(range),
    ctx,
    excluded,
    kind
  );

  const grandTotal = [...current.values()].reduce((a, b) => a + b.minor, 0);

  const rows: CategoryTotal[] = [];
  for (const [categoryId, total] of current) {
    const category = ctx.categories.find((c) => c.id === categoryId);
    const prior = previous.get(categoryId)?.minor ?? 0;
    rows.push({
      categoryId,
      categoryName: category?.name ?? 'Uncategorised',
      color: category?.color ?? '#8a8880',
      icon: category?.icon ?? '❓',
      total,
      transactionCount: countFor(range, ctx, categoryId, excluded, kind),
      share: grandTotal === 0 ? 0 : total.minor / grandTotal,
      // No prior spend means "new", not "up infinity percent".
      changeVsPrevious: prior === 0 ? null : (total.minor - prior) / prior,
    });
  }
  return rows.sort((a, b) => b.total.minor - a.total.minor);
}

function accumulateByCategory(
  range: PeriodRange,
  ctx: AnalyticsContext,
  excluded: Set<ID>,
  kind: 'expense' | 'income'
): Map<ID, Money> {
  const out = new Map<ID, Money>();
  const wantInflow = kind === 'income';

  for (const t of ctx.transactions) {
    if (!isSpending(t, excluded)) continue;
    if (t.date < range.start || t.date > range.end) continue;

    const converted = inDisplay(t, ctx);
    if (!converted) continue;

    const lines = t.splits?.length
      ? t.splits.map((s) => ({
          categoryId: s.categoryId,
          // Scale each split by the same rate the whole transaction used.
          minor: Math.round((s.amountMinor / t.amountMinor) * converted.minor),
        }))
      : [{ categoryId: t.categoryId ?? UNCATEGORISED, minor: converted.minor }];

    for (const line of lines) {
      if (excluded.has(line.categoryId)) continue;
      const isInflow = line.minor > 0;
      if (isInflow !== wantInflow) continue;

      const magnitude = Math.abs(line.minor);
      const existing = out.get(line.categoryId);
      out.set(
        line.categoryId,
        money((existing?.minor ?? 0) + magnitude, ctx.displayCurrency)
      );
    }
  }
  return out;
}

export const UNCATEGORISED = '__uncategorised__';

function countFor(
  range: PeriodRange,
  ctx: AnalyticsContext,
  categoryId: ID,
  excluded: Set<ID>,
  kind: 'expense' | 'income'
): number {
  let n = 0;
  for (const t of ctx.transactions) {
    if (!isSpending(t, excluded)) continue;
    if (t.date < range.start || t.date > range.end) continue;
    if ((t.amountMinor > 0) !== (kind === 'income')) continue;
    const ids = t.splits?.length
      ? t.splits.map((s) => s.categoryId)
      : [t.categoryId ?? UNCATEGORISED];
    if (ids.includes(categoryId)) n++;
  }
  return n;
}

/** The equivalent earlier range: last month for a month, last week for a week. */
function previousComparable(range: PeriodRange): PeriodRange {
  const length = daysBetween(range.start, range.end) + 1;
  const end = shift(range.start, -1);
  const start = shift(end, -(length - 1));
  return { start, end, label: 'Previous' };
}

function shift(date: ISODate, days: number): ISODate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Collapse a long tail into "Other".
 *
 * The categorical palette has eight slots and a ninth hue would collide with
 * one already on screen, so the chart never receives more than `limit` rows.
 */
export function withOtherBucket(
  rows: CategoryTotal[],
  limit = 7,
  currency: CurrencyCode = 'NGN'
): CategoryTotal[] {
  if (rows.length <= limit + 1) return rows;
  const head = rows.slice(0, limit);
  const tail = rows.slice(limit);
  const otherTotal = sum(tail.map((r) => r.total), currency);
  return [
    ...head,
    {
      categoryId: '__other__',
      categoryName: `Other (${tail.length})`,
      color: '#8a8880',
      icon: '•',
      total: otherTotal,
      transactionCount: tail.reduce((a, r) => a + r.transactionCount, 0),
      share: tail.reduce((a, r) => a + r.share, 0),
      changeVsPrevious: null,
    },
  ];
}

// -------------------------------------------------------------------- cashflow

/** Inflow, outflow, net and running balance, bucketed by period. */
export function cashflowSeries(
  from: ISODate,
  to: ISODate,
  period: BudgetPeriod,
  ctx: AnalyticsContext,
  openingBalance: Money = zero('NGN')
): CashflowPoint[] {
  const excluded = excludedCategoryIds(ctx.categories);
  const buckets = periodsBetween(from, to, period);
  let running = openingBalance.currency === ctx.displayCurrency
    ? openingBalance.minor
    : 0;

  return buckets.map((bucket) => {
    let inMinor = 0;
    let outMinor = 0;

    for (const t of ctx.transactions) {
      if (!isSpending(t, excluded)) continue;
      if (t.date < bucket.start || t.date > bucket.end) continue;
      const converted = inDisplay(t, ctx);
      if (!converted) continue;
      if (converted.minor > 0) inMinor += converted.minor;
      else outMinor += -converted.minor;
    }

    running += inMinor - outMinor;
    return {
      date: bucket.end,
      inflow: money(inMinor, ctx.displayCurrency),
      outflow: money(outMinor, ctx.displayCurrency),
      net: money(inMinor - outMinor, ctx.displayCurrency),
      balance: money(running, ctx.displayCurrency),
    };
  });
}

/** Daily spend, for the sparkline and for feeding the forecaster. */
export function dailySpendSeries(
  from: ISODate,
  to: ISODate,
  ctx: AnalyticsContext
): Array<{ date: ISODate; value: number }> {
  const excluded = excludedCategoryIds(ctx.categories);
  const byDay = new Map<ISODate, number>();

  for (const t of ctx.transactions) {
    if (!isSpending(t, excluded)) continue;
    if (t.date < from || t.date > to) continue;
    const converted = inDisplay(t, ctx);
    if (!converted || converted.minor >= 0) continue;
    byDay.set(t.date, (byDay.get(t.date) ?? 0) + -converted.minor);
  }

  // Zero-fill: a day with no spending is a real data point, and leaving gaps
  // would make the average look higher than it is.
  const out: Array<{ date: ISODate; value: number }> = [];
  for (let d = from; d <= to; d = shift(d, 1)) {
    out.push({ date: d, value: byDay.get(d) ?? 0 });
  }
  return out;
}

// -------------------------------------------------------------------- balances

/** Current balance of one account: opening balance plus every posted movement. */
export function accountBalance(
  account: Account,
  transactions: Transaction[],
  asOf: ISODate,
  includePending = false
): Money {
  let minor = account.openingBalanceMinor;
  for (const t of transactions) {
    if (t.deletedAt || t.accountId !== account.id) continue;
    if (t.date > asOf) continue;
    if (t.pending && !includePending) continue;
    minor += t.amountMinor;
  }
  return money(minor, account.currency);
}

export function netWorth(ctx: AnalyticsContext, asOf: ISODate): NetWorthPoint {
  let assets = zero(ctx.displayCurrency);
  let liabilities = zero(ctx.displayCurrency);

  for (const account of ctx.accounts) {
    if (account.archived) continue;
    const balance = accountBalance(account, ctx.transactions, asOf);
    let converted: Money;
    try {
      converted = ctx.fx.convert(balance, ctx.displayCurrency);
    } catch {
      continue;
    }
    // A credit card or loan holds a negative balance; it is a liability whether
    // or not the sign happens to be negative on the day.
    const isLiability = account.kind === 'credit_card' || account.kind === 'loan';
    if (isLiability) {
      liabilities = add(liabilities, money(Math.abs(converted.minor), ctx.displayCurrency));
    } else {
      assets = add(assets, converted);
    }
  }
  return { date: asOf, assets, liabilities, net: subtract(assets, liabilities) };
}

export function netWorthSeries(
  from: ISODate,
  to: ISODate,
  ctx: AnalyticsContext
): NetWorthPoint[] {
  return periodsBetween(from, to, 'monthly').map((p) => netWorth(ctx, p.end));
}

// --------------------------------------------------------------------- ratios

/**
 * Savings rate for a period: what fraction of income you kept.
 *
 * Null when there was no income — "you saved 0% of nothing" is not a useful
 * thing to put on a dashboard.
 */
export function savingsRate(range: PeriodRange, ctx: AnalyticsContext): number | null {
  const excluded = excludedCategoryIds(ctx.categories);
  let income = 0;
  let spend = 0;
  for (const t of ctx.transactions) {
    if (!isSpending(t, excluded)) continue;
    if (t.date < range.start || t.date > range.end) continue;
    const c = inDisplay(t, ctx);
    if (!c) continue;
    if (c.minor > 0) income += c.minor;
    else spend += -c.minor;
  }
  if (income === 0) return null;
  return (income - spend) / income;
}

/** How many months of typical spending your liquid accounts would cover. */
export function runwayMonths(ctx: AnalyticsContext, lookbackMonths = 6): number | null {
  const liquid = ctx.accounts
    .filter((a) => !a.archived && ['cash', 'bank', 'savings', 'mobile_money'].includes(a.kind))
    .map((a) => {
      try {
        return ctx.fx.convert(accountBalance(a, ctx.transactions, ctx.asOf), ctx.displayCurrency).minor;
      } catch {
        return 0;
      }
    })
    .reduce((a, b) => a + b, 0);

  const monthlySpends: number[] = [];
  let cursor = startOfMonth(ctx.asOf);
  for (let i = 0; i < lookbackMonths; i++) {
    cursor = startOfMonth(shift(cursor, -1));
    const range = { start: cursor, end: endOfMonth(cursor), label: '' };
    const spend = categoryTotals(range, ctx, 'expense').reduce((a, r) => a + r.total.minor, 0);
    if (spend > 0) monthlySpends.push(spend);
  }
  if (monthlySpends.length === 0 || liquid <= 0) return null;
  // Median again — one heavy month shouldn't halve the reported runway.
  return liquid / median(monthlySpends);
}

// ------------------------------------------------------------------- insights

/**
 * The narrated dashboard.
 *
 * These are the sentences the app says out loud, so the bar is high: each one
 * must be specific, actionable, and true. Anything vague ("watch your spending")
 * is noise and is deliberately absent.
 */
export function generateInsights(
  ctx: AnalyticsContext,
  budgetStatuses: BudgetStatus[]
): Insight[] {
  const out: Insight[] = [];
  const thisMonth = periodRange(ctx.asOf, 'monthly');

  // 1. Overspent envelopes — the most actionable thing on the screen.
  for (const s of budgetStatuses.filter((b) => b.state === 'over')) {
    out.push({
      id: `over_${s.budget.id}`,
      severity: 'critical',
      title: `${s.budget.name} is over budget`,
      body: `You're ${fmtPct(Math.abs(s.utilisation! - 1))} past the ${s.budget.name.toLowerCase()} envelope with ${daysBetween(ctx.asOf, s.range.end)} days left in the period.`,
      action: { route: '/budgets', params: { id: s.budget.id } },
      weight: 100,
    });
  }

  // 2. Envelopes running ahead of the calendar.
  for (const s of budgetStatuses.filter((b) => b.state === 'warning').slice(0, 2)) {
    out.push({
      id: `pace_${s.budget.id}`,
      severity: 'warning',
      title: `${s.budget.name} is ahead of pace`,
      body: `${fmtPct(s.utilisation ?? 0)} spent with ${fmtPct(s.periodProgress)} of the period gone. Staying under means about ${formatMoney(s.safeToSpendPerDay, { compactDecimals: true })} a day from here.`,
      action: { route: '/budgets', params: { id: s.budget.id } },
      weight: 70,
    });
  }

  // 3. Categories that jumped against their own recent history.
  const totals = categoryTotals(thisMonth, ctx, 'expense');
  for (const row of totals.slice(0, 8)) {
    if (row.changeVsPrevious == null || row.changeVsPrevious < 0.4) continue;
    if (row.total.minor < 100_00) continue; // ignore rounding-scale categories
    out.push({
      id: `spike_${row.categoryId}`,
      severity: 'warning',
      title: `${row.categoryName} is up ${fmtPct(row.changeVsPrevious)}`,
      body: `${row.transactionCount} transaction${row.transactionCount === 1 ? '' : 's'} this period, against a much lighter month before it.`,
      action: { route: '/insights', params: { categoryId: row.categoryId } },
      weight: 60,
    });
  }

  // 4. Unusually large single transactions.
  const excluded = excludedCategoryIds(ctx.categories);
  const byCategory = new Map<ID, number[]>();
  for (const t of ctx.transactions) {
    if (!isSpending(t, excluded) || t.amountMinor >= 0 || !t.categoryId) continue;
    const list = byCategory.get(t.categoryId) ?? [];
    list.push(-t.amountMinor);
    byCategory.set(t.categoryId, list);
  }
  for (const t of ctx.transactions) {
    if (t.date < thisMonth.start || t.date > thisMonth.end) continue;
    if (!isSpending(t, excluded) || t.amountMinor >= 0 || !t.categoryId) continue;
    const history = (byCategory.get(t.categoryId) ?? []).filter((v) => v !== -t.amountMinor);
    if (anomalyScore(-t.amountMinor, history) > 3.5) {
      out.push({
        id: `anomaly_${t.id}`,
        severity: 'neutral',
        title: `Unusual ${ctx.categories.find((c) => c.id === t.categoryId)?.name ?? ''} charge`,
        body: `${t.merchant} is well outside what this category normally looks like.`,
        action: { route: '/transaction/[id]', params: { id: t.id } },
        weight: 45,
      });
      break; // one anomaly callout at a time — a wall of them is just noise
    }
  }

  // 5. Savings rate, framed positively when it deserves it.
  const rate = savingsRate(thisMonth, ctx);
  if (rate != null && rate > 0.2) {
    out.push({
      id: 'savings_good',
      severity: 'positive',
      title: `You kept ${fmtPct(rate)} of what came in`,
      body: 'That is comfortably above the 20% mark this period.',
      weight: 30,
    });
  } else if (rate != null && rate < 0) {
    out.push({
      id: 'savings_negative',
      severity: 'critical',
      title: 'You spent more than you earned this period',
      body: `Outflows exceeded inflows by ${fmtPct(Math.abs(rate))} of income.`,
      action: { route: '/insights' },
      weight: 90,
    });
  }

  // 6. The review queue, only when it is big enough to be worth a trip.
  const unreviewed = ctx.transactions.filter((t) => !t.deletedAt && !t.reviewed).length;
  if (unreviewed >= 5) {
    out.push({
      id: 'review_queue',
      severity: 'neutral',
      title: `${unreviewed} transactions need a category`,
      body: 'Most already have a suggestion — confirming them takes a few taps.',
      action: { route: '/transactions', params: { filter: 'unreviewed' } },
      weight: 40,
    });
  }

  return out.sort((a, b) => b.weight - a.weight);
}

function fmtPct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

// ---------------------------------------------------------------- comparisons

/** This period against the same period last year — the honest yearly view. */
export function yearOverYear(
  range: PeriodRange,
  ctx: AnalyticsContext
): { current: Money; priorYear: Money; change: number | null } {
  const priorRange: PeriodRange = {
    start: shiftYear(range.start, -1),
    end: shiftYear(range.end, -1),
    label: 'Last year',
  };
  const current = totalSpend(range, ctx);
  const priorYear = totalSpend(priorRange, ctx);
  return { current, priorYear, change: ratio(subtract(current, priorYear), priorYear) };
}

export function totalSpend(range: PeriodRange, ctx: AnalyticsContext): Money {
  return sum(
    categoryTotals(range, ctx, 'expense').map((r) => r.total),
    ctx.displayCurrency
  );
}

export function totalIncome(range: PeriodRange, ctx: AnalyticsContext): Money {
  return sum(
    categoryTotals(range, ctx, 'income').map((r) => r.total),
    ctx.displayCurrency
  );
}

function shiftYear(date: ISODate, years: number): ISODate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/** Merchants you spend most with — usually more actionable than categories,
 *  because you can actually decide to stop going somewhere. */
export function topMerchants(
  range: PeriodRange,
  ctx: AnalyticsContext,
  limit = 10
): Array<{ merchant: string; total: Money; count: number }> {
  const excluded = excludedCategoryIds(ctx.categories);
  const map = new Map<string, { total: number; count: number }>();

  for (const t of ctx.transactions) {
    if (!isSpending(t, excluded)) continue;
    if (t.date < range.start || t.date > range.end) continue;
    const c = inDisplay(t, ctx);
    if (!c || c.minor >= 0) continue;
    const key = t.merchant || 'Unknown';
    const entry = map.get(key) ?? { total: 0, count: 0 };
    entry.total += -c.minor;
    entry.count += 1;
    map.set(key, entry);
  }

  return [...map.entries()]
    .map(([merchant, v]) => ({
      merchant,
      total: money(v.total, ctx.displayCurrency),
      count: v.count,
    }))
    .sort((a, b) => b.total.minor - a.total.minor)
    .slice(0, limit);
}
