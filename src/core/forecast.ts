/**
 * Forecasting.
 *
 * Personal finance series are short (a user has 6–24 monthly points, not
 * thousands), noisy, and seasonal in an obvious way — rent lands monthly, data
 * bundles weekly, school fees in September. That rules out anything that needs
 * a long training series and rules in the classical exponential-smoothing
 * family, which is well-behaved on a dozen points.
 *
 * Three models, picked by how much history exists:
 *   - `mean`           : <4 points. Flat line at the average.
 *   - `seasonal_naive` : enough points to cover a full season, and the seasonal
 *                        signal beats the trend signal on backtest.
 *   - `holt_linear`    : level + trend, double exponential smoothing.
 *
 * Every forecast is backtested before it is shown, and the resulting MAPE is
 * carried on the result so the UI can label a shaky prediction as shaky rather
 * than drawing a confident-looking line through noise.
 */

import { money, zero, type CurrencyCode, type Money } from './money';
import type { ConfidenceLevel, Forecast, ISODate } from './types';

export interface SeriesPoint {
  date: ISODate;
  /** Minor units. Signed — the caller decides whether this is spend or net. */
  value: number;
}

export interface ForecastOptions {
  /** How many future buckets to predict. */
  horizon: number;
  /** Bucket count that makes one full season: 12 for months, 7 for days. */
  seasonLength?: number;
  currency: CurrencyCode;
  /** Width of the prediction band in standard deviations. 1.28 ≈ 80%. */
  zScore?: number;
  /** Step between buckets, used to generate future dates. */
  step?: 'day' | 'week' | 'month';
}

// --------------------------------------------------------------------- models

/**
 * Holt's linear trend method.
 *
 * `alpha` smooths the level, `beta` the trend. Both are fitted by grid search
 * rather than hardcoded, because the right smoothing for someone with steady
 * salaried income is very different from the right smoothing for someone whose
 * income arrives in irregular lumps.
 */
export function holtLinear(
  values: number[],
  horizon: number,
  alpha: number,
  beta: number
): number[] {
  if (values.length === 0) return new Array(horizon).fill(0);
  if (values.length === 1) return new Array(horizon).fill(values[0]);

  let level = values[0];
  let trend = values[1] - values[0];

  for (let i = 1; i < values.length; i++) {
    const prevLevel = level;
    level = alpha * values[i] + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }

  const out: number[] = [];
  for (let h = 1; h <= horizon; h++) {
    out.push(level + h * trend);
  }
  return out;
}

/**
 * Seasonal naive: next value equals the value one full season ago.
 *
 * Crude, and very hard to beat on household spending. December looks like last
 * December; the first of the month looks like the first of last month.
 */
export function seasonalNaive(
  values: number[],
  horizon: number,
  seasonLength: number
): number[] {
  if (values.length < seasonLength) {
    const mean = average(values);
    return new Array(horizon).fill(mean);
  }
  const out: number[] = [];
  for (let h = 0; h < horizon; h++) {
    const idx = values.length - seasonLength + (h % seasonLength);
    out.push(values[idx]);
  }
  return out;
}

export function meanForecast(values: number[], horizon: number): number[] {
  return new Array(horizon).fill(average(values));
}

// ------------------------------------------------------------------ selection

/**
 * Rolling-origin backtest.
 *
 * Refits on a growing prefix of the series and scores the one-step-ahead
 * prediction each time. This is the honest way to compare models on a short
 * series — scoring on data the model was fitted to would always favour the most
 * flexible model.
 */
export function backtestMAPE(
  values: number[],
  predict: (history: number[], horizon: number) => number[],
  minTrain = 3
): number | null {
  if (values.length < minTrain + 1) return null;

  const errors: number[] = [];
  for (let split = minTrain; split < values.length; split++) {
    const history = values.slice(0, split);
    const predicted = predict(history, 1)[0];
    const actual = values[split];
    // Zero actuals make percentage error undefined; skip rather than divide.
    if (Math.abs(actual) < 1) continue;
    errors.push(Math.abs((actual - predicted) / actual));
  }
  if (errors.length === 0) return null;
  return average(errors);
}

