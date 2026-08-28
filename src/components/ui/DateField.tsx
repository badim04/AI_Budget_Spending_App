/**
 * Picking a date, without typing one.
 *
 * Every date in the app was a text box wanting `YYYY-MM-DD`. That is fine for
 * the person who wrote it and hostile to everyone else: it needs a keyboard,
 * it needs the format remembered, it silently accepts `2026-13-45`, and on a
 * phone it means switching to the number pad and back for one field.
 *
 * This is a month grid you scroll and tap. Three details do most of the work:
 *
 *  - **Shortcuts first.** Today, yesterday, start of month. Most dates entered
 *    into a finance app are one of those three, and a tap beats a calendar.
 *  - **The month pages sideways**, so "last month" is a swipe rather than a
 *    dropdown of twelve.
 *  - **Future days are disabled when the field is for something that already
 *    happened.** A transaction cannot be dated next Tuesday, and blocking it
 *    is kinder than validating it afterwards.
 *
 * Built on `core/dates.ts` so the whole app agrees on what a day is: every
 * value is a `YYYY-MM-DD` string parsed as UTC, never a `Date` with a local
 * timezone waiting to shift it by one.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, Modal, StyleSheet, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { usePressScale } from '../../theme/motion';
import { Button } from './Primitives';
import {
  addDays,
  addMonths,
  endOfMonth,
  formatDate,
  isValidISODate,
  startOfMonth,
  today as todayISO,
} from '../../core/dates';
import type { ISODate } from '../../core/types';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function DateField({
  value,
  onChange,
  label,
  placeholder = 'Pick a date',
  /** Blocks days after today — for anything that has already happened. */
  maxToday = false,
  clearable = false,
}: {
  value: string;
  onChange: (next: string) => void;
  label?: string;
  placeholder?: string;
  maxToday?: boolean;
  clearable?: boolean;
}) {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const [open, setOpen] = useState(false);
  const press = usePressScale(0.99);

  const valid = isValidISODate(value);

  return (
    <View>
      {label ? (
        <Text style={[t.micro, { color: c.textMuted, marginBottom: sp.sm }]}>{label}</Text>
      ) : null}

      <Animated.View style={press.style}>
        <Pressable
          onPress={() => setOpen(true)}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          accessibilityRole="button"
          accessibilityLabel={`${label ?? 'Date'}: ${valid ? formatDate(value, 'medium') : 'not set'}. Opens a calendar.`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: c.surfaceSunken,
            borderRadius: r.md,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
            paddingHorizontal: sp.md,
            minHeight: 50,
          }}
        >
          <Ionicons name="calendar-outline" size={17} color={valid ? c.accent : c.textMuted} />
          <Text
            style={[
              t.body,
              { color: valid ? c.textPrimary : c.textMuted, flex: 1, marginLeft: sp.md },
            ]}
          >
            {valid ? formatDate(value, 'medium') : placeholder}
          </Text>
          {clearable && valid ? (
            <Pressable onPress={() => onChange('')} hitSlop={10} accessibilityLabel="Clear date">
              <Ionicons name="close-circle" size={17} color={c.textMuted} />
            </Pressable>
          ) : (
            <Ionicons name="chevron-down" size={15} color={c.textMuted} />
          )}
        </Pressable>
      </Animated.View>

      <CalendarSheet
        visible={open}
        value={valid ? value : todayISO()}
        maxToday={maxToday}
        onClose={() => setOpen(false)}
        onPick={(next) => {
          onChange(next);
          setOpen(false);
        }}
      />
    </View>
  );
}

