/**
 * Receipt parsing.
 *
 * Input is raw OCR text; output is a structured receipt. This runs entirely on
 * device and offline, and deliberately does the boring deterministic work first
 * — merchant, date, total, line items — because that is what OCR is actually
 * good enough for. The LLM path (`needsLLM`) exists for the receipts this
 * misses, not as the default.
 *
 * Getting the TOTAL right matters far more than getting line items right. A
 * receipt whose total is wrong corrupts the user's budget; a receipt whose line
 * items are partial just means less detail. Everything here is biased
 * accordingly: total extraction has several independent strategies and a
 * consistency check, line items are best-effort.
 */

import { parseMoney, type CurrencyCode, type Money } from '../../core/money';
import { isValidISODate } from '../../core/dates';
import type { ReceiptLineItem } from '../../core/types';

export interface ParsedReceipt {
  merchant: string | null;
  date: string | null;
  total: Money | null;
  subtotal: Money | null;
  tax: Money | null;
  tip: Money | null;
  lineItems: ReceiptLineItem[];
  currency: CurrencyCode;
  /** 0..1 — how much of the important stuff we actually found. */
  confidence: number;
  /** Human-readable notes about what could not be read. */
  warnings: string[];
}

/** Labels that precede the figure we want, most specific first. */
const TOTAL_LABELS = [
  'grand total', 'total due', 'amount due', 'total amount', 'balance due',
  'total payable', 'net payable', 'you pay', 'total',
];
const SUBTOTAL_LABELS = ['sub total', 'subtotal', 'sub-total', 'net amount', 'goods value'];
const TAX_LABELS = ['vat', 'v.a.t', 'tax', 'gst', 'sales tax', 'consumption tax'];
const TIP_LABELS = ['tip', 'gratuity', 'service charge', 'service'];

/** Lines that are never a merchant name. */
const HEADER_NOISE =
  /^(receipt|invoice|tax invoice|cash receipt|customer copy|merchant copy|thank you|welcome|tel|phone|address|rc no|vat reg|www\.|http)/i;

const CURRENCY_HINTS: Array<[RegExp, CurrencyCode]> = [
  [/₦|\bngn\b|\bnaira\b/i, 'NGN'],
  [/\$|\busd\b|\bdollars?\b/i, 'USD'],
  [/€|\beur\b/i, 'EUR'],
  [/£|\bgbp\b/i, 'GBP'],
  [/₵|\bghs\b|\bcedis?\b/i, 'GHS'],
  [/\bkes\b|\bksh\b/i, 'KES'],
  [/\bzar\b/i, 'ZAR'],
  [/₹|\binr\b/i, 'INR'],
  [/¥|\bjpy\b/i, 'JPY'],
];

export function detectCurrency(text: string, fallback: CurrencyCode): CurrencyCode {
  for (const [pattern, code] of CURRENCY_HINTS) {
    if (pattern.test(text)) return code;
  }
  return fallback;
}

// ------------------------------------------------------------------ the parse

