/**
 * Statement file reading, against real bank exports.
 *
 * The fixtures are genuine OPay statements (same account, same period, one PDF
 * and one XLSX), which is the only way to be sure the PDF path actually works —
 * a synthetic PDF would not have the subset-font encoding that makes naive
 * extraction produce gibberish.
 *
 * Both files are skipped politely when absent so the suite still runs on a
 * clean checkout.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractPdfText, isPdf, parseCMap } from '@/ingest/pdf/extract';
import { readStatement, stitchPdfRows, decodeText, formatFromName } from '@/ingest/statement/sources';
import { parseStatementGrid, summarise } from '@/ingest/statement/parse';
import { reconcileStatement } from '@/ingest/statement/reconcile';

/** Fixed so the relative-date fallback cannot drift with the wall clock. */
const TODAY = '2026-08-26';

import { HAS_STATEMENTS, STATEMENT_PDF, STATEMENT_XLSX, describeMissingFixtures } from './fixtures';

const PDF = STATEMENT_PDF ?? '';
const XLSX_FILE = STATEMENT_XLSX ?? '';

const hasPdf = STATEMENT_PDF != null;
const hasXlsx = STATEMENT_XLSX != null;

// A skipped test still prints as a pass. Say so instead.
if (!HAS_STATEMENTS) console.warn(describeMissingFixtures());
const bytesOf = (p: string) => new Uint8Array(readFileSync(p));

describe('format detection', () => {
  it('reads the extension', () => {
    expect(formatFromName('a.pdf')).toBe('pdf');
    expect(formatFromName('a.XLSX')).toBe('xlsx');
    expect(formatFromName('a.csv')).toBe('csv');
    expect(formatFromName('statement.txt')).toBe('text');
  });

  it('trusts the bytes over the extension', () => {
    // A PDF renamed to .txt is still a PDF.
    const fake = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    expect(isPdf(fake)).toBe(true);
  });
});

describe('text decoding', () => {
  it('strips a UTF-8 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x2c, 0x62]);
    expect(decodeText(bytes)).toBe('a,b');
  });

  it('handles UTF-16LE, which Windows exports produce', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x2c, 0x00, 0x62, 0x00]);
    expect(decodeText(bytes)).toBe('a,b');
  });
});

describe('ToUnicode CMap', () => {
  it('parses a bfrange span', () => {
    const map = parseCMap(`
      begincmap
      2 beginbfrange
      <0005><0005><0020>
      <0011><0013><002c>
      endbfrange
      endcmap`);
    expect(map.get(0x05)).toBe(' ');
    expect(map.get(0x11)).toBe(',');
    expect(map.get(0x12)).toBe('-');
    expect(map.get(0x13)).toBe('.');
  });

  it('parses bfchar pairs', () => {
    const map = parseCMap(`beginbfchar <0041><0061> <0042><0062> endbfchar`);
    expect(map.get(0x41)).toBe('a');
    expect(map.get(0x42)).toBe('b');
  });

  it('parses the explicit array form of bfrange', () => {
    const map = parseCMap(`beginbfrange <0005><0007>[<0041><0042><0043>] endbfrange`);
    expect(map.get(0x05)).toBe('A');
    expect(map.get(0x06)).toBe('B');
    expect(map.get(0x07)).toBe('C');
  });
});

describe('stitchPdfRows', () => {
  it('attaches wrapped description lines to the row above', () => {
    const rows = stitchPdfRows([
      '30 Jun 2026 10:20:46\t30 Jun 2026\t5,000.00\t--\t1,840.00\tMobile',
      '8067436786 | chi',
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].join(' ')).toContain('8067436786');
  });

  it('starts a new row at each date anchor', () => {
    const rows = stitchPdfRows([
      '30 Jun 2026 10:20:46\tA\t1.00',
      'overflow',
      '01 Jul 2026 09:13:26\tB\t2.00',
    ]);
    expect(rows).toHaveLength(2);
  });

  it('does not lose a fragment that appears before its own row', () => {
    const rows = stitchPdfRows([
      'Transfer to ABDULLAH OLALEKAN ADIGUN | OPay |',
      '30 Jun 2026 10:20:46\t30 Jun 2026\t5,000.00',
    ]);
    const joined = rows.map((r) => r.join(' ')).join(' | ');
    expect(joined).toContain('ABDULLAH OLALEKAN ADIGUN');
  });
});

