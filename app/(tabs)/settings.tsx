/**
 * Settings.
 *
 * Also the place that tells the truth about the app's plumbing: which storage
 * driver is live, whether OCR is configured, whether Gmail is connected. When
 * something silently isn't working, this is the screen that says so.
 */

import React, { useState } from 'react';
import { ScrollView, View, Text, Pressable, TextInput, Platform, Alert, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Button, Card, Pill, SectionHeader } from '../../src/components/ui/Primitives';
import { useAppStore } from '../../src/store/useAppStore';
import { CURRENCIES, formatMoney, money } from '../../src/core/money';
import { accountBalance } from '../../src/core/analytics';
import { ocrStatus } from '../../src/ingest/receipt/ocr';
import {
  GMAIL_SETUP_HELP,
  clearToken,
  connectGmail,
  gmailConfigured,
  isConnected,
} from '../../src/ingest/email/gmail';
import { nowISO, today } from '../../src/core/dates';
import { describeUpdateState, useOtaUpdates } from '../../src/lib/updates';
import { llmStatus } from '../../src/ingest/llm';
import {
  NOTIFICATIONS_SUPPORTED,
  cancelBudgetAlerts,
  permissionState,
  requestPermission,
  scheduleBudgetAlerts,
} from '../../src/lib/notifications';
import { allBudgetStatuses } from '../../src/core/budget';
import { excludedCategoryIds } from '../../src/core/analytics';

