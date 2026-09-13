/**
 * Bank statement import (CSV).
 *
 * Standing in for bank feeds until those earn their cost. You export a
 * statement from your bank's app or internet banking, hand it to Finlo, and it
 * reads the date range, maps the columns, categorises every row and dedupes
 * against what you already have.
 *
 * Every Nigerian and international bank exports a slightly different CSV, so
 * nothing here is hardcoded to one layout. Columns are detected by header name
 * with a scoring pass, and the two shapes banks actually use — a single signed
 * `Amount`, or separate `Debit`/`Credit` columns — are both handled.
 *
 * The parser is pure and total: it never throws on bad input, it returns rows
 * plus the problems it found, so the UI can show "312 rows, 4 skipped, here's
 * why" instead of failing on one malformed line.
 */

import { parseMoney, type CurrencyCode, type Money } from '../../core/money';
import { isValidISODate } from '../../core/dates';
import { extractDate } from '../receipt/parse';

export interface StatementRow {
  /** 1-based line number in the source file, for error messages. */
  line: number;
  date: string;
  description: string;
  /** Signed minor units: negative out, positive in. */
  amountMinor: number;
  balanceAfterMinor?: number;
  reference?: string;
}

export interface StatementProblem {
  line: number;
  reason: string;
  raw: string;
}

export interface ColumnMap {
  date: number;
  description: number;
  /** Single signed-amount column. */
  amount?: number;
  /** Or a debit/credit pair. */
  debit?: number;
  credit?: number;
  balance?: number;
  reference?: number;
}

export interface ParsedStatement {
  rows: StatementRow[];
  problems: StatementProblem[];
  columns: ColumnMap | null;
  headers: string[];
  currency: CurrencyCode;
  /** Range actually covered by the parsed rows. */
  from: string | null;
  to: string | null;
  /** Reversed to chronological order if the bank exported newest-first. */
  wasReversed: boolean;
}

// ------------------------------------------------------------------ CSV read

