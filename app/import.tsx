/**
 * Bank statement import.
 *
 * Standing in for bank feeds. Pick a CSV your bank exported, choose the date
 * window, and everything is categorised and deduped against what you already
 * have before a single row is written.
 *
 * Nothing is saved until the confirm button. The screen deliberately shows the
 * date range, the totals and the duplicate count first, because importing the
 * wrong file or the wrong window is the mistake that actually happens, and it
 * is tedious to undo.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, View, Text, Pressable, TextInput, ActivityIndicator, Platform, Alert, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { useTheme } from '../src/theme/ThemeProvider';
import { AmountText, Button, Card, Pill } from '../src/components/ui/Primitives';
import { useAppStore } from '../src/store/useAppStore';
import { formatMoney, money } from '../src/core/money';
import { formatDate, nowISO, today } from '../src/core/dates';
import { categorise, prettyMerchant } from '../src/core/categorize';
import { dedupeKey } from '../src/db/schema';
import { classifyWithLlm, cappedConfidence, llmStatus } from '../src/ingest/llm';
import {
  parseStatement,
  summarise,
  withinRange,
  type ParsedStatement,
  type StatementRow,
} from '../src/ingest/statement/parse';
import type { Transaction } from '../src/core/types';

function notify(title: string, message?: string) {
  if (Platform.OS === 'web') globalThis.alert?.(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}

interface Staged {
  row: StatementRow;
  categoryId?: string;
  reason: string;
  duplicate: boolean;
}

export default function ImportScreen() {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const insets = useSafeAreaInsets();

  const allAccounts = useAppStore((s) => s.accounts);
  const accounts = useMemo(() => allAccounts.filter((a) => !a.archived), [allAccounts]);
  const categories = useAppStore((s) => s.categories);
  const transactions = useAppStore((s) => s.transactions);
  const settings = useAppStore((s) => s.settings);
  const categoriseDeps = useAppStore((s) => s.categoriseDeps);
  const commitStaged = useAppStore((s) => s.commitStaged);

  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [parsed, setParsed] = useState<ParsedStatement | null>(null);
  const [fileName, setFileName] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [usedLlm, setUsedLlm] = useState(0);

  const account = accounts.find((a) => a.id === accountId);
  const currency = account?.currency ?? settings.display_currency ?? 'NGN';

  // Existing dedupe keys, so a re-import of an overlapping window is a no-op.
  const existingKeys = useMemo(
    () => new Set(transactions.filter((x) => !x.deletedAt).map((x) => x.dedupeKey)),
    [transactions]
  );

  const pickFile = useCallback(async () => {
    if (!accountId) {
      notify('Choose an account first', 'Statements are imported into one account.');
      return;
    }
    setBusy(true);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel', '*/*'],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;

      const asset = res.assets[0];
      setFileName(asset.name ?? 'statement.csv');

      const text =
        Platform.OS === 'web'
          ? await fetch(asset.uri).then((x) => x.text())
          : await FileSystem.readAsStringAsync(asset.uri, {
              encoding: FileSystem.EncodingType.UTF8,
            });

      const result = parseStatement(text, { currency, today: today() });
      setParsed(result);
      setFrom(result.from ?? '');
      setTo(result.to ?? '');
      setUsedLlm(0);

      if (result.rows.length === 0) {
        notify(
          'Could not read that file',
          result.problems[0]?.reason ??
            'Export a CSV with date, description and amount columns.'
        );
      }
    } catch (e) {
      notify('Could not open the file', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [accountId, currency]);

  /** Rows in the chosen window, categorised and duplicate-flagged. */
  const staged: Staged[] = useMemo(() => {
    if (!parsed || !accountId) return [];
    const deps = categoriseDeps();
    return withinRange(parsed.rows, from || null, to || null).map((row) => {
      const key = dedupeKey(accountId, row.date, row.amountMinor, parsed.currency);
      const suggestion = categorise(
        {
          merchant: row.description,
          rawDescription: row.description,
          amountMinor: row.amountMinor,
          accountId,
          isInflow: row.amountMinor > 0,
        },
        deps
      );
      return {
        row,
        categoryId: suggestion?.categoryId,
        reason: suggestion?.reason ?? 'No match — will go to review',
        duplicate: existingKeys.has(key),
      };
    });
  }, [parsed, from, to, accountId, categoriseDeps, existingKeys]);

  const fresh = staged.filter((s) => !s.duplicate);
  const duplicates = staged.length - fresh.length;
  const uncategorised = fresh.filter((s) => !s.categoryId).length;
  const totals = summarise(fresh.map((s) => s.row));
  const llm = llmStatus();

  /** Ask the model about the rows nothing else recognised. Batched, opt-in. */
  const runLlm = useCallback(async () => {
    const unknown = fresh.filter((s) => !s.categoryId).map((s) => s.row.description);
    if (unknown.length === 0) return;
    setBusy(true);
    try {
      const answers = await classifyWithLlm(unknown, categories);
      if (answers.length === 0) {
        notify('No suggestions came back', 'Those rows will go to the review queue.');
        return;
      }
      const byDescriptor = new Map(answers.map((a) => [a.descriptor.toLowerCase(), a]));
      // Applied to the staged view only; nothing is written until confirm.
      setParsed((prev) => (prev ? { ...prev } : prev));
      llmApplied.current = byDescriptor;
      setUsedLlm(answers.filter((a) => a.categoryId).length);
    } finally {
      setBusy(false);
    }
  }, [fresh, categories]);

  const llmApplied = React.useRef<Map<string, { categoryId: string | null; confidence: number }>>(
    new Map()
  );

  const resolveCategory = (s: Staged): string | undefined =>
    s.categoryId ?? llmApplied.current.get(s.row.description.toLowerCase())?.categoryId ?? undefined;

  const doImport = useCallback(async () => {
    if (!parsed || !account) return;
    setSaving(true);
    try {
      const now = nowISO();
      const drafts: Array<Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>> = fresh.map((s) => {
        const categoryId = resolveCategory(s);
        const fromLlm = !s.categoryId && categoryId != null;
        return {
          accountId: account.id,
          kind: s.row.amountMinor > 0 ? 'income' : 'expense',
          amountMinor: s.row.amountMinor,
          currency: parsed.currency,
          date: s.row.date,
          merchant: prettyMerchant(s.row.description) || s.row.description,
          rawDescription: s.row.description,
          categoryId,
          source: 'csv_import',
          confidence: fromLlm ? 'low' : categoryId ? 'medium' : 'unreviewed',
          // Everything from a statement is reviewable. A bank export is
          // authoritative about amounts, never about categories.
          reviewed: false,
          tags: [],
          dedupeKey: dedupeKey(account.id, s.row.date, s.row.amountMinor, parsed.currency),
          pending: false,
          note: s.row.reference ? `Ref ${s.row.reference}` : undefined,
        };
      });

      const count = await commitStaged(drafts);
      notify(
        `Imported ${count} transaction${count === 1 ? '' : 's'}`,
        duplicates > 0 ? `${duplicates} already existed and were skipped.` : undefined
      );
      router.replace('/transactions');
    } catch (e) {
      notify('Import failed', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [parsed, account, fresh, duplicates, commitStaged]);

  const field = {
    color: c.textPrimary,
    backgroundColor: c.surfaceSunken,
    borderRadius: r.md,
    paddingHorizontal: sp.md,
    paddingVertical: sp.md,
    fontSize: 15,
    flex: 1,
  } as const;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.canvas }}
      contentContainerStyle={{
        paddingTop: insets.top + sp.lg,
        paddingBottom: insets.bottom + sp.xxl,
        paddingHorizontal: sp.lg,
        maxWidth: 640,
        width: '100%',
        alignSelf: 'center',
      }}
    >
      <View style={styles.spread}>
        <Text style={[t.title, { color: c.textPrimary }]}>Import a statement</Text>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Close">
          <Ionicons name="close" size={24} color={c.textMuted} />
        </Pressable>
      </View>

      <Text style={[t.body, { color: c.textSecondary, marginTop: sp.xs }]}>
        Export a CSV from your bank app, pick the date range, and Finlo categorises it and
        skips anything you already have.
      </Text>

      {/* 1. account */}
      <Text style={[t.micro, { color: c.textMuted, marginTop: sp.xl }]}>IMPORT INTO</Text>
      {accounts.length === 0 ? (
        <Card style={{ marginTop: sp.sm }}>
          <Text style={[t.body, { color: c.textSecondary }]}>
            Add an account in Settings first — a statement has to belong to one.
          </Text>
        </Card>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: sp.sm }}>
          {accounts.map((a) => (
            <Pressable
              key={a.id}
              onPress={() => setAccountId(a.id)}
              style={{
                paddingHorizontal: sp.lg,
                paddingVertical: sp.md,
                borderRadius: r.pill,
                backgroundColor: accountId === a.id ? c.accentSubtle : c.surface,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: accountId === a.id ? c.accent : c.border,
                marginRight: sp.sm,
                marginBottom: sp.sm,
              }}
            >
              <Text style={[t.caption, { color: accountId === a.id ? c.accent : c.textSecondary }]}>
                {a.name} · {a.currency}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* 2. file */}
      <View style={{ marginTop: sp.lg }}>
        <Button
          label={busy ? 'Working…' : parsed ? `Replace file (${fileName})` : 'Choose CSV file'}
          variant={parsed ? 'secondary' : 'primary'}
          icon="📄"
          onPress={pickFile}
        />
      </View>

      {parsed && parsed.rows.length > 0 ? (
        <>
          {/* 3. window */}
          <Text style={[t.micro, { color: c.textMuted, marginTop: sp.xl }]}>DATE RANGE</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: sp.sm }}>
            <TextInput value={from} onChangeText={setFrom} placeholder="From" placeholderTextColor={c.textMuted} autoCapitalize="none" style={field} />
            <Text style={[t.body, { color: c.textMuted, marginHorizontal: sp.sm }]}>→</Text>
            <TextInput value={to} onChangeText={setTo} placeholder="To" placeholderTextColor={c.textMuted} autoCapitalize="none" style={field} />
          </View>
          <Text style={[t.micro, { color: c.textMuted, marginTop: sp.sm }]}>
            File covers {formatDate(parsed.from!, 'medium')} → {formatDate(parsed.to!, 'medium')}
            {parsed.wasReversed ? ' · reordered to oldest first' : ''}
          </Text>

          {/* 4. summary */}
          <Card style={{ marginTop: sp.lg }}>
            <View style={styles.spread}>
              <Text style={[t.heading, { color: c.textPrimary }]}>
                {fresh.length} to import
              </Text>
              <View style={{ flexDirection: 'row' }}>
                {duplicates > 0 ? <Pill label={`${duplicates} duplicate`} tone="neutral" /> : null}
                {uncategorised > 0 ? (
                  <View style={{ marginLeft: sp.sm }}>
                    <Pill label={`${uncategorised} to review`} tone="warning" />
                  </View>
                ) : null}
              </View>
            </View>

            <View style={{ flexDirection: 'row', marginTop: sp.lg }}>
              <View style={{ flex: 1 }}>
                <Text style={[t.micro, { color: c.textMuted }]}>MONEY IN</Text>
                <AmountText value={money(totals.inflowMinor, parsed.currency)} size="body" color={c.inflow} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[t.micro, { color: c.textMuted }]}>MONEY OUT</Text>
                <AmountText value={money(totals.outflowMinor, parsed.currency)} size="body" />
              </View>
            </View>

            {parsed.problems.length > 0 ? (
              <Text style={[t.micro, { color: c.warning, marginTop: sp.md }]}>
                {parsed.problems.length} row{parsed.problems.length === 1 ? '' : 's'} skipped:{' '}
                {parsed.problems[0].reason}
              </Text>
            ) : null}

            {uncategorised > 0 && llm.configured ? (
              <View style={{ marginTop: sp.lg }}>
                <Button
                  label={
                    usedLlm > 0
                      ? `${usedLlm} categorised by ${llm.name}`
                      : `Ask ${llm.name} about ${uncategorised} unknown`
                  }
                  variant="secondary"
                  onPress={runLlm}
                />
              </View>
            ) : null}
          </Card>

          {/* 5. preview */}
          <Text style={[t.micro, { color: c.textMuted, marginTop: sp.xl }]}>PREVIEW</Text>
          <Card padded={false} style={{ marginTop: sp.sm }}>
            {staged.slice(0, 25).map((s, i) => {
              const category = categories.find((x) => x.id === resolveCategory(s));
              return (
                <View
                  key={`${s.row.line}_${i}`}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: sp.lg,
                    paddingVertical: sp.md,
                    opacity: s.duplicate ? 0.45 : 1,
                    borderBottomWidth: i === Math.min(staged.length, 25) - 1 ? 0 : StyleSheet.hairlineWidth,
                    borderBottomColor: c.border,
                  }}
                >
                  <Text style={{ fontSize: 15, marginRight: sp.md }}>{category?.icon ?? '❓'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[t.body, { color: c.textPrimary }]} numberOfLines={1}>
                      {prettyMerchant(s.row.description) || s.row.description}
                    </Text>
                    <Text style={[t.micro, { color: c.textMuted, marginTop: 2 }]} numberOfLines={1}>
                      {formatDate(s.row.date, 'short')} ·{' '}
                      {s.duplicate ? 'Already recorded' : category?.name ?? 'Needs a category'}
                    </Text>
                  </View>
                  <AmountText
                    value={money(s.row.amountMinor, parsed.currency)}
                    size="body"
                    color={s.row.amountMinor > 0 ? c.inflow : c.textPrimary}
                    signed={s.row.amountMinor > 0}
                  />
                </View>
              );
            })}
            {staged.length > 25 ? (
              <Text style={[t.micro, { color: c.textMuted, padding: sp.lg }]}>
                …and {staged.length - 25} more
              </Text>
            ) : null}
          </Card>

          <View style={{ marginTop: sp.xl }}>
            <Button
              label={saving ? 'Importing…' : `Import ${fresh.length} transaction${fresh.length === 1 ? '' : 's'}`}
              onPress={doImport}
            />
          </View>
          <Text style={[t.micro, { color: c.textMuted, marginTop: sp.md, textAlign: 'center' }]}>
            Everything lands unreviewed so you can correct categories in Activity.
          </Text>
        </>
      ) : null}

      {busy ? (
        <View style={{ marginTop: sp.xl, alignItems: 'center' }}>
          <ActivityIndicator color={c.accent} />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
