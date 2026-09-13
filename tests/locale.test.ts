/**
 * Locale-aware formatting.
 *
 * The engine is one module variable read by the money and date formatters. These
 * tests set it, assert, and always set it back to the default so no test leaks a
 * locale into another — the whole reason the default is deterministic.
 *
 * Intl locale *data* varies by runtime, so assertions check the shape that must
 * hold everywhere (grouping separator differs, symbol side flips) rather than an
 * exact string only one Node build produces.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  getActiveLocale,
  setActiveLocale,
  resolveLocale,
  isEnglishLocale,
  symbolPosition,
} from '@/core/locale';
import { formatMoney, money } from '@/core/money';
import { formatDate } from '@/core/dates';

afterEach(() => setActiveLocale('en-US'));

describe('active locale', () => {
  it('defaults to en-US', () => {
    expect(getActiveLocale()).toBe('en-US');
  });

  it('an unusable tag falls back rather than poisoning every number', () => {
    setActiveLocale('not a locale!!');
    expect(getActiveLocale()).toBe('en-US');
    setActiveLocale('');
    expect(getActiveLocale()).toBe('en-US');
  });

  it('accepts a real tag', () => {
    setActiveLocale('de-DE');
    expect(getActiveLocale()).toBe('de-DE');
  });
});

describe('resolveLocale', () => {
  it('auto and empty follow the device', () => {
    // Whatever the device is, it must be a usable, non-auto tag.
    expect(resolveLocale('auto')).not.toBe('auto');
    expect(resolveLocale('')).not.toBe('auto');
    expect(resolveLocale(undefined)).not.toBe('auto');
  });

  it('an explicit choice is honoured', () => {
    expect(resolveLocale('fr-FR')).toBe('fr-FR');
  });
});

describe('isEnglishLocale', () => {
  it('matches the English family, not French', () => {
    expect(isEnglishLocale('en')).toBe(true);
    expect(isEnglishLocale('en-NG')).toBe(true);
    expect(isEnglishLocale('en-GB')).toBe(true);
    expect(isEnglishLocale('fr-FR')).toBe(false);
    expect(isEnglishLocale('de-DE')).toBe(false);
  });
});

describe('formatMoney follows the active locale', () => {
  it('English keeps a comma group and a leading symbol', () => {
    expect(formatMoney(money(1_234_567_00, 'NGN'))).toBe('₦1,234,567.00');
  });

  it('German groups with dots and a decimal comma', () => {
    setActiveLocale('de-DE');
    const out = formatMoney(money(1_234_50, 'EUR'));
    // 1.234,50 € — dot grouping, comma decimal, symbol trailing.
    expect(out).toContain('1.234,50');
    expect(out.trim().endsWith('€')).toBe(true);
  });

  it('an explicit opts.locale overrides the active one', () => {
    setActiveLocale('de-DE');
    expect(formatMoney(money(1_000_00, 'USD'), { locale: 'en-US' })).toBe('$1,000.00');
  });

  it('Indian English uses the lakh grouping', () => {
    setActiveLocale('en-IN');
    // 12,34,567 — the 2,2,3 grouping, not 1,234,567.
    expect(formatMoney(money(12_34_567_00, 'INR'), { compactDecimals: true })).toContain(
      '12,34,567'
    );
  });
});

describe('symbolPosition', () => {
  it('English puts the symbol in front', () => {
    expect(symbolPosition('en-US', 'USD')).toBe('prefix');
    expect(symbolPosition('en-NG', 'NGN')).toBe('prefix');
  });

  it('French puts the euro symbol after the number', () => {
    expect(symbolPosition('fr-FR', 'EUR')).toBe('suffix');
  });
});

describe('formatDate follows the active locale', () => {
  it('English keeps the hand-built day-first format', () => {
    expect(formatDate('2026-08-05', 'medium')).toBe('5 Aug 2026');
  });

  it('a non-English locale reorders and renames the month', () => {
    setActiveLocale('de-DE');
    const out = formatDate('2026-08-05', 'medium');
    // German shortens August to "Aug." and keeps day-first: "5. Aug. 2026".
    expect(out).toMatch(/2026/);
    expect(out).not.toBe('5 Aug 2026'); // proves it took the Intl path
  });

  it('the bare day number is locale-neutral', () => {
    setActiveLocale('de-DE');
    expect(formatDate('2026-08-05', 'day')).toBe('5');
  });
});
