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

import React, { useMemo } from 'react';
import { ScrollView, View, Text, useWindowDimensions, RefreshControl, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme/ThemeProvider';
import { AmountText, BudgetBar, Card, Pill, SectionHeader } from '../../src/components/ui/Primitives';
import { SpendTrendChart } from '../../src/components/charts/SpendTrendChart';
import { CategoryBreakdown } from '../../src/components/charts/CategoryBreakdown';
import { budgetStateColor } from '../../src/theme/tokens';
import { formatMoney, money } from '../../src/core/money';
import { periodRange, periodProgress, formatDate, daysRemaining } from '../../src/core/dates';
import { useDashboardData } from '../../src/hooks/useDashboardData';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Button } from '../../src/components/ui/Primitives';
import { AppHeader } from '../../src/components/ui/AppHeader';

export default function DashboardScreen() {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { data, loading, refresh } = useDashboardData();

  // Web stretches to the browser width; a money column past ~560pt just gets
  // harder to scan, so the content is centred and capped.
  // Measured from the container, not the window: the window width ignores the
  // side rail, which pushed the left edge of the screen underneath it.
  const [measuredWidth, setMeasuredWidth] = React.useState(0);
  const contentWidth = Math.min(measuredWidth || width, 560);
  const gutter = sp.lg;
  const chartWidth = contentWidth - gutter * 2 - sp.lg * 2;

  const range = useMemo(() => periodRange(data.asOf, 'monthly'), [data.asOf]);
  const progress = periodProgress(range, data.asOf);
  const daysLeft = daysRemaining(range, data.asOf);

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
        <Ionicons name="pie-chart-outline" size={40} color={c.textMuted} />
        <Text style={[t.title, { color: c.textPrimary, marginTop: sp.lg, textAlign: 'center' }]}>
          Nothing to show yet
        </Text>
        <Text
          style={[
            t.body,
            { color: c.textSecondary, marginTop: sp.sm, textAlign: 'center', maxWidth: 320 },
          ]}
        >
          Add a transaction, snap a receipt, or load the demo data to see what the dashboard
          looks like with a few months of history behind it.
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
        maxWidth: 560,
      }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={c.textMuted} />}
    >
      <AppHeader />

      {/* ---------------------------------------------------- 1. Can I spend? */}
      <Text style={[t.caption, { color: c.textMuted }]}>
        {range.label} · {daysLeft} day{daysLeft === 1 ? '' : 's'} left
      </Text>

      <View style={{ marginTop: sp.sm, marginBottom: sp.lg }}>
        <Text style={[t.caption, { color: c.textSecondary, marginBottom: sp.xs }]}>
          Safe to spend
        </Text>
        <AmountText value={data.safeToSpend} size="hero" />
        <View style={{ flexDirection: 'row', marginTop: sp.sm, gap: sp.sm }}>
          <Pill
            label={`${formatMoney(data.safeToSpendPerDay, { compactDecimals: true })} / day`}
            tone="accent"
          />
          {data.shortfallDate ? (
            <Pill label={`Tight from ${formatDate(data.shortfallDate, 'short')}`} tone="warning" icon="!" />
          ) : (
            <Pill label="Covers the period" tone="good" icon="✓" />
          )}
        </View>
      </View>

      {/* ------------------------------------------------- 2. Am I on track? */}
      <Card padded={false}>
        <View style={{ padding: sp.lg }}>
          <View style={styles.spread}>
            <Text style={[t.caption, { color: c.textSecondary }]}>Spent this month</Text>
            <Text style={[t.micro, { color: c.textMuted }]}>
              {Math.round(progress * 100)}% of the period gone
            </Text>
          </View>

          <View style={[styles.spread, { marginTop: sp.xs, alignItems: 'flex-end' }]}>
            <AmountText value={data.spent} size="display" />
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
          <SectionHeader title="Coming up" action="All bills" />
          <Card padded={false}>
            {data.upcoming.map((bill, i) => (
              <View
                key={bill.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: sp.lg,
                  borderBottomWidth: i === data.upcoming.length - 1 ? 0 : StyleSheet.hairlineWidth,
                  borderBottomColor: c.border,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[t.body, { color: c.textPrimary }]}>{bill.name}</Text>
                  <Text style={[t.micro, { color: c.textMuted, marginTop: 2 }]}>
                    {formatDate(bill.date, 'short')}
                    {bill.variable ? ' · amount varies' : ''}
                  </Text>
                </View>
                <AmountText value={bill.amount} size="body" color={c.textSecondary} />
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {/* --------------------------------------------- 4. Where did it go? */}
      <SectionHeader title="Where it went" action="Breakdown" />
      <Card>
        <CategoryBreakdown rows={data.categories} />
      </Card>

      {/* --------------------------------- 5. Anything I should know about? */}
      {data.insights.length > 0 ? (
        <>
          <SectionHeader title="Worth knowing" />
          {data.insights.slice(0, 3).map((insight) => (
            <Card key={insight.id} style={{ marginBottom: sp.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                <View
                  style={{
                    width: 3,
                    alignSelf: 'stretch',
                    borderRadius: 2,
                    marginRight: sp.md,
                    backgroundColor:
                      insight.severity === 'critical'
                        ? c.critical
                        : insight.severity === 'warning'
                          ? c.warning
                          : insight.severity === 'positive'
                            ? c.good
                            : c.info,
                  }}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[t.bodyStrong, { color: c.textPrimary }]}>{insight.title}</Text>
                  <Text style={[t.body, { color: c.textSecondary, marginTop: sp.xs }]}>
                    {insight.body}
                  </Text>
                </View>
              </View>
            </Card>
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
