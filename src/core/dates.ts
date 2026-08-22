/**
 * Calendar maths on ISO day-strings.
 *
 * Every date in the domain is a "YYYY-MM-DD" string, and every function here
 * takes and returns that shape. The rule is: parse to UTC, do the arithmetic,
 * format back. Using local-time Date objects would make a transaction recorded
 * at 23:30 in Lagos land in the previous day for a user whose device is on UTC,
 * which silently moves spending between months.
 */

import type { BudgetPeriod, Frequency, ISODate, PeriodRange } from './types';

const DAY_MS = 86_400_000;

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

// --------------------------------------------------------------- parse/format

export function toISODate(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

/** Parse "YYYY-MM-DD" into a Date pinned to UTC midnight. */
export function parseISODate(s: ISODate): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) throw new TypeError(`Not an ISO date: ${s}`);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

/**
 * Returns a plain boolean, deliberately NOT a `s is ISODate` type predicate.
 * `ISODate` is an alias for `string`, so the predicate narrows the *negative*
 * branch to `never` — meaning `if (isValid(x)) return x; x.replace(...)` fails
 * to compile for no real-world reason. The alias buys no safety; the predicate
 * only costs.
 */
export function isValidISODate(s: unknown): boolean {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function today(now: Date = new Date()): ISODate {
  return toISODate(now);
}

export function nowISO(now: Date = new Date()): string {
  return now.toISOString();
}

// ------------------------------------------------------------------ shifting

export function addDays(date: ISODate, n: number): ISODate {
  return toISODate(new Date(parseISODate(date).getTime() + n * DAY_MS));
}

export function addWeeks(date: ISODate, n: number): ISODate {
  return addDays(date, n * 7);
}

/**
 * Add months, clamping the day to the target month's length.
 *
 * Jan 31 + 1 month is Feb 28 (or 29), not Mar 3. JavaScript's Date rolls
 * overflow forward, which would march a monthly rule set to the 31st through
 * the calendar until it left the month entirely.
 */
export function addMonths(date: ISODate, n: number): ISODate {
  const d = parseISODate(date);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = daysInMonth(target.getUTCFullYear(), target.getUTCMonth());
  target.setUTCDate(Math.min(day, last));
  return toISODate(target);
}

export function addYears(date: ISODate, n: number): ISODate {
  return addMonths(date, n * 12);
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / DAY_MS);
}

export function compareDates(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b;
}
export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a >= b ? a : b;
}
export function isBetween(d: ISODate, start: ISODate, end: ISODate): boolean {
  return d >= start && d <= end;
}

// ----------------------------------------------------------------- boundaries

