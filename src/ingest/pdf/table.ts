/**
 * Turning PDF text runs into a real table.
 *
 * The first attempt at this stitched rows together in reading order: a line
 * beginning with a date started a record, and anything else was appended to
 * the end of it. That is wrong in a way that is worse than failing, because a
 * statement's description wraps and its amounts do not.
 *
 * A real row looks like this on the page:
 *
 *     30 Jun 2026 12:44:55  30 Jun 2026  [desc]  --  15,000.00  16,840.00
 *                                        Transfer from ADEBAYO ... | MOB/UTO
 *
 * The wrapped description arrives as its own line, so appending it produced a
 * row with one fewer cell in the middle and two extra at the end. Every column
 * after the description shifted left by one, and the parser read the **balance**
 * where the credit should be. It imported 16,840.00 for a 15,000.00 transfer —
 * a plausible-looking number, silently wrong, in a finance app.
 *
 * So use the geometry the PDF already gives us. Statement tables are laid out
 * on fixed left-aligned x positions — in the file this was built against, every
 * date starts at x=130.9, every description at x=177.9, every debit at x=303.8.
 * Cluster the x positions the data actually uses, and each text run drops into
 * the column it was printed in. A wrapped line then merges into the *column* it
 * belongs to rather than the end of the row, which is the whole fix.
 *
 * Anchors come from the rows below the header, never the header itself: a
 * heading like "Debit(₦)" is emitted as two runs at two x positions, and
 * treating that stray "(₦)" as a column boundary splits the amount column in
 * half.
 *
 * One statement can hold more than one table. A file covering a wallet and a
 * savings account prints two, and the second is laid out on its own x positions
 * — in the file this was built against, the description column moves from 177.9
 * to 195.4 and the debit column from 303.8 to 259.5. Anchors clustered across
 * both put every savings row one column to the right of where the header said
 * it was, the parser found an empty date cell, and all 58 of them were dropped
 * without a warning or an error. So each section is tabulated with its own
 * anchors.
 *
 * A repeated page header is not a new section. The two are told apart by the
 * only thing that actually distinguishes them: a page repeat sits on the same
 * x positions, a new section does not.
 *
 * Pure functions over extracted items: no React, no I/O, testable in Node.
 */

import type { TextItem } from './extract';

export interface PdfTable {
  /** Header cells, snapped to the same columns as the rows. */
  headers: string[];
  rows: string[][];
}

/* eslint-disable @typescript-eslint/no-shadow */

/** Items sharing a baseline, left to right — one visual line. */
interface Band {
  page: number;
  y: number;
  items: TextItem[];
}

export interface TabulateOptions {
  /** Two runs within this many units of each other are on the same line. */
  yTolerance?: number;
  /** x positions within this distance are the same column. */
  xTolerance?: number;
  /**
   * How many rows must share an x position before it counts as a column.
   * Guards against a one-off indent inventing a column.
   */
  minSupport?: number;
}

function toBands(items: TextItem[], yTolerance: number): Band[] {
  const sorted = [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const bands: Band[] = [];

  for (const item of sorted) {
    if (!item.text.trim()) continue;
    const last = bands[bands.length - 1];
    if (last && last.page === item.page && Math.abs(last.y - item.y) <= yTolerance) {
      last.items.push(item);
    } else {
      bands.push({ page: item.page, y: item.y, items: [item] });
    }
  }

  for (const band of bands) band.items.sort((a, b) => a.x - b.x);
  return bands;
}

/** Every run in the band as its own cell — enough to recognise a header. */
function loose(band: Band): string[] {
  return band.items.map((i) => i.text.trim()).filter(Boolean);
}

/**
 * The x positions the data is actually printed on.
 *
 * One pass of 1-D clustering. A cluster keeps the smallest x it has seen, so
 * an anchor sits at the true left edge of its column rather than drifting
 * right as it absorbs members.
 */
function columnAnchors(bands: Band[], xTolerance: number, minSupport: number): number[] {
  const clusters: { x: number; count: number }[] = [];

  for (const band of bands) {
    for (const item of band.items) {
      const hit = clusters.find((c) => Math.abs(c.x - item.x) <= xTolerance);
      if (hit) {
        hit.x = Math.min(hit.x, item.x);
        hit.count += 1;
      } else {
        clusters.push({ x: item.x, count: 1 });
      }
    }
  }

  return clusters
    .filter((c) => c.count >= minSupport)
    .map((c) => c.x)
    .sort((a, b) => a - b);
}

/** Drop each run into the column it was printed in. */
function toCells(band: Band, anchors: number[], xTolerance: number): string[] {
  const cells = anchors.map(() => '');

  for (const item of band.items) {
    const text = item.text.trim();
    if (!text) continue;

    // The last column starting at or before this run. A run that begins left
    // of every anchor belongs to the first column.
    let index = 0;
    for (let i = 0; i < anchors.length; i++) {
      if (item.x + xTolerance >= anchors[i]) index = i;
      else break;
    }

    cells[index] = cells[index] ? `${cells[index]} ${text}` : text;
  }

  return cells;
}

/** The x positions a band's runs sit on, rounded so a hairline nudge is equal. */
function xSignature(band: Band): number[] {
  return band.items.map((i) => i.x);
}

/** Same columns, so this header is a page repeat rather than a new section. */
function sameColumns(a: number[], b: number[], xTolerance: number): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => Math.abs(x - b[i]) <= xTolerance);
}