/** Grid-search alpha and beta against the backtest, rather than guessing. */
function fitHolt(values: number[]): { alpha: number; beta: number; mape: number | null } {
  const grid = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  let best = { alpha: 0.3, beta: 0.1, mape: Number.POSITIVE_INFINITY };

  for (const alpha of grid) {
    for (const beta of grid) {
      const mape = backtestMAPE(values, (h, n) => holtLinear(h, n, alpha, beta));
      if (mape != null && mape < best.mape) best = { alpha, beta, mape };
    }
  }
  return {
    alpha: best.alpha,
    beta: best.beta,
    mape: Number.isFinite(best.mape) ? best.mape : null,
  };
}

// ------------------------------------------------------------------- forecast

export function forecastSeries(
  series: SeriesPoint[],
  opts: ForecastOptions
): Forecast {
  const { horizon, currency, seasonLength = 12, zScore = 1.28, step = 'month' } = opts;
  const values = series.map((p) => p.value);
  const lastDate = series.length > 0 ? series[series.length - 1].date : todayISO();

  if (values.length < 2) {
    return {
      points: futureDates(lastDate, horizon, step).map((date) => ({
        date,
        value: money(values[0] ?? 0, currency),
        lower: zero(currency),
        upper: money(values[0] ?? 0, currency),
      })),
      method: 'insufficient_data',
      mape: null,
      confidence: 'low',
    };
  }

  // Fit every candidate, then pick by backtest score. Ties go to the simpler
  // model, which is why `mean` is checked last and only wins outright.
  const holt = fitHolt(values);
  const holtMape = holt.mape;
  const seasonalMape =
    values.length >= seasonLength + 1
      ? backtestMAPE(values, (h, n) => seasonalNaive(h, n, seasonLength), seasonLength)
      : null;
  const meanMape = backtestMAPE(values, meanForecast);

  let method: Forecast['method'] = 'mean';
  let predicted: number[] = meanForecast(values, horizon);
  let mape = meanMape;

  const candidates: Array<[Forecast['method'], number | null, () => number[]]> = [
    ['holt_linear', holtMape, () => holtLinear(values, horizon, holt.alpha, holt.beta)],
    ['seasonal_naive', seasonalMape, () => seasonalNaive(values, horizon, seasonLength)],
    ['mean', meanMape, () => meanForecast(values, horizon)],
  ];

  let bestScore = Number.POSITIVE_INFINITY;
  for (const [name, score, build] of candidates) {
    if (score != null && score < bestScore) {
      bestScore = score;
      method = name;
      predicted = build();
      mape = score;
    }
  }

  // Band width comes from the residuals of the chosen model, widening with the
  // horizon by sqrt(h) — uncertainty compounds the further out you look.
  const residualSd = residualStdDev(values, method, holt, seasonLength);
  const dates = futureDates(lastDate, horizon, step);

  const points = predicted.map((value, i) => {
    const spread = zScore * residualSd * Math.sqrt(i + 1);
    return {
      date: dates[i],
      value: money(Math.round(value), currency),
      lower: money(Math.round(value - spread), currency),
      upper: money(Math.round(value + spread), currency),
    };
  });

  return { points, method, mape, confidence: confidenceFrom(mape, values.length) };
}

function residualStdDev(
  values: number[],
  method: Forecast['method'],
  holt: { alpha: number; beta: number },
  seasonLength: number
): number {
  const residuals: number[] = [];
  for (let i = 2; i < values.length; i++) {
    const history = values.slice(0, i);
    let predicted: number;
    if (method === 'holt_linear') {
      predicted = holtLinear(history, 1, holt.alpha, holt.beta)[0];
    } else if (method === 'seasonal_naive') {
      predicted = seasonalNaive(history, 1, seasonLength)[0];
    } else {
      predicted = average(history);
    }
    residuals.push(values[i] - predicted);
  }
  return stdDev(residuals);
}

