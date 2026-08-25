/**
 * Capture.
 *
 * Four ways in, ordered by how little effort each costs. Manual entry is last on
 * purpose — it is the fallback, not the design. Everything above it routes
 * through `ingest/pipeline.ts`, so a receipt and a bank email are categorised
 * and deduped by identical code.
 */

import React, { useCallback, useState } from 'react';
import { ScrollView, View, Text, ActivityIndicator, Alert, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Button, Card, Pill } from '../../src/components/ui/Primitives';
import { useAppStore } from '../../src/store/useAppStore';
import {
  CancelledError,
  PermissionDeniedError,
  captureReceipt,
  captureReceipts,
  type CaptureSource,
} from '../../src/ingest/receipt/capture';
import { putBatch, type PendingReceipt } from '../../src/ingest/receipt/batchStore';
import { ocrStatus } from '../../src/ingest/receipt/ocr';
import { gmailConfigured, isConnected } from '../../src/ingest/email/gmail';
import { currencyMeta } from '../../src/core/money';

/** Cross-platform alert — RN's Alert is a no-op in the browser. */
function notify(title: string, message?: string) {
  if (Platform.OS === 'web') {
    globalThis.alert?.(message ? `${title}\n\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
}

export default function CaptureScreen() {
  const { c, type: t, space: sp } = useTheme();
  const insets = useSafeAreaInsets();
  // Select the raw array and narrow it in useMemo. A selector like
  // `s.accounts.filter(...)` builds a NEW array on every call, so zustand v5's
  // useSyncExternalStore never sees a stable snapshot and React loops forever
  // with "Maximum update depth exceeded".
  const allAccounts = useAppStore((s) => s.accounts);
  const accounts = React.useMemo(() => allAccounts.filter((a) => !a.archived), [allAccounts]);
  const settings = useAppStore((s) => s.settings);
  const saveReceipt = useAppStore((s) => s.saveReceipt);

  const [busy, setBusy] = useState<CaptureSource | null>(null);
  const [batchBusy, setBatchBusy] = useState<{ done: number; total: number } | null>(null);
  const [gmailReady, setGmailReady] = useState<boolean | null>(null);

  const currency = settings.display_currency ?? 'NGN';
  const ocr = ocrStatus();

  React.useEffect(() => {
    isConnected().then(setGmailReady).catch(() => setGmailReady(false));
  }, []);

  const runCapture = useCallback(
    async (source: CaptureSource) => {
      if (accounts.length === 0) {
        notify('Add an account first', 'Settings › Accounts, so there is somewhere to file it.');
        return;
      }
      setBusy(source);
      try {
        const id = `rcpt_${Date.now().toString(36)}`;
        const outcome = await captureReceipt(source, { defaultCurrency: currency, id });
        await saveReceipt(outcome.receipt);

        if (outcome.ocrNote) notify('Receipt saved', outcome.ocrNote);

        // Straight into the confirm form with whatever was read prefilled. The
        // user is already holding the receipt, so this is the cheapest moment
        // to check the numbers.
        const decimals = currencyMeta(outcome.receipt.currency ?? currency).decimals;
        router.push({
          pathname: '/transaction/new',
          params: {
            receiptId: outcome.receipt.id,
            amount:
              outcome.receipt.totalMinor != null
                ? String(outcome.receipt.totalMinor / 10 ** decimals)
                : '',
            merchant: outcome.receipt.merchant ?? '',
            date: outcome.receipt.date ?? '',
            currency: outcome.receipt.currency ?? currency,
          },
        });
      } catch (e) {
        if (e instanceof CancelledError) return;
        if (e instanceof PermissionDeniedError) {
          notify('Permission needed', `${e.message}. Enable it in your device settings.`);
          return;
        }
        notify('Could not capture', e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [accounts.length, currency, saveReceipt]
  );

  const runBatch = useCallback(async () => {
    if (accounts.length === 0) {
      notify('Add an account first', 'Settings › Accounts, so there is somewhere to file them.');
      return;
    }
    setBatchBusy({ done: 0, total: 0 });
    try {
      const stamp = Date.now().toString(36);
      const result = await captureReceipts('library', {
        defaultCurrency: currency,
        limit: 20,
        idFor: (i) => `rcpt_${stamp}_${i}`,
        onProgress: (p) => setBatchBusy({ done: p.done, total: p.total }),
      });

      // Save every image first. Even a receipt whose amount could not be read is
      // worth keeping — it stays attached and searchable.
      const pending: PendingReceipt[] = [];
      for (const outcome of result.outcomes) {
        await saveReceipt(outcome.receipt);
        pending.push({
          receiptId: outcome.receipt.id,
          fileUri: outcome.receipt.fileUri,
          merchant: outcome.receipt.merchant ?? null,
          totalMinor: outcome.receipt.totalMinor ?? null,
          date: outcome.receipt.date ?? null,
          currency: outcome.receipt.currency ?? currency,
          note: outcome.ocrNote,
        });
      }

      if (pending.length === 0) {
        notify('Nothing captured', result.failures[0]?.reason ?? 'No images were readable.');
        return;
      }
      if (result.failures.length > 0) {
        notify(
          `${result.failures.length} image${result.failures.length === 1 ? '' : 's'} skipped`,
          'The rest are ready to review.'
        );
      }

      router.push({ pathname: '/receipts', params: { token: putBatch(pending) } });
    } catch (e) {
      if (e instanceof CancelledError) return;
      if (e instanceof PermissionDeniedError) {
        notify('Permission needed', `${e.message}. Enable it in your device settings.`);
        return;
      }
      notify('Could not capture', e instanceof Error ? e.message : String(e));
    } finally {
      setBatchBusy(null);
    }
  }, [accounts.length, currency, saveReceipt]);

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
      <Text style={[t.title, { color: c.textPrimary }]}>Add spending</Text>
      <Text style={[t.body, { color: c.textSecondary, marginTop: sp.xs }]}>
        The less of this you do by hand, the better the numbers get.
      </Text>

      <Method
        icon="camera-outline"
        title="Snap a receipt"
        body={
          ocr.configured
            ? 'Photograph it and the total, merchant, date and line items are read automatically.'
            : 'Photograph it and the receipt is stored and searchable. Add an OCR key in Settings to have the amounts read for you.'
        }
        badge={ocr.configured ? { label: `OCR: ${ocr.name}`, tone: 'good' as const } : { label: 'Manual amounts', tone: 'neutral' as const }}
        action={Platform.OS === 'web' ? 'Choose a photo' : 'Open camera'}
        busy={busy === 'camera'}
        onPress={() => runCapture('camera')}
      />

      <Method
        icon="images-outline"
        title="Import from photos"
        body="Pick a receipt you already saved and process it the same way."
        action="Choose image"
        busy={busy === 'library'}
        onPress={() => runCapture('library')}
      />

      <Method
        icon="albums-outline"
        title="Scan several at once"
        body="Select up to 20 receipts. Each one is read, then you confirm the whole batch on one screen before anything is saved."
        badge={{ label: 'Batch', tone: 'accent' as const }}
        action={
          batchBusy
            ? batchBusy.total > 0
              ? `Reading ${batchBusy.done} of ${batchBusy.total}…`
              : 'Opening picker…'
            : 'Choose receipts'
        }
        busy={!!batchBusy}
        onPress={() => void runBatch()}
      />

      <Method
        icon="mail-outline"
        title="Connect Gmail"
        body="Read-only. Scans only bank alerts and merchant receipts, files them automatically, and never sends mail."
        badge={
          gmailReady
            ? { label: 'Connected', tone: 'good' as const }
            : gmailConfigured()
              ? { label: 'Ready to connect', tone: 'accent' as const }
              : { label: 'Needs a Google client ID', tone: 'warning' as const }
        }
        action={gmailReady ? 'Sync now' : 'Set up in Settings'}
        onPress={() => router.push(gmailReady ? '/review' : '/settings')}
      />

      <Method
        icon="create-outline"
        title="Add manually"
        body="Amount, merchant, done. The category is guessed from what you have filed before."
        action="New transaction"
        primary
        onPress={() => router.push('/transaction/new')}
      />
    </ScrollView>
  );
}

function Method({
  icon,
  title,
  body,
  action,
  onPress,
  busy,
  primary,
  badge,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  body: string;
  action: string;
  onPress: () => void;
  busy?: boolean;
  primary?: boolean;
  badge?: { label: string; tone: 'good' | 'warning' | 'accent' | 'neutral' };
}) {
  const { c, type: t, space: sp } = useTheme();
  return (
    <Card style={{ marginTop: sp.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <Ionicons name={icon} size={22} color={c.accent} style={{ marginRight: sp.md, marginTop: 2 }} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
            <Text style={[t.heading, { color: c.textPrimary, marginRight: sp.sm }]}>{title}</Text>
            {badge ? <Pill label={badge.label} tone={badge.tone} /> : null}
          </View>
          <Text style={[t.body, { color: c.textSecondary, marginTop: sp.xs }]}>{body}</Text>
          <View style={{ marginTop: sp.lg }}>
            {busy ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48 }}>
                <ActivityIndicator color={c.accent} />
                <Text style={[t.caption, { color: c.textMuted, marginLeft: sp.md }]}>
                  Reading the receipt…
                </Text>
              </View>
            ) : (
              <Button label={action} variant={primary ? 'primary' : 'secondary'} onPress={onPress} />
            )}
          </View>
        </View>
      </View>
    </Card>
  );
}