export function parseReceipt(
  ocrText: string,
  opts: { defaultCurrency: CurrencyCode; today?: string } = { defaultCurrency: 'NGN' }
): ParsedReceipt {
  const warnings: string[] = [];
  const rawLines = ocrText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const currency = detectCurrency(ocrText, opts.defaultCurrency);

  const merchant = extractMerchant(rawLines);
  if (!merchant) warnings.push('Could not identify the merchant');

  const date = extractDate(ocrText, opts.today);
  if (!date) warnings.push('Could not find a date on the receipt');

  const tax = findLabelledAmount(rawLines, TAX_LABELS, currency);
  const tip = findLabelledAmount(rawLines, TIP_LABELS, currency);
  const subtotal = findLabelledAmount(rawLines, SUBTOTAL_LABELS, currency);
  const total0 = findLabelledAmount(rawLines, TOTAL_LABELS, currency, SUBTOTAL_LABELS);
  let total = total0;

  const lineItems = extractLineItems(rawLines, currency);

  // Fallback 1: the largest amount on the receipt is almost always the total.
  if (!total) {
    const amounts = allAmounts(ocrText, currency);
    if (amounts.length > 0) {
      total = amounts.reduce((a, b) => (b.minor > a.minor ? b : a));
      warnings.push('No total label found — used the largest amount on the receipt');
    }
  }

  // Fallback 2: reconstruct from the parts.
  if (!total && subtotal) {
    total = {
      minor: subtotal.minor + (tax?.minor ?? 0) + (tip?.minor ?? 0),
      currency,
    };
    warnings.push('Total reconstructed from subtotal, tax and tip');
  }

  // Consistency check. If subtotal + tax + tip disagrees with the stated total
  // by more than a rounding-scale amount, the OCR misread a digit somewhere and
  // the user needs to look at it — silently trusting either number is worse.
  if (total && subtotal) {
    const expected = subtotal.minor + (tax?.minor ?? 0) + (tip?.minor ?? 0);
    const drift = Math.abs(expected - total.minor);
    if (drift > Math.max(100, total.minor * 0.02)) {
      warnings.push(
        `Subtotal + tax does not match the total (off by ${(drift / 100).toFixed(2)}) — please check`
      );
    }
  }

  if (!total) warnings.push('Could not read a total — this receipt needs manual entry');

  return {
    merchant,
    date,
    total,
    subtotal,
    tax,
    tip,
    lineItems,
    currency,
    confidence: scoreConfidence({ merchant, date, total, lineItems, warnings }),
    warnings,
  };
}

// ---------------------------------------------------------------- extraction

/**
 * The merchant is nearly always in the first few lines, in the largest type,
 * before any address or phone number. OCR loses the type size, so we use
 * position plus a noise filter plus "looks like a name" heuristics.
 */
function extractMerchant(lines: string[]): string | null {
  for (const line of lines.slice(0, 6)) {
    if (HEADER_NOISE.test(line)) continue;
    if (/\d{4,}/.test(line)) continue; // phone numbers, RC numbers
    if (looksLikeAmount(line)) continue;
    const letters = line.replace(/[^a-z]/gi, '').length;
    if (letters < 3) continue;
    // Mostly-digits lines are receipt numbers, not names.
    if (letters / line.length < 0.5) continue;
    return titleCase(line.replace(/[^\w\s&'.-]/g, '').trim());
  }
  return null;
}

/**
 * Dates on receipts appear in every order humans have invented. Ambiguous
 * dd/mm vs mm/dd is resolved by preferring a reading that is not in the
 * future — a receipt is a record of something that already happened.
 */
export function extractDate(text: string, today?: string): string | null {
  const now = today ?? new Date().toISOString().slice(0, 10);

  // ISO first — unambiguous, so it wins outright.
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso && isValidISODate(iso[0])) return iso[0];

  // "13 Aug 2026" / "Aug 13, 2026"
  const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
  const dmy = new RegExp(`\\b(\\d{1,2})\\s*(?:st|nd|rd|th)?[\\s.-]*(${MONTHS})[a-z]*[\\s.,-]*(\\d{2,4})\\b`, 'i').exec(text);
  if (dmy) {
    const d = buildDate(+dmy[3], monthIndex(dmy[2]) + 1, +dmy[1]);
    if (d && d <= now) return d;
  }
  const mdy = new RegExp(`\\b(${MONTHS})[a-z]*\\.?\\s+(\\d{1,2})\\s*(?:st|nd|rd|th)?[\\s,]*(\\d{2,4})\\b`, 'i').exec(text);
  if (mdy) {
    const d = buildDate(+mdy[3], monthIndex(mdy[1]) + 1, +mdy[2]);
    if (d && d <= now) return d;
  }

  // Numeric: 13/08/2026, 08-13-26, 13.08.2026
  const numeric = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/.exec(text);
  if (numeric) {
    const a = +numeric[1];
    const b = +numeric[2];
    const year = +numeric[3];
    // A value above 12 can only be the day, which settles the order outright.
    const candidates = a > 12
      ? [buildDate(year, b, a)]
      : b > 12
        ? [buildDate(year, a, b)]
        : [buildDate(year, b, a), buildDate(year, a, b)]; // prefer d/m/y
    for (const c of candidates) {
      if (c && c <= now) return c;
    }
  }
  return null;
}

function monthIndex(name: string): number {
  return ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
    .indexOf(name.slice(0, 3).toLowerCase());
}

function buildDate(year: number, month: number, day: number): string | null {
  let y = year;
  if (y < 100) y += y < 70 ? 2000 : 1900; // two-digit years
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isValidISODate(iso) ? iso : null;
}

/**
 * Find the amount on a labelled line.
 *
 * Handles both "TOTAL   4,500.00" and a label whose figure OCR pushed onto the
 * next line, which is common on narrow thermal receipts.
 */
function findLabelledAmount(
  lines: string[],
  labels: string[],
  currency: CurrencyCode,
  excludeLabels: string[] = []
): Money | null {
  for (const label of labels) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      if (!line.includes(label)) continue;
      // "SUB TOTAL" contains "total" with a space in front of it, so a
      // character-boundary check alone lets the subtotal masquerade as the
      // total — which silently under-reports every receipt that has both.
      // The competing labels have to be excluded by name.
      if (excludeLabels.some((x) => line.includes(x))) continue;
      const idx = line.indexOf(label);
      if (idx > 0 && /[a-z]/.test(line[idx - 1])) continue;

      const after = lines[i].slice(idx + label.length);
      const found = lastAmountIn(after, currency) ?? lastAmountIn(lines[i], currency);
      if (found) return found;

      // Label with no figure — try the next line.
      if (i + 1 < lines.length) {
        const next = lastAmountIn(lines[i + 1], currency);
        if (next) return next;
      }
    }
  }
  return null;
}

