/**
 * Email ingestion.
 *
 * Two kinds of message matter, and they need different treatment:
 *
 *   1. **Bank/wallet alerts** — "Debit Alert: NGN5,000.00 ... Acct: ****1234".
 *      Machine-generated, rigidly formatted, and authoritative about the amount.
 *      A template per sender reads these near-perfectly.
 *   2. **Merchant receipts** — an order confirmation from a shop. Free-form
 *      HTML, but they carry line items and a real merchant name.
 *
 * The templates below are matched on the sender domain first, which is the only
 * part of an email that is expensive to forge and cheap to check. Body-only
 * matching is the fallback, and anything matched that way is marked lower
 * confidence so it lands in the review queue rather than being filed silently.
 *
 * SECURITY NOTE: email content is untrusted input from third parties. Nothing
 * in here executes, evaluates, or follows instructions found in a message — an
 * email is only ever scanned for the specific patterns declared in a template.
 */

import { parseMoney, type CurrencyCode, type Money } from '../../core/money';
import { isValidISODate } from '../../core/dates';
import { extractDate } from '../receipt/parse';

export interface EmailMessage {
  /** Provider message id — the dedupe handle for "have we seen this already?". */
  id: string;
  from: string;
  subject: string;
  /** Plain-text body. HTML is stripped before it gets here. */
  body: string;
  /** RFC date of the message, used only when the body has no date of its own. */
  receivedAt: string;
}

export interface ParsedEmailTransaction {
  amount: Money;
  /** true when money came in. */
  isInflow: boolean;
  merchant: string;
  date: string;
  /** Masked account identifier, for routing to the right account. */
  accountMask?: string;
  balanceAfter?: Money;
  reference?: string;
  templateId: string;
  confidence: 'high' | 'medium' | 'low';
  /** The raw descriptor, kept for the categoriser to learn from. */
  rawDescription: string;
}

export interface EmailTemplate {
  id: string;
  /** Sender domains this template trusts. Matched against the address host. */
  senderDomains: string[];
  /** Must all be present for the template to apply. */
  requiredMarkers: RegExp[];
  /** First capture group is the amount. */
  amountPattern: RegExp;
  /** Presence of any of these means money went OUT. */
  debitMarkers: RegExp[];
  creditMarkers: RegExp[];
  merchantPattern?: RegExp;
  maskPattern?: RegExp;
  balancePattern?: RegExp;
  referencePattern?: RegExp;
  currency?: CurrencyCode;
}

/**
 * Shipped templates.
 *
 * Adding a bank is adding an entry here — no code changes. The generic template
 * at the end is the safety net for a sender we don't know; it is deliberately
 * conservative and always yields low confidence.
 */