/**
 * Confidence shown next to the forecast.
 *
 * Both terms matter: a low error on four data points is luck, and a long
 * history with 60% error is still a bad forecast.
 */
function confidenceFrom(mape: number | null, n: number): ConfidenceLevel {
  if (mape == null || n < 4) return 'low';
  if (mape < 0.15 && n >= 8) return 'high';
  if (mape < 0.35 && n >= 5) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------- projections

/**
 * Project a running balance forward, combining a forecast of discretionary
 * spend with the known recurring bills.
 *
 * Keeping the two separate is the point: rent on the 1st is not a statistical
 * event, it is a fact, and blending it into a smoothed average is what makes
 * naive balance projections wrong right when they matter — around a big
 * scheduled outflow.
 */
export function projectBalance(
  startingBalance: Money,
  discretionaryPerBucket: Money[],
  scheduled: Array<{ date: ISODate; amountMinor: number }>,
  bucketDates: ISODate[]
): Array<{ date: ISODate; balance: Money; scheduledOut: Money }> {
  const currency = startingBalance.currency;
  let running = startingBalance.minor;
  const out: Array<{ date: ISODate; balance: Money; scheduledOut: Money }> = [];

  for (let i = 0; i < bucketDates.length; i++) {
    const bucketEnd = bucketDates[i];
    const bucketStart = i === 0 ? '0000-01-01' : bucketDates[i - 1];

    const scheduledMinor = scheduled
      .filter((s) => s.date > bucketStart && s.date <= bucketEnd)
      .reduce((acc, s) => acc + s.amountMinor, 0);

    running += scheduledMinor;
    running -= Math.abs(discretionaryPerBucket[i]?.minor ?? 0);

    out.push({
      date: bucketEnd,
      balance: money(running, currency),
      scheduledOut: money(scheduledMinor, currency),
    });
  }
  return out;
}

/** First projected date the balance goes negative — the "you run out on the
 *  19th" warning, which is the single most useful thing a forecast can say. */
export function firstShortfall(
  projection: Array<{ date: ISODate; balance: Money }>
): { date: ISODate; balance: Money } | null {
  return projection.find((p) => p.balance.minor < 0) ?? null;
}

/**
 * Detect an unusual transaction against its category's own history.
 *
 * Uses median and MAD rather than mean and standard deviation, because a single
 * previous outlier inflates the standard deviation enough to hide the next one.
 * The 0.6745 factor rescales MAD to be comparable with a standard deviation on
 * normally distributed data.
 */
export function anomalyScore(value: number, history: number[]): number {
  if (history.length < 4) return 0;
  const med = median(history);
  const deviations = history.map((v) => Math.abs(v - med));
  const mad = median(deviations);
  if (mad === 0) return value === med ? 0 : 1;
  return Math.abs((0.6745 * (value - med)) / mad);
}

export function isAnomaly(value: number, history: number[], threshold = 3.5): boolean {
  return anomalyScore(value, history) > threshold;
}

// ------------------------------------------------------------------- helpers

function average(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = average(xs);
  const variance = xs.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

function todayISO(): ISODate {
  return new Date().toISOString().slice(0, 10);
}

function futureDates(from: ISODate, count: number, step: 'day' | 'week' | 'month'): ISODate[] {
  const out: ISODate[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  for (let i = 0; i < count; i++) {
    if (step === 'day') d.setUTCDate(d.getUTCDate() + 1);
    else if (step === 'week') d.setUTCDate(d.getUTCDate() + 7);
    else {
      const day = d.getUTCDate();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + 1);
      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      d.setUTCDate(Math.min(day, last));
    }
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
