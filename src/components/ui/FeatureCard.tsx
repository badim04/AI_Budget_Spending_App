/**
 * The one thing a screen is about, on a block of colour.
 *
 * Every card in the app used to be the same near-black surface, which is
 * honest and completely flat: nothing on the dashboard looked more important
 * than anything else, so the eye had to read it all to find the number it came
 * for. A saturated fill behind the headline figure fixes that in one move.
 *
 * The colour encodes nothing — it is chrome. That distinction matters, because
 * a chart series colour *does* encode something and can never be chosen for
 * looks. See the `feature` note in `theme/tokens.ts`.
 *
 * The fill is a real two-stop gradient as of v1.2. It used to be a flat colour
 * with a translucent white circle floated over the corner, standing in for one,
 * because `expo-linear-gradient` is a native module and adding it meant the
 * next update had to be a full build rather than an over-the-air push. That
 * cost was paid once, deliberately.
 *
 * The gradient runs top-left to bottom-right and both stops are the same hue —
 * see `theme/tokens.ts`. A two-hue gradient reads as a brand flourish and
 * starts competing with the figure printed on it, which is the one thing this
 * card exists to make prominent.
 */

import React from 'react';
import { View, Text, Pressable, Animated, StyleSheet, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../theme/ThemeProvider';
import { useEnter, usePressScale } from '../../theme/motion';

export type FeatureTone = 'primary' | 'savings' | 'spend' | 'calm';

export function FeatureCard({
  tone = 'primary',
  label,
  children,
  footer,
  onPress,
  index = 0,
  style,
}: {
  tone?: FeatureTone;
  /** Small caps line above the figure. */
  label?: string;
  /** The figure itself, already styled by the caller. */
  children: React.ReactNode;
  footer?: React.ReactNode;
  onPress?: () => void;
  /** Stagger position when several appear together. */
  index?: number;
  style?: ViewStyle;
}) {
  const { c, type: t, space: sp, radius: r, elevation } = useTheme();
  const enter = useEnter(index);
  const press = usePressScale();

  const palette = c.feature[tone];

  const body = (
    <LinearGradient
      colors={[palette.bg, palette.bgEnd]}
      // Top-left to bottom-right. A vertical gradient reads as a fade and a
      // horizontal one as a banner; the diagonal is what looks lit.
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        {
          borderRadius: r.xl,
          padding: sp.lg,
          overflow: 'hidden',
        },
        elevation.card,
        style,
      ]}
    >
      {/* A soft highlight off the top-right, on top of the gradient rather than
          instead of it — the gradient gives depth, this gives the impression of
          a light source, and the two do different work. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -70,
          right: -40,
          width: 190,
          height: 190,
          borderRadius: 95,
          backgroundColor: c.sheen,
        }}
      />

      {label ? (
        <Text style={[t.micro, { color: palette.muted, marginBottom: sp.xs }]}>
          {label.toUpperCase()}
        </Text>
      ) : null}

      {children}

      {footer ? <View style={{ marginTop: sp.md }}>{footer}</View> : null}
    </LinearGradient>
  );

  if (!onPress) {
    return <Animated.View style={enter}>{body}</Animated.View>;
  }

  return (
    <Animated.View style={enter}>
      <Animated.View style={press.style}>
        <Pressable
          onPress={onPress}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          accessibilityRole="button"
        >
          {body}
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * A pill that reads on a coloured fill.
 *
 * The standard `Pill` is tuned for the neutral surface and disappears against
 * a saturated one, so this uses a wash of the card's own foreground instead.
 */
export function FeaturePill({ label, tone = 'primary' }: { label: string; tone?: FeatureTone }) {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const palette = c.feature[tone];

  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: c.sheen,
        borderRadius: r.pill,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.muted,
        paddingHorizontal: sp.md,
        paddingVertical: sp.xs,
      }}
    >
      <Text style={[t.micro, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}
