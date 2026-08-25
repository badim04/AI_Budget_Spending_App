/**
 * Report → rows, for CSV and Excel.
 *
 * Pure: builds arrays of arrays. `export.ts` writes them to disk. Keeping the
 * shaping here means CSV and Excel contain identical data and both agree with
 * the PDF, which all read from the same `Report`.
 *
 * Amounts are written as REAL NUMBERS in the decimal scale, not formatted
 * strings — a spreadsheet full of "₦1,234.50" text cannot be summed, which
 * defeats the point of exporting to a spreadsheet.
 */

import { toDecimal } from '../core/money';
import type { Report } from './build';

export interface Sheet {
  name: string;
  rows: (string | number | null)[][];
}

/** Every sheet in the workbook. The first is what a plain CSV export uses. */
export function reportToSheets(r: Report): Sheet[] {
  return [
    transactionsSheet(r),
    summarySheet(r),
    categoriesSheet(r),
    monthlySheet(r),
    budgetsSheet(r),
    merchantsSheet(r),
    forecastSheet(r),
  ];
}

function transactionsSheet(r: Report): Sheet {
  return {
    name: 'Transactions',
    rows: [
      ['Date', 'Merchant', 'Category', 'Account', `Amount (${r.currency})`, 'Type', 'Note', 'Source', 'Reviewed'],
      ...r.transactions.map((t) => [
        t.date,
        t.merchant,
        t.categoryName,
        t.accountName,
        toDecimal({ minor: t.amountMinor, currency: t.currency }),
        t.amountMinor >= 0 ? 'Income' : 'Expense',
        t.note ?? '',
        t.source,
        t.reviewed ? 'Yes' : 'No',
      ]),
    ],
  };
}

function summarySheet(r: Report): Sheet {
  return {
    name: 'Summary',
    rows: [
      ['Finlo report'],
      ['Period', r.subtitle],
      ['From', r.range.start],
      ['To', r.range.end],
      ['Currency', r.currency],
      ['Generated', r.generatedAt],
      [],
      ['Metric', 'Value', 'Note'],
      ...r.kpis.map((k) => [k.label, k.value, k.hint ?? '']),
      [],
      ['Total income', toDecimal(r.totals.income)],
      ['Total spend', toDecimal(r.totals.spend)],
      ['Net', toDecimal(r.totals.net)],
      ['Net worth (start)', toDecimal(r.totals.openingNetWorth)],
      ['Net worth (end)', toDecimal(r.totals.closingNetWorth)],
    ],
  };
}

function categoriesSheet(r: Report): Sheet {
  return {
    name: 'Categories',
    rows: [
      ['Category', `Amount (${r.currency})`, 'Share %', 'Transactions', 'Change vs previous %'],
      ...r.categories.map((c) => [
        c.categoryName,
        toDecimal(c.total),
        Math.round(c.share * 1000) / 10,
        c.transactionCount,
        c.changeVsPrevious == null ? '' : Math.round(c.changeVsPrevious * 1000) / 10,
      ]),
    ],
  };
}

function monthlySheet(r: Report): Sheet {
  return {
    name: 'Monthly',
    rows: [
      ['Month', `Income (${r.currency})`, `Spend (${r.currency})`, `Net (${r.currency})`],
      ...r.monthly.map((m) => [
        m.label,
        toDecimal(m.income),
        toDecimal(m.spend),
        toDecimal(m.net),
      ]),
    ],
  };
}

function budgetsSheet(r: Report): Sheet {
  return {
    name: 'Budgets',
    rows: [
      ['Budget', `Spent (${r.currency})`, `Allocated (${r.currency})`, `Remaining (${r.currency})`, 'Used %', 'Status'],
      ...r.budgets.map((b) => [
        b.budget.name,
        toDecimal(b.spent),
        toDecimal(b.effectiveAllocated),
        toDecimal(b.remaining),
        b.utilisation == null ? '' : Math.round(b.utilisation * 1000) / 10,
        b.state,
      ]),
    ],
  };
}

function merchantsSheet(r: Report): Sheet {
  return {
    name: 'Merchants',
    rows: [
      ['Merchant', 'Visits', `Total (${r.currency})`, `Average (${r.currency})`],
      ...r.merchants.map((m) => [
        m.merchant,
        m.count,
        toDecimal(m.total),
        Math.round((toDecimal(m.total) / Math.max(1, m.count)) * 100) / 100,
      ]),
    ],
  };
}

function forecastSheet(r: Report): Sheet {
  return {
    name: 'Forecast',
    rows: [
      ['Month', `Projected spend (${r.currency})`, 'Low', 'High'],
      ...r.forecast.map((p) => [
        p.date,
        toDecimal(p.value),
        toDecimal(p.lower),
        toDecimal(p.upper),
      ]),
      [],
      [r.forecastNote],
    ],
  };
}

// ---------------------------------------------------------------------- CSV

/**
 * RFC 4180 CSV.
 *
 * A field is quoted whenever it contains a comma, a quote, or a newline, and
 * inner quotes are doubled. Merchant names come from bank descriptors, which
 * absolutely do contain commas — skipping this corrupts the column layout.
 */
export function sheetToCsv(sheet: Sheet): string {
  return sheet.rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

function csvCell(value: string | number | null): string {
  if (value == null) return '';
  const s = String(value);
  // A leading =, +, - or @ makes Excel treat the cell as a formula. Prefixing
  // with a single quote keeps it as text, which is what a merchant name is.
  const risky = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(risky) ? `"${risky.replace(/"/g, '""')}"` : risky;
}

/** Multi-sheet CSV: sheets separated by a blank line and a title row, since a
 *  plain CSV file has no concept of tabs. */
export function reportToCsv(r: Report, allSheets = false): string {
  const sheets = reportToSheets(r);
  if (!allSheets) return sheetToCsv(sheets[0]);
  return sheets
    .map((s) => `# ${s.name}\r\n${sheetToCsv(s)}`)
    .join('\r\n\r\n');
}

/** A filename that sorts chronologically and cannot collide across periods. */
export function reportFilename(r: Report, extension: string): string {
  const slug = r.subtitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `finlo-${slug || 'report'}-${r.range.start}-to-${r.range.end}.${extension}`;
}