/**
 * RFC 4180-ish CSV reader.
 *
 * Written by hand rather than pulled from a package because statements contain
 * commas inside merchant names constantly ("SHOPRITE IKEJA, LAGOS") and a naive
 * `split(',')` shifts every later column — which silently reads the balance as
 * the amount. Quotes and escaped quotes have to be handled properly.
 */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const delim = delimiter ?? sniffDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  // Strip a UTF-8 BOM; Excel exports one and it corrupts the first header.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\r') {
      // handled by the \n branch
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Pick the delimiter by counting candidates on the most populated line. */
function sniffDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 20).join('\n');
  const counts: Array<[string, number]> = [',', ';', '\t', '|'].map((d) => [
    d,
    (sample.match(new RegExp(`\\${d}`, 'g')) ?? []).length,
  ]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

// -------------------------------------------------------------- column detect

/**
 * Header synonyms, English first and then the languages a statement is most
 * likely to arrive in from a non-English bank. Without these a French or German
 * export fails header detection entirely and imports nothing — the column
 * layout is fine, the app just could not find where it started. Accents are
 * matched where a bank writes them (`Débit`, `Libellé`) and also without, since
 * exports vary.
 */
const HEADER_PATTERNS: Record<keyof ColumnMap, RegExp[]> = {
  date: [
    /^(transaction|value|posting|trans|entry|booking)?\.?\s*date/i,
    /^date$/i,
    /^dt$/i,
    // fr/pt "date", de "Datum"/"Buchungstag", es/pt "fecha"/"data"
    /^datum$/i,
    /^buchungstag$/i,
    /^fecha$/i,
    /^data$/i,
  ],
  description: [
    /^(transaction\s*)?(description|details|narration|particulars|remarks?|memo|reference\s*text)/i,
    /^narrative$/i,
    /^payee$/i,
    // fr "libellé"/"motif", de "Verwendungszweck"/"Buchungstext", es "concepto"/"descripción",
    // pt "descrição"/"histórico"
    /^libell[ée]/i,
    /^motif$/i,
    /^verwendungszweck$/i,
    /^buchungstext$/i,
    /^beschreibung$/i,
    /^concepto$/i,
    /^descrip/i,
    /^descri[çc][ãa]o$/i,
    /^hist[óo]rico$/i,
  ],
  amount: [
    /^amount$/i,
    /^value$/i,
    /^transaction\s*amount$/i,
    /^amt$/i,
    // fr "montant", de "Betrag"/"Umsatz", es "importe"/"monto", pt "valor"/"montante"
    /^montant$/i,
    /^betrag$/i,
    /^umsatz$/i,
    /^importe$/i,
    /^monto$/i,
    /^valor$/i,
    /^montante$/i,
  ],
  debit: [
    /^debit/i,
    /^withdrawal/i,
    /^money\s*out/i,
    /^paid\s*out/i,
    /^dr\b/i,
    // fr "débit", de "Soll", es "cargo"/"débito", pt "débito"
    /^d[ée]bit/i,
    /^soll$/i,
    /^cargo$/i,
    /^d[ée]bito$/i,
  ],
  credit: [
    /^credit/i,
    /^deposit/i,
    /^money\s*in/i,
    /^paid\s*in/i,
    /^cr\b/i,
    // fr "crédit", de "Haben", es "abono"/"crédito", pt "crédito"
    /^cr[ée]dit/i,
    /^haben$/i,
    /^abono$/i,
    /^cr[ée]dito$/i,
  ],
  balance: [/balance/i, /^bal$/i, /^saldo$/i, /^solde$/i, /^kontostand$/i],
  reference: [/^(ref|reference|transaction\s*(id|ref)|txn\s*id|cheque)/i],
};

export function detectColumns(headers: string[]): ColumnMap | null {
  const clean = headers.map((h) => h.trim());
  const find = (key: keyof ColumnMap): number | undefined => {
    for (const pattern of HEADER_PATTERNS[key]) {
      const i = clean.findIndex((h) => pattern.test(h));
      if (i !== -1) return i;
    }
    return undefined;
  };

  const date = find('date');
  const description = find('description');
  if (date == null || description == null) return null;

  const debit = find('debit');
  const credit = find('credit');
  let amount = find('amount');
  // "Amount" alongside Debit/Credit is usually an unsigned magnitude; the
  // debit/credit pair carries the direction, so prefer it.
  if (debit != null && credit != null) amount = undefined;
  if (amount == null && debit == null && credit == null) return null;

  return {
    date,
    description,
    amount,
    debit,
    credit,
    balance: find('balance'),
    reference: find('reference'),
  };
}

/** Find the header row — banks often prepend account details and blank lines. */
export function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    if (detectColumns(rows[i])) return i;
  }
  return -1;
}

// -------------------------------------------------------------------- parse

export function parseStatement(
  text: string,
  opts: { currency: CurrencyCode; today?: string }
): ParsedStatement {
  return parseStatementGrid(parseCsv(text), opts);
}

/**
 * Parse an already-tabulated statement.
 *
 * PDF and Excel arrive as rows rather than delimited text, so they enter here
 * instead of going through the CSV splitter. Everything downstream — header
 * detection, column mapping, row parsing — is shared, so a PDF import and a CSV
 * import of the same statement produce the same transactions.
 */
