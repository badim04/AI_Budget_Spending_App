/**
 * Money — integer minor units, never floats.
 *
 * Every amount in this app is an integer count of the currency's smallest unit
 * (kobo, cent, satang). Floating point is banned in the money layer because
 * 0.1 + 0.2 !== 0.3, and a budget app that is off by a hundredth of a unit per
 * transaction drifts visibly over a month of data.
 *
 * A Money value is meaningless without its currency, so the two always travel
 * together. Arithmetic across currencies throws rather than guessing — the
 * caller must convert explicitly through an FxTable so the rate used is a
 * recorded decision, not an accident.
 */

export type CurrencyCode = string; // ISO 4217, e.g. "NGN", "USD", "JPY"

export interface Money {
  /** Integer count of minor units. 12345 in USD is $123.45. */
  readonly minor: number;
  readonly currency: CurrencyCode;
}

export interface CurrencyMeta {
  code: CurrencyCode;
  /** Number of decimal places. JPY has 0, KWD has 3, most have 2. */
  decimals: number;
  symbol: string;
  name: string;
}

/**
 * Currencies we ship metadata for. Anything not listed falls back to 2 decimals
 * and the code as its own symbol, which is correct for the large majority of
 * ISO 4217 and degrades gracefully rather than throwing.
 */
export const CURRENCIES: Record<CurrencyCode, CurrencyMeta> = {
  NGN: { code: 'NGN', decimals: 2, symbol: '₦', name: 'Nigerian Naira' },
  USD: { code: 'USD', decimals: 2, symbol: '$', name: 'US Dollar' },
  EUR: { code: 'EUR', decimals: 2, symbol: '€', name: 'Euro' },
  GBP: { code: 'GBP', decimals: 2, symbol: '£', name: 'Pound Sterling' },
  GHS: { code: 'GHS', decimals: 2, symbol: '₵', name: 'Ghanaian Cedi' },
  KES: { code: 'KES', decimals: 2, symbol: 'KSh', name: 'Kenyan Shilling' },
  ZAR: { code: 'ZAR', decimals: 2, symbol: 'R', name: 'South African Rand' },
  CAD: { code: 'CAD', decimals: 2, symbol: 'C$', name: 'Canadian Dollar' },
  AUD: { code: 'AUD', decimals: 2, symbol: 'A$', name: 'Australian Dollar' },
  INR: { code: 'INR', decimals: 2, symbol: '₹', name: 'Indian Rupee' },
  JPY: { code: 'JPY', decimals: 0, symbol: '¥', name: 'Japanese Yen' },
  KWD: { code: 'KWD', decimals: 3, symbol: 'KD', name: 'Kuwaiti Dinar' },
  BHD: { code: 'BHD', decimals: 3, symbol: 'BD', name: 'Bahraini Dinar' },
  AED: { code: 'AED', decimals: 2, symbol: 'د.إ', name: 'UAE Dirham' },
  CNY: { code: 'CNY', decimals: 2, symbol: '¥', name: 'Chinese Yuan' },
  BTC: { code: 'BTC', decimals: 8, symbol: '₿', name: 'Bitcoin' },
  USDT: { code: 'USDT', decimals: 6, symbol: '₮', name: 'Tether' },
};

export function currencyMeta(code: CurrencyCode): CurrencyMeta {
  return (
    CURRENCIES[code] ?? { code, decimals: 2, symbol: code, name: code }
  );
}

export function decimalsFor(code: CurrencyCode): number {
  return currencyMeta(code).decimals;
}

// ---------------------------------------------------------------- construct

export function money(minor: number, currency: CurrencyCode): Money {
  if (!Number.isFinite(minor)) {
    throw new TypeError(`Money amount must be finite, got ${minor}`);
  }
  if (!Number.isSafeInteger(minor)) {
    throw new TypeError(
      `Money must be an integer count of minor units, got ${minor}. ` +
        `Use fromDecimal() to build from a human-entered value.`
    );
  }
  // Normalise -0 to 0. Negative zero survives arithmetic (`-1 * 0`, negating an
  // empty sum) and then renders as "-$0.00", which reads as a bug to the user.
  return { minor: minor === 0 ? 0 : minor, currency };
}