describe.skipIf(!hasPdf)('real OPay PDF statement', () => {
  const bytes = hasPdf ? bytesOf(PDF) : new Uint8Array();

  it('is recognised and not encrypted', () => {
    expect(isPdf(bytes)).toBe(true);
    const r = extractPdfText(bytes);
    expect(r.encrypted).toBe(false);
  });

  it('extracts readable text, not subset-font gibberish', () => {
    const r = extractPdfText(bytes);
    const all = r.lines.join('\n');
    // Without the ToUnicode CMap this file decodes "Transfer" as "7UDQVIHU".
    expect(all).toContain('Transfer');
    expect(all).toContain('Account Statement');
    expect(all).not.toContain('7UDQVIHU');
    expect(r.pageCount).toBeGreaterThan(1);
  });

  it('recovers real transaction rows', () => {
    const src = readStatement(bytes, 'statement.pdf');
    expect(src.format).toBe('pdf');
    expect(src.encrypted).toBe(false);

    const joined = src.rows.map((r) => r.join(' ')).join('\n');
    expect(joined).toContain('Mobile Data');
    expect(joined).toContain('MTN');

    // Rows that look like transactions: leading date + at least one amount.
    const txLike = src.rows.filter(
      (r) => /^\d{1,2}\s+\w{3}\s+\d{4}/.test(r[0] ?? '') && r.some((c) => /\d,\d{3}\.\d{2}|\d+\.\d{2}/.test(c))
    );
    expect(txLike.length).toBeGreaterThan(50);
  });

  it('keeps merchant detail that categorisation depends on', () => {
    const joined = readStatement(bytes, 'statement.pdf')
      .rows.map((r) => r.join(' '))
      .join('\n');
    for (const needle of ['Stamp Duty', 'Airtime', 'Transfer to', 'Transfer from']) {
      expect(joined, needle).toContain(needle);
    }
  });
});

describe.skipIf(!hasXlsx)('real OPay XLSX statement', () => {
  const bytes = hasXlsx ? bytesOf(XLSX_FILE) : new Uint8Array();

  it('reads every sheet, not just the first', () => {
    const src = readStatement(bytes, 'statement.xlsx');
    expect(src.format).toBe('xlsx');
    expect(src.sections.length).toBeGreaterThanOrEqual(2);
    expect(src.sections.join(' ')).toMatch(/Wallet|Savings/i);
  });

  it('produces transaction rows with amounts', () => {
    const src = readStatement(bytes, 'statement.xlsx');
    const txLike = src.rows.filter(
      (r) => /^\d{1,2}\s+\w{3}\s+\d{4}/.test(r[0] ?? '') && r.length >= 5
    );
    expect(txLike.length).toBeGreaterThan(50);
  });
});

