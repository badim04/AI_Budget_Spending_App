/**
 * The page shell every screen scrolls inside.
 *
 * Nine screens each hand-rolled the same `ScrollView` with the same
 * `contentContainerStyle`, and the numbers had already drifted — 560 on Home
 * and Insights, 620 on Budgets, Settings, Goals and Review, 640 on Import. Nine
 * copies of a layout decision is nine places to change when the answer moves,
 * and the answer has just moved: those caps were written for a phone and made
 * the desktop build a phone-shaped strip down the middle of the display.
 *
 * `Screen` owns it once. It reads the width, applies the right cap and gutter,
 * and handles the safe-area insets that every one of those copies also repeated.
 *
 * `Row` and `Col` are the grid that goes with it: a screen says how many cards
 * it wants across at its widest and gets fewer on a narrow display, instead of
 * every screen re-deriving breakpoint arithmetic inline.
 */

import React from 'react';
import { ScrollView, View, type ViewStyle, type StyleProp } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeProvider';
import { columnsFor, useLayout } from '../../theme/layout';

export function Screen({
  children,
  /**
   * Extra bottom room for the floating action button and the tab bar. Phones
   * need it; a desktop with a side rail does not.
   */
  fab = false,
  scroll = true,
  style,
}: {
  children: React.ReactNode;
  fab?: boolean;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { c, space: sp } = useTheme();
  const insets = useSafeAreaInsets();
  const layout = useLayout();

  const content: ViewStyle = {
    paddingTop: insets.top + sp.lg,
    paddingBottom: insets.bottom + (fab ? 96 : sp.xxl),
    paddingHorizontal: layout.gutter,
    width: '100%',
    maxWidth: layout.maxWidth,
    alignSelf: 'center',
  };

  if (!scroll) {
    return (
      <View style={[{ flex: 1, backgroundColor: c.canvas }, style]}>
        <View style={[content, { flex: 1 }]}>{children}</View>
      </View>
    );
  }

  return (
    <ScrollView
      style={[{ flex: 1, backgroundColor: c.canvas }, style]}
      contentContainerStyle={content}
    >
      {children}
    </ScrollView>
  );
}

/**
 * A row of equal columns that reflows with the width.
 *
 * `ideal` is what the content wants at full width; the row gives it that many
 * on a desktop and fewer on a phone. `phoneMin` defaults to 2 because of the
 * standing rule — no screen ships as a single column of identical rectangles —
 * but a genuinely unsplittable item can pass 1.
 *
 * Wrapping is by percentage width rather than flex, so the last item in an odd
 * row stays its own size instead of stretching across the gap and breaking the
 * grid it belongs to.
 */
export function Grid({
  children,
  ideal = 3,
  phoneMin = 2,
  gap,
}: {
  children: React.ReactNode;
  ideal?: number;
  phoneMin?: number;
  gap?: number;
}) {
  const { space: sp } = useTheme();
  const layout = useLayout();
  const g = gap ?? sp.sm;
  const cols = columnsFor(layout, ideal, phoneMin);
  const items = React.Children.toArray(children).filter(Boolean);

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -g / 2 }}>
      {items.map((item, i) => (
        <View
          key={i}
          style={{
            width: `${100 / cols}%`,
            paddingHorizontal: g / 2,
            paddingBottom: g,
          }}
        >
          {item}
        </View>
      ))}
    </View>
  );
}

/**
 * Two panels side by side on a wide screen, stacked on a phone.
 *
 * The desktop dashboard problem in one component: a chart and its supporting
 * list want to sit beside each other when there is room and above each other
 * when there is not. `ratio` is the fraction the first panel takes.
 */
export function Split({
  children,
  ratio = 0.62,
  gap,
  /** Stack below this, rather than at the global tablet breakpoint. */
  stackOnTablet = false,
}: {
  children: React.ReactNode;
  ratio?: number;
  gap?: number;
  stackOnTablet?: boolean;
}) {
  const { space: sp } = useTheme();
  const layout = useLayout();
  const g = gap ?? sp.lg;
  const panels = React.Children.toArray(children).filter(Boolean);
  const side = layout.isDesktop || (layout.isTablet && !stackOnTablet);

  if (!side) {
    return (
      <View>
        {panels.map((panel, i) => (
          <View key={i} style={{ marginTop: i === 0 ? 0 : g }}>
            {panel}
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={{ flexDirection: 'row', marginHorizontal: -g / 2 }}>
      {panels.map((panel, i) => (
        <View
          key={i}
          style={{
            width: panels.length === 2 ? `${(i === 0 ? ratio : 1 - ratio) * 100}%` : `${100 / panels.length}%`,
            paddingHorizontal: g / 2,
          }}
        >
          {panel}
        </View>
      ))}
    </View>
  );
}
