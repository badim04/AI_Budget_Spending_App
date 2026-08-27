/**
 * Money you moved between your own pockets.
 *
 * OPay's autosave sweeps every incoming naira into OWealth, and sweeps it back
 * into the wallet the moment you spend. Both legs appear in the statement, so a
 * single ₦5,000 payment can show up three times: in to OWealth, out of OWealth,
 * out to the merchant. Counted naively that is ₦15,000 of activity for ₦5,000
 * of spending, and every leg lands in the review queue asking to be filed.
 *
 * PalmPay's Cashbox and Kuda's Spend-and-Save do the same thing. Plenty of
 * people never turn any of it on, so this cannot be assumed — it is detected
 * from the descriptor, applied only when it matches, reported in the import
 * summary, and switched off in Settings for anyone who wants the raw ledger.
 *
 * Two distinct things share the pot's name and must not be conflated:
 *
 *   "Auto Save to OWealth"     — a move. Not spending, not income.
 *   "OWealth Interest Earned"  — real income, however small. It is money that
 *                                did not exist before.
 *
 * Matching runs on the **raw** descriptor, not the normalised merchant:
 * `normaliseMerchant` strips "transfer", "credit" and "debit" as payment-rail
 * noise, which is exactly the vocabulary this needs.
 *
 * Pure string work: no React, no I/O.
 */

import type { Category } from './types';

export type InternalKind = 'move' | 'interest';

export interface InternalMatch {
  kind: InternalKind;
  /** The pot as the bank named it, for explaining the decision. */
  pot: string;
}

/**
 * Savings pots that live *inside* a spending account.
 *
 * Deliberately not PiggyVest, Cowrywise or Risevest: those are separate
 * institutions, so money going there has genuinely left this account and
 * belongs under Savings & investment, where it stays visible. The distinction
 * is whether the money is still in the same wallet under a different label.
 */
const POTS = [
  'owealth', // OPay
  'cashbox', // PalmPay
  'spend and save', // Kuda
  'spend & save',
  'safebox',
  'savings pocket',
];

/** Words that make a pot line income rather than a move. */
const INTEREST = /\b(interest|earned|earnings|dividend|yield|bonus|return)\b/i;

export function detectInternal(rawDescription: string): InternalMatch | null {
  const text = (rawDescription ?? '').toLowerCase();
  if (!text) return null;

  const pot = POTS.find((p) => text.includes(p));
  if (!pot) return null;

  return {
    kind: INTEREST.test(text) ? 'interest' : 'move',
    pot: prettyPot(pot),
  };
}

/**
 * Where a detected line should be filed.
 *
 * Resolved by category *kind* rather than by a seeded id, so it still works
 * for someone who renamed the category — and returns undefined rather than
 * guessing, which sends the row to review where a person can decide.
 */
export function resolveInternalCategory(
  match: InternalMatch,
  categories: readonly Category[]
): string | undefined {
  const live = categories.filter((c) => !c.archived);

  if (match.kind === 'move') {
    // The seeded Transfer category is excluded from totals, which is the whole
    // point: a move must not read as spending or as income.
    return live.find((c) => c.kind === 'transfer')?.id;
  }

  const income = live.filter((c) => c.kind === 'income');
  return (
    income.find((c) => /interest|savings|investment/i.test(c.name))?.id ??
    income.find((c) => /other/i.test(c.name))?.id ??
    income[0]?.id
  );
}

/** Why the row was filed this way, for the review list and the import summary. */
export function explainInternal(match: InternalMatch): string {
  return match.kind === 'move'
    ? `Moved between your own ${match.pot} and wallet — not spending`
    : `Interest earned in ${match.pot}`;
}

function prettyPot(pot: string): string {
  if (pot === 'owealth') return 'OWealth';
  if (pot === 'cashbox') return 'Cashbox';
  return pot.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}
