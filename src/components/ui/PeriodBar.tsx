/**
 * The month you are looking at.
 *
 * Every screen was pinned to today, which answers one question and refuses
 * every follow-up. This is the control that lets the whole dashboard and the
 * whole of Insights move together through time.
 *
 * Forward is disabled at the current month rather than hidden: a greyed arrow
 * says "this is the edge", a missing one says "this feature does not exist".
 * The label reads "This month" and "Last month" where those are what a person
 * would say, and spells the month out beyond that.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { usePressScale } from '../../theme/motion';
import {
  canGoForward,
  describeRange,
  isCurrentMonth,
  monthOf,
  shiftMonths,
} from '../../core/periods';
import { today as todayISO } from '../../core/dates';
import type { PeriodRange } from '../../core/types';

export function PeriodBar({
  range,
  onChange,
  today = todayISO(),
  subtitle,
}: {
  range: PeriodRange;
  onChange: (next: PeriodRange) => void;
  today?: string;
  /** Extra context under the label, e.g. "5 days left". */
  subtitle?: string;
}) {
  const { c, type: t, space: sp, radius: r } = useTheme();

  const forward = canGoForward(range, today);
  const live = isCurrentMonth(range, today);
  const label = describeRange(range, today);

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: c.surface,
        borderRadius: r.pill,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
        paddingHorizontal: sp.xs,
        paddingVertical: sp.xs,
      }}
    >
      <Arrow
        direction="back"
        enabled
        onPress={() => onChange(shiftMonths(range, -1))}
        label="Previous month"
      />

      <Pressable
        onPress={() => !live && onChange(monthOf(today))}
        disabled={live}
        style={{ flex: 1, alignItems: 'center', paddingVertical: sp.xs }}
        accessibilityRole="button"
        accessibilityLabel={live ? label : `${label}. Tap to return to this month.`}
      >
        <Text style={[t.bodyStrong, { color: c.textPrimary }]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[t.micro, { color: c.textMuted, marginTop: 1 }]} numberOfLines={1}>
          {subtitle ?? (live ? range.label : 'Tap to return to this month')}
        </Text>
      </Pressable>

      <Arrow
        direction="forward"
        enabled={forward}
        onPress={() => forward && onChange(shiftMonths(range, 1))}
        label="Next month"
      />
    </View>
  );
}

function Arrow({
  direction,
  enabled,
  onPress,
  label,
}: {
  direction: 'back' | 'forward';
  enabled: boolean;
  onPress: () => void;
  label: string;
}) {
  const { c, space: sp } = useTheme();
  const press = usePressScale(0.88);

  return (
    <Animated.View style={press.style}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        disabled={!enabled}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !enabled }}
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: enabled ? c.surfaceSunken : 'transparent',
          marginHorizontal: sp.xxs,
        }}
      >
        <Ionicons
          name={direction === 'back' ? 'chevron-back' : 'chevron-forward'}
          size={17}
          color={enabled ? c.textPrimary : c.textMuted}
        />
      </Pressable>
    </Animated.View>
  );
}
