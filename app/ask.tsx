/**
 * Ask Finlo — a question about your own money, in words.
 *
 * The screen is deliberately thin. Everything that matters happens in
 * `core/factSheet` (which computes the figures and strips other people's names
 * out of them) and `ingest/ask` (which tells the model it may phrase those
 * figures and may not invent new ones).
 *
 * The one thing this file owns is **consent**. Every other AI call in the app
 * sends a merchant descriptor; this one sends a summary of the user's finances
 * to Google. That is a different promise, so it is asked for once, in plain
 * words, with the actual brief available to read before agreeing — not buried
 * in a policy nobody opens.
 */

import React, { useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../src/theme/ThemeProvider';
import { Screen } from '../src/components/ui/Screen';
import { Button, Card } from '../src/components/ui/Primitives';
import { Banner } from '../src/components/ui/Tiles';
import { Mascot } from '../src/components/art/Mascot';
import { useAppStore } from '../src/store/useAppStore';
import { allBudgetStatuses } from '../src/core/budget';
import { excludedCategoryIds, type AnalyticsContext } from '../src/core/analytics';
import { buildFactSheet } from '../src/core/factSheet';
import {
  SUGGESTED_QUESTIONS,
  askAboutMoney,
  askConfigured,
  type AskTurn,
} from '../src/ingest/ask';
import { today } from '../src/core/dates';

/** Stored so the question is asked once, not on every visit. */
const CONSENT_KEY = 'ai_ask_consent';

export default function AskScreen() {
  const { c, type: t, space: sp, radius: r } = useTheme();

  const transactions = useAppStore((s) => s.transactions);
  const categories = useAppStore((s) => s.categories);
  const accounts = useAppStore((s) => s.accounts);
  const budgets = useAppStore((s) => s.budgets);
  const goals = useAppStore((s) => s.goals);
  const settings = useAppStore((s) => s.settings);
  const setSetting = useAppStore((s) => s.setSetting);
  const fxTable = useAppStore((s) => s.fxTable);

  const asOf = today();
  const consented = settings[CONSENT_KEY] === 'true';

  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBrief, setShowBrief] = useState(false);
  const scroller = useRef<ScrollView>(null);

  const ctx = useMemo<AnalyticsContext>(
    () => ({
      transactions,
      categories,
      accounts,
      displayCurrency: settings.display_currency ?? 'NGN',
      fx: fxTable(),
      asOf,
    }),
    [transactions, categories, accounts, settings, fxTable, asOf]
  );

  const sheet = useMemo(() => {
    const statuses = allBudgetStatuses(budgets, {
      transactions,
      excludedCategoryIds: excludedCategoryIds(categories),
      asOf,
    });
    return buildFactSheet({ ctx, budgetStatuses: statuses, goals, transactions, asOf });
  }, [ctx, budgets, goals, transactions, categories, asOf]);

  const configured = askConfigured();
  const hasData = transactions.filter((tx) => !tx.deletedAt).length > 0;

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    setQuestion('');
    setError(null);
    setTurns((prev) => [...prev, { role: 'user', text: trimmed }]);
    setBusy(true);
    requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));

    const result = await askAboutMoney(trimmed, sheet.text, categories, { history: turns });

    setBusy(false);
    if (result.ok) {
      setTurns((prev) => [...prev, { role: 'model', text: result.answer }]);
    } else {
      // The failure is shown as a failure, never as an answer.
      setError(result.error ?? 'That did not work.');
    }
    requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));
  };

  return (
    <Screen scroll={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={c.textPrimary} />
        </Pressable>
        <Text style={[t.title, { color: c.textPrimary, marginLeft: sp.sm }]}>Ask Finlo</Text>
      </View>

      <ScrollView
        ref={scroller}
        style={{ flex: 1, marginTop: sp.md }}
        contentContainerStyle={{ paddingBottom: sp.lg }}
        keyboardShouldPersistTaps="handled"
      >
        {!configured ? (
          <Banner
            tone="amber"
            glyph="🔌"
            title="No AI is configured"
            body="Add a Gemini key, or deploy the proxy, and this starts working. Settings shows what is set up."
            onPress={() => router.push('/settings')}
          />
        ) : !hasData ? (
          <Banner
            tone="blue"
            glyph="📄"
            title="Nothing to ask about yet"
            body="Import a statement or add a few transactions, then come back."
            onPress={() => router.push('/import')}
          />
        ) : !consented ? (
          /*
            Asked once, in plain words, with the brief readable first.

            Every other AI call in this app sends a merchant descriptor. This one
            sends a summary of someone's finances to Google, and that is a
            different promise — so it is a decision, not a default.
          */
          <Card>
            <View style={{ alignItems: 'center', paddingVertical: sp.md }}>
              <Mascot pose="think" size={96} />
            </View>
            <Text style={[t.heading, { color: c.textPrimary, marginTop: sp.sm }]}>
              This sends a summary to Google
            </Text>
            <Text style={[t.body, { color: c.textSecondary, marginTop: sp.sm }]}>
              To answer questions, Finlo sends a short brief of your totals, categories, budgets
              and goals to Gemini along with your question. It is the only feature that does this.
            </Text>

            <View style={{ marginTop: sp.md }}>
              {[
                'Your figures are computed on this phone — the model is given the answers, not your transactions to add up.',
                'Names of people you transfer to are withheld, and account numbers are stripped before anything is sent.',
                'Nothing is stored. Close the screen and the conversation is gone.',
              ].map((point) => (
                <View key={point} style={{ flexDirection: 'row', marginTop: sp.sm }}>
                  <Ionicons
                    name="checkmark-circle"
                    size={16}
                    color={c.good}
                    style={{ marginTop: 2 }}
                  />
                  <Text style={[t.caption, { color: c.textSecondary, flex: 1, marginLeft: sp.sm }]}>
                    {point}
                  </Text>
                </View>
              ))}
            </View>

            <Pressable
              onPress={() => setShowBrief((v) => !v)}
              hitSlop={8}
              style={{ marginTop: sp.md }}
            >
              <Text style={[t.caption, { color: c.accent }]}>
                {showBrief ? 'Hide' : 'Read'} exactly what would be sent ›
              </Text>
            </Pressable>

            {showBrief ? (
              <ScrollView
                style={{
                  maxHeight: 240,
                  backgroundColor: c.surfaceSunken,
                  borderRadius: r.md,
                  marginTop: sp.sm,
                }}
                contentContainerStyle={{ padding: sp.md }}
              >
                <Text
                  style={[t.micro, { color: c.textSecondary, fontFamily: 'monospace' }]}
                  selectable
                >
                  {sheet.text}
                </Text>
              </ScrollView>
            ) : null}

            <View style={{ marginTop: sp.lg }}>
              <Button
                label="Allow and start asking"
                onPress={() => void setSetting(CONSENT_KEY, 'true')}
              />
              <View style={{ marginTop: sp.sm }}>
                <Button label="Not now" variant="ghost" onPress={() => router.back()} />
              </View>
            </View>
          </Card>
        ) : (
          <>
            {turns.length === 0 ? (
              <View>
                <View style={{ alignItems: 'center', paddingVertical: sp.lg }}>
                  <Mascot pose="wave" size={84} />
                  <Text
                    style={[
                      t.caption,
                      { color: c.textMuted, marginTop: sp.md, textAlign: 'center', maxWidth: 320 },
                    ]}
                  >
                    Ask about your spending, budgets or goals. Finlo answers from your own
                    figures, and says so when it does not have one.
                  </Text>
                </View>

                {/* Only questions the brief can actually answer — an example
                    that fails is a promise broken on the first tap. */}
                {SUGGESTED_QUESTIONS.map((q) => (
                  <Pressable
                    key={q}
                    onPress={() => void send(q)}
                    accessibilityRole="button"
                    style={{
                      backgroundColor: c.surface,
                      borderRadius: r.lg,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: c.border,
                      paddingHorizontal: sp.lg,
                      paddingVertical: sp.md,
                      marginBottom: sp.sm,
                      flexDirection: 'row',
                      alignItems: 'center',
                    }}
                  >
                    <Text style={[t.caption, { color: c.textPrimary, flex: 1 }]}>{q}</Text>
                    <Ionicons name="arrow-forward" size={14} color={c.accent} />
                  </Pressable>
                ))}
              </View>
            ) : null}

            {turns.map((turn, i) => (
              <View
                key={i}
                style={{
                  alignSelf: turn.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '88%',
                  backgroundColor: turn.role === 'user' ? c.accentSubtle : c.surface,
                  borderRadius: r.lg,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: turn.role === 'user' ? c.accent : c.border,
                  paddingHorizontal: sp.lg,
                  paddingVertical: sp.md,
                  marginBottom: sp.sm,
                }}
              >
                <Text
                  style={[
                    t.body,
                    { color: turn.role === 'user' ? c.accent : c.textPrimary },
                  ]}
                  selectable
                >
                  {turn.text}
                </Text>
              </View>
            ))}

            {busy ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: sp.md }}>
                <ActivityIndicator color={c.accent} />
                <Text style={[t.caption, { color: c.textMuted, marginLeft: sp.md }]}>
                  Reading your figures…
                </Text>
              </View>
            ) : null}

            {error ? (
              <Banner tone="pink" glyph="⚠️" title="That did not work" body={error} />
            ) : null}
          </>
        )}
      </ScrollView>

      {consented && configured && hasData ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            paddingTop: sp.sm,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: c.border,
          }}
        >
          <TextInput
            value={question}
            onChangeText={setQuestion}
            placeholder="Ask about your money"
            placeholderTextColor={c.textMuted}
            multiline
            onSubmitEditing={() => void send(question)}
            style={[
              t.body,
              {
                flex: 1,
                color: c.textPrimary,
                backgroundColor: c.surface,
                borderRadius: r.lg,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: c.border,
                paddingHorizontal: sp.md,
                paddingVertical: sp.md,
                maxHeight: 120,
              },
            ]}
            accessibilityLabel="Your question"
          />
          <View style={{ marginLeft: sp.sm }}>
            <Button
              label="Ask"
              size="sm"
              full={false}
              loading={busy}
              disabled={!question.trim()}
              onPress={() => void send(question)}
            />
          </View>
        </View>
      ) : null}
    </Screen>
  );
}
