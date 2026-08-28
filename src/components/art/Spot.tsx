/**
 * Spot illustrations.
 *
 * Small vector scenes for the places a screen would otherwise be a heading and
 * a sentence: empty states, section headers, the corner of a tile. Same
 * reasoning as the mascot — drawn in SVG so they recolour with the theme, cost
 * nothing to ship, and stay sharp at any size.
 *
 * Each one is built from the tile palette rather than fixed hex, so a spot on
 * a green tile is green and the same component on a violet tile is violet. One
 * drawing, six moods.
 *
 * Deliberately simple: three or four shapes each. These sit at 56–120px and
 * anything more detailed turns to mud.
 */

import React from 'react';
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeProvider';
import type { TileTone } from '../ui/Tiles';

export type SpotName =
  | 'wallet'
  | 'target'
  | 'chart'
  | 'receipt'
  | 'envelope'
  | 'inbox'
  | 'calendar'
  | 'sparkles';

export function Spot({
  name,
  size = 96,
  tone = 'violet',
}: {
  name: SpotName;
  size?: number;
  tone?: TileTone;
}) {
  const { c } = useTheme();
  const palette = c.tile[tone];
  const ink = palette.tag;
  const soft = palette.border;
  const paper = c.mode === 'dark' ? '#ffffff' : '#ffffff';

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id={`spot-${name}`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={ink} stopOpacity={0.22} />
          <Stop offset="1" stopColor={ink} stopOpacity={0.06} />
        </LinearGradient>
      </Defs>

      {/* A soft blob behind every scene, so they share a silhouette. */}
      <Circle cx={50} cy={50} r={42} fill={`url(#spot-${name})`} />

      {name === 'wallet' ? (
        <G>
          <Rect x={24} y={36} width={52} height={34} rx={8} fill={ink} />
          <Rect x={24} y={30} width={44} height={14} rx={6} fill={ink} opacity={0.55} />
          <Circle cx={66} cy={53} r={5} fill={paper} />
        </G>
      ) : null}

      {name === 'target' ? (
        <G>
          <Circle cx={50} cy={52} r={22} fill="none" stroke={ink} strokeWidth={5} opacity={0.35} />
          <Circle cx={50} cy={52} r={12} fill="none" stroke={ink} strokeWidth={5} opacity={0.7} />
          <Circle cx={50} cy={52} r={4} fill={ink} />
          <Path d="M50 52 L78 26" stroke={ink} strokeWidth={4} strokeLinecap="round" />
          <Path d="M72 22 l10 -4 l-4 10 z" fill={ink} />
        </G>
      ) : null}

      {name === 'chart' ? (
        <G>
          <Rect x={26} y={54} width={12} height={22} rx={4} fill={ink} opacity={0.45} />
          <Rect x={44} y={40} width={12} height={36} rx={4} fill={ink} opacity={0.7} />
          <Rect x={62} y={28} width={12} height={48} rx={4} fill={ink} />
          <Path d="M26 34 q18 -10 34 -2 t22 -10" stroke={ink} strokeWidth={3} fill="none" strokeLinecap="round" opacity={0.5} />
        </G>
      ) : null}

      {name === 'receipt' ? (
        <G>
          <Path
            d="M32 24 h36 v50 l-6 -4 l-6 4 l-6 -4 l-6 4 l-6 -4 l-6 4 z"
            fill={paper}
            stroke={ink}
            strokeWidth={3}
            strokeLinejoin="round"
          />
          <Path d="M40 38 h20 M40 48 h20 M40 58 h12" stroke={ink} strokeWidth={3} strokeLinecap="round" />
        </G>
      ) : null}

      {name === 'envelope' ? (
        <G>
          <Rect x={22} y={34} width={56} height={36} rx={6} fill={ink} />
          <Path d="M22 40 l28 20 l28 -20" stroke={paper} strokeWidth={4} fill="none" strokeLinejoin="round" />
        </G>
      ) : null}

      {name === 'inbox' ? (
        <G>
          <Path d="M24 44 h14 l5 10 h14 l5 -10 h14 v22 q0 6 -6 6 h-40 q-6 0 -6 -6 z" fill={ink} />
          <Path d="M30 40 l20 -18 l20 18" stroke={ink} strokeWidth={4} fill="none" strokeLinecap="round" opacity={0.5} />
        </G>
      ) : null}

      {name === 'calendar' ? (
        <G>
          <Rect x={24} y={30} width={52} height={44} rx={8} fill={paper} stroke={ink} strokeWidth={3} />
          <Rect x={24} y={30} width={52} height={13} rx={8} fill={ink} />
          <Circle cx={38} cy={54} r={3.5} fill={ink} />
          <Circle cx={50} cy={54} r={3.5} fill={ink} opacity={0.5} />
          <Circle cx={62} cy={54} r={3.5} fill={ink} opacity={0.5} />
          <Circle cx={38} cy={65} r={3.5} fill={ink} opacity={0.5} />
          <Circle cx={50} cy={65} r={3.5} fill={ink} opacity={0.5} />
        </G>
      ) : null}

      {name === 'sparkles' ? (
        <G>
          <Path d="M50 24 l6 14 l14 6 l-14 6 l-6 14 l-6 -14 l-14 -6 l14 -6 z" fill={ink} />
          <Path d="M76 54 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 z" fill={ink} opacity={0.55} />
          <Circle cx={28} cy={30} r={3} fill={soft} />
        </G>
      ) : null}
    </Svg>
  );
}
