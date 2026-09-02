/**
 * Spend trend with a forecast band.
 *
 * Actuals are a solid line; the forecast continues as a dashed line inside a
 * shaded prediction interval. The visual break between them is deliberate and
 * load-bearing — a forecast drawn in the same weight as history reads as fact,
 * and users will make decisions on it.
 *
 * One y-axis, always. Two measures of different scale get two charts.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { useTheme } from '../../theme/ThemeProvider';
import { formatMoney, type Money } from '../../core/money';
import { formatDate } from '../../core/dates';
import type { Forecast, ISODate } from '../../core/types';

export interface TrendPoint {
  date: ISODate;
  value: Money;
}

interface Props {
  actual: TrendPoint[];
  forecast?: Forecast;
  height?: number;
  width: number;
  /** Drawn as a horizontal reference line — usually the budget. */
  target?: Money;
  title?: string;
}

const PAD = { top: 16, right: 16, bottom: 28, left: 48 };

export function SpendTrendChart({
  actual,
  forecast,
  height = 220,
  width,
  target,
  title,
}: Props) {
  const { c, type: t, chart: ch, space: sp } = useTheme();
  const [active, setActive] = useState<number | null>(null);

  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = Math.max(1, height - PAD.top - PAD.bottom);

  const model = useMemo(() => {
    const forecastPoints = forecast?.points ?? [];
    const all = [
      ...actual.map((p) => p.value.minor),
      ...forecastPoints.map((p) => p.upper.minor),
      ...forecastPoints.map((p) => p.lower.minor),
      ...(target ? [target.minor] : []),
      0, // always anchor the axis at zero — a truncated money axis exaggerates change
    ];
    /**
     * The forecast's upper bound is not allowed to set the scale.
     *
     * A wide prediction interval — which is what an eight-month history with
     * two real months produces — reached ₦1.5M while actual spend was ₦270K.
     * Scaled to that, every real column collapsed to a few pixels along the
     * axis and the chart showed a big empty box with two lozenges in it. The
     * history is the subject; the forecast is context, and context that
     * squashes the subject is drawn wrong.
     *
     * So the axis is set by what actually happened (plus the budget line), and
     * the band is allowed to run past the top and be clipped.
     */
    const grounded = [
      ...actual.map((p) => p.value.minor),
      ...(target ? [target.minor] : []),
      0,
    ];
    const actualMax = Math.max(...grounded);
    const forecastMax = Math.max(...forecastPoints.map((p) => p.upper.minor), 0);

    // Give the forecast room to be visible, but never more than half again.
    const maxV = Math.max(actualMax, Math.min(forecastMax, actualMax * 1.5)) || 1;
    const minV = Math.min(...all, 0);
    const span = maxV - minV || 1;
    const total = actual.length + forecastPoints.length;

    const x = (i: number) => PAD.left + (total <= 1 ? plotW / 2 : (i / (total - 1)) * plotW);
    const y = (v: number) => PAD.top + plotH - ((v - minV) / span) * plotH;

    return { x, y, maxV, minV, forecastPoints, total };
  }, [actual, forecast, target, plotW, plotH]);

  if (actual.length === 0) {
    return (
      <View style={[styles.empty, { height, backgroundColor: c.surface }]}>
        <Text style={[t.caption, { color: c.textMuted }]}>Not enough history yet</Text>
      </View>
    );
  }

  const { x, y, forecastPoints } = model;
  const currency = actual[0].value.currency;

  const actualPath = actual
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.value.minor)}`)
    .join(' ');

  // The forecast line starts at the last actual point so there is no visual gap.
  const forecastPath = forecastPoints.length
    ? [
        `M${x(actual.length - 1)},${y(actual[actual.length - 1].value.minor)}`,
        ...forecastPoints.map((p, i) => `L${x(actual.length + i)},${y(p.value.minor)}`),
      ].join(' ')
    : '';

  const bandPath = forecastPoints.length
    ? [
        `M${x(actual.length - 1)},${y(actual[actual.length - 1].value.minor)}`,
        ...forecastPoints.map((p, i) => `L${x(actual.length + i)},${y(p.upper.minor)}`),
        ...[...forecastPoints].reverse().map((p, i) =>
          `L${x(actual.length + forecastPoints.length - 1 - i)},${y(p.lower.minor)}`
        ),
        'Z',
      ].join(' ')
    : '';

  const ticks = niceTicks(model.minV, model.maxV, 4);
  const activePoint =
    active == null
      ? null
      : active < actual.length
        ? { ...actual[active], isForecast: false }
        : {
            date: forecastPoints[active - actual.length].date,
            value: forecastPoints[active - actual.length].value,
            isForecast: true,
          };

  return (
    <View>
      {title ? (
        <View style={styles.header}>
          <Text style={[t.heading, { color: c.textPrimary }]}>{title}</Text>
          {forecast && forecast.method !== 'insufficient_data' ? (
            <Text style={[t.micro, { color: c.textMuted }]}>
              {forecastLabel(forecast)}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Relative wrapper so the hit-target overlay shares an origin with the
          drawing rather than with the card and its header above it. */}
      <View style={{ width, height }}>
      <Svg width={width} height={height}>
        <Defs>
          {/* A two-hue wash rather than one colour fading out. The line is
              the data; the fill is what makes the chart look like part of the
              app instead of a plot pasted into it. */}
          <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={c.accent} stopOpacity="0.38" />
            <Stop offset="0.55" stopColor={c.tile.pink.tag} stopOpacity="0.14" />
            <Stop offset="1" stopColor={c.tile.pink.tag} stopOpacity="0" />
          </LinearGradient>

          {/* The line itself runs violet into pink along its length. */}
          <LinearGradient id="stroke" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={c.accent} />
            <Stop offset="1" stopColor={c.tile.pink.tag} />
          </LinearGradient>

          {/* Columns run violet at the top into pink at the foot, so a tall
              bar is visibly a different thing from a short one. */}
          <ClipPath id="plot">
            <Rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} />
          </ClipPath>

          <LinearGradient id="bar" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={c.accent} />
            <Stop offset="1" stopColor={c.tile.pink.tag} stopOpacity={0.65} />
          </LinearGradient>

          <LinearGradient id="band" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={c.tile.teal.tag} stopOpacity="0.26" />
            <Stop offset="1" stopColor={c.tile.teal.tag} stopOpacity="0.04" />
          </LinearGradient>
        </Defs>

        {/* Gridlines sit behind everything and stay recessive. */}
        {ticks.map((v) => (
          <G key={v}>
            <Line
              x1={PAD.left}
              y1={y(v)}
              x2={width - PAD.right}
              y2={y(v)}
              stroke={c.grid}
              strokeWidth={1}
            />
            <SvgText
              x={PAD.left - 8}
              y={y(v) + 4}
              fill={c.textMuted}
              fontSize={10}
              textAnchor="end"
            >
              {formatMoney({ minor: v, currency }, { abbreviate: true, compactDecimals: true })}
            </SvgText>
          </G>
        ))}

        {target ? (
          <G>
            <Line
              x1={PAD.left}
              y1={y(target.minor)}
              x2={width - PAD.right}
              y2={y(target.minor)}
              stroke={c.warning}
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
            <SvgText x={width - PAD.right} y={y(target.minor) - 6} fill={c.warning} fontSize={10} textAnchor="end">
              Budget
            </SvgText>
          </G>
        ) : null}

        {/* Prediction interval, drawn before the columns so it reads as
            ground. Clipped, because the band may now run past the top. */}
        {bandPath ? (
          <G clipPath="url(#plot)">
            <Path d={bandPath} fill="url(#band)" />
          </G>
        ) : null}

        {/* History as rounded columns rather than a line.
            A line says "a continuous quantity that was measured at moments".
            Monthly spend is not that: it is a set of finished, separate
            totals, and a column each is both the truer shape and the one that
            can be compared by eye without following a stroke. The forecast
            stays a line, which keeps the visual break between what happened
            and what is guessed — that break is load-bearing. */}
        {actual.map((point, i) => {
          const top = y(point.value.minor);
          const base = y(model.minV);
          const barW = Math.max(
            6,
            Math.min(26, (width - PAD.left - PAD.right) / Math.max(actual.length, 1) - 10)
          );
          const h = base - top;
          const last = i === actual.length - 1;

          // A month with no spending gets nothing. Drawing a 2px stub for it
          // produced a row of little dots along the axis that read as data.
          if (h < 1) return null;

          return (
            <Rect
              key={point.date}
              x={x(i) - barW / 2}
              y={top}
              width={barW}
              height={h}
              // Clamped by height too: a short bar with an 8px radius is a
              // lozenge, not a column.
              rx={Math.min(barW / 2, h / 2, 8)}
              fill="url(#bar)"
              opacity={last ? 1 : 0.75}
            />
          );
        })}
        {forecastPath ? (
          <Path
            d={forecastPath}
            stroke={c.tile.teal.tag}
            strokeWidth={ch.lineWidth}
            fill="none"
            strokeDasharray="5 4"
            strokeOpacity={0.75}
          />
        ) : null}

        {/* The last actual point is always marked — it is where "now" is. */}
        <Circle
          cx={x(actual.length - 1)}
          cy={y(actual[actual.length - 1].value.minor)}
          r={4.5}
          fill={c.accent}
          stroke={c.surface}
          strokeWidth={3}
        />

        {activePoint ? (
          <G>
            <Line
              x1={x(active!)}
              y1={PAD.top}
              x2={x(active!)}
              y2={PAD.top + plotH}
              stroke={c.borderStrong}
              strokeWidth={1}
            />
            <Circle
              cx={x(active!)}
              cy={y(activePoint.value.minor)}
              r={5}
              fill={c.accent}
              stroke={c.surface}
              strokeWidth={3}
            />
          </G>
        ) : null}

      </Svg>

      {/*
        The hit targets live outside the SVG, not inside it.

        They were `<Rect onPressIn>` elements, which works on native and does
        nothing at all on web: react-native-svg does not wire press handlers on
        web primitives, so it logged "Unknown event handler property onPressOut"
        and the tooltip simply never appeared in a browser. A chart that
        responds to touch on a phone and ignores the mouse on a desktop is the
        kind of divergence that survives a whole release, because whoever built
        it was testing on one of the two.

        Plain RN Views behave identically on both, so the targets are an
        absolutely-positioned row on top of the drawing. `hover` is what a mouse
        does and `pressIn` is what a finger does, and both are wired.
      */}
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', left: 0, top: 0, width, height }}
      >
        {Array.from({ length: model.total }).map((_, i) => (
          <Pressable
            key={i}
            onHoverIn={() => setActive(i)}
            onHoverOut={() => setActive(null)}
            onPressIn={() => setActive(i)}
            onPressOut={() => setActive(null)}
            accessibilityRole="button"
            accessibilityLabel={`Point ${i + 1} of ${model.total}`}
            style={{
              position: 'absolute',
              left: x(i) - plotW / model.total / 2,
              top: PAD.top,
              width: Math.max(12, plotW / model.total),
              height: plotH,
            }}
          />
        ))}
      </View>
      </View>

      {activePoint ? (
        <View style={[styles.tooltip, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}>
          <Text style={[t.micro, { color: c.textMuted }]}>
            {formatDate(activePoint.date, 'medium')}
            {activePoint.isForecast ? ' · projected' : ''}
          </Text>
          <Text style={[t.bodyStrong, { color: c.textPrimary }]}>
            {formatMoney(activePoint.value)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function forecastLabel(f: Forecast): string {
  const method =
    f.method === 'holt_linear' ? 'trend' : f.method === 'seasonal_naive' ? 'seasonal' : 'average';
  const accuracy = f.mape == null ? '' : ` · ±${Math.round(f.mape * 100)}%`;
  return `Forecast: ${method}${accuracy} · ${f.confidence} confidence`;
}

/** Round axis ticks to values a human would choose. */
function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min || 1;
  const rawStep = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? magnitude * 10;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(Math.round(v));
  return out;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
  empty: { alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
  tooltip: {
    position: 'absolute',
    top: 0,
    right: 0,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
});
