/**
 * Finlo Premium — the plan screen, honestly.
 *
 * The reference design has a full upgrade page: two plans, a saving badge on
 * the annual one, a feature list, and a button that says "Upgrade to Premium".
 * This is that page, with one deliberate difference: **the button does not
 * pretend to sell anything.**
 *
 * There is no payment processor, no entitlement check, and nothing behind the
 * paywall — every feature listed below already works for everyone. A screen
 * that took a card number in that state would be taking money for nothing, and
 * a screen that took a card number and silently discarded it would be worse. So
 * the plans are shown, the prices are shown, and the action registers interest
 * and says exactly what will happen.
 *
 * When billing exists, this page keeps its layout and the CTA changes. Until
 * then it is a page about what is planned, and it says so at the top rather
 * than in small print at the bottom.
 */

import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Linking, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../src/theme/ThemeProvider';
import { Screen, Split } from '../src/components/ui/Screen';
import { Button, Card } from '../src/components/ui/Primitives';
import { Banner } from '../src/components/ui/Tiles';
import { FeatureCard, FeaturePill } from '../src/components/ui/FeatureCard';
import { useAppStore } from '../src/store/useAppStore';

type PlanId = 'annual' | 'monthly';

interface Plan {
  id: PlanId;
  name: string;
  price: string;
  per: string;
  note?: string;
  badge?: string;
}

const PLANS: Plan[] = [
  {
    id: 'annual',
    name: 'Annual',
    price: '₦2,999',
    per: 'a year',
    note: '₦250 a month, billed once',
    badge: 'Save 17%',
  },
  { id: 'monthly', name: 'Monthly', price: '₦299', per: 'a month' },
];

/**
 * What premium would actually add.
 *
 * Split deliberately into what exists and what does not, because a feature list
 * that mixes the two is how someone pays for something they already had. The
 * `live` ones are free today and stay free; they are here to say what the app
 * does, not to be sold back.
 */
const PLANNED: Array<{ label: string; detail: string }> = [
  { label: 'Sync across your devices', detail: 'Needs accounts and a server — the reason this plan exists.' },
  { label: 'Cloud backup and restore', detail: 'Your ledger recoverable if the phone is lost.' },
  { label: 'Unlimited AI categorisation', detail: 'Today the model is capped by a shared quota.' },
  { label: 'Automatic bank feeds', detail: 'Instead of importing a statement each month.' },
  { label: 'Priority support', detail: 'A person, not a queue.' },
];

const FREE_TODAY = [
  'Statement import, checked against the bank’s own totals',
  'Receipt capture, single and batch',
  'Budgets, goals, forecasting and the health score',
  'Reports as PDF, Excel and CSV',
];

const INTEREST_KEY = 'premium_interest';
const SUPPORT_EMAIL = 'adebayoabdulakeem@gmail.com';

