/**
 * Gmail sync and the import review queue.
 *
 * This is the screen that makes automatic capture safe to trust. Nothing from
 * an inbox is written until it appears here with its amount, its guessed
 * category, and the reason for that guess — and the user can drop any row.
 *
 * High-confidence rows arrive pre-ticked, so the common case is one tap on
 * "Import", not forty decisions.
 */

import React, { useCallback, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, Platform, Alert, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../src/theme/ThemeProvider';
import { AmountText, Button, Card, Pill } from '../src/components/ui/Primitives';
import { useAppStore } from '../src/store/useAppStore';
import { fetchCandidateEmails } from '../src/ingest/email/gmail';
import { ingestEmails, type StagedTransaction } from '../src/ingest/pipeline';
import { addMonths, formatDate, today } from '../src/core/dates';
import { money } from '../src/core/money';
import { amountColor } from '../src/theme/tokens';

function notify(title: string, message?: string) {
  if (Platform.OS === 'web') globalThis.alert?.(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}

export default function ReviewScreen() {
  const { c, type: t, space: sp } = useTheme();
  const insets = useSafeAreaInsets();

  // Select the raw array and narrow it in useMemo. A selector like
  // `s.accounts.filter(...)` builds a NEW array on every call, so zustand v5's
  // useSyncExternalStore never sees a stable snapshot and React loops forever
  // with "Maximum update depth exceeded".
  const allAccounts = useAppStore((s) => s.accounts);
  const accounts = React.useMemo(() => allAccounts.filter((a) => !a.archived), [allAccounts]);
  const categories = useAppStore((s) => s.categories);
  const transactions = useAppStore((s) => s.transactions);
  const settings = useAppStore((s) => s.settings);
  const categoriseDeps = useAppStore((s) => s.categoriseDeps);
  const commitStaged = useAppStore((s) => s.commitStaged);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [staged, setStaged] = useState<StagedTransaction[]>([]);
  const [skipped, setSkipped] = useState<Array<{ externalId: string; reason: string }>>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ranOnce, setRanOnce] = useState(false);

  const currency = settings.display_currency ?? 'NGN';

  const runSync = useCallback(async () => {
    if (accounts.length === 0) {
      notify('Add an account first', 'Settings › Accounts, so imported rows have somewhere to go.');
      return;
    }
    setBusy(true);
    setProgress('Searching your inbox…');
    try {
      // 90 days back on a first run: far enough to be useful, short enough that
      // the first sync finishes while the user is still watching.
      const since = settings.gmail_last_sync ?? addMonths(today(), -3);
      const fetched = await fetchCandidateEmails({
        since,
        max: 100,
        onProgress: (done, total) => setProgress(`Reading message ${done} of ${total}…`),
      });

      if (!fetched.ok) {
        notify('Sync failed', fetched.error);
        return;
      }
      setProgress('Matching against what you already have…');

      const report = ingestEmails(fetched.messages, {
        ...categoriseDeps(),
        accounts,
        defaultAccountId: accounts[0].id,
        defaultCurrency: currency,
        existingKeys: new Set(
          transactions.filter((x) => !x.deletedAt).map((x) => x.dedupeKey.split('|').slice(0, 4).join('|'))
        ),
        processedExternalIds: new Set(),
        today: today(),
      });

      setStaged(report.staged);
      setSkipped(report.skipped);
      // Pre-tick the confident ones; the rest are a deliberate decision.
      setSelected(new Set(report.staged.filter((s) => s.autoCommit).map((s) => s.externalId)));
      setRanOnce(true);
    } catch (e) {
      notify('Sync failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [accounts, categoriseDeps, currency, settings.gmail_last_sync, transactions]);

  async function importSelected() {
    const drafts = staged.filter((s) => selected.has(s.externalId)).map((s) => s.draft);
    const n = await commitStaged(drafts);
    await useAppStore.getState().setSetting('gmail_last_sync', today());
    notify(`${n} transaction${n === 1 ? '' : 's'} imported`, 'They are in Activity, marked for review.');
    router.replace('/transactions');
  }

  function toggle(externalId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(externalId)) next.delete(externalId);
      else next.add(externalId);
      return next;
    });
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.canvas }}
      contentContainerStyle={{
        paddingTop: insets.top + sp.lg,
        paddingBottom: insets.bottom + sp.xxl,
        paddingHorizontal: sp.lg,
        maxWidth: 620,
        width: '100%',
        alignSelf: 'center',
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={[t.title, { color: c.textPrimary }]}>Import from Gmail</Text>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Close">
          <Ionicons name="close" size={24} color={c.textMuted} />
        </Pressable>
      </View>

      {busy ? (
        <Card style={{ marginTop: sp.xl }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <ActivityIndicator color={c.accent} />
            <Text style={[t.body, { color: c.textSecondary, marginLeft: sp.md }]}>{progress}</Text>
          </View>
        </Card>
      ) : null}

      {!busy && !ranOnce ? (
        <Card style={{ marginTop: sp.xl }}>
          <Text style={[t.body, { color: c.textSecondary }]}>
            Finlo will search the last three months for bank alerts and merchant receipts,
            match them against what you already have, and show you everything before anything
            is saved.
          </Text>
          <View style={{ marginTop: sp.lg }}>
            <Button label="Search my inbox" onPress={runSync} />
          </View>
        </Card>
      ) : null}

      {!busy && ranOnce && staged.length === 0 ? (
        <Card style={{ marginTop: sp.xl }}>
          <Text style={[t.body, { color: c.textPrimary }]}>Nothing new found.</Text>
          <Text style={[t.caption, { color: c.textMuted, marginTop: sp.xs }]}>
            {skipped.length > 0
              ? `${skipped.length} message${skipped.length === 1 ? '' : 's'} were skipped — already imported, or not transactions.`
              : 'No bank alerts or receipts matched in the search window.'}
          </Text>
          <View style={{ marginTop: sp.lg }}>
            <Button label="Search again" variant="secondary" onPress={runSync} />
          </View>
        </Card>
      ) : null}

      {staged.length > 0 ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: sp.lg }}>
            <Text style={[t.caption, { color: c.textSecondary, flex: 1 }]}>
              {selected.size} of {staged.length} selected
            </Text>
            <Pressable
              onPress={() =>
                setSelected(
                  selected.size === staged.length
                    ? new Set()
                    : new Set(staged.map((s) => s.externalId))
                )
              }
              hitSlop={8}
            >
              <Text style={[t.caption, { color: c.accent }]}>
                {selected.size === staged.length ? 'Select none' : 'Select all'}
              </Text>
            </Pressable>
          </View>

          {staged.map((row) => {
            const isSelected = selected.has(row.externalId);
            const category = categories.find((cat) => cat.id === row.draft.categoryId);
            return (
              <Pressable key={row.externalId} onPress={() => toggle(row.externalId)}>
                <Card style={{ marginTop: sp.md, borderColor: isSelected ? c.accent : c.border }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                    <Ionicons
                      name={isSelected ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={isSelected ? c.accent : c.textMuted}
                      style={{ marginRight: sp.md, marginTop: 2 }}
                    />
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={[t.bodyStrong, { color: c.textPrimary, flex: 1 }]} numberOfLines={1}>
                          {row.draft.merchant}
                        </Text>
                        <AmountText
                          value={money(row.draft.amountMinor, row.draft.currency)}
                          size="body"
                          color={amountColor(c, row.draft.amountMinor)}
                          signed={row.draft.amountMinor > 0}
                        />
                      </View>
                      <Text style={[t.micro, { color: c.textMuted, marginTop: 2 }]}>
                        {formatDate(row.draft.date, 'medium')}
                        {category ? ` · ${category.icon} ${category.name}` : ' · Uncategorised'}
                      </Text>
                      <View style={{ flexDirection: 'row', marginTop: sp.sm }}>
                        <Pill
                          label={row.autoCommit ? 'Confident' : 'Check this'}
                          tone={row.autoCommit ? 'good' : 'warning'}
                        />
                      </View>
                      {row.rationale.map((line, i) => (
                        <Text key={i} style={[t.micro, { color: c.textMuted, marginTop: 4 }]}>
                          {line}
                        </Text>
                      ))}
                    </View>
                  </View>
                </Card>
              </Pressable>
            );
          })}

          <View style={{ marginTop: sp.xl }}>
            <Button
              label={`Import ${selected.size} transaction${selected.size === 1 ? '' : 's'}`}
              onPress={importSelected}
            />
          </View>

          {skipped.length > 0 ? (
            <Text style={[t.micro, { color: c.textMuted, marginTop: sp.lg }]}>
              {skipped.length} message{skipped.length === 1 ? '' : 's'} skipped:{' '}
              {[...new Set(skipped.map((s) => s.reason))].join(', ')}
            </Text>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}
