import React from 'react';
import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { useTheme } from '../../src/theme/ThemeProvider';
import { SideNav } from '../../src/components/ui/SideNav';

/**
 * Section shell: a persistent side rail beside the routed screen.
 *
 * The Tabs navigator is kept (it preserves each section's scroll position and
 * component state when you switch away and back) but its own bar is hidden and
 * `SideNav` is rendered beside it instead. Swapping to `<Slot />` would be less
 * code and would throw that state away on every navigation.
 */
export default function SectionLayout() {
  const { c } = useTheme();

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: c.canvas }}>
      <SideNav />
      <View style={{ flex: 1 }}>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarStyle: { display: 'none' },
            sceneStyle: { backgroundColor: c.canvas },
          }}
        >
          <Tabs.Screen name="index" options={{ title: 'Home' }} />
          <Tabs.Screen name="transactions" options={{ title: 'Activity' }} />
          <Tabs.Screen name="capture" options={{ title: 'Add' }} />
          <Tabs.Screen name="budgets" options={{ title: 'Budgets' }} />
          <Tabs.Screen name="goals" />
          <Tabs.Screen name="insights" options={{ title: 'Insights' }} />
          <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
        </Tabs>
      </View>
    </View>
  );
}
