/**
 * Budget alerts.
 *
 * These are **local** notifications, scheduled on the device. No push server,
 * no Expo push token, no account — which matters because the alternative would
 * mean shipping every user's budget state to a backend just to tell them they
 * are overspending on groceries.
 *
 * The app schedules one daily check. When it fires, the notification text has
 * already been computed from the envelopes at scheduling time, so the message
 * is specific ("Food is 92% spent with 9 days left") rather than a generic
 * "open the app".
 *
 * Everything here no-ops on web and degrades quietly if permission is refused —
 * a budgeting app that nags for permission on first launch gets deleted.
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { budgetsNeedingAlert } from '../core/budget';
import { alertTitle, composeAlert } from '../core/alerts';
import type { BudgetStatus, ISODate } from '../core/types';

export { composeAlert, alertTitle };

export const NOTIFICATIONS_SUPPORTED = Platform.OS !== 'web';

/** Identifies our scheduled work so a reschedule replaces rather than stacks. */
const DAILY_ALERT_ID = 'finlo.budget.daily';

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unsupported';

let handlerInstalled = false;

/** Foreground presentation. Called once, lazily, so importing this module has
 *  no side effects in tests or on web. */
function ensureHandler(): void {
  if (handlerInstalled || !NOTIFICATIONS_SUPPORTED) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  handlerInstalled = true;
}

export async function permissionState(): Promise<PermissionState> {
  if (!NOTIFICATIONS_SUPPORTED) return 'unsupported';
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status as PermissionState;
  } catch {
    return 'unsupported';
  }
}

/**
 * Ask for permission.
 *
 * Only ever called from an explicit toggle in Settings, never on launch — the
 * request is far more likely to be granted when the user just asked for the
 * feature.
 */
export async function requestPermission(): Promise<PermissionState> {
  if (!NOTIFICATIONS_SUPPORTED) return 'unsupported';
  ensureHandler();
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.status === 'granted') return 'granted';
    const { status } = await Notifications.requestPermissionsAsync();
    return status as PermissionState;
  } catch {
    return 'denied';
  }
}

export async function cancelBudgetAlerts(): Promise<void> {
  if (!NOTIFICATIONS_SUPPORTED) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(DAILY_ALERT_ID);
  } catch {
    // Nothing scheduled under that id. Cancelling something that isn't there
    // is the desired end state anyway.
  }
}

export interface ScheduleResult {
  scheduled: boolean;
  reason: string;
  /** What the notification will say, so Settings can preview it. */
  preview?: string;
}

/**
 * Schedule (or clear) the daily budget check.
 *
 * Called after any change that could move an envelope, so the message stays
 * true. If nothing needs attention, the existing alert is cancelled rather than
 * replaced with "everything is fine" — a notification that says nothing is
 * worse than no notification.
 */
export async function scheduleBudgetAlerts(
  statuses: BudgetStatus[],
  asOf: ISODate,
  opts: { hour?: number; minute?: number } = {}
): Promise<ScheduleResult> {
  if (!NOTIFICATIONS_SUPPORTED) {
    return { scheduled: false, reason: 'Notifications are not available on web' };
  }

  const permission = await permissionState();
  if (permission !== 'granted') {
    return { scheduled: false, reason: 'Notification permission not granted' };
  }

  ensureHandler();
  await cancelBudgetAlerts();

  const needing = budgetsNeedingAlert(statuses);
  if (needing.length === 0) {
    return { scheduled: false, reason: 'Nothing needs attention right now' };
  }

  const body = composeAlert(needing, asOf);

  try {
    await Notifications.scheduleNotificationAsync({
      identifier: DAILY_ALERT_ID,
      content: {
        title: alertTitle(needing),
        body,
        data: { route: '/budgets' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        // Early evening: late enough to include the day's spending, early
        // enough to still change what someone does tonight.
        hour: opts.hour ?? 19,
        minute: opts.minute ?? 0,
      },
    });
    return { scheduled: true, reason: 'Daily check scheduled', preview: body };
  } catch (e) {
    return {
      scheduled: false,
      reason: e instanceof Error ? e.message : 'Could not schedule the alert',
    };
  }
}

/** For Settings: what is currently queued. */
export async function scheduledCount(): Promise<number> {
  if (!NOTIFICATIONS_SUPPORTED) return 0;
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    return all.length;
  } catch {
    return 0;
  }
}