/**
 * Number shapes, ordered longest-match-first.
 *
 * The order is the whole trick. A single `\d{1,3}(?:[,.]\d{3})*` pattern reads
 * "4730.00" as just "473" — the group needs a separator followed by exactly
 * three digits, ".00" is only two, so it stops after the first three digits and
 * silently divides the amount by ten. Each shape therefore gets its own
 * alternative, with the grouped forms tried before the plain ones.
 */
// Alternatives, in order:  1,200.00  ·  1.234,56  ·  4730.00  ·  4730,00  ·  123456
// Space is deliberately NOT a grouping separator here: on a two-column receipt
// it would let "500   300.00" match as the single amount 500300.00.
const AMOUNT_PATTERN =
  /-?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|-?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|-?\d+\.\d{1,2}|-?\d+,\d{1,2}|-?\d+/g;

/** A token only counts as money if it carries a decimal part. Bare integers on
 *  a receipt are quantities, phone numbers and registration numbers far more
 *  often than they are amounts. */
function isMoneyToken(token: string): boolean {
  return /[.,]\d{1,2}$/.test(token.trim());
}

interface AmountMatch {
  money: Money;
  /** Index in the source string, so a caller can take the text before it. */
  index: number;
  raw: string;
}

/** Rightmost amount on the line — receipts right-align the figure. */
function lastAmountMatch(
  text: string,
  currency: CurrencyCode,
  requireDecimals: boolean
): AmountMatch | null {
  const matches = [...text.matchAll(AMOUNT_PATTERN)];
  for (let i = matches.length - 1; i >= 0; i--) {
    const raw = matches[i][0];
    if (requireDecimals && !isMoneyToken(raw)) continue;
    const parsed = parseMoney(raw, currency);
    if (parsed && parsed.minor !== 0) {
      return { money: parsed, index: matches[i].index ?? 0, raw };
    }
  }
  return null;
}

function lastAmountIn(text: string, currency: CurrencyCode): Money | null {
  return lastAmountMatch(text, currency, false)?.money ?? null;
}

function allAmounts(text: string, currency: CurrencyCode): Money[] {
  const matches = text.match(AMOUNT_PATTERN) ?? [];
  const out: Money[] = [];
  for (const m of matches) {
    // Bare integers with no decimal part are usually quantities or item codes,
    // not money — requiring a decimal keeps them out of the total guess.
    if (!isMoneyToken(m)) continue;
    const parsed = parseMoney(m, currency);
    if (parsed && parsed.minor > 0) out.push(parsed);
  }
  return out;
}

