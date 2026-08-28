/**
 * Help centre.
 *
 * Written from the questions this app has actually generated, not from a
 * generic FAQ template: the ones in `docs/HANDOFF.md` under "the rules that
 * cost real time to learn", the ones the import screen keeps being asked, and
 * the two that come up because Finlo does something unusual — reconciling
 * against the bank's own totals, and treating autosave sweeps as transfers.
 *
 * Answers say what the app really does, including where it is limited. A help
 * page that oversells is worse than none, because it is read by someone who
 * has already hit the limit.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, Linking, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../src/theme/ThemeProvider';
import { Screen, Grid } from '../src/components/ui/Screen';
import { Card, SectionHeader } from '../src/components/ui/Primitives';
import { Tile, TileGrid } from '../src/components/ui/Tiles';
import { Spot } from '../src/components/art/Spot';

interface Topic {
  q: string;
  a: string;
  /** Words someone might search that are not in the question itself. */
  also?: string;
}

const TOPICS: Topic[] = [
  {
    q: 'How do I add an expense?',
    a: 'Add › Add manually is the fastest — amount, merchant, done. You can also snap a receipt, import a bank statement, or connect Gmail so receipts file themselves.',
    also: 'transaction new spending record',
  },
  {
    q: 'Which statement files can Finlo read?',
    a: 'PDF, Excel (.xlsx/.xls), CSV, TSV and plain text. Password-protected PDFs work if you enter the password. A scanned PDF with no text layer cannot be read — photograph the pages with Add › Snap a receipt instead.',
    also: 'import bank pdf excel csv upload',
  },
  {
    q: 'Why did my import get stopped?',
    a: 'Most statements print their own totals — money in, money out, and the number of each. Finlo adds up what it read and refuses to import if the two disagree, because a misread column produces an amount that looks completely normal and is wrong. The screen shows both figures side by side so you can see which one is off.',
    also: 'reconcile mismatch refused blocked totals',
  },
  {
    q: 'Why are some transactions missing from my totals?',
    a: 'Transfers between your own accounts are excluded by design — money moved from one pocket to another is not spending. If you use an autosave pot (OWealth, Cashbox, Spend-and-Save), those sweeps are filed as transfers too. Turn that off in Settings › Automation if you want the raw ledger.',
    also: 'owealth autosave transfer excluded internal',
  },
  {
    q: 'How does Finlo choose a category?',
    a: 'Four layers, in order: rules you wrote, merchants you have filed before, a built-in keyword list, and — only if the first three find nothing — an AI suggestion. The first three are offline and instant. Anything it is not confident about goes to the review queue rather than being filed silently.',
    also: 'categorise automatic sorting ai rules',
  },
  {
    q: 'What is the review queue?',
    a: 'Activity › Needs review. Transactions the app could not confidently categorise. They are grouped by counterparty, so twelve transfers to the same person are one decision rather than twelve.',
    also: 'uncategorised needs review filing',
  },
  {
    q: 'How do I set a budget?',
    a: 'Budgets › tap an envelope amount. If you leave it at zero, Finlo suggests a figure from the median of your recent months — the median rather than the average, so one expensive month does not inflate it permanently.',
    also: 'envelope allocation limit spending plan',
  },
  {
    q: 'What is the health score?',
    a: 'Insights shows a score out of 100 across saving, spending trend, budgets, safety net and consistency. Anything Finlo cannot measure — it knows nothing about your insurance or pension — is marked "not tracked" and left out of the average rather than counted as a zero.',
    also: 'financial health rating score insights',
  },
  {
    q: 'Where is my data stored?',
    a: 'On your phone, in the app sandbox, included in your device backups. The web version stores it in that browser only. Nothing is uploaded to a Finlo server, because there is no Finlo server.',
    also: 'privacy storage sqlite cloud sync backup',
  },
  {
    q: 'Can I use it on more than one device?',
    a: 'Not yet. There are no accounts and no sync, so each install keeps its own data. Reports › Export gives you a PDF, Excel or CSV copy in the meantime.',
    also: 'sync account login multiple phones',
  },
  {
    q: 'How do I export my data?',
    a: 'Insights › Export, or Settings › Your data › Export a report. PDF for reading, Excel or CSV for anything else.',
    also: 'download report pdf excel csv backup',
  },
  {
    q: 'Why does the app say "Not configured"?',
    a: 'OCR, Gmail and the AI fallback each need a key. Settings shows which are set up. Without them the app still works — receipts are stored and searchable, you just type the amount yourself.',
    also: 'ocr gmail api key setup not working',
  },
];

