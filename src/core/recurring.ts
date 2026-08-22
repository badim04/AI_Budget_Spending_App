/**
 * Recurring-rule detection.
 *
 * Finds the payments that repeat — rent, salary, subscriptions, data bundles —
 * so the app can project them onto the calendar instead of waiting for them to
 * surprise someone. Everything here is pure: transactions in, candidate rules
 * out, no I/O.
 *
 * The bar for proposing a rule is deliberately high. A wrong recurring rule is
 * worse than a missing one: it puts an imaginary bill on the forecast, and the
 * "you run out on the 19th" warning stops being trustworthy. So a candidate
 * needs at least three occurrences, a consistent gap, and a consistent amount
 * before it is offered — and it is always *offered*, never auto-created.
 */

import { merchantKey, prettyMerchant } from './categorize';
import { daysBetween, setDayClamped, toMonthlyEquivalent } from './dates';
import { median } from './forecast';
import type {
  Frequency,
  ID,
  ISODate,
  RecurringRule,
  Transaction,
  TransactionKind,
} from './types';

export interface RecurringCandidate {
  /** Stable id derived from the merchant, so re-running does not duplicate. */
  key: string;
  merchant: string;
  accountId: ID;
  categoryId?: ID;
  kind: TransactionKind;
  currency: string;
  /** Median amount in minor units, signed like the transactions it came from. */
  amountMinor: number;
  frequency: Frequency;
  interval: number;
  /** Day of month for monthly-family rules, already clamped to 1..28 when the
   *  observed days suggest a late-month date that would skip February. */
  dayOfMonth?: number;
  dayOfWeek?: number;
  firstSeen: ISODate;
  lastSeen: ISODate;
  occurrences: number;
  /** Predicted next date, from the last occurrence. */
  nextExpected: ISODate;
  /** Does the amount move around (a utility bill) or is it fixed (Netflix)? */
  variableAmount: boolean;
  /** 0..1. Combines how regular the gap is, how stable the amount is, and how
   *  many times it has been seen. */
  confidence: number;
  /** Ids of the transactions that produced this candidate. */
  transactionIds: ID[];
  /** Plain-language reason, shown next to the suggestion. */
  reason: string;
}

export interface DetectOptions {
  /** Minimum occurrences before a pattern is offered. */
  minOccurrences?: number;
  /** Only look at transactions on or after this date. */
  since?: ISODate;
  /** Candidates below this confidence are dropped entirely. */
  minConfidence?: number;
  /** Merchant keys already covered by an existing rule. */
  existingKeys?: Set<string>;
}

/** Frequencies we try to match, with the day-gap each implies. */
const FREQUENCY_TABLE: Array<{ frequency: Frequency; days: number; tolerance: number }> = [
  { frequency: 'daily', days: 1, tolerance: 0 },
  { frequency: 'weekly', days: 7, tolerance: 1 },
  { frequency: 'biweekly', days: 14, tolerance: 2 },
  { frequency: 'semimonthly', days: 15.2, tolerance: 3 },
  // Month lengths vary 28–31, so the tolerance has to swallow that or every
  // monthly bill looks irregular.
  { frequency: 'monthly', days: 30.44, tolerance: 4 },
  { frequency: 'quarterly', days: 91.3, tolerance: 8 },
  { frequency: 'semiannually', days: 182.6, tolerance: 12 },
  { frequency: 'annually', days: 365.25, tolerance: 20 },
];

export function detectRecurring(
  transactions: Transaction[],
  opts: DetectOptions = {}
): RecurringCandidate[] {
  const {
    minOccurrences = 3,
    since,
    minConfidence = 0.55,
    existingKeys = new Set<string>(),
  } = opts;

  // Group by merchant AND account: the same subscription paid from two cards is
  // two rules, and merging them would halve the apparent interval.
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.deletedAt || t.kind === 'transfer' || t.pending) continue;
    if (since && t.date < since) continue;
    const key = merchantKey(t.rawDescription || t.merchant);
    if (!key) continue;
    const groupKey = `${key}::${t.accountId}::${t.currency}`;
    const list = groups.get(groupKey) ?? [];
    list.push(t);
    groups.set(groupKey, list);
  }

  const out: RecurringCandidate[] = [];

  for (const [groupKey, group] of groups) {
    const [mKey] = groupKey.split('::');
    if (existingKeys.has(mKey)) continue;
    if (group.length < minOccurrences) continue;

    const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
    // Two charges on the same day are one purchase split in two, not a cycle.
    const unique = dedupeSameDay(sorted);
    if (unique.length < minOccurrences) continue;

    const candidate = analyseSeries(mKey, unique);
    if (candidate && candidate.confidence >= minConfidence) out.push(candidate);
  }

  return out.sort((a, b) => b.confidence - a.confidence);
}

