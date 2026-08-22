/**
 * The budget engine.
 *
 * Answers the only three questions a budget really has to answer:
 *   1. How much of this envelope is left?
 *   2. Am I ahead of or behind pace?
 *   3. What can I spend per day for the rest of the period and still land on target?
 *
 * Question 2 is the one most apps get wrong. "You've used 60% of your food
 * budget" is not information — 60% on day 25 of a month is fine, 60% on day 5
 * is a problem. Everything here compares spend against elapsed time, not
 * against the raw allocation.
 */

import {
  add,
  divide,
  isNegative,
  money,
  multiply,
  ratio,
  subtract,
  sum,
  zero,
  type Money,
} from './money';
import {
  daysBetween,
  daysRemaining,
  periodProgress,
  periodRange,
  previousPeriod,
} from './dates';
import type {
  Budget,
  BudgetStatus,
  ISODate,
  PeriodRange,
  Transaction,
} from './types';

export interface BudgetContext {
  /** All non-deleted transactions. Filtering happens here so callers don't have
   *  to remember the exclusion rules. */
  transactions: Transaction[];
  /** Categories flagged excludeFromTotals — transfers, reimbursables. */
  excludedCategoryIds: Set<string>;
  asOf: ISODate;
}

/**
 * Spend attributable to a budget within a range.
 *
 * Only outflows count: a refund posted to the same category reduces the
 * period's spend, which is why this sums signed amounts and flips the result
 * rather than summing absolute values. A ₦50,000 purchase refunded in full
 * should leave the envelope untouched, not consume ₦100,000 of it.
 */
export function spendForBudget(
  budget: Budget,
  range: PeriodRange,
  ctx: BudgetContext
): Money {
  const categories = new Set(budget.categoryIds);
  let totalMinor = 0;

  for (const t of ctx.transactions) {
    if (t.deletedAt) continue;
    if (t.kind === 'transfer') continue;
    if (t.date < range.start || t.date > range.end) continue;
    if (t.currency !== budget.currency) continue;

    // A split transaction contributes only the lines in this budget.
    if (t.splits && t.splits.length > 0) {
      for (const s of t.splits) {
        if (matchesBudget(s.categoryId, categories, ctx)) {
          totalMinor += s.amountMinor;
        }
      }
      continue;
    }
    if (matchesBudget(t.categoryId, categories, ctx)) {
      totalMinor += t.amountMinor;
    }
  }

  // Outflows are negative in the domain; a budget's "spent" is a positive figure.
  return money(-totalMinor, budget.currency);
}

function matchesBudget(
  categoryId: string | undefined,
  categories: Set<string>,
  ctx: BudgetContext
): boolean {
  if (categoryId && ctx.excludedCategoryIds.has(categoryId)) return false;
  // An empty category list makes the budget a catch-all for everything not
  // explicitly excluded — the "everything else" envelope.
  if (categories.size === 0) return true;
  return categoryId != null && categories.has(categoryId);
}

/**
 * Amount carried into `range` from earlier periods.
 *
 * `reset`   contributes nothing.
 * `rollover` accumulates every prior period's surplus or deficit.
 * `average`  smooths: the carry is whatever keeps the running average on target,
 *            which lets an expensive month be offset by a cheap one without the
 *            envelope reading as permanently broken.
 *
 * Capped at 24 look-back periods — beyond that the carry is archaeology, and an
 * unbounded walk would scan the entire transaction history on every render.
 */
export function rolloverInto(
  budget: Budget,
  range: PeriodRange,
  ctx: BudgetContext,
  maxLookback = 24
): Money {
  if (budget.rollover === 'reset') return zero(budget.currency);

  const allocation = money(budget.amountMinor, budget.currency);
  let carry = zero(budget.currency);
  let cursor = previousPeriod(range, budget.period, budget.startsOn);

  for (let i = 0; i < maxLookback; i++) {
    if (cursor.end < budget.startsOn) break;
    const spent = spendForBudget(budget, cursor, ctx);
    const surplus = subtract(allocation, spent);

    if (budget.rollover === 'rollover') {
      carry = add(carry, surplus);
    } else {
      // 'average': only the deviation carries, damped so one bad month doesn't
      // dominate the envelope forever.
      carry = add(carry, divide(surplus, 2));
    }
    cursor = previousPeriod(cursor, budget.period, budget.startsOn);
  }

  // Cap the carry at a few periods' worth of allocation.
  //
  // Without this, a budget that existed before the transaction history begins
  // accrues a full surplus for every empty period and the envelope inflates to
  // something meaningless — a ₦180k monthly food budget with a year of empty
  // history reports millions "safe to spend". Real spending never carries that
  // far forward either: an envelope that has been untouched for six months is
  // over-funded, not owed.
  const ceiling = Math.abs(budget.amountMinor) * ROLLOVER_CAP_PERIODS;
  if (Math.abs(carry.minor) > ceiling) {
    return money(Math.sign(carry.minor) * ceiling, budget.currency);
  }
  return carry;
}

