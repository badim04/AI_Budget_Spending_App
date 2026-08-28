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
import {
  ScrollView,
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
  Platform,
  Alert,
  StyleSheet,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { useTheme } from '../src/theme/ThemeProvider';
import { AmountText, Button, Card, Pill } from '../src/components/ui/Primitives';
import { FeatureCard, FeaturePill } from '../src/components/ui/FeatureCard';
import { DateField } from '../src/components/ui/DateField';
import { usePressScale } from '../src/theme/motion';
import { useAppStore } from '../src/store/useAppStore';
import { formatMoney, money, type CurrencyCode } from '../src/core/money';
import { formatDate, nowISO, today } from '../src/core/dates';
import { categorise, prettyMerchant, shouldAutoApply } from '../src/core/categorize';
import { dedupeKey } from '../src/db/schema';
import { countKeys, markDuplicates } from '../src/core/dedupe';
import { detectInternal, explainInternal, resolveInternalCategory } from '../src/core/internalTransfer';
import { classifyWithLlmDetailed, cappedConfidence, llmStatus } from '../src/ingest/llm';
import { PICKER_MIME_TYPES, readStatement, type StatementFormat } from '../src/ingest/statement/sources';
import {
  parseStatementGrid,
  summarise,
  withinRange,
  type ParsedStatement,
  type StatementRow,
} from '../src/ingest/statement/parse';
import { reconcileStatement, type Reconciliation } from '../src/ingest/statement/reconcile';
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
  /** Confident enough to file without asking — see `shouldAutoApply`. */
  settled: boolean;
  /** A move between the user's own pots, or interest earned in one. */
  internal: boolean;
}


/**
 * Base64 -> bytes.
 *
 * expo-file-system can only hand back a string, so a binary statement arrives
 * base64-encoded and has to be decoded before the PDF or XLSX reader sees it.
 */
function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const len = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((clean.length / 4) * 3 - len);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (CHARS.indexOf(clean[i]) << 18) |
      (CHARS.indexOf(clean[i + 1]) << 12) |
      ((CHARS.indexOf(clean[i + 2]) & 63) << 6) |
      (CHARS.indexOf(clean[i + 3]) & 63);
    if (p < out.length) out[p++] = (n >> 16) & 255;
    if (p < out.length) out[p++] = (n >> 8) & 255;
    if (p < out.length) out[p++] = n & 255;
  }
  return out;
}

