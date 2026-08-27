import React, { useMemo, useState } from 'react';
import { View, Text, SectionList, Pressable, TextInput, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/theme/ThemeProvider';
import { AmountText, Pill, Button } from '../../src/components/ui/Primitives';
import { CategorySheet } from '../../src/components/CategorySheet';
import { amountColor } from '../../src/theme/tokens';
import { formatMoney, money } from '../../src/core/money';
import { formatDate, relativeDate, today } from '../../src/core/dates';
import { useAppStore } from '../../src/store/useAppStore';
import { isFiled, merchantKey, normaliseMerchant } from '../../src/core/categorize';
import { matchesCategorySelection } from '../../src/core/analytics';
import { describeGroup, groupKey } from '../../src/core/counterparty';
import type { Transaction } from '../../src/core/types';

type Filter = 'all' | 'review';
type Direction = 'out' | 'in';

/**
 * Activity list, and the review queue.
 *
 * Grouped by day, newest first. "Needs review" is the queue the ingestion
 * pipeline feeds — everything captured automatically but not yet confirmed.
 *
 * Three things here exist because reviewing a 200-row statement import taught
 * them the hard way:
 *
 *  1. **Money out and money in are separate queues.** They need different
 *     categories and they are read with a different question in mind ("what
 *     did I spend that on?" versus "where did that come from?"). Mixing them
 *     forces a mental gear change on every row.
 *  2. **A row you just filed stays put.** It gets a tick and its new category,
 *     and it only leaves when you press Clear. A list that deletes the row you
 *     just touched makes the next one jump up under your thumb, and you cannot
 *     glance back to check what you did.
 *  3. **One decision covers a person, not a row.** A statement has twelve
 *     transfers to the same person with a different note each time, so filing
 *     is offered per counterparty — see `src/core/counterparty.ts`.
 */
export default function TransactionsScreen() {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const insets = useSafeAreaInsets();
  /**
   * Arrived from a tap on the spending breakdown.
   *
   * `category` is a comma-separated list because the chart's "Other (3)" row
   * stands for several real categories, and `from`/`to` carry the period the
   * chart was showing — without them the list would show every transaction
   * ever filed there and not match the figure that was just tapped.
   */
  const params = useLocalSearchParams<{ category?: string; from?: string; to?: string; label?: string }>();
  const focusIds = useMemo(
    () => (params.category ? params.category.split(',').filter(Boolean) : []),
    [params.category]
  );
  const focused = focusIds.length > 0;

  const [filter, setFilter] = useState<Filter>('all');
  const [direction, setDirection] = useState<Direction>('out');
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState<Transaction | null>(null);

  /**
   * Rows filed during this visit.
   *
   * They stay in the queue, ticked, until the user clears them. Kept in
   * component state rather than the database because it is a view preference,
   * not a fact about the transaction.
   */
  const [justFiled, setJustFiled] = useState<Set<string>>(new Set());

  const transactions = useAppStore((s) => s.transactions);
  const categories = useAppStore((s) => s.categories);
  const categoriseTransaction = useAppStore((s) => s.categoriseTransaction);
  const addCategoryRule = useAppStore((s) => s.addCategoryRule);
  const addCategory = useAppStore((s) => s.addCategory);
  const markReviewed = useAppStore((s) => s.markReviewed);
  const reviewMany = useAppStore((s) => s.reviewMany);

  const live = useMemo(() => {
    const rows = transactions.filter((tx) => !tx.deletedAt);
    if (!focused) return rows;

    return rows.filter(
      (tx) =>
        matchesCategorySelection(tx.categoryId, focusIds) &&
        (!params.from || tx.date >= params.from) &&
        (!params.to || tx.date <= params.to)
    );
  }, [transactions, focused, focusIds, params.from, params.to]);
  const unreviewed = useMemo(() => live.filter((tx) => !tx.reviewed), [live]);

  const outCount = unreviewed.filter((tx) => tx.amountMinor < 0).length;
  const inCount = unreviewed.filter((tx) => tx.amountMinor > 0).length;
  const unreviewedCount = outCount + inCount;

  /** In the queue right now: still unreviewed, or filed but not yet cleared. */
  const inQueue = useMemo(
    () => live.filter((tx) => !tx.reviewed || justFiled.has(tx.id)),
    [live, justFiled]
  );

  const queueForDirection = useMemo(
    () =>
      inQueue.filter((tx) => (direction === 'in' ? tx.amountMinor > 0 : tx.amountMinor <= 0)),
    [inQueue, direction]
  );

  /** Unreviewed rows in this direction that already carry a suggestion. */
  const suggested = useMemo(
    () => queueForDirection.filter((tx) => !tx.reviewed && isFiled(tx.categoryId)),
    [queueForDirection]
  );

  const filedCount = queueForDirection.filter((tx) => justFiled.has(tx.id)).length;

  const sections = useMemo(() => {
    const needle = normaliseMerchant(query);
    const base = filter === 'review' ? queueForDirection : live;
    const rows = base
      .filter((tx) =>
        needle
          ? normaliseMerchant(`${tx.merchant} ${tx.rawDescription ?? ''} ${tx.note ?? ''}`).includes(needle)
          : true
      )
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 300);

    const byDay = new Map<string, Transaction[]>();
    for (const tx of rows) {
      const list = byDay.get(tx.date) ?? [];
      list.push(tx);
      byDay.set(tx.date, list);
    }
    return [...byDay.entries()].map(([date, data]) => ({ title: date, data }));
  }, [filter, query, queueForDirection, live]);

  /** Other unreviewed rows that are the same counterparty and direction. */
  function siblingsOf(tx: Transaction): Transaction[] {
    const key = groupKey(tx.rawDescription || tx.merchant, tx.amountMinor > 0, merchantKey);
    return unreviewed.filter(
      (other) =>
        other.id !== tx.id &&
        groupKey(other.rawDescription || other.merchant, other.amountMinor > 0, merchantKey) === key
    );
  }

  function remember(ids: string[]) {
    setJustFiled((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }

  async function pickCategory(tx: Transaction, categoryId: string, applyToAll: boolean) {
    const siblings = applyToAll ? siblingsOf(tx) : [];
    setPicking(null);

    const proposedRule = await categoriseTransaction(tx.id, categoryId);
    if (siblings.length > 0) {
      await reviewMany(
        siblings.map((other) => other.id),
        categoryId
      );
    }
    remember([tx.id, ...siblings.map((other) => other.id)]);

    // Second identical correction for a merchant: make it permanent so the
    // review queue actually shrinks over time instead of resetting each import.
    if (proposedRule) {
      const { id, ...rest } = proposedRule;
      await addCategoryRule(rest);
    }
  }

  async function acceptAllSuggestions() {
    const ids = suggested.map((tx) => tx.id);
    if (ids.length === 0) return;
    await reviewMany(ids);
    remember(ids);
  }

  async function keepAsIs(tx: Transaction) {
    await markReviewed(tx.id);
    remember([tx.id]);
  }

  const pickingSiblings = picking ? siblingsOf(picking) : [];

  return (
    <View style={{ flex: 1, backgroundColor: c.canvas, paddingTop: insets.top + sp.md }}>
      <View style={{ paddingHorizontal: sp.lg, paddingBottom: sp.md }}>
        {focused ? (
          <Pressable
            onPress={() => router.setParams({ category: '', from: '', to: '', label: '' })}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: c.accentSubtle,
              borderRadius: r.md,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: c.accent,
              paddingHorizontal: sp.md,
              paddingVertical: sp.sm,
              marginBottom: sp.md,
            }}
            accessibilityRole="button"
            accessibilityLabel="Clear category filter"
          >
            <Ionicons name="funnel" size={13} color={c.accent} />
            <View style={{ flex: 1, marginLeft: sp.sm }}>
              <Text style={[t.caption, { color: c.accent }]} numberOfLines={1}>
                {params.label || 'Filtered'}
              </Text>
              <Text style={[t.micro, { color: c.textMuted }]}>
                {live.length} transaction{live.length === 1 ? '' : 's'}
                {params.from && params.to
                  ? ` · ${formatDate(params.from, 'short')} – ${formatDate(params.to, 'short')}`
                  : ''}
              </Text>
            </View>
            <Ionicons name="close-circle" size={16} color={c.accent} />
          </Pressable>
        ) : null}

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: c.surface,
            borderRadius: r.md,
            paddingHorizontal: sp.md,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
          }}
        >
          <Ionicons name="search" size={16} color={c.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search merchants and notes"
            placeholderTextColor={c.textMuted}
            style={[t.body, { color: c.textPrimary, flex: 1, paddingVertical: sp.md, marginLeft: sp.sm }]}
            accessibilityLabel="Search transactions"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10}>
              <Ionicons name="close-circle" size={16} color={c.textMuted} />
            </Pressable>
          ) : null}
        </View>

        <View style={{ flexDirection: 'row', marginTop: sp.md }}>
          <FilterChip label="All" active={filter === 'all'} onPress={() => setFilter('all')} />
          <View style={{ width: sp.sm }} />
          <FilterChip
            label={`Needs review${unreviewedCount ? ` (${unreviewedCount})` : ''}`}
            active={filter === 'review'}
            onPress={() => setFilter('review')}
          />
        </View>

        {filter === 'review' ? (
          <>
            {/* Money out and money in are different questions, so different queues. */}
            <View style={{ flexDirection: 'row', marginTop: sp.md }}>
              <FilterChip
                label={`Money out${outCount ? ` (${outCount})` : ''}`}
                active={direction === 'out'}
                onPress={() => setDirection('out')}
              />
              <View style={{ width: sp.sm }} />
              <FilterChip
                label={`Money in${inCount ? ` (${inCount})` : ''}`}
                active={direction === 'in'}
                onPress={() => setDirection('in')}
              />
            </View>

            {suggested.length > 0 ? (
              <View style={{ marginTop: sp.md }}>
                <Button
                  label={`Accept ${suggested.length} suggested categor${suggested.length === 1 ? 'y' : 'ies'}`}
                  variant="secondary"
                  icon="✓"
                  onPress={acceptAllSuggestions}
                />
              </View>
            ) : null}

            {filedCount > 0 ? (
              <Pressable
                onPress={() => setJustFiled(new Set())}
                hitSlop={8}
                style={{ marginTop: sp.md, flexDirection: 'row', alignItems: 'center' }}
              >
                <Ionicons name="checkmark-done" size={14} color={c.accent} />
                <Text style={[t.micro, { color: c.accent, marginLeft: 6 }]}>
                  Clear {filedCount} filed row{filedCount === 1 ? '' : 's'} from this list
                </Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        renderSectionHeader={({ section }) => (
          <View style={{ backgroundColor: c.canvas, paddingHorizontal: sp.lg, paddingVertical: sp.sm }}>
            <Text style={[t.micro, { color: c.textMuted }]}>
              {relativeDate(section.title, today()).toUpperCase()}
            </Text>
          </View>
        )}
        renderItem={({ item }) => {
          const category = categories.find((cat) => cat.id === item.categoryId);
          const filed = justFiled.has(item.id);

          return (
            <View>
              <Pressable
                onPress={() =>
                  item.reviewed && !filed
                    ? router.push({ pathname: '/transaction/new', params: { id: item.id } })
                    : setPicking(item)
                }
                style={({ pressed }) => [
                  styles.row,
                  { paddingHorizontal: sp.lg, paddingVertical: sp.md, opacity: pressed ? 0.6 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${item.merchant}, ${category?.name ?? 'uncategorised'}`}
              >
                <View
                  style={[
                    styles.icon,
                    { backgroundColor: filed ? c.accentSubtle : c.surfaceSunken },
                  ]}
                >
                  <Text style={{ fontSize: 16 }}>{category?.icon ?? '❓'}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: sp.md }}>
                  <Text style={[t.body, { color: c.textPrimary }]} numberOfLines={1}>
                    {item.merchant}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                    <Text style={[t.micro, { color: c.textMuted, marginRight: 6 }]}>
                      {category?.name ?? 'Uncategorised'}
                    </Text>
                    {filed ? (
                      <Pill label="Filed" tone="good" />
                    ) : !item.reviewed ? (
                      <Pill label="Review" tone="warning" />
                    ) : null}
                  </View>
                </View>
                <AmountText
                  value={money(item.amountMinor, item.currency)}
                  size="body"
                  color={amountColor(c, item.amountMinor)}
                  signed={item.amountMinor > 0}
                />
              </Pressable>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={{ padding: sp.xxl, alignItems: 'center' }}>
            <Ionicons name="receipt-outline" size={32} color={c.textMuted} />
            <Text style={[t.body, { color: c.textMuted, marginTop: sp.md, textAlign: 'center' }]}>
              {query
                ? 'Nothing matches that search.'
                : focused
                  ? 'Nothing in that category for this period.'
                  : filter === 'review'
                    ? `Nothing to review in money ${direction}.`
                    : 'No transactions yet.'}
            </Text>
            {!query && filter === 'all' ? (
              <View style={{ marginTop: sp.lg }}>
                <Button label="Add your first one" onPress={() => router.push('/transaction/new')} />
              </View>
            ) : null}
          </View>
        }
      />

      {picking ? (
        <CategorySheet
          visible
          title={picking.merchant}
          subtitle={`${formatMoney(money(picking.amountMinor, picking.currency))} · ${relativeDate(picking.date, today())}`}
          kind={picking.amountMinor > 0 ? 'income' : 'expense'}
          categories={categories}
          alsoCount={pickingSiblings.length}
          alsoLabel={describeGroup(
            picking.rawDescription || picking.merchant,
            picking.amountMinor > 0
          )}
          onClose={() => setPicking(null)}
          onPick={(categoryId, applyToAll) => {
            const target = picking;
            if (target) void pickCategory(target, categoryId, applyToAll);
          }}
          onCreate={(name, kind) => addCategory({ name, kind })}
          onKeepAsIs={() => {
            const target = picking;
            setPicking(null);
            if (target) void keepAsIs(target);
          }}
        />
      ) : null}

      {/* Floating add button — the action people take most often. */}
      <Pressable
        onPress={() => router.push('/transaction/new')}
        accessibilityRole="button"
        accessibilityLabel="Add transaction"
        style={({ pressed }) => ({
          position: 'absolute',
          right: sp.lg,
          bottom: insets.bottom + sp.lg,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: c.accent,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <Ionicons name="add" size={28} color={c.onAccent} />
      </Pressable>
    </View>
  );
}

function FilterChip({
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

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
});
