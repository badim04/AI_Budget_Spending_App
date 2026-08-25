/**
 * Report tests.
 *
 * The thing that matters most: PDF, CSV and Excel all read from one `Report`,
 * so they cannot disagree. A PDF that said one number while the spreadsheet
 * said another would be worse than no export at all — these tests pin that.
 */

import { describe, it, expect } from 'vitest';
import { FxTable, money } from '@/core/money';
import { buildReport, reportRange, type ReportInput } from '@/reports/build';
import { reportToHtml } from '@/reports/html';
import { reportToCsv, reportToSheets, sheetToCsv, reportFilename } from '@/reports/tabular';
import { periodRange } from '@/core/dates';
import type { Account, Budget, Category, Transaction } from '@/core/types';

const ASOF = '2026-08-20';

const categories: Category[] = [
  { id: 'cat_food', name: 'Food', kind: 'expense', icon: '🍚', color: '#f00', excludeFromTotals: false, sortOrder: 1, archived: false, isSystem: true },
  { id: 'cat_salary', name: 'Salary', kind: 'income', icon: '💰', color: '#0f0', excludeFromTotals: false, sortOrder: 2, archived: false, isSystem: true },
];

const accounts: Account[] = [
  { id: 'acc1', name: 'Main', kind: 'bank', currency: 'NGN', openingBalanceMinor: 100_000_00, openedAt: '2026-01-01', archived: false, createdAt: '', updatedAt: '' },
];

const budgets: Budget[] = [
  { id: 'b1', name: 'Food', categoryIds: ['cat_food'], amountMinor: 50_000_00, currency: 'NGN', period: 'monthly', rollover: 'reset', startsOn: '2026-01-01', alertThreshold: 0.8, archived: false, createdAt: '', updatedAt: '' },
];

function tx(over: Partial<Transaction> & { amountMinor: number; date: string }): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    accountId: 'acc1',
    kind: over.amountMinor > 0 ? 'income' : 'expense',
    currency: 'NGN',
    merchant: 'Shop',
    source: 'manual',
    confidence: 'high',
    reviewed: true,
    tags: [],
    dedupeKey: Math.random().toString(36),
    pending: false,
    createdAt: '',
    updatedAt: '',
    ...over,
  } as Transaction;
}

const transactions: Transaction[] = [
  tx({ amountMinor: -12_000_00, date: '2026-08-05', categoryId: 'cat_food', merchant: 'Shoprite, Ikeja' }),
  tx({ amountMinor: -8_000_00, date: '2026-08-12', categoryId: 'cat_food', merchant: 'Mama Put' }),
  tx({ amountMinor: 300_000_00, date: '2026-08-01', categoryId: 'cat_salary', merchant: 'Employer' }),
  tx({ amountMinor: -5_000_00, date: '2026-07-10', categoryId: 'cat_food', merchant: 'Old month' }),
];

function input(over: Partial<ReportInput> = {}): ReportInput {
  return {
    transactions,
    categories,
    accounts,
    budgets,
    displayCurrency: 'NGN',
    fx: new FxTable('NGN'),
    range: periodRange(ASOF, 'monthly'),
    asOf: ASOF,
    ...over,
  };
}