/**
 * Tabulate one section: its own header, its own anchors, its own rows.
 *
 * Split out of `tabulateSections` so the anchor clustering can never see runs
 * belonging to a differently-shaped table further down the file.
 */
function tabulateSection(
  header: Band,
  body: Band[],
  isHeader: (cells: string[]) => boolean,
  startsRow: (cells: string[]) => boolean,
  xTolerance: number,
  minSupport?: number
): PdfTable | null {
  if (body.length === 0) return null;

  const support = minSupport ?? Math.max(3, Math.floor(body.length * 0.02));
  const anchors = columnAnchors(body, xTolerance, support);
  if (anchors.length < 3) return null;

  const headers = toCells(header, anchors, xTolerance);

  interface Record {
    band: Band;
    cells: string[];
    above: { y: number; cells: string[] }[];
    below: { y: number; cells: string[] }[];
  }

  const records: Record[] = [];
  const strays: { band: Band; cells: string[] }[] = [];

  for (const band of body) {
    const cells = toCells(band, anchors, xTolerance);
    if (cells.every((c) => !c)) continue;
    // Banks repeat the header on every page. It is not a transaction.
    if (isHeader(loose(band))) continue;

    if (startsRow(cells)) records.push({ band, cells, above: [], below: [] });
    else strays.push({ band, cells });
  }

  if (records.length === 0) return null;

  /**
   * Attach each stray line to the transaction it is nearest to on the page.
   *
   * A long description is set as a multi-line cell centred on its row, so the
   * first line of it prints *above* the line carrying the date and the second
   * *below*. Reading order cannot tell those apart — proximity can. Ties go to
   * the row below, because that is the side the description leans.
   */
  for (const fragment of strays) {
    let best: Record | null = null;
    let bestDistance = Infinity;

    for (const record of records) {
      if (record.band.page !== fragment.band.page) continue;
      const distance = Math.abs(record.band.y - fragment.band.y);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = record;
      }
    }

    if (!best) continue;
    const side = fragment.band.y > best.band.y ? best.above : best.below;
    side.push({ y: fragment.band.y, cells: fragment.cells });
  }

  const rows = records.map((record) => {
    // Reading order down the page: what was printed higher comes first.
    record.above.sort((a, b) => b.y - a.y);
    record.below.sort((a, b) => b.y - a.y);

    return record.cells.map((cell, i) =>
      [
        ...record.above.map((f) => f.cells[i]),
        cell,
        ...record.below.map((f) => f.cells[i]),
      ]
        .filter(Boolean)
        .join(' ')
    );
  });

  return { headers, rows };
}

/**
 * Read every table in a statement PDF.
 *
 * `isHeader` decides which band is a header — the caller owns that, because
 * knowing that "Value Date" and "Description" make a statement is the
 * statement parser's business, not the PDF reader's.
 *
 * `startsRow` decides whether a band begins a new record or continues the last
 * one. Continuations merge column-wise, which is what keeps a wrapped
 * description out of the amount columns.
 *
 * Returns one table per account section, each with its own header row, in the
 * order they appear. Empty when no header can be found, so the caller can fall
 * back to reading order.
 */
export function tabulateSections(
  items: TextItem[],
  isHeader: (cells: string[]) => boolean,
  startsRow: (cells: string[]) => boolean,
  opts: TabulateOptions = {}
): PdfTable[] {
  const yTolerance = opts.yTolerance ?? 2;
  const xTolerance = opts.xTolerance ?? 3;

  const bands = toBands(items, yTolerance);
  if (bands.length === 0) return [];

  const headerIndices: number[] = [];
  bands.forEach((band, i) => {
    if (!isHeader(loose(band))) return;
    const last = headerIndices[headerIndices.length - 1];
    // A header on the same columns as the section already open is that
    // section's header printed again at the top of a page.
    if (last != null && sameColumns(xSignature(bands[last]), xSignature(band), xTolerance)) return;
    headerIndices.push(i);
  });

  if (headerIndices.length === 0) return [];

  const tables: PdfTable[] = [];
  headerIndices.forEach((start, n) => {
    const end = headerIndices[n + 1] ?? bands.length;
    const table = tabulateSection(
      bands[start],
      bands.slice(start + 1, end),
      isHeader,
      startsRow,
      xTolerance,
      opts.minSupport
    );
    if (table) tables.push(table);
  });

  return tables;
}
