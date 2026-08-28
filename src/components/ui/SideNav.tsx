/**
 * Side navigation rail.
 *
 * Tablets and desktop only — phones get the bottom bar in `(tabs)/_layout.tsx`.
 *   - wide   (>= 900): 216pt, icons with labels beside them
 *   - medium (>= 600): 76pt rail, icon over a small label
 *
 * Safe-area insets are applied to the rail itself, so the notch and the home
 * indicator never sit on top of a nav item.
 */

import React from 'react';
import { View, Text, Pressable, ScrollView, useWindowDimensions, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { useTheme } from '../../theme/ThemeProvider';
import { useAppStore } from '../../store/useAppStore';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface NavItem {
  href: string;
  label: string;
  icon: IoniconName;
  iconActive: IoniconName;
  /** Renders a count badge, used for the review queue. */
  badge?: 'unreviewed';
}

const ITEMS: NavItem[] = [
  { href: '/', label: 'Home', icon: 'pie-chart-outline', iconActive: 'pie-chart' },
  { href: '/transactions', label: 'Activity', icon: 'list-outline', iconActive: 'list', badge: 'unreviewed' },
  { href: '/capture', label: 'Add', icon: 'add-circle-outline', iconActive: 'add-circle' },
  { href: '/budgets', label: 'Budgets', icon: 'wallet-outline', iconActive: 'wallet' },
  { href: '/goals', label: 'Goals', icon: 'flag-outline', iconActive: 'flag' },
  { href: '/insights', label: 'Insights', icon: 'trending-up-outline', iconActive: 'trending-up' },
  { href: '/analysis', label: 'Analysis', icon: 'bar-chart-outline', iconActive: 'bar-chart' },
  { href: '/settings', label: 'Settings', icon: 'settings-outline', iconActive: 'settings' },
];

/**
 * `useRail` is the important one: below 600pt there is no rail at all and the
 * bottom bar takes over. A 60pt rail on a 360pt phone costs 17% of the screen
 * and pushed content underneath itself.
 */
export function useNavLayout() {
  const { width } = useWindowDimensions();
  const useRail = width >= 600;
  const expanded = width >= 900;
  const railWidth = expanded ? 216 : 76;
  return { useRail, expanded, railWidth };
}

export function SideNav() {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { expanded, railWidth } = useNavLayout();

  const unreviewed = useAppStore(
    (s) => s.transactions.filter((tx) => !tx.deletedAt && !tx.reviewed).length
  );

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' || pathname === '/index' : pathname.startsWith(href);

  return (
    <View
      style={{
        width: railWidth,
        backgroundColor: c.surface,
        borderRightWidth: StyleSheet.hairlineWidth,
        borderRightColor: c.border,
        paddingTop: insets.top + sp.md,
        paddingBottom: insets.bottom + sp.md,
        paddingLeft: insets.left,
      }}
    >
      {expanded ? (
        <View style={{ paddingHorizontal: sp.lg, marginBottom: sp.xl }}>
          <Text style={[t.title, { color: c.textPrimary }]}>Finlo</Text>
        </View>
      ) : (
        <View style={{ alignItems: 'center', marginBottom: sp.lg }}>
          <View
            style={{
              width: 32, height: 32, borderRadius: 10,
              backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ color: c.onAccent, fontWeight: '800', fontSize: 16 }}>L</Text>
          </View>
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: sp.lg }}>
        {ITEMS.map((item) => {
          const active = isActive(item.href);
          const count = item.badge === 'unreviewed' ? unreviewed : 0;
          return (
            <Pressable
              key={item.href}
              // replace() rather than push() — a nav rail switches sections, it
              // does not stack them, and push would build an endless back stack.
              onPress={() => router.replace(item.href as never)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={
                count > 0 ? `${item.label}, ${count} needing review` : item.label
              }
              style={({ pressed }) => ({
                flexDirection: expanded ? 'row' : 'column',
                alignItems: 'center',
                justifyContent: expanded ? 'flex-start' : 'center',
                marginHorizontal: expanded ? sp.md : sp.xs,
                marginBottom: sp.xs,
                paddingVertical: expanded ? sp.md : sp.sm + 2,
                paddingHorizontal: expanded ? sp.md : 0,
                borderRadius: r.md,
                backgroundColor: active ? c.accentSubtle : 'transparent',
                opacity: pressed ? 0.65 : 1,
                minHeight: 48,
              })}
            >
              <View>
                <Ionicons
                  name={active ? item.iconActive : item.icon}
                  size={expanded ? 20 : 22}
                  color={active ? c.accent : c.textMuted}
                />
                {count > 0 ? (
                  <View
                    style={{
                      position: 'absolute',
                      top: -4,
                      right: -8,
                      minWidth: 16,
                      height: 16,
                      borderRadius: 8,
                      paddingHorizontal: 4,
                      backgroundColor: c.warning,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 10, fontWeight: '700', color: c.textInverse }}>
                      {count > 99 ? '99+' : count}
                    </Text>
                  </View>
                ) : null}
              </View>

              <Text
                numberOfLines={1}
                style={[
                  expanded ? t.body : t.micro,
                  {
                    color: active ? c.accent : c.textMuted,
                    marginLeft: expanded ? sp.md : 0,
                    marginTop: expanded ? 0 : 3,
                    fontSize: expanded ? 15 : 10,
                  },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
