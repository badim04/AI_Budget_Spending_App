/**
 * The category picker, as a themed sheet.
 *
 * It replaces two things that were doing this job badly: a strip of ten
 * category chips that could not show the rest, and a native `Alert` asking
 * "apply to 11 more?" — a white system dialog dropped into a dark app, with
 * the question asked after the decision had already been committed.
 *
 * The design points, in order of how much they matter:
 *
 *  1. **Every category, not the first ten**, filtered to the direction of the
 *     transaction. Filing money received under "Groceries" is never right, so
 *     inflows offer income categories and outflows offer expense ones.
 *  2. **The bulk decision is made before committing, not asked afterwards.**
 *     If eleven other unreviewed rows go to the same person, that is a toggle
 *     at the top, already on. One tap files all twelve.
 *  3. **A new category can be created without leaving.** Needing a category
 *     that does not exist is the most common reason to abandon a review pass.
 */

import React, { useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  StyleSheet,
  Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './ui/Primitives';
import type { Category, CategoryKind } from '../core/types';

export interface CategorySheetProps {
  visible: boolean;
  /** What is being filed — shown so the user knows what they are deciding on. */
  title: string;
  subtitle?: string;
  /** Inflows get income categories, outflows get expense ones. */
  kind: CategoryKind;
  categories: Category[];
  /** How many OTHER unreviewed rows this one decision could also cover. */
  alsoCount?: number;
  /** "to Rashidat Bashiru" / "from Hammed Lekan Adeleke" / "like this". */
  alsoLabel?: string;
  onClose: () => void;
  onPick: (categoryId: string, applyToAll: boolean) => void;
  onCreate: (name: string, kind: CategoryKind) => Promise<Category>;
  /** Mark reviewed without choosing — some rows genuinely have no category. */
  onKeepAsIs?: () => void;
}

export function CategorySheet({
  visible,
  title,
  subtitle,
  kind,
  categories,
  alsoCount = 0,
  alsoLabel = 'like this',
  onClose,
  onPick,
  onCreate,
  onKeepAsIs,
}: CategorySheetProps) {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const insets = useSafeAreaInsets();

  const [applyToAll, setApplyToAll] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [query, setQuery] = useState('');

  const options = useMemo(() => {
    const forKind = categories.filter((cat) => !cat.archived && cat.kind === kind);
    const needle = query.trim().toLowerCase();
    const matching = needle
      ? forKind.filter((cat) => cat.name.toLowerCase().includes(needle))
      : forKind;
    return [...matching].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }, [categories, kind, query]);

  // Reopening for a different transaction must not inherit the last one's state.
  React.useEffect(() => {
    if (visible) {
      setApplyToAll(true);
      setCreating(false);
      setNewName('');
      setQuery('');
    }
  }, [visible]);

  async function createAndPick() {
    const name = newName.trim();
    if (!name) return;
    const category = await onCreate(name, kind);
    onPick(category.id, alsoCount > 0 && applyToAll);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Tapping the dimmed area behind the sheet closes it. */}
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }}
        onPress={onClose}
        accessibilityLabel="Close category picker"
      />

      <View
        style={{
          backgroundColor: c.surface,
          borderTopLeftRadius: r.lg,
          borderTopRightRadius: r.lg,
          paddingTop: sp.md,
          paddingBottom: insets.bottom + sp.lg,
          maxHeight: '82%',
          borderTopWidth: StyleSheet.hairlineWidth,
          borderColor: c.border,
        }}
      >
        <View
          style={{
            alignSelf: 'center',
            width: 40,
            height: 4,
            borderRadius: 2,
            backgroundColor: c.border,
            marginBottom: sp.md,
          }}
        />

        <View style={{ paddingHorizontal: sp.lg }}>
          <Text style={[t.heading, { color: c.textPrimary }]} numberOfLines={2}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[t.micro, { color: c.textMuted, marginTop: 2 }]}>{subtitle}</Text>
          ) : null}
        </View>

        {alsoCount > 0 ? (
          <Pressable
            onPress={() => setApplyToAll((v) => !v)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginTop: sp.md,
              marginHorizontal: sp.lg,
              padding: sp.md,
              borderRadius: r.md,
              backgroundColor: applyToAll ? c.accentSubtle : c.surfaceSunken,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: applyToAll ? c.accent : c.border,
            }}
          >
            <View style={{ flex: 1, paddingRight: sp.md }}>
              <Text style={[t.body, { color: c.textPrimary }]}>
                Apply to all {alsoCount + 1} {alsoLabel}
              </Text>
              <Text style={[t.micro, { color: c.textMuted, marginTop: 2 }]}>
                {applyToAll
                  ? `${alsoCount} other unreviewed row${alsoCount === 1 ? '' : 's'} will be filed too.`
                  : 'Only this one will be filed.'}
              </Text>
            </View>
            <Switch
              value={applyToAll}
              onValueChange={setApplyToAll}
              trackColor={{ true: c.accent, false: c.border }}
            />
          </Pressable>
        ) : null}

        {creating ? (
          <View style={{ paddingHorizontal: sp.lg, marginTop: sp.lg }}>
            <Text style={[t.micro, { color: c.textMuted }]}>NEW CATEGORY</Text>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              autoFocus
              placeholder={kind === 'income' ? 'e.g. Side gig' : 'e.g. Family support'}
              placeholderTextColor={c.textMuted}
              onSubmitEditing={createAndPick}
              returnKeyType="done"
              style={{
                color: c.textPrimary,
                backgroundColor: c.surfaceSunken,
                borderRadius: r.md,
                paddingHorizontal: sp.md,
                paddingVertical: sp.md,
                fontSize: 16,
                marginTop: sp.sm,
              }}
            />
            <View style={{ flexDirection: 'row', marginTop: sp.md }}>
              <View style={{ flex: 1 }}>
                <Button label="Cancel" variant="secondary" onPress={() => setCreating(false)} />
              </View>
              <View style={{ width: sp.sm }} />
              <View style={{ flex: 1 }}>
                <Button label="Create and file" onPress={createAndPick} />
              </View>
            </View>
          </View>
        ) : (
          <>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginTop: sp.lg,
                marginHorizontal: sp.lg,
                paddingHorizontal: sp.md,
                borderRadius: r.md,
                backgroundColor: c.surfaceSunken,
              }}
            >
              <Ionicons name="search" size={15} color={c.textMuted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Find a category"
                placeholderTextColor={c.textMuted}
                style={{
                  flex: 1,
                  color: c.textPrimary,
                  paddingVertical: sp.md,
                  marginLeft: sp.sm,
                  fontSize: 15,
                }}
              />
            </View>

            <ScrollView
              style={{ marginTop: sp.sm }}
              contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.md }}
              keyboardShouldPersistTaps="handled"
            >
              {options.map((cat) => (
                <Pressable
                  key={cat.id}
                  onPress={() => onPick(cat.id, alsoCount > 0 && applyToAll)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: sp.md,
                    paddingHorizontal: sp.md,
                    borderRadius: r.md,
                    backgroundColor: pressed ? c.accentSubtle : 'transparent',
                  })}
                >
                  <Text style={{ fontSize: 18, marginRight: sp.md }}>{cat.icon}</Text>
                  <Text style={[t.body, { color: c.textPrimary, flex: 1 }]}>{cat.name}</Text>
                  <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
                </Pressable>
              ))}

              {options.length === 0 ? (
                <Text style={[t.body, { color: c.textMuted, padding: sp.md }]}>
                  No category matches that.
                </Text>
              ) : null}
            </ScrollView>

            <View style={{ paddingHorizontal: sp.lg, paddingTop: sp.sm }}>
              <Button
                label={query.trim() ? `Create "${query.trim()}"` : 'New category'}
                variant="secondary"
                icon="+"
                onPress={() => {
                  setNewName(query.trim());
                  setCreating(true);
                }}
              />
              {onKeepAsIs ? (
                <Pressable
                  onPress={onKeepAsIs}
                  hitSlop={8}
                  style={{ alignSelf: 'center', paddingTop: sp.md }}
                >
                  <Text style={[t.micro, { color: c.textMuted }]}>
                    Leave uncategorised and mark reviewed
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}
