import React, { useMemo, useState } from 'react';
import { ScrollView, View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeProvider';
import { AmountText, BudgetBar, Button, Card, Pill, SectionHeader } from '../../src/components/ui/Primitives';
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
        paddingHorizontal: sp.lg,
        maxWidth: 620,
        width: '100%',
        alignSelf: 'center',
      }}
    >
      <Text style={[t.title, { color: c.textPrimary }]}>Budgets</Text>
      <Text style={[t.caption, { color: c.textMuted, marginTop: sp.xs }]}>
        {statuses[0]?.range.label ?? formatDate(today(), 'medium')}
      </Text>

      {statuses.length === 0 ? (
        <Card style={{ marginTop: sp.xl }}>
          <Text style={[t.body, { color: c.textPrimary }]}>No budgets yet.</Text>
          <Text style={[t.caption, { color: c.textMuted, marginTop: sp.xs }]}>
            Budgets are what turn a list of transactions into a plan. Load the demo data in
            Settings to see how they work.
          </Text>
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

      {statuses.length > 0 ? <SectionHeader title="Envelopes" /> : null}

      {statuses.map((s) => {
        const exhaustion = projectedExhaustionDate(s);
        const carried = s.effectiveAllocated.minor - s.allocated.minor;
        const isEditing = editing === s.budget.id;
        const unset = s.budget.amountMinor === 0;
        const suggested = unset ? suggestAllocation(s.budget, ctx) : null;

        return (
          <Card key={s.budget.id} style={{ marginTop: sp.lg }}>
            <View style={styles.spread}>
              <Text style={[t.heading, { color: c.textPrimary }]}>{s.budget.name}</Text>
              {unset ? (
                <Pill label="Not set" tone="neutral" />
              ) : (
                <Pill
                  label={STATE_LABEL[s.state] ?? s.state}
                  tone={s.state === 'over' ? 'critical' : s.state === 'warning' ? 'warning' : 'good'}
                  icon={s.state === 'over' ? '!' : s.state === 'warning' ? '~' : '✓'}
                />
              )}
            </View>

            <View style={[styles.spread, { marginTop: sp.md, alignItems: 'flex-end' }]}>
              <AmountText value={s.spent} size="title" />
              {isEditing ? (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={[t.caption, { color: c.textMuted }]}>of </Text>
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
                      t.bodyStrong,
                      tabularNumbers,
                      {
                        color: c.accent,
                        minWidth: 90,
                        textAlign: 'right',
                        borderBottomWidth: 1,
                        borderBottomColor: c.accent,
                        paddingVertical: 2,
                      },
                    ]}
                    accessibilityLabel={`${s.budget.name} budget amount`}
                  />
                </View>
              ) : (
                <Pressable
                  onPress={() => {
                    setEditing(s.budget.id);
                    setDraftAmount(
                      s.budget.amountMinor
                        ? String(
                            s.budget.amountMinor / 10 ** currencyMeta(s.budget.currency).decimals
                          )
                        : ''
                    );
                  }}
                  hitSlop={8}
                  accessibilityLabel={`Edit ${s.budget.name} budget`}
                >
                  <Text style={[t.caption, { color: c.accent }]}>
                    of {formatMoney(s.effectiveAllocated, { compactDecimals: true })}{' '}
                    <Ionicons name="pencil" size={11} color={c.accent} />
                  </Text>
                </Pressable>
              )}
            </View>

            {!unset ? (
              <View style={{ marginTop: sp.md }}>
                <BudgetBar
                  utilisation={s.utilisation}
                  pace={s.periodProgress}
                  color={budgetStateColor(c, s.state)}
                />
              </View>
            ) : null}

            <View style={{ marginTop: sp.md }}>
              {unset && suggested && suggested.minor > 0 ? (
                <Pressable
                  onPress={() =>
                    saveBudget({ ...s.budget, amountMinor: suggested.minor, updatedAt: nowISO() })
                  }
                >
                  <Text style={[t.caption, { color: c.accent }]}>
                    Suggest {formatMoney(suggested, { compactDecimals: true })} — the median of your
                    recent months. Tap to use it.
                  </Text>
                </Pressable>
              ) : unset ? (
                <Text style={[t.caption, { color: c.textMuted }]}>
                  Tap the amount to set this envelope.
                </Text>
              ) : (
                <>
                  <Text style={[t.caption, { color: c.textSecondary }]}>
                    {s.remaining.minor < 0
                      ? `${formatMoney(s.remaining, { compactDecimals: true })} over`
                      : `${formatMoney(s.safeToSpendPerDay, { compactDecimals: true })} a day keeps you inside it`}
                  </Text>
                  {exhaustion ? (
                    <Text style={[t.micro, { color: c.warning, marginTop: 4 }]}>
                      At this rate it runs out around {formatDate(exhaustion, 'short')}
                    </Text>
                  ) : null}
                  {carried !== 0 ? (
                    <Text style={[t.micro, { color: c.textMuted, marginTop: 4 }]}>
                      Includes{' '}
                      {formatMoney(
                        { minor: carried, currency: s.allocated.currency },
                        { signed: true, compactDecimals: true }
                      )}{' '}
                      carried over
                    </Text>
                  ) : null}
                </>
              )}
            </View>
          </Card>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
