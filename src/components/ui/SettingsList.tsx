/**
 * Settings as a list, not a stack of dashboards.
 *
 * Every setting used to be its own bordered card under its own heading, so a
 * page with eight settings read as eight separate panels — the layout of an
 * admin console, where each block is a different subsystem. To a person these
 * are not eight subsystems. They are a handful of things about their money,
 * their automation, and the app.
 *
 * So: a few named groups, each one container, with hairline-separated rows
 * inside. That is the shape every consumer app on the phone already uses, and
 * it is why theirs feel navigable and this one felt like work.
 *
 * A row shows what it is on the left and where it stands on the right, so the
 * page can be read down the right-hand edge without opening anything.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { useEnter, usePressScale } from '../../theme/motion';

export function SettingsGroup({
  title,
  children,
  index = 0,
  divided = true,
  padded = false,
}: {
  title: string;
  children: React.ReactNode;
  index?: number;
  /** Hairlines between rows. Off for a group holding free-form content. */
  divided?: boolean;
  /** Inner padding, for content that is not `SettingsRow`. */
  padded?: boolean;
}) {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const enter = useEnter(index);

  // Hairlines go between rows, never above the first or below the last.
  const rows = React.Children.toArray(children).filter(Boolean);

  // An empty title means "still the same group" — a second container under one
  // heading, for content that does not belong in the same box as the rows.

  return (
    <Animated.View style={[enter, { marginTop: title ? sp.xl : sp.sm }]}>
      {title ? (
        <Text style={[t.micro, { color: c.textMuted, marginBottom: sp.sm, marginLeft: sp.xs }]}>
          {title.toUpperCase()}
        </Text>
      ) : null}
      <View
        style={{
          backgroundColor: c.surface,
          borderRadius: r.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.border,
          overflow: 'hidden',
        }}
      >
        {divided ? (
          rows.map((row, i) => (
            <View key={i}>
              {i > 0 ? (
                <View
                  style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 56 }}
                />
              ) : null}
              {row}
            </View>
          ))
        ) : (
          <View style={{ padding: padded ? sp.lg : 0 }}>{children}</View>
        )}
      </View>
    </Animated.View>
  );
}

export function SettingsRow({
  icon,
  label,
  value,
  hint,
  tone = 'neutral',
  onPress,
  right,
}: {
  /** An emoji rather than an icon font: it carries colour for free. */
  icon: string;
  label: string;
  /** The state, on the right — what makes the page readable at a glance. */
  value?: string;
  hint?: string;
  tone?: 'neutral' | 'good' | 'warning' | 'accent';
  onPress?: () => void;
  /** A control instead of a value: a switch, a set of chips. */
  right?: React.ReactNode;
}) {
  const { c, type: t, space: sp } = useTheme();
  const press = usePressScale(0.99);

  const valueColor =
    tone === 'good' ? c.good : tone === 'warning' ? c.warning : tone === 'accent' ? c.accent : c.textSecondary;

  const body = (
    <View style={{ paddingHorizontal: sp.lg, paddingVertical: sp.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View
          style={{
            width: 28,
            alignItems: 'center',
            marginRight: sp.md,
          }}
        >
          <Text style={{ fontSize: 17 }}>{icon}</Text>
        </View>

        <Text style={[t.body, { color: c.textPrimary, flex: 1 }]} numberOfLines={1}>
          {label}
        </Text>

        {right ?? (
          <>
            {value ? (
              <Text style={[t.caption, { color: valueColor, marginRight: onPress ? 4 : 0 }]} numberOfLines={1}>
                {value}
              </Text>
            ) : null}
            {onPress ? <Ionicons name="chevron-forward" size={15} color={c.textMuted} /> : null}
          </>
        )}
      </View>

      {hint ? (
        <Text style={[t.micro, { color: c.textMuted, marginTop: 4, marginLeft: 28 + sp.md }]}>
          {hint}
        </Text>
      ) : null}
    </View>
  );

  if (!onPress) return body;

  return (
    <Animated.View style={press.style}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={`${label}${value ? `, ${value}` : ''}`}
      >
        {body}
      </Pressable>
    </Animated.View>
  );
}