export default function ImportScreen() {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const insets = useSafeAreaInsets();

  const allAccounts = useAppStore((s) => s.accounts);
  const accounts = useMemo(() => allAccounts.filter((a) => !a.archived), [allAccounts]);
  const categories = useAppStore((s) => s.categories);
  const transactions = useAppStore((s) => s.transactions);
  const settings = useAppStore((s) => s.settings);
  /**
   * Default on. Someone who does not use an autosave pot never sees a match,
   * so it costs them nothing; someone who does gets a statement that reads
   * like their actual spending instead of a round trip.
   */
  const ignoreInternal = settings.ignore_internal_transfers !== 'false';
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
  const [llmProgress, setLlmProgress] = useState('');
  const [sourceFormat, setSourceFormat] = useState<StatementFormat | null>(null);
  const [sourceSections, setSourceSections] = useState<string[]>([]);
  /**
   * How the parse compared with the totals the bank printed on the file.
   *
   * Held against the WHOLE file rather than the chosen window: it is a fact
   * about whether the file was read correctly, which narrowing a date range
   * neither improves nor invalidates.
   */
  const [check, setCheck] = useState<Reconciliation | null>(null);
  /**
   * Set only by the user tapping past a failed reconciliation.
   *
   * A mismatch means we read the file differently from the bank that wrote it,
   * so the default is to stop. It is not made impossible, because a bank whose
   * preamble we misparse would otherwise be permanently unimportable — but it
   * takes a deliberate tap against a screen that says exactly which figure
   * disagrees and by how much. Refusing silently and refusing absolutely are
   * different things; only the first one is the bug.
   */
  const [overrideMismatch, setOverrideMismatch] = useState(false);

  const account = accounts.find((a) => a.id === accountId);
  const currency = account?.currency ?? settings.display_currency ?? 'NGN';

  // How many of each key already exist, so a re-import of an overlapping window
  // is a no-op *and* three identical stamp-duty charges still import as three.
  const existingCounts = useMemo(
    () => countKeys(transactions.filter((x) => !x.deletedAt).map((x) => x.dedupeKey)),
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
        type: [...PICKER_MIME_TYPES, '*/*'],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;

      const asset = res.assets[0];
      const name = asset.name ?? 'statement';
      setFileName(name);

      // Read as BYTES, not text: a PDF and an .xlsx are binary, and decoding
      // them as UTF-8 destroys them before the parser ever sees them.
      const bytes =
        Platform.OS === 'web'
          ? new Uint8Array((await fetch(asset.uri).then((x) => x.arrayBuffer())) as ArrayBuffer)
          : base64ToBytes(
              await FileSystem.readAsStringAsync(asset.uri, {
                encoding: FileSystem.EncodingType.Base64,
              })
            );

      const source = readStatement(bytes, name, { currency });

      if (source.encrypted) {
        notify(
          'This PDF is password protected',
          source.warning ??
            'Open it once with the password and re-save an unlocked copy, then import that.'
        );
        return;
      }
      if (source.rows.length === 0) {
        notify('Could not read that file', source.warning ?? 'No readable rows found.');
        return;
      }

      const result = parseStatementGrid(source.rows, { currency, today: today() });
      setParsed(result);
      setSourceFormat(source.format);
      setSourceSections(source.sections);
      /**
       * Checked against the whole file, never the chosen window.
       *
       * Whether the file was read correctly is a property of the read. Narrowing
       * the date range afterwards is a deliberate choice and must not be able to
       * turn a failed reconciliation into a passing one.
       */
      setCheck(reconcileStatement(source.declared, result.rows));
      setOverrideMismatch(false);
      setFrom(result.from ?? '');
      setTo(result.to ?? '');
      setUsedLlm(0);

      if (result.rows.length === 0) {
        notify(
          'Could not read that file',
          result.problems[0]?.reason ??
            'The file was read but no date/description/amount columns were found.'
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
    const inWindow = withinRange(parsed.rows, from || null, to || null);
    const duplicates = markDuplicates(
      inWindow,
      (row) => dedupeKey(accountId, row.date, row.amountMinor, parsed.currency),
      existingCounts
    );

    return inWindow.map((row, index) => {
      // Autosave sweeps first: a leg of an OWealth round trip is neither
      // spending nor income, and asking about each one is pure noise.
      const internal = ignoreInternal ? detectInternal(row.description) : null;
      const internalCategoryId = internal
        ? resolveInternalCategory(internal, categories)
        : undefined;

      if (internal && internalCategoryId) {
        return {
          row,
          categoryId: internalCategoryId,
          reason: explainInternal(internal),
          duplicate: duplicates[index],
          settled: true,
          internal: true,
        };
      }

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
        duplicate: duplicates[index],
        settled: shouldAutoApply(suggestion),
        internal: false,
      };
    });
  }, [parsed, from, to, accountId, categoriseDeps, existingCounts, ignoreInternal, categories]);

  const fresh = staged.filter((s) => !s.duplicate);
  const duplicates = staged.length - fresh.length;
  const uncategorised = fresh.filter((s) => !s.categoryId).length;
  const settled = fresh.filter((s) => s.settled).length;
  const internalCount = fresh.filter((s) => s.internal).length;
  const totals = summarise(fresh.map((s) => s.row));
  const llm = llmStatus();

  /**
   * Reading the file differently from the bank that wrote it stops the import.
   *
   * Not a warning above an enabled button: the whole failure mode being guarded
   * is that a wrong amount looks exactly like a right one, so there is nothing
   * on the screen to catch the mistake if the button still works. The override
   * exists because a bank whose preamble we misparse would otherwise be
   * permanently unimportable — but it is a separate, deliberate tap made after
   * reading which figure disagrees and by how much.
   */
  const blocked = check?.status === 'mismatch' && !overrideMismatch;

  /** Ask the model about the rows nothing else recognised. Batched, opt-in. */
  const runLlm = useCallback(async () => {
    const unknown = fresh.filter((s) => !s.categoryId).map((s) => s.row.description);
    if (unknown.length === 0) return;
    setBusy(true);
    try {
      const run = await classifyWithLlmDetailed(unknown, categories, {
        onProgress: (done, total) => setLlmProgress(total > 1 ? `${done} of ${total}` : ''),
      });
      const filed = run.suggestions.filter((a) => a.categoryId);

      if (filed.length === 0) {
        // Say why. "No suggestions came back" with no reason cannot tell a dead
        // connection from an exhausted quota from a reply that would not parse.
        notify(
          'No suggestions came back',
          run.error ?? 'Those rows will go to the review queue.'
        );
        return;
      }

      const byDescriptor = new Map(run.suggestions.map((a) => [a.descriptor.toLowerCase(), a]));
      // Applied to the staged view only; nothing is written until confirm.
      setParsed((prev) => (prev ? { ...prev } : prev));
      llmApplied.current = byDescriptor;
      setUsedLlm(filed.length);

      if (run.error) notify(`${filed.length} categorised`, run.error);
    } finally {
      setBusy(false);
      setLlmProgress('');
    }
  }, [fresh, categories]);

  const llmApplied = React.useRef<Map<string, { categoryId: string | null; confidence: number }>>(
    new Map()
  );

  const resolveCategory = (s: Staged): string | undefined =>
    s.categoryId ?? llmApplied.current.get(s.row.description.toLowerCase())?.categoryId ?? undefined;

  const doImport = useCallback(async () => {
    if (!parsed || !account) return;
    // Belt and braces: the button is disabled, and the write still refuses.
    if (check?.status === 'mismatch' && !overrideMismatch) return;
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
          /**
           * Only the uncertain ones go to review.
           *
           * Everything used to arrive unreviewed on the principle that a bank
           * export is authoritative about amounts and never about categories.
           * True, but it meant a 162-row import asked for 162 confirmations,
           * including the ones matched by an explicit rule the user wrote. Now
           * a confident offline match arrives filed, and only genuine unknowns
           * and model guesses queue up. Everything stays editable in Activity.
           */
          reviewed: s.settled && !fromLlm,
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
  }, [parsed, account, fresh, duplicates, commitStaged, check, overrideMismatch]);

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

      {/* The screen used to open on a wall of grey and one button. This says
          what it can do before asking for anything, which is also the answer
          to "does it take my PDF?" — the most common question about it. */}
      <FeatureCard
        tone="primary"
        label="Whole months, in one go"
        style={{ marginTop: sp.md }}
        footer={
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
            <FeaturePill label="PDF" />
            <FeaturePill label="Excel" />
            <FeaturePill label="CSV" />
            <FeaturePill label="Password-protected PDF" />
          </View>
        }
      >
        <Text style={[t.heading, { color: c.feature.primary.fg, marginTop: sp.xs }]}>
          Export a statement from your bank app and drop it here.
        </Text>
        <Text style={[t.caption, { color: c.feature.primary.muted, marginTop: sp.sm }]}>
          Finlo reads it, files what it recognises, skips anything you already have, and only
          asks about the rest.
        </Text>
      </FeatureCard>

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
        <FilePicker
          busy={busy}
          fileName={parsed ? fileName : null}
          format={sourceFormat}
          sections={sourceSections}
          onPress={pickFile}
        />
      </View>

      {parsed && parsed.rows.length > 0 ? (
        <>
          {/* 3. window */}
          <Text style={[t.micro, { color: c.textMuted, marginTop: sp.xl }]}>DATE RANGE</Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: sp.sm }}>
            <View style={{ flex: 1 }}>
              <DateField value={from} onChange={setFrom} placeholder="From" clearable />
            </View>
            <Text style={[t.body, { color: c.textMuted, marginHorizontal: sp.sm, paddingBottom: sp.md }]}>→</Text>
            <View style={{ flex: 1 }}>
              <DateField value={to} onChange={setTo} placeholder="To" clearable />
            </View>
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
                {settled > 0 ? <Pill label={`${settled} auto-filed`} tone="good" /> : null}
                {internalCount > 0 ? (
                  <View style={{ marginLeft: sp.sm }}>
                    <Pill label={`${internalCount} internal`} tone="neutral" />
                  </View>
                ) : null}
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

            {internalCount > 0 ? (
              <Text style={[t.micro, { color: c.textMuted, marginTop: sp.md }]}>
                {internalCount} row{internalCount === 1 ? '' : 's'} moved between your own
                pots (autosave). Filed as transfers and left out of spending totals —
                turn this off in Settings if you want the raw ledger.
              </Text>
            ) : null}

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
                    llmProgress
                      ? `Asking ${llm.name}… ${llmProgress}`
                      : usedLlm > 0
                        ? `${usedLlm} categorised by ${llm.name}`
                        : `Ask ${llm.name} about ${uncategorised} unknown`
                  }
                  variant="secondary"
                  onPress={runLlm}
                />
              </View>
            ) : null}
          </Card>

          {check ? (
            <ReconcilePanel check={check} currency={parsed.currency} />
          ) : null}

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
              label={
                blocked
                  ? "Import stopped — the totals don't match"
                  : saving
                    ? 'Importing…'
                    : `Import ${fresh.length} transaction${fresh.length === 1 ? '' : 's'}`
              }
              onPress={doImport}
              disabled={blocked || saving}
            />
          </View>

          {blocked ? (
            <View style={{ marginTop: sp.md }}>
              <Button
                label="Import anyway, with wrong amounts possible"
                variant="ghost"
                tone="critical"
                onPress={() => setOverrideMismatch(true)}
              />
            </View>
          ) : (
            <Text style={[t.micro, { color: c.textMuted, marginTop: sp.md, textAlign: 'center' }]}>
              {overrideMismatch
                ? 'Checked against nothing — you chose to import past a failed check.'
                : 'Everything lands unreviewed so you can correct categories in Activity.'}
            </Text>
          )}
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

