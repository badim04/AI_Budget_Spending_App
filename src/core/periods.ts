/**
 * Moving around in time.
 *
 * Every screen used to show "now" and only now, which answers "what am I
 * spending this month?" and nothing else. The questions people actually ask
 * are comparative — was last month worse, what did August look like, how does
 * this fortnight compare to the one before — and none of them can be asked of
 * a dashboard pinned to today.
 *
 * The rules that keep it honest:
 *
 *  - **You cannot walk into the future.** A month that has not happened has no
 *    data, and an empty screen reads as a bug rather than as "not yet".
 *  - **A comparison is between two ranges of the same length.** Comparing a
 *    finished August against a third of September is not a comparison, it is a
 *    trick, so the current period is measured only as far as it has run.
 *
 * Pure date arithmetic over `YYYY-MM-DD` strings: no React, no I/O.
 */

import {
  addMonths,
  addYears,
  daysBetween,
  endOfMonth,
  periodRange,
  startOfMonth,
  today as todayISO,
} from './dates';
import type { ISODate, PeriodRange } from './types';

/** The calendar month containing `date`. */
export function monthOf(date: ISODate): PeriodRange {
  return periodRange(date, 'monthly');
}

/** Move a month range forward or back. */
export function shiftMonths(range: PeriodRange, months: number): PeriodRange {
  return monthOf(addMonths(startOfMonth(range.start), months));
}

/** The month before this one. */
export function previousMonth(range: PeriodRange): PeriodRange {
  return shiftMonths(range, -1);
}

/** The same month, a year earlier. */
export function sameMonthLastYear(range: PeriodRange): PeriodRange {
  return monthOf(addYears(startOfMonth(range.start), -1));
}

/**
 * Is this range the one containing today?
 *
 * Used to disable "next" and to label the period "This month" rather than
 * spelling out a month the user is already living in.
 */
export function isCurrentMonth(range: PeriodRange, today: ISODate = todayISO()): boolean {
  return range.start <= today && today <= range.end;
}

/** Never past the month containing today. */
export function canGoForward(range: PeriodRange, today: ISODate = todayISO()): boolean {
  return shiftMonths(range, 1).start <= today;
}

/**
 * How much of the range has actually happened.
 *
 * A month in the past is complete. The current month is only complete up to
 * today, and comparing its partial total against a full previous month is the
 * classic way to make spending look like it has collapsed.
 */
export function elapsedRange(range: PeriodRange, today: ISODate = todayISO()): PeriodRange {
  if (today >= range.end) return range;
  if (today < range.start) return { ...range, end: range.start };
  return { ...range, end: today };
}

/**
 * The equivalent slice of an earlier period.
 *
 * If eleven days of September have run, compare them against the first eleven
 * days of August rather than the whole of it.
 */
export function matchingSlice(target: PeriodRange, elapsed: PeriodRange): PeriodRange {
  const days = daysBetween(elapsed.start, elapsed.end);
  const end = addDaysISO(target.start, days);
  return { ...target, end: end > target.end ? target.end : end };
}

/** A label that reads naturally in a sentence. */
export function describeRange(range: PeriodRange, today: ISODate = todayISO()): string {
  if (isCurrentMonth(range, today)) return 'This month';
  const previous = previousMonth(monthOf(today));
  if (range.start === previous.start) return 'Last month';
  return range.label;
}

/** A custom range from two dates, ordered and labelled. */
export function customRange(from: ISODate, to: ISODate): PeriodRange {
  const [start, end] = from <= to ? [from, to] : [to, from];
  return { start, end, label: `${start} to ${end}` };
}

/** The whole months a set of dates spans, newest first — for a month picker. */
export function monthsCovering(dates: readonly ISODate[], today: ISODate = todayISO()): PeriodRange[] {
  if (dates.length === 0) return [monthOf(today)];

  let earliest = dates[0];
  for (const d of dates) if (d < earliest) earliest = d;

  const months: PeriodRange[] = [];
  let cursor = monthOf(today);
  // Guard against a bad date in the data spinning this forever.
  for (let i = 0; i < 240 && cursor.end >= startOfMonth(earliest); i++) {
    months.push(cursor);
    cursor = shiftMonths(cursor, -1);
  }
  return months;
}

/** `addDays` on a range boundary, without importing the whole module twice. */
function addDaysISO(date: ISODate, days: number): ISODate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Re-exported so callers do not need both modules for one screen. */
export { endOfMonth, startOfMonth };