export function zero(currency: CurrencyCode): Money {
  return { minor: 0, currency };
}

/**
 * Build Money from a human-scale value: fromDecimal(12.34, 'USD') -> 1234 cents.
 *
 * Scaling is done on the decimal *string*, never by multiplying the float.
 * `Math.round(1.005 * 100)` gives 100, not 101, because 1.005 * 100 evaluates
 * to 100.49999999999999 — the error is introduced by the multiplication, so no
 * amount of rounding afterwards can recover the intended value. Shifting the
 * decimal point textually sidesteps the multiplication entirely, and JavaScript
 * guarantees `String(n)` is the shortest representation that round-trips, so
 * the digits we shift are exactly the ones the user meant.
 */
export function fromDecimal(value: number, currency: CurrencyCode): Money {
  if (!Number.isFinite(value)) {
    throw new TypeError(`Cannot build Money from ${value}`);
  }
  return money(scaleDecimalString(String(value), decimalsFor(currency)), currency);
}

/** Shift a decimal string left by `decimals` places, rounding half away from zero. */
function scaleDecimalString(input: string, decimals: number): number {
  let s = input;
  if (/e/i.test(s)) s = expandExponential(s);

  const negative = s.startsWith('-');
  if (negative || s.startsWith('+')) s = s.slice(1);

  const dot = s.indexOf('.');
  const intPart = dot === -1 ? s : s.slice(0, dot);
  const fracPart = dot === -1 ? '' : s.slice(dot + 1);

  // One extra digit beyond what we keep — that digit decides the rounding.
  const padded = (fracPart + '0'.repeat(decimals + 1)).slice(0, decimals + 1);
  const kept = (intPart || '0') + padded.slice(0, decimals);

  let n = Number(kept);
  if (!Number.isFinite(n)) throw new TypeError(`Cannot build Money from ${input}`);
  if (padded.charCodeAt(decimals) - 48 >= 5) n += 1;

  return negative ? -n : n;
}

function expandExponential(s: string): string {
  // toFixed is correctly rounded per spec and covers the exponential range that
  // matters here; anything larger exceeds MAX_SAFE_INTEGER and money() rejects it.
  const n = Number(s);
  if (!Number.isFinite(n)) return '0';
  return n.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Parse a user-typed or OCR-extracted string. Tolerates currency symbols,
 * thousands separators, whitespace, and accounting-style negatives — "(₦1,234.50)"
 * and "-1 234,50" both parse. Returns null on anything it cannot read, so the
 * caller decides whether that is a validation error or a line to skip.
 */
export function parseMoney(input: string, currency: CurrencyCode): Money | null {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;

  // Accounting parentheses mean negative: (1,234.50) === -1234.50
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }

  // Strip everything that is not a digit, separator, or sign.
  s = s.replace(/[^\d.,\-+]/g, '');
  if (s.startsWith('-')) negative = true;
  s = s.replace(/[+\-]/g, '');
  if (!s) return null;

  // Decide which separator is the decimal point. The last-occurring separator
  // wins if it is followed by 1-2 digits (or 3 for currencies like KWD);
  // otherwise both separators are grouping ("1,234,567").
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  const decimals = decimalsFor(currency);
  const sepIndex = Math.max(lastComma, lastDot);

  let normalized: string;
  if (sepIndex === -1) {
    normalized = s;
  } else {
    const tail = s.length - sepIndex - 1;
    const isDecimalSep = tail > 0 && tail <= Math.max(2, decimals);
    if (isDecimalSep) {
      normalized =
        s.slice(0, sepIndex).replace(/[.,]/g, '') + '.' + s.slice(sepIndex + 1);
    } else {
      normalized = s.replace(/[.,]/g, '');
    }
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  const m = fromDecimal(value, currency);
  return negative ? negate(m) : m;
}

// ---------------------------------------------------------------- arithmetic

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new TypeError(
      `Cannot combine ${a.currency} and ${b.currency} directly. ` +
        `Convert through an FxTable first so the rate is recorded.`
    );
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minor + b.minor, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minor - b.minor, a.currency);
}

export function negate(a: Money): Money {
  return money(-a.minor, a.currency);
}

export function abs(a: Money): Money {
  return money(Math.abs(a.minor), a.currency);
}