export function startOfMonth(date: ISODate): ISODate {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: ISODate): ISODate {
  const d = parseISODate(date);
  const last = daysInMonth(d.getUTCFullYear(), d.getUTCMonth());
  return `${date.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

/** `weekStartsOn`: 0=Sunday, 1=Monday. Defaults to Monday. */
export function startOfWeek(date: ISODate, weekStartsOn: 0 | 1 = 1): ISODate {
  const d = parseISODate(date);
  const dow = d.getUTCDay();
  const diff = (dow - weekStartsOn + 7) % 7;
  return addDays(date, -diff);
}

export function endOfWeek(date: ISODate, weekStartsOn: 0 | 1 = 1): ISODate {
  return addDays(startOfWeek(date, weekStartsOn), 6);
}

export function startOfQuarter(date: ISODate): ISODate {
  const d = parseISODate(date);
  const q = Math.floor(d.getUTCMonth() / 3);
  return `${d.getUTCFullYear()}-${String(q * 3 + 1).padStart(2, '0')}-01`;
}

export function endOfQuarter(date: ISODate): ISODate {
  return endOfMonth(addMonths(startOfQuarter(date), 2));
}

export function startOfYear(date: ISODate): ISODate {
  return `${date.slice(0, 4)}-01-01`;
}
export function endOfYear(date: ISODate): ISODate {
  return `${date.slice(0, 4)}-12-31`;
}

export function quarterOf(date: ISODate): number {
  return Math.floor(parseISODate(date).getUTCMonth() / 3) + 1;
}

// -------------------------------------------------------------------- periods

/**
 * The range containing `date` for a given period type.
 *
 * `anchor` matters for budgets that don't follow the calendar — someone paid on
 * the 25th may want their "month" to run the 25th to the 24th. When an anchor
 * is supplied, periods are generated from it rather than from month boundaries.
 */
export function periodRange(
  date: ISODate,
  period: BudgetPeriod,
  anchor?: ISODate,
  weekStartsOn: 0 | 1 = 1
): PeriodRange {
  if (anchor && period !== 'daily') {
    return anchoredRange(date, period, anchor);
  }
  switch (period) {
    case 'daily':
      return { start: date, end: date, label: formatDate(date, 'medium') };
    case 'weekly': {
      const start = startOfWeek(date, weekStartsOn);
      const end = addDays(start, 6);
      return { start, end, label: `${formatDate(start, 'short')} – ${formatDate(end, 'short')}` };
    }
    case 'monthly': {
      const start = startOfMonth(date);
      return {
        start,
        end: endOfMonth(date),
        label: `${MONTH_NAMES[parseISODate(date).getUTCMonth()]} ${date.slice(0, 4)}`,
      };
    }
    case 'quarterly': {
      const start = startOfQuarter(date);
      return { start, end: endOfQuarter(date), label: `Q${quarterOf(date)} ${date.slice(0, 4)}` };
    }
    case 'annually':
      return { start: startOfYear(date), end: endOfYear(date), label: date.slice(0, 4) };
  }
}

/** Periods aligned to a user-chosen anchor day rather than the calendar. */
function anchoredRange(date: ISODate, period: BudgetPeriod, anchor: ISODate): PeriodRange {
  const step = periodStepMonths(period);
  if (step === 0) {
    // weekly anchored: count whole weeks from the anchor
    const weeks = Math.floor(daysBetween(anchor, date) / 7);
    const start = addWeeks(anchor, weeks);
    const end = addDays(addWeeks(start, 1), -1);
    return { start, end, label: `${formatDate(start, 'short')} – ${formatDate(end, 'short')}` };
  }
  let start = anchor;
  // Walk forward or backward in whole periods until `date` is inside one.
  const monthsApart =
    (parseISODate(date).getUTCFullYear() - parseISODate(anchor).getUTCFullYear()) * 12 +
    (parseISODate(date).getUTCMonth() - parseISODate(anchor).getUTCMonth());
  const jumps = Math.floor(monthsApart / step);
  start = addMonths(anchor, jumps * step);
  if (start > date) start = addMonths(start, -step);
  let end = addDays(addMonths(start, step), -1);
  if (end < date) {
    start = addMonths(start, step);
    end = addDays(addMonths(start, step), -1);
  }
  return { start, end, label: `${formatDate(start, 'short')} – ${formatDate(end, 'short')}` };
}

function periodStepMonths(period: BudgetPeriod): number {
  switch (period) {
    case 'monthly': return 1;
    case 'quarterly': return 3;
    case 'annually': return 12;
    default: return 0;
  }
}

export function nextPeriod(range: PeriodRange, period: BudgetPeriod, anchor?: ISODate): PeriodRange {
  return periodRange(addDays(range.end, 1), period, anchor);
}

export function previousPeriod(range: PeriodRange, period: BudgetPeriod, anchor?: ISODate): PeriodRange {
  return periodRange(addDays(range.start, -1), period, anchor);
}

/** Every period boundary between two dates — the x-axis of most charts. */
export function periodsBetween(
  start: ISODate,
  end: ISODate,
  period: BudgetPeriod,
  anchor?: ISODate
): PeriodRange[] {
  const out: PeriodRange[] = [];
  let cursor = periodRange(start, period, anchor);
  let guard = 0;
  while (cursor.start <= end && guard++ < 5000) {
    out.push(cursor);
    cursor = nextPeriod(cursor, period, anchor);
  }
  return out;
}

/**
 * How far through a period we are, 0..1.
 * Used as the pace reference: spending 60% of a budget when the month is 40%
 * gone is the signal, not the raw percentage.
 */
export function periodProgress(range: PeriodRange, asOf: ISODate): number {
  const total = daysBetween(range.start, range.end) + 1;
  if (total <= 0) return 1;
  const elapsed = daysBetween(range.start, asOf) + 1;
  return Math.min(1, Math.max(0, elapsed / total));
}

export function daysRemaining(range: PeriodRange, asOf: ISODate): number {
  return Math.max(0, daysBetween(asOf, range.end));
}

// ------------------------------------------------------------------ frequency

/** The next occurrence strictly after `from`, following a recurrence. */
export function nextOccurrence(
  from: ISODate,
  frequency: Frequency,
  interval = 1,
  opts: { dayOfMonth?: number; dayOfWeek?: number } = {}
): ISODate {
  const n = Math.max(1, interval);
  switch (frequency) {
    case 'daily':
      return addDays(from, n);
    case 'weekly':
      return addDays(from, 7 * n);
    case 'biweekly':
      return addDays(from, 14 * n);
    case 'semimonthly': {
      // Paid on the 1st and 15th, or on the given day and that day + 15.
      const d = parseISODate(from).getUTCDate();
      const first = opts.dayOfMonth ?? 1;
      const second = Math.min(first + 15, 28);
      if (d < first) return setDayClamped(from, first);
      if (d < second) return setDayClamped(from, second);
      return setDayClamped(addMonths(from, 1), first);
    }
    case 'monthly':
      return applyDayOfMonth(addMonths(from, n), opts.dayOfMonth);
    case 'quarterly':
      return applyDayOfMonth(addMonths(from, 3 * n), opts.dayOfMonth);
    case 'semiannually':
      return applyDayOfMonth(addMonths(from, 6 * n), opts.dayOfMonth);
    case 'annually':
      return applyDayOfMonth(addYears(from, n), opts.dayOfMonth);
  }
}

function applyDayOfMonth(date: ISODate, dayOfMonth?: number): ISODate {
  return dayOfMonth == null ? date : setDayClamped(date, dayOfMonth);
}

/** Set the day of month, clamping to the month's length (31 -> 30 in April). */
export function setDayClamped(date: ISODate, day: number): ISODate {
  const d = parseISODate(date);
  const last = daysInMonth(d.getUTCFullYear(), d.getUTCMonth());
  const clamped = Math.min(Math.max(1, day), last);
  return `${date.slice(0, 7)}-${String(clamped).padStart(2, '0')}`;
}

/** All occurrences in [start, end]. Used to project bills onto the calendar. */
export function occurrencesBetween(
  ruleStart: ISODate,
  frequency: Frequency,
  interval: number,
  start: ISODate,
  end: ISODate,
  opts: { dayOfMonth?: number; dayOfWeek?: number } = {}
): ISODate[] {
  const out: ISODate[] = [];
  let cursor = applyDayOfMonth(ruleStart, opts.dayOfMonth);
  let guard = 0;
  // Fast-forward to the window without emitting, so a rule that started years
  // ago doesn't allocate thousands of dates we immediately discard.
  while (cursor < start && guard++ < 10_000) {
    cursor = nextOccurrence(cursor, frequency, interval, opts);
  }
  while (cursor <= end && guard++ < 10_000) {
    if (cursor >= start) out.push(cursor);
    cursor = nextOccurrence(cursor, frequency, interval, opts);
  }
  return out;
}

/** Average days between occurrences — used to normalise different frequencies
 *  onto a common monthly figure for comparison. */
export function averageDaysPerPeriod(frequency: Frequency, interval = 1): number {
  const base: Record<Frequency, number> = {
    daily: 1,
    weekly: 7,
    biweekly: 14,
    semimonthly: 365.25 / 24,
    monthly: 365.25 / 12,
    quarterly: 365.25 / 4,
    semiannually: 365.25 / 2,
    annually: 365.25,
  };
  return base[frequency] * Math.max(1, interval);
}

/** Any recurring amount expressed as its monthly equivalent. */
export function toMonthlyEquivalent(
  amountMinor: number,
  frequency: Frequency,
  interval = 1
): number {
  const perMonth = (365.25 / 12) / averageDaysPerPeriod(frequency, interval);
  return Math.round(amountMinor * perMonth);
}

// ------------------------------------------------------------------ humanise

export function formatDate(
  date: ISODate,
  style: 'short' | 'medium' | 'long' | 'day' = 'medium'
): string {
  const d = parseISODate(date);
  const day = d.getUTCDate();
  const month = d.getUTCMonth();
  const year = d.getUTCFullYear();
  switch (style) {
    case 'short':
      return `${day} ${MONTH_NAMES[month].slice(0, 3)}`;
    case 'medium':
      return `${day} ${MONTH_NAMES[month].slice(0, 3)} ${year}`;
    case 'long':
      return `${DAY_NAMES[d.getUTCDay()]}, ${day} ${MONTH_NAMES[month]} ${year}`;
    case 'day':
      return String(day);
  }
}

/** "Today", "Yesterday", "3 days ago", then falls back to a date. */
export function relativeDate(date: ISODate, asOf: ISODate = today()): string {
  const diff = daysBetween(date, asOf);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff === -1) return 'Tomorrow';
  if (diff > 1 && diff < 7) return `${diff} days ago`;
  if (diff < -1 && diff > -7) return `In ${-diff} days`;
  return formatDate(date, asOf.slice(0, 4) === date.slice(0, 4) ? 'short' : 'medium');
}
