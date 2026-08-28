/**
 * The layout vocabulary the app was missing.
 *
 * Finlo was one column of full-width rectangles, top to bottom, every one the
 * same shape and the same colour. That is the layout of a report, and it is why
 * the app read as accounting software no matter how the cards were styled.
 *
 * What makes a consumer finance app feel navigable is not more colour on the
 * same rectangles — it is **structural variety**. A swipeable hero. A grid of
 * small tiles, each a different colour, each with a tag and a glyph. A row that
 * scrolls sideways. A banner that spans the width. The eye gets landmarks
 * instead of a list, and you learn "the green one is goals" and stop reading
 * labels.
 *
 * Four pieces, deliberately small:
 *
 *   `HeroCarousel`         one big thing at a time, with dots
 *   `TileGrid`             two columns of coloured tiles
 *   `ScrollRow`            a sideways row of small cards
 *   `StatRow` / `StatTile` two or three figures across, each with its movement
 *   `SegmentedControl`     one choice from two or three, as a track
 *   `Banner`               full width, for one message
 *
 * The "illustration" in each tile is an oversized glyph at low opacity,
 * rotated and bled off the corner. Real vector art would be better and needs a
 * designer; this gets most of the texture for none of the asset pipeline, and
 * it inherits the tile's own colour so it never fights the palette.
 */

import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Animated,
  StyleSheet,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { useEnter, usePressScale } from '../../theme/motion';
import { columnsFor, useLayout } from '../../theme/layout';

export type TileTone = 'violet' | 'blue' | 'teal' | 'green' | 'amber' | 'pink';

// ------------------------------------------------------------------ hero

/**
 * One big card at a time, swiped sideways.
 *
 * The dashboard's most important number used to be a static block. Paging
 * turns "here is a figure" into "here are the three things about your money",
 * without making the screen any longer — which is the trade every phone home
 * screen is making.
 */
export function HeroCarousel({ children }: { children: React.ReactNode }) {
  const { c, space: sp } = useTheme();
  const { width } = useWindowDimensions();
  const layout = useLayout();
  const [page, setPage] = useState(0);

  const slides = React.Children.toArray(children).filter(Boolean);

  /**
   * A deck on a phone, a row on a desktop.
   *
   * Paging exists because a phone has room for one big figure at a time, and
   * swiping is how you ask for the next one. Neither half of that is true with
   * a mouse: there is room for all three, and a horizontal swipe is a gesture
   * a trackpad user has to discover. Showing one card and hiding two behind an
   * interaction nobody performs is worse than the static block this replaced.
   */
  if (layout.isDesktop && slides.length > 1) {
    return (
      <View style={{ flexDirection: 'row', marginHorizontal: -sp.md / 2 }}>
        {slides.map((slide, i) => (
          <View key={i} style={{ flex: 1, paddingHorizontal: sp.md / 2 }}>
            {slide}
          </View>
        ))}
      </View>
    );
  }

  // The scroller is edge-to-edge; the card inside keeps the page gutter.
  const pageWidth = Math.min(width, layout.maxWidth) - layout.gutter * 2;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, pageWidth));
    if (next !== page) setPage(next);
  };

  if (slides.length === 1) return <>{slides[0]}</>;

  return (
    <View>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={32}
        decelerationRate="fast"
        snapToInterval={pageWidth}
      >
        {slides.map((slide, i) => (
          <View key={i} style={{ width: pageWidth, paddingRight: i === slides.length - 1 ? 0 : sp.md }}>
            {slide}
          </View>
        ))}
      </ScrollView>

      <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: sp.md }}>
        {slides.map((_, i) => (
          <View
            key={i}
            style={{
              width: i === page ? 18 : 6,
              height: 6,
              borderRadius: 3,
              marginHorizontal: 3,
              backgroundColor: i === page ? c.accent : c.border,
            }}
          />
        ))}
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ tiles

/**
 * Two across on a phone, more when there is room.
 *
 * The count used to be a hardcoded 50%. That is right on a phone and wrong the
 * moment the window is a laptop: four destination tiles in two columns at
 * desktop width are 500pt wide each, which is not a tile, it is a banner
 * wearing a tile's clothes. `columnsFor` gives 2 / 3 / 4 and never fewer than
 * two, so the standing rule holds at the narrow end and the space gets used at
 * the wide one.
 */
