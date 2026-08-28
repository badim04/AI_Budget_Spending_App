import React from 'react';
import { View, Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme/ThemeProvider';
import { SideNav, useNavLayout } from '../../src/components/ui/SideNav';
import { useAppStore } from '../../src/store/useAppStore';

/**
 * Section shell — bottom bar on phones, side rail on tablets and desktop.
 *
 * The rail used to run at every width. On a 360pt phone it ate 60pt and, worse,
 * screens sized themselves from the WINDOW width rather than the width left
 * over, so ~30pt of every screen hid underneath it. Phones get the bottom bar
 * every other finance app uses; the rail earns its space only once there is
 * space to spare.
 *
 * Seven destinations is too many for a bottom bar (they end up ~50pt wide each
 * and unhittable), so Goals and Settings are hidden from it with `href: null`
 * and reached from the dashboard header instead. Both stay real routes, so
 * `router.push('/settings')` still works from anywhere.
 */
export default function SectionLayout() {
  const { c, type: t } = useTheme();
  const insets = useSafeAreaInsets();
  const { useRail } = useNavLayout();

  const unreviewed = useAppStore(
    (s) => s.transactions.filter((tx) => !tx.deletedAt && !tx.reviewed).length
  );

  const tabs = (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: c.canvas },
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.textMuted,
        // The rail replaces the bar entirely on wide screens.
        tabBarStyle: useRail
          ? { display: 'none' }
          : {
              backgroundColor: c.surface,
              borderTopColor: c.border,
              borderTopWidth: StyleSheetHairline,
              height: 58 + insets.bottom,
              paddingTop: 6,
              paddingBottom: insets.bottom + 6,
              elevation: 0,
            },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: 2,
          // Android clips the label without this.
          includeFontPadding: false,
        },
        tabBarItemStyle: { paddingVertical: 2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'pie-chart' : 'pie-chart-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: 'Activity',
          tabBarBadge: unreviewed > 0 ? unreviewed : undefined,
          tabBarBadgeStyle: { backgroundColor: c.accent, color: c.onAccent, fontSize: 10 },
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'list' : 'list-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="capture"
        options={{
          title: 'Add',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'add-circle' : 'add-circle-outline'}
              size={30}
              color={focused ? c.accent : color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="budgets"
        options={{
          title: 'Budgets',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'wallet' : 'wallet-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="insights"
        options={{
          title: 'Insights',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'trending-up' : 'trending-up-outline'} size={22} color={color} />
          ),
        }}
      />

      {/*
        Real routes, deliberately absent from the bottom bar.

        Analysis is a first-class page, not a lesser one — but a bottom bar with
        six destinations gives each about 50pt, which is under the size a thumb
        can reliably hit. It is reached from the track at the top of Insights,
        which is one tap, and it has its own entry in the side rail where there
        is room for it.
      */}
      <Tabs.Screen name="analysis" options={{ href: null, title: 'Analysis' }} />
      <Tabs.Screen name="goals" options={{ href: null, title: 'Goals' }} />
      <Tabs.Screen name="settings" options={{ href: null, title: 'Settings' }} />
    </Tabs>
  );

  if (!useRail) return tabs;

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: c.canvas }}>
      <SideNav />
      <View style={{ flex: 1 }}>{tabs}</View>
    </View>
  );
}

/** RN's StyleSheet.hairlineWidth, inlined to keep the import list short. */
const StyleSheetHairline = Platform.OS === 'android' ? 0.5 : 0.33;
