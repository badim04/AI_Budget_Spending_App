import React, { useMemo } from 'react';
import { ScrollView, View, Text, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme/ThemeProvider';
import { AmountText, Card, SectionHeader } from '../../src/components/ui/Primitives';
import { CategoryBreakdown } from '../../src/components/charts/CategoryBreakdown';
import { formatMoney } from '../../src/core/money';
import {
  categoryTotals,
  netWorth,
  runwayMonths,
  savingsRate,
  topMerchants,
  withOtherBucket,
  yearOverYear,
  type AnalyticsContext,
} from '../../src/core/analytics';
import { periodRange, today } from '../../src/core/dates';
import { useAppStore } from '../../src/store/useAppStore';

/**
 * Insights.
 *
 * Every tile here is a comparison, not a total: this period against the last,
 * against last year, or against how long the money would last. A number with
 * nothing to measure it against belongs on the dashboard, not here.
 */
export default function InsightsScreen() {
  const { c, type: t, space: sp } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const transactions = useAppStore((s) => s.transactions);
  const categories = useAppStore((s) => s.categories);
  const accounts = useAppStore((s) => s.accounts);
  const settings = useAppStore((s) => s.settings);
  const fxTable = useAppStore((s) => s.fxTable);
  const asOf = today();

  const ctx = useMemo<AnalyticsContext>(
    () => ({
      transactions,
      categories,
      accounts,
      displayCurrency: settings.display_currency ?? 'NGN',
      fx: fxTable(),
      asOf,
    }),
    [transactions, categories, accounts, settings, fxTable, asOf]
  );

  const range = periodRange(asOf, 'monthly');
  const yoy = yearOverYear(range, ctx);
  const rate = savingsRate(range, ctx);
  const runway = runwayMonths(ctx);
  const worth = netWorth(ctx, asOf);
  const merchants = topMerchants(range, ctx, 6);
  const categoryRows = withOtherBucket(
    categoryTotals(range, ctx, 'expense'),
    7,
    settings.display_currency ?? 'NGN'
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.canvas }}
      contentContainerStyle={{
        paddingTop: insets.top + sp.lg,
        paddingBottom: insets.bottom + 80,
        paddingHorizontal: sp.lg,
        alignSelf: 'center',
        // '100%' + maxWidth respects the parent; Math.min(window, 560) did not,
        // so on a phone the content overflowed under the nav rail.
        width: '100%',
        maxWidth: 560,
      }}
    >
      <Text style={[t.title, { color: c.textPrimary }]}>Insights</Text>

      <View style={{ flexDirection: 'row', marginTop: sp.lg }}>
        <Stat
          label="Savings rate"
          value={rate == null ? '—' : Math.round(rate * 100) + '%'}
          hint={rate == null ? 'No income recorded' : rate > 0.2 ? 'Above the 20% mark' : 'Below the 20% mark'}
          tone={rate == null ? 'muted' : rate > 0.2 ? 'good' : rate < 0 ? 'critical' : 'warning'}
        />
        <View style={{ width: sp.md }} />
        <Stat
          label="Runway"
          value={runway == null ? '—' : runway.toFixed(1) + ' mo'}
          hint="Liquid balance at your median monthly spend"
          tone="muted"
        />
      </View>

      <SectionHeader title="Net worth" />
      <Card>
        <AmountText value={worth.net} size="display" />
        <View style={{ flexDirection: 'row', marginTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={[t.micro, { color: c.textMuted }]}>ASSETS</Text>
            <AmountText value={worth.assets} size="body" color={c.good} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[t.micro, { color: c.textMuted }]}>LIABILITIES</Text>
            <AmountText value={worth.liabilities} size="body" color={c.textSecondary} />
          </View>
        </View>
      </Card>

      <SectionHeader title="This month vs last year" />
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <View>
            <Text style={[t.micro, { color: c.textMuted }]}>{range.label.toUpperCase()}</Text>
            <AmountText value={yoy.current} size="title" />
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[t.micro, { color: c.textMuted }]}>SAME MONTH LAST YEAR</Text>
            <AmountText value={yoy.priorYear} size="body" color={c.textSecondary} />
          </View>
        </View>
        {yoy.change != null ? (
          <Text
            style={[
              t.caption,
              { marginTop: sp.md, color: yoy.change > 0.1 ? c.warning : c.good },
            ]}
          >
            {yoy.change > 0 ? 'Up' : 'Down'} {Math.abs(Math.round(yoy.change * 100))}% year on year
          </Text>
        ) : (
          <Text style={[t.caption, { color: c.textMuted, marginTop: sp.md }]}>
            No data from a year ago to compare against yet.
          </Text>
        )}
      </Card>

      <SectionHeader title="Where it goes" />
      <Card>
        <CategoryBreakdown rows={categoryRows} />
      </Card>

      <SectionHeader title="Top merchants" />
      <Card padded={false}>
        {merchants.map((m, i) => (
          <View
            key={m.merchant}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingHorizontal: sp.lg,
              paddingVertical: sp.md,
              borderBottomWidth: i === merchants.length - 1 ? 0 : 0.5,
              borderBottomColor: c.border,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[t.body, { color: c.textPrimary }]} numberOfLines={1}>
                {m.merchant}
              </Text>
              <Text style={[t.micro, { color: c.textMuted, marginTop: 2 }]}>
                {m.count} visit{m.count === 1 ? '' : 's'} ·{' '}
                {formatMoney({ minor: Math.round(m.total.minor / m.count), currency: m.total.currency }, { compactDecimals: true })} average
              </Text>
            </View>
            <AmountText value={m.total} size="body" />
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: 'good' | 'warning' | 'critical' | 'muted';
}) {
  const { c, type: t, space: sp } = useTheme();
  const color = { good: c.good, warning: c.warning, critical: c.critical, muted: c.textPrimary }[tone];
  return (
    <Card style={{ flex: 1 }}>
      <Text style={[t.micro, { color: c.textMuted }]}>{label.toUpperCase()}</Text>
      <Text style={[t.display, { color, marginTop: sp.xs }]}>{value}</Text>
      <Text style={[t.micro, { color: c.textMuted, marginTop: sp.xs }]}>{hint}</Text>
    </Card>
  );
}
