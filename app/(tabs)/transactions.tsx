import React, { useMemo, useState } from 'react';
import { View, Text, SectionList, Pressable, TextInput, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../src/theme/ThemeProvider';
import { AmountText, Pill, Button } from '../../src/components/ui/Primitives';
import { amountColor } from '../../src/theme/tokens';
import { money } from '../../src/core/money';
import { relativeDate, today } from '../../src/core/dates';
import { useAppStore } from '../../src/store/useAppStore';
import { normaliseMerchant } from '../../src/core/categorize';
import type { Transaction } from '../../src/core/types';

type Filter = 'all' | 'unreviewed';

/**
 * Activity list.
 *
 * Grouped by day, newest first. "Needs review" is the queue the ingestion
 * pipeline feeds — everything captured automatically but not yet confirmed.
 *
 * An unreviewed row expands in place into a category picker rather than pushing
 * a screen: confirming forty imported transactions should be forty taps, not
 * forty round trips through a navigation stack.
 */
export default function TransactionsScreen() {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const transactions = useAppStore((s) => s.transactions);
  const categories = useAppStore((s) => s.categories);
  const categoriseTransaction = useAppStore((s) => s.categoriseTransaction);
  const addCategoryRule = useAppStore((s) => s.addCategoryRule);
  const markReviewed = useAppStore((s) => s.markReviewed);

  const unreviewedCount = transactions.filter((tx) => !tx.reviewed && !tx.deletedAt).length;

  const sections = useMemo(() => {
    const needle = normaliseMerchant(query);
    const rows = transactions
      .filter((tx) => !tx.deletedAt)
      .filter((tx) => (filter === 'unreviewed' ? !tx.reviewed : true))
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
  }, [filter, query, transactions]);

  const quickCategories = useMemo(
    () => categories.filter((cat) => !cat.archived && cat.kind === 'expense').slice(0, 10),
    [categories]
  );

  async function pickCategory(tx: Transaction, categoryId: string) {
    const proposedRule = await categoriseTransaction(tx.id, categoryId);
    setExpandedId(null);
    // Second identical correction for a merchant: make it permanent so the
    // review queue actually shrinks over time instead of resetting each import.
    if (proposedRule) {
      const { id, ...rest } = proposedRule;
      await addCategoryRule(rest);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.canvas, paddingTop: insets.top + sp.md }}>
      <View style={{ paddingHorizontal: sp.lg, paddingBottom: sp.md }}>
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
            active={filter === 'unreviewed'}
            onPress={() => setFilter('unreviewed')}
          />
        </View>
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
          const expanded = expandedId === item.id;
          return (
            <View>
              <Pressable
                onPress={() =>
                  item.reviewed
                    ? router.push({ pathname: '/transaction/new', params: { id: item.id } })
                    : setExpandedId(expanded ? null : item.id)
                }
                style={({ pressed }) => [
                  styles.row,
                  { paddingHorizontal: sp.lg, paddingVertical: sp.md, opacity: pressed ? 0.6 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${item.merchant}, ${category?.name ?? 'uncategorised'}`}
              >
                <View style={[styles.icon, { backgroundColor: c.surfaceSunken }]}>
                  <Text style={{ fontSize: 16 }}>{category?.icon ?? '？'}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: sp.md }}>
                  <Text style={[t.body, { color: c.textPrimary }]} numberOfLines={1}>
                    {item.merchant}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                    <Text style={[t.micro, { color: c.textMuted, marginRight: 6 }]}>
                      {category?.name ?? 'Uncategorised'}
                    </Text>
                    {!item.reviewed ? <Pill label="Review" tone="warning" /> : null}
                  </View>
                </View>
                <AmountText
                  value={money(item.amountMinor, item.currency)}
                  size="body"
                  color={amountColor(c, item.amountMinor)}
                  signed={item.amountMinor > 0}
                />
              </Pressable>

              {expanded ? (
                <View
                  style={{
                    paddingHorizontal: sp.lg,
                    paddingBottom: sp.lg,
                    backgroundColor: c.surface,
                  }}
                >
                  <Text style={[t.micro, { color: c.textMuted, marginBottom: sp.sm }]}>
                    FILE IT AS
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    {quickCategories.map((cat) => (
                      <Pressable
                        key={cat.id}
                        onPress={() => pickCategory(item, cat.id)}
                        style={{
                          paddingHorizontal: sp.md,
                          paddingVertical: sp.sm,
                          borderRadius: r.pill,
                          backgroundColor:
                            cat.id === item.categoryId ? c.accentSubtle : c.surfaceSunken,
                          marginRight: sp.sm,
                          marginBottom: sp.sm,
                        }}
                      >
                        <Text
                          style={[
                            t.caption,
                            { color: cat.id === item.categoryId ? c.accent : c.textSecondary },
                          ]}
                        >
                          {cat.icon} {cat.name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={{ flexDirection: 'row', marginTop: sp.xs }}>
                    <Pressable onPress={() => markReviewed(item.id)} hitSlop={8} style={{ marginRight: sp.xl }}>
                      <Text style={[t.micro, { color: c.accent }]}>Keep as is</Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        router.push({ pathname: '/transaction/new', params: { id: item.id } })
                      }
                      hitSlop={8}
                    >
                      <Text style={[t.micro, { color: c.accent }]}>Edit details</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={{ padding: sp.xxl, alignItems: 'center' }}>
            <Ionicons name="receipt-outline" size={32} color={c.textMuted} />
            <Text style={[t.body, { color: c.textMuted, marginTop: sp.md, textAlign: 'center' }]}>
              {query
                ? 'Nothing matches that search.'
                : filter === 'unreviewed'
                  ? 'Nothing to review — everything is filed.'
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
