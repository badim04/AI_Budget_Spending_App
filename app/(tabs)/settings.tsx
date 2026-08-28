/**
 * Settings.
 *
 * Also the place that tells the truth about the app's plumbing: which storage
 * driver is live, whether OCR is configured, whether Gmail is connected. When
 * something silently isn't working, this is the screen that says so.
 */

import React, { useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  TextInput,
  Platform,
  Alert,
  StyleSheet,
  Switch,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Button } from '../../src/components/ui/Primitives';
import { SettingsGroup, SettingsRow } from '../../src/components/ui/SettingsList';
import { StatRow, StatTile, Tile, TileGrid } from '../../src/components/ui/Tiles';
import { Spot } from '../../src/components/art/Spot';
import { useAppStore } from '../../src/store/useAppStore';
import { pingLlm } from '../../src/ingest/llm';
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
import { openAppSettings } from '../../src/lib/permissions';
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
  const categories = useAppStore((s) => s.categories);
  const [aiTest, setAiTest] = useState<'idle' | 'testing' | 'ok' | 'failed'>('idle');
  const [aiDetail, setAiDetail] = useState('');
  const ignoreInternal = useAppStore((s) => s.settings.ignore_internal_transfers) !== 'false';
  const saveAccount = useAppStore((s) => s.saveAccount);
  const seedDemoData = useAppStore((s) => s.seedDemoData);
  const resetAll = useAppStore((s) => s.resetAll);

  const [newAccountName, setNewAccountName] = useState('');
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [gmailReady, setGmailReady] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const displayCurrency = settings.display_currency ?? 'NGN';
  const liveTransactionCount = transactions.filter((x) => !x.deletedAt).length;
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
      {/* Display currency is a preference, not a section. It was eight chips
          taking a whole card near the top of the page for something most
          people set once — so it lives in the header, showing its value. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[t.title, { color: c.textPrimary }]}>Settings</Text>
        <Pressable
          onPress={() => setCurrencyOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Display currency: ${displayCurrency}. Change it.`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: c.accentSubtle,
            borderRadius: r.pill,
            paddingHorizontal: sp.md,
            paddingVertical: sp.sm,
          }}
        >
          <Text style={[t.caption, { color: c.accent }]}>
            {CURRENCIES[displayCurrency]?.symbol} {displayCurrency}
          </Text>
          <Ionicons name="chevron-down" size={14} color={c.accent} style={{ marginLeft: 4 }} />
        </Pressable>
      </View>

      <Modal visible={currencyOpen} transparent animationType="fade" onRequestClose={() => setCurrencyOpen(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: c.scrim, justifyContent: 'center', padding: sp.xl }}
          onPress={() => setCurrencyOpen(false)}
        >
          <View style={{ backgroundColor: c.surface, borderRadius: r.lg, padding: sp.lg }}>
            <Text style={[t.heading, { color: c.textPrimary }]}>Display currency</Text>
            <Text style={[t.micro, { color: c.textMuted, marginTop: sp.xs, marginBottom: sp.md }]}>
              Everything is converted into this for totals. Each account keeps its own.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {['NGN', 'USD', 'EUR', 'GBP', 'GHS', 'KES', 'ZAR', 'CAD'].map((code) => {
                const on = code === displayCurrency;
                return (
                  <Pressable
                    key={code}
                    onPress={() => {
                      setSetting('display_currency', code);
                      setCurrencyOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={{
                      paddingHorizontal: sp.lg,
                      paddingVertical: sp.md,
                      borderRadius: r.pill,
                      marginRight: sp.sm,
                      marginBottom: sp.sm,
                      backgroundColor: on ? c.accent : c.surfaceSunken,
                    }}
                  >
                    <Text style={[t.caption, { color: on ? c.onAccent : c.textSecondary }]}>
                      {CURRENCIES[code]?.symbol} {code}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </Pressable>
      </Modal>

      {/*
        What is actually working, three across, before anything else.

        Settings is also the screen that tells the truth about the plumbing —
        which storage driver is live, whether OCR has a key, whether Gmail is
        connected. That truth used to be spread across three groups a scroll
        apart, each behind its own heading, so "is this thing set up?" took a
        hunt. Three small tiles answer it before the page has moved.
      */}
      <View style={{ marginTop: sp.lg }}>
        <StatRow>
          <StatTile
            index={0}
            label="Storage"
            value={repositoryKind === 'sqlite' ? 'On device' : repositoryKind === 'localstorage' ? 'Browser' : repositoryKind}
            caption={`${liveTransactionCount} records`}
          />
          <StatTile
            index={1}
            label="AI sorting"
            value={llm.configured ? 'On' : 'Off'}
            caption={llm.configured ? llm.name : 'No key'}
            tone={llm.configured ? undefined : 'amber'}
          />
          <StatTile
            index={2}
            label="Alerts"
            value={
              !NOTIFICATIONS_SUPPORTED
                ? '—'
                : alertState === 'granted'
                  ? 'On'
                  : alertState === 'denied'
                    ? 'Blocked'
                    : 'Off'
            }
            caption={NOTIFICATIONS_SUPPORTED ? 'Budget pace' : 'Phone only'}
          />
        </StatRow>
      </View>

      {/* The four things people actually come to Settings to do, before the
          long list. A settings page that is only a list of rows makes every
          option look equally likely, and the common ones get hunted for. */}
      <View style={{ marginTop: sp.md }}>
        <TileGrid>
          <Tile
            tone="violet"
            tag={llm.configured ? 'Active' : 'Off'}
            title="AI sorting"
            subtitle={llm.configured ? llm.name : 'Not configured'}
            glyph="✨"
            index={0}
            onPress={() => router.push('/import')}
          />
          <Tile
            tone="green"
            tag="PDF · Excel"
            title="Import"
            subtitle="A whole month at once"
            glyph="📄"
            index={1}
            onPress={() => router.push('/import')}
          />
          <Tile
            tone="blue"
            tag={accounts.length ? `${accounts.length}` : 'Add one'}
            title="Accounts"
            subtitle={accounts.length ? accounts.map((a) => a.name).join(', ') : 'None yet'}
            glyph="🏦"
            index={2}
          />
          <Tile
            tone="amber"
            tag={gmailReady ? 'Connected' : 'Set up'}
            title="Gmail"
            subtitle={gmailReady ? 'Syncing receipts' : 'Read-only inbox scan'}
            glyph="📧"
            index={3}
            onPress={handleConnectGmail}
          />
        </TileGrid>
      </View>

      {/* ------------------------------------------------------- accounts */}
      {/* Accounts as cards with a balance and their own colour, not a divided
          list. An account is a place your money lives — it should look like a
          thing, not a row in a table. */}
      <SettingsGroup title="Accounts" divided={false}>
        {accounts.length === 0 ? (
          <View style={{ padding: sp.lg, alignItems: 'center' }}>
            <Spot name="wallet" size={92} tone="blue" />
            <Text style={[t.body, { color: c.textMuted, marginTop: sp.sm, textAlign: 'center' }]}>
              No accounts yet. Add one so transactions have somewhere to live.
            </Text>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: sp.md }}>
            {accounts.map((a, i) => {
              const tones = ['blue', 'violet', 'teal', 'green', 'amber', 'pink'] as const;
              const tone = c.tile[tones[i % tones.length]];
              const balance = accountBalance(a, transactions, today());

              return (
                <View key={a.id} style={{ width: '50%', padding: sp.sm / 2 }}>
                  <View
                    style={{
                      backgroundColor: tone.bg,
                      borderRadius: r.lg,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: tone.border,
                      padding: sp.md,
                      minHeight: 108,
                      overflow: 'hidden',
                      justifyContent: 'space-between',
                    }}
                  >
                    <Text style={[t.micro, { color: tone.fg }]} numberOfLines={1}>
                      {a.currency}
                    </Text>
                    <View>
                      <Text style={[t.bodyStrong, { color: c.textPrimary }]} numberOfLines={1}>
                        {a.name}
                      </Text>
                      <Text
                        style={[
                          t.caption,
                          { color: tone.fg, marginTop: 2, fontVariant: ['tabular-nums'] },
                        ]}
                        numberOfLines={1}
                      >
                        {formatMoney(balance)}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'center', padding: sp.md, paddingTop: 0 }}>
          <TextInput
            value={newAccountName}
            onChangeText={setNewAccountName}
            placeholder="Add an account"
            placeholderTextColor={c.textMuted}
            onSubmitEditing={() => void addAccount()}
            style={{
              flex: 1,
              color: c.textPrimary,
              backgroundColor: c.surfaceSunken,
              borderRadius: r.md,
              paddingHorizontal: sp.md,
              paddingVertical: sp.sm,
              fontSize: 15,
            }}
          />
          <View style={{ marginLeft: sp.sm }}>
            <Button
              label="Add"
              size="sm"
              full={false}
              variant="secondary"
              onPress={() => void addAccount()}
            />
          </View>
        </View>
      </SettingsGroup>

      {/*
        Everything about automation, as rows read down the right-hand edge.

        Each of these used to be its own padded block with a label, a pill and
        two lines of hint — three of them filled a screen. They are not three
        subsystems, they are three things that are either set up or not, and
        that is a one-line answer each. The hint only appears when it tells you
        what to do about it.
      */}
      <SettingsGroup title="Automation">
        <SettingsRow
          icon="🧾"
          label="Receipt OCR"
          value={ocr.configured ? ocr.name : 'Not configured'}
          tone={ocr.configured ? 'good' : 'neutral'}
          hint={ocr.configured ? undefined : ocr.reason}
        />
        <SettingsRow
          icon="📧"
          label="Gmail"
          value={gmailReady ? 'Connected' : gmailConfigured() ? 'Not connected' : 'No client ID'}
          tone={gmailReady ? 'good' : gmailConfigured() ? 'accent' : 'warning'}
          hint={gmailConfigured() ? undefined : 'Add EXPO_PUBLIC_GOOGLE_CLIENT_ID_* to .env — see docs/SETUP.md.'}
          onPress={gmailReady ? () => router.push('/review') : handleConnectGmail}
        />
        <SettingsRow
          icon="✨"
          label="AI fallback"
          value={llm.configured ? llm.name : 'Not configured'}
          tone={llm.configured ? (llm.keyInBundle ? 'warning' : 'good') : 'neutral'}
          hint={llm.keyInBundle ? llm.note : undefined}
        />
        {/* Autosave pots are common here and useless to review one row at a
            time, but plenty of people do not use one — hence a switch, not an
            assumption. */}
        <SettingsRow
          icon="🔁"
          label="Ignore autosave moves"
          hint={
            ignoreInternal
              ? 'Money swept into OWealth, Cashbox or Spend-and-Save and back is filed as a transfer, not spending.'
              : 'Every leg of an autosave round trip is imported as an ordinary transaction.'
          }
          right={
            <Switch
              value={ignoreInternal}
              onValueChange={(next: boolean) =>
                setSetting('ignore_internal_transfers', next ? 'true' : 'false')
              }
              trackColor={{ true: c.accent, false: c.border }}
            />
          }
        />
      </SettingsGroup>

      {/* Actions belong under the rows they act on, side by side rather than
          stacked full width — two buttons in a column read as a sequence. */}
      <View style={{ flexDirection: 'row', marginTop: sp.sm }}>
        {llm.configured ? (
          <View style={{ flex: 1, marginRight: sp.sm }}>
            <Button
              label={aiTest === 'testing' ? 'Asking…' : 'Test the AI'}
              variant="secondary"
              size="sm"
              onPress={async () => {
                setAiTest('testing');
                const result = await pingLlm(categories);
                setAiTest(result.ok ? 'ok' : 'failed');
                setAiDetail(`${result.model}: ${result.detail}`);
              }}
            />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Button
            label={
              gmailReady ? 'Disconnect Gmail' : connecting ? 'Opening Google…' : 'Connect Gmail'
            }
            variant="secondary"
            size="sm"
            onPress={
              gmailReady
                ? async () => {
                    await clearToken();
                    setGmailReady(false);
                  }
                : handleConnectGmail
            }
          />
        </View>
      </View>

      {/* "Configured" only means a key is present. Whether the model answers is
          a different question, and the app was quietly answering it wrong for
          weeks after Google retired the model it was pinned to. */}
      {aiTest !== 'idle' && aiDetail ? (
        <Text
          style={[
            t.micro,
            {
              color: aiTest === 'ok' ? c.good : aiTest === 'failed' ? c.warning : c.textMuted,
              marginTop: sp.sm,
            },
          ]}
        >
          {aiTest === 'ok' ? 'Working. ' : aiTest === 'failed' ? 'Not working. ' : ''}
          {aiDetail}
        </Text>
      ) : null}

      {/* ------------------------------------------------------------ alerts */}
      <SettingsGroup title="Alerts">
        <SettingsRow
          icon="🔔"
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
                ? 'Android will not ask again once notifications are blocked, so this has to be switched on in system settings. Finlo re-checks when you come back.'
                : (alertPreview ??
                  'One notification at 7pm, only when an envelope is over or running ahead of pace.')
          }
        />
      </SettingsGroup>

      {NOTIFICATIONS_SUPPORTED && alertState === 'denied' ? (
        <View style={{ marginTop: sp.sm }}>
          <Button
            label="Open device settings"
            variant="secondary"
            size="sm"
            icon="⚙"
            onPress={() => void openAppSettings()}
          />
        </View>
      ) : null}

      {NOTIFICATIONS_SUPPORTED && alertState !== 'denied' ? (
        <View style={{ marginTop: sp.sm }}>
          <Button
            label={alertState === 'granted' ? 'Turn off alerts' : 'Turn on alerts'}
            variant="secondary"
            size="sm"
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

      {/* ------------------------------------------------------- appearance */}
      <SettingsGroup title="Appearance" divided={false} padded>
        <Text style={[t.micro, { color: c.textMuted }]}>YOUR NAME</Text>
        <TextInput
          value={settings.user_name ?? ''}
          onChangeText={(next) => setSetting('user_name', next)}
          placeholder="What should Finlo call you?"
          placeholderTextColor={c.textMuted}
          style={{
            color: c.textPrimary,
            backgroundColor: c.surfaceSunken,
            borderRadius: r.md,
            paddingHorizontal: sp.md,
            paddingVertical: sp.md,
            fontSize: 15,
            marginTop: sp.sm,
          }}
        />

        <Text style={[t.micro, { color: c.textMuted, marginTop: sp.xl }]}>THEME</Text>
        <View style={{ flexDirection: 'row', marginTop: sp.md }}>
          {(['system', 'light', 'dark'] as const).map((option) => {
            const active = (settings.theme ?? 'system') === option;
            return (
              <Pressable
                key={option}
                onPress={() => setSetting('theme', option)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  paddingVertical: sp.md,
                  marginRight: option === 'dark' ? 0 : sp.sm,
                  borderRadius: r.md,
                  backgroundColor: active ? c.accentSubtle : c.surfaceSunken,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: active ? c.accent : c.border,
                }}
              >
                <Text style={{ fontSize: 18 }}>
                  {option === 'system' ? '⚙️' : option === 'light' ? '☀️' : '🌙'}
                </Text>
                <Text
                  style={[
                    t.caption,
                    {
                      color: active ? c.accent : c.textSecondary,
                      marginTop: 4,
                      textTransform: 'capitalize',
                    },
                  ]}
                >
                  {option}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[t.micro, { color: c.textMuted, marginTop: sp.md }]}>
          System follows your phone. Pick one to override it.
        </Text>
      </SettingsGroup>

      {/* ------------------------------------------------------------- data */}
      <SettingsGroup title="Your data">
        <SettingsRow
          icon="💾"
          label="Storage"
          value={
            repositoryKind === 'sqlite'
              ? 'SQLite'
              : repositoryKind === 'localstorage'
                ? 'Browser'
                : repositoryKind
          }
          hint={
            repositoryKind === 'localstorage'
              ? 'The web build stores data in this browser only. Install on a phone for SQLite.'
              : undefined
          }
        />
        <SettingsRow icon="🧮" label="Transactions" value={`${liveTransactionCount}`} />
        <SettingsRow icon="📸" label="Receipts" value={`${receipts.length}`} />
        <SettingsRow
          icon="📤"
          label="Export a report"
          value="PDF · Excel · CSV"
          onPress={() => router.push('/reports')}
        />
      </SettingsGroup>

      {/* ------------------------------------------------------------ about */}
      <SettingsGroup title="About">
        <SettingsRow icon="🏷️" label="Version" value={ota.appVersion} />
        <SettingsRow
          icon="⬆️"
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
          hint={ota.error ?? undefined}
          onPress={
            ota.state === 'unsupported'
              ? undefined
              : ota.state === 'ready'
                ? // Never restart under someone mid-entry — the reload is their call.
                  () => void ota.applyNow()
                : () => void ota.check()
          }
        />
        {ota.channel ? <SettingsRow icon="📡" label="Channel" value={ota.channel} /> : null}
      </SettingsGroup>

      {/*
        The two irreversible actions, kept apart and last.

        They used to sit inside "Your data" as full-width buttons directly under
        the record counts, one tap away from the rows they destroy, and styled
        exactly like "Sync inbox now" three groups above. Distance and a red
        border are the whole safety mechanism here, since both already confirm.
      */}
      <View
        style={{
          marginTop: sp.xl,
          borderRadius: r.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.critical,
          backgroundColor: c.criticalSubtle,
          padding: sp.lg,
        }}
      >
        <Text style={[t.micro, { color: c.critical }]}>CANNOT BE UNDONE</Text>
        <View style={{ flexDirection: 'row', marginTop: sp.md }}>
          <View style={{ flex: 1, marginRight: sp.sm }}>
            <Button
              label="Load demo data"
              variant="secondary"
              size="sm"
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
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label="Erase all data"
              variant="secondary"
              tone="critical"
              size="sm"
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
        </View>
      </View>

      <Text style={[t.micro, { color: c.textMuted, marginTop: sp.xl, textAlign: 'center' }]}>
        Finlo · {displayCurrency} · {repositoryKind}
      </Text>
    </ScrollView>
  );
}
