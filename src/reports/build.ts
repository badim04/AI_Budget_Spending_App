/**
 * Report generation.
 *
 * One report model, several output formats. `buildReport()` does all the
 * analysis and returns plain data; the exporters in `export.ts` turn that into
 * PDF, CSV or Excel. Keeping them apart means the numbers are computed once and
 * every format shows the same figures — a PDF that disagreed with the CSV would
 * be worse than having no export at all.
 *
 * Pure: no React, no filesystem. Tested in plain Node.
 */

import { FxTable, formatMoney, money, type CurrencyCode, type Money } from '../core/money';
import {
  categoryTotals,
  excludedCategoryIds,
  netWorth,
  runwayMonths,
  savingsRate,
  topMerchants,
  totalIncome,
  totalSpend,
  yearOverYear,
  type AnalyticsContext,
} from '../core/analytics';
import { allBudgetStatuses, type BudgetContext } from '../core/budget';
import { forecastSeries } from '../core/forecast';
import {
  addMonths,
  endOfMonth,
  formatDate,
  periodRange,
  periodsBetween,
  startOfMonth,
} from '../core/dates';
import type {
  Account,
  Budget,
  BudgetPeriod,
  BudgetStatus,
  CategoryTotal,
  Category,
  ISODate,
  PeriodRange,
  Transaction,
} from '../core/types';

export interface ReportInput {
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  budgets: Budget[];
  displayCurrency: CurrencyCode;
  fx: FxTable;
  /** Inclusive range the report covers. */
  range: PeriodRange;
  asOf: ISODate;
  /** Label shown in the header, e.g. "Finlo". */
  appName?: string;
}

export interface ReportKpi {
  label: string;
  value: string;
  /** Supporting line, e.g. what it is measured against. */
  hint?: string;
}

/** A transaction with its category and account resolved to names, so exporters
 *  never have to carry the lookup tables around. */
export interface ReportTransaction extends Transaction {
  categoryName: string;
  accountName: string;
}

export interface MonthlyPoint {
  label: string;
  date: ISODate;
  income: Money;
  spend: Money;
  net: Money;
}

export interface Report {
  title: string;
  subtitle: string;
  generatedAt: string;
  currency: CurrencyCode;
  range: PeriodRange;

  kpis: ReportKpi[];
  categories: CategoryTotal[];
  merchants: Array<{ merchant: string; total: Money; count: number }>;
  monthly: MonthlyPoint[];
  budgets: BudgetStatus[];
  transactions: ReportTransaction[];
  /** Forward projection of monthly spend, so the report says something about
   *  what happens next rather than only what already happened. */
  forecast: Array<{ date: ISODate; value: Money; lower: Money; upper: Money }>;
  forecastNote: string;

  totals: {
    income: Money;
    spend: Money;
    net: Money;
    openingNetWorth: Money;
    closingNetWorth: Money;
  };
}

/** Six months of history behind the range, for trend and forecasting. */
const TREND_MONTHS = 6;