describe.skipIf(!hasPdf || !hasXlsx)('PDF and XLSX agree', () => {
  /**
   * The strongest check this repo has.
   *
   * The same account and the same period, exported twice by the same bank in
   * two formats. One is structured and one has to be recovered from page
   * geometry, so if both land on the same transactions, the hard path works.
   *
   * The bank prints its own totals in the file preamble, which makes them
   * ground truth rather than a snapshot of whatever the parser happened to do:
   *
   *   Wallet   Total Debit 695,294.73 (126)   Total Credit 688,520.73 (45)
   *   Savings  Total Debit      14.73 (2)     Total Credit       5.04
   *
   * Before the column-aware PDF reader, the PDF import produced 318,618.22 in
   * and 608,681.12 out, and read a 15,000.00 transfer as 16,840.00 — it was
   * picking up the running balance, because a wrapped description shifted
   * every column after it left by one. Numbers that look plausible and are
   * wrong are the worst failure this app can have, so it gets pinned down.
   */
  const WALLET_DEBIT = 69529473;
  const WALLET_CREDIT = 68852073;
  const SAVINGS_DEBIT = 1473;
  const SAVINGS_CREDIT = 504;

  /** Both sections, which is what either format should now produce. */
  const TOTAL_DEBIT = WALLET_DEBIT + SAVINGS_DEBIT;
  const TOTAL_CREDIT = WALLET_CREDIT + SAVINGS_CREDIT;
  const DEBIT_COUNT = 126 + 2;
  const CREDIT_COUNT = 45 + 56;

  const parseFile = (path: string, name: string) => {
    const source = readStatement(bytesOf(path), name, { currency: 'NGN' });
    return { source, parsed: parseStatementGrid(source.rows, { currency: 'NGN', today: TODAY }) };
  };

  it('the PDF matches the totals the bank printed on it', () => {
    const { parsed } = parseFile(PDF, 's.pdf');
    const totals = summarise(parsed.rows);

    expect(parsed.problems).toEqual([]);
    expect(totals.inflowMinor).toBe(TOTAL_CREDIT);
    expect(totals.outflowMinor).toBe(TOTAL_DEBIT);
    expect(parsed.rows.length).toBe(DEBIT_COUNT + CREDIT_COUNT);
  });

  it('the XLSX matches the totals for both of its sheets', () => {
    const { parsed } = parseFile(XLSX_FILE, 's.xlsx');
    const totals = summarise(parsed.rows);

    expect(parsed.problems).toEqual([]);
    expect(totals.inflowMinor).toBe(TOTAL_CREDIT);
    expect(totals.outflowMinor).toBe(TOTAL_DEBIT);
    expect(parsed.rows.length).toBe(DEBIT_COUNT + CREDIT_COUNT);
  });

  /**
   * The savings section used to vanish from the PDF without a trace.
   *
   * It is printed as a second table on its own x positions, so anchors
   * clustered across the whole file put every one of its rows a column to the
   * right of where the header said. `parseStatementGrid` read an empty date
   * cell and skipped them — no exception, no problem entry, 58 transactions
   * gone, and a suite written against wallet-only totals that called it a pass.
   */
  it('reads the savings section of the PDF, not just the wallet', () => {
    const { source, parsed } = parseFile(PDF, 's.pdf');

    expect(source.declared.map((d) => d.name)).toEqual(['Wallet Account', 'Savings Account']);

    const interest = parsed.rows.filter((r) => /OWealth Interest Earned/i.test(r.description));
    expect(interest.length).toBe(56);
    expect(interest.every((r) => r.amountMinor === 9)).toBe(true);
  });

  it('reconciles both formats against the totals printed in the file', () => {
    for (const [path, name] of [
      [PDF, 's.pdf'],
      [XLSX_FILE, 's.xlsx'],
    ] as const) {
      const { source, parsed } = parseFile(path, name);
      const check = reconcileStatement(source.declared, parsed.rows);

      expect(check.unreadable, `${name} preamble`).toEqual([]);
      expect(check.checks.map((x) => x.label).sort(), `${name} coverage`).toEqual([
        'Money in',
        'Money out',
        'Payments in',
        'Payments out',
      ]);
      expect(
        check.checks.filter((x) => !x.ok).map((x) => `${x.label} off by ${x.delta}`),
        `${name} reconciliation`
      ).toEqual([]);
      expect(check.status, name).toBe('ok');
    }
  });

  /**
   * The check has to be able to fail, or it is decoration.
   *
   * Dropping a section from the declaration is the shape of the bug it exists
   * to catch: rows we read that the statement never claimed, or the reverse.
   */
  it('refuses a parse that disagrees with the declared totals', () => {
    const { source, parsed } = parseFile(PDF, 's.pdf');
    const walletOnly = source.declared.filter((d) => d.name === 'Wallet Account');

    const check = reconcileStatement(walletOnly, parsed.rows);
    expect(check.status).toBe('mismatch');
    expect(check.checks.find((x) => x.label === 'Payments in')!.delta).toBe(56);
    expect(check.summary).toMatch(/more than that were read/);
  });

  it('every transaction in the PDF is in the XLSX, to the kobo', () => {
    const { parsed: fromPdf } = parseFile(PDF, 's.pdf');
    const { parsed: fromXlsx } = parseFile(XLSX_FILE, 's.xlsx');

    const key = (r: { date: string; amountMinor: number }) => `${r.date}|${r.amountMinor}`;
    const inXlsx = new Set(fromXlsx.rows.map(key));
    const missing = fromPdf.rows.filter((r) => !inXlsx.has(key(r)));

    expect(
      missing.map((r) => `${r.date} ${r.amountMinor} ${r.description}`),
      'transactions the PDF reader invented or misread'
    ).toEqual([]);
  });

  it('reads the credit column, not the balance beside it', () => {
    // The row that exposed the bug: a 15,000.00 transfer in, printed on a line
    // whose running balance was 16,840.00.
    const { parsed } = parseFile(PDF, 's.pdf');
    const transfer = parsed.rows.find(
      (r) => r.date === '2026-06-30' && /United Bank For Africa/i.test(r.description)
    );

    expect(transfer, 'the 30 Jun UBA transfer').toBeTruthy();
    expect(transfer!.amountMinor).toBe(1500000);
  });

  it('keeps a wrapped description whole and out of its neighbours', () => {
    const { parsed } = parseFile(PDF, 's.pdf');
    const wrapped = parsed.rows.find((r) => /ABDULLAH OLALEKAN ADIGUN/i.test(r.description));

    expect(wrapped, 'the transfer whose description wraps onto three lines').toBeTruthy();
    expect(wrapped!.description).toContain('OPay');
    // Its neighbour's text must not have leaked in.
    expect(wrapped!.description).not.toMatch(/Mobile Data|Stamp Duty/i);
    expect(wrapped!.amountMinor).toBe(-500000);
  });
});
