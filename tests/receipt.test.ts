import { describe, it, expect } from 'vitest';
import {
  buildReceiptPrompt,
  detectCurrency,
  extractDate,
  needsLLM,
  parseReceipt,
} from '@/ingest/receipt/parse';

const TODAY = '2026-08-13';

/** A clean thermal-printer receipt, the common case. */
const SHOPRITE = `
SHOPRITE NIGERIA LTD
Ikeja City Mall
RC No 123456
Tel: 0800-123-4567
------------------------------
2 x INDOMIE CHICKEN       1,200.00
PEAK MILK 400G              3,450.00
BREAD SLICED                1,100.00
EGGS CRATE                  4,200.00
------------------------------
SUB TOTAL                   9,950.00
VAT 7.5%                      746.25
TOTAL                      10,696.25
CASH                       11,000.00
CHANGE                        303.75
------------------------------
13/08/2026  14:32
THANK YOU FOR SHOPPING
`;

/** OCR has pushed the figure onto its own line, and the date is written out. */
const CAFE = `
The Coffee Bean
Victoria Island

Cappuccino                  2500.00
Croissant                   1800.00

Subtotal
4300.00
Service Charge
430.00
TOTAL DUE
4730.00

10 Aug 2026
`;

/** A degraded scan: no total label, no readable date. */
const MESSY = `
QUICKMART
Sausage Roll   500.00
Water          300.00
800.00
`;

describe('detectCurrency', () => {
  it('reads the symbol off the receipt', () => {
    expect(detectCurrency('TOTAL ₦4,500.00', 'USD')).toBe('NGN');
    expect(detectCurrency('TOTAL $45.00', 'NGN')).toBe('USD');
    expect(detectCurrency('TOTAL GHS 45.00', 'NGN')).toBe('GHS');
  });

  it('falls back to the account currency when there is no hint', () => {
    expect(detectCurrency('TOTAL 4500.00', 'NGN')).toBe('NGN');
  });
});

describe('extractDate', () => {
  it('prefers an unambiguous ISO date', () => {
    expect(extractDate('Issued 2026-08-13 at 14:00', TODAY)).toBe('2026-08-13');
  });

  it('reads written-out months in both orders', () => {
    expect(extractDate('13 Aug 2026', TODAY)).toBe('2026-08-13');
    expect(extractDate('Aug 13, 2026', TODAY)).toBe('2026-08-13');
    expect(extractDate('1st September 2025', TODAY)).toBe('2025-09-01');
  });

  it('resolves an ambiguous numeric date to the reading that is not in the future', () => {
    // 08/13/2026 can only be mm/dd — 13 is not a month.
    expect(extractDate('08/13/2026', TODAY)).toBe('2026-08-13');
    // 13/08/2026 can only be dd/mm.
    expect(extractDate('13/08/2026', TODAY)).toBe('2026-08-13');
  });

  it('prefers day/month for a genuinely ambiguous date', () => {
    // 05/08/2026 -> 5 August, not 8 May, and both are in the past.
    expect(extractDate('05/08/2026', TODAY)).toBe('2026-08-05');
  });

  it('rejects a reading that would be in the future', () => {
    // 12/09/2026 as dd/mm is 12 Sept (future); as mm/dd it is 9 Dec (also future).
    expect(extractDate('12/09/2026', '2026-08-13')).toBeNull();
  });

  it('expands two-digit years', () => {
    expect(extractDate('13/08/26', TODAY)).toBe('2026-08-13');
  });

  it('returns null when there is no date at all', () => {
    expect(extractDate('TOTAL 4500.00', TODAY)).toBeNull();
  });
});