export function parseStatementGrid(
  grid: string[][],
  opts: { currency: CurrencyCode; today?: string }
): ParsedStatement {
  const problems: StatementProblem[] = [];

  if (grid.length === 0) {
    return blank(opts.currency, problems, 'The file is empty');
  }

  const headerIndex = findHeaderRow(grid);
  if (headerIndex === -1) {
    return blank(
      opts.currency,
      problems,
      'Could not find a header row with a date and a description column'
    );
  }

  const headers = grid[headerIndex].map((h) => h.trim());
  const rows: StatementRow[] = [];

  // Which way round are the numeric dates? A single "13/04" settles it for the
  // whole file (13 can only be a day), so one confident cell saves every
  // ambiguous one from defaulting to the wrong order and silently misdating
  // transactions into the wrong month — an error the reconciler cannot catch,
  // because moving a row between months does not change any total.
  const dateOrder = detectDateOrder(grid);

  /**
   * The shape is allowed to change part-way down the file.
   *
   * A workbook puts its wallet and its savings on separate sheets and a PDF
   * prints them as separate tables, and the two do not have to share a column
   * layout — in the statement this was built against, savings sits one column
   * to the right of wallet. Skipping a repeated header and carrying the first
   * layout onwards read every savings row's date cell as empty, and the
   * `if (!dateCell) continue` below dropped all 58 of them without so much as a
   * problem entry. Re-reading the header costs one `detectColumns` call per row
   * and makes a multi-account statement import correctly.
   *
   * A transaction row cannot be mistaken for a header: `detectColumns` needs a
   * cell naming a date column and a cell naming a description column, and a row
   * of dates and amounts has neither.
   */
  let columns = detectColumns(headers)!;

  for (let i = headerIndex + 1; i < grid.length; i++) {
    const cells = grid[i];
    const lineNo = i + 1;
    const raw = cells.join(' | ');

    const nextLayout = detectColumns(cells.map((c) => c.trim()));
    if (nextLayout) {
      columns = nextLayout;
      continue;
    }

    const dateCell = (cells[columns.date] ?? '').trim();
    if (!dateCell) continue; // trailing totals row, or a blank separator

    const date = normaliseDate(dateCell, opts.today, dateOrder);
    if (!date) {
      problems.push({ line: lineNo, reason: `Unreadable date "${dateCell}"`, raw });
      continue;
    }

    const amountMinor = readAmount(cells, columns, opts.currency);
    if (amountMinor == null) {
      problems.push({ line: lineNo, reason: 'No readable amount', raw });
      continue;
    }
    if (amountMinor === 0) continue; // zero-value rows are statement noise

    const description = (cells[columns.description] ?? '').trim();
    if (!description) {
      problems.push({ line: lineNo, reason: 'No description', raw });
      continue;
    }

    rows.push({
      line: lineNo,
      date,
      description,
      amountMinor,
      balanceAfterMinor:
        columns.balance != null
          ? parseMoney(cells[columns.balance] ?? '', opts.currency)?.minor
          : undefined,
      reference:
        columns.reference != null ? (cells[columns.reference] ?? '').trim() || undefined : undefined,
    });
  }

  // Most banks export newest-first. Sorting ascending makes running balances
  // and date ranges behave, and makes the review list read like a timeline.
  const wasReversed =
    rows.length > 1 && rows[0].date > rows[rows.length - 1].date;
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.line - b.line);

  return {
    rows,
    problems,
    columns,
    headers,
    currency: opts.currency,
    from: rows[0]?.date ?? null,
    to: rows[rows.length - 1]?.date ?? null,
    wasReversed,
  };
}

function blank(
  currency: CurrencyCode,
  problems: StatementProblem[],
  reason: string
): ParsedStatement {
  problems.push({ line: 0, reason, raw: '' });
  return {
    rows: [],
    problems,
    columns: null,
    headers: [],
    currency,
    from: null,
    to: null,
    wasReversed: false,
  };
}

/**
 * Read the signed amount from whichever shape the bank used.
 *
 * Debit columns are usually positive magnitudes ("5,000.00" meaning money out),
 * so a debit is negated. A debit column that already carries a minus sign is
 * left alone rather than double-negated into an inflow.
 */
