import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { PALETTES, chart, elevation, motion, radius, space, type, type Palette, type ThemeMode } from './tokens';

export interface Theme {
  mode: ThemeMode;
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
  /** 'system' follows the OS; anything else pins the mode. */
  override?: ThemeMode | 'system';
}) {
  const system = useColorScheme();
  const mode: ThemeMode =
    override && override !== 'system' ? override : system === 'light' ? 'light' : 'dark';

  const value = useMemo<Theme>(
    () => ({
      mode,
      c: PALETTES[mode],
      space,
      radius,
      type,
      elevation,
      chart,
      motion,
    }),
    [mode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside a ThemeProvider');
  return ctx;
}
