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
import { decodeText } from '../bytes';
import { extractPdfText, isPdf } from '../pdf/extract';
import { tabulateSections } from '../pdf/table';
import { detectColumns, looksLikeDate, parseCsv } from './parse';
import { findDeclaredTotals, type DeclaredSection } from './reconcile';
import type { CurrencyCode } from '../../core/money';

// Re-exported: callers reading a statement should not have to know that BOM
// sniffing lives one directory up.
export { decodeText };

export type StatementFormat = 'csv' | 'xlsx' | 'pdf' | 'text' | 'unknown';

export interface StatementSource {
  format: StatementFormat;
  rows: string[][];
  /** Sheet or page names, for telling the user what was read. */
  sections: string[];
  encrypted: boolean;
  warning?: string;
  /**
   * The totals the bank printed about itself, taken from the preamble before it
   * is sliced away. `reconcileStatement` checks the parse against these; see
   * `./reconcile.ts` for why that check exists.
   */
  declared: DeclaredSection[];
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
  opts: { password?: string; currency?: CurrencyCode } = {}
): StatementSource {
  const currency = opts.currency ?? 'NGN';
  // Trust the bytes over the extension: a PDF saved as .txt is still a PDF.
  const format = isPdf(bytes) ? 'pdf' : looksLikeZip(bytes) ? 'xlsx' : formatFromName(filename);

  switch (format) {
    case 'pdf':
      return readPdf(bytes, currency, opts.password);
    case 'xlsx':
      return readSpreadsheet(bytes, currency);
    case 'csv':
    case 'text':
      return readDelimited(decodeText(bytes), currency);
    default:
      // Last resort: if it decodes to something with delimiters, treat it as text.
      return readDelimited(decodeText(bytes), currency);
  }
}

// ----------------------------------------------------------------------- PDF

function readPdf(bytes: Uint8Array, currency: CurrencyCode, password?: string): StatementSource {
  const extracted = extractPdfText(bytes);

  if (extracted.encrypted) {
    return {
      format: 'pdf',
      rows: [],
      sections: [],
      declared: [],
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
      declared: [],
      encrypted: false,
      warning:
        extracted.warning ??
        'No text found in this PDF. If it is a scan, photograph the pages with Add › Snap a receipt instead.',
    };
  }

  const sections = [`${extracted.pageCount} page${extracted.pageCount === 1 ? '' : 's'}`];

  /**
   * Declared totals come from reading order, not geometry.
   *
   * The preamble is prose in a two-column block, not a table, so column
   * clustering has nothing to work with. `extracted.lines` already tab-separates
   * the runs on each baseline, which is exactly the shape the label/value reader
   * wants — and it is read here, before `tabulateSections` throws everything
   * that is not a transaction away.
   */
  const declared = findDeclaredTotals(
    extracted.lines.map((line) => line.split('\t').map((c) => c.trim())),
    currency
  );

  // Geometry first. Reading order only as a fallback, because it cannot tell a
  // wrapped description from a missing column — see `../pdf/table.ts`.
  const tables = tabulateSections(
    extracted.items,
    (cells) => detectColumns(cells) != null,
    (cells) => cells.some((c) => looksLikeDate(c))
  );

  if (tables.length > 0) {
    /**
     * Each section keeps its own header row.
     *
     * A wallet table and a savings table are laid out on different x positions,
     * so their columns land in different places. Emitting one flat grid with a
     * single header put every savings row one column right of where the header
     * said it was; `parseStatementGrid` found an empty date cell and dropped all
     * 58 of them without a problem entry. It re-reads the header whenever it
     * meets one, so the shape is allowed to change mid-file.
     */
    const rows: string[][] = [];
    for (const table of tables) rows.push(table.headers, ...table.rows);
    if (tables.length > 1) sections.push(`${tables.length} account sections`);

    return { format: 'pdf', rows, sections, declared, encrypted: false };
  }

  return {
    format: 'pdf',
    rows: stitchPdfRows(extracted.lines),
    sections,
    declared,
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

function readSpreadsheet(bytes: Uint8Array, currency: CurrencyCode): StatementSource {
  try {
    const book = XLSX.read(bytes, { type: 'array', cellDates: false, raw: false });
    for (const name of book.SheetNames) repairRange(book.Sheets[name]);
    const rows: string[][] = [];
    const sections: string[] = [];
    const declared: DeclaredSection[] = [];

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

      const cleaned = grid.map((row) => row.map((c) => String(c ?? '').trim()));

      // Every sheet opens with account name, address and period totals before
      // the table starts. Those are not failed transactions, so drop them here
      // rather than reporting six "unreadable date" problems per workbook. The
      // sheet name still reaches the user through `sections`.
      const header = cleaned.findIndex((row) => detectColumns(row) != null);

      // Read the preamble for what it is worth before discarding it: those
      // period totals are the only independent check on whether the rows below
      // them were read correctly.
      for (const section of findDeclaredTotals(
        header === -1 ? cleaned : cleaned.slice(0, header),
        currency
      )) {
        declared.push({ ...section, name: section.name || name });
      }

      for (const row of header === -1 ? cleaned : cleaned.slice(header)) rows.push(row);
    }

    if (rows.length === 0) {
      return {
        format: 'xlsx',
        rows: [],
        sections: [],
        declared: [],
        encrypted: false,
        warning: 'The spreadsheet has no readable sheets.',
      };
    }
    return { format: 'xlsx', rows, sections, declared, encrypted: false };
  } catch (e) {
    return {
      format: 'xlsx',
      rows: [],
      sections: [],
      declared: [],
      encrypted: false,
      warning: `Could not read the spreadsheet: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

// -------------------------------------------------------------------- text

function readDelimited(text: string, currency: CurrencyCode): StatementSource {
  const rows = parseCsv(text);
  const header = rows.findIndex((row) => detectColumns(row) != null);
  return {
    format: 'csv',
    rows,
    sections: [],
    // A CSV export usually starts at its header, but banks that prepend a
    // summary block print the same totals there as the PDF does.
    declared: header > 0 ? findDeclaredTotals(rows.slice(0, header), currency) : [],
    encrypted: false,
    warning: rows.length === 0 ? 'The file is empty.' : undefined,
  };
}

/**
 * Trust the cells, not the sheet's own idea of where they are.
 *
 * A sheet declares its used range in `!ref`, and exporters get it wrong. The
 * OPay export used to build this declared `A10:H178` while its header row sat
 * at A7 and two real transactions at A8 and A9 — so SheetJS handed back a grid
 * with no header and two transactions missing, and the import failed with
 * "Could not find a header row". Recomputing the range from the addressed
 * cells costs nothing and fixes it.
 */
function repairRange(sheet: XLSX.WorkSheet | undefined): void {
  if (!sheet) return;

  const addresses = Object.keys(sheet).filter((k) => !k.startsWith('!'));
  if (addresses.length === 0) return;

  let minR = Infinity;
  let minC = Infinity;
  let maxR = -Infinity;
  let maxC = -Infinity;

  for (const address of addresses) {
    const { r, c } = XLSX.utils.decode_cell(address);
    if (r < minR) minR = r;
    if (c < minC) minC = c;
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }

  if (!Number.isFinite(minR) || !Number.isFinite(minC)) return;

  sheet['!ref'] = XLSX.utils.encode_range({
    s: { r: minR, c: minC },
    e: { r: maxR, c: maxC },
  });
}

function looksLikeZip(bytes: Uint8Array): boolean {
  // xlsx is a zip archive; xls (old BIFF) is not, and SheetJS handles both.
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}
