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

export function AppHeader({ subtitle }: { subtitle?: string }) {
  const { c, type: t, space: sp, radius: r } = useTheme();

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

      <IconButton icon="flag-outline" label="Goals" onPress={() => router.push('/goals')} />
      <IconButton icon="settings-outline" label="Settings" onPress={() => router.push('/settings')} />
    </View>
  );
}

function IconButton({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  const { c, space: sp, radius: r } = useTheme();
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
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