export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: 'ng_bank_alert',
    senderDomains: [
      'gtbank.com', 'accessbankplc.com', 'firstbanknigeria.com', 'zenithbank.com',
      'ubagroup.com', 'stanbicibtc.com', 'fcmb.com', 'kudabank.com',
      'opayweb.com', 'moniepoint.com', 'palmpay.com', 'sterling.ng', 'wemabank.com',
    ],
    requiredMarkers: [/\b(debit|credit)\s*(alert|notification|transaction)\b/i],
    amountPattern: /(?:NGN|₦)\s*([\d,]+(?:\.\d{2})?)/i,
    debitMarkers: [/\bdebit\b/i, /\bwithdrawal\b/i, /\bpayment to\b/i],
    creditMarkers: [/\bcredit\b/i, /\bdeposit\b/i, /\breceived from\b/i],
    merchantPattern: /(?:description|narration|remarks?|details)\s*[:\-]\s*(.+)/i,
    maskPattern: /(?:acct|account)\s*(?:no)?\s*[:.]?\s*\*{0,6}(\d{3,4})/i,
    balancePattern: /(?:available|clear(?:ed)?)\s*bal(?:ance)?\s*[:.]?\s*(?:NGN|₦)?\s*([\d,]+(?:\.\d{2})?)/i,
    referencePattern: /(?:ref(?:erence)?|txn\s*id)\s*[:.]?\s*([A-Z0-9\-]{6,})/i,
    currency: 'NGN',
  },
  {
    id: 'card_statement_alert',
    senderDomains: ['chase.com', 'bankofamerica.com', 'wellsfargo.com', 'citi.com',
      'amex.com', 'capitalone.com', 'monzo.com', 'revolut.com', 'starlingbank.com'],
    requiredMarkers: [/\b(transaction|purchase|charged|payment)\b/i],
    amountPattern: /(?:\$|USD|£|GBP|€|EUR)\s*([\d,]+\.\d{2})/i,
    debitMarkers: [/\b(purchase|charged|debit|payment to|spent)\b/i],
    creditMarkers: [/\b(refund|credit|deposit|received)\b/i],
    merchantPattern: /(?:at|merchant|to)\s+([A-Z0-9][A-Za-z0-9 .&'\-]{2,40})/,
    maskPattern: /(?:ending in|card)\s*\*{0,4}(\d{4})/i,
  },
  {
    id: 'merchant_receipt',
    senderDomains: [
      'uber.com', 'bolt.eu', 'amazon.com', 'jumia.com.ng', 'konga.com',
      'netflix.com', 'spotify.com', 'apple.com', 'google.com', 'paypal.com',
      'booking.com', 'airbnb.com', 'aliexpress.com',
    ],
    // Broad on purpose: the sender domain is already verified for this template,
    // so the body only has to look like a receipt rather than prove it. An Uber
    // mail says "Thanks for riding", never the word "receipt".
    requiredMarkers: [/\b(receipt|order|invoice|trip|ride|subscription|total|charged|payment)\b/i],
    amountPattern: /(?:total|amount|charged)\s*[:\-]?\s*(?:[₦$€£]|NGN|USD|EUR|GBP)?\s*([\d,]+(?:\.\d{2})?)/i,
    debitMarkers: [/\b(charged|paid|total|order)\b/i],
    creditMarkers: [/\b(refund(?:ed)?|credited)\b/i],
  },
  {
    id: 'generic',
    senderDomains: [], // matches nothing on domain; body-only fallback
    requiredMarkers: [/\b(receipt|invoice|payment|transaction|debit|credit|order)\b/i],
    amountPattern: /(?:[₦$€£]|NGN|USD|EUR|GBP|GHS)\s*([\d,]+(?:\.\d{2})?)/i,
    debitMarkers: [/\b(debit|paid|charged|purchase|payment)\b/i],
    creditMarkers: [/\b(credit|refund|received|deposit)\b/i],
  },
];

// ---------------------------------------------------------------------- parse

function senderDomain(from: string): string {
  const m = /@([^\s>]+)/.exec(from);
  return (m?.[1] ?? '').toLowerCase().replace(/^mail\.|^notifications?\./, '');
}

function domainMatches(domain: string, allowed: string[]): boolean {
  // Suffix match so alerts@e.gtbank.com still matches gtbank.com, but
  // gtbank.com.evil.example does not.
  return allowed.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export function parseEmail(
  msg: EmailMessage,
  opts: { defaultCurrency: CurrencyCode; today?: string }
): ParsedEmailTransaction | null {
  const domain = senderDomain(msg.from);
  const haystack = `${msg.subject}\n${msg.body}`;

  for (const template of EMAIL_TEMPLATES) {
    const domainMatch = domainMatches(domain, template.senderDomains);
    // A template with declared domains only applies to those domains — this is
    // what stops a phishing email in the shape of a bank alert being ingested
    // as a real transaction.
    if (template.senderDomains.length > 0 && !domainMatch) continue;
    if (!template.requiredMarkers.every((r) => r.test(haystack))) continue;

    const amountMatch = template.amountPattern.exec(haystack);
    if (!amountMatch) continue;

    const currency = template.currency ?? detectCurrencyFrom(haystack, opts.defaultCurrency);
    const amount = parseMoney(amountMatch[1], currency);
    if (!amount || amount.minor === 0) continue;

    const isDebit = template.debitMarkers.some((r) => r.test(haystack));
    const isCredit = template.creditMarkers.some((r) => r.test(haystack));
    // Both or neither is genuinely ambiguous — a "credit card purchase" hits
    // both lists. Default to an outflow, which is the common case, but drop the
    // confidence so a human confirms the direction.
    const ambiguousDirection = isDebit === isCredit;
    const isInflow = !ambiguousDirection && isCredit;

    const merchant =
      template.merchantPattern?.exec(haystack)?.[1]?.trim() ??
      merchantFromDomain(domain) ??
      msg.subject.slice(0, 60);

    const date =
      extractDate(msg.body, opts.today) ??
      extractDate(msg.subject, opts.today) ??
      msg.receivedAt.slice(0, 10);

    return {
      amount,
      isInflow,
      merchant: cleanMerchant(merchant),
      date: isValidISODate(date) ? date : msg.receivedAt.slice(0, 10),
      accountMask: template.maskPattern?.exec(haystack)?.[1],
      balanceAfter: parseOptional(template.balancePattern, haystack, currency),
      reference: template.referencePattern?.exec(haystack)?.[1],
      templateId: template.id,
      confidence:
        template.id === 'generic' || ambiguousDirection
          ? 'low'
          : domainMatch
            ? 'high'
            : 'medium',
      rawDescription: `${msg.subject} ${merchant}`.trim(),
    };
  }
  return null;
}

function parseOptional(
  pattern: RegExp | undefined,
  text: string,
  currency: CurrencyCode
): Money | undefined {
  if (!pattern) return undefined;
  const m = pattern.exec(text);
  if (!m) return undefined;
  return parseMoney(m[1], currency) ?? undefined;
}

function detectCurrencyFrom(text: string, fallback: CurrencyCode): CurrencyCode {
  if (/₦|\bNGN\b/i.test(text)) return 'NGN';
  if (/\$|\bUSD\b/i.test(text)) return 'USD';
  if (/£|\bGBP\b/i.test(text)) return 'GBP';
  if (/€|\bEUR\b/i.test(text)) return 'EUR';
  if (/₵|\bGHS\b/i.test(text)) return 'GHS';
  return fallback;
}

function merchantFromDomain(domain: string): string | null {
  if (!domain) return null;
  const core = domain.split('.')[0];
  if (!core || core.length < 2) return null;
  return core[0].toUpperCase() + core.slice(1);
}

function cleanMerchant(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/^(re|fwd?):\s*/i, '')
    .replace(/[<>|]/g, '')
    .trim()
    .slice(0, 80);
}

/**
 * Strip HTML to plain text before parsing.
 *
 * Script and style contents are removed entirely rather than tag-stripped —
 * their text is code, and leaving it in would feed a pile of JavaScript numbers
 * to the amount matcher.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|table|h[1-6]|li)>/gi, '\n')
    .replace(/<td[^>]*>/gi, '\t')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/[ \t]+/g, ' ')
    // A closing block tag becomes a newline while the next opening tag became a
    // space, so without this every line arrives with a leading space.
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * The Gmail query used to fetch candidates.
 *
 * Narrow on purpose. Pulling the whole mailbox would be slow, would burn quota,
 * and would mean reading mail that has nothing to do with money — the app asks
 * for gmail.readonly and should still look at as little as it can.
 */
export function buildGmailQuery(sinceISO: string): string {
  const senders = EMAIL_TEMPLATES.flatMap((t) => t.senderDomains)
    .map((d) => `from:${d}`)
    .join(' OR ');
  const keywords =
    'subject:(receipt OR invoice OR "debit alert" OR "credit alert" OR ' +
    '"transaction alert" OR "order confirmation" OR payment)';
  return `after:${sinceISO.replace(/-/g, '/')} ((${senders}) OR ${keywords})`;
}

/** Gmail scope. Read-only, and the narrowest one that can read message bodies. */
export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