describe('buildReport', () => {
  const r = buildReport(input());

  it('totals only the transactions inside the range', () => {
    expect(r.totals.spend.minor).toBe(20_000_00); // July's 5,000 excluded
    expect(r.totals.income.minor).toBe(300_000_00);
    expect(r.totals.net.minor).toBe(280_000_00);
  });

  it('resolves category and account names onto transactions', () => {
    expect(r.transactions).toHaveLength(3);
    expect(r.transactions[0].categoryName).toBeTruthy();
    expect(r.transactions[0].accountName).toBe('Main');
  });

  it('labels an uncategorised transaction rather than leaving it blank', () => {
    const withNone = buildReport(
      input({ transactions: [tx({ amountMinor: -1_000_00, date: '2026-08-05' })] })
    );
    expect(withNone.transactions[0].categoryName).toBe('Uncategorised');
  });

  it('sorts transactions newest first', () => {
    const dates = r.transactions.map((t) => t.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('produces KPIs with values, never blanks', () => {
    expect(r.kpis.length).toBeGreaterThan(4);
    for (const k of r.kpis) {
      expect(k.label).toBeTruthy();
      expect(k.value).toBeTruthy();
    }
  });

  it('includes budget status', () => {
    expect(r.budgets).toHaveLength(1);
    expect(r.budgets[0].spent.minor).toBe(20_000_00);
  });

  it('says so honestly when there is too little history to forecast', () => {
    const sparse = buildReport(input({ transactions: [transactions[0]] }));
    expect(sparse.forecastNote).toMatch(/Not enough|error|Confidence/);
  });

  it('handles a completely empty dataset without throwing', () => {
    const empty = buildReport(input({ transactions: [], budgets: [] }));
    expect(empty.totals.spend.minor).toBe(0);
    expect(empty.transactions).toEqual([]);
    expect(() => reportToHtml(empty)).not.toThrow();
    expect(() => reportToCsv(empty, true)).not.toThrow();
  });
});

describe('formats agree with each other', () => {
  const r = buildReport(input());

  it('CSV row count matches the transaction count', () => {
    const sheets = reportToSheets(r);
    const txSheet = sheets.find((s) => s.name === 'Transactions')!;
    expect(txSheet.rows.length - 1).toBe(r.transactions.length); // minus header
  });

  it('writes amounts as numbers so a spreadsheet can sum them', () => {
    const txSheet = reportToSheets(r).find((s) => s.name === 'Transactions')!;
    const amounts = txSheet.rows.slice(1).map((row) => row[4]);
    for (const a of amounts) expect(typeof a).toBe('number');
    expect(amounts.reduce((x: number, y) => x + (y as number), 0)).toBeCloseTo(280_000, 2);
  });

  it('the PDF shows the same spend total as the report model', () => {
    const html = reportToHtml(r);
    expect(html).toContain('₦20,000');
  });
});

describe('CSV safety', () => {
  const r = buildReport(input());

  it('quotes a merchant containing a comma', () => {
    const csv = sheetToCsv(reportToSheets(r)[0]);
    expect(csv).toContain('"Shoprite, Ikeja"');
  });

  it('escapes embedded quotes by doubling them', () => {
    const odd = buildReport(
      input({ transactions: [tx({ amountMinor: -100, date: '2026-08-05', merchant: 'The "Best" Shop' })] })
    );
    expect(sheetToCsv(reportToSheets(odd)[0])).toContain('"The ""Best"" Shop"');
  });

  it('neutralises a merchant name that would become an Excel formula', () => {
    const evil = buildReport(
      input({ transactions: [tx({ amountMinor: -100, date: '2026-08-05', merchant: '=1+1' })] })
    );
    const csv = sheetToCsv(reportToSheets(evil)[0]);
    expect(csv).not.toMatch(/(^|,)=1\+1/);
    expect(csv).toContain("'=1+1");
  });
});

describe('HTML safety', () => {
  it('escapes markup in a merchant name', () => {
    const evil = buildReport(
      input({
        transactions: [
          tx({ amountMinor: -100, date: '2026-08-05', merchant: '<script>alert(1)</script>' }),
        ],
      })
    );
    const html = reportToHtml(evil);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('filenames', () => {
  it('are sortable and describe the period', () => {
    const r = buildReport(input());
    const name = reportFilename(r, 'pdf');
    expect(name).toMatch(/^finlo-.*-2026-08-01-to-2026-08-31\.pdf$/);
    expect(name).not.toMatch(/[^a-z0-9.\-]/);
  });
});

describe('reportRange', () => {
  it('covers the expected windows', () => {
    expect(reportRange('this_month', ASOF, null)).toMatchObject({ start: '2026-08-01', end: '2026-08-31' });
    expect(reportRange('last_month', ASOF, null)).toMatchObject({ start: '2026-07-01', end: '2026-07-31' });
    expect(reportRange('quarter', ASOF, null)).toMatchObject({ start: '2026-07-01', end: '2026-09-30' });
    expect(reportRange('year', ASOF, null)).toMatchObject({ start: '2026-01-01', end: '2026-12-31' });
  });

  it('uses the earliest transaction for all-time', () => {
    expect(reportRange('all', ASOF, '2025-03-04')).toMatchObject({ start: '2025-03-04', end: ASOF });
  });
});