/** How many periods' worth of allocation a rollover may accumulate. */
export const ROLLOVER_CAP_PERIODS = 3;

/** Full status for one budget in the period containing `asOf`. */
export function budgetStatus(
  budget: Budget,
  ctx: BudgetContext,
  forDate?: ISODate
): BudgetStatus {
  const date = forDate ?? ctx.asOf;
  const range = periodRange(date, budget.period, budget.startsOn);

  const allocated = money(budget.amountMinor, budget.currency);
  const carry = rolloverInto(budget, range, ctx);
  const effectiveAllocated = add(allocated, carry);

  const spent = spendForBudget(budget, range, ctx);
  const remaining = subtract(effectiveAllocated, spent);
  const utilisation = ratio(spent, effectiveAllocated);
  const progress = periodProgress(range, minOf(ctx.asOf, range.end));

  // Straight-line projection: current burn rate held to the end of the period.
  // Deliberately naive — a fancier model here would be less legible and no more
  // useful, since the user's own behaviour is what actually decides the outcome.
  const projected =
    progress > 0 ? divide(spent, progress) : zero(budget.currency);

  const remainingDays = daysRemaining(range, ctx.asOf);
  const safeToSpendPerDay = isNegative(remaining)
    ? zero(budget.currency)
    : remainingDays > 0
      ? divide(remaining, remainingDays)
      : remaining;

  return {
    budget,
    range,
    allocated,
    effectiveAllocated,
    spent,
    remaining,
    utilisation,
    periodProgress: progress,
    projected,
    state: classifyBudget(
      utilisation,
      progress,
      budget.alertThreshold,
      ctx.asOf > range.end
    ),
    safeToSpendPerDay,
  };
}

function minOf(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b;
}

/**
 * The pace judgement.
 *
 * Mid-period, an envelope is only "warning" when spend is running ahead of
 * elapsed time by more than a tolerance — so a user who front-loads groceries
 * on the 1st isn't scolded every month for a pattern that always works out.
 */
function classifyBudget(
  utilisation: number | null,
  progress: number,
  alertThreshold: number,
  ended: boolean
): BudgetStatus['state'] {
  if (utilisation == null) return ended ? 'ended_under' : 'on_track';
  if (ended) return utilisation > 1 ? 'ended_over' : 'ended_under';
  if (utilisation > 1) return 'over';

  const paceTolerance = 0.1;
  const aheadOfPace = utilisation > progress + paceTolerance;
  if (aheadOfPace || utilisation >= alertThreshold) return 'warning';
  return 'on_track';
}

export function allBudgetStatuses(
  budgets: Budget[],
  ctx: BudgetContext,
  forDate?: ISODate
): BudgetStatus[] {
  return budgets
    .filter((b) => !b.archived)
    .filter((b) => b.startsOn <= (forDate ?? ctx.asOf))
    .filter((b) => !b.endsOn || b.endsOn >= (forDate ?? ctx.asOf))
    .map((b) => budgetStatus(b, ctx, forDate))
    .sort(byUrgency);
}

const STATE_ORDER: Record<BudgetStatus['state'], number> = {
  over: 0,
  warning: 1,
  on_track: 2,
  ended_over: 3,
  ended_under: 4,
};

function byUrgency(a: BudgetStatus, b: BudgetStatus): number {
  const s = STATE_ORDER[a.state] - STATE_ORDER[b.state];
  if (s !== 0) return s;
  return (b.utilisation ?? 0) - (a.utilisation ?? 0);
}