function readAmount(
  cells: string[],
  columns: ColumnMap,
  currency: CurrencyCode
): number | null {
  if (columns.debit != null || columns.credit != null) {
    const debitRaw = (cells[columns.debit ?? -1] ?? '').trim();
    const creditRaw = (cells[columns.credit ?? -1] ?? '').trim();

    const debit = debitRaw ? parseMoney(debitRaw, currency)?.minor ?? 0 : 0;
    const credit = creditRaw ? parseMoney(creditRaw, currency)?.minor ?? 0 : 0;

    if (debit !== 0) return debit > 0 ? -debit : debit;
    if (credit !== 0) return Math.abs(credit);
    return null;
  }

  if (columns.amount == null) return null;
  const cell = (cells[columns.amount] ?? '').trim();
  if (!cell) return null;

  const parsed = parseMoney(cell, currency);
  if (!parsed) return null;

  // Some exports mark direction with a trailing CR/DR instead of a sign.
  if (/\bCR\b/i.test(cell)) return Math.abs(parsed.minor);
  if (/\bDR\b/i.test(cell)) return -Math.abs(parsed.minor);
  return parsed.minor;
}

/**
 * Does this cell look like a date?
 *
 * Used by the PDF reader to tell a new transaction from the wrapped remainder
 * of the last one, so it has to be cheap and it has to say no to a bare amount.
 */
export function looksLikeDate(cell: string): boolean {
  return normaliseDate(cell) != null;
}

/** Accepts ISO, d/m/y, m/d/y and written months, resolving ambiguity the same
 *  way the receipt parser does — a statement records the past. `order` carries
 *  the file-level decision for genuinely ambiguous numeric dates. */
function normaliseDate(
  cell: string,
  today?: string,
  order: 'dmy' | 'mdy' = 'dmy'
): string | null {
  const trimmed = cell.trim();
  if (isValidISODate(trimmed)) return trimmed;
  // Strip any time component before handing it over.
  return extractDate(trimmed.replace(/\d{1,2}:\d{2}(:\d{2})?/, ''), today, order);
}

/**
 * Decide day-first vs month-first from the file's own evidence.
 *
 * Scans every cell for a numeric date and looks for a component that can only
 * be a day (> 12). If any such date points to day-first and none to month-first
 * (or vice versa), that order is used for the whole file. Mixed or absent
 * evidence returns day-first, the safe global default. Layout-independent by
 * design: it reads every cell rather than trusting a column index that can move
 * part-way down a multi-account statement.
 */
export function detectDateOrder(grid: string[][]): 'dmy' | 'mdy' {
  const NUMERIC = /^\s*(\d{1,2})[\/.\-](\d{1,2})[\/.\-]\d{2,4}\s*$/;
  let dmy = 0;
  let mdy = 0;
  for (const row of grid) {
    for (const cell of row) {
      const m = NUMERIC.exec(cell ?? '');
      if (!m) continue;
      const a = +m[1];
      const b = +m[2];
      if (a > 12 && b <= 12) dmy += 1; // first field must be the day
      else if (b > 12 && a <= 12) mdy += 1; // second field must be the day
    }
  }
  // Only override the default when the evidence is one-sided. A file that shows
  // both is malformed or mixed, and guessing there would be the very error this
  // is meant to prevent.
  if (mdy > 0 && dmy === 0) return 'mdy';
  return 'dmy';
}

// ------------------------------------------------------------------ filtering

/** Restrict to a date window — "import only since my last statement". */
export function withinRange(
  rows: StatementRow[],
  from?: string | null,
  to?: string | null
): StatementRow[] {
  return rows.filter((r) => (!from || r.date >= from) && (!to || r.date <= to));
}

/** A quick summary for the confirm screen, so nobody imports blind. */
export function summarise(
  rows: StatementRow[]
): { count: number; inflowMinor: number; outflowMinor: number; from: string | null; to: string | null } {
  let inflowMinor = 0;
  let outflowMinor = 0;
  for (const r of rows) {
    if (r.amountMinor > 0) inflowMinor += r.amountMinor;
    else outflowMinor += -r.amountMinor;
  }
  return {
    count: rows.length,
    inflowMinor,
    outflowMinor,
    from: rows[0]?.date ?? null,
    to: rows[rows.length - 1]?.date ?? null,
  };
}
