import { describe, it, expect } from 'vitest';
import {
  anomalyScore,
  backtestMAPE,
  firstShortfall,
  forecastSeries,
  holtLinear,
  isAnomaly,
  median,
  projectBalance,
  seasonalNaive,
  type SeriesPoint,
} from '@/core/forecast';
import { money } from '@/core/money';

function series(values: number[], startMonth = 1): SeriesPoint[] {
  return values.map((value, i) => ({
    date: `2026-${String(startMonth + i).padStart(2, '0')}-01`,
    value,
  }));
}

describe('holtLinear', () => {
  it('continues a clean linear trend', () => {
    const out = holtLinear([100, 200, 300, 400, 500], 3, 0.8, 0.8);
    expect(out[0]).toBeCloseTo(600, -1);
    expect(out[1]).toBeCloseTo(700, -1);
    expect(out[2]).toBeCloseTo(800, -1);
  });

  it('holds flat on a flat series', () => {
    const out = holtLinear([500, 500, 500, 500], 2, 0.5, 0.5);
    expect(out[0]).toBeCloseTo(500, 5);
    expect(out[1]).toBeCloseTo(500, 5);
  });

  it('degrades safely on tiny inputs', () => {
    expect(holtLinear([], 3, 0.5, 0.5)).toEqual([0, 0, 0]);
    expect(holtLinear([42], 2, 0.5, 0.5)).toEqual([42, 42]);
  });
});

describe('seasonalNaive', () => {
  it('repeats the last full season', () => {
    const out = seasonalNaive([10, 20, 30, 40, 11, 21, 31, 41], 4, 4);
    expect(out).toEqual([11, 21, 31, 41]);
  });

  it('falls back to the mean when there is less than one season', () => {
    expect(seasonalNaive([10, 20], 2, 12)).toEqual([15, 15]);
  });
});

describe('backtestMAPE', () => {
  it('scores a perfect model at zero error', () => {
    const mape = backtestMAPE([100, 100, 100, 100, 100], (h, n) => new Array(n).fill(100));
    expect(mape).toBe(0);
  });

  it('scores a badly wrong model highly', () => {
    const mape = backtestMAPE([100, 100, 100, 100, 100], (h, n) => new Array(n).fill(50));
    expect(mape).toBeCloseTo(0.5, 3);
  });

  it('returns null when there is too little history to score', () => {
    expect(backtestMAPE([100, 200], () => [0])).toBeNull();
  });

  it('skips zero actuals rather than dividing by them', () => {
    const mape = backtestMAPE([100, 100, 100, 0, 100], (h, n) => new Array(n).fill(100));
    expect(mape).not.toBeNull();
    expect(Number.isFinite(mape!)).toBe(true);
  });
});

describe('forecastSeries', () => {
  it('flags insufficient data rather than inventing a trend', () => {
    const f = forecastSeries(series([100]), { horizon: 3, currency: 'NGN' });
    expect(f.method).toBe('insufficient_data');
    expect(f.confidence).toBe('low');
    expect(f.points).toHaveLength(3);
  });

  it('tracks a steady upward trend', () => {
    const f = forecastSeries(series([100, 110, 120, 130, 140, 150, 160, 170]), {
      horizon: 2,
      currency: 'NGN',
    });
    expect(f.points[0].value.minor).toBeGreaterThan(170);
    expect(f.points[1].value.minor).toBeGreaterThan(f.points[0].value.minor);
  });

  it('reports high confidence on a clean series and low on noise', () => {
    const clean = forecastSeries(series([100, 110, 120, 130, 140, 150, 160, 170, 180]), {
      horizon: 1,
      currency: 'NGN',
    });
    expect(clean.confidence).toBe('high');
    expect(clean.mape).toBeLessThan(0.15);

    const noisy = forecastSeries(series([100, 900, 150, 1200, 80, 1400, 60, 1600, 40]), {
      horizon: 1,
      currency: 'NGN',
    });
    expect(noisy.confidence).toBe('low');
  });

  it('widens the prediction band further out', () => {
    const f = forecastSeries(series([100, 130, 90, 140, 110, 150, 95, 160]), {
      horizon: 4,
      currency: 'NGN',
    });
    const width = (i: number) => f.points[i].upper.minor - f.points[i].lower.minor;
    expect(width(3)).toBeGreaterThan(width(0));
  });

  it('brackets its own prediction with the band', () => {
    const f = forecastSeries(series([100, 120, 95, 130, 105, 135, 110, 140]), {
      horizon: 3,
      currency: 'NGN',
    });
    for (const p of f.points) {
      expect(p.lower.minor).toBeLessThanOrEqual(p.value.minor);
      expect(p.upper.minor).toBeGreaterThanOrEqual(p.value.minor);
    }
  });

  it('generates monthly future dates that follow the series', () => {
    const f = forecastSeries(series([100, 110, 120, 130]), {
      horizon: 2,
      currency: 'NGN',
      step: 'month',
    });
    expect(f.points.map((p) => p.date)).toEqual(['2026-05-01', '2026-06-01']);
  });

  it('prefers the seasonal model on a strongly seasonal series', () => {
    // A 4-month cycle repeated three times with no trend.
    const seasonal = [10, 90, 20, 80, 10, 90, 20, 80, 10, 90, 20, 80];
    const f = forecastSeries(series(seasonal), {
      horizon: 4,
      currency: 'NGN',
      seasonLength: 4,
    });
    expect(f.method).toBe('seasonal_naive');
    expect(f.points.map((p) => p.value.minor)).toEqual([10, 90, 20, 80]);
  });
});

