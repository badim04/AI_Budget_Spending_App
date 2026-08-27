/**
 * The note a person typed on a transfer, and what it is worth.
 *
 * A leaf module on purpose. `categorize.ts` needs this to learn from notes,
 * and `counterparty.ts` needs `categorize.ts` for merchant normalisation — so
 * putting these two functions in either one creates an import cycle. Metro
 * resolves cycles by handing back a half-initialised module, and this codebase
 * has already lost a day to that failure mode (see the platform-variant note
 * in ARCHITECTURE.md). This module imports nothing.
 */

/**
 * The note the sender typed.
 *
 * OPay puts it last: `Transfer to RASHIDAT BASHIRU | OPay | 7046464337 | milk`.
 * That final segment is a human describing, in their own words, what the money
 * was for — and the app was discarding it. It is the single best
 * categorisation signal in a peer transfer, because the recipient's name says
 * who got the money and the note says why.
 *
 * Deliberately separate from `readCounterparty`, whose key must *exclude* the
 * note: twelve transfers to one person carry twelve different notes, and
 * grouping is about the person. Categorising is about the purpose.
 *
 * Returns null when the trailing segment is bank machinery rather than prose —
 * a reference number, an account number, a bank name, a channel.
 */
export function transferNote(rawDescription: string): string | null {
  const parts = (rawDescription ?? '')
    .split('|')
    .map((p) => p.trim())
    .filter(Boolean);

  // Nothing to take a note from: no pipes means no structured tail.
  if (parts.length < 2) return null;

  const tail = parts[parts.length - 1];
  if (!tail || tail === '--') return null;

  // Machinery, not prose.
  if (/^[\d\s*-]+$/.test(tail)) return null;                  // account / phone / masked
  if (/^[A-Za-z]{0,4}[\d]{6,}$/.test(tail)) return null;       // reference
  if (/^(mobile|web|ussd|pos|atm|card|api)$/i.test(tail)) return null;
  if (/bank|microfinance|mfb|opay|palmpay|kuda|moniepoint/i.test(tail) && tail.split(/\s+/).length <= 3) {
    return null;
  }
  // A long unbroken alphanumeric run is a transaction id, not a word.
  if (/^[A-Za-z0-9]{16,}$/.test(tail)) return null;
  // Hyphenated machine ids get through the checks above: OPay writes
  // "API-TRANSFER-45A9E-b07b86ff-0978-4200-a5b1-65738744a716" in the note
  // position. Any long token mixing letters and digits is an identifier.
  if (tail.split(/[\s-]+/).some((token) => token.length >= 12 && /\d/.test(token) && /[A-Za-z]/.test(token))) {
    return null;
  }

  const cleaned = tail.replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 && cleaned.length <= 60 ? cleaned : null;
}

/** Normalised note, for learning "every transfer I label `milk` is groceries". */
export function noteKey(note: string): string {
  return note.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
