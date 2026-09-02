/**
 * Analysis — the numbers, at whatever granularity you ask for.
 *
 * Split out of Insights in v1.2, because the one screen had been answering two
 * different questions and doing neither cleanly. "How much went where, and how
 * does that compare" is a chart question, read with a finger on the screen.
 * "Am I doing all right, and what should I do about it" is a sentence question,
 * read once. Putting both on one page meant every visit scrolled past half of
 * what it was not there for.
 *
 * So: Analysis holds the ring, the bars, the period comparison and the
 * merchants. Insights holds the score and the sentences. They are siblings, and
 * each carries a track at the top to reach the other, because on a phone the
 * bottom bar cannot hold seven destinations and two taps to change your mind is
 * one too many.
 *
 * Granularity is the thing this page adds that neither had: monthly, quarterly
 * and yearly buckets of the same series. A year of spending read one month at a
 * time is twelve facts; read as a year it is a shape.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../../src/theme/ThemeProvider';
import { AppHeader } from '../../src/components/ui/AppHeader';
import { useLayout } from '../../src/theme/layout';
import { Screen, Grid, Split } from '../../src/components/ui/Screen';
import {
  AmountText,
  Card,
  SectionHeader,
} from '../../src/components/ui/Primitives';
import {
  ScrollRow,
  SegmentedControl,
  StatRow,
  StatTile,
} from '../../src/components/ui/Tiles';
import { Ring, RingLegend, type RingSlice } from '../../src/components/charts/Ring';
import { CategoryBreakdown } from '../../src/components/charts/CategoryBreakdown';
import { SpendTrendChart } from '../../src/components/charts/SpendTrendChart';
import { PeriodBar } from '../../src/components/ui/PeriodBar';
import { Spot } from '../../src/components/art/Spot';
import { useAppStore } from '../../src/store/useAppStore';
import { formatMoney, money } from '../../src/core/money';
import { formatDate, addMonths, today } from '../../src/core/dates';
import {
  cashflowSeries,
  categoryTotals,
  comparePeriods,
  topMerchants,
  totalIncome,
  totalSpend,
  withOtherBucket,
  type AnalyticsContext,
} from '../../src/core/analytics';
import {
  elapsedRange,
  isCurrentMonth,
  matchingSlice,
  monthOf,
  previousMonth,
} from '../../src/core/periods';
import { forecastSeries } from '../../src/core/forecast';
import type { BudgetPeriod, CategoryTotal, PeriodRange } from '../../src/core/types';

/** The three granularities worth offering. Weekly is noise, daily is a diary. */
type Grain = 'monthly' | 'quarterly' | 'annually';

const GRAIN_MONTHS: Record<Grain, number> = { monthly: 12, quarterly: 24, annually: 60 };

