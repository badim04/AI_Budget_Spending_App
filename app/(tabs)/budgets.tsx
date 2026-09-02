import React, { useMemo, useState } from 'react';
import { ScrollView, View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeProvider';
import { AppHeader } from '../../src/components/ui/AppHeader';
import { useLayout } from '../../src/theme/layout';
import { Spot } from '../../src/components/art/Spot';
import { AmountText, BudgetBar, Button, Card, SectionHeader } from '../../src/components/ui/Primitives';
import { StatRow, StatTile } from '../../src/components/ui/Tiles';
import { Grid } from '../../src/components/ui/Screen';
import { budgetStateColor, tabularNumbers } from '../../src/theme/tokens';
import {
  allBudgetStatuses,
  projectedExhaustionDate,
  suggestAllocation,
} from '../../src/core/budget';
import { excludedCategoryIds } from '../../src/core/analytics';
import { currencyMeta, formatMoney, parseMoney } from '../../src/core/money';
import { formatDate, nowISO, today } from '../../src/core/dates';
import { useAppStore } from '../../src/store/useAppStore';
import { monthlyCommitment } from '../../src/core/recurring';

const STATE_LABEL: Record<string, string> = {
  on_track: 'On track',
  warning: 'Ahead of pace',
  over: 'Over budget',
  ended_under: 'Finished under',
  ended_over: 'Finished over',
};

/**
 * Budgets.
 *
 * Each envelope leads with what is left rather than what was spent, because
 * "left" is the number that changes a decision. The pace marker and the
 * projected run-dry date are what turn a progress bar into advice.
 *
 * An envelope set to zero shows a suggested amount drawn from the median of
 * recent periods — the median rather than the mean, so one annual insurance
 * payment doesn't propose a permanently inflated budget.
 */
export default function BudgetsScreen() {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const [editing, setEditing] = useState<string | null>(null);
  const [draftAmount, setDraftAmount] = useState('');

  const budgets = useAppStore((s) => s.budgets);
  const transactions = useAppStore((s) => s.transactions);
  const categories = useAppStore((s) => s.categories);
  const settings = useAppStore((s) => s.settings);
  const saveBudget = useAppStore((s) => s.saveBudget);
  const recurringRules = useAppStore((s) => s.recurringRules);
  const recurringSuggestions = useAppStore((s) => s.recurringSuggestions);
  const acceptRecurring = useAppStore((s) => s.acceptRecurring);
  // Dismissals live in component state on purpose: "not recurring" is a
  // this-session judgement, not a permanent fact worth persisting.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const ctx = useMemo(
    () => ({
      transactions,
      excludedCategoryIds: excludedCategoryIds(categories),
      asOf: today(),
    }),
    [transactions, categories]
  );

  const statuses = useMemo(() => allBudgetStatuses(budgets, ctx), [budgets, ctx]);

  const displayCurrency = settings.display_currency ?? 'NGN';
  const suggestions = useMemo(
    () => recurringSuggestions().filter((cand) => !dismissed.has(cand.key)),
    [recurringSuggestions, dismissed, transactions, recurringRules]
  );
  const commitment = useMemo(
    () => monthlyCommitment(recurringRules, displayCurrency),
    [recurringRules, displayCurrency]
  );
  const currency = settings.display_currency ?? 'NGN';

  /**
   * The envelopes, totalled once.
   *
   * `effectiveAllocated` rather than `allocated`, so a carried-over surplus is
   * counted the same way the individual tiles count it — two figures for the
   * same thing that disagree is the failure this app has already been bitten by
   * on the dashboard.
   */
  const totals = useMemo(() => {
    let allocatedMinor = 0;
    let spentMinor = 0;
    for (const s of statuses) {
      allocatedMinor += s.effectiveAllocated.minor;
      spentMinor += s.spent.minor;
    }
    return { allocatedMinor, spentMinor, remainingMinor: allocatedMinor - spentMinor };
  }, [statuses]);

  async function commitAmount(budgetId: string) {
    const budget = budgets.find((b) => b.id === budgetId);
    if (!budget) return;
    const parsed = parseMoney(draftAmount, budget.currency);
    if (parsed) {
      await saveBudget({
        ...budget,
        amountMinor: Math.abs(parsed.minor),
        updatedAt: nowISO(),
      });
    }
    setEditing(null);
    setDraftAmount('');
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.canvas }}
      contentContainerStyle={{
        paddingTop: insets.top + sp.lg,
        paddingBottom: insets.bottom + sp.xxl,
        paddingHorizontal: layout.gutter,
        maxWidth: layout.maxWidth,
        width: '100%',
        alignSelf: 'center',
      }}
    >
      <AppHeader
        title="Budgets"
        subtitle={statuses[0]?.range.label ?? formatDate(today(), 'medium')}
      />

      {statuses.length === 0 ? (
        <Card style={{ marginTop: sp.xl }}>
          <View style={{ alignItems: 'center', paddingVertical: sp.lg }}>
            <Spot name="target" size={112} tone="violet" />
            <Text style={[t.heading, { color: c.textPrimary, marginTop: sp.md }]}>
              No budgets yet
            </Text>
            <Text
              style={[t.caption, { color: c.textMuted, marginTop: sp.xs, textAlign: 'center', maxWidth: 300 }]}
            >
              Budgets are what turn a list of transactions into a plan. Load the demo data in
              Settings to see how they work.
            </Text>
          </View>
        </Card>
      ) : null}

      {suggestions.length > 0 ? (
        <>
          <SectionHeader title="Repeating payments" />
          <Text style={[t.caption, { color: c.textMuted, marginBottom: sp.sm }]}>
            These look like they repeat. Adding one puts it on the forecast and the
            "coming up" list, so a big bill stops being a surprise.
          </Text>
          {suggestions.slice(0, 4).map((cand) => (
            <Card key={cand.key + cand.accountId} style={{ marginBottom: sp.md }}>
              <View style={styles.spread}>
                <View style={{ flex: 1, marginRight: sp.md }}>
                  <Text style={[t.bodyStrong, { color: c.textPrimary }]} numberOfLines={1}>
                    {cand.merchant}
                  </Text>
                  <Text style={[t.micro, { color: c.textMuted, marginTop: 2 }]}>
                    {cand.reason}
                  </Text>
                  <Text style={[t.micro, { color: c.textMuted, marginTop: 2 }]}>
                    Next expected {formatDate(cand.nextExpected, 'short')}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <AmountText
                    value={{ minor: Math.abs(cand.amountMinor), currency: cand.currency }}
                    size="body"
                  />
                  {cand.variableAmount ? (
                    <Text style={[t.micro, { color: c.textMuted }]}>varies</Text>
                  ) : null}
                </View>
              </View>
              <View style={{ flexDirection: 'row', marginTop: sp.md }}>
                <View style={{ flex: 1, marginRight: sp.sm }}>
                  <Button
                    label="Not recurring"
                    variant="secondary"
                    onPress={() => setDismissed((d) => new Set(d).add(cand.key))}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label="Add" onPress={() => void acceptRecurring(cand)} />
                </View>
              </View>
            </Card>
          ))}
        </>
      ) : null}

      {commitment > 0 ? (
        <Card style={{ marginTop: sp.md }}>
          <Text style={[t.micro, { color: c.textMuted }]}>COMMITTED EACH MONTH</Text>
          <AmountText value={{ minor: commitment, currency: displayCurrency }} size="title" />
          <Text style={[t.micro, { color: c.textMuted, marginTop: sp.xs }]}>
            Rent, bills and subscriptions already scheduled — spoken for before anything else.
          </Text>
        </Card>
      ) : null}

      {statuses.length > 0 ? (
        <>
          {/*
            The three numbers the whole page is about, before the envelopes.

            Reading a column of envelopes and adding them up in your head is not
            a summary. These are the same figures the tiles below carry, totalled
            once so "how am I doing overall" is answered before any individual
            envelope has to be opened.
          */}
          <View style={{ marginTop: sp.lg }}>
            <StatRow>
              <StatTile
                index={0}
                label="Allocated"
                value={formatMoney(
                  { minor: totals.allocatedMinor, currency: displayCurrency },
                  { compactDecimals: true }
                )}
                caption={`${statuses.length} envelope${statuses.length === 1 ? '' : 's'}`}
              />
              <StatTile
                index={1}
                label="Spent"
                value={formatMoney(
                  { minor: totals.spentMinor, currency: displayCurrency },
                  { compactDecimals: true }
                )}
                caption={
                  totals.allocatedMinor > 0
                    ? `${Math.round((totals.spentMinor / totals.allocatedMinor) * 100)}% used`
                    : 'Nothing set yet'
                }
              />
              <StatTile
                index={2}
                label="Left"
                value={formatMoney(
                  { minor: totals.remainingMinor, currency: displayCurrency },
                  { compactDecimals: true }
                )}
                tone={totals.remainingMinor < 0 ? 'pink' : 'green'}
                caption={totals.remainingMinor < 0 ? 'Over budget' : 'Still available'}
              />
            </StatRow>
          </View>

          <SectionHeader title="Envelopes" />

          {/*
            Two across.

            Each envelope used to be a full-width card about 250pt tall, so six
            of them was a five-screen scroll and no two could ever be compared
            without remembering the one above. Halved, a pair fits side by side
            and the whole plan is visible at once — which is the only way a set
            of budgets reads as a plan rather than as six separate decisions.

            The bar survives the shrink because the pace marker is the point:
            without it a progress bar says how much is gone, and with it the bar
            says whether that is too fast. That is the difference between a
            measurement and advice.
          */}
          <Grid ideal={4}>
            {statuses.map((s) => {
              const exhaustion = projectedExhaustionDate(s);
              const carried = s.effectiveAllocated.minor - s.allocated.minor;
              const isEditing = editing === s.budget.id;
              const unset = s.budget.amountMinor === 0;
              const suggested = unset ? suggestAllocation(s.budget, ctx) : null;

              return (
                <View key={s.budget.id}>
                  <View
                    style={{
                      backgroundColor: c.surface,
                      borderRadius: r.lg,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: s.state === 'over' ? c.critical : c.border,
                      padding: sp.md,
                      minHeight: 176,
                      justifyContent: 'space-between',
                    }}
                  >
                    <View>
                      <View style={styles.spread}>
                        <Text
                          style={[t.caption, { color: c.textPrimary, flex: 1, marginRight: 4 }]}
                          numberOfLines={1}
                        >
                          {s.budget.name}
                        </Text>
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: unset ? c.border : budgetStateColor(c, s.state),
                          }}
                        />
                      </View>

                      {/* What is left, not what is spent: "left" is the number
                          that changes a decision. */}
                      <Text style={[t.micro, { color: c.textMuted, marginTop: sp.sm }]}>
                        {unset ? 'NOT SET' : s.remaining.minor < 0 ? 'OVER BY' : 'LEFT'}
                      </Text>
                      <AmountText
                        value={
                          unset
                            ? { minor: 0, currency: s.budget.currency }
                            : {
                                minor: Math.abs(s.remaining.minor),
                                currency: s.remaining.currency,
                              }
                        }
                        size="body"
                        color={
                          unset
                            ? c.textMuted
                            : s.remaining.minor < 0
                              ? c.critical
                              : c.textPrimary
                        }
                      />

                      {isEditing ? (
                        <TextInput
                          value={draftAmount}
                          onChangeText={setDraftAmount}
                          keyboardType="decimal-pad"
                          inputMode="decimal"
                          autoFocus
                          onBlur={() => commitAmount(s.budget.id)}
                          onSubmitEditing={() => commitAmount(s.budget.id)}
                          placeholder={currencyMeta(s.budget.currency).symbol}
                          placeholderTextColor={c.textMuted}
                          style={[
                            t.caption,
                            tabularNumbers,
                            {
                              color: c.accent,
                              marginTop: 4,
                              borderBottomWidth: 1,
                              borderBottomColor: c.accent,
                              paddingVertical: 2,
                            },
                          ]}
                          accessibilityLabel={`${s.budget.name} budget amount`}
                        />
                      ) : (
                        <Pressable
                          onPress={() => {
                            setEditing(s.budget.id);
                            setDraftAmount(
                              s.budget.amountMinor
                                ? String(
                                    s.budget.amountMinor /
                                      10 ** currencyMeta(s.budget.currency).decimals
                                  )
                                : ''
                            );
                          }}
                          hitSlop={8}
                          accessibilityLabel={`Edit ${s.budget.name} budget`}
                        >
                          <Text style={[t.micro, { color: c.accent, marginTop: 2 }]}>
                            {formatMoney(s.spent, { compactDecimals: true })} of{' '}
                            {formatMoney(s.effectiveAllocated, { compactDecimals: true })}{' '}
                            <Ionicons name="pencil" size={9} color={c.accent} />
                          </Text>
                        </Pressable>
                      )}
                    </View>

                    <View style={{ marginTop: sp.sm }}>
                      {!unset ? (
                        <BudgetBar
                          utilisation={s.utilisation}
                          pace={s.periodProgress}
                          color={budgetStateColor(c, s.state)}
                        />
                      ) : null}

                      {unset && suggested && suggested.minor > 0 ? (
                        <Pressable
                          onPress={() =>
                            saveBudget({
                              ...s.budget,
                              amountMinor: suggested.minor,
                              updatedAt: nowISO(),
                            })
                          }
                        >
                          <Text style={[t.micro, { color: c.accent }]} numberOfLines={2}>
                            Use {formatMoney(suggested, { compactDecimals: true })} — your recent
                            median
                          </Text>
                        </Pressable>
                      ) : unset ? (
                        <Text style={[t.micro, { color: c.textMuted }]} numberOfLines={2}>
                          Tap the amount to set this envelope.
                        </Text>
                      ) : (
                        <Text
                          style={[t.micro, { color: c.textMuted, marginTop: 6 }]}
                          numberOfLines={2}
                        >
                          {s.remaining.minor < 0
                            ? STATE_LABEL[s.state]
                            : exhaustion
                              ? `Runs out ~${formatDate(exhaustion, 'short')}`
                              : `${formatMoney(s.safeToSpendPerDay, { compactDecimals: true })} a day`}
                          {carried !== 0
                            ? ` · ${formatMoney(
                                { minor: carried, currency: s.allocated.currency },
                                { signed: true, compactDecimals: true }
                              )} carried`
                            : ''}
                        </Text>
                      )}
                    </View>
                  </View>
                </View>
              );
            })}
          </Grid>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
