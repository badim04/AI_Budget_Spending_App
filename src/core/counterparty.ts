/**
 * Who the money went to, or came from.
 *
 * A personal statement in Nigeria is mostly peer transfers, and they arrive as
 * pipe-delimited descriptors:
 *
 *   Transfer to RASHIDAT BASHIRU | OPay | 7046464337 | chi
 *   Transfer from ADEBAYO ABDULAKEEM OLADIMEJI | United Bank For Africa | 211****578 | MOB/UTO/...
 *
 * Categorising those one at a time is the chore that makes an import painful:
 * the same person appears a dozen times with a different note on the end each
 * time ("chi", "milk", "ice cream"), so plain merchant matching sees a dozen
 * different merchants.
 *
 * This pulls out the stable part — the person, and their account number when
 * the bank did not mask it — so all of them can be filed in one action.
 *
 * **Direction is part of the identity.** Money sent to someone and money
 * received from the same someone are different things: one is usually a gift,
 * a payment or a repayment, and the other is income. They must never be filed
 * together by accident, so the key carries the direction.
 *
 * Pure string work: no React, no I/O.
 */

import { normaliseMerchant } from './categorize';
import { noteKey, transferNote } from './notes';

// Re-exported: callers reaching for a counterparty usually want its note too.
export { noteKey, transferNote };

export type TransferDirection = 'in' | 'out';

export interface Counterparty {
  direction: TransferDirection;
  /** Display name, as the bank wrote it. */
  name: string;
  /** The other bank, when the descriptor names one. */
  bank?: string;
  /** Digits only, and only when the bank did not mask them. */
  account?: string;
  /**
   * The free text the sender typed: "chi", "milk", "ice cream".
   *
   * It describes what the money was for **to the recipient**, not to the
   * sender. Money sent to a friend so she can buy milk is not the sender's
   * groceries — it is a gift, or support, or a loan. So the note is carried
   * for display and never used to categorise or to group by default.
   */
  note?: string;
  /** Stable grouping key. Direction is baked in — see above. */
  key: string;
}

/**
 * How to bundle the review queue.
 *
 * `account` is the default and the most reliable: two people can share a name
 * and one person's name can be written three ways, but an account number is an
 * account number. `person` falls back to the name for banks that mask it.
 * `note` exists because it is occasionally what someone wants — the choice
 * belongs to the person doing the filing, not to this file.
 */
export type GroupMode = 'account' | 'person' | 'note';

/** "Transfer to", "To", "Sent to" … and their inbound equivalents. */
const OUTBOUND = /^(?:transfer|payment|sent|paid|debit)?\s*to\b[:\s]*/i;
const INBOUND = /^(?:transfer|payment|received|credit)?\s*from\b[:\s]*/i;

/** A masked account number is useless for grouping: 211****578. */
const MASKED = /\*/;

export function readCounterparty(raw: string): Counterparty | null {
  const text = (raw ?? '').trim();
  if (!text) return null;

  const parts = text.split('|').map((p) => p.trim()).filter(Boolean);
  const head = parts[0] ?? '';

  const direction: TransferDirection | null = OUTBOUND.test(head)
    ? 'out'
    : INBOUND.test(head)
      ? 'in'
      : null;
  if (!direction) return null;

  const name = head.replace(direction === 'out' ? OUTBOUND : INBOUND, '').trim();
  if (!name) return null;

  // Everything after the name: bank, account number, and the free-text note the
  // sender typed. The note is the part that differs every time, so it is
  // deliberately not part of the key.
  const rest = parts.slice(1);
  const account = rest.find((p) => /^\d[\d\s-]{5,}$/.test(p) && !MASKED.test(p))?.replace(/\D/g, '');
  const bank = rest.find((p) => /[a-z]/i.test(p) && !/^\d/.test(p));

  // `transferNote` already knows how to tell prose from bank machinery — a
  // reference, a channel, a hyphenated API id. No second opinion needed here.
  const note = transferNote(text) ?? undefined;

  // An unmasked account number is the strongest identity available: two people
  // can share a name, and one person's name can be written three ways.
  const identity = account || normaliseMerchant(name);
  if (!identity) return null;

  return {
    direction,
    name,
    bank,
    account,
    note,
    key: `${direction}:${identity}`,
  };
}

/**
 * Grouping key for any descriptor.
 *
 * Falls back to the merchant key for things that are not person-to-person —
 * "OPay Card Payment | SportyBet" should still group with itself. `isInflow`
 * splits those by direction too, so a refund never lands in the same bucket as
 * the purchase.
 */
export function groupKey(
  raw: string,
  isInflow: boolean,
  merchantKeyOf: (s: string) => string,
  mode: GroupMode = 'account'
): string {
  const counterparty = readCounterparty(raw);
  const side = isInflow ? 'in' : 'out';

  if (!counterparty) return `${side}:${merchantKeyOf(raw)}`;

  if (mode === 'note') {
    // Deliberately still split by direction: "chi" sent and "chi" received are
    // not one bucket.
    return `${side}:note:${counterparty.note ? noteKey(counterparty.note) : '(none)'}`;
  }

  if (mode === 'person') {
    return `${side}:${normaliseMerchant(counterparty.name)}`;
  }

  // 'account' — the default, and `key` already prefers the account number.
  return counterparty.key;
}

/** How to describe the group in a sentence: "12 transfers to Rashidat Bashiru". */
export function describeGroup(raw: string, isInflow: boolean, mode: GroupMode = 'account'): string {
  const counterparty = readCounterparty(raw);
  if (!counterparty) return 'like this';

  if (mode === 'note') {
    return counterparty.note ? `noted "${counterparty.note}"` : 'with no note';
  }

  return `${counterparty.direction === 'out' ? 'to' : 'from'} ${titleCase(counterparty.name)}`;
}

/** Title for a group card: the person, and the account when there is one. */
export function groupTitle(raw: string, mode: GroupMode = 'account'): string {
  const counterparty = readCounterparty(raw);
  if (!counterparty) return raw.split('|')[0].trim();

  if (mode === 'note') return counterparty.note ? titleCase(counterparty.note) : 'No note';
  return titleCase(counterparty.name);
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
