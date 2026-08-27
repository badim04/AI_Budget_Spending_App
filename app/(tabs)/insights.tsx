import React, { useMemo, useState } from 'react';
import { ScrollView, View, Text, TextInput, useWindowDimensions, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme/ThemeProvider';
import { AmountText, Card, SectionHeader } from '../../src/components/ui/Primitives';
import { CategoryBreakdown } from '../../src/components/charts/CategoryBreakdown';
import type { CategoryTotal, PeriodRange } from '../../src/core/types';
import { formatMoney, money } from '../../src/core/money';
import {
  categoryTotals,
  netWorth,
  runwayMonths,
  savingsRate,
  topMerchants,
  withOtherBucket,
  comparePeriods,
  type AnalyticsContext,
} from '../../src/core/analytics';
import { isValidISODate, today } from '../../src/core/dates';
import {
  customRange,
  elapsedRange,
  isCurrentMonth,
  matchingSlice,
  monthOf,
  previousMonth,
  sameMonthLastYear,
} from '../../src/core/periods';
import { PeriodBar } from '../../src/components/ui/PeriodBar';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Pressable } from 'react-native';
import { useAppStore } from '../../src/store/useAppStore';

/**
 * Insights.
 *
 * Every tile here is a comparison, not a total: this period against the last,
 * against last year, or against how long the money would last. A number with
 * nothing to measure it against belongs on the dashboard, not here.
 */
type CompareMode = 'month' | 'year' | 'custom';

function ModeChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { c, type: t, radius: r, space: sp } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={{
        backgroundColor: active ? c.accentSubtle : c.surface,
        borderColor: active ? c.accent : c.border,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: r.pill,
        paddingHorizontal: sp.lg,
        paddingVertical: sp.sm,
      }}
    >
      <Text style={[t.caption, { color: active ? c.accent : c.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

function DateField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  const { c, radius: r, space: sp } = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={c.textMuted}
      autoCapitalize="none"
      autoCorrect={false}
      style={{
        flex: 1,
        color: c.textPrimary,
        backgroundColor: c.surfaceSunken,
        borderRadius: r.md,
        paddingHorizontal: sp.md,
        paddingVertical: sp.md,
        fontSize: 14,
      }}
    />
  );
}

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

  const [range, setRange] = useState(() => monthOf(asOf));
  const [mode, setMode] = useState<CompareMode>('month');
  /** Only read in custom mode; free text so a keyboard is enough. */
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const live = isCurrentMonth(range, asOf);

  /**
   * Like for like.
   *
   * Eleven days of a live month against a whole previous month is not a
   * comparison, it is an announcement that spending has collapsed. When the
   * month on screen is still running, both sides are trimmed to the same
   * number of days.
   */
  const elapsed = live ? elapsedRange(range, asOf) : range;

  /** In custom mode the baseline is whatever two dates were typed, until both
   *  parse — an incomplete date should not blank the card out. */
  const custom =
    isValidISODate(customFrom) && isValidISODate(customTo)
      ? customRange(customFrom, customTo)
      : null;

  const baseline =
    mode === 'custom'
      ? (custom ?? previousMonth(range))
      : mode === 'year'
        ? sameMonthLastYear(range)
        : previousMonth(range);

  /** A hand-picked range is compared whole: the user chose its length. */
  const trimBaseline = mode !== 'custom' && live;

  const comparison = useMemo(
    () => comparePeriods(elapsed, trimBaseline ? matchingSlice(baseline, elapsed) : baseline, ctx),
    [elapsed, baseline, trimBaseline, ctx]
  );
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
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[t.title, { color: c.textPrimary }]}>Insights</Text>
        <Pressable
          onPress={() => router.push('/reports')}
          accessibilityRole="button"
          accessibilityLabel="Export a report"
          hitSlop={10}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: sp.md,
            paddingVertical: sp.sm,
            borderRadius: 999,
            backgroundColor: pressed ? c.accentSubtle : c.surface,
            borderWidth: 0.5,
            borderColor: c.border,
          })}
        >
          <Ionicons name="download-outline" size={15} color={c.accent} />
          <Text style={[t.caption, { color: c.accent, marginLeft: 6 }]}>Export</Text>
        </Pressable>
      </View>

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

      <View style={{ marginBottom: sp.lg }}>
        <PeriodBar range={range} onChange={setRange} today={asOf} />
      </View>

      <SectionHeader title="Net worth" />
      <Card>
        <AmountText
          value={worth.net}
          size="display"
          animate
          color={worth.net.minor < 0 ? c.critical : c.textPrimary}
        />
        <View style={{ flexDirection: 'row', marginTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={[t.micro, { color: c.textMuted }]}>ASSETS</Text>
            {/* Not unconditionally green: an overdrawn wallet makes assets
                negative, and "-₦9,774" in the healthy colour reads as a bug. */}
            <AmountText
              value={worth.assets}
              size="body"
              color={worth.assets.minor < 0 ? c.critical : c.good}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[t.micro, { color: c.textMuted }]}>LIABILITIES</Text>
            <AmountText value={worth.liabilities} size="body" color={c.textSecondary} />
          </View>
        </View>
      </Card>

      <SectionHeader title="Compared with" />
      <View style={{ flexDirection: 'row', marginBottom: sp.md }}>
        <ModeChip label="Last month" active={mode === 'month'} onPress={() => setMode('month')} />
        <View style={{ width: sp.sm }} />
        <ModeChip label="Last year" active={mode === 'year'} onPress={() => setMode('year')} />
        <View style={{ width: sp.sm }} />
        <ModeChip label="Custom" active={mode === 'custom'} onPress={() => setMode('custom')} />
      </View>

      {mode === 'custom' ? (
        <Card style={{ marginBottom: sp.md }}>
          <Text style={[t.micro, { color: c.textMuted }]}>COMPARE AGAINST</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: sp.sm }}>
            <DateField value={customFrom} onChange={setCustomFrom} placeholder="From (2026-06-01)" />
            <Text style={[t.body, { color: c.textMuted, marginHorizontal: sp.sm }]}>→</Text>
            <DateField value={customTo} onChange={setCustomTo} placeholder="To (2026-06-30)" />
          </View>
          {custom ? null : (
            <Text style={[t.micro, { color: c.textMuted, marginTop: sp.sm }]}>
              Enter both dates as YYYY-MM-DD. Showing last month until then.
            </Text>
          )}
        </Card>
      ) : null}

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <View>
            <Text style={[t.micro, { color: c.textMuted }]}>
              {live ? 'SO FAR THIS MONTH' : range.label.toUpperCase()}
            </Text>
            <AmountText value={comparison.current} size="title" />
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[t.micro, { color: c.textMuted }]}>
              {(mode === 'custom' && custom
                ? `${custom.start} → ${custom.end}`
                : mode === 'year'
                  ? sameMonthLastYear(range).label
                  : previousMonth(range).label
              ).toUpperCase()}
            </Text>
            <AmountText value={comparison.previous} size="body" color={c.textSecondary} />
          </View>
        </View>

        {comparison.change != null ? (
          <Text
            style={[t.caption, { marginTop: sp.md, color: comparison.change > 0.1 ? c.warning : c.good }]}
          >
            {comparison.change > 0 ? 'Up' : 'Down'}{' '}
            {Math.abs(Math.round(comparison.change * 100))}%
            {trimBaseline ? ' at the same point' : ''} versus{' '}
            {mode === 'custom' ? 'that range' : mode === 'year' ? 'last year' : 'last month'}
          </Text>
        ) : (
          <Text style={[t.caption, { color: c.textMuted, marginTop: sp.md }]}>
            Nothing to compare against in that period yet.
          </Text>
        )}

        {/* What actually moved. A category that fell is as interesting as one
            that rose, so they are ranked by size of change, not by spend. */}
        {comparison.categories.slice(0, 4).map((d) => (
          <View
            key={d.categoryId}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginTop: sp.md,
              paddingTop: sp.md,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: c.border,
            }}
          >
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: d.color + '22',
                marginRight: sp.md,
              }}
            >
              <Text style={{ fontSize: 13 }}>{d.icon}</Text>
            </View>
            <Text style={[t.body, { color: c.textPrimary, flex: 1 }]} numberOfLines={1}>
              {d.categoryName}
            </Text>
            <Text
              style={[
                t.caption,
                { color: d.deltaMinor > 0 ? c.warning : c.good },
              ]}
            >
              {d.deltaMinor > 0 ? '+' : '−'}
              {formatMoney(money(Math.abs(d.deltaMinor), settings.display_currency ?? 'NGN'), {
                compactDecimals: true,
              })}
            </Text>
          </View>
        ))}
      </Card>

      <SectionHeader title="Where it goes" />
      <Card>
        <CategoryBreakdown
          rows={categoryRows}
          onSelect={(_, row) => openCategory(row, range)}
        />
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
