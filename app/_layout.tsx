import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import Head from 'expo-router/head';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { SYSTEM_THEMES, THEMES, type ThemeId } from '../src/theme/themes';
import { Button } from '../src/components/ui/Primitives';
import { useAppStore } from '../src/store/useAppStore';
import {
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
  useFonts,
} from '@expo-google-fonts/space-grotesk';

/**
 * Root layout.
 *
 * The navigator is mounted unconditionally and the boot state is painted over
 * it. Rendering `{ready ? <Stack/> : <Splash/>}` instead would mount and
 * unmount the navigator on every load, which throws away navigation state and
 * is a documented React Navigation footgun.
 */
function Shell() {
  const { c, mode, type: t, space: sp } = useTheme();
  const status = useAppStore((s) => s.status);
  const lastError = useAppStore((s) => s.lastError);
  const load = useAppStore((s) => s.load);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <Head>
        <title>Finlo</title>
        <meta name="description" content="Multi-currency budget and spending tracker." />
      </Head>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />

      <Stack
        screenOptions={{
          headerShown: false,
          title: 'Finlo',
          contentStyle: { backgroundColor: c.canvas },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="transaction/new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="review" options={{ presentation: 'modal' }} />
        <Stack.Screen name="reports" options={{ presentation: 'modal' }} />
        <Stack.Screen name="receipts" options={{ presentation: 'modal' }} />
        <Stack.Screen name="import" options={{ presentation: 'modal' }} />
      </Stack>

      {/* Screens read state synchronously, so covering the first frames avoids a
          flash of "no data" on cold start — which on a money app reads as loss. */}
      {status !== 'ready' ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: c.canvas,
            alignItems: 'center',
            justifyContent: 'center',
            padding: sp.xl,
          }}
        >
          {status === 'error' ? (
            <>
              <Text style={[t.heading, { color: c.critical, textAlign: 'center' }]}>
                Could not open your data
              </Text>
              <Text
                style={[t.caption, { color: c.textMuted, textAlign: 'center', marginTop: sp.sm }]}
              >
                {lastError}
              </Text>
              <View style={{ marginTop: sp.xl }}>
                <Button label="Try again" onPress={() => load()} />
              </View>
            </>
          ) : (
            <ActivityIndicator color={c.accent} />
          )}
        </View>
      ) : null}
    </>
  );
}

/**
 * Reads the stored theme preference before painting anything.
 *
 * `ThemeProvider` has always accepted an override and nothing ever passed one,
 * so the app silently followed the OS and light mode was unreachable on a
 * phone set to dark — including for the person building it.
 */
function Themed({ children }: { children: React.ReactNode }) {
  const preference = useAppStore((s) => s.settings.theme);
  /*
    The stored value is a theme id now, not a mode.

    Builds before v1.2 stored 'light' or 'dark'. Those are not theme ids, and
    passing one through would fall back to the default and silently ignore a
    preference someone had set — so they are mapped onto the theme nominated
    for that side rather than dropped.
  */
  const stored =
    preference === 'light'
      ? SYSTEM_THEMES.light
      : preference === 'dark'
        ? SYSTEM_THEMES.dark
        : preference;

  const override =
    stored && THEMES.some((t) => t.id === stored) ? (stored as ThemeId) : 'system';

  return <ThemeProvider override={override}>{children}</ThemeProvider>;
}

export default function RootLayout() {
  /*
    The display face, loaded before the first paint.

    `useFonts` returns `[loaded, error]`, and the interesting case is the error
    one. A font that fails to load leaves `fontFamily: 'SpaceGrotesk_700Bold'`
    pointing at nothing, and the platform silently falls back to the system face
    — which is fine, and is exactly why this does not block on failure. Holding
    the whole app behind a font would trade a slightly plainer heading for a
    blank screen, which is not a trade worth making for typography.

    It does wait on success, because swapping the face after the first paint
    makes every title jump a few pixels as the metrics change.
  */
  const [fontsLoaded, fontError] = useFonts({
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Themed>
          <Shell />
        </Themed>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