export function TileGrid({
  children,
  gap,
  ideal = 4,
}: {
  children: React.ReactNode;
  gap?: number;
  /** Columns at full desktop width. */
  ideal?: number;
}) {
  const { space: sp } = useTheme();
  const layout = useLayout();
  const g = gap ?? sp.md;
  const cols = columnsFor(layout, ideal);
  const tiles = React.Children.toArray(children).filter(Boolean);

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -g / 2 }}>
      {tiles.map((tile, i) => (
        <View
          key={i}
          style={{ width: `${100 / cols}%`, paddingHorizontal: g / 2, paddingBottom: g }}
        >
          {tile}
        </View>
      ))}
    </View>
  );
}

export function Tile({
  tone,
  tag,
  title,
  subtitle,
  glyph,
  onPress,
  index = 0,
}: {
  tone: TileTone;
  /** The bright chip in the corner: the action, not the state. */
  tag?: string;
  title: string;
  subtitle?: string;
  /** Oversized, faded, bled off the bottom-right — the tile's texture. */
  glyph?: string;
  onPress?: () => void;
  index?: number;
}) {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const enter = useEnter(index);
  const press = usePressScale();
  const palette = c.tile[tone];

  return (
    <Animated.View style={enter}>
      <Animated.View style={press.style}>
        <Pressable
          onPress={onPress}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          disabled={!onPress}
          accessibilityRole={onPress ? 'button' : undefined}
          accessibilityLabel={`${title}${subtitle ? `. ${subtitle}` : ''}`}
          style={{
            minHeight: 132,
            borderRadius: r.lg,
            backgroundColor: palette.bg,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.border,
            padding: sp.lg,
            overflow: 'hidden',
            justifyContent: 'space-between',
          }}
        >
          {glyph ? (
            <View
              pointerEvents="none"
              style={{ position: 'absolute', right: -14, bottom: -22, opacity: 0.13 }}
            >
              <Text style={{ fontSize: 86, transform: [{ rotate: '-12deg' }] }}>{glyph}</Text>
            </View>
          ) : null}

          {tag ? (
            <View
              style={{
                alignSelf: 'flex-end',
                backgroundColor: palette.tag,
                borderRadius: r.pill,
                paddingHorizontal: sp.md,
                paddingVertical: 3,
              }}
            >
              <Text style={[t.micro, { color: '#ffffff' }]}>{tag.toUpperCase()}</Text>
            </View>
          ) : (
            <View />
          )}

          <View>
            <Text style={[t.bodyStrong, { color: c.textPrimary }]} numberOfLines={1}>
              {title}
            </Text>
            {subtitle ? (
              <Text style={[t.micro, { color: palette.fg, marginTop: 3 }]} numberOfLines={2}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

// ------------------------------------------------------------- scroll row

/**
 * A row that runs off the edge of the screen.
 *
 * Bleeding past the gutter is the point: a card cut off at the right edge is
 * what tells someone there is more sideways. A row that stops neatly inside
 * the margin looks finished, and nobody swipes it.
 */
export function ScrollRow({
  title,
  action,
  onAction,
  children,
  gutter,
}: {
  title?: string;
  action?: string;
  onAction?: () => void;
  children: React.ReactNode;
  gutter: number;
}) {
  const { c, type: t, space: sp } = useTheme();
  const items = React.Children.toArray(children).filter(Boolean);

  return (
    <View style={{ marginTop: sp.xl, marginHorizontal: -gutter }}>
      {title ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: gutter,
            marginBottom: sp.md,
          }}
        >
          <Text style={[t.heading, { color: c.textPrimary }]}>{title}</Text>
          {action ? (
            <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
              <Text style={[t.caption, { color: c.accent }]}>{action} ›</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: gutter }}
      >
        {items.map((item, i) => (
          <View key={i} style={{ marginRight: i === items.length - 1 ? 0 : sp.md }}>
            {item}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

/** A small card for a `ScrollRow`: an action, not a destination. */
export function MiniCard({
  tone,
  glyph,
  title,
  subtitle,
  onPress,
  index = 0,
}: {
  tone: TileTone;
  glyph: string;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  index?: number;
}) {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const enter = useEnter(index);
  const press = usePressScale();
  const palette = c.tile[tone];

  return (
    <Animated.View style={enter}>
      <Animated.View style={press.style}>
        <Pressable
          onPress={onPress}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          accessibilityRole="button"
          accessibilityLabel={title}
          style={{
            width: 132,
            borderRadius: r.lg,
            backgroundColor: palette.bg,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.border,
            padding: sp.md,
          }}
        >
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 17,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: palette.tag + '2e',
              marginBottom: sp.sm,
            }}
          >
            <Text style={{ fontSize: 16 }}>{glyph}</Text>
          </View>
          <Text style={[t.caption, { color: c.textPrimary }]} numberOfLines={2}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[t.micro, { color: palette.fg, marginTop: 2 }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

// ------------------------------------------------------------------ stats

/**
 * Two or three figures across, not one under another.
 *
 * Money out and money in are one fact with two halves, and stacking them turns
 * a comparison into a sequence — you read the first, scroll, and then have to
 * hold it in your head to make sense of the second. Side by side, the
 * comparison is free.
 *
 * Equal widths, always, however different the labels are: unequal columns read
 * as a hierarchy, and neither of these outranks the other.
 */
export function StatRow({ children, gap }: { children: React.ReactNode; gap?: number }) {
  const { space: sp } = useTheme();
  const g = gap ?? sp.sm;
  const items = React.Children.toArray(children).filter(Boolean);

  return (
    <View style={{ flexDirection: 'row', marginHorizontal: -g / 2 }}>
      {items.map((item, i) => (
        <View key={i} style={{ flex: 1, paddingHorizontal: g / 2 }}>
          {item}
        </View>
      ))}
    </View>
  );
}

/**
 * One figure, its label, and optionally which way it moved.
 *
 * `value` arrives already formatted. Money formatting belongs to `core/money`,
 * and a layout component that reached for it would become the second place
 * deciding how a naira is written.
 *
 * The movement is a chip rather than coloured text because the sign has to
 * survive being glanced at: an arrow reads at a distance where a minus sign
 * does not, and it still reads for someone who cannot separate red from green.
 */
export function StatTile({
  label,
  value,
  delta,
  deltaTone = 'neutral',
  caption,
  tone,
  onPress,
  index = 0,
}: {
  label: string;
  value: string;
  /** Already phrased — "12%", "₦4,300", "3 more". */
  delta?: string;
  deltaTone?: 'good' | 'bad' | 'neutral';
  caption?: string;
  /** A tinted panel instead of a plain surface. */
  tone?: TileTone;
  onPress?: () => void;
  index?: number;
}) {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const enter = useEnter(index);
  const press = usePressScale(0.98);
  const palette = tone ? c.tile[tone] : null;

  const deltaColor =
    deltaTone === 'good' ? c.good : deltaTone === 'bad' ? c.critical : c.textMuted;

  const body = (
    <View
      style={{
        borderRadius: r.lg,
        backgroundColor: palette?.bg ?? c.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette?.border ?? c.border,
        paddingHorizontal: sp.md,
        paddingVertical: sp.md,
        minHeight: 92,
        justifyContent: 'space-between',
      }}
    >
      <Text style={[t.micro, { color: c.textMuted }]} numberOfLines={1}>
        {label.toUpperCase()}
      </Text>

      <Text
        style={[
          t.heading,
          { color: c.textPrimary, marginTop: 2, fontVariant: ['tabular-nums'] },
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {value}
      </Text>

      {delta || caption ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
          {delta ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: deltaColor + '22',
                borderRadius: r.pill,
                paddingHorizontal: 6,
                paddingVertical: 2,
              }}
            >
              {deltaTone !== 'neutral' ? (
                <Ionicons
                  name={deltaTone === 'good' ? 'arrow-down' : 'arrow-up'}
                  size={9}
                  color={deltaColor}
                />
              ) : null}
              <Text
                style={[
                  t.micro,
                  { color: deltaColor, marginLeft: deltaTone === 'neutral' ? 0 : 2 },
                ]}
              >
                {delta}
              </Text>
            </View>
          ) : null}
          {caption ? (
            <Text
              style={[t.micro, { color: c.textMuted, marginLeft: delta ? 6 : 0, flex: 1 }]}
              numberOfLines={1}
            >
              {caption}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  if (!onPress) return <Animated.View style={enter}>{body}</Animated.View>;

  return (
    <Animated.View style={enter}>
      <Animated.View style={press.style}>
        <Pressable
          onPress={onPress}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${value}${delta ? `, ${delta}` : ''}`}
        >
          {body}
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

// ------------------------------------------------------------- segmented

/**
 * One choice out of two or three, as a track.
 *
 * Every screen had grown its own row of pill chips, and a row of chips does not
 * say how many there are or that they are mutually exclusive — it looks like a
 * set of filters you can combine. A sunken track with one raised segment is the
 * shape the phone already uses for "pick exactly one of these", and it takes
 * one line of height instead of wrapping to two.
 *
 * Labels stay short for that reason: three segments have to fit across the
 * narrowest phone without truncating, so a count goes in `badge` rather than
 * into the label as "(69)".
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string; badge?: number }>;
  value: T;
  onChange: (next: T) => void;
}) {
  const { c, type: t, space: sp, radius: r } = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: c.surfaceSunken,
        borderRadius: r.pill,
        padding: 3,
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: r.pill,
              paddingVertical: sp.sm,
              backgroundColor: active ? c.surface : 'transparent',
            }}
          >
            <Text
              style={[t.caption, { color: active ? c.textPrimary : c.textMuted }]}
              numberOfLines={1}
            >
              {option.label}
            </Text>
            {option.badge ? (
              <View
                style={{
                  marginLeft: 5,
                  minWidth: 17,
                  height: 17,
                  paddingHorizontal: 4,
                  borderRadius: 9,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: active ? c.accent : c.border,
                }}
              >
                <Text
                  style={[
                    t.micro,
                    { color: active ? c.onAccent : c.textSecondary, fontSize: 10 },
                  ]}
                >
                  {option.badge > 99 ? '99+' : option.badge}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// ----------------------------------------------------------------- banner


/** Full width, one message, a glyph big enough to be furniture. */
export function Banner({
  tone,
  title,
  body,
  action,
  onPress,
  glyph,
  style,
}: {
  tone: TileTone;
  title: string;
  body?: string;
  action?: string;
  onPress?: () => void;
  glyph?: string;
  style?: ViewStyle;
}) {
  const { c, type: t, space: sp, radius: r } = useTheme();
  const press = usePressScale(0.99);
  const palette = c.tile[tone];

  return (
    <Animated.View style={[press.style, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={`${title}${body ? `. ${body}` : ''}`}
        style={{
          borderRadius: r.lg,
          backgroundColor: palette.bg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.border,
          padding: sp.lg,
          flexDirection: 'row',
          alignItems: 'center',
          overflow: 'hidden',
        }}
      >
        {glyph ? (
          <View
            style={{
              width: 46,
              height: 46,
              borderRadius: 23,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: palette.tag + '2e',
              marginRight: sp.md,
            }}
          >
            <Text style={{ fontSize: 22 }}>{glyph}</Text>
          </View>
        ) : null}

        <View style={{ flex: 1 }}>
          <Text style={[t.bodyStrong, { color: c.textPrimary }]}>{title}</Text>
          {body ? (
            <Text style={[t.micro, { color: palette.fg, marginTop: 3 }]}>{body}</Text>
          ) : null}
        </View>

        {action ? (
          <View
            style={{
              backgroundColor: palette.tag,
              borderRadius: r.pill,
              paddingHorizontal: sp.md,
              paddingVertical: 5,
              marginLeft: sp.sm,
            }}
          >
            <Text style={[t.micro, { color: '#ffffff' }]}>{action.toUpperCase()}</Text>
          </View>
        ) : onPress ? (
          <Ionicons name="chevron-forward" size={16} color={palette.fg} />
        ) : null}
      </Pressable>
    </Animated.View>
  );
}
