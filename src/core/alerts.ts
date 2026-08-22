/**
 * Alert copy.
 *
 * Kept in `core` rather than beside the notification scheduler because the
 * scheduler imports React Native, and anything that imports React Native
 * cannot be tested in plain Node. The wording is the part worth testing; the
 * scheduling is a thin call to the OS.
 */

import { formatMoney } from './money';
import { daysRemaining } from './dates';
import type { BudgetStatus, ISODate } from './types';

/**
 * One sentence, naming the worst envelope.
 *
 * Listing every envelope produces a notification nobody reads. The most urgent
 * one plus a count is enough to decide whether to open the app.
 */
export function composeAlert(needing: BudgetStatus[], asOf: ISODate): string {
  const worst = needing[0];
  const left = daysRemaining(worst.range, asOf);
  const dayWord = left === 1 ? 'day' : 'days';

  const head =
    worst.state === 'over'
      ? `${worst.budget.name} is ${formatMoney(
          { minor: Math.abs(worst.remaining.minor), currency: worst.remaining.currency },
          { compactDecimals: true }
        )} over with ${left} ${dayWord} left.`
      : `${worst.budget.name} is ${Math.round(
          (worst.utilisation ?? 0) * 100
        )}% spent with ${left} ${dayWord} left.`;

  const others = needing.length - 1;
  if (others <= 0) return head;
  return `${head} ${others} other envelope${others === 1 ? '' : 's'} need${
    others === 1 ? 's' : ''
  } a look.`;
}

/** Title that matches the body's severity. */
export function alertTitle(needing: BudgetStatus[]): string {
  return needing.some((s) => s.state === 'over') ? 'Over budget' : 'Running ahead of pace';
}
