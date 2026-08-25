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
import { existsSync, readFileSync } from 'node:fs';
import { extractPdfText, isPdf, parseCMap } from '@/ingest/pdf/extract';
import { readStatement, stitchPdfRows, decodeText, formatFromName } from '@/ingest/statement/sources';

const DOWNLOADS = 'C:/Users/user/Downloads';
const PDF = `${DOWNLOADS}/ABDULAKEEM OLADIMEJI ADEBAYO_8102579422_20260825195637.pdf`;
const XLSX_FILE = `${DOWNLOADS}/ABDULAKEEM OLADIMEJI ADEBAYO_8102579422_20260825200613.xlsx`;

const hasPdf = existsSync(PDF);
const hasXlsx = existsSync(XLSX_FILE);
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
  it('find a comparable number of transactions for the same account', () => {
    const fromPdf = readStatement(bytesOf(PDF), 's.pdf').rows.filter((r) =>
      /^\d{1,2}\s+\w{3}\s+\d{4}/.test(r[0] ?? '')
    ).length;
    const fromXlsx = readStatement(bytesOf(XLSX_FILE), 's.xlsx').rows.filter((r) =>
      /^\d{1,2}\s+\w{3}\s+\d{4}/.test(r[0] ?? '')
    ).length;

    // Same account and period exported twice: the counts should be close. They
    // are not identical because the PDF paginates and repeats headers.
    const ratio = Math.min(fromPdf, fromXlsx) / Math.max(fromPdf, fromXlsx);
    expect(ratio, `pdf=${fromPdf} xlsx=${fromXlsx}`).toBeGreaterThan(0.8);
  });
});