const SUPPORT_EMAIL = 'adebayoabdulakeem@gmail.com';

export default function HelpScreen() {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return TOPICS;
    return TOPICS.filter((topic) =>
      `${topic.q} ${topic.a} ${topic.also ?? ''}`.toLowerCase().includes(needle)
    );
  }, [query]);

  const mail = () => {
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Finlo support')}`;
    if (Platform.OS === 'web') globalThis.open?.(url, '_self');
    else void Linking.openURL(url);
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={c.textPrimary} />
        </Pressable>
        <Text style={[t.title, { color: c.textPrimary, marginLeft: sp.sm }]}>Help</Text>
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: c.surface,
          borderRadius: r.md,
          paddingHorizontal: sp.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.border,
          marginTop: sp.lg,
        }}
      >
        <Ionicons name="search" size={16} color={c.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search help"
          placeholderTextColor={c.textMuted}
          style={[
            t.body,
            { color: c.textPrimary, flex: 1, paddingVertical: sp.md, marginLeft: sp.sm },
          ]}
          accessibilityLabel="Search help topics"
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={10}>
            <Ionicons name="close-circle" size={16} color={c.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {/* The three things people come here to do that are not a question. */}
      <View style={{ marginTop: sp.lg }}>
        <TileGrid ideal={3}>
          <Tile
            tone="green"
            tag="Guide"
            title="Import a statement"
            subtitle="A whole month at once"
            glyph="📄"
            index={0}
            onPress={() => router.push('/import')}
          />
          <Tile
            tone="violet"
            tag="Check"
            title="What is set up"
            subtitle="OCR, Gmail, AI and storage"
            glyph="⚙️"
            index={1}
            onPress={() => router.push('/settings')}
          />
          <Tile
            tone="blue"
            tag="Email"
            title="Ask a person"
            subtitle={SUPPORT_EMAIL}
            glyph="✉️"
            index={2}
            onPress={mail}
          />
        </TileGrid>
      </View>

      <SectionHeader title={query ? `${results.length} matching` : 'Common questions'} />

      {results.length === 0 ? (
        <Card>
          <View style={{ alignItems: 'center', paddingVertical: sp.lg }}>
            <Spot name="inbox" size={92} tone="violet" />
            <Text style={[t.body, { color: c.textMuted, marginTop: sp.md, textAlign: 'center' }]}>
              Nothing matches “{query}”. Email {SUPPORT_EMAIL} and it will get answered.
            </Text>
          </View>
        </Card>
      ) : (
        /* Two across on a phone. An accordion in one column is a wall of
           identical bars; in a grid each question is a thing you can pick. */
        <Grid ideal={2}>
          {results.map((topic) => {
            const isOpen = open === topic.q;
            return (
              <Pressable
                key={topic.q}
                onPress={() => setOpen(isOpen ? null : topic.q)}
                accessibilityRole="button"
                accessibilityState={{ expanded: isOpen }}
                style={{
                  backgroundColor: c.surface,
                  borderRadius: r.lg,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: isOpen ? c.accent : c.border,
                  padding: sp.lg,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <Text style={[t.bodyStrong, { color: c.textPrimary, flex: 1 }]}>{topic.q}</Text>
                  <Ionicons
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={15}
                    color={c.textMuted}
                    style={{ marginTop: 3, marginLeft: sp.sm }}
                  />
                </View>
                {isOpen ? (
                  <Text style={[t.caption, { color: c.textSecondary, marginTop: sp.sm }]}>
                    {topic.a}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </Grid>
      )}
    </Screen>
  );
}
