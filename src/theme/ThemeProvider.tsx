import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { chart, elevation, motion, radius, space, type, type Palette, type ThemeMode } from './tokens';
import {
  DEFAULT_THEME,
  PALETTE_BY_THEME,
  SYSTEM_THEMES,
  themeSeed,
  type ThemeId,
} from './themes';

export interface Theme {
  mode: ThemeMode;
  /** Which named theme is showing, so a screen can say so. */
  themeId: ThemeId;
  themeName: string;
  c: Palette;
  space: typeof space;
  radius: typeof radius;
  type: typeof type;
  elevation: typeof elevation;
  chart: typeof chart;
  motion: typeof motion;
}

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({
  children,
  override,
}: {
  children: React.ReactNode;
  /**
   * A theme id, or 'system' to follow the OS.
   *
   * 'system' is not a mode any more: three of the four themes are dark and one
   * is light, so following the phone means nominating one of each rather than
   * flipping a flag. See `SYSTEM_THEMES`.
   */
  override?: ThemeId | 'system';
}) {
  const system = useColorScheme();

  const themeId: ThemeId =
    override && override !== 'system'
      ? override
      : SYSTEM_THEMES[system === 'light' ? 'light' : 'dark'];

  const value = useMemo<Theme>(() => {
    const seed = themeSeed(themeId);
    return {
      mode: seed.scheme,
      themeId: seed.id,
      themeName: seed.name,
      c: PALETTE_BY_THEME[seed.id] ?? PALETTE_BY_THEME[DEFAULT_THEME],
      space,
      radius,
      type,
      elevation,
      chart,
      motion,
    };
  }, [themeId]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside a ThemeProvider');
  return ctx;
}
