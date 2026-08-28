/**
 * Export a report.
 *
 * Pick a period, pick a format, get a file. The preview underneath shows the
 * headline numbers before anything is generated, so it is obvious whether the
 * range actually contains what you expected — exporting an empty month and
 * discovering it after opening the file is a bad way to find out.
 */

import React, { useMemo, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Platform,
  Alert,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../src/theme/ThemeProvider';
import { Tile, TileGrid } from '../src/components/ui/Tiles';
import { AmountText, Button, Card, Pill } from '../src/components/ui/Primitives';
import { useAppStore } from '../src/store/useAppStore';
import { formatMoney } from '../src/core/money';
import { formatDate, today } from '../src/core/dates';
import {
  REPORT_PERIOD_LABELS,
  buildReport,
  reportRange,
  type ReportPeriod,
} from '../src/reports/build';
import {
  FORMAT_HINT,
  FORMAT_LABEL,
  exportReport,
  type ExportFormat,
} from '../src/reports/export';

const PERIODS: ReportPeriod[] = ['this_month', 'last_month', 'quarter', 'year', 'all'];
const FORMATS: ExportFormat[] = ['pdf', 'xlsx', 'csv'];

const FORMAT_ICON: Record<ExportFormat, React.ComponentProps<typeof Ionicons>['name']> = {
  pdf: 'document-text-outline',
  xlsx: 'grid-outline',
  csv: 'list-outline',
};

function notify(title: string, message?: string) {
  if (Platform.OS === 'web') globalThis.alert?.(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}

export default function ReportsScreen() {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const insets = useSafeAreaInsets();

  const transactions = useAppStore((s) => s.transactions);
  const categories = useAppStore((s) => s.categories);
  const accounts = useAppStore((s) => s.accounts);
  const budgets = useAppStore((s) => s.budgets);
  const settings = useAppStore((s) => s.settings);
  const fxTable = useAppStore((s) => s.fxTable);

  const [period, setPeriod] = useState<ReportPeriod>('this_month');
  const [busy, setBusy] = useState<ExportFormat | null>(null);

  const asOf = today();
  const displayCurrency = settings.display_currency ?? 'NGN';

  const earliest = useMemo(() => {
    const dates = transactions.filter((tx) => !tx.deletedAt).map((tx) => tx.date).sort();
    return dates[0] ?? null;
  }, [transactions]);

  const report = useMemo(
    () =>
      buildReport({
        transactions,
        categories,
        accounts,
        budgets,
        displayCurrency,
        fx: fxTable(),
        range: reportRange(period, asOf, earliest),
        asOf,
      }),
    [transactions, categories, accounts, budgets, displayCurrency, fxTable, period, asOf, earliest]
  );

  const run = async (format: ExportFormat) => {
    if (report.transactions.length === 0) {
      notify('Nothing to export', 'There are no transactions in this period.');
      return;
    }
    setBusy(format);
    try {
      const result = await exportReport(report, format);
      if (!result.shared) {
        notify('Saved', `${result.filename}\n\nSaved to the app's files.`);
      }
    } catch (e) {
      notify('Export failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.canvas }}
      contentContainerStyle={{
        paddingTop: insets.top + sp.lg,
        paddingBottom: insets.bottom + sp.xxl,
        paddingHorizontal: sp.lg,
        width: '100%',
        maxWidth: 560,
        alignSelf: 'center',
      }}
    >
      <View style={styles.header}>
        <Text style={[t.title, { color: c.textPrimary }]}>Export a report</Text>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Close">
          <Ionicons name="close" size={24} color={c.textMuted} />
        </Pressable>
      </View>

      {/* ------------------------------------------------------------ period */}
      <Text style={[t.micro, { color: c.textMuted, marginTop: sp.xl, marginBottom: sp.sm }]}>
        PERIOD
      </Text>
      <View style={styles.wrap}>
        {PERIODS.map((p) => {
          const active = p === period;
          return (
            <Pressable
              key={p}
              onPress={() => setPeriod(p)}
              style={{
                paddingHorizontal: sp.lg,
                paddingVertical: sp.sm + 2,
                borderRadius: r.pill,
                marginRight: sp.sm,
                marginBottom: sp.sm,
                backgroundColor: active ? c.accentSubtle : c.surface,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: active ? c.accent : c.border,
              }}
            >
              <Text style={[t.caption, { color: active ? c.accent : c.textSecondary }]}>
                {REPORT_PERIOD_LABELS[p]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* ----------------------------------------------------------- preview */}
      <Card style={{ marginTop: sp.md }}>
        <Text style={[t.micro, { color: c.textMuted }]}>
          {formatDate(report.range.start, 'medium').toUpperCase()} –{' '}
          {formatDate(report.range.end, 'medium').toUpperCase()}
        </Text>

        <View style={{ flexDirection: 'row', marginTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={[t.micro, { color: c.textMuted }]}>SPENT</Text>
            <AmountText value={report.totals.spend} size="title" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[t.micro, { color: c.textMuted }]}>EARNED</Text>
            <AmountText value={report.totals.income} size="title" color={c.inflow} />
          </View>
        </View>

        <View style={{ flexDirection: 'row', marginTop: sp.lg, flexWrap: 'wrap' }}>
          <Pill label={`${report.transactions.length} transactions`} />
          <View style={{ width: sp.sm }} />
          <Pill label={`${report.categories.length} categories`} />
          <View style={{ width: sp.sm }} />
          <Pill
            label={`Net ${formatMoney(report.totals.net, { compactDecimals: true, signed: true })}`}
            tone={report.totals.net.minor >= 0 ? 'good' : 'critical'}
          />
        </View>

        {report.transactions.length === 0 ? (
          <Text style={[t.caption, { color: c.warning, marginTop: sp.md }]}>
            Nothing recorded in this period — pick a wider range.
          </Text>
        ) : null}
      </Card>

      {/* ----------------------------------------------------------- formats */}
      <Text style={[t.micro, { color: c.textMuted, marginTop: sp.xl, marginBottom: sp.sm }]}>
        FORMAT
      </Text>

      {/* Three formats, three colours, side by side. They are alternatives to
          each other — a stacked list of identical cards makes them look like
          three steps. */}
      <TileGrid>
        {FORMATS.map((f, i) => {
          const tones = ['violet', 'green', 'blue'] as const;
          return (
            <Tile
              key={f}
              tone={tones[i % tones.length]}
              tag={busy === f ? 'Building…' : Platform.OS === 'web' ? 'Download' : 'Export'}
              title={FORMAT_LABEL[f]}
              subtitle={FORMAT_HINT[f]}
              glyph={f === 'pdf' ? '📕' : f === 'xlsx' ? '📗' : '📄'}
              index={i}
              onPress={busy ? undefined : () => void run(f)}
            />
          );
        })}
      </TileGrid>

      <Text style={[t.micro, { color: c.textMuted, marginTop: sp.md, lineHeight: 16 }]}>
        Everything is generated on your device — no data is uploaded to produce a report.
        {Platform.OS !== 'web'
          ? ' The share sheet lets you send it to WhatsApp, Drive, email or Files.'
          : ''}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
