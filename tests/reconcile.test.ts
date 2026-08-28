/**
 * Reconciling an import against the totals the bank printed on the statement.
 *
 * These are written against the bad outcome rather than the good one. The good
 * outcome — "the numbers matched" — is one line and proves very little. What
 * has to hold is that the check *fires* when a column shifts or a section is
 * dropped, that it stays quiet when there is nothing to check, and above all
 * that it cannot block a correct import on a preamble it misread itself.
 */

import { describe, it, expect } from 'vitest';
import {
  findDeclaredTotals,
  reconcileStatement,
  sectionIsSelfConsistent,
  type DeclaredSection,
} from '@/ingest/statement/reconcile';
import type { StatementRow } from '@/ingest/statement/parse';

/** Rows shaped the way `parseStatementGrid` emits them. */
const rows = (...amounts: number[]): StatementRow[] =>
  amounts.map((amountMinor, i) => ({
    line: i + 2,
    date: '2026-07-01',
    description: `Row ${i + 1}`,
    amountMinor,
  }));

/** The layout OPay's PDF uses: a row of labels, then a row of values. */
const STACKED = [
  ['Wallet Account', 'Period:', '30 Jun 2026', '-', '24 Aug 2026'],
  ['Opening Balance', 'Total Debit', 'Debit Count'],
  ['₦', '7,800.00', '₦', '695,294.73', '126'],
  ['Closing Balance', 'Total Credit', 'Credit Count'],
  ['₦', '1,026.00', '₦', '688,520.73', '45'],
];

/** The layout its spreadsheet export uses: label and value side by side. */
const INLINE = [
  ['Wallet Account Statement', '', '', '', 'Date Printed', '25 Aug 2026 21:06:13'],
  ['Account Name', 'ABDULAKEEM OLADIMEJI ADEBAYO', 'Account Number', '8102579422'],
  ['Opening Balance', '₦7,800.00', 'Total Debit', '₦695,294.73', 'Debit Count', '126'],
  ['Closing Balance', '₦1,026.00', 'Total Credit', '₦688,520.73', 'Credit Count', '45'],
];

const WALLET: DeclaredSection = {
  name: 'Wallet Account',
  openingMinor: 780000,
  closingMinor: 102600,
  debitMinor: 69529473,
  creditMinor: 68852073,
  debitCount: 126,
  creditCount: 45,
};

describe('findDeclaredTotals', () => {
  it('reads the stacked layout, ignoring the bare currency symbols', () => {
    // The PDF emits "₦" as its own text run. Matched positionally without
    // dropping those, every figure lands one label to the left.
    expect(findDeclaredTotals(STACKED, 'NGN')).toEqual([WALLET]);
  });

  it('reads the inline layout', () => {
    expect(findDeclaredTotals(INLINE, 'NGN')).toEqual([WALLET]);
  });

  it('keeps two account sections apart', () => {
    const both = findDeclaredTotals(
      [
        ...STACKED,
        ['30 Jun 2026', 'Mobile Data', '960.00'],
        ['Savings Account', 'Period:', '30 Jun 2026', '-', '24 Aug 2026'],
        ['Opening Balance', 'Total Debit', 'Debit Count'],
        ['₦', '19.52', '₦', '14.73', '2'],
        ['Closing Balance', 'Total Credit', 'Credit Count'],
        ['₦', '9.83', '₦', '5.04', '56'],
      ],
      'NGN'
    );

    expect(both.map((s) => s.name)).toEqual(['Wallet Account', 'Savings Account']);
    expect(both[1].creditCount).toBe(56);
    expect(both[1].debitMinor).toBe(1473);
  });

  it('finds nothing in a file that declares nothing', () => {
    expect(
      findDeclaredTotals(
        [
          ['Date', 'Description', 'Amount'],
          ['2026-07-01', 'Coffee', '-4.50'],
        ],
        'NGN'
      )
    ).toEqual([]);
  });

  it('does not mistake a description for a section heading', () => {
    // "Transfer to SAVINGS ACCOUNT" is a transaction, not a new section.
    const found = findDeclaredTotals(
      [
        ...STACKED,
        ['01 Jul 2026', 'Transfer to my other savings account', '5,000.00'],
      ],
      'NGN'
    );
    expect(found).toHaveLength(1);
  });
});