export default function PremiumScreen() {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const settings = useAppStore((s) => s.settings);
  const setSetting = useAppStore((s) => s.setSetting);

  const [selected, setSelected] = useState<PlanId>('annual');
  const registered = settings[INTEREST_KEY] != null;

  const plan = PLANS.find((p) => p.id === selected)!;

  const register = async () => {
    await setSetting(INTEREST_KEY, `${selected}:${new Date().toISOString().slice(0, 10)}`);
    const message =
      'Noted, and nothing has been charged — there is no billing yet. You will be told here when there is.';
    if (Platform.OS === 'web') globalThis.alert?.(message);
    else Alert.alert('Interest registered', message);
  };

  const mail = () => {
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Finlo Premium')}`;
    if (Platform.OS === 'web') globalThis.open?.(url, '_self');
    else void Linking.openURL(url);
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={c.textPrimary} />
        </Pressable>
        <Text style={[t.title, { color: c.textPrimary, marginLeft: sp.sm }]}>Finlo Premium</Text>
      </View>

      {/* Said first, not in small print. */}
      <Banner
        tone="amber"
        glyph="🚧"
        title="Not on sale yet"
        body="There is no billing set up, so nothing here can be bought. Everything Finlo does today stays free — this page is what the paid plan would add."
        style={{ marginTop: sp.lg }}
      />

      <FeatureCard
        tone="primary"
        label="What it would unlock"
        style={{ marginTop: sp.lg }}
        footer={
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
            <FeaturePill label="Sync" />
            <FeaturePill label="Backup" />
            <FeaturePill label="Bank feeds" />
          </View>
        }
      >
        <Text style={[t.heading, { color: c.feature.primary.fg, marginTop: sp.xs }]}>
          The things that need a server behind them.
        </Text>
        <Text style={[t.caption, { color: c.feature.primary.muted, marginTop: sp.sm }]}>
          Finlo runs entirely on your phone today, which is why it costs nothing and why your
          data never leaves it. Everything on this page is what changes once there is somewhere
          for it to sync to.
        </Text>
      </FeatureCard>

      {/* Plans side by side: two prices are a comparison, and a comparison
          stacked into a column is a sequence. */}
      <View style={{ marginTop: sp.lg }}>
        <Split ratio={0.5} stackOnTablet>
          {PLANS.map((p) => {
            const on = p.id === selected;
            return (
              <Pressable
                key={p.id}
                onPress={() => setSelected(p.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${p.name} plan, ${p.price} ${p.per}`}
                style={{
                  backgroundColor: on ? c.accentSubtle : c.surface,
                  borderRadius: r.lg,
                  borderWidth: on ? 1.5 : StyleSheet.hairlineWidth,
                  borderColor: on ? c.accent : c.border,
                  padding: sp.lg,
                  minHeight: 132,
                  justifyContent: 'space-between',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={[t.caption, { color: c.textSecondary, flex: 1 }]}>{p.name}</Text>
                  {p.badge ? (
                    <View
                      style={{
                        backgroundColor: c.good,
                        borderRadius: r.pill,
                        paddingHorizontal: sp.sm,
                        paddingVertical: 2,
                      }}
                    >
                      <Text style={[t.micro, { color: '#ffffff' }]}>{p.badge.toUpperCase()}</Text>
                    </View>
                  ) : null}
                  <Ionicons
                    name={on ? 'radio-button-on' : 'radio-button-off'}
                    size={18}
                    color={on ? c.accent : c.textMuted}
                    style={{ marginLeft: sp.sm }}
                  />
                </View>

                <View style={{ marginTop: sp.md }}>
                  <Text style={[t.display, { color: c.textPrimary }]}>{p.price}</Text>
                  <Text style={[t.micro, { color: c.textMuted, marginTop: 2 }]}>
                    {p.per}
                    {p.note ? ` · ${p.note}` : ''}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </Split>
      </View>

      <Split ratio={0.5} stackOnTablet>
        <Card style={{ marginTop: sp.lg }}>
          <Text style={[t.micro, { color: c.textMuted }]}>WOULD BE ADDED</Text>
          {PLANNED.map((item) => (
            <View key={item.label} style={{ flexDirection: 'row', marginTop: sp.md }}>
              <Ionicons name="add-circle-outline" size={16} color={c.accent} style={{ marginTop: 2 }} />
              <View style={{ flex: 1, marginLeft: sp.sm }}>
                <Text style={[t.caption, { color: c.textPrimary }]}>{item.label}</Text>
                <Text style={[t.micro, { color: c.textMuted, marginTop: 1 }]}>{item.detail}</Text>
              </View>
            </View>
          ))}
        </Card>

        <Card style={{ marginTop: sp.lg }}>
          <Text style={[t.micro, { color: c.textMuted }]}>FREE TODAY, AND STAYING FREE</Text>
          {FREE_TODAY.map((item) => (
            <View key={item} style={{ flexDirection: 'row', marginTop: sp.md }}>
              <Ionicons name="checkmark-circle" size={16} color={c.good} style={{ marginTop: 2 }} />
              <Text style={[t.caption, { color: c.textSecondary, flex: 1, marginLeft: sp.sm }]}>
                {item}
              </Text>
            </View>
          ))}
        </Card>
      </Split>

      <View style={{ marginTop: sp.xl }}>
        <Button
          label={
            registered
              ? 'Interest registered'
              : `Tell me when ${plan.name.toLowerCase()} is available`
          }
          onPress={() => void register()}
          disabled={registered}
        />
        <View style={{ marginTop: sp.sm }}>
          <Button label="Email about it" variant="ghost" onPress={mail} />
        </View>
        <Text style={[t.micro, { color: c.textMuted, marginTop: sp.md, textAlign: 'center' }]}>
          No card is taken and nothing is charged. This records that you are interested, on this
          device only.
        </Text>
      </View>
    </Screen>
  );
}
