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
  /** Stable grouping key. Direction is baked in — see above. */
  key: string;
}

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

  // An unmasked account number is the strongest identity available: two people
  // can share a name, and one person's name can be written three ways.
  const identity = account || normaliseMerchant(name);
  if (!identity) return null;

  return {
    direction,
    name,
    bank,
    account,
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
export function groupKey(raw: string, isInflow: boolean, merchantKeyOf: (s: string) => string): string {
  const counterparty = readCounterparty(raw);
  if (counterparty) return counterparty.key;
  return `${isInflow ? 'in' : 'out'}:${merchantKeyOf(raw)}`;
}

/** How to describe the group in a sentence: "12 transfers to Rashidat Bashiru". */
export function describeGroup(raw: string, isInflow: boolean): string {
  const counterparty = readCounterparty(raw);
  if (counterparty) {
    return `${counterparty.direction === 'out' ? 'to' : 'from'} ${titleCase(counterparty.name)}`;
  }
  return isInflow ? 'like this' : 'like this';
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