describe('parseReceipt — clean receipt', () => {
  const r = parseReceipt(SHOPRITE, { defaultCurrency: 'NGN', today: TODAY });

  it('reads the merchant from the header, skipping the address and RC number', () => {
    expect(r.merchant).toBe('Shoprite Nigeria Ltd');
  });

  it('reads the date', () => {
    expect(r.date).toBe('2026-08-13');
  });

  it('reads the total, not the cash tendered', () => {
    // The trap: CASH 11,000.00 is larger than the total.
    expect(r.total?.minor).toBe(1_069_625);
  });

  it('reads subtotal and VAT separately', () => {
    expect(r.subtotal?.minor).toBe(995_000);
    expect(r.tax?.minor).toBe(74_625);
  });

  it('does not pick "sub total" when asked for "total"', () => {
    expect(r.total?.minor).not.toBe(r.subtotal?.minor);
  });

  it('extracts line items without swallowing the summary rows', () => {
    const descriptions = r.lineItems.map((i) => i.description);
    expect(descriptions).toContain('Indomie Chicken');
    expect(descriptions).toContain('Peak Milk 400g');
    expect(descriptions.join(' ')).not.toMatch(/Total|Vat|Change|Cash/i);
  });

  it('reads a leading quantity and derives the unit price', () => {
    const indomie = r.lineItems.find((i) => i.description === 'Indomie Chicken');
    expect(indomie?.quantity).toBe(2);
    expect(indomie?.unitPriceMinor).toBe(60_000);
  });

  it('is confident enough to skip the LLM', () => {
    expect(r.confidence).toBeGreaterThan(0.8);
    expect(needsLLM(r)).toBe(false);
    expect(r.warnings).toHaveLength(0);
  });

  it('sums line items close to the subtotal', () => {
    const sum = r.lineItems.reduce((a, i) => a + i.totalMinor, 0);
    expect(sum).toBe(995_000);
  });
});

describe('parseReceipt — figure on the following line', () => {
  const r = parseReceipt(CAFE, { defaultCurrency: 'NGN', today: TODAY });

  it('picks up a total whose figure OCR pushed onto the next line', () => {
    expect(r.total?.minor).toBe(473_000);
  });

  it('still reads the merchant and date', () => {
    expect(r.merchant).toBe('The Coffee Bean');
    expect(r.date).toBe('2026-08-10');
  });

  it('reads the service charge as a tip', () => {
    expect(r.tip?.minor).toBe(43_000);
  });

  it('reconciles subtotal + service against the total without warning', () => {
    expect(r.warnings.join(' ')).not.toMatch(/does not match/);
  });
});

describe('parseReceipt — degraded scan', () => {
  const r = parseReceipt(MESSY, { defaultCurrency: 'NGN', today: TODAY });

  it('falls back to the largest amount when no total is labelled', () => {
    expect(r.total?.minor).toBe(80_000);
    expect(r.warnings.join(' ')).toMatch(/largest amount/);
  });

  it('flags the missing date', () => {
    expect(r.date).toBeNull();
    expect(r.warnings.join(' ')).toMatch(/date/i);
  });

  it('routes to the LLM fallback', () => {
    expect(needsLLM(r)).toBe(true);
  });
});

describe('parseReceipt — hostile input', () => {
  it('does not throw on empty text', () => {
    const r = parseReceipt('', { defaultCurrency: 'NGN', today: TODAY });
    expect(r.total).toBeNull();
    expect(r.confidence).toBe(0);
    expect(needsLLM(r)).toBe(true);
  });

  it('does not throw on text with no amounts at all', () => {
    const r = parseReceipt('hello world\nthis is not a receipt', {
      defaultCurrency: 'NGN',
      today: TODAY,
    });
    expect(r.total).toBeNull();
  });

  it('warns when the arithmetic does not reconcile', () => {
    // Subtotal 5,000 + VAT 375 should be 5,375, but the total reads 9,999.
    const r = parseReceipt(
      'SHOP\nSUBTOTAL 5,000.00\nVAT 375.00\nTOTAL 9,999.00\n13/08/2026',
      { defaultCurrency: 'NGN', today: TODAY }
    );
    expect(r.warnings.join(' ')).toMatch(/does not match/);
  });

  it('handles a receipt where the total is the only figure', () => {
    const r = parseReceipt('KIOSK\nTOTAL 1,500.00\n13/08/2026', {
      defaultCurrency: 'NGN',
      today: TODAY,
    });
    expect(r.total?.minor).toBe(150_000);
  });
});

describe('buildReceiptPrompt', () => {
  it('names the fields the deterministic parser failed to get', () => {
    const r = parseReceipt(MESSY, { defaultCurrency: 'NGN', today: TODAY });
    const prompt = buildReceiptPrompt(r, MESSY);
    expect(prompt).toMatch(/Focus especially on/);
    expect(prompt).toMatch(/date/);
    expect(prompt).toMatch(/Do not guess/);
  });
});
