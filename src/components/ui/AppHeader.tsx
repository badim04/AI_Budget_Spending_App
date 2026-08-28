/**
 * Dashboard header.
 *
 * The bottom bar holds five destinations; Goals and Settings live up here
 * instead. That split follows what finance apps actually do — the things you
 * tap many times a day sit under your thumb, and the things you visit
 * occasionally sit in the corner.
 *
 * Without this the two routes would be unreachable on a phone, since hiding
 * them from the tab bar with `href: null` removes the only other way in.
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

export function AppHeader({ subtitle }: { subtitle?: string }) {
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

  return (
    <View style={[styles.row, { marginBottom: sp.lg }]}>
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

      <IconButton
        icon="notifications-outline"
        label="Notifications"
        badge={unreadNotices}
        onPress={() => router.push('/notifications')}
      />
      <IconButton icon="flag-outline" label="Goals" onPress={() => router.push('/goals')} />
      <IconButton icon="settings-outline" label="Settings" onPress={() => router.push('/settings')} />
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
