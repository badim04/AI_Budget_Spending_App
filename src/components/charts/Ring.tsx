/**
 * A donut with the total in the hole.
 *
 * Every consumer finance app in the reference set opens on one of these, and
 * the reason is not decoration. A bar chart answers "which is biggest"; a ring
 * answers "how is the whole thing divided", which is the question someone
 * actually has about a month of spending. Putting the total in the middle means
 * the parts and the whole are read in one movement instead of two.
 *
 * Three decisions worth keeping:
 *
 * **Colour comes from the caller, never from here.** A segment's hue encodes a
 * category and is assigned by `theme/tokens`'s validated `series` set. A chart
 * that picked its own colours would be the second place deciding what green
 * means, and the two would drift.
 *
 * **Small slices are not drawn smaller than they can be seen.** Below a minimum
 * sweep a segment becomes invisible and the ring silently stops summing to the
 * total it is printed around. They are merged into a remainder instead, and the
 * caller is told how many, so the legend can say so.
 *
 * **It renders at any size and reads at 96px.** The stroke scales with the
 * radius rather than being fixed, so one component serves a headline ring on
 * Insights and a thumbnail on a budget envelope.
 */

import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeProvider';

export interface RingSlice {
  key: string;
  value: number;
  color: string;
}

/**
 * A slice thinner than this is a hairline that reads as an artefact rather than
 * a quantity, so anything under it joins the remainder.
 */
const MIN_SWEEP = 0.012;

export function Ring({
  slices,
  size = 168,
  thickness,
  centerLabel,
  centerValue,
  centerCaption,
  /** Drawn when there is nothing to divide, so the hole is never empty. */
  emptyLabel = 'Nothing yet',
}: {
  slices: RingSlice[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
  centerCaption?: string;
  emptyLabel?: string;
}) {
  const { c, type: t } = useTheme();

  const stroke = thickness ?? Math.max(10, Math.round(size * 0.13));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  const positive = slices.filter((s) => s.value > 0);
  const total = positive.reduce((sum, s) => sum + s.value, 0);

  /**
   * Merge everything too thin to see into one remainder.
   *
   * Dropping them instead would leave a gap in a ring drawn around a total that
   * still counts them, which is a chart disagreeing with its own centre.
   */
  const drawn: RingSlice[] = [];
  let remainder = 0;
  for (const slice of positive) {
    if (slice.value / total < MIN_SWEEP) remainder += slice.value;
    else drawn.push(slice);
  }
  if (remainder > 0) {
    drawn.push({ key: '__rest__', value: remainder, color: c.textMuted });
  }

  let offset = 0;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        {/* Rotated so the first slice starts at twelve o'clock. A ring that
            starts at three reads as having been cut, not as having begun. */}
        <G rotation={-90} originX={size / 2} originY={size / 2}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={c.surfaceSunken}
            strokeWidth={stroke}
            fill="none"
          />

          {total > 0
            ? drawn.map((slice) => {
                const sweep = (slice.value / total) * circumference;
                const dash = `${Math.max(0, sweep - 1)} ${circumference}`;
                const element = (
                  <Circle
                    key={slice.key}
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke={slice.color}
                    strokeWidth={stroke}
                    strokeDasharray={dash}
                    strokeDashoffset={-offset}
                    strokeLinecap="butt"
                    fill="none"
                  />
                );
                offset += sweep;
                return element;
              })
            : null}
        </G>
      </Svg>

      <View style={{ alignItems: 'center', paddingHorizontal: stroke }}>
        {total > 0 ? (
          <>
            {centerLabel ? (
              <Text style={[t.micro, { color: c.textMuted }]} numberOfLines={1}>
                {centerLabel.toUpperCase()}
              </Text>
            ) : null}
            {centerValue ? (
              <Text
                style={[
                  t.heading,
                  { color: c.textPrimary, fontVariant: ['tabular-nums'], marginTop: 1 },
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
              >
                {centerValue}
              </Text>
            ) : null}
            {centerCaption ? (
              <Text style={[t.micro, { color: c.textMuted, marginTop: 1 }]} numberOfLines={1}>
                {centerCaption}
              </Text>
            ) : null}
          </>
        ) : (
          <Text style={[t.micro, { color: c.textMuted, textAlign: 'center' }]}>{emptyLabel}</Text>
        )}
      </View>
    </View>
  );
}

/**
 * The key beside the ring, as rows rather than a wrapped strip of chips.
 *
 * A legend under a ring competes with it for the same glance. Beside it, in a
 * column, the ring is the shape and the legend is the reading of it — which is
 * also why the share is shown as a percentage here and as an angle there, and
 * never twice in the same register.
 */
export function RingLegend({
  slices,
  total,
  format,
  max = 4,
}: {
  slices: Array<RingSlice & { label: string }>;
  total: number;
  format: (value: number) => string;
  max?: number;
}) {
  const { c, type: t, space: sp } = useTheme();
  const shown = slices.slice(0, max);
  const rest = slices.length - shown.length;

  return (
    <View style={{ flex: 1 }}>
      {shown.map((slice) => (
        <View
          key={slice.key}
          style={{ flexDirection: 'row', alignItems: 'center', marginBottom: sp.sm }}
        >
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: slice.color,
              marginRight: sp.sm,
            }}
          />
          <Text style={[t.micro, { color: c.textSecondary, flex: 1 }]} numberOfLines={1}>
            {slice.label}
          </Text>
          <Text
            style={[t.micro, { color: c.textPrimary, fontVariant: ['tabular-nums'] }]}
            numberOfLines={1}
          >
            {total > 0 ? `${Math.round((slice.value / total) * 100)}%` : format(slice.value)}
          </Text>
        </View>
      ))}
      {rest > 0 ? (
        <Text style={[t.micro, { color: c.textMuted }]}>+{rest} more</Text>
      ) : null}
    </View>
  );
}
