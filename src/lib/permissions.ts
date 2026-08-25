/**
 * Permissions.
 *
 * Two rules, both learned the hard way by every app that gets this wrong:
 *
 * 1. **Ask in context, not all at once on launch.** A wall of system dialogs
 *    before someone has seen the app is the fastest way to get everything
 *    denied, and Android only lets you ask once — a denial is close to
 *    permanent. So onboarding *explains* what each permission is for and the
 *    real prompt fires when the feature is first used.
 *
 * 2. **Once denied, you cannot re-prompt.** `canAskAgain: false` means the only
 *    route left is the OS settings page, so every denial path has to offer to
 *    open it rather than silently doing nothing — which is exactly what the
 *    "Blocked" row in Settings used to do.
 */

import { Alert, Linking, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';

export type PermissionKey = 'camera' | 'photos' | 'notifications';

export type PermissionState = 'granted' | 'denied' | 'blocked' | 'undetermined' | 'unsupported';

export interface PermissionInfo {
  key: PermissionKey;
  label: string;
  why: string;
  icon: string;
  state: PermissionState;
  /** False when the OS will no longer show a prompt — settings is the only way. */
  canAsk: boolean;
}

export const PERMISSION_COPY: Record<PermissionKey, { label: string; why: string; icon: string }> = {
  camera: {
    label: 'Camera',
    why: 'Photograph receipts so the amount, merchant and date can be read for you.',
    icon: 'camera-outline',
  },
  photos: {
    label: 'Photos',
    why: 'Import receipts and bank statements you have already saved.',
    icon: 'images-outline',
  },
  notifications: {
    label: 'Notifications',
    why: 'Warn you when a budget is running ahead of pace, before you overspend.',
    icon: 'notifications-outline',
  },
};

function toState(
  status: string,
  canAskAgain: boolean
): { state: PermissionState; canAsk: boolean } {
  if (status === 'granted') return { state: 'granted', canAsk: false };
  if (status === 'undetermined') return { state: 'undetermined', canAsk: true };
  // Denied but re-askable is very different from denied for good.
  return canAskAgain ? { state: 'denied', canAsk: true } : { state: 'blocked', canAsk: false };
}

// -------------------------------------------------------------------- checks

export async function checkPermission(key: PermissionKey): Promise<PermissionInfo> {
  const copy = PERMISSION_COPY[key];
  const base = { key, ...copy };

  // Browsers have no equivalent for these, and pretending otherwise puts a
  // permanently-broken row in Settings on the web build.
  if (Platform.OS === 'web') {
    return { ...base, state: 'unsupported', canAsk: false };
  }

  try {
    if (key === 'camera') {
      const p = await ImagePicker.getCameraPermissionsAsync();
      return { ...base, ...toState(p.status, p.canAskAgain) };
    }
    if (key === 'photos') {
      const p = await ImagePicker.getMediaLibraryPermissionsAsync();
      return { ...base, ...toState(p.status, p.canAskAgain) };
    }
    const p = await Notifications.getPermissionsAsync();
    return { ...base, ...toState(p.status, p.canAskAgain ?? true) };
  } catch {
    return { ...base, state: 'unsupported', canAsk: false };
  }
}

export async function checkAllPermissions(): Promise<PermissionInfo[]> {
  return Promise.all(
    (Object.keys(PERMISSION_COPY) as PermissionKey[]).map(checkPermission)
  );
}

// ------------------------------------------------------------------ requests

/**
 * Ask the OS. Returns the state afterwards.
 *
 * Never throws: a permission the user refuses is a normal outcome, not an
 * error, and the caller degrades instead of showing a crash.
 */
export async function requestPermission(key: PermissionKey): Promise<PermissionInfo> {
  const copy = PERMISSION_COPY[key];
  const base = { key, ...copy };

  if (Platform.OS === 'web') return { ...base, state: 'unsupported', canAsk: false };

  try {
    if (key === 'camera') {
      const p = await ImagePicker.requestCameraPermissionsAsync();
      return { ...base, ...toState(p.status, p.canAskAgain) };
    }
    if (key === 'photos') {
      const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
      return { ...base, ...toState(p.status, p.canAskAgain) };
    }
    const p = await Notifications.requestPermissionsAsync();
    return { ...base, ...toState(p.status, p.canAskAgain ?? true) };
  } catch {
    return { ...base, state: 'unsupported', canAsk: false };
  }
}

/**
 * Ask, and if the OS will not prompt any more, offer the settings page.
 *
 * This is the function screens should call. It turns a dead end into a route
 * the user can actually take.
 */
export async function ensurePermission(key: PermissionKey): Promise<boolean> {
  const current = await checkPermission(key);
  if (current.state === 'granted') return true;
  if (current.state === 'unsupported') return false;

  if (current.canAsk) {
    const after = await requestPermission(key);
    if (after.state === 'granted') return true;
    if (after.canAsk) return false; // they said no but can be asked again later
  }

  offerSettings(PERMISSION_COPY[key].label, PERMISSION_COPY[key].why);
  return false;
}

/** Prompt explaining that only the OS settings page can undo a block. */
export function offerSettings(what: string, why: string) {
  const message = `${why}\n\n${what} is turned off for Finlo and Android will not ask again. You can switch it on in system settings.`;

  if (Platform.OS === 'web') {
    globalThis.alert?.(message);
    return;
  }

  Alert.alert(`${what} is blocked`, message, [
    { text: 'Not now', style: 'cancel' },
    { text: 'Open settings', onPress: () => void openAppSettings() },
  ]);
}

/**
 * Open this app's own settings page.
 *
 * `Linking.openSettings()` handles both platforms; on Android it lands on the
 * app info screen where notifications and permissions both live.
 */
export async function openAppSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch {
    // Nothing sensible to fall back to — the user can reach it manually.
  }
}

/** Human label for a permission row. */
export function describePermission(info: PermissionInfo): string {
  switch (info.state) {
    case 'granted':
      return 'Allowed';
    case 'blocked':
      return 'Blocked';
    case 'denied':
      return 'Not allowed';
    case 'undetermined':
      return 'Not asked yet';
    default:
      return 'Not available';
  }
}
