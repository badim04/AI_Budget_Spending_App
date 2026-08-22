/**
 * Everything the dashboard needs, derived in one place.
 *
 * Reads live state from the store and runs it through the same pure functions
 * the tests exercise. The screen never reaches into the engine itself, and the
 * engine never knows the store exists.
 */

import { useCallback, useMemo, useState } from 'react';
import { money, type Money } from '../core/money';
import {
  allBudgetStatuses,
  aggregateBudgets,
  safeToSpend,
  type BudgetContext,
} from '../core/budget';
import {
  categoryTotals,
  excludedCategoryIds,
  generateInsights,
  unconvertibleCurrencies,
  withOtherBucket,
  type AnalyticsContext,
} from '../core/analytics';
import { forecastSeries, firstShortfall, projectBalance } from '../core/forecast';
import {
  addMonths,
  daysRemaining,
  endOfMonth,
  occurrencesBetween,
  periodRange,
  periodsBetween,
  startOfMonth,
  today,
} from '../core/dates';
import type { BudgetStatus, CategoryTotal, Forecast, Insight, ISODate } from '../core/types';
import { useAppStore } from '../store/useAppStore';

export interface UpcomingBill {
  id: string;
  name: string;
  date: ISODate;
  amount: Money;
  variable: boolean;
}

export interface DashboardData {
  asOf: ISODate;
  hasData: boolean;
  displayCurrency: string;
  safeToSpend: Money;
  safeToSpendPerDay: Money;
  spent: Money;
  allocated: Money;
  utilisation: number | null;
  budgets: BudgetStatus[];
  categories: CategoryTotal[];
  trend: Array<{ date: ISODate; value: Money }>;
  forecast: Forecast;
  upcoming: UpcomingBill[];
  insights: Insight[];
  shortfallDate: ISODate | null;
  staleCurrencies: string[];
  unreviewedCount: number;
}

export function useDashboardData(asOfOverride?: ISODate) {
  const [refreshing, setRefreshing] = useState(false);

  const transactions = useAppStore((s) => s.transactions);
  const categories = useAppStore((s) => s.categories);
  const accounts = useAppStore((s) => s.accounts);
  const budgetDefs = useAppStore((s) => s.budgets);
  const recurringRules = useAppStore((s) => s.recurringRules);
  const settings = useAppStore((s) => s.settings);
  const fxTable = useAppStore((s) => s.fxTable);
  const reload = useAppStore((s) => s.load);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }, [reload]);

  const data = useMemo<DashboardData>(() => {
    const asOf = asOfOverride ?? today();
    const displayCurrency = settings.display_currency ?? 'NGN';
    const fx = fxTable();

    const analytics: AnalyticsContext = {
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

    const range = periodRange(asOf, 'monthly');
    const budgets = allBudgetStatuses(budgetDefs, budgetCtx, asOf);
    const aggregate = aggregateBudgets(budgets, displayCurrency);
    const remainingDays = Math.max(1, daysRemaining(range, asOf));
    const safe = safeToSpend(budgets, displayCurrency);

    // --- Trend: the last 8 months of actual spend -------------------------
    const trendStart = startOfMonth(addMonths(asOf, -7));
    const monthly = periodsBetween(trendStart, endOfMonth(asOf), 'monthly').map((p) => {
      const total = categoryTotals(p, analytics, 'expense').reduce(
        (a, r) => a + r.total.minor,
        0
      );
      return { date: p.end, value: money(total, displayCurrency) };
    });

    // The current month is partial, so it is excluded from the model's input —
    // fitting on a half-finished month drags every projection downward.
    const completeMonths = monthly.slice(0, -1);
    const forecast = forecastSeries(
      completeMonths.map((p) => ({ date: p.date, value: p.value.minor })),
      { horizon: 3, currency: displayCurrency, seasonLength: 12, step: 'month' }
    );

    // --- Upcoming bills from the recurring rules --------------------------
    const horizonEnd = addMonths(asOf, 1);
    const upcoming: UpcomingBill[] = recurringRules
      .filter((rule) => rule.active)
      .flatMap((rule) =>
        occurrencesBetween(rule.startsOn, rule.frequency, rule.interval, asOf, horizonEnd, {
          dayOfMonth: rule.dayOfMonth,
          dayOfWeek: rule.dayOfWeek,
        }).map((date) => ({
          id: `${rule.id}_${date}`,
          name: rule.name,
          date,
          amount: money(Math.abs(rule.amountMinor), rule.currency),
          variable: rule.variableAmount,
        }))
      )
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 5);

    // --- Will the money last? ---------------------------------------------
    const liquidNow = accounts
      .filter((a) => !a.archived && ['cash', 'bank', 'mobile_money', 'savings'].includes(a.kind))
      .map((a) => {
        const balance = transactions
          .filter((t) => t.accountId === a.id && !t.deletedAt && t.date <= asOf)
          .reduce((acc, t) => acc + t.amountMinor, a.openingBalanceMinor);
        try {
          return fx.convert(money(balance, a.currency), displayCurrency).minor;
        } catch {
          return 0;
        }
      })
      .reduce((a, b) => a + b, 0);

    const weeks = periodsBetween(asOf, addMonths(asOf, 2), 'weekly');
    const weeklyBurn = forecast.points[0]
      ? Math.round(forecast.points[0].value.minor / 4.33)
      : 0;
    const projection = projectBalance(
      money(liquidNow, displayCurrency),
      weeks.map(() => money(weeklyBurn, displayCurrency)),
      recurringRules
        .filter((r) => r.active)
        .flatMap((r) =>
          occurrencesBetween(r.startsOn, r.frequency, r.interval, asOf, addMonths(asOf, 2), {
            dayOfMonth: r.dayOfMonth,
          }).map((date) => ({ date, amountMinor: r.amountMinor }))
        ),
      weeks.map((w) => w.end)
    );

    const categoryRows = withOtherBucket(
      categoryTotals(range, analytics, 'expense'),
      7,
      displayCurrency
    );

    return {
      asOf,
      hasData: transactions.some((t) => !t.deletedAt),
      displayCurrency,
      safeToSpend: safe,
      safeToSpendPerDay: money(Math.round(safe.minor / remainingDays), displayCurrency),
      spent: aggregate.spent,
      allocated: aggregate.allocated,
      utilisation: aggregate.utilisation,
      budgets,
      categories: categoryRows,
      trend: monthly,
      forecast,
      upcoming,
      insights: generateInsights(analytics, budgets),
      shortfallDate: firstShortfall(projection)?.date ?? null,
      staleCurrencies: unconvertibleCurrencies(analytics),
      unreviewedCount: transactions.filter((t) => !t.deletedAt && !t.reviewed).length,
    };
  }, [asOfOverride, transactions, categories, accounts, budgetDefs, recurringRules, settings, fxTable]);

  return { data, loading: refreshing, refresh };
}
