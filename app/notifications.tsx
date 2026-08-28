/**
 * The notifications centre.
 *
 * Everything Finlo noticed, in the order it happened. The alerts this app could
 * already raise went out as OS notifications, which is the right place for
 * something urgent and the wrong place for anything you might want to look up
 * later — a dismissed notification is gone, and there was nowhere in the app
 * that remembered a budget had gone over last Tuesday.
 *
 * The feed is derived rather than stored (see `core/notifications`), so a
 * deleted transaction takes its alert with it instead of leaving a ghost.
 * The only persisted state is which ids have been read.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../src/theme/ThemeProvider';
import { Screen, Grid } from '../src/components/ui/Screen';
import { Card, SectionHeader } from '../src/components/ui/Primitives';
import { SegmentedControl } from '../src/components/ui/Tiles';
import { Spot } from '../src/components/art/Spot';
import { useAppStore } from '../src/store/useAppStore';
import { allBudgetStatuses } from '../src/core/budget';
import { excludedCategoryIds } from '../src/core/analytics';
import { relativeDate, today } from '../src/core/dates';
import {
  READ_NOTICES_KEY,
  buildNotices,
  parseReadIds,
  serialiseReadIds,
  type Notice,
  type NoticeKind,
} from '../src/core/notifications';

type Filter = 'all' | 'unread' | 'alerts';

const KIND_GLYPH: Record<NoticeKind, string> = {
  budget: '💜',
  bill: '📅',
  unusual: '👀',
  import: '📄',
  review: '🗂️',
};

export default function NotificationsScreen() {
  const { c, type: t, space: sp, radius: r } = useTheme();

  const transactions = useAppStore((s) => s.transactions);
  const categories = useAppStore((s) => s.categories);
  const budgets = useAppStore((s) => s.budgets);
  const recurringRules = useAppStore((s) => s.recurringRules);
  const settings = useAppStore((s) => s.settings);
  const setSetting = useAppStore((s) => s.setSetting);

  const asOf = today();
  const [filter, setFilter] = useState<Filter>('all');

  const budgetStatuses = useMemo(
    () =>
      allBudgetStatuses(budgets, {
        transactions,
        excludedCategoryIds: excludedCategoryIds(categories),
        asOf,
      }),
    [budgets, transactions, categories, asOf]
  );

  const notices = useMemo(
    () => buildNotices({ transactions, budgetStatuses, recurringRules, asOf }),
    [transactions, budgetStatuses, recurringRules, asOf]
  );

  const read = useMemo(
    () => parseReadIds(settings[READ_NOTICES_KEY]),
    [settings]
  );

  const unread = notices.filter((n) => !read.has(n.id));

  const shown = useMemo(() => {
    if (filter === 'unread') return unread;
    if (filter === 'alerts') {
      return notices.filter((n) => n.severity === 'critical' || n.severity === 'warning');
    }
    return notices;
  }, [filter, notices, unread]);

  const markAllRead = () =>
    void setSetting(READ_NOTICES_KEY, serialiseReadIds([...read, ...notices.map((n) => n.id)]));

  const open = (notice: Notice) => {
    void setSetting(READ_NOTICES_KEY, serialiseReadIds([...read, notice.id]));
    if (notice.action) {
      router.push({
        pathname: notice.action.route as never,
        params: notice.action.params as never,
      });
    }
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={24} color={c.textPrimary} />
          </Pressable>
          <Text style={[t.title, { color: c.textPrimary, marginLeft: sp.sm }]}>Notifications</Text>
        </View>

        {unread.length > 0 ? (
          <Pressable onPress={markAllRead} hitSlop={10} accessibilityRole="button">
            <Text style={[t.caption, { color: c.accent }]}>Mark all read</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={{ marginTop: sp.md }}>
        <SegmentedControl<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'unread', label: 'Unread', badge: unread.length },
            { value: 'alerts', label: 'Alerts' },
          ]}
        />
      </View>

      {shown.length === 0 ? (
        <Card style={{ marginTop: sp.xl }}>
          <View style={{ alignItems: 'center', paddingVertical: sp.lg }}>
            <Spot name="inbox" size={104} tone="blue" />
            <Text style={[t.heading, { color: c.textPrimary, marginTop: sp.md }]}>
              {filter === 'unread' ? 'Nothing unread' : 'Nothing to report'}
            </Text>
            <Text
              style={[
                t.caption,
                { color: c.textMuted, marginTop: sp.xs, textAlign: 'center', maxWidth: 320 },
              ]}
            >
              {/* Silence is a result, not a failure — say which. */}
              Budgets are inside their limits, no bills are due, and nothing looks unusual.
            </Text>
          </View>
        </Card>
      ) : (
        <>
          <SectionHeader title={`${shown.length} item${shown.length === 1 ? '' : 's'}`} />
          {/* Two across on a phone, more on a desktop: a feed is still a set of
              separate events, not one document to read top to bottom. */}
          <Grid ideal={3}>
            {shown.map((notice) => {
              const isRead = read.has(notice.id);
              const tone =
                notice.severity === 'critical'
                  ? c.critical
                  : notice.severity === 'warning'
                    ? c.warning
                    : notice.severity === 'positive'
                      ? c.good
                      : c.accent;

              return (
                <Pressable
                  key={notice.id}
                  onPress={() => open(notice)}
                  accessibilityRole="button"
                  accessibilityLabel={`${notice.title}. ${notice.body}`}
                  style={{
                    backgroundColor: c.surface,
                    borderRadius: r.lg,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: c.border,
                    padding: sp.lg,
                    minHeight: 132,
                    // Read entries recede rather than disappear: the log is
                    // still a log, and hiding what you have seen makes it
                    // impossible to check back.
                    opacity: isRead ? 0.6 : 1,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 15,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: tone + '22',
                      }}
                    >
                      <Text style={{ fontSize: 14 }}>{KIND_GLYPH[notice.kind]}</Text>
                    </View>
                    <View style={{ flex: 1 }} />
                    <Text style={[t.micro, { color: c.textMuted }]}>
                      {relativeDate(notice.date, asOf)}
                    </Text>
                    {!isRead ? (
                      <View
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 4,
                          backgroundColor: tone,
                          marginLeft: 6,
                        }}
                      />
                    ) : null}
                  </View>

                  <Text
                    style={[t.bodyStrong, { color: c.textPrimary, marginTop: sp.sm }]}
                    numberOfLines={2}
                  >
                    {notice.title}
                  </Text>
                  <Text style={[t.micro, { color: c.textSecondary, marginTop: 4 }]} numberOfLines={3}>
                    {notice.body}
                  </Text>
                </Pressable>
              );
            })}
          </Grid>
        </>
      )}
    </Screen>
  );
}
