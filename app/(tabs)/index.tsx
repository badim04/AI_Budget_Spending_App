/**
 * Dashboard.
 *
 * Ordered by what a person actually opens the app to find out, which is almost
 * never "what is my net worth":
 *
 *   1. Can I spend? (safe-to-spend, the hero number)
 *   2. Am I on track? (budgets, with pace)
 *   3. What is coming? (forecast + upcoming bills)
 *   4. Where did it go? (category breakdown)
 *   5. Anything I should know? (insights)
 *
 * Net worth and account balances live one screen away. Leading with them makes
 * the app a statement rather than a tool.
 */

import React, { useMemo, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  useWindowDimensions,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useLayout } from '../../src/theme/layout';
import { AmountText, BudgetBar, Card, Pill, SectionHeader } from '../../src/components/ui/Primitives';
import { SpendTrendChart } from '../../src/components/charts/SpendTrendChart';
import { CategoryBreakdown } from '../../src/components/charts/CategoryBreakdown';
import type { CategoryTotal, PeriodRange } from '../../src/core/types';
import { budgetStateColor } from '../../src/theme/tokens';
import { formatMoney, money } from '../../src/core/money';
import { periodProgress, formatDate, daysRemaining, today } from '../../src/core/dates';
import {
  elapsedRange,
  isCurrentMonth,
  matchingSlice,
  monthOf,
  previousMonth,
} from '../../src/core/periods';
import { PeriodBar } from '../../src/components/ui/PeriodBar';
import { FeatureCard, FeaturePill } from '../../src/components/ui/FeatureCard';
import { Mascot } from '../../src/components/art/Mascot';
import {
  Banner,
  HeroCarousel,
  MiniCard,
  ScrollRow,
  Tile,
  TileGrid,
} from '../../src/components/ui/Tiles';
import { useDashboardData } from '../../src/hooks/useDashboardData';
import { useAppStore } from '../../src/store/useAppStore';
import { comparePeriods, totalIncome, type AnalyticsContext } from '../../src/core/analytics';
import { greeting, spendSummary, topNudges } from '../../src/core/voice';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Button } from '../../src/components/ui/Primitives';
import { AppHeader } from '../../src/components/ui/AppHeader';

