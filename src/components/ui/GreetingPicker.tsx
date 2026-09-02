/**
 * Choosing how Finlo greets you.
 *
 * This was seventeen chips, sixteen tick boxes and a pace switch, laid out
 * inline in Settings › Appearance underneath the theme buttons — roughly a
 * screen and a half of controls, in the one place they happened to be easy to
 * add. That is not a decision, it is where the code went.
 *
 * Two things were wrong with it and they are worth naming separately.
 *
 * **It was the wrong shape.** Settings already had a pattern for a preference
 * with many options: display currency is a compact control showing its current
 * value, and the eight choices live in a sheet behind it. The page had learned
 * this once already — the currency chips used to sprawl at the top of it. The
 * greeting immediately did the same thing one section lower.
 *
 * **It was in the wrong place.** A greeting is not an appearance preference
 * like a theme; it is how the app addresses *you*, which is what the Profile
 * block at the top of that page is about.
 *
 * So: a compact row up with the rest of you, showing the language and the line
 * it will actually say, opening this sheet. And the greeting on Home is
 * tappable, because the most obvious place to change a piece of text is the
 * text itself.
 */

import React from 'react';
import { View, Text, Pressable, Modal, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import {
  ALL_LANGUAGES,
  GREETING_LANGUAGES,
  greeting,
  parseMix,
  serialiseMix,
  type GreetingLanguage,
  type GreetingMode,
  type MixPace,
} from '../../core/greeting';

export interface GreetingSettings {
  mode: GreetingMode;
  mix: GreetingLanguage[];
  pace: MixPace;
  name?: string;
}

/** Read the three stored strings into something typed. */
export function readGreetingSettings(settings: Record<string, string | undefined>): GreetingSettings {
  return {
    mode: (settings.greeting_language as GreetingMode) ?? 'en',
    mix: parseMix(settings.greeting_mix),
    pace: (settings.greeting_mix_pace as MixPace) ?? 'daily',
    name: settings.user_name,
  };
}

/** What the row shows on its right: the choice, in one or two words. */
export function describeGreetingChoice(value: GreetingSettings): string {
  if (value.mode !== 'rotate') {
    return GREETING_LANGUAGES.find((l) => l.code === value.mode)?.label ?? 'English';
  }
  const count = value.mix.length === 0 ? ALL_LANGUAGES.length : value.mix.length;
  return `Mix of ${count}`;
}

export function GreetingPicker({
  visible,
  value,
  onChange,
  onClose,
}: {
  visible: boolean;
  value: GreetingSettings;
  onChange: (next: Partial<{ mode: GreetingMode; mix: GreetingLanguage[]; pace: MixPace }>) => void;
  onClose: () => void;
}) {
  const { c, type: t, space: sp, radius: r } = useTheme();

  const mixing = value.mode === 'rotate';
  const chosen = value.mix;
  const isOn = (code: GreetingLanguage) => chosen.length === 0 || chosen.includes(code);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: c.scrim }} onPress={onClose}>
        {/* Stops a tap inside the sheet from closing it. */}
        <Pressable
          onPress={() => {}}
          style={{
            marginTop: 'auto',
            maxHeight: '86%',
            backgroundColor: c.surface,
            borderTopLeftRadius: r.xl,
            borderTopRightRadius: r.xl,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: sp.lg,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: c.border,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[t.heading, { color: c.textPrimary }]}>Greeting</Text>
              {/* The choice, said in the choice's own words. */}
              <Text style={[t.micro, { color: c.textMuted, marginTop: 2 }]} numberOfLines={1}>
                {greeting(new Date(), {
                  name: value.name,
                  mode: value.mode,
                  mix: value.mix,
                  pace: value.pace,
                })}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Done">
              <Ionicons name="close" size={22} color={c.textMuted} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: sp.lg }}>
            {/*
              One row per language, not a wrap of chips.

              Sixteen chips of wildly different widths — "English" beside
              "Japanese (rōmaji)" beside "中文" — wrap into a ragged block that
              cannot be scanned. Rows give every option the same shape, put the
              sample where the eye already is, and let a script sit directly
              above its romanisation so the pairing reads without a label
              explaining it.
            */}
            {GREETING_LANGUAGES.map((language) => {
              const active = !mixing && value.mode === language.code;
              return (
                <Pressable
                  key={language.code}
                  onPress={() => onChange({ mode: language.code })}
                  accessibilityRole="radio"
                  aria-checked={active}
                  accessibilityState={{ selected: active }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: sp.md,
                    paddingHorizontal: sp.md,
                    borderRadius: r.md,
                    marginBottom: 2,
                    // A romanisation is indented under the script it belongs to.
                    marginLeft: language.romanises ? sp.lg : 0,
                    backgroundColor: active ? c.accentSubtle : 'transparent',
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[t.body, { color: active ? c.accent : c.textPrimary }]}>
                      {language.label}
                    </Text>
                    <Text style={[t.micro, { color: c.textMuted, marginTop: 1 }]} numberOfLines={1}>
                      {language.sample}
                    </Text>
                  </View>
                  {active ? <Ionicons name="checkmark" size={18} color={c.accent} /> : null}
                </Pressable>
              );
            })}

            <View
              style={{
                height: StyleSheet.hairlineWidth,
                backgroundColor: c.border,
                marginVertical: sp.md,
              }}
            />

            <Pressable
              onPress={() => onChange({ mode: 'rotate' })}
              accessibilityRole="radio"
              aria-checked={mixing}
              accessibilityState={{ selected: mixing }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: sp.md,
                paddingHorizontal: sp.md,
                borderRadius: r.md,
                backgroundColor: mixing ? c.accentSubtle : 'transparent',
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={[t.body, { color: mixing ? c.accent : c.textPrimary }]}>
                  Mix it up
                </Text>
                <Text style={[t.micro, { color: c.textMuted, marginTop: 1 }]}>
                  Several languages, your pick
                </Text>
              </View>
              {mixing ? <Ionicons name="checkmark" size={18} color={c.accent} /> : null}
            </Pressable>

            {/* The mix controls only exist once mixing is chosen — otherwise
                they are a screenful of controls that do nothing. */}
            {mixing ? (
              <View
                style={{
                  marginTop: sp.md,
                  padding: sp.md,
                  borderRadius: r.lg,
                  backgroundColor: c.surfaceSunken,
                }}
              >
                <Text style={[t.micro, { color: c.textMuted }]}>MIX THESE</Text>
                <View
                  style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.sm }}
                >
                  {GREETING_LANGUAGES.map((language) => {
                    const on = isOn(language.code);
                    return (
                      <Pressable
                        key={language.code}
                        onPress={() => {
                          const current = chosen.length === 0 ? [...ALL_LANGUAGES] : chosen;
                          const next = on
                            ? current.filter((code) => code !== language.code)
                            : [...current, language.code];
                          /*
                            Never let the last one be unticked. An empty mix
                            means "all of them", so clearing the final box would
                            silently switch every language back on — the exact
                            opposite of what the tap asked for.
                          */
                          if (next.length === 0) return;
                          onChange({ mix: next });
                        }}
                        accessibilityRole="checkbox"
                        // react-native-web does not render accessibilityState
                        // on a View with role=checkbox; aria-checked is what it
                        // forwards, accessibilityState is what native reads.
                        aria-checked={on}
                        accessibilityState={{ checked: on }}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          paddingHorizontal: sp.md,
                          paddingVertical: 6,
                          borderRadius: r.pill,
                          backgroundColor: on ? c.accentSubtle : c.surface,
                          borderWidth: StyleSheet.hairlineWidth,
                          borderColor: on ? c.accent : c.border,
                        }}
                      >
                        <Ionicons
                          name={on ? 'checkmark-circle' : 'ellipse-outline'}
                          size={13}
                          color={on ? c.accent : c.textMuted}
                        />
                        <Text
                          style={[
                            t.caption,
                            { color: on ? c.accent : c.textSecondary, marginLeft: 5 },
                          ]}
                        >
                          {language.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={[t.micro, { color: c.textMuted, marginTop: sp.lg }]}>CHANGE IT</Text>
                <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm }}>
                  {(
                    [
                      { value: 'daily', label: 'Once a day', hint: 'One language until midnight' },
                      {
                        value: 'slot',
                        label: 'Through the day',
                        hint: 'A new one each part of the day',
                      },
                    ] as Array<{ value: MixPace; label: string; hint: string }>
                  ).map((option) => {
                    const active = value.pace === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        onPress={() => onChange({ pace: option.value })}
                        accessibilityRole="radio"
                        aria-checked={active}
                        accessibilityState={{ selected: active }}
                        style={{
                          flex: 1,
                          paddingHorizontal: sp.md,
                          paddingVertical: sp.sm,
                          borderRadius: r.md,
                          backgroundColor: active ? c.accentSubtle : c.surface,
                          borderWidth: StyleSheet.hairlineWidth,
                          borderColor: active ? c.accent : c.border,
                        }}
                      >
                        <Text style={[t.caption, { color: active ? c.accent : c.textPrimary }]}>
                          {option.label}
                        </Text>
                        <Text style={[t.micro, { color: c.textMuted, marginTop: 2 }]}>
                          {option.hint}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
