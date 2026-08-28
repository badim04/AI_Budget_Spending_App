/**
 * The small set of pieces every screen is built from.
 *
 * Kept deliberately few. A design system that grows a component per screen
 * stops being a system; if something is needed twice it goes here, and if it is
 * needed once it stays in the screen.
 */

import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  ActivityIndicator,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { useCountUp, usePressScale } from '../../theme/motion';
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
  animate = false,
}: {
  value: Money;
  size?: 'hero' | 'display' | 'title' | 'body' | 'caption';
  color?: string;
  signed?: boolean;
  abbreviate?: boolean;
  /**
   * Count up to the new figure instead of snapping to it.
   *
   * Only worth it for a headline number that changes in response to something
   * the user just did — paging to another month, say. On a list it is noise,
   * and the count is driven from JavaScript because text content cannot be
   * animated natively, so it is opt-in rather than the default.
   */
  animate?: boolean;
}) {
  const { c, type: t } = useTheme();
  const style = size === 'body' ? t.bodyStrong : t[size];
  const shown = useCountUp(value.minor, animate);

  return (
    <Text style={[style, tabularNumbers, { color: color ?? c.textPrimary }]}>
      {formatMoney(animate ? { ...value, minor: shown } : value, { signed, abbreviate })}
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

/**
 * The button, and it is the one component that shows up on every screen.
 *
 * The old one was a flat rectangle that dimmed to 75% opacity when pressed —
 * correct, and completely inert. Three changes make it feel like a thing you
 * push rather than a region that reacts:
 *
 *  1. **A pill, not a rounded box.** Fully rounded reads as an action; a
 *     12px-radius rectangle reads as a container that happens to be tappable.
 *  2. **It scales under the thumb** instead of fading. Fading says "disabled
 *     is coming"; scaling says "received".
 *  3. **A highlight across the top of the fill.** One translucent white band
 *     is the difference between a coloured rectangle and something with a
 *     surface. A real gradient would need `expo-linear-gradient`, which is
 *     native and cannot ship over the air.
 *
 * `tone` lets a destructive or successful action carry its own colour without
 * every caller hand-rolling a Pressable.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  tone = 'accent',
  size = 'md',
  disabled = false,
  loading = false,
  full = true,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  icon?: string;
  tone?: 'accent' | 'good' | 'critical';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  /** Buttons fill their container by default; a row of them should not. */
  full?: boolean;
}) {
  const { c, type: t, radius: r, space: sp, elevation } = useTheme();
  const press = usePressScale(0.96);

  const accent = tone === 'good' ? c.good : tone === 'critical' ? c.critical : c.accent;

  /**
   * Secondary is tinted, not outlined.
   *
   * A white rectangle with a hairline border next to a filled purple pill does
   * not read as a quieter action — it reads as an unfinished one. Most of the
   * app's buttons are secondary ("Choose a photo", "Connect Gmail", "Import a
   * statement"), so leaving them as outlines meant the redesign only touched
   * the handful of primaries and everything else stayed flat.
   *
   * A wash of the accent with the accent as the label keeps the hierarchy —
   * filled beats tinted beats text — while still looking like something built
   * on purpose.
   */
  const map = {
    primary: { bg: accent, fg: tone === 'accent' ? c.onAccent : '#ffffff', border: 'transparent' },
    secondary: { bg: c.accentSubtle, fg: accent, border: 'transparent' },
    ghost: { bg: 'transparent', fg: accent, border: 'transparent' },
  }[variant];

  const height = size === 'sm' ? 40 : size === 'lg' ? 56 : 50;
  const inactive = disabled || loading;

  return (
    <Animated.View style={[press.style, full ? undefined : { alignSelf: 'flex-start' }]}>
      <Pressable
        onPress={inactive ? undefined : onPress}
        onPressIn={inactive ? undefined : press.onPressIn}
        onPressOut={inactive ? undefined : press.onPressOut}
        disabled={inactive}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: inactive, busy: loading }}
        style={{
          backgroundColor: map.bg,
          borderColor: map.border,
          borderWidth: 0,
          borderRadius: r.pill,
          paddingHorizontal: size === 'sm' ? sp.lg : sp.xl,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: height,
          opacity: inactive ? 0.55 : 1,
          overflow: 'hidden',
          ...(variant === 'primary' ? elevation.card : null),
        }}
      >
        {/* The surface highlight: brighter across the top third of the fill. */}
        {variant !== 'ghost' ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: height / 2,
              backgroundColor:
                variant === 'primary' ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)',
            }}
          />
        ) : null}

        {loading ? (
          <ActivityIndicator size="small" color={map.fg} style={{ marginRight: 8 }} />
        ) : icon ? (
          <Text style={{ marginRight: 8, fontSize: size === 'sm' ? 13 : 15 }}>{icon}</Text>
        ) : null}

        <Text style={[size === 'sm' ? t.caption : t.bodyStrong, { color: map.fg }]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * A round icon button.
 *
 * For the floating action and anywhere a label would be noise. Same press
 * behaviour as `Button` so the whole app answers a thumb the same way.
 */
export function FabButton({
  icon,
  label,
  onPress,
  size = 56,
  tone = 'accent',
}: {
  icon: string;
  /** Never optional: an unlabelled control is invisible to a screen reader. */
  label: string;
  onPress: () => void;
  size?: number;
  tone?: 'accent' | 'good' | 'critical';
}) {
  const { c, elevation } = useTheme();
  const press = usePressScale(0.92);
  const bg = tone === 'good' ? c.good : tone === 'critical' ? c.critical : c.accent;

  return (
    <Animated.View style={press.style}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          ...elevation.card,
        }}
      >
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: size / 2,
            backgroundColor: 'rgba(255,255,255,0.18)',
          }}
        />
        <Text style={{ fontSize: size * 0.4, color: '#ffffff' }}>{icon}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
});