describe('sectionIsSelfConsistent', () => {
  it('accepts a section whose own arithmetic holds', () => {
    // 7,800.00 + 688,520.73 - 695,294.73 = 1,026.00
    expect(sectionIsSelfConsistent(WALLET)).toBe(true);
  });

  it('rejects one that does not add up', () => {
    expect(sectionIsSelfConsistent({ ...WALLET, closingMinor: 999999 })).toBe(false);
  });

  it('accepts a section with no balances to check against', () => {
    expect(
      sectionIsSelfConsistent({ name: 'x', debitMinor: 100, creditMinor: 200 })
    ).toBe(true);
  });
});

describe('reconcileStatement', () => {
  it('passes when every figure agrees', () => {
    const check = reconcileStatement(
      [{ name: 'A', debitMinor: 300, creditMinor: 500, debitCount: 2, creditCount: 1 }],
      rows(-100, -200, 500)
    );

    expect(check.status).toBe('ok');
    expect(check.checks).toHaveLength(4);
    expect(check.summary).toMatch(/matches what was read/);
  });

  it('catches a column read one place across', () => {
    // The 15,000.00 transfer that imported as 16,840.00 — the running balance
    // printed beside it. Counts still agree; only the money moves.
    const check = reconcileStatement(
      [{ name: 'A', debitMinor: 0, creditMinor: 1500000, debitCount: 0, creditCount: 1 }],
      rows(1684000)
    );

    expect(check.status).toBe('mismatch');
    expect(check.checks.find((x) => x.label === 'Money in')!.delta).toBe(184000);
    expect(check.summary).toMatch(/Money in does not match/);
  });

  it('catches a whole section that never made it into the rows', () => {
    const check = reconcileStatement(
      [
        { name: 'Wallet', debitMinor: 300, creditMinor: 0, debitCount: 2, creditCount: 0 },
        { name: 'Savings', debitMinor: 0, creditMinor: 900, debitCount: 0, creditCount: 3 },
      ],
      rows(-100, -200)
    );

    expect(check.status).toBe('mismatch');
    expect(check.summary).toBe('The statement lists 3 payments in, and 3 could not be read.');
  });

  it('names a missing count rather than a bigger-looking money delta', () => {
    // Minor units are large numbers and row counts are small ones, so ranking
    // all four by size would announce a 12.00 discrepancy over 5 lost rows.
    const check = reconcileStatement(
      [{ name: 'A', debitMinor: 1200, creditMinor: 50000, debitCount: 1, creditCount: 6 }],
      rows(-1200, 50000)
    );

    expect(check.summary).toMatch(/payments in/);
  });

  it('says nothing when the file declared nothing', () => {
    const check = reconcileStatement([], rows(-100, 200));
    expect(check.status).toBe('unchecked');
    expect(check.checks).toEqual([]);
  });

  /**
   * The guard that keeps this module from becoming the next silent failure.
   *
   * A veto over imports is only safe while the figures behind it are known to
   * be read correctly. A preamble we misparsed would otherwise refuse a
   * perfectly good statement, and the user would have no way to tell which side
   * was wrong.
   */
  it('excludes a section whose declared figures contradict themselves', () => {
    const check = reconcileStatement(
      [
        {
          name: 'Garbled',
          openingMinor: 1000,
          closingMinor: 5000, // 1000 + 200 - 300 is not 5000
          debitMinor: 300,
          creditMinor: 200,
          debitCount: 1,
          creditCount: 1,
        },
      ],
      rows(-100, 200)
    );

    expect(check.status).toBe('unchecked');
    expect(check.unreadable).toEqual(['Garbled']);
    expect(check.summary).toMatch(/did not add up/);
  });

  it('still checks the sections it could read when one is garbled', () => {
    const check = reconcileStatement(
      [
        { name: 'Good', debitMinor: 300, creditMinor: 0, debitCount: 2, creditCount: 0 },
        {
          name: 'Bad',
          openingMinor: 1,
          closingMinor: 99, // 1 + 4 - 3 is 2, not 99
          debitMinor: 3,
          creditMinor: 4,
        },
      ],
      rows(-100, -200)
    );

    expect(check.unreadable).toEqual(['Bad']);
    expect(check.status).toBe('ok');
  });

  /**
   * A partial declaration is not a licence to compare against a smaller number.
   *
   * If one section prints a debit count and the other does not, summing the one
   * that did and calling it the file's total would fail every honest import.
   */
  it('skips a check no section can fully supply', () => {
    const check = reconcileStatement(
      [
        { name: 'A', debitMinor: 300, debitCount: 2 },
        { name: 'B', debitMinor: 100 },
      ],
      rows(-100, -200, -100)
    );

    expect(check.checks.map((x) => x.label)).toEqual(['Money out']);
    expect(check.status).toBe('ok');
  });
});
