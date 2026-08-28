import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  SectionList,
  FlatList,
  ScrollView,
  Pressable,
  TextInput,
  StyleSheet,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/theme/ThemeProvider';
import { columnsFor, useLayout } from '../../src/theme/layout';
import { useEnter, usePressScale } from '../../src/theme/motion';
import { AmountText, Pill, Button } from '../../src/components/ui/Primitives';
import { CategorySheet } from '../../src/components/CategorySheet';
import { Mascot } from '../../src/components/art/Mascot';
import { Spot } from '../../src/components/art/Spot';
import { amountColor } from '../../src/theme/tokens';
import { formatMoney, money } from '../../src/core/money';
import { formatDate, relativeDate, today } from '../../src/core/dates';
import { useAppStore } from '../../src/store/useAppStore';
import { isFiled, merchantKey, normaliseMerchant } from '../../src/core/categorize';
import { matchesCategorySelection } from '../../src/core/analytics';
import {
  ScrollRow,
  SegmentedControl,
  StatRow,
  StatTile,
  type TileTone,
} from '../../src/components/ui/Tiles';
import {
  describeGroup,
  groupKey,
  groupTitle,
  readCounterparty,
  type GroupMode,
} from '../../src/core/counterparty';
import type { Transaction } from '../../src/core/types';

type Filter = 'all' | 'review';
type Direction = 'out' | 'in';

/**
 * What a bulk decision can be about.
 *
 * Four is one too many for a segmented track on a narrow phone, so this stays a
 * sideways row. Declared once at module scope because the labels are fixed and
 * rebuilding the array on every render was allocating four objects per keypress
 * in the search field.
 */
