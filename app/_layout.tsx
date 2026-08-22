import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import Head from 'expo-router/head';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { Button } from '../src/components/ui/Primitives';
import { useAppStore } from '../src/store/useAppStore';

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

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <Shell />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
