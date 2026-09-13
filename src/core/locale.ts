/**
 * The active display locale — how numbers and dates are grouped and ordered.
 *
 * Kept as a small piece of module state, deliberately, for the same reason the
 * AI kill switch is (`src/ingest/aiToggle.ts`): the formatters in `money.ts` and
 * `dates.ts` are called from hundreds of places, and threading a locale argument
 * through every one of them would be noise. The locale is set once — from the
 * device at startup, or from the Settings override — and the formatters read it
 * back here.
 *
 * **Default is `en-US`.** Anything that never sets a locale — every test, the
 * pure core exercised in isolation — formats deterministically. That is why the
 * hundreds of existing assertions on `formatMoney`/`formatDate` keep passing:
 * nothing sets a locale in a test, so nothing changes there.
 *
 * **Detection uses no native module.** `Intl` is present in Hermes (React
 * Native 0.76 ships the Intl-enabled build) and in every browser, so reading the
 * device locale is a JS-only change that ships over the air — no `expo-localization`,
 * no new APK. Every `Intl` touch is wrapped, because a stripped Hermes build or
 * an exotic locale string must degrade to `en-US`, never throw.
 *
 * Pure except for the one module variable; no React, no I/O.
 */

const FALLBACK = 'en-US';
let active = FALLBACK;

/** The locale the formatters should use right now. */
export function getActiveLocale(): string {
  return active;
}

/**
 * Set the active locale to a concrete, validated tag.
 *
 * An unusable tag (a stale setting from a future build, a stripped Intl) falls
 * back to `en-US` rather than poisoning every number on screen. Pass the result
 * of `resolveLocale` here — this takes a real locale, not the `'auto'` sentinel.
 */
export function setActiveLocale(locale: string | null | undefined): void {
  active = isUsableLocale(locale) ? locale!.trim() : FALLBACK;
}

/**
 * Turn a stored setting into the locale to actually use.
 *
 * `'auto'`, empty, or absent means "follow the device", which is the default a
 * fresh install gets. Anything else is an explicit choice the user made in
 * Settings and is honoured as-is (if usable).
 */
export function resolveLocale(setting?: string | null): string {
  const s = (setting ?? '').trim();
  if (!s || s === 'auto') return detectLocale();
  return isUsableLocale(s) ? s : detectLocale();
}

/** The device's locale, read without a native module. */
export function detectLocale(): string {
  try {
    const l = Intl.DateTimeFormat().resolvedOptions().locale;
    if (l && typeof l === 'string') return l;
  } catch {
    /* Hermes without Intl, or a sandbox that blocks it. */
  }
  try {
    const nav = (globalThis as { navigator?: { language?: string } }).navigator;
    if (nav?.language) return nav.language;
  } catch {
    /* no navigator off the main thread */
  }
  return FALLBACK;
}

/** Is `en`, `en-GB`, `en-NG`… — the locales that keep the hand-built date format. */
export function isEnglishLocale(locale: string = active): boolean {
  return /^en\b/i.test(locale);
}

function isUsableLocale(locale: string | null | undefined): boolean {
  if (!locale || typeof locale !== 'string' || !locale.trim()) return false;
  try {
    // Constructing one is enough to reject a malformed tag; a stripped Intl
    // throws here and we treat the locale as unusable.
    new Intl.NumberFormat(locale.trim());
    return true;
  } catch {
    return false;
  }
}

/**
 * Where the currency symbol sits, for this locale and currency.
 *
 * "€1.234,56" in Ireland but "1.234,56 €" in Germany — same currency, opposite
 * side — so the answer needs both the locale and the currency. Derived from
 * `Intl` rather than a hand-kept table (which would rot), and cached because it
 * is asked on every rendered amount. Falls back to `prefix`, the commonest case
 * and the one the app used before this existed.
 */
const positionCache = new Map<string, 'prefix' | 'suffix'>();
export function symbolPosition(locale: string, currency: string): 'prefix' | 'suffix' {
  const key = `${locale}|${currency}`;
  const cached = positionCache.get(key);
  if (cached) return cached;

  let pos: 'prefix' | 'suffix' = 'prefix';
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(1);
    const currencyIndex = parts.findIndex((p) => p.type === 'currency');
    const numberIndex = parts.findIndex(
      (p) => p.type === 'integer' || p.type === 'decimal' || p.type === 'fraction'
    );
    if (currencyIndex > -1 && numberIndex > -1 && currencyIndex > numberIndex) {
      pos = 'suffix';
    }
  } catch {
    /* leave as prefix */
  }
  positionCache.set(key, pos);
  return pos;
}

/**
 * Locales the Settings picker offers.
 *
 * A curated spread, not every BCP 47 tag: enough to cover the grouping and
 * date-order conventions a user is likely to want, each labelled so the choice
 * is made by reading a sample rather than guessing what a code does. `auto`
 * heads the list and is the default — most people want their phone's setting.
 */
export interface LocaleOption {
  /** BCP 47 tag, or `'auto'` for "follow the device". */
  code: string;
  label: string;
}

export const LOCALE_OPTIONS: LocaleOption[] = [
  { code: 'auto', label: 'Automatic (device)' },
  { code: 'en-NG', label: 'English (Nigeria)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-IN', label: 'English (India)' },
  { code: 'fr-FR', label: 'Français (France)' },
  { code: 'de-DE', label: 'Deutsch (Deutschland)' },
  { code: 'es-ES', label: 'Español (España)' },
  { code: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'it-IT', label: 'Italiano (Italia)' },
  { code: 'nl-NL', label: 'Nederlands' },
  { code: 'ar-EG', label: 'العربية (مصر)' },
  { code: 'hi-IN', label: 'हिन्दी (भारत)' },
  { code: 'ja-JP', label: '日本語 (日本)' },
  { code: 'zh-CN', label: '中文 (中国)' },
  { code: 'ko-KR', label: '한국어 (대한민국)' },
];
