import React, { useMemo, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  TextInput,
  useWindowDimensions,
  StyleSheet,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme/ThemeProvider';
import { AmountText, Card, SectionHeader } from '../../src/components/ui/Primitives';
import { CategoryBreakdown } from '../../src/components/charts/CategoryBreakdown';
import { Ring, RingLegend, type RingSlice } from '../../src/components/charts/Ring';
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
import { formatDate, isValidISODate, today } from '../../src/core/dates';
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
import { FeatureCard, FeaturePill } from '../../src/components/ui/FeatureCard';
import {
  Banner,
  ScrollRow,
  SegmentedControl,
  StatRow,
  StatTile,
} from '../../src/components/ui/Tiles';
import { useEnter } from '../../src/theme/motion';
import { DateField } from '../../src/components/ui/DateField';
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

  /**
   * Name the slice, not the month it came out of.
   *
   * When this month is still running the baseline is trimmed to the same number
   * of days, so the figure beside "JULY 2026" was July 1st to the 28th — while
   * paging back to July showed the whole month under the very same heading.
   * Two different numbers under one label reads as a bug in the totals, and the
   * "at the same point" line underneath was doing all the work of explaining a
   * heading that flatly contradicted it. A trimmed baseline says so in the
   * heading, where the number is.
   */
  const baselineLabel = useMemo(() => {
    if (mode === 'custom' && custom) return `${custom.start} → ${custom.end}`;
    const whole = mode === 'year' ? sameMonthLastYear(range) : previousMonth(range);
    if (!trimBaseline) return whole.label;
    const slice = matchingSlice(whole, elapsed);
    return `${formatDate(slice.start, 'short')} – ${formatDate(slice.end, 'short')}`;
  }, [mode, custom, range, trimBaseline, elapsed]);
  const rate = savingsRate(range, ctx);
  const runway = runwayMonths(ctx);
  const worth = netWorth(ctx, asOf);
  const merchants = topMerchants(range, ctx, 6);
  const categoryRows = withOtherBucket(
    categoryTotals(range, ctx, 'expense'),
    7,
    settings.display_currency ?? 'NGN'
  );

  /**
   * The ring reads the same rows the bars do.
   *
   * Two charts of the same thing that disagree is worse than one chart, and
   * `withOtherBucket` has already folded the long tail into a single "Other"
   * — so the ring gets exactly the rows on screen, in the same order, wearing
   * the same series colours. Nothing here picks a colour.
   */
  const ringSlices: RingSlice[] = useMemo(
    () =>
      categoryRows.map((row) => ({
        key: row.categoryId,
        value: Math.abs(row.total.minor),
        color: row.color,
      })),
    [categoryRows]
  );
  const ringTotal = useMemo(
    () => ringSlices.reduce((sum, slice) => sum + slice.value, 0),
    [ringSlices]
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

      {/*
        The period governs every figure below it, so it comes first.

        It used to sit between the savings-rate tiles and the net-worth card,
        which meant the first two numbers on the screen belonged to a period the
        reader had not been shown yet.
      */}
      <View style={{ marginTop: sp.md, marginBottom: sp.md }}>
        <PeriodBar range={range} onChange={setRange} today={asOf} />
      </View>

      {/*
        Where it goes: the ring and its reading, side by side.

        A donut answers "how is the whole thing divided", which is the question
        someone has about a month of spending — and putting the total in the
        hole means the parts and the whole arrive in one movement. The legend
        goes beside it rather than under it: below, the two compete for the same
        glance and the card is twice as tall for no extra information.
      */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Ring
            size={150}
            slices={ringSlices}
            centerLabel="Spent"
            centerValue={formatMoney(comparison.current, { compactDecimals: true })}
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
                formatMoney(money(value, settings.display_currency ?? 'NGN'), {
                  compactDecimals: true,
                })
              }
            />
          </View>
        </View>

        {/* The bars stay, under the ring, because a share and a rank are
            different readings and only the bars are tappable through to the
            transactions behind them. */}
        <View style={{ marginTop: sp.md }}>
          <CategoryBreakdown
            rows={categoryRows}
            grid
            onSelect={(_, row) => openCategory(row, range)}
          />
        </View>
      </Card>

      {/*
        Three figures across where there were two big ones and a hero card.

        Savings rate and runway were 128pt tall tinted panels with an oversized
        glyph each, and net worth was a full-width hero below them — three
        screens of scrolling for three numbers. None of them is the headline;
        the ring above is. They read fine at a third of the width.
      */}
      <View style={{ marginTop: sp.lg }}>
        <StatRow>
          <StatTile
            index={0}
            label="Net worth"
            value={formatMoney(worth.net, { compactDecimals: true })}
            caption={`Owed ${formatMoney(worth.liabilities, { compactDecimals: true })}`}
            tone={worth.net.minor < 0 ? 'pink' : 'teal'}
          />
          <StatTile
            index={1}
            label="Savings rate"
            value={rate == null ? '—' : `${Math.round(rate * 100)}%`}
            caption={
              rate == null ? 'No income yet' : rate > 0.2 ? 'Above 20%' : 'Below 20%'
            }
            tone={rate == null ? undefined : rate > 0.2 ? 'green' : rate < 0 ? 'pink' : 'amber'}
          />
          <StatTile
            index={2}
            label="Runway"
            value={runway == null ? '—' : `${runway.toFixed(1)}mo`}
            caption="At median spend"
          />
        </StatRow>
      </View>

      <SectionHeader title="Compared with" />

      {/* Three chips that were really one choice, as a track. */}
      <View style={{ marginBottom: sp.md }}>
        <SegmentedControl<CompareMode>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'month', label: 'Last month' },
            { value: 'year', label: 'Last year' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
      </View>

      {mode === 'custom' ? (
        <Card style={{ marginBottom: sp.md }}>
          <Text style={[t.micro, { color: c.textMuted }]}>COMPARE AGAINST</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: sp.sm }}>
            <View style={{ flex: 1 }}>
              <DateField value={customFrom} onChange={setCustomFrom} placeholder="From" maxToday />
            </View>
            <Text style={[t.body, { color: c.textMuted, marginHorizontal: sp.sm }]}>→</Text>
            <View style={{ flex: 1 }}>
              <DateField value={customTo} onChange={setCustomTo} placeholder="To" maxToday />
            </View>
          </View>
          {custom ? null : (
            <Text style={[t.micro, { color: c.textMuted, marginTop: sp.sm }]}>
              Pick both dates. Showing last month until then.
            </Text>
          )}
        </Card>
      ) : null}

      <Card>
        <View
          style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}
        >
          <View>
            <Text style={[t.micro, { color: c.textMuted }]}>
              {live ? 'SO FAR THIS MONTH' : range.label.toUpperCase()}
            </Text>
            <AmountText value={comparison.current} size="title" />
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[t.micro, { color: c.textMuted }]}>{baselineLabel.toUpperCase()}</Text>
            <AmountText value={comparison.previous} size="body" color={c.textSecondary} />
          </View>
        </View>

        {comparison.change != null ? (
          <Text
            style={[
              t.caption,
              { marginTop: sp.md, color: comparison.change > 0.1 ? c.warning : c.good },
            ]}
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

        {/*
          What actually moved, two across.

          A category that fell is as interesting as one that rose, so they are
          ranked by size of change rather than by spend. Four of them stacked
          was four more full-width rows on a screen that already had too many;
          in pairs they occupy two lines and read as a set of movements rather
          than a continuation of the list above.
        */}
        {comparison.categories.length > 0 ? (
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              marginTop: sp.md,
              marginHorizontal: -sp.sm / 2,
              paddingTop: sp.md,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: c.border,
            }}
          >
            {comparison.categories.slice(0, 4).map((d) => (
              <View
                key={d.categoryId}
                style={{ width: '50%', paddingHorizontal: sp.sm / 2, paddingBottom: sp.sm }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 13,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: d.color + '22',
                      marginRight: sp.sm,
                    }}
                  >
                    <Text style={{ fontSize: 12 }}>{d.icon}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[t.micro, { color: c.textSecondary }]} numberOfLines={1}>
                      {d.categoryName}
                    </Text>
                    <Text
                      style={[
                        t.caption,
                        {
                          color: d.deltaMinor > 0 ? c.warning : c.good,
                          fontVariant: ['tabular-nums'],
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {d.deltaMinor > 0 ? '+' : '−'}
                      {formatMoney(
                        money(Math.abs(d.deltaMinor), settings.display_currency ?? 'NGN'),
                        { compactDecimals: true }
                      )}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </Card>

      {/* Merchants as a podium, not a table. The top three are the answer to
          "where does it actually go", and a ranked row of cards says that
          faster than five identical lines with numbers on the right. */}
      <ScrollRow title="Top merchants" gutter={sp.lg}>
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
                borderWidth: StyleSheet.hairlineWidth,
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
                {m.count} visit{m.count === 1 ? '' : 's'} ·{' '}
                {formatMoney(
                  { minor: Math.round(m.total.minor / m.count), currency: m.total.currency },
                  { compactDecimals: true }
                )}{' '}
                avg
              </Text>
            </View>
          );
        })}
      </ScrollRow>

    </ScrollView>
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