function CalendarSheet({
  visible,
  value,
  maxToday,
  onClose,
  onPick,
}: {
  visible: boolean;
  value: ISODate;
  maxToday: boolean;
  onClose: () => void;
  onPick: (next: ISODate) => void;
}) {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const insets = useSafeAreaInsets();
  const today = todayISO();

  const [cursor, setCursor] = useState<ISODate>(startOfMonth(value));

  // Reopening for another field should not inherit the last month browsed.
  React.useEffect(() => {
    if (visible) setCursor(startOfMonth(value));
  }, [visible, value]);

  /**
   * The grid, Monday-first, padded so the 1st lands under its weekday.
   * Nulls are the leading blanks — drawing them keeps the columns aligned
   * without pretending they are days.
   */
  const days = useMemo(() => {
    const first = startOfMonth(cursor);
    const last = endOfMonth(cursor);
    // getUTCDay is 0=Sunday; shift so Monday is 0.
    const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;

    const cells: (ISODate | null)[] = Array(lead).fill(null);
    for (let d = first; d <= last; d = addDays(d, 1)) cells.push(d);
    return cells;
  }, [cursor]);

  const monthLabel = new Date(`${cursor}T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const canGoNext = !maxToday || startOfMonth(addMonths(cursor, 1)) <= today;

  const shortcuts: { label: string; date: ISODate }[] = [
    { label: 'Today', date: today },
    { label: 'Yesterday', date: addDays(today, -1) },
    { label: 'Start of month', date: startOfMonth(today) },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: c.scrim }} onPress={onClose} accessibilityLabel="Close calendar" />

      <View
        style={{
          backgroundColor: c.surface,
          borderTopLeftRadius: r.xl,
          borderTopRightRadius: r.xl,
          paddingTop: sp.md,
          paddingBottom: insets.bottom + sp.lg,
          paddingHorizontal: sp.lg,
        }}
      >
        <View
          style={{
            alignSelf: 'center',
            width: 40,
            height: 4,
            borderRadius: 2,
            backgroundColor: c.border,
            marginBottom: sp.lg,
          }}
        />

        {/* Month pager */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: sp.lg }}>
          <MonthArrow direction="back" onPress={() => setCursor(startOfMonth(addMonths(cursor, -1)))} enabled />
          <Text style={[t.heading, { color: c.textPrimary, flex: 1, textAlign: 'center' }]}>
            {monthLabel}
          </Text>
          <MonthArrow
            direction="forward"
            enabled={canGoNext}
            onPress={() => canGoNext && setCursor(startOfMonth(addMonths(cursor, 1)))}
          />
        </View>

        <View style={{ flexDirection: 'row', marginBottom: sp.sm }}>
          {WEEKDAYS.map((d, i) => (
            <Text
              key={i}
              style={[t.micro, { color: c.textMuted, width: `${100 / 7}%`, textAlign: 'center' }]}
            >
              {d}
            </Text>
          ))}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {days.map((day, i) => {
            if (!day) return <View key={`blank-${i}`} style={{ width: `${100 / 7}%`, height: 44 }} />;

            const selected = day === value;
            const isToday = day === today;
            const blocked = maxToday && day > today;

            return (
              <Pressable
                key={day}
                onPress={() => !blocked && onPick(day)}
                disabled={blocked}
                accessibilityRole="button"
                accessibilityLabel={formatDate(day, 'medium')}
                accessibilityState={{ selected, disabled: blocked }}
                style={{ width: `${100 / 7}%`, height: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: selected ? c.accent : isToday ? c.accentSubtle : 'transparent',
                  }}
                >
                  <Text
                    style={[
                      t.body,
                      {
                        color: blocked
                          ? c.textMuted
                          : selected
                            ? c.onAccent
                            : isToday
                              ? c.accent
                              : c.textPrimary,
                        opacity: blocked ? 0.4 : 1,
                      },
                    ]}
                  >
                    {Number(day.slice(8, 10))}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* The three dates most likely to be wanted, one tap away. */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: sp.lg }}>
          {shortcuts.map((s) => (
            <Pressable
              key={s.label}
              onPress={() => onPick(s.date)}
              accessibilityRole="button"
              style={{
                backgroundColor: c.surfaceSunken,
                borderRadius: r.pill,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: c.border,
                paddingHorizontal: sp.lg,
                paddingVertical: sp.sm,
                marginRight: sp.sm,
                marginBottom: sp.sm,
              }}
            >
              <Text style={[t.caption, { color: c.textSecondary }]}>{s.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={{ marginTop: sp.sm }}>
          <Button label="Close" variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function MonthArrow({
  direction,
  enabled,
  onPress,
}: {
  direction: 'back' | 'forward';
  enabled: boolean;
  onPress: () => void;
}) {
  const { c } = useTheme();
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
        accessibilityLabel={direction === 'back' ? 'Previous month' : 'Next month'}
        accessibilityState={{ disabled: !enabled }}
        style={{
          width: 38,
          height: 38,
          borderRadius: 19,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: enabled ? c.surfaceSunken : 'transparent',
        }}
      >
        <Ionicons
          name={direction === 'back' ? 'chevron-back' : 'chevron-forward'}
          size={18}
          color={enabled ? c.textPrimary : c.textMuted}
        />
      </Pressable>
    </Animated.View>
  );
}