function notify(title: string, message?: string) {
  if (Platform.OS === 'web') globalThis.alert?.(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}

async function confirm(title: string, message: string): Promise<boolean> {
  if (Platform.OS === 'web') return !!globalThis.confirm?.(`${title}\n\n${message}`);
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Continue', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

export default function SettingsScreen() {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const insets = useSafeAreaInsets();

  const settings = useAppStore((s) => s.settings);
  const accounts = useAppStore((s) => s.accounts);
  const transactions = useAppStore((s) => s.transactions);
  const receipts = useAppStore((s) => s.receipts);
  const repositoryKind = useAppStore((s) => s.repositoryKind);
  const ota = useOtaUpdates();
  const llm = llmStatus();
  const budgets = useAppStore((s) => s.budgets);
  const allTransactions = useAppStore((s) => s.transactions);
  const allCategories = useAppStore((s) => s.categories);
  const [alertState, setAlertState] = useState<string>('checking');
  const [alertPreview, setAlertPreview] = useState<string | null>(null);

  React.useEffect(() => {
    permissionState().then((p) => setAlertState(p)).catch(() => setAlertState('unsupported'));
  }, []);
  const setSetting = useAppStore((s) => s.setSetting);
  const saveAccount = useAppStore((s) => s.saveAccount);
  const seedDemoData = useAppStore((s) => s.seedDemoData);
  const resetAll = useAppStore((s) => s.resetAll);

  const [newAccountName, setNewAccountName] = useState('');
  const [gmailReady, setGmailReady] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const displayCurrency = settings.display_currency ?? 'NGN';
  const ocr = ocrStatus();

  React.useEffect(() => {
    isConnected().then(setGmailReady).catch(() => setGmailReady(false));
  }, []);

  async function addAccount() {
    const name = newAccountName.trim();
    if (!name) return;
    const stamp = nowISO();
    await saveAccount({
      id: `acc_${Date.now().toString(36)}`,
      name,
      kind: 'bank',
      currency: displayCurrency,
      openingBalanceMinor: 0,
      openedAt: today(),
      archived: false,
      createdAt: stamp,
      updatedAt: stamp,
    });
    setNewAccountName('');
  }

  async function handleConnectGmail() {
    if (!gmailConfigured()) {
      notify('Gmail is not configured yet', GMAIL_SETUP_HELP);
      return;
    }
    setConnecting(true);
    const result = await connectGmail();
    setConnecting(false);
    if (result.ok) {
      setGmailReady(true);
      notify('Gmail connected', 'Open Add › Sync now to import.');
    } else {
      notify('Could not connect', result.error);
    }
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
      <Text style={[t.title, { color: c.textPrimary }]}>Settings</Text>

      {/* ------------------------------------------------------- currency */}
      <SectionHeader title="Display currency" />
      <Card>
        <Text style={[t.body, { color: c.textSecondary, marginBottom: sp.md }]}>
          Everything is converted into this for totals. Each account keeps its own currency.
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {['NGN', 'USD', 'EUR', 'GBP', 'GHS', 'KES', 'ZAR', 'CAD'].map((code) => (
            <Pressable
              key={code}
              onPress={() => setSetting('display_currency', code)}
              accessibilityRole="button"
              accessibilityState={{ selected: code === displayCurrency }}
              style={{
                paddingHorizontal: sp.md,
                paddingVertical: sp.sm,
                borderRadius: r.pill,
                marginRight: sp.sm,
                marginBottom: sp.sm,
                backgroundColor: code === displayCurrency ? c.accentSubtle : c.surfaceSunken,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: code === displayCurrency ? c.accent : 'transparent',
              }}
            >
              <Text
                style={[
                  t.caption,
                  { color: code === displayCurrency ? c.accent : c.textSecondary },
                ]}
              >
                {CURRENCIES[code]?.symbol} {code}
              </Text>
            </Pressable>
          ))}
        </View>
      </Card>

      {/* ------------------------------------------------------- accounts */}
      <SectionHeader title="Accounts" />
      <Card padded={false}>
        {accounts.length === 0 ? (
          <View style={{ padding: sp.lg }}>
            <Text style={[t.body, { color: c.textMuted }]}>
              No accounts yet. Add one so transactions have somewhere to live.
            </Text>
          </View>
        ) : (
          accounts.map((a, i) => (
            <View
              key={a.id}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: sp.lg,
                borderBottomWidth: i === accounts.length - 1 ? 0 : StyleSheet.hairlineWidth,
                borderBottomColor: c.border,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={[t.body, { color: c.textPrimary }]}>{a.name}</Text>
                <Text style={[t.micro, { color: c.textMuted, marginTop: 2 }]}>
                  {a.kind.replace('_', ' ')} · {a.currency}
                  {a.mask ? ` · ••${a.mask}` : ''}
                </Text>
              </View>
              <Text style={[t.bodyStrong, { color: c.textPrimary }]}>
                {formatMoney(accountBalance(a, transactions, today()), { compactDecimals: true })}
              </Text>
            </View>
          ))
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: sp.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }}>
          <TextInput
            value={newAccountName}
            onChangeText={setNewAccountName}
            placeholder="New account name"
            placeholderTextColor={c.textMuted}
            onSubmitEditing={addAccount}
            style={[t.body, { color: c.textPrimary, flex: 1, paddingVertical: sp.sm }]}
            accessibilityLabel="New account name"
          />
          <Pressable onPress={addAccount} hitSlop={10} accessibilityLabel="Add account">
            <Ionicons name="add-circle" size={26} color={newAccountName.trim() ? c.accent : c.textMuted} />
          </Pressable>
        </View>
      </Card>

      {/* ----------------------------------------------------- automation */}
      <SectionHeader title="Automatic capture" />
      <Card>
        <Row
          label="Receipt OCR"
          value={ocr.configured ? ocr.name : 'Not configured'}
          tone={ocr.configured ? 'good' : 'neutral'}
          hint={ocr.reason}
        />
        <View style={{ height: sp.lg }} />
        <Row
          label="Gmail"
          value={gmailReady ? 'Connected' : gmailConfigured() ? 'Not connected' : 'No client ID'}
          tone={gmailReady ? 'good' : gmailConfigured() ? 'accent' : 'warning'}
          hint={
            gmailConfigured()
              ? 'Read-only access to bank alerts and merchant receipts.'
              : 'Add EXPO_PUBLIC_GOOGLE_CLIENT_ID_* to .env — see docs/SETUP.md.'
          }
        />
        <View style={{ marginTop: sp.lg }}>
          {gmailReady ? (
            <>
              <Button label="Sync inbox now" onPress={() => router.push('/review')} />
              <View style={{ height: sp.sm }} />
              <Button
                label="Disconnect Gmail"
                variant="ghost"
                onPress={async () => {
                  await clearToken();
                  setGmailReady(false);
                }}
              />
            </>
          ) : (
            <Button
              label={connecting ? 'Opening Google…' : 'Connect Gmail'}
              variant="secondary"
              onPress={handleConnectGmail}
            />
          )}
        </View>
      </Card>

      {/* --------------------------------------------------------- data */}
      <SectionHeader title="Data" />
      <Card>
        <Row
          label="Storage"
          value={
            repositoryKind === 'sqlite'
              ? 'SQLite (on device)'
              : repositoryKind === 'localstorage'
                ? 'Browser storage'
                : repositoryKind
          }
          tone="neutral"
          hint={
            repositoryKind === 'localstorage'
              ? 'The web build stores data in this browser only. Install on a phone for SQLite.'
              : 'Stored in the app sandbox and included in device backups.'
          }
        />
        <View style={{ height: sp.md }} />
        <Row
          label="Records"
          value={`${transactions.filter((x) => !x.deletedAt).length} transactions · ${receipts.length} receipts`}
          tone="neutral"
        />

        <View style={{ marginTop: sp.lg }}>
          <Button
            label="Load demo data"
            variant="secondary"
            onPress={async () => {
              const ok = await confirm(
                'Replace everything with demo data?',
                'This deletes your current transactions, accounts and budgets.'
              );
              if (ok) {
                await seedDemoData();
                notify('Demo data loaded');
              }
            }}
          />
          <View style={{ height: sp.sm }} />
          <Button
            label="Erase all data"
            variant="ghost"
            onPress={async () => {
              const ok = await confirm(
                'Erase everything?',
                'Every transaction, account, budget and receipt is deleted. This cannot be undone.'
              );
              if (ok) {
                await resetAll();
                notify('All data erased');
              }
            }}
          />
        </View>
      </Card>

      <SectionHeader title="Budget alerts" />
      <Card>
        <Row
          label="Daily check"
          value={
            !NOTIFICATIONS_SUPPORTED
              ? 'Not on web'
              : alertState === 'granted'
                ? 'On'
                : alertState === 'denied'
                  ? 'Blocked'
                  : 'Off'
          }
          tone={alertState === 'granted' ? 'good' : alertState === 'denied' ? 'warning' : 'neutral'}
          hint={
            !NOTIFICATIONS_SUPPORTED
              ? 'Install the app on a phone to get budget alerts.'
              : alertState === 'denied'
                ? 'Blocked in your device settings — enable notifications for Finlo there.'
                : alertPreview ??
                  'One notification at 7pm, only when an envelope is over or running ahead of pace.'
          }
        />
        {NOTIFICATIONS_SUPPORTED && alertState !== 'denied' ? (
          <View style={{ marginTop: sp.lg }}>
            <Button
              label={alertState === 'granted' ? 'Turn off alerts' : 'Turn on alerts'}
              variant={alertState === 'granted' ? 'secondary' : 'primary'}
              onPress={async () => {
                if (alertState === 'granted') {
                  await cancelBudgetAlerts();
                  setAlertState('undetermined');
                  setAlertPreview(null);
                  notify('Budget alerts off');
                  return;
                }
                const granted = await requestPermission();
                setAlertState(granted);
                if (granted !== 'granted') {
                  notify('Permission not granted', 'You can enable it later in device settings.');
                  return;
                }
                const statuses = allBudgetStatuses(budgets, {
                  transactions: allTransactions,
                  excludedCategoryIds: excludedCategoryIds(allCategories),
                  asOf: today(),
                });
                const result = await scheduleBudgetAlerts(statuses, today());
                setAlertPreview(result.preview ?? result.reason);
                notify(result.scheduled ? 'Budget alerts on' : 'Alerts on', result.reason);
              }}
            />
          </View>
        ) : null}
      </Card>

      <SectionHeader title="Smart categorisation" />
      <Card>
        <Row
          label="AI fallback"
          value={llm.configured ? llm.name : 'Not configured'}
          tone={llm.configured ? (llm.keyInBundle ? 'warning' : 'good') : 'neutral'}
          hint={llm.note}
        />
        <Row
          label="Statement import"
          value="CSV"
          hint="Import a bank statement and categorise a whole date range at once."
        />
        <View style={{ marginTop: sp.lg }}>
          <Button
            label="Import a bank statement"
            variant="secondary"
            onPress={() => router.push('/import')}
          />
        </View>
      </Card>

      <SectionHeader title="App version" />
      <Card>
        <Row label="Version" value={ota.appVersion} />
        <Row
          label="Updates"
          value={
            ota.state === 'unsupported'
              ? 'Expo Go'
              : ota.state === 'ready'
                ? 'Restart to apply'
                : ota.state === 'current'
                  ? 'Up to date'
                  : ota.state === 'error'
                    ? 'Check failed'
                    : 'Ready'
          }
          tone={ota.state === 'ready' ? 'accent' : ota.state === 'error' ? 'warning' : 'neutral'}
          hint={ota.error ?? describeUpdateState(ota.state)}
        />
        {ota.channel ? <Row label="Channel" value={ota.channel} /> : null}

        {ota.state !== 'unsupported' ? (
          <View style={{ marginTop: sp.lg }}>
            {ota.state === 'ready' ? (
              // Never restart under someone mid-entry — the reload is their call.
              <Button label="Restart to update" onPress={() => void ota.applyNow()} />
            ) : (
              <Button
                label={ota.state === 'checking' || ota.state === 'downloading' ? 'Checking…' : 'Check for updates'}
                variant="secondary"
                onPress={() => void ota.check()}
              />
            )}
          </View>
        ) : null}
      </Card>

      <Text style={[t.micro, { color: c.textMuted, marginTop: sp.xl, textAlign: 'center' }]}>
        Finlo · {displayCurrency} · {repositoryKind}
      </Text>
    </ScrollView>
  );
}

function Row({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'warning' | 'accent' | 'neutral';
  hint?: string;
}) {
  const { c, type: t, space: sp } = useTheme();
  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={[t.body, { color: c.textPrimary }]}>{label}</Text>
        <Pill label={value} tone={tone} />
      </View>
      {hint ? (
        <Text style={[t.micro, { color: c.textMuted, marginTop: sp.xs }]}>{hint}</Text>
      ) : null}
    </View>
  );
}
