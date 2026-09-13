/**
 * International statement reading.
 *
 * Two hardening passes, both verifiable without a real foreign bank file:
 *
 *  - Header synonyms in French, German, Spanish and Portuguese, so a non-English
 *    export is recognised at all rather than failing header detection and
 *    importing nothing.
 *  - Day-first vs month-first learned from the file's own evidence, so a US
 *    statement of ambiguous dates is not silently misdated into the wrong month
 *    — an error the reconciler cannot catch, since moving a row between months
 *    changes no total.
 */

import { describe, it, expect } from 'vitest';
import { detectColumns, detectDateOrder, parseStatement } from '@/ingest/statement/parse';

describe('foreign-language headers are recognised', () => {
  it('French: Date / Libellé / Débit / Crédit / Solde', () => {
    const csv = `Date,Libellé,Débit,Crédit,Solde
05/03/2026,ACHAT CARTE MONOPRIX PARIS,"45,90",,"1.234,56"
06/03/2026,VIREMENT SALAIRE,,"2.500,00","3.734,56"
`;
    const parsed = parseStatement(csv, { currency: 'EUR', today: '2026-08-22' });
    expect(parsed.problems).toEqual([]);
    expect(parsed.rows).toHaveLength(2);
    // Debit is money out, credit money in.
    const debit = parsed.rows.find((r) => r.description.includes('MONOPRIX'))!;
    const credit = parsed.rows.find((r) => r.description.includes('SALAIRE'))!;
    expect(debit.amountMinor).toBe(-45_90);
    expect(credit.amountMinor).toBe(2_500_00);
  });

  it('German with semicolons and a signed Betrag column, European numbers', () => {
    const csv = `Datum;Verwendungszweck;Betrag;Saldo
05.03.2026;REWE SAGT DANKE;-45,90;1.234,56
06.03.2026;GEHALT;2.500,00;3.734,56
`;
    const parsed = parseStatement(csv, { currency: 'EUR', today: '2026-08-22' });
    expect(parsed.problems).toEqual([]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].amountMinor).toBe(-45_90);
    expect(parsed.rows[1].amountMinor).toBe(2_500_00);
  });

  it('Spanish: Fecha / Concepto / Importe', () => {
    const cols = detectColumns(['Fecha', 'Concepto', 'Importe', 'Saldo']);
    expect(cols).not.toBeNull();
    expect(cols!.date).toBe(0);
    expect(cols!.description).toBe(1);
    expect(cols!.amount).toBe(2);
    expect(cols!.balance).toBe(3);
  });
});

describe('detectDateOrder learns from the file', () => {
  it('a day > 12 proves day-first', () => {
    expect(detectDateOrder([['13/04/2026'], ['05/06/2026']])).toBe('dmy');
  });

  it('a second field > 12 proves month-first', () => {
    expect(detectDateOrder([['04/13/2026'], ['01/05/2026']])).toBe('mdy');
  });

  it('no evidence defaults to day-first', () => {
    expect(detectDateOrder([['05/06/2026'], ['01/02/2026']])).toBe('dmy');
  });

  it('mixed/contradictory evidence stays on the safe default', () => {
    expect(detectDateOrder([['13/04/2026'], ['04/13/2026']])).toBe('dmy');
  });
});

describe('a US statement is not misdated', () => {
  it('one unambiguous month-first date fixes the whole file', () => {
    // 12/25 can only be month/day, so 01/05 must read as 5 January, not 1 May.
    const csv = `Date,Description,Amount
01/05/2026,Coffee shop,-4.50
12/25/2026,Holiday gift,-50.00
`;
    const parsed = parseStatement(csv, { currency: 'USD', today: '2027-02-01' });
    expect(parsed.problems).toEqual([]);
    const coffee = parsed.rows.find((r) => r.description.includes('Coffee'))!;
    const gift = parsed.rows.find((r) => r.description.includes('gift'))!;
    expect(coffee.date).toBe('2026-01-05');
    expect(gift.date).toBe('2026-12-25');
  });
});
