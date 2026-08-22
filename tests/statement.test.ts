import { describe, it, expect } from 'vitest';
import {
  detectColumns,
  findHeaderRow,
  parseCsv,
  parseStatement,
  summarise,
  withinRange,
} from '@/ingest/statement/parse';

const opts = { currency: 'NGN' as const, today: '2026-08-22' };

/** GTBank-style: preamble rows, then Debit/Credit columns, newest first. */
const GTB = `Account Statement
Account Number,0123456789
Period,01-Jan-2026 to 31-Mar-2026

Trans Date,Value Date,Narration,Debit,Credit,Balance
15/03/2026,15/03/2026,"POS PURCHASE SHOPRITE IKEJA, LAGOS",15750.00,,248300.50
10/03/2026,10/03/2026,NIP TRF FROM EMPLOYER LTD,,1150000.00,264050.50
05/03/2026,05/03/2026,RENT PAYMENT LANDLORD,450000.00,,
`;

/** Monzo/Revolut-style: single signed Amount column, ISO dates, oldest first. */
const SIGNED = `Date,Description,Amount,Balance
2026-03-05,Uber trip,-3450.00,120000.00
2026-03-06,Salary,250000.00,370000.00
2026-03-07,Netflix,-7200.00,362800.00
`;

describe('parseCsv', () => {
  it('keeps commas inside quoted fields together', () => {
    // The bug this guards: a naive split(',') shifts every later column, so the
    // balance gets read as the amount.
    const rows = parseCsv('a,"one, two",c\n1,"x, y",3');
    expect(rows[0]).toEqual(['a', 'one, two', 'c']);
    expect(rows[1]).toEqual(['1', 'x, y', '3']);
  });

  it('handles escaped quotes', () => {
    expect(parseCsv('a,"say ""hi""",c')[0]).toEqual(['a', 'say "hi"', 'c']);
  });

  it('strips a UTF-8 BOM off the first header', () => {
    expect(parseCsv('﻿Date,Amount')[0][0]).toBe('Date');
  });

  it('handles CRLF and drops blank lines', () => {
    expect(parseCsv('a,b\r\n1,2\r\n\r\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('sniffs semicolon and tab delimiters', () => {
    expect(parseCsv('a;b;c')[0]).toEqual(['a', 'b', 'c']);
    expect(parseCsv('a\tb\tc')[0]).toEqual(['a', 'b', 'c']);
  });
});

describe('detectColumns', () => {
  it('maps a debit/credit layout', () => {
    const cols = detectColumns(['Trans Date', 'Value Date', 'Narration', 'Debit', 'Credit', 'Balance']);
    expect(cols).toMatchObject({ date: 0, description: 2, debit: 3, credit: 4, balance: 5 });
    // Direction comes from the pair, so no single amount column is used.
    expect(cols?.amount).toBeUndefined();
  });

  it('maps a single signed amount layout', () => {
    expect(detectColumns(['Date', 'Description', 'Amount', 'Balance'])).toMatchObject({
      date: 0,
      description: 1,
      amount: 2,
    });
  });

  it('accepts the many names banks use for a description', () => {
    for (const h of ['Narration', 'Details', 'Particulars', 'Memo', 'Payee', 'Remarks']) {
      expect(detectColumns(['Date', h, 'Amount']), h).not.toBeNull();
    }
  });

  it('returns null when there is no date or no description', () => {
    expect(detectColumns(['Foo', 'Bar'])).toBeNull();
    expect(detectColumns(['Date', 'Amount'])).toBeNull();
  });
});

describe('findHeaderRow', () => {
  it('skips the account preamble banks put above the table', () => {
    // parseCsv drops the blank separator line, so the header is index 3.
    expect(findHeaderRow(parseCsv(GTB))).toBe(3);
  });
});

describe('parseStatement — debit/credit export', () => {
  const r = parseStatement(GTB, opts);

  it('reads every row', () => {
    expect(r.rows).toHaveLength(3);
    expect(r.problems).toHaveLength(0);
  });

  it('signs debits negative and credits positive', () => {
    const shoprite = r.rows.find((x) => x.description.includes('SHOPRITE'))!;
    const salary = r.rows.find((x) => x.description.includes('EMPLOYER'))!;
    expect(shoprite.amountMinor).toBe(-1_575_000);
    expect(salary.amountMinor).toBe(115_000_000);
  });

  it('keeps a comma inside the narration intact', () => {
    expect(r.rows.find((x) => x.description.includes('SHOPRITE'))!.description).toBe(
      'POS PURCHASE SHOPRITE IKEJA, LAGOS'
    );
  });

  it('converts d/m/y dates', () => {
    expect(r.rows.map((x) => x.date)).toEqual(['2026-03-05', '2026-03-10', '2026-03-15']);
  });

  it('reorders a newest-first export into a timeline', () => {
    expect(r.wasReversed).toBe(true);
    expect(r.from).toBe('2026-03-05');
    expect(r.to).toBe('2026-03-15');
  });

  it('reads the balance when present and tolerates it missing', () => {
    expect(r.rows[2].balanceAfterMinor).toBe(24_830_050);
    expect(r.rows[0].balanceAfterMinor).toBeUndefined();
  });
});

describe('parseStatement — signed amount export', () => {
  const r = parseStatement(SIGNED, opts);

  it('preserves the sign', () => {
    expect(r.rows.map((x) => x.amountMinor)).toEqual([-345_000, 25_000_000, -720_000]);
  });

  it('does not reorder an already-chronological file', () => {
    expect(r.wasReversed).toBe(false);
  });
});

describe('parseStatement — awkward input', () => {
  it('reports a bad date instead of dropping the file', () => {
    const r = parseStatement('Date,Description,Amount\nnot-a-date,Foo,-100.00\n2026-03-05,Bar,-200.00', opts);
    expect(r.rows).toHaveLength(1);
    expect(r.problems[0].reason).toMatch(/Unreadable date/);
    expect(r.problems[0].line).toBe(2);
  });

  it('explains an unrecognisable file rather than throwing', () => {
    const r = parseStatement('just some text\nwith no table', opts);
    expect(r.rows).toHaveLength(0);
    expect(r.problems[0].reason).toMatch(/header row/);
  });

  it('handles an empty file', () => {
    expect(parseStatement('', opts).problems[0].reason).toMatch(/empty/);
  });

  it('skips zero-value and totals rows', () => {
    const r = parseStatement(
      'Date,Description,Amount\n2026-03-05,Balance b/f,0.00\n2026-03-06,Real,-100.00\n,TOTAL,-100.00',
      opts
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].description).toBe('Real');
  });

  it('reads CR/DR suffixes when there is no sign', () => {
    const r = parseStatement(
      'Date,Description,Amount\n2026-03-05,Inflow,5000.00 CR\n2026-03-06,Outflow,3000.00 DR',
      opts
    );
    expect(r.rows[0].amountMinor).toBe(500_000);
    expect(r.rows[1].amountMinor).toBe(-300_000);
  });

  it('does not double-negate a debit that already carries a minus', () => {
    const r = parseStatement('Date,Narration,Debit,Credit\n2026-03-05,Thing,-5000.00,', opts);
    expect(r.rows[0].amountMinor).toBe(-500_000);
  });
});

describe('withinRange and summarise', () => {
  const r = parseStatement(SIGNED, opts);

  it('filters to a date window', () => {
    expect(withinRange(r.rows, '2026-03-06', undefined)).toHaveLength(2);
    expect(withinRange(r.rows, '2026-03-06', '2026-03-06')).toHaveLength(1);
    expect(withinRange(r.rows, null, null)).toHaveLength(3);
  });

  it('totals inflow and outflow separately', () => {
    const s = summarise(r.rows);
    expect(s).toMatchObject({
      count: 3,
      inflowMinor: 25_000_000,
      outflowMinor: 1_065_000,
      from: '2026-03-05',
      to: '2026-03-07',
    });
  });

  it('summarises an empty selection without dividing by zero', () => {
    expect(summarise([])).toMatchObject({ count: 0, inflowMinor: 0, outflowMinor: 0, from: null });
  });
});
