/**
 * Category breakdown.
 *
 * A ranked bar list, not a pie. Humans compare lengths accurately and angles
 * badly, and the question here is always comparative — "is transport bigger
 * than food, and by how much?" A donut would also hide the long tail that the
 * bar list shows for free.
 *
 * Every row is directly labelled with its name and amount, so colour is never
 * the only thing carrying identity.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { formatMoney } from '../../core/money';
import type { CategoryTotal } from '../../core/types';

interface Props {
  rows: CategoryTotal[];
  onSelect?: (categoryId: string) => void;
  /** Show the +/- change against the previous period. */
  showChange?: boolean;
  maxRows?: number;
}

export function CategoryBreakdown({ rows, onSelect, showChange = true, maxRows = 8 }: Props) {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const visible = rows.slice(0, maxRows);
  const largest = visible[0]?.total.minor ?? 1;

  if (visible.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={[t.body, { color: c.textMuted }]}>Nothing recorded this period</Text>
      </View>
    );
  }

  return (
    <View>
      {visible.map((row) => {
        // Bars scale against the largest row, not against the total: it uses the
        // full width, which is what makes the ranking readable at a glance.
        const fraction = largest === 0 ? 0 : row.total.minor / largest;
        return (
          <Pressable
            key={row.categoryId}
            onPress={() => onSelect?.(row.categoryId)}
            style={({ pressed }) => [
              styles.row,
              { paddingVertical: sp.md, opacity: pressed ? 0.6 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${row.categoryName}, ${formatMoney(row.total)}, ${Math.round(row.share * 100)} percent`}
          >
            <View style={styles.rowHeader}>
              <View style={styles.rowLabel}>
                <Text style={{ fontSize: 15 }}>{row.icon}</Text>
                <Text style={[t.bodyStrong, { color: c.textPrimary, marginLeft: sp.sm }]} numberOfLines={1}>
                  {row.categoryName}
                </Text>
              </View>

              <View style={styles.rowValue}>
                <Text style={[t.bodyStrong, { color: c.textPrimary }]}>
                  {formatMoney(row.total, { compactDecimals: true })}
                </Text>
                {/* A change that rounds to 0% is noise, and "▼ 0%" reads as a
                    bug. Below one percent, show the share instead. */}
                {showChange &&
                row.changeVsPrevious != null &&
                Math.abs(row.changeVsPrevious) >= 0.01 ? (
                  <Text
                    style={[
                      t.micro,
                      {
                        // Rising spend is not automatically bad, so the change
                        // gets a neutral treatment unless it is a real jump.
                        color:
                          row.changeVsPrevious > 0.25
                            ? c.warning
                            : row.changeVsPrevious < -0.1
                              ? c.good
                              : c.textMuted,
                      },
                    ]}
                  >
                    {row.changeVsPrevious > 0 ? '▲' : '▼'}{' '}
                    {Math.abs(Math.round(row.changeVsPrevious * 100))}%
                  </Text>
                ) : (
                  <Text style={[t.micro, { color: c.textMuted }]}>
                    {Math.round(row.share * 100)}%
                  </Text>
                )}
              </View>
            </View>

            <View style={[styles.track, { backgroundColor: c.surfaceSunken, borderRadius: 4, marginTop: sp.sm }]}>
              <View
                style={{
                  width: `${Math.max(1.5, fraction * 100)}%`,
                  height: '100%',
                  backgroundColor: row.color,
                  borderRadius: 4,
                }}
              />
            </View>

            <Text style={[t.micro, { color: c.textMuted, marginTop: sp.xs }]}>
              {row.transactionCount} transaction{row.transactionCount === 1 ? '' : 's'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {},
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 12 },
  rowValue: { alignItems: 'flex-end' },
  track: { height: 6, overflow: 'hidden', width: '100%' },
  empty: { paddingVertical: 32, alignItems: 'center' },
});
