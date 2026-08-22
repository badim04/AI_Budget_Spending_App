/**
 * The small set of pieces every screen is built from.
 *
 * Kept deliberately few. A design system that grows a component per screen
 * stops being a system; if something is needed twice it goes here, and if it is
 * needed once it stays in the screen.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { formatMoney, type Money } from '../../core/money';
import { tabularNumbers } from '../../theme/tokens';

// ---------------------------------------------------------------------- Card

export function Card({
  children,
  style,
  padded = true,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  padded?: boolean;
}) {
  const { c, radius: r, space: sp, elevation } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: c.surface,
          borderRadius: r.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.border,
          padding: padded ? sp.lg : 0,
        },
        elevation.card,
        style,
      ]}
    >
      {children}
    </View>
  );
}

// -------------------------------------------------------------- SectionHeader

export function SectionHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  const { c, type: t, space: sp } = useTheme();
  return (
    <View style={[styles.sectionHeader, { marginBottom: sp.md, marginTop: sp.xl }]}>
      <Text style={[t.heading, { color: c.textPrimary }]}>{title}</Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={12} accessibilityRole="button">
          <Text style={[t.caption, { color: c.accent }]}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ----------------------------------------------------------------- AmountText

/**
 * Money, rendered with tabular figures.
 *
 * Proportional digits make a column of amounts shimmy as values update; tabular
 * figures keep every digit the same width so the column stays still.
 */
export function AmountText({
  value,
  size = 'body',
  color,
  signed,
  abbreviate,
}: {
  value: Money;
  size?: 'hero' | 'display' | 'title' | 'body' | 'caption';
  color?: string;
  signed?: boolean;
  abbreviate?: boolean;
}) {
  const { c, type: t } = useTheme();
  const style = size === 'body' ? t.bodyStrong : t[size];
  return (
    <Text style={[style, tabularNumbers, { color: color ?? c.textPrimary }]}>
      {formatMoney(value, { signed, abbreviate })}
    </Text>
  );
}

// ------------------------------------------------------------------- Progress

/**
 * Budget progress bar with a pace marker.
 *
 * The little tick is the whole point: it shows how far through the period you
 * are, so the bar answers "am I ahead or behind?" rather than just "how much is
 * gone?". Without it, 60% spent is a number with no meaning attached.
 */
export function BudgetBar({
  utilisation,
  pace,
  color,
  height = 8,
}: {
  utilisation: number | null;
  pace: number;
  color: string;
  height?: number;
}) {
  const { c, radius: r } = useTheme();
  const filled = Math.min(1, Math.max(0, utilisation ?? 0));
  const overflowing = (utilisation ?? 0) > 1;

  return (
    <View
      style={{
        height,
        backgroundColor: c.surfaceSunken,
        borderRadius: r.sm,
        overflow: 'visible',
        justifyContent: 'center',
      }}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(filled * 100) }}
    >
      <View style={{ height, borderRadius: r.sm, overflow: 'hidden' }}>
        <View style={{ width: `${filled * 100}%`, height: '100%', backgroundColor: color }} />
      </View>

      {/* Pace marker */}
      <View
        style={{
          position: 'absolute',
          left: `${Math.min(100, pace * 100)}%`,
          width: 2,
          height: height + 6,
          backgroundColor: c.textMuted,
          borderRadius: 1,
          opacity: 0.7,
        }}
      />

      {overflowing ? (
        <View
          style={{
            position: 'absolute',
            right: -2,
            width: 4,
            height: height + 6,
            backgroundColor: c.critical,
            borderRadius: 2,
          }}
        />
      ) : null}
    </View>
  );
}

// ----------------------------------------------------------------------- Pill

export function Pill({
  label,
  tone = 'neutral',
  icon,
}: {
  label: string;
  tone?: 'neutral' | 'good' | 'warning' | 'critical' | 'accent';
  icon?: string;
}) {
  const { c, type: t, radius: r, space: sp } = useTheme();
  const map = {
    neutral: { bg: c.surfaceSunken, fg: c.textSecondary },
    good: { bg: c.goodSubtle, fg: c.good },
    warning: { bg: c.warningSubtle, fg: c.warning },
    critical: { bg: c.criticalSubtle, fg: c.critical },
    accent: { bg: c.accentSubtle, fg: c.accent },
  }[tone];

  return (
    <View
      style={{
        backgroundColor: map.bg,
        borderRadius: r.pill,
        paddingHorizontal: sp.md,
        paddingVertical: sp.xs + 1,
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
      }}
    >
      {/* Status is never colour alone — the icon and the word carry it too. */}
      {icon ? <Text style={{ fontSize: 11, marginRight: 4 }}>{icon}</Text> : null}
      <Text style={[t.micro, { color: map.fg }]}>{label}</Text>
    </View>
  );
}

// --------------------------------------------------------------------- Button

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  icon?: string;
}) {
  const { c, type: t, radius: r, space: sp } = useTheme();
  const map = {
    primary: { bg: c.accent, fg: c.onAccent, border: 'transparent' },
    secondary: { bg: c.surfaceRaised, fg: c.textPrimary, border: c.border },
    ghost: { bg: 'transparent', fg: c.accent, border: 'transparent' },
  }[variant];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        backgroundColor: map.bg,
        borderColor: map.border,
        borderWidth: variant === 'secondary' ? StyleSheet.hairlineWidth : 0,
        borderRadius: r.md,
        paddingVertical: sp.md + 2,
        paddingHorizontal: sp.xl,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.75 : 1,
        // Never smaller than a comfortable thumb target.
        minHeight: 48,
      })}
    >
      {icon ? <Text style={{ marginRight: 8, fontSize: 15 }}>{icon}</Text> : null}
      <Text style={[t.bodyStrong, { color: map.fg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
});