/**
 * "Safe to spend" across every budget — the single number the dashboard leads
 * with. It is the sum of what's left in each envelope, floored at zero per
 * envelope: an overspent food budget shouldn't make the transport budget look
 * like it has money to give.
 */
export function safeToSpend(statuses: BudgetStatus[], currency: string): Money {
  const positives = statuses
    .filter((s) => s.budget.currency === currency)
    .map((s) => (isNegative(s.remaining) ? zero(currency) : s.remaining));
  return sum(positives, currency);
}

/**
 * Suggest an allocation for a budget from history.
 *
 * Uses the median of the last N periods rather than the mean, because a single
 * annual insurance payment or a one-off flight would otherwise drag the
 * suggestion far above what a normal month looks like.
 */
export function suggestAllocation(
  budget: Budget,
  ctx: BudgetContext,
  lookbackPeriods = 6
): Money {
  const spends: number[] = [];
  let cursor = periodRange(ctx.asOf, budget.period, budget.startsOn);
  for (let i = 0; i < lookbackPeriods; i++) {
    cursor = previousPeriod(cursor, budget.period, budget.startsOn);
    if (cursor.end < budget.startsOn) break;
    spends.push(spendForBudget(budget, cursor, ctx).minor);
  }
  if (spends.length === 0) return money(budget.amountMinor, budget.currency);

  spends.sort((a, b) => a - b);
  const mid = Math.floor(spends.length / 2);
  const median =
    spends.length % 2 === 0 ? (spends[mid - 1] + spends[mid]) / 2 : spends[mid];

  // Round up to a clean figure — a suggestion of "₦47,318" reads like a bug.
  return money(roundToNiceNumber(median, budget.currency), budget.currency);
}

function roundToNiceNumber(minor: number, currency: string): number {
  if (minor <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(Math.abs(minor)));
  const step = Math.max(magnitude / 2, 1);
  return Math.ceil(minor / step) * step;
}

/** Budgets whose current-period spend crossed the alert threshold since the
 *  last check — the trigger for a push notification. */
export function budgetsNeedingAlert(
  statuses: BudgetStatus[]
): BudgetStatus[] {
  return statuses.filter(
    (s) => s.state === 'over' || (s.state === 'warning' && s.periodProgress < 0.9)
  );
}

/**
 * Total spend across all budgets versus total allocated — the top-line ring on
 * the dashboard. Mixed currencies are rejected here rather than silently added;
 * the caller converts through an FxTable first.
 */
export function aggregateBudgets(
  statuses: BudgetStatus[],
  currency: string
): { allocated: Money; spent: Money; remaining: Money; utilisation: number | null } {
  const scoped = statuses.filter((s) => s.budget.currency === currency);
  const allocated = sum(scoped.map((s) => s.effectiveAllocated), currency);
  const spent = sum(scoped.map((s) => s.spent), currency);
  return {
    allocated,
    spent,
    remaining: subtract(allocated, spent),
    utilisation: ratio(spent, allocated),
  };
}

/** Days into the period before the envelope is projected to run dry. Null when
 *  it isn't projected to. Powers "at this rate, food runs out on the 22nd". */
export function projectedExhaustionDate(status: BudgetStatus): ISODate | null {
  if (status.periodProgress <= 0) return null;
  const dailyBurn = status.spent.minor / Math.max(1, elapsedDays(status));
  if (dailyBurn <= 0) return null;
  const daysUntilEmpty = status.remaining.minor / dailyBurn;
  if (daysUntilEmpty < 0) return status.range.start;
  const total = daysBetween(status.range.start, status.range.end) + 1;
  // elapsedDays counts the current day inclusively, so today's offset from the
  // period start is one less than that. Skipping the -1 pushes every projection
  // a day into the future.
  const dayIndex = Math.floor(elapsedDays(status) - 1 + daysUntilEmpty);
  if (dayIndex >= total) return null;
  return addDaysLocal(status.range.start, dayIndex);
}

function elapsedDays(status: BudgetStatus): number {
  const total = daysBetween(status.range.start, status.range.end) + 1;
  return Math.max(1, status.periodProgress * total);
}

function addDaysLocal(date: ISODate, n: number): ISODate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
