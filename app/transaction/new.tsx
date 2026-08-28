/**
 * Add / edit a transaction.
 *
 * Ordered by how much the user cares: amount first and large, then who, then
 * what it was for. Category is a suggestion the user can accept by doing
 * nothing, which is the difference between logging spending for a week and
 * logging it for a year.
 *
 * Doubles as the receipt-confirmation screen — `receiptId` and the prefill
 * params arrive from the capture flow, and the photo is shown beside the fields
 * so the numbers can be checked against it without leaving the screen.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  TextInput,
  Pressable,
  Image,
  Platform,
  KeyboardAvoidingView,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Button, Card } from '../../src/components/ui/Primitives';
import { DateField } from '../../src/components/ui/DateField';
import { useAppStore } from '../../src/store/useAppStore';
import { currencyMeta, formatMoney, fromDecimal, money, parseMoney } from '../../src/core/money';
import { formatDate, isValidISODate, today } from '../../src/core/dates';
import { tabularNumbers } from '../../src/theme/tokens';

export default function TransactionFormScreen() {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    id?: string;
    receiptId?: string;
    amount?: string;
    merchant?: string;
    date?: string;
    currency?: string;
    note?: string;
  }>();

  // Select the raw array and narrow it in useMemo. A selector like
  // `s.accounts.filter(...)` builds a NEW array on every call, so zustand v5's
  // useSyncExternalStore never sees a stable snapshot and React loops forever
  // with "Maximum update depth exceeded".
  const allAccounts = useAppStore((s) => s.accounts);
  const allCategories = useAppStore((s) => s.categories);
  const accounts = useMemo(() => allAccounts.filter((a) => !a.archived), [allAccounts]);
  const categories = useMemo(() => allCategories.filter((cat) => !cat.archived), [allCategories]);
  const receipts = useAppStore((s) => s.receipts);
  const settings = useAppStore((s) => s.settings);
  const transactions = useAppStore((s) => s.transactions);
  const existing = useMemo(
    () => (params.id ? transactions.find((tx) => tx.id === params.id) : undefined),
    [transactions, params.id]
  );

  // Actions are created once inside `create()` and never change identity, so
  // subscribing to them only adds store listeners that can never fire.
  const {
    addTransaction,
    updateTransaction,
    deleteTransaction,
    suggestCategory,
    isDuplicate,
  } = useAppStore.getState();

  const isEditing = !!existing;
  const receipt = receipts.find((x) => x.id === (params.receiptId ?? existing?.receiptId));

  const [isInflow, setIsInflow] = useState(
    existing ? existing.amountMinor > 0 : false
  );
  const [amountText, setAmountText] = useState(() => {
    if (existing) return String(Math.abs(existing.amountMinor) / 10 ** currencyMeta(existing.currency).decimals);
    if (params.amount) return params.amount;
    return '';
  });
  const [merchant, setMerchant] = useState(existing?.merchant ?? params.merchant ?? '');
  const [date, setDate] = useState(existing?.date ?? params.date ?? today());
  const [note, setNote] = useState(existing?.note ?? params.note ?? '');
  const [accountId, setAccountId] = useState(
    existing?.accountId ?? accounts[0]?.id ?? ''
  );
  const [categoryId, setCategoryId] = useState<string | undefined>(existing?.categoryId);
  const [userPickedCategory, setUserPickedCategory] = useState(!!existing?.categoryId);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const account = accounts.find((a) => a.id === accountId);
  const currency = account?.currency ?? params.currency ?? settings.display_currency ?? 'NGN';
  const decimals = currencyMeta(currency).decimals;

  const parsedAmount = useMemo(() => parseMoney(amountText, currency), [amountText, currency]);
  const signedMinor = parsedAmount
    ? (isInflow ? 1 : -1) * Math.abs(parsedAmount.minor)
    : 0;

  // Suggest a category as the merchant is typed, but never overwrite a choice
  // the user has already made themselves.
  const suggestion = useMemo(() => {
    if (userPickedCategory || merchant.trim().length < 3 || !accountId) return null;
    return suggestCategory({ merchant, amountMinor: signedMinor || -1, accountId });
  }, [merchant, signedMinor, accountId, userPickedCategory, suggestCategory]);

  useEffect(() => {
    if (!userPickedCategory && suggestion) setCategoryId(suggestion.categoryId);
  }, [suggestion, userPickedCategory]);

  const duplicate =
    !isEditing && parsedAmount && accountId
      ? isDuplicate(accountId, date, signedMinor, currency)
      : false;

  const relevantCategories = useMemo(() => {
    const wanted = isInflow ? 'income' : 'expense';
    const matching = categories.filter((cat) => cat.kind === wanted);
    if (showAllCategories) return matching;
    // Leaf categories only in the compact view — picking "Food" when
    // "Groceries" exists produces a useless breakdown.
    const parentIds = new Set(matching.map((cat) => cat.parentId).filter(Boolean));
    return matching.filter((cat) => !parentIds.has(cat.id)).slice(0, 12);
  }, [categories, isInflow, showAllCategories]);

  async function handleSave() {
    setError(null);
    if (!accountId) return setError('Add an account first — Settings › Accounts.');
    if (!parsedAmount || parsedAmount.minor === 0) return setError('Enter an amount.');
    if (!merchant.trim()) return setError('Who was it? Add a merchant or description.');
    if (!isValidISODate(date)) return setError('Date must be YYYY-MM-DD.');

    if (isEditing && existing) {
      await updateTransaction(existing.id, {
        amountMinor: signedMinor,
        merchant: merchant.trim(),
        date,
        note: note.trim() || undefined,
        categoryId,
        accountId,
        reviewed: true,
      });
    } else {
      await addTransaction({
        accountId,
        amountMinor: signedMinor,
        currency,
        date,
        merchant: merchant.trim(),
        categoryId,
        note: note.trim() || undefined,
        receiptId: params.receiptId,
        source: params.receiptId ? 'receipt_scan' : 'manual',
        reviewed: true,
      });
    }
    router.back();
  }

  async function handleDelete() {
    if (!existing) return;
    await deleteTransaction(existing.id);
    router.back();
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.canvas }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + sp.lg,
          paddingBottom: insets.bottom + sp.huge,
          paddingHorizontal: sp.lg,
          maxWidth: 560,
          width: '100%',
          alignSelf: 'center',
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.spread}>
          <Text style={[t.title, { color: c.textPrimary }]}>
            {isEditing ? 'Edit transaction' : 'New transaction'}
          </Text>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={c.textMuted} />
          </Pressable>
        </View>

        {/* ---------------------------------------------- direction + amount */}
        <View style={{ flexDirection: 'row', marginTop: sp.lg, marginBottom: sp.md }}>
          <Segment
            label="Money out"
            active={!isInflow}
            onPress={() => {
              setIsInflow(false);
              setUserPickedCategory(false);
              setCategoryId(undefined);
            }}
          />
          <View style={{ width: sp.sm }} />
          <Segment
            label="Money in"
            active={isInflow}
            onPress={() => {
              setIsInflow(true);
              setUserPickedCategory(false);
              setCategoryId(undefined);
            }}
          />
        </View>

        <Card>
          <Text style={[t.micro, { color: c.textMuted }]}>AMOUNT</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: sp.xs }}>
            <Text style={[t.display, { color: c.textSecondary, marginRight: sp.sm }]}>
              {currencyMeta(currency).symbol}
            </Text>
            <TextInput
              value={amountText}
              onChangeText={setAmountText}
              placeholder={decimals === 0 ? '0' : '0.00'}
              placeholderTextColor={c.textMuted}
              // decimal-pad gives the numeric keypad without a minus sign;
              // direction is the segmented control's job, not the keyboard's.
              keyboardType="decimal-pad"
              inputMode="decimal"
              autoFocus={!isEditing}
              style={[
                t.display,
                tabularNumbers,
                { color: isInflow ? c.inflow : c.textPrimary, flex: 1, padding: 0 },
              ]}
              accessibilityLabel="Amount"
            />
          </View>
          {parsedAmount ? (
            <Text style={[t.micro, { color: c.textMuted, marginTop: sp.xs }]}>
              {isInflow ? '+' : '−'}
              {formatMoney(money(Math.abs(parsedAmount.minor), currency))}
            </Text>
          ) : null}
        </Card>

        {duplicate ? (
          <Card style={{ marginTop: sp.md, borderColor: c.warning }}>
            <Text style={[t.caption, { color: c.warning }]}>
              A transaction with this amount and date already exists on this account. Saving
              will create a second one.
            </Text>
          </Card>
        ) : null}

        {/* ------------------------------------------------------- receipt */}
        {receipt ? (
          <Card style={{ marginTop: sp.md }}>
            <View style={{ flexDirection: 'row' }}>
              <Image
                source={{ uri: receipt.fileUri }}
                style={{ width: 72, height: 96, borderRadius: r.sm, backgroundColor: c.surfaceSunken }}
                resizeMode="cover"
              />
              <View style={{ flex: 1, marginLeft: sp.md }}>
                <Text style={[t.bodyStrong, { color: c.textPrimary }]}>Receipt attached</Text>
                <Text style={[t.micro, { color: c.textMuted, marginTop: 2 }]}>
                  {receipt.status === 'parsed'
                    ? 'Read automatically — check the amount matches.'
                    : 'Stored. Enter the amount from the photo.'}
                </Text>
                {receipt.lineItems?.length ? (
                  <Text style={[t.micro, { color: c.textMuted, marginTop: 4 }]}>
                    {receipt.lineItems.length} line items detected
                  </Text>
                ) : null}
              </View>
            </View>
          </Card>
        ) : null}

        {/* --------------------------------------------------------- fields */}
        <Field label="MERCHANT">
          <TextInput
            value={merchant}
            onChangeText={(v) => setMerchant(v)}
            placeholder="Where did the money go?"
            placeholderTextColor={c.textMuted}
            style={[t.body, { color: c.textPrimary, paddingVertical: sp.sm }]}
            accessibilityLabel="Merchant"
          />
        </Field>

        <Field label="DATE">
          {/* A spend already happened, so the calendar blocks the future. */}
          <DateField value={date} onChange={setDate} maxToday />
          <View style={{ flexDirection: 'row', marginTop: sp.sm }}>
            <QuickDate label="Today" onPress={() => setDate(today())} />
            <QuickDate label="Yesterday" onPress={() => setDate(shiftDays(today(), -1))} />
          </View>
        </Field>

        {accounts.length > 1 ? (
          <Field label="ACCOUNT">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {accounts.map((a) => (
                <Chip
                  key={a.id}
                  label={a.name}
                  active={a.id === accountId}
                  onPress={() => setAccountId(a.id)}
                />
              ))}
            </View>
          </Field>
        ) : null}

        {/* ------------------------------------------------------- category */}
        <Field label="CATEGORY">
          {suggestion && !userPickedCategory ? (
            <Text style={[t.micro, { color: c.accent, marginBottom: sp.sm }]}>
              {suggestion.reason}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {relevantCategories.map((cat) => (
              <Chip
                key={cat.id}
                label={`${cat.icon} ${cat.name}`}
                active={cat.id === categoryId}
                onPress={() => {
                  setCategoryId(cat.id === categoryId ? undefined : cat.id);
                  setUserPickedCategory(true);
                }}
              />
            ))}
          </View>
          <Pressable onPress={() => setShowAllCategories((v) => !v)} hitSlop={8}>
            <Text style={[t.micro, { color: c.accent, marginTop: sp.sm }]}>
              {showAllCategories ? 'Show fewer' : 'Show all categories'}
            </Text>
          </Pressable>
        </Field>

        <Field label="NOTE (OPTIONAL)">
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Anything worth remembering"
            placeholderTextColor={c.textMuted}
            multiline
            style={[t.body, { color: c.textPrimary, paddingVertical: sp.sm, minHeight: 44 }]}
            accessibilityLabel="Note"
          />
        </Field>

        {error ? (
          <Text style={[t.caption, { color: c.critical, marginTop: sp.md }]}>{error}</Text>
        ) : null}

        <View style={{ marginTop: sp.xl }}>
          <Button label={isEditing ? 'Save changes' : 'Add transaction'} onPress={handleSave} />
        </View>

        {isEditing ? (
          <View style={{ marginTop: sp.md }}>
            <Button label="Delete" variant="ghost" onPress={handleDelete} />
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// -------------------------------------------------------------- small parts

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const { c, type: t, space: sp } = useTheme();
  return (
    <View style={{ marginTop: sp.lg }}>
      <Text style={[t.micro, { color: c.textMuted, marginBottom: sp.xs }]}>{label}</Text>
      <View
        style={{
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: c.border,
          paddingBottom: sp.xs,
        }}
      >
        {children}
      </View>
    </View>
  );
}

function Segment({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { c, type: t, radius: r, space: sp } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={{
        flex: 1,
        alignItems: 'center',
        paddingVertical: sp.md,
        borderRadius: r.md,
        backgroundColor: active ? c.accentSubtle : c.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: active ? c.accent : c.border,
      }}
    >
      <Text style={[t.bodyStrong, { color: active ? c.accent : c.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { c, type: t, radius: r, space: sp } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={{
        paddingHorizontal: sp.md,
        paddingVertical: sp.sm,
        borderRadius: r.pill,
        backgroundColor: active ? c.accentSubtle : c.surfaceSunken,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: active ? c.accent : 'transparent',
        marginRight: sp.sm,
        marginBottom: sp.sm,
      }}
    >
      <Text style={[t.caption, { color: active ? c.accent : c.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

function QuickDate({ label, onPress }: { label: string; onPress: () => void }) {
  const { c, type: t, space: sp } = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={8} style={{ marginRight: sp.lg }}>
      <Text style={[t.micro, { color: c.accent }]}>{label}</Text>
    </Pressable>
  );
}

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const styles = StyleSheet.create({
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