export default function AnalysisScreen() {
  const { c, type: t, space: sp } = useTheme();
  const layout = useLayout();
  const { width } = useWindowDimensions();

  const transactions = useAppStore((s) => s.transactions);
  const accounts = useAppStore((s) => s.accounts);
  const categories = useAppStore((s) => s.categories);
  const settings = useAppStore((s) => s.settings);
  const fxTable = useAppStore((s) => s.fxTable);

  const asOf = today();
  const currency = settings.display_currency ?? 'NGN';
  const [grain, setGrain] = useState<Grain>('monthly');
  const [range, setRange] = useState<PeriodRange>(() => monthOf(asOf));

  const ctx: AnalyticsContext = useMemo(
    () => ({
      transactions,
      categories,
      accounts,
      displayCurrency: currency,
      fx: fxTable(),
      asOf,
    }),
    [transactions, categories, accounts, currency, fxTable, asOf]
  );

  const live = isCurrentMonth(range, asOf);
  const elapsed = live ? elapsedRange(range, asOf) : range;
  const baseline = previousMonth(range);

  const comparison = useMemo(
    () => comparePeriods(elapsed, live ? matchingSlice(baseline, elapsed) : baseline, ctx),
    [elapsed, baseline, live, ctx]
  );

  /** The same slice naming Insights uses — a trimmed baseline says so. */
  const baselineLabel = useMemo(() => {
    if (!live) return baseline.label;
    const slice = matchingSlice(baseline, elapsed);
    return `${formatDate(slice.start, 'short')} – ${formatDate(slice.end, 'short')}`;
  }, [live, baseline, elapsed]);

  const categoryRows = useMemo(
    () => withOtherBucket(categoryTotals(range, ctx, 'expense'), 8, currency),
    [range, ctx, currency]
  );

  const ringSlices: RingSlice[] = useMemo(
    () =>
      categoryRows.map((row) => ({
        key: row.categoryId,
        value: Math.abs(row.total.minor),
        color: row.color,
      })),
    [categoryRows]
  );
  const ringTotal = ringSlices.reduce((sum, s) => sum + s.value, 0);

  /**
   * The bucketed series behind the bars.
   *
   * `cashflowSeries` already buckets by any `BudgetPeriod`, so the grain toggle
   * is a parameter rather than three code paths. The window widens with the
   * grain — twelve months of monthly bars is a year, twelve quarters is three,
   * and nobody is asking to compare sixty individual months.
   */
  const series = useMemo(() => {
    const period: BudgetPeriod = grain === 'annually' ? 'annually' : grain;
    const from = addMonths(monthOf(asOf).start, -GRAIN_MONTHS[grain]);
    return cashflowSeries(from, asOf, period, ctx).filter(
      (p) => p.inflow.minor !== 0 || p.outflow.minor !== 0
    );
  }, [grain, ctx, asOf]);

  /** The trend chart wants spend per bucket, and a forecast fitted to it. */
  const trend = useMemo(
    () => series.map((p) => ({ date: p.date, value: money(p.outflow.minor, currency) })),
    [series, currency]
  );
  const forecast = useMemo(() => {
    if (grain !== 'monthly' || trend.length < 4) return undefined;
    try {
      return forecastSeries(
        trend.map((p) => ({ date: p.date, value: p.value.minor })),
        { horizon: 3, currency }
      );
    } catch {
      return undefined;
    }
  }, [trend, grain, currency]);

  const spent = totalSpend(range, ctx);
  const earned = totalIncome(range, ctx);
  const net = money(earned.minor - spent.minor, currency);
  const merchants = topMerchants(range, ctx, 8);

  /**
   * The chart's own width.
   *
   * On a desktop the trend sits in the wide half of a split, so it cannot use
   * the page width or it draws off the end of its own card.
   */
  const chartWidth = Math.min(
    layout.maxWidth - layout.gutter * 2,
    layout.isDesktop ? (layout.maxWidth - layout.gutter * 2) * 0.62 - sp.lg : width - layout.gutter * 2
  ) - sp.lg * 2;

  const empty = transactions.filter((x) => !x.deletedAt).length === 0;

  return (
    <Screen>
      <AppHeader title="Analysis" />

      {/* Insights and Analysis are one tap apart, not two. */}
      <View style={{ marginTop: sp.md }}>
        <SegmentedControl<'insights' | 'analysis'>
          value="analysis"
          onChange={(next) => {
            if (next === 'insights') router.replace('/insights');
          }}
          options={[
            { value: 'insights', label: 'Insights' },
            { value: 'analysis', label: 'Analysis' },
          ]}
        />
      </View>

      {empty ? (
        <Card style={{ marginTop: sp.xl }}>
          <View style={{ alignItems: 'center', paddingVertical: sp.lg }}>
            <Spot name="chart" size={112} tone="violet" />
            <Text style={[t.heading, { color: c.textPrimary, marginTop: sp.md }]}>
              Nothing to analyse yet
            </Text>
            <Text
              style={[
                t.caption,
                { color: c.textMuted, marginTop: sp.xs, textAlign: 'center', maxWidth: 320 },
              ]}
            >
              Import a statement or add a few transactions and this fills in.
            </Text>
          </View>
        </Card>
      ) : (
        <>
          <View style={{ marginTop: sp.md, marginBottom: sp.md }}>
            <PeriodBar range={range} onChange={setRange} today={asOf} />
          </View>

          {/* Three figures for the period, before any chart. */}
          <StatRow>
            <StatTile
              index={0}
              label="Spent"
              value={formatMoney(spent, { compactDecimals: true })}
              caption={live ? 'so far' : range.label}
            />
            <StatTile
              index={1}
              label="Earned"
              value={formatMoney(earned, { compactDecimals: true })}
              caption={`${comparison.categories.length} categories moved`}
            />
            <StatTile
              index={2}
              label="Net"
              value={formatMoney(net, { compactDecimals: true })}
              tone={net.minor < 0 ? 'pink' : 'green'}
              caption={net.minor < 0 ? 'Spent more than earned' : 'Finished ahead'}
            />
          </StatRow>

          {/* Where it goes: ring and legend beside each other, bars beneath. */}
          <SectionHeader title="Where it goes" />
          <Split ratio={0.5} stackOnTablet>
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ring
                  size={150}
                  slices={ringSlices}
                  centerLabel="Spent"
                  centerValue={formatMoney(spent, { compactDecimals: true })}
                  centerCaption={live ? 'so far' : range.label}
                  emptyLabel="Nothing spent in this period"
                />
                <View style={{ flex: 1, marginLeft: sp.lg }}>
                  <RingLegend
                    slices={ringSlices.map((slice, i) => ({
                      ...slice,
                      label: categoryRows[i]?.categoryName ?? 'Other',
                    }))}
                    total={ringTotal}
                    format={(value) =>
                      formatMoney(money(value, currency), { compactDecimals: true })
                    }
                    max={5}
                  />
                </View>
              </View>
            </Card>

            <Card>
              <CategoryBreakdown
                rows={categoryRows}
                grid
                onSelect={(_, row) => openCategory(row, range)}
              />
            </Card>
          </Split>

          {/* The grain toggle governs the bars, and nothing above them. */}
          <SectionHeader title="Over time" />
          <View style={{ marginBottom: sp.md }}>
            <SegmentedControl<Grain>
              value={grain}
              onChange={setGrain}
              options={[
                { value: 'monthly', label: 'Monthly' },
                { value: 'quarterly', label: 'Quarterly' },
                { value: 'annually', label: 'Yearly' },
              ]}
            />
          </View>

          <Split ratio={0.62}>
            <Card>
              {trend.length > 1 ? (
                <SpendTrendChart
                  actual={trend}
                  forecast={forecast}
                  width={Math.max(240, chartWidth)}
                  title={`Spend by ${grain === 'annually' ? 'year' : grain === 'quarterly' ? 'quarter' : 'month'}`}
                />
              ) : (
                <Text style={[t.caption, { color: c.textMuted, paddingVertical: sp.xl }]}>
                  Not enough history at this grain yet. Try monthly.
                </Text>
              )}
            </Card>

            <Card>
              <Text style={[t.micro, { color: c.textMuted }]}>
                {live ? 'SO FAR THIS MONTH' : range.label.toUpperCase()}
              </Text>
              <AmountText value={comparison.current} size="title" />
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  marginTop: sp.sm,
                }}
              >
                <Text style={[t.micro, { color: c.textMuted }]}>{baselineLabel.toUpperCase()}</Text>
                <AmountText value={comparison.previous} size="body" color={c.textSecondary} />
              </View>

              {comparison.change != null ? (
                <Text
                  style={[
                    t.caption,
                    {
                      marginTop: sp.md,
                      color: comparison.change > 0.1 ? c.warning : c.good,
                    },
                  ]}
                >
                  {comparison.change > 0 ? 'Up' : 'Down'}{' '}
                  {Math.abs(Math.round(comparison.change * 100))}%
                  {live ? ' at the same point' : ''} versus last month
                </Text>
              ) : null}

              {/* What actually moved, biggest change first regardless of sign. */}
              <View style={{ marginTop: sp.md }}>
                {comparison.categories.slice(0, 5).map((d) => (
                  <View
                    key={d.categoryId}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: sp.xs,
                    }}
                  >
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: d.color,
                        marginRight: sp.sm,
                      }}
                    />
                    <Text style={[t.micro, { color: c.textSecondary, flex: 1 }]} numberOfLines={1}>
                      {d.categoryName}
                    </Text>
                    <Text
                      style={[
                        t.micro,
                        {
                          color: d.deltaMinor > 0 ? c.warning : c.good,
                          fontVariant: ['tabular-nums'],
                        },
                      ]}
                    >
                      {d.deltaMinor > 0 ? '+' : '−'}
                      {formatMoney(money(Math.abs(d.deltaMinor), currency), {
                        compactDecimals: true,
                      })}
                    </Text>
                  </View>
                ))}
              </View>
            </Card>
          </Split>

          {/* Merchants as a podium. A ranked row of cards says "where does it
              actually go" faster than eight identical lines with numbers. */}
          <ScrollRow title="Top merchants" gutter={layout.gutter}>
            {merchants.map((m, i) => {
              const tones = ['violet', 'pink', 'amber', 'blue', 'teal', 'green'] as const;
              const tone = c.tile[tones[i % tones.length]];
              return (
                <View
                  key={m.merchant}
                  style={{
                    width: 156,
                    borderRadius: 16,
                    backgroundColor: tone.bg,
                    borderWidth: 0.5,
                    borderColor: tone.border,
                    padding: sp.md,
                  }}
                >
                  <View
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      backgroundColor: tone.tag,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={[t.micro, { color: '#ffffff' }]}>{i + 1}</Text>
                  </View>
                  <Text
                    style={[t.bodyStrong, { color: c.textPrimary, marginTop: sp.sm }]}
                    numberOfLines={2}
                  >
                    {m.merchant}
                  </Text>
                  <AmountText value={m.total} size="body" color={tone.fg} />
                  <Text style={[t.micro, { color: c.textMuted, marginTop: 2 }]}>
                    {m.count} visit{m.count === 1 ? '' : 's'}
                  </Text>
                </View>
              );
            })}
          </ScrollRow>
        </>
      )}
    </Screen>
  );
}

/**
 * Open the transactions behind a bar.
 *
 * The chart's "Other" row is synthetic, so it hands over the real categories it
 * rolled up. The period travels too — the list has to show the same
 * transactions the figure was counting, not every one ever filed there.
 */
function openCategory(row: CategoryTotal, range: PeriodRange) {
  const ids = row.memberIds?.length ? row.memberIds : [row.categoryId];
  router.navigate({
    pathname: '/transactions',
    params: {
      category: ids.join(','),
      from: range.start,
      to: range.end,
      label: `${row.categoryName} · ${range.label}`,
    },
  });
}
