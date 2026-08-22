import { describe, it, expect } from 'vitest';
import {
  addDays,
  addMonths,
  daysBetween,
  endOfMonth,
  endOfQuarter,
  isValidISODate,
  nextOccurrence,
  occurrencesBetween,
  periodProgress,
  periodRange,
  periodsBetween,
  relativeDate,
  setDayClamped,
  startOfQuarter,
  startOfWeek,
  toMonthlyEquivalent,
} from '@/core/dates';

describe('validation', () => {
  it('rejects impossible dates that string-match the shape', () => {
    expect(isValidISODate('2026-02-30')).toBe(false);
    expect(isValidISODate('2026-13-01')).toBe(false);
    expect(isValidISODate('2026-02-29')).toBe(false); // 2026 is not a leap year
    expect(isValidISODate('2024-02-29')).toBe(true);
    expect(isValidISODate('13/08/2026')).toBe(false);
  });
});

describe('addMonths', () => {
  it('clamps to the last day rather than overflowing into the next month', () => {
    // The bug this guards: Jan 31 + 1 month naively becomes Mar 2 or Mar 3.
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30');
  });

  it('goes backwards', () => {
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });

  it('does not accumulate clamping error over a year', () => {
    // Each step is computed from the original anchor day, so a rule set to the
    // 31st returns to the 31st in months that have one.
    expect(addMonths('2026-01-31', 2)).toBe('2026-03-31');
  });
});

describe('boundaries', () => {
  it('finds month ends including leap years', () => {
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonth('2024-02-10')).toBe('2024-02-29');
    expect(endOfMonth('2026-12-01')).toBe('2026-12-31');
  });

  it('finds quarters', () => {
    expect(startOfQuarter('2026-08-13')).toBe('2026-07-01');
    expect(endOfQuarter('2026-08-13')).toBe('2026-09-30');
    expect(startOfQuarter('2026-01-01')).toBe('2026-01-01');
  });

  it('starts weeks on Monday by default', () => {
    // 2026-08-13 is a Thursday
    expect(startOfWeek('2026-08-13')).toBe('2026-08-10');
    expect(startOfWeek('2026-08-13', 0)).toBe('2026-08-09');
  });

  it('handles a week that spans a month boundary', () => {
    expect(startOfWeek('2026-09-01')).toBe('2026-08-31');
  });
});

describe('daysBetween', () => {
  it('counts across a DST boundary without drifting', () => {
    // Both dates are parsed as UTC midnight, so a local DST shift cannot make
    // this 29.958 days and round to 29.
    expect(daysBetween('2026-03-01', '2026-03-31')).toBe(30);
    expect(daysBetween('2026-10-01', '2026-11-01')).toBe(31);
  });

  it('is negative when the second date is earlier', () => {
    expect(daysBetween('2026-08-13', '2026-08-10')).toBe(-3);
  });
});

describe('periodRange', () => {
  it('produces calendar months', () => {
    const r = periodRange('2026-08-13', 'monthly');
    expect(r).toMatchObject({ start: '2026-08-01', end: '2026-08-31', label: 'August 2026' });
  });

  it('produces quarters', () => {
    expect(periodRange('2026-08-13', 'quarterly')).toMatchObject({
      start: '2026-07-01',
      end: '2026-09-30',
      label: 'Q3 2026',
    });
  });

  it('honours an anchor for non-calendar budget cycles', () => {
    // Paid on the 25th, so the "month" runs 25th to 24th.
    const r = periodRange('2026-08-13', 'monthly', '2026-01-25');
    expect(r.start).toBe('2026-07-25');
    expect(r.end).toBe('2026-08-24');
  });

  it('keeps anchored periods contiguous with no gaps or overlaps', () => {
    const a = periodRange('2026-07-30', 'monthly', '2026-01-25');
    const b = periodRange('2026-08-30', 'monthly', '2026-01-25');
    expect(addDays(a.end, 1)).toBe(b.start);
  });
});

describe('periodsBetween', () => {
  it('covers every month in a range inclusively', () => {
    const ps = periodsBetween('2026-01-15', '2026-04-02', 'monthly');
    expect(ps.map((p) => p.start)).toEqual([
      '2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01',
    ]);
  });

  it('returns a single period when start and end share one', () => {
    expect(periodsBetween('2026-08-02', '2026-08-20', 'monthly')).toHaveLength(1);
  });
});

