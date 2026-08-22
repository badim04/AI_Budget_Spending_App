import { describe, it, expect } from 'vitest';
import {
  FxTable,
  add,
  allocate,
  allocateByWeights,
  formatMoney,
  fromDecimal,
  money,
  multiply,
  parseMoney,
  ratio,
  subtract,
  sum,
  toDecimal,
  zero,
} from '@/core/money';

describe('construction', () => {
  it('rejects non-integer minor units', () => {
    expect(() => money(12.5, 'USD')).toThrow(/integer/);
  });

  it('rejects NaN and Infinity', () => {
    expect(() => money(NaN, 'USD')).toThrow();
    expect(() => money(Infinity, 'USD')).toThrow();
  });

  it('rounds float artefacts when building from decimals', () => {
    // 19.99 * 100 is 1998.9999999999998 in IEEE 754 — truncation would give 1998.
    expect(fromDecimal(19.99, 'USD').minor).toBe(1999);
    expect(fromDecimal(0.1, 'USD').minor).toBe(10);
    expect(fromDecimal(1.005, 'USD').minor).toBe(101);
  });

  it('honours per-currency decimal counts', () => {
    expect(fromDecimal(1000, 'JPY').minor).toBe(1000); // 0 decimals
    expect(fromDecimal(1.5, 'KWD').minor).toBe(1500); // 3 decimals
    expect(fromDecimal(1.5, 'NGN').minor).toBe(150); // 2 decimals
  });
});

describe('parseMoney', () => {
  it('handles symbols and thousands separators', () => {
    expect(parseMoney('₦1,234.50', 'NGN')?.minor).toBe(123450);
    expect(parseMoney('$1,234.50', 'USD')?.minor).toBe(123450);
    expect(parseMoney('1 234,50', 'EUR')?.minor).toBe(123450);
  });

  it('treats accounting parentheses as negative', () => {
    expect(parseMoney('(1,234.50)', 'USD')?.minor).toBe(-123450);
  });

  it('distinguishes grouping separators from decimal separators', () => {
    expect(parseMoney('1,234,567', 'USD')?.minor).toBe(123456700);
    expect(parseMoney('1.234.567', 'EUR')?.minor).toBe(123456700);
    expect(parseMoney('1.234,56', 'EUR')?.minor).toBe(123456);
  });

  it('returns null on unparseable input rather than guessing', () => {
    expect(parseMoney('', 'USD')).toBeNull();
    expect(parseMoney('n/a', 'USD')).toBeNull();
  });
});

describe('arithmetic', () => {
  it('refuses to combine different currencies', () => {
    expect(() => add(money(100, 'USD'), money(100, 'NGN'))).toThrow(/Convert through an FxTable/);
  });

  it('adds and subtracts exactly', () => {
    const a = fromDecimal(0.1, 'USD');
    const b = fromDecimal(0.2, 'USD');
    // The float trap: 0.1 + 0.2 === 0.30000000000000004
    expect(toDecimal(add(a, b))).toBe(0.3);
    expect(subtract(fromDecimal(100, 'USD'), fromDecimal(33.33, 'USD')).minor).toBe(6667);
  });

  it('rounds multiplication half away from zero', () => {
    expect(multiply(money(101, 'USD'), 0.5).minor).toBe(51);
    expect(multiply(money(-101, 'USD'), 0.5).minor).toBe(-51);
  });

  it('sums an empty list to zero', () => {
    expect(sum([], 'NGN')).toEqual(zero('NGN'));
  });
});

describe('allocate', () => {
  it('splits without losing or inventing minor units', () => {
    const parts = allocate(money(10000, 'NGN'), 3);
    expect(parts.map((p) => p.minor)).toEqual([3334, 3333, 3333]);
    expect(parts.reduce((a, p) => a + p.minor, 0)).toBe(10000);
  });

  it('preserves the total for negative amounts', () => {
    const parts = allocate(money(-10000, 'NGN'), 3);
    expect(parts.reduce((a, p) => a + p.minor, 0)).toBe(-10000);
  });

  it('preserves the total across many split sizes', () => {
    for (let n = 1; n <= 24; n++) {
      const parts = allocate(money(123457, 'USD'), n);
      expect(parts.reduce((a, p) => a + p.minor, 0)).toBe(123457);
    }
  });

  it('rejects a non-positive part count', () => {
    expect(() => allocate(money(100, 'USD'), 0)).toThrow();
  });
});

