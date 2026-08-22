/**
 * Over-the-air updates.
 *
 * A build carries native code (the APK) and JavaScript (everything in `app/`
 * and `src/`). EAS Update replaces the JavaScript without a new APK, so a
 * tester who already installed Finlo gets a fix by reopening the app.
 *
 * The hard boundary: **anything that changes native code needs a new APK.**
 * That means adding an Expo package with native modules, changing permissions,
 * or bumping the SDK. `runtimeVersion` in app.json is set to the `appVersion`
 * policy, so bumping `version` deliberately cuts old builds off from new
 * updates rather than shipping them JavaScript their native side cannot run.
 *
 * All of this is inert in Expo Go and in development — `Updates.isEnabled` is
 * false there, and every function below short-circuits.
 */

import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const appJson = require('../../app.json') as { expo?: { version?: string } };

/** OTA is an app-binary concept. On web the server already serves the latest
 *  bundle on reload, and `Updates.isEnabled` is not a reliable signal there. */
const OTA_CAPABLE = Platform.OS !== 'web' && Updates.isEnabled;

export type UpdateState =
  | 'unsupported'   // Expo Go, dev, or web — OTA does not apply
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'         // downloaded, waiting for a reload
  | 'current'       // checked, nothing new
  | 'error';

export interface UpdateInfo {
  state: UpdateState;
  error: string | null;
  /** The build's own version, e.g. "0.1.0". */
  appVersion: string;
  /** Which update the app is currently running, for bug reports. */
  updateId: string | null;
  channel: string | null;
  isEmbedded: boolean;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const v of values) {
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return 'dev';
}

export function updateSupported(): boolean {
  return OTA_CAPABLE;
}

export function currentUpdateInfo(): Pick<
  UpdateInfo,
  'appVersion' | 'updateId' | 'channel' | 'isEmbedded'
> {
  return {
    // `??` is not enough here: on web `Updates.runtimeVersion` is an empty
    // STRING rather than null, which passes through nullish coalescing and
    // renders a blank row. Every candidate has to be tested for content.
    appVersion: firstNonEmpty(
      Updates.runtimeVersion,
      Constants.expoConfig?.version,
      appJson.expo?.version,
      'dev'
    ),
    updateId: Updates.updateId ?? null,
    channel: Updates.channel && Updates.channel !== '' ? Updates.channel : null,
    isEmbedded: Updates.isEmbeddedLaunch,
  };
}

/**
 * Check, download, and offer a reload.
 *
 * Deliberately does NOT reload on its own. Restarting the app under someone
 * who is halfway through typing a transaction is worse than showing them a
 * button — so the reload is always their call.
 */
export function useOtaUpdates(checkOnMount = true) {
  const [state, setState] = useState<UpdateState>(OTA_CAPABLE ? 'idle' : 'unsupported');
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    if (!OTA_CAPABLE) {
      setState('unsupported');
      return;
    }
    setError(null);
    setState('checking');
    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) {
        setState('current');
        return;
      }
      setState('downloading');
      await Updates.fetchUpdateAsync();
      setState('ready');
    } catch (e) {
      // A failed check must never block the app — the user keeps running the
      // version they have, which is a perfectly good outcome.
      setError(e instanceof Error ? e.message : String(e));
      setState('error');
    }
  }, []);

  const applyNow = useCallback(async () => {
    try {
      await Updates.reloadAsync();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState('error');
    }
  }, []);

  useEffect(() => {
    if (checkOnMount && OTA_CAPABLE) void check();
  }, [check, checkOnMount]);

  return {
    ...currentUpdateInfo(),
    state,
    error,
    check,
    applyNow,
  };
}

/** One-line summary for the Settings row. */
export function describeUpdateState(state: UpdateState): string {
  switch (state) {
    case 'unsupported':
      return 'Only applies to installed builds, not Expo Go or web';
    case 'checking':
      return 'Checking…';
    case 'downloading':
      return 'Downloading update…';
    case 'ready':
      return 'Update ready — restart to apply';
    case 'current':
      return 'You are on the latest version';
    case 'error':
      return 'Could not check for updates';
    default:
      return 'Tap to check for updates';
  }
}
