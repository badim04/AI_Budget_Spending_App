/**
 * The header every tab wears.
 *
 * It used to sit on the dashboard only, holding the two routes that could not
 * fit in the bottom bar. That made them reachable but not *available*: to open
 * Settings from Budgets you went Home first, and Ask Finlo — the thing most
 * worth reaching from anywhere, because a question about your money occurs to
 * you while you are looking at your money — was three taps deep in Settings.
 *
 * The obvious fix is a sixth tab. It is also wrong: six destinations across a
 * 360pt phone is about 50pt each, under what a thumb reliably hits, and the
 * bottom bar is where the things you tap many times a day belong. Ask is not
 * one of those; it is something you want *available*, which is a different
 * requirement and wants a different answer.
 *
 * So one header, on every tab, with three things on the right:
 *
 *   **Ask** — a labelled pill, not a bare icon. The user asked for it to be
 *   easy to get to twice; an unlabelled sparkle is a puzzle, and a feature
 *   nobody can name is a feature nobody opens.
 *   **The bell** — with its unread count.
 *   **The avatar** — one way into Profile, which now holds settings, goals and
 *   everything else that is about you rather than about this month.
 *
 * Goals and Settings lost their separate header icons to make room. Both are
 * one tap inside Profile, and Goals also has a tile and a quick-action card on
 * Home, so neither got further away in practice.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../theme/ThemeProvider';
import { useAppStore } from '../../store/useAppStore';
import { allBudgetStatuses } from '../../core/budget';
import { excludedCategoryIds } from '../../core/analytics';
import { today } from '../../core/dates';
import {
  READ_NOTICES_KEY,
  buildNotices,
  parseReadIds,
  unreadCount,
} from '../../core/notifications';

export function AppHeader({
  /**
   * The screen's own name. Given one, the header *is* the screen title and the
   * Finlo lockup steps aside — otherwise every page carried a brand mark and a
   * heading saying different things two lines apart.
   */
  title,
  subtitle,
}: {
  title?: string;
  subtitle?: string;
}) {
  const { c, type: t, space: sp, radius: r } = useTheme();

  const transactions = useAppStore((s) => s.transactions);
  const categories = useAppStore((s) => s.categories);
  const budgets = useAppStore((s) => s.budgets);
  const recurringRules = useAppStore((s) => s.recurringRules);
  const settings = useAppStore((s) => s.settings);
  const asOf = today();

  /**
   * The bell's count, derived like the feed itself.
   *
   * Recomputing the whole notice list for a badge looks wasteful, and would be
   * if it were stored — but it is the only way the number on the bell and the
   * number of rows behind it can never disagree, which is a bug this codebase
   * has already paid for once with a total that contradicted the list under it.
   */
  const unreadNotices = React.useMemo(() => {
    const statuses = allBudgetStatuses(budgets, {
      transactions,
      excludedCategoryIds: excludedCategoryIds(categories),
      asOf,
    });
    const notices = buildNotices({
      transactions,
      budgetStatuses: statuses,
      recurringRules,
      asOf,
    });
    return unreadCount(notices, parseReadIds(settings[READ_NOTICES_KEY]));
  }, [transactions, categories, budgets, recurringRules, settings, asOf]);

  const name = (settings.user_name ?? '').trim();
  const initial = name ? name.charAt(0).toUpperCase() : null;

  return (
    <View style={[styles.row, { marginBottom: sp.lg }]}>
      {title ? (
        <View style={{ flex: 1 }}>
          <Text style={[t.title, { color: c.textPrimary }]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[t.micro, { color: c.textMuted, marginTop: 2 }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: r.md,
              backgroundColor: c.accent,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: c.onAccent, fontWeight: '700', fontSize: 17 }}>F</Text>
          </View>
          <View style={{ marginLeft: sp.md, flex: 1 }}>
            <Text style={[t.heading, { color: c.textPrimary }]}>Finlo</Text>
            {subtitle ? (
              <Text style={[t.micro, { color: c.textMuted }]} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>
      )}

      {/* Labelled, because a feature nobody can name is a feature nobody
          opens — and this one is the reason the header exists on every tab. */}
      <Pressable
        onPress={() => router.push('/ask')}
        accessibilityRole="button"
        accessibilityLabel="Ask Finlo about your money"
        hitSlop={8}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          height: 40,
          paddingHorizontal: sp.md,
          borderRadius: r.pill,
          backgroundColor: pressed ? c.accent : c.accentSubtle,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.accent,
        })}
      >
        <Ionicons name="sparkles" size={15} color={c.accent} />
        <Text style={[t.caption, { color: c.accent, marginLeft: 5 }]}>Ask</Text>
      </Pressable>

      <IconButton
        icon="notifications-outline"
        label="Notifications"
        badge={unreadNotices}
        onPress={() => router.push('/notifications')}
      />

      {/* One way into everything that is about you rather than about this
          month: settings, goals, your data, the app itself. */}
      <Pressable
        onPress={() => router.push('/settings')}
        accessibilityRole="button"
        accessibilityLabel={name ? `Profile, ${name}` : 'Profile and settings'}
        hitSlop={8}
        style={({ pressed }) => ({
          width: 40,
          height: 40,
          borderRadius: 20,
          marginLeft: sp.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? c.accent : c.accentSubtle,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.border,
        })}
      >
        {initial ? (
          <Text style={[t.bodyStrong, { color: c.accent }]}>{initial}</Text>
        ) : (
          <Ionicons name="person-outline" size={18} color={c.accent} />
        )}
      </Pressable>
    </View>
  );
}

function IconButton({
  icon,
  label,
  onPress,
  badge = 0,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  /** Unread count. Zero renders nothing rather than a "0" nobody needs. */
  badge?: number;
}) {
  const { c, type: t, space: sp, radius: r } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      // 40pt target with room to spare; icon buttons are the easiest thing in
      // an app to make too small to hit.
      hitSlop={8}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: r.md,
        marginLeft: sp.sm,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? c.surfaceRaised : c.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
      })}
    >
      <Ionicons name={icon} size={19} color={c.textSecondary} />

      {badge > 0 ? (
        <View
          style={{
            position: 'absolute',
            top: -3,
            right: -3,
            minWidth: 17,
            height: 17,
            paddingHorizontal: 4,
            borderRadius: 9,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: c.accent,
            borderWidth: 1.5,
            borderColor: c.canvas,
          }}
        >
          <Text style={[t.micro, { color: c.onAccent, fontSize: 10 }]}>
            {badge > 99 ? '99+' : badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
