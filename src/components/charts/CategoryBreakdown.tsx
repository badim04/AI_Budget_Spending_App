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
import { tabularNumbers } from '../../theme/tokens';
import { compactChange } from '../../core/voice';
import type { CategoryTotal } from '../../core/types';

interface Props {
  rows: CategoryTotal[];
  /**
   * Two per row instead of a full-width list.
   *
   * A single column of wide rows is a table; a grid of small cards is
   * something you scan. The bar goes vertical-ish and the share leads, because
   * at half width the amount and the percentage are what fit and what matter.
   */
  grid?: boolean;
  /** The row comes too: "Other" needs its members, and the caller needs the name. */
  onSelect?: (categoryId: string, row: CategoryTotal) => void;
  /** Show the +/- change against the previous period. */
  showChange?: boolean;
  maxRows?: number;
}

export function CategoryBreakdown({ rows, onSelect, showChange = true, maxRows = 8, grid = false }: Props) {
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

  if (grid) {
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -sp.sm / 2 }}>
        {visible.map((row, i) => {
          const share = Math.round(row.share * 100);
          const previousMinor =
            row.changeVsPrevious == null || row.changeVsPrevious === -1
              ? 0
              : Math.round(row.total.minor / (1 + row.changeVsPrevious));
          const change = compactChange(row.total.minor, previousMinor);

          return (
            <View key={row.categoryId} style={{ width: '50%', paddingHorizontal: sp.sm / 2, paddingBottom: sp.md }}>
              <Pressable
                onPress={() => onSelect?.(row.categoryId, row)}
                disabled={!onSelect}
                accessibilityRole={onSelect ? 'button' : 'text'}
                accessibilityLabel={`${row.categoryName}, ${formatMoney(row.total)}, ${share} percent${onSelect ? '. Opens its transactions.' : ''}`}
                style={({ pressed }) => ({
                  backgroundColor: c.surface,
                  borderRadius: r.lg,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: c.border,
                  padding: sp.md,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 15,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: row.color + '26',
                    }}
                  >
                    <Text style={{ fontSize: 14 }}>{row.icon}</Text>
                  </View>
                  {showChange && change ? (
                    <Text
                      style={[
                        t.micro,
                        { marginLeft: 'auto', color: change.rising ? c.textMuted : c.good },
                      ]}
                    >
                      {change.rising ? '▲' : '▼'} {change.label}
                    </Text>
                  ) : null}
                </View>

                <Text style={[t.caption, { color: c.textSecondary, marginTop: sp.sm }]} numberOfLines={1}>
                  {row.categoryName}
                </Text>
                <Text style={[t.bodyStrong, tabularNumbers, { color: c.textPrimary, marginTop: 1 }]}>
                  {formatMoney(row.total, { compactDecimals: true })}
                </Text>

                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: sp.sm }}>
                  <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: c.surfaceSunken, overflow: 'hidden' }}>
                    <View
                      style={{
                        width: `${Math.max(2, share)}%`,
                        height: '100%',
                        backgroundColor: row.color,
                        borderRadius: 4,
                      }}
                    />
                  </View>
                  <Text style={[t.micro, tabularNumbers, { color: c.textMuted, marginLeft: sp.sm }]}>
                    {share}%
                  </Text>
                </View>
              </Pressable>
            </View>
          );
        })}
      </View>
    );
  }

  return (
    <View>
      {visible.map((row) => {
        // Bars scale against the largest row, not against the total: it uses the
        // full width, which is what makes the ranking readable at a glance.
        const fraction = largest === 0 ? 0 : row.total.minor / largest;
        // Reconstruct last period's figure from the stored ratio, so the badge
        // can apply the same floor and ceiling the rest of the app uses.
        const previousMinor =
          row.changeVsPrevious == null || row.changeVsPrevious === -1
            ? 0
            : Math.round(row.total.minor / (1 + row.changeVsPrevious));
        const change = compactChange(row.total.minor, previousMinor);
        return (
          <Pressable
            key={row.categoryId}
            onPress={() => onSelect?.(row.categoryId, row)}
            style={({ pressed }) => [
              styles.row,
              { paddingVertical: sp.md, opacity: pressed ? 0.6 : 1 },
            ]}
            accessibilityRole={onSelect ? 'button' : 'text'}
            accessibilityLabel={`${row.categoryName}, ${formatMoney(row.total)}, ${Math.round(row.share * 100)} percent${onSelect ? '. Opens its transactions.' : ''}`}
            disabled={!onSelect}
          >
            <View style={styles.rowHeader}>
              <View style={styles.rowLabel}>
                {/* The category's own colour, as a disc rather than a bare
                    emoji. It ties the row to its bar and gives the list a
                    rhythm to scan down. */}
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: row.color + '22',
                  }}
                >
                  <Text style={{ fontSize: 15 }}>{row.icon}</Text>
                </View>
                <Text style={[t.bodyStrong, { color: c.textPrimary, marginLeft: sp.md }]} numberOfLines={1}>
                  {row.categoryName}
                </Text>
              </View>

              <View style={styles.rowValue}>
                <Text style={[t.bodyStrong, { color: c.textPrimary }]}>
                  {formatMoney(row.total, { compactDecimals: true })}
                </Text>
                {/* Nothing at all when there is nothing to say. The share now
                    has its own column beside the bar, so this slot no longer
                    has to fall back to repeating it — and a percentage taken
                    off a tiny base is suppressed rather than shouted. */}
                {showChange && change ? (
                  <Text
                    style={[
                      t.micro,
                      {
                        // Rising spend is not automatically bad, so it stays
                        // neutral unless it is a real jump.
                        color: change.rising
                          ? row.changeVsPrevious != null && row.changeVsPrevious > 0.25
                            ? c.warning
                            : c.textMuted
                          : c.good,
                      },
                    ]}
                  >
                    {change.rising ? '▲' : '▼'} {change.label}
                  </Text>
                ) : null}
              </View>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: sp.sm }}>
              <View
                style={[
                  styles.track,
                  { backgroundColor: c.surfaceSunken, borderRadius: 5, flex: 1 },
                ]}
              >
                <View
                  style={{
                    width: `${Math.max(1.5, fraction * 100)}%`,
                    height: '100%',
                    backgroundColor: row.color,
                    borderRadius: 5,
                  }}
                />
              </View>
              {/* The share, spelled out. A bar shows rank; only a number shows
                  proportion, and "19% of everything" is the sentence people
                  actually take away. */}
              <Text
                style={[t.caption, tabularNumbers, { color: c.textSecondary, marginLeft: sp.md, minWidth: 38, textAlign: 'right' }]}
              >
                {Math.round(row.share * 100)}%
              </Text>
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
  track: { height: 10, overflow: 'hidden', width: '100%' },
  empty: { paddingVertical: 32, alignItems: 'center' },
});
