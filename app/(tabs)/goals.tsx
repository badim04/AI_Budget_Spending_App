/**
 * Goals.
 *
 * A goal is a target plus what you have put aside, and the only question worth
 * answering is "will I get there in time?". So every card leads with the gap
 * and the monthly rate needed to close it, not with a percentage — 40% of the
 * way to a target you're three months late for is not good news.
 */

import React, { useMemo, useState } from 'react';
import { ScrollView, View, Text, TextInput, Pressable, Platform, Alert, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeProvider';
import { AppHeader } from '../../src/components/ui/AppHeader';
import { copyFor } from '../../src/core/copy';
import { useLayout } from '../../src/theme/layout';
import { Grid } from '../../src/components/ui/Screen';
import { StatRow, StatTile } from '../../src/components/ui/Tiles';
import { Spot } from '../../src/components/art/Spot';
import { AmountText, Button, Card, Pill, SectionHeader } from '../../src/components/ui/Primitives';
import { useAppStore } from '../../src/store/useAppStore';
import { DateField } from '../../src/components/ui/DateField';
import { formatMoney, money, parseMoney } from '../../src/core/money';
import { daysBetween, formatDate, nowISO, today } from '../../src/core/dates';
import type { Goal } from '../../src/core/types';

const ICONS = ['🎯', '🏠', '🚗', '✈️', '🎓', '💍', '🛡️', '💻', '🏥', '🎁'];
const COLORS = ['#3987e5', '#199e70', '#d95926', '#9085e9', '#d55181', '#c98500'];

function notify(title: string, message?: string) {
  if (Platform.OS === 'web') globalThis.alert?.(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}

export default function GoalsScreen() {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const insets = useSafeAreaInsets();
  const layout = useLayout();

  const goals = useAppStore((s) => s.goals);
  const settings = useAppStore((s) => s.settings);
  const saveGoal = useAppStore((s) => s.saveGoal);
  const deleteGoal = useAppStore((s) => s.deleteGoal);
  const addToGoal = useAppStore((s) => s.addToGoal);

  const currency = settings.display_currency ?? 'NGN';
  const asOf = today();
  const active = useMemo(() => goals.filter((g) => !g.archived), [goals]);

  const [composing, setComposing] = useState(false);

  /**
   * The goals, totalled once.
   *
   * `perMonthMinor` sums only the goals that carry a target date, because a
   * goal with no deadline has no monthly cost — folding it in as zero would
   * quietly understate what the dated ones actually require each month.
   */
  const totals = useMemo(() => {
    let savedMinor = 0;
    let targetMinor = 0;
    let perMonthMinor = 0;
    for (const goal of active) {
      savedMinor += goal.savedMinor;
      targetMinor += goal.targetMinor;
      const remaining = Math.max(0, goal.targetMinor - goal.savedMinor);
      if (!goal.targetDate || remaining === 0) continue;
      const months = Math.max(0, daysBetween(asOf, goal.targetDate)) / 30.44;
      if (months > 0) perMonthMinor += Math.ceil(remaining / months);
    }
    return {
      savedMinor,
      targetMinor,
      remainingMinor: Math.max(0, targetMinor - savedMinor),
      perMonthMinor,
    };
  }, [active, asOf]);

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
      <AppHeader title="Goals" />

      {active.length > 0 && !composing ? (
        <View style={{ alignItems: 'flex-end', marginTop: -sp.sm, marginBottom: sp.sm }}>
          <Pressable
            onPress={() => setComposing(true)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Add a goal"
            style={{ flexDirection: 'row', alignItems: 'center' }}
          >
            <Ionicons name="add-circle-outline" size={18} color={c.accent} />
            <Text style={[t.caption, { color: c.accent, marginLeft: 5 }]}>New goal</Text>
          </Pressable>
        </View>
      ) : null}

      {composing ? (
        <GoalComposer
          currency={currency}
          onCancel={() => setComposing(false)}
          onSave={async (goal) => {
            await saveGoal(goal);
            setComposing(false);
          }}
        />
      ) : null}

      {active.length === 0 && !composing ? (
        <Card style={{ marginTop: sp.xl }}>
          <Text style={[t.heading, { color: c.textPrimary }]}>
            {copyFor('noGoals', asOf).title}
          </Text>
          <Text style={[t.body, { color: c.textSecondary, marginTop: sp.xs }]}>
            {copyFor('noGoals', asOf).body}
          </Text>
          <View style={{ marginTop: sp.lg }}>
            <Button label="Create a goal" onPress={() => setComposing(true)} />
          </View>
        </Card>
      ) : null}

      {/*
        Three figures before the goals themselves.

        A column of goal cards makes you add them up in your head to answer the
        only question you arrived with — how far along am I overall. The strip
        answers it once, from the same numbers the cards carry.
      */}
      {active.length > 0 && !composing ? (
        <View style={{ marginTop: sp.lg }}>
          <StatRow>
            <StatTile
              index={0}
              label="Saved"
              value={formatMoney(money(totals.savedMinor, currency), { compactDecimals: true })}
              caption={`${active.length} goal${active.length === 1 ? '' : 's'}`}
            />
            <StatTile
              index={1}
              label="Target"
              value={formatMoney(money(totals.targetMinor, currency), { compactDecimals: true })}
              caption={
                totals.targetMinor > 0
                  ? `${Math.round((totals.savedMinor / totals.targetMinor) * 100)}% there`
                  : 'Nothing set'
              }
            />
            <StatTile
              index={2}
              label="To go"
              value={formatMoney(money(totals.remainingMinor, currency), { compactDecimals: true })}
              tone={totals.remainingMinor === 0 ? 'green' : undefined}
              caption={
                totals.perMonthMinor > 0
                  ? `${formatMoney(money(totals.perMonthMinor, currency), { compactDecimals: true })} a month`
                  : 'No dated goals'
              }
            />
          </StatRow>
        </View>
      ) : null}

      {/* Two across on a phone, three on a desktop. A goal is a thing you are
          working toward, not a row in a ledger. */}
      <Grid ideal={3}>
      {active.map((goal) => (
        <GoalCard
          key={goal.id}
          goal={goal}
          asOf={asOf}
          onContribute={(delta) => void addToGoal(goal.id, delta)}
          onDelete={async () => {
            const ok =
              Platform.OS === 'web'
                ? globalThis.confirm?.(`Delete "${goal.name}"?`)
                : await new Promise<boolean>((resolve) =>
                    Alert.alert('Delete goal?', goal.name, [
                      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                      { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
                    ])
                  );
            if (ok) {
              await deleteGoal(goal.id);
              notify('Goal deleted');
            }
          }}
        />
      ))}
      </Grid>
    </ScrollView>
  );
}

// ------------------------------------------------------------------ one goal

function GoalCard({
  goal,
  asOf,
  onContribute,
  onDelete,
}: {
  goal: Goal;
  asOf: string;
  onContribute: (deltaMinor: number) => void;
  onDelete: () => void;
}) {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const [amountText, setAmountText] = useState('');

  const remaining = Math.max(0, goal.targetMinor - goal.savedMinor);
  const progress = goal.targetMinor > 0 ? Math.min(1, goal.savedMinor / goal.targetMinor) : 0;
  const done = remaining === 0;

  // The number that actually matters: what this costs per month from here.
  const monthsLeft = goal.targetDate
    ? Math.max(0, daysBetween(asOf, goal.targetDate)) / 30.44
    : null;
  const perMonth =
    monthsLeft != null && monthsLeft > 0 ? Math.ceil(remaining / monthsLeft) : null;
  const overdue = goal.targetDate != null && goal.targetDate < asOf && !done;

  return (
    <Card style={{ marginTop: sp.sm, overflow: 'hidden' }}>
      {/* A drawing behind the card, at the weight of a watermark.
          `Spot` takes a tile tone and recolours to it, so a goal card is a
          picture of a target rather than another bordered rectangle — and
          because it is a vector it costs nothing and works in both themes. */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', right: -18, top: -10, opacity: 0.1 }}
      >
        <Spot name={done ? 'sparkles' : 'target'} size={104} tone="violet" />
      </View>

      <View style={styles.spread}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          <Text style={{ fontSize: 18, marginRight: sp.sm }}>{goal.icon || '🎯'}</Text>
          <Text style={[t.bodyStrong, { color: c.textPrimary, flex: 1 }]} numberOfLines={1}>
            {goal.name}
          </Text>
        </View>
        <Pressable onPress={onDelete} hitSlop={12} accessibilityLabel={`Delete ${goal.name}`}>
          <Ionicons name="trash-outline" size={18} color={c.textMuted} />
        </Pressable>
      </View>

      <View style={{ marginTop: sp.md }}>
        <AmountText value={money(goal.savedMinor, goal.currency)} size="title" />
        <Text style={[t.micro, { color: c.textMuted, marginTop: 2 }]}>
          of {formatMoney(money(goal.targetMinor, goal.currency), { compactDecimals: true })}
        </Text>
      </View>

      <View
        style={{
          height: 8,
          backgroundColor: c.surfaceSunken,
          borderRadius: r.sm,
          overflow: 'hidden',
          marginTop: sp.md,
        }}
      >
        <View
          style={{
            width: `${Math.max(1.5, progress * 100)}%`,
            height: '100%',
            backgroundColor: done ? c.good : goal.color || c.accent,
          }}
        />
      </View>

      <View style={{ marginTop: sp.md, flexDirection: 'row', flexWrap: 'wrap' }}>
        {done ? (
          <Pill label="Reached" tone="good" icon="✓" />
        ) : overdue ? (
          <Pill label={`Past ${formatDate(goal.targetDate!, 'short')}`} tone="critical" icon="!" />
        ) : perMonth != null ? (
          <Pill
            label={`${formatMoney(money(perMonth, goal.currency), { compactDecimals: true })} / month`}
            tone="accent"
          />
        ) : (
          <Pill label="No target date" tone="neutral" />
        )}
        {!done ? (
          <View style={{ marginLeft: sp.sm }}>
            <Pill
              label={`${formatMoney(money(remaining, goal.currency), { compactDecimals: true })} to go`}
              tone="neutral"
            />
          </View>
        ) : null}
      </View>

      {!done ? (
        <View style={{ marginTop: sp.lg }}>
          <TextInput
            value={amountText}
            onChangeText={setAmountText}
            placeholder="Add an amount"
            placeholderTextColor={c.textMuted}
            keyboardType="decimal-pad"
            style={{
              flex: 1,
              color: c.textPrimary,
              backgroundColor: c.surfaceSunken,
              borderRadius: r.md,
              paddingHorizontal: sp.md,
              paddingVertical: sp.md,
              fontSize: 15,
              marginBottom: sp.sm,
            }}
          />
          <Button
            label="Add"
            variant="secondary"
            size="sm"
            onPress={() => {
              const parsed = parseMoney(amountText, goal.currency);
              if (!parsed || parsed.minor <= 0) {
                notify('Enter an amount first');
                return;
              }
              onContribute(parsed.minor);
              setAmountText('');
            }}
          />
        </View>
      ) : null}
    </Card>
  );
}

// ------------------------------------------------------------------ composer

function GoalComposer({
  currency,
  onSave,
  onCancel,
}: {
  currency: string;
  onSave: (g: Goal) => Promise<void>;
  onCancel: () => void;
}) {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [date, setDate] = useState('');
  const [icon, setIcon] = useState(ICONS[0]);
  const [color, setColor] = useState(COLORS[0]);
  const [error, setError] = useState<string | null>(null);

  const field = {
    color: c.textPrimary,
    backgroundColor: c.surfaceSunken,
    borderRadius: r.md,
    paddingHorizontal: sp.md,
    paddingVertical: sp.md,
    fontSize: 15,
    marginTop: sp.sm,
  } as const;

  return (
    <Card style={{ marginTop: sp.lg }}>
      <Text style={[t.heading, { color: c.textPrimary }]}>New goal</Text>

      <Text style={[t.micro, { color: c.textMuted, marginTop: sp.lg }]}>NAME</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Emergency fund"
        placeholderTextColor={c.textMuted}
        style={field}
      />

      <Text style={[t.micro, { color: c.textMuted, marginTop: sp.lg }]}>TARGET</Text>
      <TextInput
        value={target}
        onChangeText={setTarget}
        placeholder="500000"
        placeholderTextColor={c.textMuted}
        keyboardType="decimal-pad"
        style={field}
      />

      <View style={{ marginTop: sp.lg }}>
        <DateField
          label="TARGET DATE (OPTIONAL)"
          value={date}
          onChange={setDate}
          placeholder="No deadline"
          clearable
        />
      </View>

      <Text style={[t.micro, { color: c.textMuted, marginTop: sp.lg }]}>ICON</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: sp.sm }}>
        {ICONS.map((i) => (
          <Pressable
            key={i}
            onPress={() => setIcon(i)}
            style={{
              width: 42,
              height: 42,
              borderRadius: r.md,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: icon === i ? c.accentSubtle : c.surfaceSunken,
              borderWidth: icon === i ? 1 : 0,
              borderColor: c.accent,
              marginRight: sp.sm,
              marginBottom: sp.sm,
            }}
          >
            <Text style={{ fontSize: 18 }}>{i}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={[t.micro, { color: c.textMuted, marginTop: sp.sm }]}>COLOUR</Text>
      <View style={{ flexDirection: 'row', marginTop: sp.sm }}>
        {COLORS.map((col) => (
          <Pressable
            key={col}
            onPress={() => setColor(col)}
            accessibilityLabel={`Colour ${col}`}
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: col,
              marginRight: sp.sm,
              borderWidth: color === col ? 3 : 0,
              borderColor: c.textPrimary,
            }}
          />
        ))}
      </View>

      {error ? (
        <Text style={[t.caption, { color: c.critical, marginTop: sp.md }]}>{error}</Text>
      ) : null}

      <View style={{ flexDirection: 'row', marginTop: sp.xl }}>
        <View style={{ flex: 1, marginRight: sp.sm }}>
          <Button label="Cancel" variant="secondary" onPress={onCancel} />
        </View>
        <View style={{ flex: 2 }}>
          <Button
            label="Create goal"
            onPress={async () => {
              const parsedTarget = parseMoney(target, currency);
              if (!name.trim()) return setError('Give the goal a name.');
              if (!parsedTarget || parsedTarget.minor <= 0) {
                return setError('Enter a target amount above zero.');
              }
              if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                return setError('Use YYYY-MM-DD for the date, or leave it blank.');
              }
              const now = nowISO();
              await onSave({
                id: `goal_${Date.now().toString(36)}`,
                name: name.trim(),
                targetMinor: parsedTarget.minor,
                currency,
                savedMinor: 0,
                targetDate: date || undefined,
                icon,
                color,
                archived: false,
                createdAt: now,
                updatedAt: now,
              });
            }}
          />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