/** Scale by a plain number (a share, a rate, a quantity). Rounds half away from zero. */
export function multiply(a: Money, factor: number): Money {
  if (!Number.isFinite(factor)) throw new TypeError(`Bad factor ${factor}`);
  return money(roundHalfAwayFromZero(a.minor * factor), a.currency);
}

export function divide(a: Money, divisor: number): Money {
  if (!Number.isFinite(divisor) || divisor === 0) {
    throw new TypeError(`Bad divisor ${divisor}`);
  }
  return money(roundHalfAwayFromZero(a.minor / divisor), a.currency);
}

export function sum(items: Money[], currency: CurrencyCode): Money {
  return items.reduce((acc, m) => add(acc, m), zero(currency));
}

/**
 * Split into n parts that add back up to exactly the original.
 *
 * Naive division loses or invents minor units — ₦100 split 3 ways is not
 * 33.33 x 3. The remainder is distributed one minor unit at a time across the
 * leading parts, so the sum is always exact. This matters for splitting a
 * shared bill or spreading an annual charge across 12 months.
 */
export function allocate(total: Money, parts: number): Money[] {
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new TypeError(`parts must be a positive integer, got ${parts}`);
  }
  const base = Math.trunc(total.minor / parts);
  let remainder = total.minor - base * parts;
  const step = remainder >= 0 ? 1 : -1;
  const out: Money[] = [];
  for (let i = 0; i < parts; i++) {
    let share = base;
    if (remainder !== 0) {
      share += step;
      remainder -= step;
    }
    out.push(money(share, total.currency));
  }
  return out;
}

/** Split by weights (e.g. splitting a receipt across categories), sum preserved. */
export function allocateByWeights(total: Money, weights: number[]): Money[] {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) throw new TypeError('weights must sum to a positive number');
  const out: Money[] = [];
  let assigned = 0;
  for (let i = 0; i < weights.length; i++) {
    if (i === weights.length - 1) {
      out.push(money(total.minor - assigned, total.currency));
    } else {
      const share = roundHalfAwayFromZero((total.minor * weights[i]) / totalWeight);
      assigned += share;
      out.push(money(share, total.currency));
    }
  }
  return out;
}

function roundHalfAwayFromZero(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

// ---------------------------------------------------------------- comparison

export function isZero(a: Money): boolean {
  return a.minor === 0;
}
export function isNegative(a: Money): boolean {
  return a.minor < 0;
}
export function isPositive(a: Money): boolean {
  return a.minor > 0;
}
export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.minor === b.minor;
}
export function compare(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  return a.minor - b.minor;
}
export function max(a: Money, b: Money): Money {
  return compare(a, b) >= 0 ? a : b;
}
export function min(a: Money, b: Money): Money {
  return compare(a, b) <= 0 ? a : b;
}

/** a / b as a plain ratio. Returns null when b is zero — "spent 40% of nothing"
 *  has no answer, and callers must render that case rather than show Infinity. */
export function ratio(a: Money, b: Money): number | null {
  assertSameCurrency(a, b);
  if (b.minor === 0) return null;
  return a.minor / b.minor;
}

// ------------------------------------------------------------------ display

export function toDecimal(a: Money): number {
  return a.minor / 10 ** decimalsFor(a.currency);
}

export interface FormatOptions {
  /** Drop the minor units entirely: ₦12,500 rather than ₦12,500.00 */
  compactDecimals?: boolean;
  /** 1.2M instead of 1,200,000 — for chart axes and tight tiles. */
  abbreviate?: boolean;
  /** Force a leading + on positive values, for deltas. */
  signed?: boolean;
  /** Render the ISO code instead of the symbol, for ambiguous symbols like ¥. */
  useCode?: boolean;
  locale?: string;
}

