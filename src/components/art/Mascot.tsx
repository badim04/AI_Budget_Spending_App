/**
 * Fin — the Finlo mascot.
 *
 * A small purple coin-creature. Drawn rather than imported: vector paths cost
 * nothing to ship, scale to any size, recolour with the theme, and never need
 * an asset pipeline or a designer round-trip for a new pose. A PNG would be
 * prettier and would also be four files per pose, wrong in dark mode, and
 * fixed at one size.
 *
 * Five poses, each earning its place by appearing somewhere specific:
 *
 *   `wave`      empty states and the greeting — "nothing here yet, hello"
 *   `celebrate` a goal reached, a queue cleared
 *   `think`     something needs a decision
 *   `rest`      nothing to do, deliberately calm rather than sad
 *   `alert`     spending worth a second look
 *
 * The character reads at 40px, which is the real constraint: two eyes, a
 * mouth, and a silhouette. Anything more disappears at the size it is used.
 */

import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Stop } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeProvider';

export type MascotPose = 'wave' | 'celebrate' | 'think' | 'rest' | 'alert';

export function Mascot({
  pose = 'wave',
  size = 96,
  /** Overrides the brand purple — used on a coloured card. */
  tint,
}: {
  pose?: MascotPose;
  size?: number;
  tint?: string;
}) {
  const { c } = useTheme();
  const body = tint ?? c.feature.primary.bg;
  const dark = c.mode === 'dark';

  // Eyes: open by default, closed crescents at rest, wide when alert.
  const eyes =
    pose === 'rest' ? (
      <>
        <Path d="M34 44 q6 6 12 0" stroke="#1a1030" strokeWidth={3} strokeLinecap="round" fill="none" />
        <Path d="M54 44 q6 6 12 0" stroke="#1a1030" strokeWidth={3} strokeLinecap="round" fill="none" />
      </>
    ) : (
      <>
        <Circle cx={40} cy={45} r={pose === 'alert' ? 6.5 : 5} fill="#1a1030" />
        <Circle cx={60} cy={45} r={pose === 'alert' ? 6.5 : 5} fill="#1a1030" />
        {/* A highlight is the whole difference between alive and printed. */}
        <Circle cx={41.8} cy={43} r={1.8} fill="#ffffff" opacity={0.9} />
        <Circle cx={61.8} cy={43} r={1.8} fill="#ffffff" opacity={0.9} />
      </>
    );

  const mouth =
    pose === 'celebrate' ? (
      <Path d="M40 57 q10 12 20 0 q-10 5 -20 0" fill="#1a1030" />
    ) : pose === 'think' ? (
      <Path d="M44 60 h12" stroke="#1a1030" strokeWidth={3} strokeLinecap="round" />
    ) : pose === 'alert' ? (
      <Ellipse cx={50} cy={59} rx={5} ry={6} fill="#1a1030" />
    ) : (
      <Path d="M41 57 q9 9 18 0" stroke="#1a1030" strokeWidth={3.2} strokeLinecap="round" fill="none" />
    );

  return (
    <View accessibilityRole="image" accessibilityLabel="Fin, the Finlo mascot">
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id="finBody" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={body} stopOpacity={1} />
            <Stop offset="1" stopColor={body} stopOpacity={dark ? 0.72 : 0.86} />
          </LinearGradient>
        </Defs>

        {/* Shadow, so the character sits on the surface instead of floating. */}
        <Ellipse cx={50} cy={92} rx={26} ry={4.5} fill="#000" opacity={dark ? 0.35 : 0.1} />

        {/* Coin body: a rounded square reads friendlier than a circle and is
            more distinctive at a glance than yet another round avatar. */}
        <G>
          <Path
            d="M22 34 q0 -16 16 -16 h24 q16 0 16 16 v26 q0 16 -16 16 h-24 q-16 0 -16 -16 z"
            fill="url(#finBody)"
          />
          {/* Coin slot, tilted — the one detail that says "money". */}
          <Path d="M44 26 h12 q2 0 2 2 t-2 2 h-12 q-2 0 -2 -2 t2 -2 z" fill="#ffffff" opacity={0.35} />

          {eyes}
          {mouth}

          {/* Cheeks, on the happy poses only. */}
          {pose === 'celebrate' || pose === 'wave' ? (
            <>
              <Circle cx={30} cy={55} r={4} fill="#ff8fb1" opacity={0.5} />
              <Circle cx={70} cy={55} r={4} fill="#ff8fb1" opacity={0.5} />
            </>
          ) : null}
        </G>

        {/* Pose extras. */}
        {pose === 'wave' ? (
          <G>
            <Path
              d="M80 46 q10 -6 12 -16"
              stroke={body}
              strokeWidth={7}
              strokeLinecap="round"
              fill="none"
            />
            <Circle cx={92} cy={28} r={5.5} fill={body} />
          </G>
        ) : null}

        {pose === 'celebrate' ? (
          <G opacity={0.95}>
            <Circle cx={16} cy={22} r={3.5} fill="#f5a524" />
            <Circle cx={86} cy={18} r={3} fill="#12b981" />
            <Circle cx={78} cy={34} r={2.5} fill="#ec4899" />
            <Path d="M12 40 l4 -6 l4 6 z" fill="#3d7bff" />
          </G>
        ) : null}

        {pose === 'think' ? (
          <G opacity={0.9}>
            <Circle cx={84} cy={30} r={4} fill={body} opacity={0.45} />
            <Circle cx={92} cy={20} r={2.5} fill={body} opacity={0.3} />
          </G>
        ) : null}

        {pose === 'alert' ? (
          <G>
            <Circle cx={84} cy={26} r={11} fill="#f5a524" />
            <Path d="M84 20 v7" stroke="#3a2500" strokeWidth={3} strokeLinecap="round" />
            <Circle cx={84} cy={31.5} r={1.8} fill="#3a2500" />
          </G>
        ) : null}

        {pose === 'rest' ? (
          <G opacity={0.6}>
            <Path d="M78 30 h8 l-8 8 h8" stroke={body} strokeWidth={2.5} fill="none" strokeLinecap="round" />
            <Path d="M88 18 h6 l-6 6 h6" stroke={body} strokeWidth={2} fill="none" strokeLinecap="round" />
          </G>
        ) : null}
      </Svg>
    </View>
  );
}