describe('periodProgress', () => {
  it('is 1/31 on the first day of a 31-day month', () => {
    const r = periodRange('2026-08-01', 'monthly');
    expect(periodProgress(r, '2026-08-01')).toBeCloseTo(1 / 31, 5);
  });

  it('is 1 on the last day and never exceeds it', () => {
    const r = periodRange('2026-08-01', 'monthly');
    expect(periodProgress(r, '2026-08-31')).toBe(1);
    expect(periodProgress(r, '2026-09-15')).toBe(1);
  });

  it('is never negative before the period starts', () => {
    const r = periodRange('2026-08-01', 'monthly');
    expect(periodProgress(r, '2026-07-01')).toBe(0);
  });
});

describe('setDayClamped', () => {
  it('clamps a 31st rule into short months', () => {
    expect(setDayClamped('2026-04-10', 31)).toBe('2026-04-30');
    expect(setDayClamped('2026-02-10', 31)).toBe('2026-02-28');
    expect(setDayClamped('2026-08-10', 31)).toBe('2026-08-31');
  });
});

describe('nextOccurrence', () => {
  it('steps weekly and biweekly', () => {
    expect(nextOccurrence('2026-08-13', 'weekly')).toBe('2026-08-20');
    expect(nextOccurrence('2026-08-13', 'biweekly')).toBe('2026-08-27');
  });

  it('honours an interval', () => {
    expect(nextOccurrence('2026-08-13', 'monthly', 3)).toBe('2026-11-13');
  });

  it('keeps a day-of-month rule pinned across short months', () => {
    expect(nextOccurrence('2026-01-31', 'monthly', 1, { dayOfMonth: 31 })).toBe('2026-02-28');
    expect(nextOccurrence('2026-02-28', 'monthly', 1, { dayOfMonth: 31 })).toBe('2026-03-31');
  });

  it('alternates semimonthly pay dates', () => {
    expect(nextOccurrence('2026-08-05', 'semimonthly', 1, { dayOfMonth: 1 })).toBe('2026-08-16');
    expect(nextOccurrence('2026-08-20', 'semimonthly', 1, { dayOfMonth: 1 })).toBe('2026-09-01');
  });
});

describe('occurrencesBetween', () => {
  it('lists every monthly occurrence in a window', () => {
    const os = occurrencesBetween('2026-01-05', 'monthly', 1, '2026-06-01', '2026-08-31', {
      dayOfMonth: 5,
    });
    expect(os).toEqual(['2026-06-05', '2026-07-05', '2026-08-05']);
  });

  it('returns nothing when the rule starts after the window', () => {
    expect(occurrencesBetween('2027-01-01', 'monthly', 1, '2026-01-01', '2026-12-31')).toEqual([]);
  });

  it('does not hang on a rule that started years ago', () => {
    const os = occurrencesBetween('2000-01-01', 'daily', 1, '2026-08-01', '2026-08-05');
    expect(os).toHaveLength(5);
  });
});

describe('toMonthlyEquivalent', () => {
  it('normalises frequencies onto a common monthly figure', () => {
    expect(toMonthlyEquivalent(100_000, 'monthly')).toBe(100_000);
    expect(toMonthlyEquivalent(1_200_000, 'annually')).toBe(100_000);
    // Weekly is ~4.348 weeks/month, not 4 — the difference is a month a year.
    expect(toMonthlyEquivalent(10_000, 'weekly')).toBeGreaterThan(43_000);
    expect(toMonthlyEquivalent(10_000, 'weekly')).toBeLessThan(44_000);
  });
});

describe('relativeDate', () => {
  it('humanises recent dates', () => {
    expect(relativeDate('2026-08-13', '2026-08-13')).toBe('Today');
    expect(relativeDate('2026-08-12', '2026-08-13')).toBe('Yesterday');
    expect(relativeDate('2026-08-10', '2026-08-13')).toBe('3 days ago');
    expect(relativeDate('2026-08-14', '2026-08-13')).toBe('Tomorrow');
  });

  it('falls back to a formatted date once it is far enough away', () => {
    expect(relativeDate('2026-01-05', '2026-08-13')).toBe('5 Jan');
    expect(relativeDate('2025-01-05', '2026-08-13')).toBe('5 Jan 2025');
  });
});