/**
 * The one action this screen exists for, made to look like one.
 *
 * A plain full-width button reads as "submit"; a dashed panel reads as "put a
 * file here", which is what is actually being asked. Once a file is chosen it
 * becomes a summary of what was read, so the format and the sheet names —
 * often the first sign something parsed wrong — are visible without hunting.
 */
function FilePicker({
  busy,
  fileName,
  format,
  sections,
  onPress,
}: {
  busy: boolean;
  fileName: string | null;
  format: string | null;
  sections: string[];
  onPress: () => void;
}) {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const press = usePressScale(0.98);
  const chosen = fileName != null;

  return (
    <Animated.View style={press.style}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={chosen ? `Replace file ${fileName}` : 'Choose a statement file'}
        style={{
          borderRadius: r.lg,
          borderWidth: chosen ? StyleSheet.hairlineWidth : 2,
          borderStyle: chosen ? 'solid' : 'dashed',
          borderColor: chosen ? c.border : c.accent,
          backgroundColor: chosen ? c.surface : c.accentSubtle,
          paddingVertical: chosen ? sp.lg : sp.xl,
          paddingHorizontal: sp.lg,
          alignItems: 'center',
          opacity: busy ? 0.7 : 1,
        }}
      >
        <Text style={{ fontSize: chosen ? 22 : 30 }}>{busy ? '⏳' : chosen ? '📄' : '📥'}</Text>

        <Text
          style={[t.bodyStrong, { color: chosen ? c.textPrimary : c.accent, marginTop: sp.sm }]}
          numberOfLines={2}
        >
          {busy ? 'Reading it…' : chosen ? fileName : 'Choose a statement file'}
        </Text>

        <Text style={[t.micro, { color: c.textMuted, marginTop: 4, textAlign: 'center' }]}>
          {chosen
            ? `Read as ${(format ?? '').toUpperCase()}${sections.length ? ` · ${sections.join(', ')}` : ''} · tap to replace`
            : 'PDF, Excel or CSV from your bank app'}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * What the bank said, beside what we read.
 *
 * The point of this panel is that it is legible when it passes, not only when
 * it fails. A check nobody ever sees until the day it stops them reads as the
 * app breaking; a check that quietly says "126 payments out, and we found 126"
 * on every good import is the reason the bad one is believed.
 *
 * Rows are two columns rather than a sentence per figure, because the question
 * being answered is "are these the same number", and two numbers side by side
 * answer it faster than any wording.
 */
function ReconcilePanel({
  check,
  currency,
}: {
  check: Reconciliation;
  currency: CurrencyCode;
}) {
  const { c, type: t, space: sp, radius: r } = useTheme();

  const failed = check.status === 'mismatch';
  const tone = failed ? c.critical : check.status === 'ok' ? c.good : c.textMuted;

  const show = (value: number, kind: 'money' | 'count') =>
    kind === 'money' ? formatMoney(money(value, currency)) : String(value);

  return (
    <View
      style={{
        marginTop: sp.lg,
        borderRadius: r.lg,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: failed ? c.critical : c.border,
        backgroundColor: failed ? c.criticalSubtle : c.surface,
        padding: sp.lg,
      }}
    >
      <View style={styles.spread}>
        <Text style={[t.micro, { color: c.textMuted }]}>CHECKED AGAINST THE STATEMENT</Text>
        <Text style={[t.micro, { color: tone }]}>
          {failed ? 'DOES NOT MATCH' : check.status === 'ok' ? 'MATCHES' : 'NOTHING TO CHECK'}
        </Text>
      </View>

      <Text style={[t.body, { color: failed ? c.critical : c.textSecondary, marginTop: sp.sm }]}>
        {check.summary}
      </Text>

      {check.checks.length > 0 ? (
        <View style={{ marginTop: sp.lg }}>
          <View style={[styles.spread, { paddingBottom: sp.xs }]}>
            <Text style={[t.micro, { color: c.textMuted, flex: 1 }]} />
            <Text style={[t.micro, { color: c.textMuted, width: 110, textAlign: 'right' }]}>
              STATEMENT
            </Text>
            <Text style={[t.micro, { color: c.textMuted, width: 110, textAlign: 'right' }]}>
              READ
            </Text>
          </View>

          {check.checks.map((row) => (
            <View
              key={row.label}
              style={[
                styles.spread,
                {
                  paddingVertical: sp.sm,
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: c.border,
                },
              ]}
            >
              <Text style={[t.caption, { color: c.textSecondary, flex: 1 }]}>{row.label}</Text>
              <Text
                style={[t.caption, { color: c.textSecondary, width: 110, textAlign: 'right' }]}
                numberOfLines={1}
              >
                {show(row.declared, row.kind)}
              </Text>
              <Text
                style={[
                  t.caption,
                  {
                    color: row.ok ? c.textPrimary : c.critical,
                    width: 110,
                    textAlign: 'right',
                    fontVariant: ['tabular-nums'],
                  },
                ]}
                numberOfLines={1}
              >
                {show(row.actual, row.kind)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {check.unreadable.length > 0 ? (
        <Text style={[t.micro, { color: c.textMuted, marginTop: sp.md }]}>
          {check.unreadable.join(', ')} printed totals that do not add up on their own, so they
          were left out of this check rather than used to block the import.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
