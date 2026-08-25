/**
 * Turning a statement file into a grid of rows.
 *
 * The existing parser wants `string[][]`. Getting there differs wildly by
 * format, and this is where that mess lives so the parser stays clean:
 *
 *   CSV / TXT  — delimiter sniffing (comma, semicolon, tab, pipe).
 *   XLSX / XLS — SheetJS, every sheet concatenated. Banks split "Wallet" and
 *                "Savings" onto separate sheets and both matter.
 *   PDF        — text extraction, then wrapped rows stitched back together.
 *
 * The PDF path is the interesting one. A statement row is laid out as columns,
 * but a long description wraps, so one logical transaction can span three
 * visual lines with the amounts on the middle one:
 *
 *     Transfer to ABDULLAH OLALEKAN ADIGUN | OPay |      2606300101...
 *     30 Jun 2026 10:20:46  30 Jun 2026  5,000.00  --  1,840.00  Mobile
 *     8067436786 | chi                                   26
 *
 * A line that begins with a date is the anchor; everything between anchors is
 * description overflow belonging to the nearest one. Getting this wrong loses
 * the merchant name, which is exactly what categorisation runs on.
 */

import * as XLSX from 'xlsx';
import { extractPdfText, isPdf } from '../pdf/extract';
import { parseCsv } from './parse';

export type StatementFormat = 'csv' | 'xlsx' | 'pdf' | 'text' | 'unknown';

export interface StatementSource {
  format: StatementFormat;
  rows: string[][];
  /** Sheet or page names, for telling the user what was read. */
  sections: string[];
  encrypted: boolean;
  warning?: string;
}

/** Extensions the picker should offer, and what we can actually read. */
export const SUPPORTED_EXTENSIONS = ['pdf', 'csv', 'xlsx', 'xls', 'txt', 'tsv'] as const;

export const PICKER_MIME_TYPES = [
  'application/pdf',
  'text/csv',
  'text/comma-separated-values',
  'text/plain',
  'text/tab-separated-values',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

export function formatFromName(name: string): StatementFormat {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') return 'xlsx';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  if (ext === 'txt') return 'text';
  return 'unknown';
}

/**
 * Read any supported statement into rows.
 *
 * `bytes` is the raw file. Text formats are decoded here rather than by the
 * caller so that a UTF-8 BOM and UTF-16 (which Windows exports produce) are
 * handled in one place.
 */
export function readStatement(
  bytes: Uint8Array,
  filename: string,
  opts: { password?: string } = {}
): StatementSource {
  // Trust the bytes over the extension: a PDF saved as .txt is still a PDF.
  const format = isPdf(bytes) ? 'pdf' : looksLikeZip(bytes) ? 'xlsx' : formatFromName(filename);

  switch (format) {
    case 'pdf':
      return readPdf(bytes, opts.password);
    case 'xlsx':
      return readSpreadsheet(bytes);
    case 'csv':
    case 'text':
      return readDelimited(decodeText(bytes));
    default:
      // Last resort: if it decodes to something with delimiters, treat it as text.
      return readDelimited(decodeText(bytes));
  }
}

// ----------------------------------------------------------------------- PDF

function readPdf(bytes: Uint8Array, password?: string): StatementSource {
  const extracted = extractPdfText(bytes);

  if (extracted.encrypted) {
    return {
      format: 'pdf',
      rows: [],
      sections: [],
      encrypted: true,
      warning: password
        ? 'That password did not open the file. Check it and try again.'
        : 'This PDF is password protected. Enter its password to continue.',
    };
  }

  if (extracted.lines.length === 0) {
    return {
      format: 'pdf',
      rows: [],
      sections: [],
      encrypted: false,
      warning:
        extracted.warning ??
        'No text found in this PDF. If it is a scan, photograph the pages with Add › Snap a receipt instead.',
    };
  }

  return {
    format: 'pdf',
    rows: stitchPdfRows(extracted.lines),
    sections: [`${extracted.pageCount} page${extracted.pageCount === 1 ? '' : 's'}`],
    encrypted: false,
  };
}

/** A line that starts with a date is a new transaction; anything else is overflow. */
const ROW_ANCHOR =
  /^\s*(\d{1,2}[\s/-][A-Za-z]{3,9}[\s/-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/;

/**
 * Rebuild logical rows from wrapped visual lines.
 *
 * Overflow is appended to the anchor it belongs to. Fragments that appear
 * BEFORE the first anchor are held and attached to it, because PDF text order
 * puts a wrapped description above its own row as often as below.
 */
export function stitchPdfRows(lines: string[]): string[][] {
  const rows: string[][] = [];
  let current: string[] | null = null;
  let pending: string[] = [];

  const flush = () => {
    if (current) rows.push(current);
    current = null;
  };

  for (const line of lines) {
    const cells = line.split('\t').map((c) => c.trim()).filter(Boolean);
    if (cells.length === 0) continue;

    if (ROW_ANCHOR.test(cells[0])) {
      flush();
      // Pending fragments belong to this row's description.
      current = pending.length ? [...cells, ...pending] : cells;
      pending = [];
    } else if (current) {
      current.push(...cells);
    } else {
      // Header/preamble before the first transaction. Keep it as its own row so
      // header detection can still find a column layout, but also hold onto it
      // in case it is a wrapped description.
      rows.push(cells);
      pending = cells;
    }
  }
  flush();
  return rows;
}

// --------------------------------------------------------------- spreadsheet

function readSpreadsheet(bytes: Uint8Array): StatementSource {
  try {
    const book = XLSX.read(bytes, { type: 'array', cellDates: false, raw: false });
    const rows: string[][] = [];
    const sections: string[] = [];

    for (const name of book.SheetNames) {
      const sheet = book.Sheets[name];
      if (!sheet) continue;
      const grid = XLSX.utils.sheet_to_json<string[]>(sheet, {
        header: 1,
        raw: false,
        defval: '',
        blankrows: false,
      });
      if (grid.length === 0) continue;
      sections.push(name);
      // A sheet name is worth keeping: it is usually the account ("Wallet",
      // "Savings") and helps the user see that both were read.
      rows.push([`# ${name}`]);
      for (const row of grid) rows.push(row.map((c) => String(c ?? '').trim()));
    }

    if (rows.length === 0) {
      return { format: 'xlsx', rows: [], sections: [], encrypted: false, warning: 'The spreadsheet has no readable sheets.' };
    }
    return { format: 'xlsx', rows, sections, encrypted: false };
  } catch (e) {
    return {
      format: 'xlsx',
      rows: [],
      sections: [],
      encrypted: false,
      warning: `Could not read the spreadsheet: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

// -------------------------------------------------------------------- text

function readDelimited(text: string): StatementSource {
  const rows = parseCsv(text);
  return {
    format: 'csv',
    rows,
    sections: [],
    encrypted: false,
    warning: rows.length === 0 ? 'The file is empty.' : undefined,
  };
}

/** Decode bytes to text, honouring a BOM. Windows exports are often UTF-16. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(bytes);
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(bytes);
    }
  }
  const text = new TextDecoder('utf-8').decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksLikeZip(bytes: Uint8Array): boolean {
  // xlsx is a zip archive; xls (old BIFF) is not, and SheetJS handles both.
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}
