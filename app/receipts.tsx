/**
 * Batch receipt review.
 *
 * After a multi-select capture, every receipt lands here with whatever OCR read
 * off it. Nothing is written to the ledger until you press Add — a batch of
 * twenty receipts silently filing twenty wrong amounts would be far worse than
 * a batch that asks.
 *
 * Rows that OCR read confidently are pre-ticked; rows missing an amount are
 * not, and show what is wrong. So the common case is "glance, press Add", and
 * the failure case is impossible to miss.
 */

import React, { useMemo, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  Image,
  Pressable,
  TextInput,
  ActivityIndicator,
  Platform,
  Alert,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../src/theme/ThemeProvider';
import { Spot } from '../src/components/art/Spot';
import { Button, Card, Pill } from '../src/components/ui/Primitives';
import { useAppStore } from '../src/store/useAppStore';
import { currencyMeta, formatMoney, money, parseMoney } from '../src/core/money';
import { formatDate, today } from '../src/core/dates';
import { prettyMerchant } from '../src/core/categorize';
import { takeBatch, type PendingReceipt } from '../src/ingest/receipt/batchStore';

function notify(title: string, message?: string) {
  if (Platform.OS === 'web') globalThis.alert?.(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}

interface Draft {
  receiptId: string;
  fileUri: string;
  merchant: string;
  amountText: string;
  date: string;
  categoryId?: string;
  currency: string;
  note: string | null;
  include: boolean;
}

export default function BatchReceiptsScreen() {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ token?: string }>();

  const settings = useAppStore((s) => s.settings);
  const allCategories = useAppStore((s) => s.categories);
  const addTransaction = useAppStore.getState().addTransaction;
  const suggestCategory = useAppStore.getState().suggestCategory;
  const accounts = useAppStore((s) => s.accounts);

  const currency = settings.display_currency ?? 'NGN';
  const accountId = accounts.find((a) => !a.archived)?.id;

  // The batch is handed over through a module-level slot rather than route
  // params: a dozen receipts with OCR text will not fit in a URL.
  const pending = useMemo<PendingReceipt[]>(() => takeBatch(params.token ?? ''), [params.token]);

  const [drafts, setDrafts] = useState<Draft[]>(() =>
    pending.map((p) => {
      const decimals = currencyMeta(p.currency ?? currency).decimals;
      const merchant = p.merchant ? prettyMerchant(p.merchant) : '';
      const suggestion =
        merchant.length >= 3 && accountId
          ? suggestCategory({ merchant, amountMinor: -(p.totalMinor ?? 1), accountId })
          : null;
      return {
        receiptId: p.receiptId,
        fileUri: p.fileUri,
        merchant,
        amountText: p.totalMinor != null ? String(p.totalMinor / 10 ** decimals) : '',
        date: p.date ?? today(),
        categoryId: suggestion?.categoryId,
        currency: p.currency ?? currency,
        note: p.note,
        include: p.totalMinor != null,
      };
    })
  );

  const [saving, setSaving] = useState(false);

  const categories = useMemo(
    () => allCategories.filter((cat) => !cat.archived && cat.kind === 'expense').slice(0, 14),
    [allCategories]
  );

  const update = (id: string, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d) => (d.receiptId === id ? { ...d, ...patch } : d)));

  const ready = drafts.filter((d) => d.include && parseMoney(d.amountText, d.currency));
  const missing = drafts.filter((d) => !parseMoney(d.amountText, d.currency)).length;

  const commit = async () => {
    if (!accountId) {
      notify('Add an account first', 'Settings › Accounts, so there is somewhere to file these.');
      return;
    }
    if (ready.length === 0) {
      notify('Nothing selected', 'Tick at least one receipt with an amount.');
      return;
    }
    setSaving(true);
    try {
      for (const d of ready) {
        const amount = parseMoney(d.amountText, d.currency);
        if (!amount) continue;
        await addTransaction({
          accountId,
          amountMinor: -Math.abs(amount.minor),
          currency: d.currency,
          date: d.date,
          merchant: d.merchant || 'Receipt',
          categoryId: d.categoryId,
          receiptId: d.receiptId,
          source: 'receipt_scan',
        });
      }
      notify(
        `${ready.length} receipt${ready.length === 1 ? '' : 's'} added`,
        drafts.length > ready.length
          ? `${drafts.length - ready.length} left unticked — they are still saved and searchable.`
          : undefined
      );
      router.back();
    } catch (e) {
      notify('Could not save', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (pending.length === 0) {
    return (
      <View style={[styles.center, { flex: 1, backgroundColor: c.canvas, padding: sp.xl }]}>
        <Spot name="receipt" size={112} tone="teal" />
        <Text style={[t.heading, { color: c.textPrimary, marginTop: sp.lg, textAlign: 'center' }]}>
          Nothing to review
        </Text>
        <Text style={[t.body, { color: c.textSecondary, marginTop: sp.sm, textAlign: 'center' }]}>
          This batch has already been reviewed. Capture more from Add.
        </Text>
        <View style={{ marginTop: sp.xl }}>
          <Button label="Back" variant="secondary" onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + sp.lg,
          paddingBottom: sp.huge + 80,
          paddingHorizontal: sp.lg,
          width: '100%',
          maxWidth: 620,
          alignSelf: 'center',
        }}
      >
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[t.title, { color: c.textPrimary }]}>Review receipts</Text>
            <Text style={[t.caption, { color: c.textSecondary, marginTop: 2 }]}>
              {drafts.length} captured · {ready.length} ready to add
              {missing > 0 ? ` · ${missing} need an amount` : ''}
            </Text>
          </View>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={c.textMuted} />
          </Pressable>
        </View>

        {drafts.map((d, index) => {
          const parsedAmount = parseMoney(d.amountText, d.currency);
          const category = categories.find((cat) => cat.id === d.categoryId);

          return (
            <Card key={d.receiptId} style={{ marginTop: sp.lg }}>
              <View style={{ flexDirection: 'row' }}>
                {/* Tapping the image toggles inclusion — the whole row is the
                    control, so there is no tiny checkbox to miss. */}
                <Pressable
                  onPress={() => update(d.receiptId, { include: !d.include })}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: d.include }}
                  accessibilityLabel={`Receipt ${index + 1}`}
                >
                  <Image
                    source={{ uri: d.fileUri }}
                    style={{
                      width: 66,
                      height: 88,
                      borderRadius: r.md,
                      backgroundColor: c.surfaceSunken,
                      opacity: d.include ? 1 : 0.4,
                    }}
                    resizeMode="cover"
                  />
                  <View
                    style={{
                      position: 'absolute',
                      top: 4,
                      left: 4,
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: d.include ? c.accent : 'rgba(0,0,0,0.5)',
                    }}
                  >
                    <Ionicons
                      name={d.include ? 'checkmark' : 'ellipse-outline'}
                      size={13}
                      color={d.include ? c.onAccent : '#fff'}
                    />
                  </View>
                </Pressable>

                <View style={{ flex: 1, marginLeft: sp.md }}>
                  <TextInput
                    value={d.merchant}
                    onChangeText={(v) => update(d.receiptId, { merchant: v })}
                    placeholder="Merchant"
                    placeholderTextColor={c.textMuted}
                    style={[
                      t.bodyStrong,
                      {
                        color: c.textPrimary,
                        backgroundColor: c.surfaceSunken,
                        borderRadius: r.sm,
                        paddingHorizontal: sp.md,
                        paddingVertical: sp.sm,
                      },
                    ]}
                  />

                  <View style={{ flexDirection: 'row', marginTop: sp.sm }}>
                    <TextInput
                      value={d.amountText}
                      onChangeText={(v) => update(d.receiptId, { amountText: v, include: true })}
                      placeholder="0.00"
                      placeholderTextColor={c.textMuted}
                      keyboardType="decimal-pad"
                      style={[
                        t.bodyStrong,
                        {
                          flex: 1,
                          color: parsedAmount ? c.textPrimary : c.warning,
                          backgroundColor: c.surfaceSunken,
                          borderRadius: r.sm,
                          paddingHorizontal: sp.md,
                          paddingVertical: sp.sm,
                        },
                      ]}
                    />
                    <View style={{ width: sp.sm }} />
                    <TextInput
                      value={d.date}
                      onChangeText={(v) => update(d.receiptId, { date: v })}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={c.textMuted}
                      style={[
                        t.caption,
                        {
                          flex: 1,
                          color: c.textSecondary,
                          backgroundColor: c.surfaceSunken,
                          borderRadius: r.sm,
                          paddingHorizontal: sp.md,
                          paddingVertical: sp.sm,
                        },
                      ]}
                    />
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: sp.sm, flexWrap: 'wrap' }}>
                    {parsedAmount ? (
                      <Pill
                        label={formatMoney(money(-Math.abs(parsedAmount.minor), d.currency))}
                        tone="neutral"
                      />
                    ) : (
                      <Pill label="No amount read" tone="warning" icon="!" />
                    )}
                    {d.note ? (
                      <>
                        <View style={{ width: sp.sm }} />
                        <Pill label={d.note.slice(0, 34)} tone="warning" />
                      </>
                    ) : null}
                  </View>
                </View>
              </View>

              {/* category picker */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: sp.md }}>
                {categories.map((cat) => {
                  const active = cat.id === d.categoryId;
                  return (
                    <Pressable
                      key={cat.id}
                      onPress={() => update(d.receiptId, { categoryId: active ? undefined : cat.id })}
                      style={{
                        paddingHorizontal: sp.md,
                        paddingVertical: 6,
                        borderRadius: r.pill,
                        marginRight: sp.xs,
                        marginBottom: sp.xs,
                        backgroundColor: active ? c.accentSubtle : c.surfaceSunken,
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor: active ? c.accent : 'transparent',
                      }}
                    >
                      <Text style={[t.micro, { color: active ? c.accent : c.textSecondary }]}>
                        {cat.icon} {cat.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Card>
          );
        })}

        <Text style={[t.micro, { color: c.textMuted, marginTop: sp.lg, lineHeight: 16 }]}>
          Every image is already saved and searchable, whether or not you add it as a
          transaction. Unticked receipts stay in your receipt list.
        </Text>
      </ScrollView>

      {/* Sticky action bar: with a long list the button must not be a scroll away. */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: sp.lg,
          paddingTop: sp.md,
          paddingBottom: insets.bottom + sp.md,
          backgroundColor: c.surface,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: c.border,
        }}
      >
        {saving ? (
          <View style={[styles.center, { flexDirection: 'row', paddingVertical: sp.md }]}>
            <ActivityIndicator color={c.accent} />
            <Text style={[t.caption, { color: c.textMuted, marginLeft: sp.sm }]}>Saving…</Text>
          </View>
        ) : (
          <Button
            label={
              ready.length === 0
                ? 'Nothing selected'
                : `Add ${ready.length} transaction${ready.length === 1 ? '' : 's'}`
            }
            onPress={() => void commit()}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'flex-start' },
  center: { alignItems: 'center', justifyContent: 'center' },
});
