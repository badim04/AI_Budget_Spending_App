/**
 * How wide the thing on screen is allowed to be.
 *
 * Finlo shipped one layout and pretended the window was always a phone. Every
 * screen set `maxWidth: 560` on its scroll content and centred it, so on a
 * 1920pt display the app was a phone-shaped column with two feet of empty
 * canvas either side. It was not a web app that looked plain — it was a phone
 * app being shown on a desktop, which is a different and worse thing.
 *
 * The fix is not "let it stretch". A 1900pt line of text is unreadable and a
 * transaction row 1900pt wide puts the merchant and the amount so far apart the
 * eye cannot pair them. What a desktop wants is not wider rows, it is **more
 * columns** — the same cards, laid out across the space instead of down it.
 *
 * So this module answers three questions and nothing else:
 *
 *   `kind`     phone, tablet or desktop
 *   `maxWidth` how wide the content column may grow
 *   `columns`  how many things fit across at this size
 *
 * Breakpoints match the ones navigation already uses (`SideNav.useNavLayout`),
 * because a layout that reflows at a different width from the nav produces a
 * band where the rail has appeared but the content has not adapted, and that
 * band is always the one someone's laptop happens to sit in.
 */

import { useWindowDimensions } from 'react-native';

export type ScreenKind = 'phone' | 'tablet' | 'desktop';

/** 600 is where the nav rail appears; 900 is where it expands to show labels. */
export const BREAKPOINTS = { tablet: 600, desktop: 900, wide: 1280 } as const;

export interface LayoutInfo {
  kind: ScreenKind;
  /** True below the tablet breakpoint — the one-hand, one-column case. */
  isPhone: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  /**
   * Cap for the readable content column.
   *
   * Phones use the whole width. A desktop gets a genuinely wide canvas — but
   * capped, because beyond about 1240pt a dashboard stops being scannable and
   * starts being a spreadsheet.
   */
  maxWidth: number;
  /** Page gutter. Bigger on desktop, where edge-to-edge looks unfinished. */
  gutter: number;
  /**
   * How many cards fit across.
   *
   * The design rule — no screen ships as a single column of identical
   * rectangles — is a floor of 2 on a phone, not a ceiling. A desktop that
   * keeps the phone's two columns wastes the space it was given.
   */
  columns: number;
}

export function useLayout(): LayoutInfo {
  const { width } = useWindowDimensions();

  const isDesktop = width >= BREAKPOINTS.desktop;
  const isTablet = !isDesktop && width >= BREAKPOINTS.tablet;
  const isPhone = width < BREAKPOINTS.tablet;

  return {
    kind: isDesktop ? 'desktop' : isTablet ? 'tablet' : 'phone',
    isPhone,
    isTablet,
    isDesktop,
    maxWidth: isDesktop ? (width >= BREAKPOINTS.wide ? 1240 : 1080) : isTablet ? 820 : 560,
    gutter: isDesktop ? 32 : isTablet ? 24 : 16,
    columns: isDesktop ? (width >= BREAKPOINTS.wide ? 4 : 3) : isTablet ? 3 : 2,
  };
}

/**
 * Clamp a column count to what the width can actually carry.
 *
 * A caller asking for four across on a phone gets two. Written as a helper so
 * a screen states its ideal ("this reads best three across") rather than
 * re-deriving the breakpoint arithmetic, which is how the maxWidth values
 * drifted apart across nine screens in the first place.
 */
export function columnsFor(layout: LayoutInfo, ideal: number, phoneMin = 2): number {
  return Math.max(phoneMin, Math.min(ideal, layout.columns));
}