describe('projectBalance', () => {
  it('drops the balance on the day a scheduled bill lands, not smoothly', () => {
    const projection = projectBalance(
      money(100_000, 'NGN'),
      [money(10_000, 'NGN'), money(10_000, 'NGN'), money(10_000, 'NGN')],
      [{ date: '2026-09-01', amountMinor: -50_000 }],
      ['2026-08-31', '2026-09-30', '2026-10-31']
    );
    expect(projection[0].balance.minor).toBe(90_000); // 100k - 10k discretionary
    expect(projection[1].balance.minor).toBe(30_000); // - 50k rent - 10k
    expect(projection[1].scheduledOut.minor).toBe(-50_000);
    expect(projection[2].balance.minor).toBe(20_000);
  });

  it('adds scheduled inflows', () => {
    const projection = projectBalance(
      money(0, 'NGN'),
      [money(0, 'NGN')],
      [{ date: '2026-09-01', amountMinor: 500_000 }],
      ['2026-09-30']
    );
    expect(projection[0].balance.minor).toBe(500_000);
  });
});

describe('firstShortfall', () => {
  it('finds the first date the balance goes negative', () => {
    const p = [
      { date: '2026-08-31', balance: money(50_000, 'NGN') },
      { date: '2026-09-30', balance: money(-10_000, 'NGN') },
      { date: '2026-10-31', balance: money(-90_000, 'NGN') },
    ];
    expect(firstShortfall(p)?.date).toBe('2026-09-30');
  });

  it('returns null when the balance holds', () => {
    expect(firstShortfall([{ date: '2026-08-31', balance: money(1, 'NGN') }])).toBeNull();
  });
});

describe('anomaly detection', () => {
  const normalGroceryRuns = [5000, 5200, 4800, 5100, 4900, 5300, 5000];

  it('does not flag a normal transaction', () => {
    expect(isAnomaly(5150, normalGroceryRuns)).toBe(false);
  });

  it('flags a transaction far outside the usual range', () => {
    expect(isAnomaly(45000, normalGroceryRuns)).toBe(true);
  });

  it('is not blinded by a previous outlier', () => {
    // Mean + standard deviation would be so inflated by the 200k entry that the
    // next 45k spend looks normal. MAD keeps the scale honest.
    const withOutlier = [...normalGroceryRuns, 200000];
    expect(isAnomaly(45000, withOutlier)).toBe(true);
  });

  it('stays quiet without enough history to judge', () => {
    expect(anomalyScore(999999, [100, 200])).toBe(0);
  });

  it('handles a perfectly constant history', () => {
    expect(anomalyScore(100, [100, 100, 100, 100])).toBe(0);
    expect(anomalyScore(500, [100, 100, 100, 100])).toBe(1);
  });
});

describe('median', () => {
  it('averages the middle pair on even-length input', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([3, 1, 4, 2])).toBe(2.5);
    expect(median([5])).toBe(5);
    expect(median([])).toBe(0);
  });
});