describe('allocateByWeights', () => {
  it('preserves the total when weights do not divide evenly', () => {
    const parts = allocateByWeights(money(10000, 'NGN'), [1, 1, 1]);
    expect(parts.reduce((a, p) => a + p.minor, 0)).toBe(10000);
  });

  it('respects the weighting', () => {
    const parts = allocateByWeights(money(10000, 'NGN'), [3, 1]);
    expect(parts[0].minor).toBe(7500);
    expect(parts[1].minor).toBe(2500);
  });
});

describe('ratio', () => {
  it('returns null rather than Infinity when the denominator is zero', () => {
    expect(ratio(money(100, 'USD'), zero('USD'))).toBeNull();
  });
});

describe('formatMoney', () => {
  it('formats with the currency symbol and correct decimals', () => {
    expect(formatMoney(money(123450, 'NGN'))).toBe('₦1,234.50');
    expect(formatMoney(money(1000, 'JPY'))).toBe('¥1,000');
  });

  it('places the minus sign before the symbol', () => {
    expect(formatMoney(money(-123450, 'NGN'))).toBe('-₦1,234.50');
  });

  it('abbreviates large values for chart axes', () => {
    expect(formatMoney(money(120000000, 'NGN'), { abbreviate: true })).toBe('₦1.2M');
    expect(formatMoney(money(1200000, 'NGN'), { abbreviate: true })).toBe('₦12K');
  });

  it('adds an explicit plus for deltas', () => {
    expect(formatMoney(money(500, 'USD'), { signed: true })).toBe('+$5.00');
  });
});

describe('FxTable', () => {
  const fx = new FxTable('USD', [
    { from: 'USD', to: 'NGN', rate: 1500, asOf: '2026-08-01' },
    { from: 'USD', to: 'EUR', rate: 0.92, asOf: '2026-08-01' },
    { from: 'USD', to: 'JPY', rate: 150, asOf: '2026-08-01' },
  ]);

  it('converts from the base', () => {
    expect(fx.convert(fromDecimal(10, 'USD'), 'NGN').minor).toBe(1500000);
  });

  it('converts to the base', () => {
    expect(fx.convert(fromDecimal(15000, 'NGN'), 'USD').minor).toBe(1000);
  });

  it('triangulates between two non-base currencies', () => {
    // 1500 NGN -> 1 USD -> 0.92 EUR
    expect(fx.convert(fromDecimal(1500, 'NGN'), 'EUR').minor).toBe(92);
  });

  it('handles differing decimal counts', () => {
    // 10 USD -> 1500 JPY, and JPY has zero decimals
    expect(fx.convert(fromDecimal(10, 'USD'), 'JPY').minor).toBe(1500);
  });

  it('round-trips within one minor unit', () => {
    const original = fromDecimal(123.45, 'USD');
    const back = fx.convert(fx.convert(original, 'NGN'), 'USD');
    expect(Math.abs(back.minor - original.minor)).toBeLessThanOrEqual(1);
  });

  it('throws on an unknown currency instead of assuming parity', () => {
    expect(() => fx.convert(fromDecimal(1, 'USD'), 'XOF')).toThrow(/No FX rate/);
  });

  it('accepts a reversed rate and inverts it', () => {
    const t = new FxTable('USD', [{ from: 'NGN', to: 'USD', rate: 1 / 1500, asOf: '2026-08-01' }]);
    expect(t.convert(fromDecimal(1500, 'NGN'), 'USD').minor).toBe(100);
  });

  it('rejects a rate that touches neither side of the base', () => {
    const t = new FxTable('USD');
    expect(() => t.set({ from: 'NGN', to: 'EUR', rate: 1, asOf: '2026-08-01' })).toThrow();
  });

  it('rejects non-positive rates', () => {
    const t = new FxTable('USD');
    expect(() => t.set({ from: 'USD', to: 'NGN', rate: 0, asOf: '2026-08-01' })).toThrow();
  });

  it('totals a mixed-currency list into one currency', () => {
    const total = fx.total(
      [fromDecimal(10, 'USD'), fromDecimal(15000, 'NGN'), fromDecimal(9.2, 'EUR')],
      'USD'
    );
    expect(total.minor).toBe(3000); // $10 + $10 + $10
  });

  it('reports stale rates so the UI can prompt a refresh', () => {
    const stale = fx.staleRates(7, new Date('2026-08-20'));
    expect(stale.length).toBe(3);
    expect(fx.staleRates(60, new Date('2026-08-20')).length).toBe(0);
  });
});