function dedupeSameDay(sorted: Transaction[]): Transaction[] {
  const out: Transaction[] = [];
  for (const t of sorted) {
    if (out.length > 0 && out[out.length - 1].date === t.date) continue;
    out.push(t);
  }
  return out;
}

function analyseSeries(mKey: string, series: Transaction[]): RecurringCandidate | null {
  const gaps: number[] = [];
  for (let i = 1; i < series.length; i++) {
    gaps.push(daysBetween(series[i - 1].date, series[i].date));
  }
  if (gaps.length === 0) return null;

  const medianGap = median(gaps);
  if (medianGap <= 0) return null;

  const match = matchFrequency(medianGap);
  if (!match) return null;

  // Regularity: how many gaps land within tolerance of the median.
  const withinTolerance = gaps.filter(
    (g) => Math.abs(g - medianGap) <= match.tolerance
  ).length;
  const regularity = withinTolerance / gaps.length;
  if (regularity < 0.6) return null;

  const amounts = series.map((t) => t.amountMinor);
  const medianAmount = Math.round(median(amounts));
  if (medianAmount === 0) return null;

  // Amount stability as a fraction: 0 means identical every time.
  const spread =
    amounts.reduce((acc, a) => acc + Math.abs(a - medianAmount), 0) /
    amounts.length /
    Math.abs(medianAmount);
  // A genuinely fixed charge (Netflix) is identical to the kobo, so the bar for
  // "variable" is low. At 8% a utility bill swinging 28k-35k read as fixed, and
  // the UI then promised an exact amount it had no business promising.
  const variableAmount = spread > 0.02;
  // A bill that swings by more than half is not a predictable commitment.
  if (spread > 0.6) return null;

  const last = series[series.length - 1];
  const dayOfMonth = pickDayOfMonth(series, match.frequency);
  const dayOfWeek = isWeekly(match.frequency)
    ? new Date(`${last.date}T00:00:00Z`).getUTCDay()
    : undefined;

  const confidence = scoreCandidate(series.length, regularity, spread);

  return {
    key: mKey,
    merchant: prettyMerchant(last.merchant || last.rawDescription || mKey),
    accountId: last.accountId,
    categoryId: mostCommonCategory(series),
    kind: medianAmount > 0 ? 'income' : 'expense',
    currency: last.currency,
    amountMinor: medianAmount,
    frequency: match.frequency,
    interval: 1,
    dayOfMonth,
    dayOfWeek,
    firstSeen: series[0].date,
    lastSeen: last.date,
    occurrences: series.length,
    nextExpected: addGap(last.date, match.frequency, dayOfMonth),
    variableAmount,
    confidence,
    transactionIds: series.map((t) => t.id),
    reason: describe(series.length, match.frequency, variableAmount, regularity),
  };
}

function matchFrequency(medianGap: number) {
  let best: (typeof FREQUENCY_TABLE)[number] | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const row of FREQUENCY_TABLE) {
    const delta = Math.abs(medianGap - row.days);
    if (delta <= row.tolerance && delta < bestDelta) {
      best = row;
      bestDelta = delta;
    }
  }
  return best;
}

function isWeekly(f: Frequency): boolean {
  return f === 'weekly' || f === 'biweekly';
}

/**
 * The day of month a monthly rule should fire on.
 *
 * Uses the median observed day, then clamps anything past the 28th down to 28.
 * A rule set to the 30th silently skips February; the alternative — landing on
 * the 28th in every month — is off by two days at worst and never skips.
 */
function pickDayOfMonth(series: Transaction[], frequency: Frequency): number | undefined {
  if (isWeekly(frequency) || frequency === 'daily') return undefined;
  const days = series.map((t) => Number(t.date.slice(8, 10)));
  const day = Math.round(median(days));
  return Math.min(day, 28);
}

function addGap(from: ISODate, frequency: Frequency, dayOfMonth?: number): ISODate {
  const d = new Date(`${from}T00:00:00Z`);
  switch (frequency) {
    case 'daily': d.setUTCDate(d.getUTCDate() + 1); break;
    case 'weekly': d.setUTCDate(d.getUTCDate() + 7); break;
    case 'biweekly': d.setUTCDate(d.getUTCDate() + 14); break;
    case 'semimonthly': d.setUTCDate(d.getUTCDate() + 15); break;
    case 'monthly': d.setUTCMonth(d.getUTCMonth() + 1); break;
    case 'quarterly': d.setUTCMonth(d.getUTCMonth() + 3); break;
    case 'semiannually': d.setUTCMonth(d.getUTCMonth() + 6); break;
    case 'annually': d.setUTCFullYear(d.getUTCFullYear() + 1); break;
  }
  const iso = d.toISOString().slice(0, 10);
  return dayOfMonth != null ? setDayClamped(iso, dayOfMonth) : iso;
}