const GROUP_MODES: Array<{ value: GroupMode | 'off'; label: string }> = [
  { value: 'account', label: 'Account' },
  { value: 'person', label: 'Name' },
  { value: 'note', label: 'Note' },
  { value: 'off', label: 'One by one' },
];

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
  const layout = useLayout();
  /** Two across on a phone, four on a desktop. */
  const queueColumns = columnsFor(layout, 4);
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
  /**
   * What a bulk decision is *about*.
   *
   * Defaults to the account number, which is the only truly stable identity: a
   * name can be spelled three ways and two people can share one. The note
   * ("milk", "gas", "fare") describes the purpose for whoever received the
   * money, not for the person filing it — sending a friend money for milk is
   * not the sender's groceries. So it is offered, and it is not the default.
   */
  const [groupMode, setGroupMode] = useState<GroupMode | 'off'>('account');
  const [query, setQuery] = useState('');
  /** Search costs a row of height on every visit and is wanted on few of them. */
  const [searching, setSearching] = useState(false);
  const [picking, setPicking] = useState<Transaction | null>(null);
  const [pickingGroup, setPickingGroup] = useState<ReviewGroup | null>(null);

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

  interface ReviewGroup {
    key: string;
    title: string;
    subtitle: string;
    rows: Transaction[];
    totalMinor: number;
    /** Every row already filed — the whole card is done. */
    done: boolean;
  }

  /** The queue, bundled by whatever the user chose to bundle it by. */
  const groups = useMemo<ReviewGroup[]>(() => {
    if (groupMode === 'off') return [];

    const needle = normaliseMerchant(query);
    const buckets = new Map<string, Transaction[]>();

    for (const tx of queueForDirection) {
      if (
        needle &&
        !normaliseMerchant(`${tx.merchant} ${tx.rawDescription ?? ''} ${tx.note ?? ''}`).includes(needle)
      ) {
        continue;
      }
      const raw = tx.rawDescription || tx.merchant;
      const key = groupKey(raw, tx.amountMinor > 0, merchantKey, groupMode);
      const list = buckets.get(key) ?? [];
      list.push(tx);
      buckets.set(key, list);
    }

    return [...buckets.entries()]
      .map(([key, rows]) => {
        const raw = rows[0].rawDescription || rows[0].merchant;
        const counterparty = readCounterparty(raw);
        const account = counterparty?.account;

        return {
          key,
          title: groupTitle(raw, groupMode) || rows[0].merchant,
          subtitle: [
            groupMode !== 'note' && account ? account : null,
            `${rows.length} transaction${rows.length === 1 ? '' : 's'}`,
          ]
            .filter(Boolean)
            .join(' · '),
          rows,
          totalMinor: rows.reduce((sum, r) => sum + r.amountMinor, 0),
          done: rows.every((r) => justFiled.has(r.id)),
        };
      })
      // Biggest first: the group worth a decision is the one with the most
      // money or the most rows behind it.
      .sort((a, b) => Math.abs(b.totalMinor) - Math.abs(a.totalMinor));
  }, [groupMode, queueForDirection, query, justFiled]);

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

  /** How many rows the day list is actually showing, after search and filter. */
  const sectionRowCount = useMemo(
    () => sections.reduce((sum, section) => sum + section.data.length, 0),
    [sections]
  );

  /**
   * What the visible set adds up to, both directions.
   *
   * Taken from `live` rather than from the day list, because the list is capped
   * at 300 rows for scrolling and a total that silently stops counting at 300
   * is exactly the kind of plausible wrong number this app has been bitten by.
   */
  const periodTotals = useMemo(() => {
    let outMinor = 0;
    let inMinor = 0;
    let outCount = 0;
    let inCount = 0;
    for (const tx of live) {
      if (tx.amountMinor < 0) {
        outMinor += -tx.amountMinor;
        outCount += 1;
      } else if (tx.amountMinor > 0) {
        inMinor += tx.amountMinor;
        inCount += 1;
      }
    }
    return { outMinor, inMinor, outCount, inCount };
  }, [live]);

  /** One statement, one currency in practice; the first row decides the label. */
  const currency = live[0]?.currency ?? 'NGN';

  /** Other unreviewed rows that are the same counterparty and direction. */
  function siblingsOf(tx: Transaction): Transaction[] {
    const mode: GroupMode = groupMode === 'off' ? 'account' : groupMode;
    const key = groupKey(tx.rawDescription || tx.merchant, tx.amountMinor > 0, merchantKey, mode);
    return unreviewed.filter(
      (other) =>
        other.id !== tx.id &&
        groupKey(other.rawDescription || other.merchant, other.amountMinor > 0, merchantKey, mode) ===
          key
    );
  }

  /** File an entire group in one write. */
  async function fileGroup(group: ReviewGroup, categoryId: string) {
    setPickingGroup(null);
    const ids = group.rows.map((r) => r.id);
    await reviewMany(ids, categoryId);
    remember(ids);

    // Teach the rule engine from the first row, so next month's import of the
    // same person is already filed before it reaches the queue.
    const first = group.rows[0];
    const proposedRule = await categoriseTransaction(first.id, categoryId);
    if (proposedRule) {
      const { id, ...rest } = proposedRule;
      await addCategoryRule(rest);
    }
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
    <View style={{ flex: 1, backgroundColor: c.canvas }}>
      {/*
        The canvas runs edge to edge; the content does not.

        This screen is a list rather than a scroll view, so it never had the
        maxWidth every other page carried — on a desktop that meant transaction
        rows 1900pt wide, with the merchant at one end and the amount at the
        other and nothing pairing them. The outer view keeps the background
        full-bleed so the page still fills the window; the inner one holds the
        readable column.
      */}
      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: layout.maxWidth,
          alignSelf: 'center',
          paddingTop: insets.top + sp.md,
        }}
      >
      <View style={{ paddingHorizontal: layout.gutter, paddingBottom: sp.md }}>
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

        {/*
          Two figures across, before anything else.

          The screen used to open on a search box, then two chip rows, then a
          group-by row, then a button — five stacked full-width controls before
          a single number. Nobody arrives at their own transaction list wanting
          to filter it; they arrive wanting to know what the month did. So the
          answer comes first and the controls come after.
        */}
        <StatRow>
          <StatTile
            index={0}
            label="Money out"
            value={formatMoney(money(-periodTotals.outMinor, currency))}
            caption={`${periodTotals.outCount} payment${periodTotals.outCount === 1 ? '' : 's'}`}
          />
          <StatTile
            index={1}
            label="Money in"
            value={formatMoney(money(periodTotals.inMinor, currency))}
            caption={`${periodTotals.inCount} payment${periodTotals.inCount === 1 ? '' : 's'}`}
          />
        </StatRow>

        {/* One choice out of two, as a track — not two chips that look
            combinable. The count rides as a badge so the label stays short. */}
        <View style={{ marginTop: sp.md }}>
          <SegmentedControl<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'review', label: 'Needs review', badge: unreviewedCount },
            ]}
          />
        </View>

        {/*
          Search is a toggle, not a permanent fixture.

          A search field costs a full row of height on every visit, and it is
          used on a small minority of them. Behind an icon it costs nothing
          until it is wanted, and the row it frees is what makes room for the
          figures above.
        */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: sp.md }}>
          {searching ? (
            <View
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: c.surface,
                borderRadius: r.md,
                paddingHorizontal: sp.md,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: c.border,
              }}
            >
              <Ionicons name="search" size={15} color={c.textMuted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                autoFocus
                placeholder="Search merchants and notes"
                placeholderTextColor={c.textMuted}
                style={[
                  t.body,
                  { color: c.textPrimary, flex: 1, paddingVertical: sp.sm, marginLeft: sp.sm },
                ]}
                accessibilityLabel="Search transactions"
              />
              <Pressable
                onPress={() => {
                  setQuery('');
                  setSearching(false);
                }}
                hitSlop={10}
              >
                <Ionicons name="close-circle" size={16} color={c.textMuted} />
              </Pressable>
            </View>
          ) : (
            <>
              <Pressable
                onPress={() => setSearching(true)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Search transactions"
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 4,
                  paddingRight: sp.md,
                }}
              >
                <Ionicons name="search" size={15} color={c.textMuted} />
                <Text style={[t.micro, { color: c.textMuted, marginLeft: 5 }]}>
                  {query ? `“${query}”` : 'Search'}
                </Text>
              </Pressable>

              <View style={{ flex: 1 }} />

              {filter === 'review' && filedCount > 0 ? (
                <Pressable
                  onPress={() => setJustFiled(new Set())}
                  hitSlop={8}
                  style={{ flexDirection: 'row', alignItems: 'center' }}
                >
                  <Ionicons name="checkmark-done" size={13} color={c.accent} />
                  <Text style={[t.micro, { color: c.accent, marginLeft: 5 }]}>
                    Clear {filedCount} filed
                  </Text>
                </Pressable>
              ) : filter === 'all' ? (
                <Text style={[t.micro, { color: c.textMuted }]}>
                  {sectionRowCount} shown
                </Text>
              ) : null}
            </>
          )}
        </View>

        {filter === 'review' ? (
          <>
            {/* Money out and money in are different questions, so different
                queues — and a track says "one of these", where two chips said
                "combine as you like". */}
            <View style={{ marginTop: sp.md }}>
              <SegmentedControl<Direction>
                value={direction}
                onChange={setDirection}
                options={[
                  { value: 'out', label: 'Out', badge: outCount },
                  { value: 'in', label: 'In', badge: inCount },
                ]}
              />
            </View>

            {/*
              What a bulk decision is about.

              Four choices is one too many for a track on a narrow phone, so
              this stays a sideways row — but it is now a labelled row that
              bleeds off the edge rather than four chips wrapping to two lines.
            */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginTop: sp.md, marginHorizontal: -sp.lg }}
              contentContainerStyle={{ alignItems: 'center', paddingHorizontal: sp.lg }}
            >
              <Text style={[t.micro, { color: c.textMuted, marginRight: sp.sm }]}>GROUP BY</Text>
              {GROUP_MODES.map((mode, i) => (
                <View key={mode.value} style={{ marginLeft: i === 0 ? 0 : sp.sm }}>
                  <FilterChip
                    label={mode.label}
                    active={groupMode === mode.value}
                    onPress={() => setGroupMode(mode.value)}
                  />
                </View>
              ))}
            </ScrollView>

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
          </>
        ) : null}
      </View>

      {filter === 'review' && groupMode !== 'off' ? (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.key}
          keyboardShouldPersistTaps="handled"
          /*
            Two across.

            A queue of counterparties is a set of choices, not a ledger, and a
            single column of identical cards makes forty choices look like one
            long document you are meant to read. In pairs they read as things to
            pick between, and twice as many fit above the fold — which on a
            sixty-nine row queue is the difference between scrolling and seeing.
          */
          numColumns={queueColumns}
          /* FlatList builds its cell structure once per numColumns, so it has
             to be remounted when the window crosses a breakpoint. Without the
             key it keeps the old column count and the rows overlap. */
          key={`queue-${queueColumns}`}
          columnWrapperStyle={{ marginHorizontal: -sp.sm / 2 }}
          contentContainerStyle={{
            paddingHorizontal: layout.gutter,
            paddingBottom: insets.bottom + 96,
          }}
          renderItem={({ item, index }) => (
            // maxWidth caps the last card when the count is odd. With flex
            // alone a lone final group stretched to the full width and stopped
            // looking like a member of the grid it belongs to.
            <View
              style={{
                flex: 1,
                maxWidth: `${100 / queueColumns}%`,
                paddingHorizontal: sp.sm / 2,
              }}
            >
              <GroupCard
                group={item}
                index={index}
                currency={item.rows[0].currency}
                category={categories.find((cat) => cat.id === item.rows[0].categoryId)}
                onPress={() => setPickingGroup(item)}
              />
            </View>
          )}
          ListEmptyComponent={
            <View style={{ padding: sp.xxl, alignItems: 'center' }}>
              <Mascot pose="celebrate" size={104} />
              <Text style={[t.body, { color: c.textMuted, marginTop: sp.md, textAlign: 'center' }]}>
                {query ? 'Nothing matches that search.' : `Nothing to review in money ${direction}.`}
              </Text>
            </View>
          }
        />
      ) : (
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        renderSectionHeader={({ section }) => {
          /*
            A day heading with the day's net beside it.

            A sticky bar carrying nothing but a date is furniture — it divides
            the list without telling you anything, so the list still reads as
            one undifferentiated column. The day's own total turns each heading
            into a landmark, and scrolling becomes a way of finding the
            expensive days rather than just moving through rows.
          */
          const net = section.data.reduce((sum, tx) => sum + tx.amountMinor, 0);
          return (
            <View
              style={{
                backgroundColor: c.canvas,
                paddingHorizontal: layout.gutter,
                paddingVertical: sp.sm,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Text style={[t.micro, { color: c.textMuted }]}>
                {relativeDate(section.title, today()).toUpperCase()}
              </Text>
              <Text
                style={[
                  t.micro,
                  { color: c.textMuted, fontVariant: ['tabular-nums'] },
                ]}
              >
                {formatMoney(money(net, section.data[0].currency))}
              </Text>
            </View>
          );
        }}
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
                  {
                    paddingHorizontal: layout.gutter,
                    paddingVertical: sp.md,
                    opacity: pressed ? 0.6 : 1,
                  },
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
            <Spot name="inbox" size={104} tone="violet" />
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
      )}

      {pickingGroup ? (
        <CategorySheet
          visible
          title={pickingGroup.title}
          subtitle={`${pickingGroup.subtitle} · ${formatMoney(
            money(pickingGroup.totalMinor, pickingGroup.rows[0].currency)
          )}`}
          kind={pickingGroup.totalMinor > 0 ? 'income' : 'expense'}
          categories={categories}
          onClose={() => setPickingGroup(null)}
          onPick={(categoryId) => {
            const target = pickingGroup;
            if (target) void fileGroup(target, categoryId);
          }}
          onCreate={(name, kind) => addCategory({ name, kind })}
        />
      ) : null}

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

      </View>

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

/**
 * A stable colour per group.
 *
 * Hashing the key means the same person is the same colour on every visit and
 * on every device — a colour that shuffles on each render is worse than no
 * colour, because the eye learns it and then it lies.
 */
const TONES: TileTone[] = ['violet', 'blue', 'teal', 'green', 'amber', 'pink'];
function toneFor(key: string): TileTone {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return TONES[hash % TONES.length];
}

/**
 * One decision, standing for many transactions.
 *
 * The count and the total are both on the card because they answer different
 * questions: twelve transfers is a chore, ₦86,000 is a chunk of the month.
 * Seeing both before choosing is the difference between filing blind and
 * filing deliberately.
 *
 * Laid out as a tile rather than a row because two of these sit across the
 * screen. A wide row forced everything onto one line and put the amount at the
 * far right, so reading a name and its total meant a saccade across the whole
 * display; stacked in a column, both land in one glance and forty groups stop
 * looking like a document.
 */
function GroupCard({
  group,
  index,
  currency,
  category,
  onPress,
}: {
  group: {
    key: string;
    title: string;
    subtitle: string;
    rows: unknown[];
    totalMinor: number;
    done: boolean;
  };
  index: number;
  currency: string;
  category?: { icon: string; name: string };
  onPress: () => void;
}) {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const enter = useEnter(index);
  const press = usePressScale();
  const tone = c.tile[toneFor(group.key)];

  return (
    <Animated.View style={[enter, { marginTop: sp.sm }]}>
      <Animated.View style={press.style}>
        <Pressable
          onPress={onPress}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          accessibilityRole="button"
          accessibilityLabel={`${group.title}, ${group.subtitle}. File them together.`}
          style={{
            backgroundColor: group.done ? c.accentSubtle : c.surface,
            borderRadius: r.lg,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: group.done ? c.accent : c.border,
            padding: sp.md,
            minHeight: 132,
            justifyContent: 'space-between',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            {/* The initial in the group's own colour. A column of grey question
                marks is the same card twelve times; a column of coloured
                initials is a list of people. */}
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: group.done ? c.accentSubtle : tone.bg,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: group.done ? c.accent : tone.border,
              }}
            >
              {group.done ? (
                <Text style={{ fontSize: 15 }}>✓</Text>
              ) : category?.icon ? (
                <Text style={{ fontSize: 15 }}>{category.icon}</Text>
              ) : (
                <Text style={[t.bodyStrong, { color: tone.tag }]}>
                  {group.title.trim().charAt(0).toUpperCase() || '?'}
                </Text>
              )}
            </View>

            <View style={{ flex: 1 }} />

            <Text style={[t.micro, { color: c.accent }]}>{group.done ? 'Change' : 'File all'}</Text>
          </View>

          <View style={{ marginTop: sp.sm }}>
            <Text style={[t.caption, { color: c.textPrimary }]} numberOfLines={2}>
              {group.title}
            </Text>
            <Text style={[t.micro, { color: c.textMuted, marginTop: 2 }]} numberOfLines={1}>
              {group.done && category ? `Filed as ${category.name}` : group.subtitle}
            </Text>
          </View>

          <View style={{ marginTop: sp.sm }}>
            <AmountText
              value={money(group.totalMinor, currency)}
              size="body"
              color={amountColor(c, group.totalMinor)}
              signed={group.totalMinor > 0}
            />
          </View>
        </Pressable>
      </Animated.View>
    </Animated.View>
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