function looksLikeAmount(line: string): boolean {
  return /^\s*[₦$€£]?\s*\d[\d,. ]*\d\s*$/.test(line);
}

/**
 * Line items: "2 x Indomie  1,200.00" or "Indomie Noodles   1,200.00".
 *
 * Anything on a labelled summary line (total, VAT, change) is excluded, since
 * mistaking the total for a line item would double the receipt.
 */
function extractLineItems(lines: string[], currency: CurrencyCode): ReceiptLineItem[] {
  const summaryLabels = [...TOTAL_LABELS, ...SUBTOTAL_LABELS, ...TAX_LABELS, ...TIP_LABELS,
    'change', 'cash', 'card', 'balance', 'payment', 'tendered'];
  const items: ReceiptLineItem[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (summaryLabels.some((l) => lower.includes(l))) continue;
    // "Tel: 0800-123-4567" and "RC No 123456" both look like a description
    // followed by a number; without this they become phantom line items.
    if (HEADER_NOISE.test(line)) continue;

    // requireDecimals keeps registration numbers and phone numbers out.
    const match = lastAmountMatch(line, currency, true);
    if (!match || match.money.minor <= 0) continue;

    // Take the text BEFORE the amount rather than deleting every number in the
    // line — a leading quantity ("2 x INDOMIE") is itself a number, and
    // stripping it loses the quantity we are about to parse.
    const description = line.slice(0, match.index).replace(/\s+/g, ' ').trim();
    if (description.replace(/[^a-z]/gi, '').length < 2) continue;

    const qtyMatch = /^(\d{1,3})\s*(?:x|X|\*)?\s+(.*)$/.exec(description);
    const quantity = qtyMatch ? +qtyMatch[1] : undefined;
    const name = qtyMatch ? qtyMatch[2] : description;

    items.push({
      description: titleCase(name),
      quantity,
      unitPriceMinor:
        quantity && quantity > 1 ? Math.round(match.money.minor / quantity) : undefined,
      totalMinor: match.money.minor,
    });
  }
  return items;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

// ------------------------------------------------------------------ scoring

function scoreConfidence(r: {
  merchant: string | null;
  date: string | null;
  total: Money | null;
  lineItems: ReceiptLineItem[];
  warnings: string[];
}): number {
  let score = 0;
  // Weighted by how much damage a wrong value does.
  if (r.total) score += 0.5;
  if (r.merchant) score += 0.2;
  if (r.date) score += 0.2;
  if (r.lineItems.length > 0) score += 0.1;
  // Each warning is a known-shaky reading.
  score -= r.warnings.length * 0.08;
  return Math.max(0, Math.min(1, score));
}

/**
 * Whether to spend an LLM call on this receipt.
 *
 * The deterministic parser handles clean receipts for free; the LLM is for the
 * crumpled, angled, faded ones. Gating on confidence keeps the cost proportional
 * to the difficulty instead of charging for every scan.
 */
export function needsLLM(parsed: ParsedReceipt): boolean {
  return parsed.confidence < 0.7 || parsed.total == null;
}

/** Prompt for the vision fallback. Asks for exactly the fields we failed to get. */
export function buildReceiptPrompt(parsed: ParsedReceipt, ocrText: string): string {
  const missing = [
    !parsed.merchant && 'merchant',
    !parsed.date && 'date (ISO YYYY-MM-DD)',
    !parsed.total && 'total',
    parsed.lineItems.length === 0 && 'lineItems',
  ].filter(Boolean);

  return [
    'Extract structured data from this receipt. Return only JSON matching:',
    '{"merchant": string|null, "date": "YYYY-MM-DD"|null, "total": number|null,',
    ' "tax": number|null, "currency": string,',
    ' "lineItems": [{"description": string, "quantity": number|null, "total": number}]}',
    '',
    'Amounts are decimal numbers in the receipt currency, not minor units.',
    'If a value is genuinely not on the receipt, use null. Do not guess.',
    missing.length ? `Focus especially on: ${missing.join(', ')}.` : '',
    '',
    'OCR text:',
    ocrText.slice(0, 4000),
  ].join('\n');
}