function mostCommonCategory(series: Transaction[]): ID | undefined {
  const counts = new Map<ID, number>();
  for (const t of series) {
    if (!t.categoryId) continue;
    counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
  }
  let best: ID | undefined;
  let bestCount = 0;
  for (const [id, n] of counts) {
    if (n > bestCount) {
      best = id;
      bestCount = n;
    }
  }
  return best;
}

/**
 * Confidence combines three independent signals, because any one alone lies:
 * three perfectly-spaced payments could be coincidence, and twelve ragged ones
 * are not a schedule.
 */
function scoreCandidate(count: number, regularity: number, spread: number): number {
  const countScore = Math.min(1, (count - 2) / 4); // 3 occurrences -> 0.25, 6+ -> 1
  const amountScore = Math.max(0, 1 - spread / 0.6);
  return Math.min(0.99, 0.25 * countScore + 0.45 * regularity + 0.3 * amountScore);
}

function describe(
  count: number,
  frequency: Frequency,
  variable: boolean,
  regularity: number
): string {
  const cadence: Record<Frequency, string> = {
    daily: 'every day',
    weekly: 'every week',
    biweekly: 'every two weeks',
    semimonthly: 'twice a month',
    monthly: 'every month',
    quarterly: 'every quarter',
    semiannually: 'twice a year',
    annually: 'every year',
  };
  const parts = [`Seen ${count} times, ${cadence[frequency]}`];
  if (variable) parts.push('amount varies');
  if (regularity < 0.85) parts.push('timing is a little loose');
  return parts.join(' · ');
}

/** Turn an accepted candidate into a rule ready to persist. */
export function candidateToRule(
  candidate: RecurringCandidate,
  id: string,
  now: string
): RecurringRule {
  return {
    id,
    name: candidate.merchant,
    accountId: candidate.accountId,
    categoryId: candidate.categoryId,
    kind: candidate.kind,
    amountMinor: candidate.amountMinor,
    currency: candidate.currency,
    frequency: candidate.frequency,
    interval: candidate.interval,
    // Start from the first observation so projections line up with history.
    startsOn: candidate.firstSeen,
    dayOfMonth: candidate.dayOfMonth,
    dayOfWeek: candidate.dayOfWeek,
    autoDetected: true,
    variableAmount: candidate.variableAmount,
    active: true,
    merchant: candidate.merchant,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Whether two merchant keys refer to the same merchant.
 *
 * A rule stores the cleaned display name ("netflix") while transactions carry
 * the bank descriptor ("netflix com"), so exact equality fails on pairs that
 * are obviously the same. Token-aligned prefix matching accepts those without
 * accepting unrelated pairs that merely share a first word.
 */
function keysMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [long, short] = a.length >= b.length ? [a, b] : [b, a];
  return long.startsWith(short + ' ');
}

/** Total monthly commitment implied by a set of rules, in minor units.
 *  Answers "what is already spoken for before I spend anything?" */
export function monthlyCommitment(
  rules: RecurringRule[],
  currency: string,
  kind: 'expense' | 'income' = 'expense'
): number {
  return rules
    .filter((r) => r.active && r.currency === currency)
    .filter((r) => (kind === 'income' ? r.amountMinor > 0 : r.amountMinor < 0))
    .reduce(
      (acc, r) => acc + Math.abs(toMonthlyEquivalent(r.amountMinor, r.frequency, r.interval)),
      0
    );
}

/** Rules whose next expected date has passed without a matching transaction —
 *  a bill that did not arrive is worth surfacing, it usually means it bounced
 *  or the subscription lapsed. */
export function missedOccurrences(
  rules: RecurringRule[],
  transactions: Transaction[],
  asOf: ISODate,
  graceDays = 3
): Array<{ rule: RecurringRule; expected: ISODate }> {
  const out: Array<{ rule: RecurringRule; expected: ISODate }> = [];
  for (const rule of rules) {
    if (!rule.active || !rule.lastGeneratedOn) continue;
    const expected = addGap(rule.lastGeneratedOn, rule.frequency, rule.dayOfMonth);
    if (daysBetween(expected, asOf) <= graceDays) continue;

    const key = merchantKey(rule.merchant ?? rule.name);
    const seen = transactions.some(
      (t) =>
        !t.deletedAt &&
        t.accountId === rule.accountId &&
        t.date >= expected &&
        keysMatch(merchantKey(t.rawDescription || t.merchant), key)
    );
    if (!seen) out.push({ rule, expected });
  }
  return out;
}