export default function DashboardScreen() {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  /**
   * The month on screen. Everything below reads from it, so paging back shows
   * that month's budgets, forecast and breakdown rather than today's.
   */
  const [range, setRange] = useState<PeriodRange>(() => monthOf(today()));
  const live = isCurrentMonth(range);

  // A finished month is "as of" its last day: days-left is zero and the period
  // is 100% elapsed, which is the truth for a month that is over.
  const { data, loading, refresh } = useDashboardData(live ? undefined : range.end);

  const transactions = useAppStore((s) => s.transactions);
  const categories = useAppStore((s) => s.categories);
  const accounts = useAppStore((s) => s.accounts);
  const settings = useAppStore((s) => s.settings);
  const fxTable = useAppStore((s) => s.fxTable);

  // Web stretches to the browser width; a money column past ~560pt just gets
  // harder to scan, so the content is centred and capped.
  // Measured from the container, not the window: the window width ignores the
  // side rail, which pushed the left edge of the screen underneath it.
  const [measuredWidth, setMeasuredWidth] = React.useState(0);
  const contentWidth = Math.min(measuredWidth || width, 560);
  const gutter = sp.lg;
  const chartWidth = contentWidth - gutter * 2 - sp.lg * 2;


  const progress = periodProgress(range, data.asOf);
  const daysLeft = daysRemaining(range, data.asOf);
  /** Everything budget-derived is meaningless until at least one exists. */
  const budgeted = data.allocated.minor > 0;

  const analytics = useMemo<AnalyticsContext>(
    () => ({
      transactions,
      categories,
      accounts,
      displayCurrency: data.displayCurrency,
      fx: fxTable(),
      asOf: data.asOf,
    }),
    [transactions, categories, accounts, data.displayCurrency, data.asOf, fxTable]
  );

  /**
   * "₦42,300 less than last month" — the only thing that makes a spend total
   * mean anything. Compared like for like: an unfinished month is measured
   * against the same days of the one before.
   */
  /** The single most interesting category move, in the app's own words. */
  const headline = useMemo(() => {
    const elapsed = live ? elapsedRange(range, data.asOf) : range;
    const baseline = live ? matchingSlice(previousMonth(range), elapsed) : previousMonth(range);
    const { categories: moved } = comparePeriods(elapsed, baseline, analytics);
    return topNudges(
      moved.map((d) => ({
        categoryName: d.categoryName,
        icon: d.icon,
        currentMinor: d.current.minor,
        previousMinor: d.previous.minor,
      })),
      data.displayCurrency,
      1
    )[0];
  }, [range, live, data.asOf, data.displayCurrency, analytics]);

  /** Money in for the period on screen, on the same basis as the spend total. */
  const income = useMemo(
    () => totalIncome(range, analytics),
    [range, analytics]
  );

  /** How many rows are still waiting on a decision. */
  const unreviewed = useMemo(
    () => transactions.filter((tx) => !tx.reviewed && !tx.deletedAt).length,
    [transactions]
  );

  const verdict = useMemo(() => {
    const elapsed = live ? elapsedRange(range, data.asOf) : range;
    const baseline = live ? matchingSlice(previousMonth(range), elapsed) : previousMonth(range);
    const comparison = comparePeriods(elapsed, baseline, analytics);
    return spendSummary(
      comparison.current.minor,
      comparison.previous.minor,
      data.displayCurrency,
      { partial: live }
    );
  }, [range, live, data.asOf, data.displayCurrency, analytics]);

  // An empty dashboard is mostly zeros and empty charts, which reads as broken
  // rather than as new. Say what to do instead.
  if (!data.hasData) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: c.canvas,
          paddingHorizontal: sp.xl,
          paddingTop: insets.top + sp.lg,
        }}
      >
        <AppHeader />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Mascot pose="wave" size={132} />
        <Text style={[t.title, { color: c.textPrimary, marginTop: sp.md, textAlign: 'center' }]}>
          Hi, I’m Fin 👋
        </Text>
        <Text
          style={[
            t.body,
            { color: c.textSecondary, marginTop: sp.sm, textAlign: 'center', maxWidth: 320 },
          ]}
        >
          Add a transaction, snap a receipt, or import a statement, and I’ll keep track of
          where your money goes. Load the demo data if you’d rather look around first.
        </Text>
        <View style={{ marginTop: sp.xl, width: 240 }}>
          <Button label="Add a transaction" onPress={() => router.push('/transaction/new')} />
          <View style={{ height: sp.sm }} />
          <Button
            label="Load demo data"
            variant="secondary"
            onPress={() => router.push('/settings')}
          />
        </View>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.canvas }}
      // onLayout gives the width actually available after the nav takes its
      // share; the chart needs a real number, so it waits for this.
      onLayout={(e) => setMeasuredWidth(e.nativeEvent.layout.width)}
      contentContainerStyle={{
        paddingTop: insets.top + sp.lg,
        paddingBottom: insets.bottom + sp.huge,
        paddingHorizontal: gutter,
        alignSelf: 'center',
        width: '100%',
        maxWidth: layout.maxWidth,
      }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={c.textMuted} />}
    >
      <AppHeader />

      {/* A person, not a report. The screen opens by saying hello and telling
          you whether the number below is good news, before you have to work
          that out from a chart. */}
      <View style={{ marginBottom: sp.md }}>
        <Text style={[t.title, { color: c.textPrimary }]}>
          {greeting(new Date(), settings.user_name)}
        </Text>
        <Text style={[t.body, { color: c.textSecondary, marginTop: 2 }]}>
          Let’s see how your money is doing.
        </Text>
      </View>

      {/* ---------------------------------------------------- 1. Can I spend? */}
      <PeriodBar
        range={range}
        onChange={setRange}
        subtitle={live ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : range.label}
      />

      {/* The headline, as a deck you swipe rather than one static block. */}
      <View style={{ marginTop: sp.md, marginBottom: sp.lg }}>
        <HeroCarousel>
          {budgeted ? (
            <FeatureCard
              tone={data.shortfallDate ? 'spend' : 'primary'}
              label={live ? 'Safe to spend' : `Was safe to spend in ${range.label}`}
              footer={
                <View style={{ flexDirection: 'row', gap: sp.sm }}>
                  <FeaturePill
                    label={`${formatMoney(data.safeToSpendPerDay, { compactDecimals: true })} / day`}
                    tone={data.shortfallDate ? 'spend' : 'primary'}
                  />
                  <FeaturePill
                    label={
                      data.shortfallDate
                        ? `Tight from ${formatDate(data.shortfallDate, 'short')}`
                        : 'Covers the period'
                    }
                    tone={data.shortfallDate ? 'spend' : 'primary'}
                  />
                </View>
              }
            >
              <AmountText
                value={data.safeToSpend}
                size="hero"
                animate
                color={c.feature[data.shortfallDate ? 'spend' : 'primary'].fg}
              />
              <Text
                style={[
                  t.caption,
                  { color: c.feature[data.shortfallDate ? 'spend' : 'primary'].muted, marginTop: sp.xs },
                ]}
              >
                {verdict.icon} {verdict.headline}
              </Text>
            </FeatureCard>
          ) : null}

          {/* Safe-to-spend comes entirely from budget envelopes, so without one
              it is not a small number — it is not a number. Spend always is. */}
          <FeatureCard
            tone="savings"
            label={live ? 'Spent this month' : `Spent in ${range.label}`}
            footer={
              budgeted ? (
                <FeaturePill label={`${data.categories.length} categories`} tone="savings" />
              ) : (
                <Pressable onPress={() => router.push('/budgets')} accessibilityRole="button">
                  <FeaturePill label="Set a budget to see safe-to-spend  ›" tone="savings" />
                </Pressable>
              )
            }
          >
            <AmountText value={data.spent} size="hero" animate color={c.feature.savings.fg} />
            <Text style={[t.caption, { color: c.feature.savings.muted, marginTop: sp.xs }]}>
              {verdict.icon} {verdict.headline}
            </Text>
          </FeatureCard>

          <FeatureCard
            tone="calm"
            label="Money in"
            footer={<FeaturePill label={`${daysLeft} days left in ${range.label}`} tone="calm" />}
          >
            <AmountText value={income} size="hero" animate color={c.feature.calm.fg} />
            <Text style={[t.caption, { color: c.feature.calm.muted, marginTop: sp.xs }]}>
              {income.minor > data.spent.minor
                ? '💚 More came in than went out'
                : '👀 You spent more than came in'}
            </Text>
          </FeatureCard>
        </HeroCarousel>
      </View>

      {/* What people actually came here to do, in a row that runs off-screen so
          it is obvious there is more of it. */}
      <ScrollRow gutter={gutter}>
        <MiniCard
          tone="violet"
          glyph="✏️"
          title="Add"
          subtitle="a transaction"
          index={0}
          onPress={() => router.push('/transaction/new')}
        />
        <MiniCard
          tone="blue"
          glyph="📄"
          title="Import"
          subtitle="a statement"
          index={1}
          onPress={() => router.push('/import')}
        />
        <MiniCard
          tone="teal"
          glyph="📸"
          title="Snap"
          subtitle="a receipt"
          index={2}
          onPress={() => router.push('/capture')}
        />
        <MiniCard
          tone="amber"
          glyph="🎯"
          title="Goals"
          subtitle="track one"
          index={3}
          onPress={() => router.push('/goals')}
        />
        <MiniCard
          tone="pink"
          glyph="📊"
          title="Report"
          subtitle="export it"
          index={4}
          onPress={() => router.push('/reports')}
        />
      </ScrollRow>

      {/* One thing worth knowing, in the app's own voice. Absent when there is
          nothing worth saying — see `core/voice.ts`. */}
      {headline ? (
        <Banner
          tone={headline.tone === 'good' ? 'green' : headline.tone === 'watch' ? 'amber' : 'blue'}
          glyph={headline.icon}
          title={headline.headline}
          body={headline.body}
          style={{ marginTop: sp.xl }}
          onPress={() => router.push('/insights')}
        />
      ) : null}

      {/* Four destinations, four colours. You learn the colours and stop
          reading the labels — which is the entire point of a tile grid. */}
      <SectionHeader title="Your money" />
      <TileGrid>
        <Tile
          tone="violet"
          tag={budgeted ? 'Review' : 'Set up'}
          title="Budgets"
          subtitle={budgeted ? `${data.budgets.length} envelopes` : 'Not set up yet'}
          glyph="💜"
          index={0}
          onPress={() => router.push('/budgets')}
        />
        <Tile
          tone="green"
          tag="Track"
          title="Goals"
          subtitle="Save toward something"
          glyph="🎯"
          index={1}
          onPress={() => router.push('/goals')}
        />
        <Tile
          tone="blue"
          tag="Explore"
          title="Insights"
          subtitle="Month against month"
          glyph="📈"
          index={2}
          onPress={() => router.push('/insights')}
        />
        <Tile
          tone="pink"
          tag={unreviewed > 0 ? `${unreviewed} left` : 'All done'}
          title="Review"
          subtitle={unreviewed > 0 ? 'Uncategorised transactions' : 'Nothing waiting'}
          glyph="🗂️"
          index={3}
          onPress={() => router.push('/transactions')}
        />
      </TileGrid>

      {/* ------------------------------------------------- 2. Am I on track? */}
      {/* Without a budget this card is the hero figure printed twice under a
          pace bar with nothing to pace against, so it does not appear. */}
      {budgeted ? (
      <Card padded={false}>
        <View style={{ padding: sp.lg }}>
          <View style={styles.spread}>
            <Text style={[t.caption, { color: c.textSecondary }]}>Spent against budgets</Text>
            <Text style={[t.micro, { color: c.textMuted }]}>
              {Math.round(progress * 100)}% of the period gone
            </Text>
          </View>

          <View style={[styles.spread, { marginTop: sp.xs, alignItems: 'flex-end' }]}>
            <AmountText value={data.budgetedSpend} size="display" />
            <Text style={[t.caption, { color: c.textMuted }]}>
              of {formatMoney(data.allocated, { compactDecimals: true })}
            </Text>
          </View>

          <View style={{ marginTop: sp.lg }}>
            <BudgetBar
              utilisation={data.utilisation}
              pace={progress}
              color={
                (data.utilisation ?? 0) > 1
                  ? c.critical
                  : (data.utilisation ?? 0) > progress + 0.1
                    ? c.warning
                    : c.good
              }
              height={10}
            />
            <Text style={[t.micro, { color: c.textMuted, marginTop: sp.sm }]}>
              The marker shows where you'd be if spending were even across the month.
            </Text>
          </View>
        </View>

        {/* Per-envelope rows, urgent first. */}
        <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }}>
          {data.budgets.slice(0, 4).map((s) => (
            <View
              key={s.budget.id}
              style={{
                paddingHorizontal: sp.lg,
                paddingVertical: sp.md,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: c.border,
              }}
            >
              <View style={styles.spread}>
                <Text style={[t.body, { color: c.textPrimary }]}>{s.budget.name}</Text>
                <Text style={[t.caption, { color: budgetStateColor(c, s.state) }]}>
                  {s.remaining.minor < 0
                    ? `${formatMoney(s.remaining, { compactDecimals: true })} over`
                    : `${formatMoney(s.remaining, { compactDecimals: true })} left`}
                </Text>
              </View>
              <View style={{ marginTop: sp.sm }}>
                <BudgetBar
                  utilisation={s.utilisation}
                  pace={s.periodProgress}
                  color={budgetStateColor(c, s.state)}
                  height={6}
                />
              </View>
            </View>
          ))}
        </View>
      </Card>
      ) : null}

      {/* ------------------------------------------------ 3. What is coming? */}
      <SectionHeader title="Trend & forecast" action="Details" />
      <Card>
        <SpendTrendChart
          actual={data.trend}
          forecast={data.forecast}
          width={chartWidth}
          target={data.allocated}
        />
      </Card>

      {data.upcoming.length > 0 ? (
        <>
          {/* A sideways row of bill cards, not a divided list. Bills are a
              handful of separate things arriving on separate days — a stack of
              hairline rows makes them look like one ledger. */}
          <ScrollRow title="Coming up" action="All bills" onAction={() => router.push('/budgets')} gutter={gutter}>
            {data.upcoming.map((bill, i) => {
              const tones = ['blue', 'amber', 'teal', 'pink', 'violet', 'green'] as const;
              const tone = tones[i % tones.length];
              return (
                <View
                  key={bill.id}
                  style={{
                    width: 150,
                    borderRadius: r.lg,
                    backgroundColor: c.tile[tone].bg,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: c.tile[tone].border,
                    padding: sp.md,
                  }}
                >
                  <View
                    style={{
                      alignSelf: 'flex-start',
                      backgroundColor: c.tile[tone].tag,
                      borderRadius: r.pill,
                      paddingHorizontal: sp.sm,
                      paddingVertical: 2,
                    }}
                  >
                    <Text style={[t.micro, { color: '#ffffff' }]}>
                      {formatDate(bill.date, 'short').toUpperCase()}
                    </Text>
                  </View>

                  <Text style={[t.bodyStrong, { color: c.textPrimary, marginTop: sp.sm }]} numberOfLines={1}>
                    {bill.name}
                  </Text>
                  <AmountText value={bill.amount} size="body" color={c.tile[tone].fg} />
                  {bill.variable ? (
                    <Text style={[t.micro, { color: c.textMuted, marginTop: 2 }]}>amount varies</Text>
                  ) : null}
                </View>
              );
            })}
          </ScrollRow>
        </>
      ) : null}

      {/* --------------------------------------------- 4. Where did it go? */}
      <SectionHeader title="Where it went" action="Breakdown" />
      <Card>
        <CategoryBreakdown
          rows={data.categories}
          grid
          onSelect={(_, row) => openCategory(row, range)}
        />
      </Card>

      {/* --------------------------------- 5. Anything I should know about? */}
      {data.insights.length > 0 ? (
        <>
          <SectionHeader title="Worth knowing" />
          {/* Banners rather than bordered cards with a colour strip: the strip
              was the only thing carrying the severity, and it was three pixels
              wide. A tinted panel with a glyph says it before the words do. */}
          {data.insights.slice(0, 3).map((insight, i) => (
            <Banner
              key={insight.id}
              tone={
                insight.severity === 'critical'
                  ? 'pink'
                  : insight.severity === 'warning'
                    ? 'amber'
                    : insight.severity === 'positive'
                      ? 'green'
                      : 'blue'
              }
              glyph={
                insight.severity === 'critical'
                  ? '🚨'
                  : insight.severity === 'warning'
                    ? '👀'
                    : insight.severity === 'positive'
                      ? '💚'
                      : '💡'
              }
              title={insight.title}
              body={insight.body}
              style={{ marginBottom: sp.md }}
            />
          ))}
        </>
      ) : null}

      {data.staleCurrencies.length > 0 ? (
        <Card style={{ marginTop: sp.lg }}>
          <Text style={[t.caption, { color: c.warning }]}>
            No exchange rate for {data.staleCurrencies.join(', ')} — those transactions are
            excluded from the totals above.
          </Text>
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});

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
