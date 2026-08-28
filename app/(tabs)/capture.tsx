/**
 * Capture.
 *
 * Four ways in, ordered by how little effort each costs. Manual entry is last on
 * purpose — it is the fallback, not the design. Everything above it routes
 * through `ingest/pipeline.ts`, so a receipt and a bank email are categorised
 * and deduped by identical code.
 */

import React, { useCallback, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useLayout } from '../../src/theme/layout';
import { Tile, TileGrid, type TileTone } from '../../src/components/ui/Tiles';
import { Button, Card, Pill, SectionHeader } from '../../src/components/ui/Primitives';
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
  const layout = useLayout();
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
        paddingHorizontal: layout.gutter,
        maxWidth: layout.maxWidth,
        width: '100%',
        alignSelf: 'center',
      }}
    >
      <Text style={[t.title, { color: c.textPrimary }]}>Add spending</Text>
      <Text style={[t.body, { color: c.textSecondary, marginTop: sp.xs }]}>
        The less of this you do by hand, the better the numbers get.
      </Text>

      {/* The two fastest ways in, side by side, before the long-form list.
          Five identical stacked cards made every option look equally likely;
          in practice people snap a receipt or type one in. */}
      <TileGrid>
        <Tile
          tone="violet"
          tag={busy === 'camera' ? 'Working' : Platform.OS === 'web' ? 'Photo' : 'Camera'}
          title="Snap a receipt"
          subtitle={ocr.configured ? `Read by ${ocr.name}` : 'Stored and searchable'}
          glyph="📸"
          index={0}
          onPress={() => runCapture('camera')}
        />
        <Tile
          tone="pink"
          tag="Fastest"
          title="Add manually"
          subtitle="Amount, merchant, done"
          glyph="✏️"
          index={1}
          onPress={() => router.push('/transaction/new')}
        />
      </TileGrid>

      <SectionHeader title="Bring it in automatically" />

      <Method
        icon="images-outline"
        tone="blue"
        title="Import from photos"
        body="Pick a receipt you already saved and process it the same way."
        action="Choose image"
        busy={busy === 'library'}
        onPress={() => runCapture('library')}
      />

      <Method
        icon="albums-outline"
        tone="teal"
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
        tone="amber"
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
        icon="document-text-outline"
        tone="green"
        title="Import a bank statement"
        body="A whole month at once. PDF, Excel or CSV from your bank app — Finlo files what it recognises and only asks about the rest."
        badge={{ label: 'PDF · Excel · CSV', tone: 'accent' as const }}
        action="Choose a statement"
        onPress={() => router.push('/import')}
      />

    </ScrollView>
  );
}

function Method({
  icon,
  tone = 'violet',
  title,
  body,
  action,
  onPress,
  busy,
  primary,
  badge,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  /** Each way in gets its own colour, so the list reads as choices. */
  tone?: TileTone;
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
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 21,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: c.tile[tone].bg,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.tile[tone].border,
            marginRight: sp.md,
          }}
        >
          <Ionicons name={icon} size={20} color={c.tile[tone].tag} />
        </View>
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
              <Button label={action} onPress={onPress} />
            )}
          </View>
        </View>
      </View>
    </Card>
  );
}
