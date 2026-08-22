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
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
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
    const maxV = Math.max(...all);
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

      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={c.series[0]} stopOpacity="0.22" />
            <Stop offset="1" stopColor={c.series[0]} stopOpacity="0" />
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

        {/* Prediction interval, drawn before the lines so it reads as ground. */}
        {bandPath ? <Path d={bandPath} fill={c.series[0]} fillOpacity={0.12} /> : null}

        <Path d={`${actualPath} L${x(actual.length - 1)},${y(model.minV)} L${x(0)},${y(model.minV)} Z`} fill="url(#fill)" />
        <Path d={actualPath} stroke={c.series[0]} strokeWidth={ch.lineWidth} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        {forecastPath ? (
          <Path
            d={forecastPath}
            stroke={c.series[0]}
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
          fill={c.series[0]}
          stroke={c.surface}
          strokeWidth={2}
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
              fill={c.series[0]}
              stroke={c.surface}
              strokeWidth={2}
            />
          </G>
        ) : null}

        {/* Invisible hit targets, wider than the marks. */}
        {Array.from({ length: model.total }).map((_, i) => (
          <Rect
            key={i}
            x={x(i) - plotW / model.total / 2}
            y={PAD.top}
            width={Math.max(12, plotW / model.total)}
            height={plotH}
            fill="transparent"
            onPressIn={() => setActive(i)}
            onPressOut={() => setActive(null)}
          />
        ))}
      </Svg>

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
