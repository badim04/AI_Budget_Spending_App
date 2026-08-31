import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Card, SectionHeader } from '../../src/components/ui/Primitives';
import { Screen, Grid, Split } from '../../src/components/ui/Screen';
import { Ring, type RingSlice } from '../../src/components/charts/Ring';
import type { Insight } from '../../src/core/types';
import { formatMoney, money } from '../../src/core/money';
import {
  excludedCategoryIds,
  generateInsights,
  netWorth,
  runwayMonths,
  savingsRate,
  type AnalyticsContext,
} from '../../src/core/analytics';
import { describeHealth, financialHealth } from '../../src/core/health';
import { challenges, describeChallenges } from '../../src/core/challenges';
import { allBudgetStatuses } from '../../src/core/budget';
import { today } from '../../src/core/dates';
import { monthOf } from '../../src/core/periods';
import { PeriodBar } from '../../src/components/ui/PeriodBar';
import { Banner, SegmentedControl, StatRow, StatTile } from '../../src/components/ui/Tiles';
import { router } from 'expo-router';
import { useAppStore } from '../../src/store/useAppStore';

export default function InsightsScreen() {
  const { c, type: t, space: sp } = useTheme();
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

  /**
   * Budget statuses feed both the score and the sentences.
   *
   * Computed once here rather than inside each: `allBudgetStatuses` walks the
   * transaction history per envelope, and running it twice on every render of a
   * page that already recomputes on every keystroke elsewhere is the kind of
   * cost that only shows up on a three-year-old phone.
   */
  const budgets = useAppStore((s) => s.budgets);
  const budgetStatuses = useMemo(
    () =>
      allBudgetStatuses(budgets, {
        transactions,
        excludedCategoryIds: excludedCategoryIds(categories),
        asOf,
      }),
    [budgets, transactions, categories, asOf]
  );

  const rate = savingsRate(range, ctx);
  const runway = runwayMonths(ctx);
  const worth = netWorth(ctx, asOf);

  /**
   * The health score, and the ring that draws it.
   *
   * The ring shows the measured components as equal-width arcs coloured by how
   * each one scored, so the shape of the ring is the shape of the assessment
   * rather than a decorative circle around a number. Components the app cannot
   * measure are absent from it entirely — see `core/health` for why an
   * untracked component must never be drawn as a zero.
   */
  const health = useMemo(() => financialHealth(ctx, budgetStatuses), [ctx, budgetStatuses]);

  const healthSlices: RingSlice[] = useMemo(
    () =>
      health.components
        .filter((part): part is typeof part & { score: number } => part.score != null)
        .map((part) => ({
          key: part.key,
          value: 1,
          color: part.score >= 80 ? c.good : part.score >= 40 ? c.warning : c.critical,
        })),
    [health, c]
  );

  const insights = useMemo(
    () => generateInsights(ctx, budgetStatuses),
    [ctx, budgetStatuses]
  );

  /**
   * Challenges are scored off the ledger, never off a stored streak.
   *
   * A stored streak survives a deleted transaction and starts lying; see
   * `core/challenges` for the bigger trap — an unimported day must never count
   * as a no-spend day, or the app rewards people for not using it.
   */
  const challengeList = useMemo(() => challenges(transactions, asOf), [transactions, asOf]);
  const challengeLine = describeChallenges(challengeList);
  const liveChallenges = challengeList.filter((x) => x.state !== 'unmeasurable');

  return (
    <Screen>
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

      {/* Insights and Analysis are siblings, one tap apart. */}
      <View style={{ marginTop: sp.md }}>
        <SegmentedControl<'insights' | 'analysis'>
          value="insights"
          onChange={(next) => {
            if (next === 'analysis') router.replace('/analysis');
          }}
          options={[
            { value: 'insights', label: 'Insights' },
            { value: 'analysis', label: 'Analysis' },
          ]}
        />
      </View>

      <View style={{ marginTop: sp.md, marginBottom: sp.md }}>
        <PeriodBar range={range} onChange={setRange} today={asOf} />
      </View>

      {/*
        The score, and immediately the reason for it.

        Every app in the reference set opens this page on a number out of a
        hundred inside a ring. The number is worth having — it answers "am I
        doing all right", which no list of transactions can — but on its own it
        is a verdict. So the ring never appears without the sentence naming its
        weakest part, and the components sit beside it rather than under it, so
        the score and its reasons are one glance instead of two.

        `core/health` refuses to score what it cannot see: Finlo knows nothing
        about insurance or pensions, and counting those as zero would tell
        someone with excellent finances they were failing.
      */}
      <Split ratio={0.42} stackOnTablet>
        <Card>
          <View style={{ alignItems: 'center' }}>
            <Ring
              size={168}
              slices={healthSlices}
              centerLabel={health.score == null ? undefined : 'Health'}
              centerValue={health.score == null ? undefined : `${health.score}`}
              centerCaption={health.score == null ? undefined : health.label}
              emptyLabel="Not enough history yet"
            />
            <Text
              style={[t.micro, { color: c.textMuted, marginTop: sp.md, textAlign: 'center' }]}
            >
              {health.monthsOfHistory > 0
                ? `Based on ${health.monthsOfHistory} month${health.monthsOfHistory === 1 ? '' : 's'} · ${health.confidence} confidence`
                : 'No complete months yet'}
            </Text>
          </View>
        </Card>

        <Card>
          <Text style={[t.body, { color: c.textPrimary }]}>{describeHealth(health)}</Text>

          <View style={{ marginTop: sp.lg }}>
            {health.components.map((part) => (
              <View key={part.key} style={{ marginBottom: sp.md }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Text style={[t.caption, { color: c.textSecondary }]}>{part.label}</Text>
                  <Text
                    style={[
                      t.caption,
                      {
                        color: part.score == null ? c.textMuted : c.textPrimary,
                        fontVariant: ['tabular-nums'],
                      },
                    ]}
                  >
                    {part.score == null ? 'Not tracked' : `${part.score}/100`}
                  </Text>
                </View>

                {/* A bar only where there is a score. An empty track under
                    "not tracked" reads as a zero, which is the exact
                    misreading core/health exists to avoid. */}
                {part.score != null ? (
                  <View
                    style={{
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: c.surfaceSunken,
                      marginTop: 5,
                      overflow: 'hidden',
                    }}
                  >
                    <View
                      style={{
                        width: `${part.score}%`,
                        height: '100%',
                        borderRadius: 3,
                        backgroundColor:
                          part.score >= 80 ? c.good : part.score >= 40 ? c.warning : c.critical,
                      }}
                    />
                  </View>
                ) : null}

                <Text style={[t.micro, { color: c.textMuted, marginTop: 4 }]}>{part.detail}</Text>
              </View>
            ))}
          </View>
        </Card>
      </Split>

      {/*
        The sentences.

        `generateInsights` already produced these and the old page buried them
        under three charts. They are the reason someone opens this tab: each one
        is specific, actionable and true, and anything vague is deliberately
        absent rather than padded in.
      */}
      {insights.length > 0 ? (
        <>
          <SectionHeader title="What stands out" />
          <Grid ideal={3} phoneMin={1}>
            {insights.slice(0, 6).map((insight) => (
              <InsightCard key={insight.id} insight={insight} />
            ))}
          </Grid>
        </>
      ) : null}

      {/*
        Challenges: the one part of this screen you can act on today.

        Deliberately after the score and the sentences, because a challenge is
        a suggestion and the two above it are facts — and a screen that opens on
        gamification before it has told you anything true is a screen people
        stop believing.
      */}
      {liveChallenges.length > 0 ? (
        <>
          <SectionHeader title="Challenges" />
          {challengeLine ? (
            <Text style={[t.caption, { color: c.textSecondary, marginBottom: sp.sm }]}>
              {challengeLine}
            </Text>
          ) : null}
          <Grid ideal={4}>
            {liveChallenges.map((challenge) => (
              <View
                key={challenge.id}
                style={{
                  backgroundColor: c.surface,
                  borderRadius: 16,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: challenge.state === 'complete' ? c.good : c.border,
                  padding: sp.lg,
                  minHeight: 148,
                  justifyContent: 'space-between',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={[t.caption, { color: c.textPrimary, flex: 1 }]} numberOfLines={1}>
                    {challenge.title}
                  </Text>
                  {challenge.state === 'complete' ? (
                    <Text style={[t.micro, { color: c.good }]}>DONE</Text>
                  ) : null}
                </View>

                <View style={{ marginTop: sp.sm }}>
                  <Text style={[t.display, { color: c.textPrimary }]}>
                    {challenge.streak}
                  </Text>
                  <Text style={[t.micro, { color: c.textMuted }]}>
                    in a row{challenge.best > challenge.streak ? ` · best ${challenge.best}` : ''}
                  </Text>
                </View>

                <View
                  style={{
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: c.surfaceSunken,
                    marginTop: sp.sm,
                    overflow: 'hidden',
                  }}
                >
                  <View
                    style={{
                      width: `${Math.round((challenge.progress ?? 0) * 100)}%`,
                      height: '100%',
                      borderRadius: 3,
                      backgroundColor: challenge.state === 'complete' ? c.good : c.accent,
                    }}
                  />
                </View>

                <Text style={[t.micro, { color: c.textMuted, marginTop: 6 }]} numberOfLines={2}>
                  {challenge.detail}
                </Text>
              </View>
            ))}
          </Grid>
        </>
      ) : null}

      {/* Three figures that are judgements rather than charts, so they stay
          here rather than moving to Analysis with the graphs. */}
      <SectionHeader title="Where you stand" />
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
          caption={rate == null ? 'No income yet' : rate > 0.2 ? 'Above 20%' : 'Below 20%'}
          tone={rate == null ? undefined : rate > 0.2 ? 'green' : rate < 0 ? 'pink' : 'amber'}
        />
        <StatTile
          index={2}
          label="Runway"
          value={runway == null ? '—' : `${runway.toFixed(1)}mo`}
          caption="At median spend"
        />
      </StatRow>

      <Banner
        tone="violet"
        glyph="✨"
        title="Ask about your money"
        body="A question in plain words, answered from your own figures."
        onPress={() => router.push('/ask')}
        style={{ marginTop: sp.xl }}
      />

      <Banner
        tone="blue"
        glyph="📊"
        title="See the numbers behind this"
        body="Charts, category breakdown and month-on-month comparison."
        onPress={() => router.replace('/analysis')}
        style={{ marginTop: sp.md }}
      />
    </Screen>
  );
}

/**
 * One thing the app has to say, as a card rather than a row.
 *
 * `generateInsights` ranks by weight and severity, so the first is the most
 * worth acting on. Severity drives the stripe colour and nothing else — the
 * sentence has to work in black and white, because colour that carries meaning
 * alone fails for a quarter of men.
 */
function InsightCard({ insight }: { insight: Insight }) {
  const { c, type: t, space: sp, radius: r } = useTheme();

  const tone =
    insight.severity === 'critical'
      ? c.critical
      : insight.severity === 'warning'
        ? c.warning
        : insight.severity === 'positive'
          ? c.good
          : c.accent;

  const body = (
    <View
      style={{
        backgroundColor: c.surface,
        borderRadius: r.lg,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
        borderLeftWidth: 3,
        borderLeftColor: tone,
        padding: sp.lg,
        minHeight: 118,
      }}
    >
      <Text style={[t.bodyStrong, { color: c.textPrimary }]} numberOfLines={2}>
        {insight.title}
      </Text>
      <Text style={[t.micro, { color: c.textSecondary, marginTop: 6 }]} numberOfLines={4}>
        {insight.body}
      </Text>
      {insight.action ? (
        <Text style={[t.micro, { color: c.accent, marginTop: sp.sm }]}>Open ›</Text>
      ) : null}
    </View>
  );

  if (!insight.action) return body;

  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: insight.action!.route as never,
          params: insight.action!.params as never,
        })
      }
      accessibilityRole="button"
      accessibilityLabel={`${insight.title}. ${insight.body}`}
    >
      {body}
    </Pressable>
  );
}
