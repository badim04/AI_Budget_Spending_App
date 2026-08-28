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
import { Banner, Tile, TileGrid } from '../../src/components/ui/Tiles';
import { Button, Card } from '../../src/components/ui/Primitives';
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

      {/*
        Six ways in, one grid.

        This was two tiles and then four full-width cards stacked under a
        heading — which said, structurally, that snapping a receipt was a
        different kind of thing from importing a statement. It is not. They are
        six routes to the same place, and a grid says so while a column of
        banners says "read all of these in order".

        Status that changes what you would tap lives in the tag: Gmail says
        whether it is connected, batch says how far through it is. Status that
        is only reassurance lives under the grid, once.
      */}
      <View style={{ marginTop: sp.lg }}>
        <TileGrid ideal={3}>
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
          <Tile
            tone="green"
            tag="PDF · Excel"
            title="Bank statement"
            subtitle="A whole month at once, checked against the bank's own totals"
            glyph="📄"
            index={2}
            onPress={() => router.push('/import')}
          />
          <Tile
            tone="teal"
            tag={
              batchBusy
                ? batchBusy.total > 0
                  ? `${batchBusy.done}/${batchBusy.total}`
                  : 'Opening'
                : 'Up to 20'
            }
            title="Scan several"
            subtitle="Read together, confirmed on one screen before anything saves"
            glyph="🗂️"
            index={3}
            onPress={() => void runBatch()}
          />
          <Tile
            tone="blue"
            tag={busy === 'library' ? 'Working' : 'Photos'}
            title="From your photos"
            subtitle="A receipt you already saved"
            glyph="🖼️"
            index={4}
            onPress={() => runCapture('library')}
          />
          <Tile
            tone="amber"
            tag={
              gmailReady ? 'Connected' : gmailConfigured() ? 'Set up' : 'Needs client ID'
            }
            title="Gmail"
            subtitle={gmailReady ? 'Sync bank alerts and receipts' : 'Read-only inbox scan'}
            glyph="📧"
            index={5}
            onPress={() => router.push(gmailReady ? '/review' : '/settings')}
          />
        </TileGrid>
      </View>

      {/* The one piece of copy that earns trust rather than describing a
          button, so it survives the move to tiles. */}
      <Banner
        tone="blue"
        glyph="🔒"
        title="Nothing leaves this phone without you"
        body="Gmail access is read-only and scans only bank alerts and merchant receipts. Finlo never sends mail, and receipts stay on the device."
        style={{ marginTop: sp.md }}
      />

    </ScrollView>
  );
}
