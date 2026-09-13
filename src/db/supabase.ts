/**
 * The Supabase client — auth, sync and receipt storage.
 *
 * **Env-gated on purpose.** With `EXPO_PUBLIC_SUPABASE_URL` /
 * `EXPO_PUBLIC_SUPABASE_ANON_KEY` unset, `getSupabase()` returns `null` and the
 * app behaves exactly as it does today: fully usable, signed-out, local-only.
 * Sign-in *adds* sync; it never gates the app. Callers must handle the `null`.
 *
 * **The anon key is safe to ship.** It authorises nothing on its own — every
 * table is protected by row-level security (`server/supabase/schema.sql`), so a
 * request can only ever touch the signed-in user's own rows. The key that is
 * NOT safe is the service_role key; it must never appear in the app bundle.
 *
 * **No new native module.** `@supabase/supabase-js` and `react-native-url-polyfill`
 * are pure JS, and the session is persisted with `expo-secure-store` (already
 * used for the Gmail token) rather than AsyncStorage — so this ships over the
 * air, no APK rebuild.
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// The client fetches over URLs the RN runtime cannot fully parse without this;
// on web the platform already has a compliant URL, so the polyfill is native-only.
if (Platform.OS !== 'web') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-url-polyfill/auto');
}

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** True only when both keys are present — the single gate every caller checks. */
export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}

/**
 * Session storage backed by the device keychain.
 *
 * SecureStore keys allow only `[A-Za-z0-9._-]`, which the Supabase storage key
 * (`sb-<ref>-auth-token`) already satisfies. Reads and writes are async, which
 * is exactly the shape Supabase's storage interface expects.
 */
const secureStore = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

let client: SupabaseClient | null = null;

/**
 * The shared client, or `null` when Supabase is not configured.
 *
 * Built lazily and once — `createClient` opens a session-refresh timer, so a
 * new client per call would leak them.
 */
export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (client) return client;

  client = createClient(url!, anonKey!, {
    auth: {
      // Web keeps Supabase's default (localStorage); native uses the keychain.
      storage: Platform.OS === 'web' ? undefined : secureStore,
      persistSession: true,
      autoRefreshToken: true,
      // We are not an OAuth-redirect web app; a URL fragment is never our session.
      detectSessionInUrl: false,
    },
  });
  return client;
}