export function buildReport(input: ReportInput): Report {
  const {
    transactions,
    categories,
    accounts,
    budgets,
    displayCurrency,
    fx,
    range,
    asOf,
  } = input;

  const ctx: AnalyticsContext = {
    transactions,
    categories,
    accounts,
    displayCurrency,
    fx,
    asOf,
  };

  const budgetCtx: BudgetContext = {
    transactions,
    excludedCategoryIds: excludedCategoryIds(categories),
    asOf,
  };

  const spend = totalSpend(range, ctx);
  const income = totalIncome(range, ctx);
  const net = money(income.minor - spend.minor, displayCurrency);

  const rate = savingsRate(range, ctx);
  const runway = runwayMonths(ctx);
  const worthOpen = netWorth(ctx, previousDay(range.start));
  const worthClose = netWorth(ctx, range.end);
  const yoy = yearOverYear(range, ctx);

  // --- monthly trend, ending with the report range -------------------------
  const trendStart = startOfMonth(addMonths(range.end, -(TREND_MONTHS - 1)));
  const monthly: MonthlyPoint[] = periodsBetween(
    trendStart,
    endOfMonth(range.end),
    'monthly'
  ).map((p) => {
    const s = totalSpend(p, ctx);
    const i = totalIncome(p, ctx);
    return {
      label: p.label,
      date: p.end,
      income: i,
      spend: s,
      net: money(i.minor - s.minor, displayCurrency),
    };
  });

  // Forecast on COMPLETE months only. Including a partial month drags every
  // projection down and is the most common way home-grown forecasts go wrong.
  const complete = monthly.filter((m) => m.date <= endOfMonth(asOf) && m.date < asOf);
  const forecast = forecastSeries(
    complete.map((m) => ({ date: m.date, value: m.spend.minor })),
    { horizon: 3, currency: displayCurrency, seasonLength: 12, step: 'month' }
  );

  const kpis: ReportKpi[] = [
    { label: 'Total spend', value: formatMoney(spend), hint: range.label },
    { label: 'Total income', value: formatMoney(income), hint: range.label },
    {
      label: 'Net',
      value: formatMoney(net, { signed: true }),
      hint: net.minor >= 0 ? 'You kept money this period' : 'You spent more than came in',
    },
    {
      label: 'Savings rate',
      value: rate == null ? '—' : `${Math.round(rate * 100)}%`,
      hint: rate == null ? 'No income recorded' : rate > 0.2 ? 'Above the 20% mark' : 'Below the 20% mark',
    },
    {
      label: 'Runway',
      value: runway == null ? '—' : `${runway.toFixed(1)} months`,
      hint: 'Liquid balance at your median monthly spend',
    },
    {
      label: 'Net worth',
      value: formatMoney(worthClose.net),
      hint: `${formatMoney(
        money(worthClose.net.minor - worthOpen.net.minor, displayCurrency),
        { signed: true }
      )} over the period`,
    },
  ];

  if (yoy.change != null) {
    kpis.push({
      label: 'vs last year',
      value: `${yoy.change > 0 ? '+' : ''}${Math.round(yoy.change * 100)}%`,
      hint: `${formatMoney(yoy.priorYear)} in the same period last year`,
    });
  }

  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));

  const inRange: ReportTransaction[] = transactions
    .filter((t) => !t.deletedAt && t.date >= range.start && t.date <= range.end)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((t) => ({
      ...t,
      categoryName: t.categoryId ? (categoryName.get(t.categoryId) ?? 'Uncategorised') : 'Uncategorised',
      accountName: accountName.get(t.accountId) ?? 'Unknown account',
    }));

  return {
    title: `${input.appName ?? 'Finlo'} report`,
    subtitle: range.label,
    generatedAt: new Date().toISOString(),
    currency: displayCurrency,
    range,
    kpis,
    categories: categoryTotals(range, ctx, 'expense'),
    merchants: topMerchants(range, ctx, 10),
    monthly,
    budgets: allBudgetStatuses(budgets, budgetCtx, range.end),
    transactions: inRange,
    forecast: forecast.points,
    forecastNote: describeForecast(forecast.method, forecast.mape, forecast.confidence),
    totals: {
      income,
      spend,
      net,
      openingNetWorth: worthOpen.net,
      closingNetWorth: worthClose.net,
    },
  };
}

function describeForecast(
  method: string,
  mape: number | null,
  confidence: string
): string {
  if (method === 'insufficient_data') {
    return 'Not enough complete months to project forward yet.';
  }
  const name =
    method === 'holt_linear' ? 'trend' : method === 'seasonal_naive' ? 'seasonal' : 'average';
  const error = mape == null ? '' : `, typical error ±${Math.round(mape * 100)}%`;
  return `Projected with a ${name} model${error}. Confidence: ${confidence}.`;
}

function previousDay(date: ISODate): ISODate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// -------------------------------------------------------------- range helpers

export type ReportPeriod = 'this_month' | 'last_month' | 'quarter' | 'year' | 'all';

export function reportRange(
  period: ReportPeriod,
  asOf: ISODate,
  earliest: ISODate | null
): PeriodRange {
  switch (period) {
    case 'this_month':
      return periodRange(asOf, 'monthly');
    case 'last_month':
      return periodRange(addMonths(asOf, -1), 'monthly');
    case 'quarter':
      return periodRange(asOf, 'quarterly');
    case 'year':
      return periodRange(asOf, 'annually');
    case 'all':
      return {
        start: earliest ?? startOfMonth(addMonths(asOf, -11)),
        end: asOf,
        label: 'All time',
      };
  }
}

export const REPORT_PERIOD_LABELS: Record<ReportPeriod, string> = {
  this_month: 'This month',
  last_month: 'Last month',
  quarter: 'This quarter',
  year: 'This year',
  all: 'All time',
};