export function formatMoney(a: Money, opts: FormatOptions = {}): string {
  const meta = currencyMeta(a.currency);
  const locale = opts.locale ?? 'en-US';
  const value = toDecimal(a);
  const negative = a.minor < 0;
  const magnitude = Math.abs(value);

  let body: string;
  if (opts.abbreviate && magnitude >= 1000) {
    body = abbreviateNumber(magnitude);
  } else {
    const digits = opts.compactDecimals ? 0 : meta.decimals;
    body = magnitude.toLocaleString(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  const unit = opts.useCode ? `${meta.code} ` : meta.symbol;
  const sign = negative ? '-' : opts.signed ? '+' : '';
  return `${sign}${unit}${body}`;
}

function abbreviateNumber(n: number): string {
  const tiers: Array<[number, string]> = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [size, suffix] of tiers) {
    if (n >= size) {
      const scaled = n / size;
      // 1.2K but 12K — a second significant digit only helps below 10.
      const decimals = scaled < 10 ? 1 : 0;
      return `${trimTrailingZero(scaled.toFixed(decimals))}${suffix}`;
    }
  }
  return n.toFixed(0);
}

function trimTrailingZero(s: string): string {
  return s.replace(/\.0$/, '');
}

// ----------------------------------------------------------------------- fx

export interface FxRate {
  from: CurrencyCode;
  to: CurrencyCode;
  /** Units of `to` per 1 unit of `from`, in human decimal scale. */
  rate: number;
  /** When this rate was observed — stale rates are a real source of wrong totals. */
  asOf: string; // ISO date
  source?: string;
}

/**
 * Converts between currencies via a base currency.
 *
 * Rates are stored one-way against a base and inverted on demand, so a table
 * with N currencies needs N rates rather than N². Conversion between two
 * non-base currencies triangulates through the base.
 */
export class FxTable {
  readonly base: CurrencyCode;
  private readonly rates = new Map<CurrencyCode, FxRate>();

  constructor(base: CurrencyCode, rates: FxRate[] = []) {
    this.base = base;
    for (const r of rates) this.set(r);
  }

  set(rate: FxRate): void {
    if (rate.rate <= 0 || !Number.isFinite(rate.rate)) {
      throw new TypeError(`FX rate must be positive and finite, got ${rate.rate}`);
    }
    if (rate.from === this.base) {
      this.rates.set(rate.to, rate);
    } else if (rate.to === this.base) {
      this.rates.set(rate.from, {
        from: this.base,
        to: rate.from,
        rate: 1 / rate.rate,
        asOf: rate.asOf,
        source: rate.source,
      });
    } else {
      throw new TypeError(
        `FX rate ${rate.from}->${rate.to} touches neither side of base ${this.base}`
      );
    }
  }

  /** Units of `code` per 1 unit of base. */
  rateFromBase(code: CurrencyCode): number | null {
    if (code === this.base) return 1;
    return this.rates.get(code)?.rate ?? null;
  }

  has(code: CurrencyCode): boolean {
    return code === this.base || this.rates.has(code);
  }

  asOf(code: CurrencyCode): string | null {
    if (code === this.base) return null;
    return this.rates.get(code)?.asOf ?? null;
  }

  /**
   * Convert, rounding once at the end. Throws on an unknown currency rather
   * than silently treating it as 1:1 — a missing rate must surface as a
   * prompt to refresh rates, not as a wrong total.
   */
  convert(amount: Money, to: CurrencyCode): Money {
    if (amount.currency === to) return amount;
    const fromRate = this.rateFromBase(amount.currency);
    const toRate = this.rateFromBase(to);
    if (fromRate == null) throw new Error(`No FX rate for ${amount.currency}`);
    if (toRate == null) throw new Error(`No FX rate for ${to}`);

    const fromDecimals = decimalsFor(amount.currency);
    const toDecimals = decimalsFor(to);
    // Work in human scale so differing decimal counts (JPY 0 vs KWD 3) are
    // handled by the scale factors rather than by ad-hoc shifting.
    const inBase = amount.minor / 10 ** fromDecimals / fromRate;
    const inTarget = inBase * toRate;
    return money(roundHalfAwayFromZero(inTarget * 10 ** toDecimals), to);
  }

  /** Convert a mixed-currency list into a single total. */
  total(amounts: Money[], to: CurrencyCode): Money {
    return amounts.reduce((acc, m) => add(acc, this.convert(m, to)), zero(to));
  }

  /** Currencies with rates older than `days` — surface these before showing totals. */
  staleRates(days: number, now: Date = new Date()): FxRate[] {
    const cutoff = now.getTime() - days * 86_400_000;
    return [...this.rates.values()].filter(
      (r) => new Date(r.asOf).getTime() < cutoff
    );
  }
}
