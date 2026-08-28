/**
 * Checking a parsed statement against the totals the bank printed on it.
 *
 * Every failure this importer has had was silent. A wrapped description shifted
 * a column and a 15,000.00 transfer imported as 16,840.00 — the running balance
 * printed beside it. A second account section sat on different x positions and
 * 58 transactions were dropped without so much as a warning. Nothing threw,
 * nothing logged, and the numbers that appeared looked exactly like numbers
 * that belong on a bank statement.
 *
 * The reason those were findable at all is that the bank prints its own
 * arithmetic in the file's preamble:
 *
 *     Opening Balance   Total Debit    Debit Count
 *     ₦ 7,800.00        ₦ 695,294.73   126
 *     Closing Balance   Total Credit   Credit Count
 *     ₦ 1,026.00        ₦ 688,520.73   45
 *
 * That is ground truth written by the institution that moved the money, and it
 * costs nothing to read. If our sum of the rows disagrees with it, we misread
 * the file — and the right response to "I misread your financial history" is to
 * stop, not to write 171 plausible rows and hope.
 *
 * Two design points carry the weight:
 *
 * **The declaration is checked before it is trusted.** A section's own figures
 * must satisfy `opening + credit - debit = closing`. If they do not, the
 * preamble was misparsed, not the rows, and that section is excluded from the
 * verdict rather than being allowed to block a good import. Giving this module
 * a veto without that guard would just move the silent failure somewhere new.
 *
 * **Zero tolerance.** Money is integer minor units on both sides and the bank's
 * totals are exact. A "close enough" threshold here would be a threshold on how
 * wrong someone's financial history is allowed to be.
 *
 * Pure: no React, no I/O, no clock.
 */

import { parseMoney, type CurrencyCode } from '../../core/money';
import type { StatementRow } from './parse';

/** The figures one account section of a statement declares about itself. */
export interface DeclaredSection {
  /** "Wallet Account", a sheet name, or a positional fallback. */
  name: string;
  openingMinor?: number;
  closingMinor?: number;
  debitMinor?: number;
  creditMinor?: number;
  debitCount?: number;
  creditCount?: number;
}

export type ReconcileStatus =
  /** Every figure the bank printed matches what we read. */
  | 'ok'
  /** At least one does not. The import must not proceed quietly. */
  | 'mismatch'
  /** The file declared nothing checkable. Not a failure, just no evidence. */
  | 'unchecked';

export interface ReconcileCheck {
  label: string;
  kind: 'money' | 'count';
  declared: number;
  actual: number;
  /** actual - declared. Signed, so the UI can say "12 short". */
  delta: number;
  ok: boolean;
}

export interface Reconciliation {
  status: ReconcileStatus;
  checks: ReconcileCheck[];
  /** Sections that were read and used. */
  sections: DeclaredSection[];
  /**
   * Sections whose own figures did not add up, so they were left out of the
   * verdict. Named so the user can see we chose not to trust ourselves.
   */
  unreadable: string[];
  /** One sentence, in the app's voice, for the screen to show. */
  summary: string;
}

// ------------------------------------------------------------------- reading

/**
 * Labels banks use for the six figures worth checking.
 *
 * Anchored at the start and matched against a trimmed cell, so "Total Debit"
 * cannot be found inside a description that happens to contain the words.
 */
const LABELS: Array<{ key: FigureKey; kind: 'money' | 'count'; pattern: RegExp }> = [
  { key: 'openingMinor', kind: 'money', pattern: /^opening\s*(balance)?$/i },
  { key: 'closingMinor', kind: 'money', pattern: /^closing\s*(balance)?$/i },
  { key: 'debitMinor', kind: 'money', pattern: /^total\s*(debits?|withdrawals?|money\s*out)$/i },
  { key: 'creditMinor', kind: 'money', pattern: /^total\s*(credits?|deposits?|money\s*in)$/i },
  { key: 'debitCount', kind: 'count', pattern: /^(debit|withdrawal)s?\s*count$/i },
  { key: 'creditCount', kind: 'count', pattern: /^(credit|deposit)s?\s*count$/i },
];

/** A cell that names the account a section belongs to. */
const SECTION_NAME = [
  /^(.+?)\s+account\s+statement$/i,
  /^(.+?)\s+account$/i,
];

function labelFor(cell: string) {
  const trimmed = cell.trim();
  if (!trimmed) return null;
  return LABELS.find((l) => l.pattern.test(trimmed)) ?? null;
}

/**
 * Is this cell a value rather than decoration?
 *
 * The PDF prints the currency symbol as its own text run, so a value row reads
 * `["₦", "7,800.00", "₦", "695,294.73", "126"]`. Those bare symbols have to be
 * dropped before values are matched to labels positionally, or every figure
 * lands one label to the left.
 */
function isValueCell(cell: string): boolean {
  const trimmed = cell.trim();
  if (!trimmed) return false;
  return /\d/.test(trimmed);
}

function readCount(cell: string): number | undefined {
  const digits = cell.replace(/[^\d]/g, '');
  if (!digits) return undefined;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : undefined;
}

function readMoney(cell: string, currency: CurrencyCode): number | undefined {
  const parsed = parseMoney(cell, currency);
  return parsed ? Math.abs(parsed.minor) : undefined;
}

/** The five numeric fields. `name` is set elsewhere and is not assignable here. */
type FigureKey = Exclude<keyof DeclaredSection, 'name'>;

function assign(
  section: DeclaredSection,
  key: FigureKey,
  kind: 'money' | 'count',
  cell: string,
  currency: CurrencyCode
): void {
  const value = kind === 'money' ? readMoney(cell, currency) : readCount(cell);
  if (value == null) return;
  // The first declaration wins. A statement that repeats its preamble on every
  // page must not have the figure overwritten by a later partial read.
  if (section[key] == null) section[key] = value;
}

/**
 * Pull every declared section out of a raw statement grid.
 *
 * Banks lay the preamble out in two ways and both are common:
 *
 *   inline   `Opening Balance | ₦7,800.00 | Total Debit | ₦695,294.73 | ...`
 *   stacked  `Opening Balance | Total Debit | Debit Count`
 *            `₦ | 7,800.00 | ₦ | 695,294.73 | 126`
 *
 * Inline is tried per label first. A label with nothing usable after it on its
 * own row falls through to the stacked reading, where the nth value on the next
 * row belongs to the nth label on this one.
 *
 * `grid` must be the RAW rows, before the header slice — the whole point is the
 * material the transaction parser throws away.
 */
export function findDeclaredTotals(
  grid: string[][],
  currency: CurrencyCode
): DeclaredSection[] {
  const sections: DeclaredSection[] = [];
  let current: DeclaredSection | null = null;

  const ensure = (): DeclaredSection => {
    if (!current) {
      current = { name: `Section ${sections.length + 1}` };
      sections.push(current);
    }
    return current;
  };

  for (let i = 0; i < grid.length; i++) {
    const cells = (grid[i] ?? []).map((c) => (c ?? '').trim());
    if (cells.every((c) => !c)) continue;

    // A row carrying transaction-shaped data ends the preamble for this
    // section; anything matching a label after that is a coincidence.
    const labelled = cells
      .map((cell, index) => ({ index, label: labelFor(cell) }))
      .filter((x) => x.label != null) as Array<{
      index: number;
      label: NonNullable<ReturnType<typeof labelFor>>;
    }>;

    if (labelled.length === 0) {
      // Section boundary? Take the name and start a fresh section, but only
      // when the current one already has figures — otherwise a title page and
      // its own preamble would land in two different sections.
      for (const cell of cells) {
        const name = sectionName(cell);
        if (!name) continue;
        if (!current || hasFigures(current)) {
          current = { name };
          sections.push(current);
        } else {
          current.name = name;
        }
        break;
      }
      continue;
    }

    const section = ensure();
    const pending: typeof labelled = [];

    for (const { index, label } of labelled) {
      // Inline: the first value cell after the label, before the next label.
      const stop = labelled.find((l) => l.index > index)?.index ?? cells.length;
      const valueIndex = cells.findIndex(
        (cell, j) => j > index && j < stop && isValueCell(cell)
      );
      if (valueIndex !== -1) assign(section, label.key, label.kind, cells[valueIndex], currency);
      else pending.push({ index, label });
    }

    if (pending.length === 0) continue;

    // Stacked: the value row is the next non-empty row, positionally matched.
    const next = (grid[i + 1] ?? []).map((c) => (c ?? '').trim()).filter(isValueCell);
    if (next.length !== pending.length) continue;
    pending.forEach(({ label }, n) => assign(section, label.key, label.kind, next[n], currency));
  }

  return sections.filter(hasFigures);
}

function sectionName(cell: string): string | null {
  for (const pattern of SECTION_NAME) {
    const m = pattern.exec(cell.trim());
    // "Savings Account Statement" -> "Savings Account". Two words at most, so a
    // description that ends in "... account" cannot pass for a section title.
    if (m && m[1] && m[1].split(/\s+/).length <= 3) return `${m[1]} Account`;
  }
  return null;
}

function hasFigures(section: DeclaredSection): boolean {
  return (
    section.debitMinor != null ||
    section.creditMinor != null ||
    section.debitCount != null ||
    section.creditCount != null
  );
}

/**
 * Does a section's own arithmetic hold?
 *
 * `opening + credit - debit = closing` is an identity the bank must satisfy. If
 * the four figures we read do not satisfy it, we misread at least one of them,
 * and a figure we misread has no business blocking an import. Sections missing
 * any of the four are accepted — there is nothing to contradict.
 */
export function sectionIsSelfConsistent(section: DeclaredSection): boolean {
  const { openingMinor, closingMinor, debitMinor, creditMinor } = section;
  if (
    openingMinor == null ||
    closingMinor == null ||
    debitMinor == null ||
    creditMinor == null
  ) {
    return true;
  }
  return openingMinor + creditMinor - debitMinor === closingMinor;
}

// --------------------------------------------------------------- reconciling

/**
 * Compare what the bank declared with what we read.
 *
 * Sections are summed rather than matched to rows one for one: the parser
 * produces a single flat list and the bank's totals add up across sections, so
 * the aggregate is the comparison the evidence actually supports. It is also
 * the one that catches a whole missing section, which is the failure that
 * prompted this.
 */
export function reconcileStatement(
  declared: DeclaredSection[],
  rows: StatementRow[]
): Reconciliation {
  const unreadable = declared.filter((s) => !sectionIsSelfConsistent(s)).map((s) => s.name);
  const usable = declared.filter(sectionIsSelfConsistent);

  let actualIn = 0;
  let actualOut = 0;
  let actualInCount = 0;
  let actualOutCount = 0;
  for (const row of rows) {
    if (row.amountMinor > 0) {
      actualIn += row.amountMinor;
      actualInCount += 1;
    } else if (row.amountMinor < 0) {
      actualOut += -row.amountMinor;
      actualOutCount += 1;
    }
  }

  const sum = (pick: (s: DeclaredSection) => number | undefined): number | null => {
    const values = usable.map(pick).filter((v): v is number => v != null);
    return values.length === usable.length && values.length > 0
      ? values.reduce((a, b) => a + b, 0)
      : null;
  };

  const checks: ReconcileCheck[] = [];
  const add = (
    label: string,
    kind: 'money' | 'count',
    declaredTotal: number | null,
    actual: number
  ) => {
    if (declaredTotal == null) return;
    checks.push({
      label,
      kind,
      declared: declaredTotal,
      actual,
      delta: actual - declaredTotal,
      ok: actual === declaredTotal,
    });
  };

  add('Money out', 'money', sum((s) => s.debitMinor), actualOut);
  add('Money in', 'money', sum((s) => s.creditMinor), actualIn);
  add('Payments out', 'count', sum((s) => s.debitCount), actualOutCount);
  add('Payments in', 'count', sum((s) => s.creditCount), actualInCount);

  const status: ReconcileStatus =
    checks.length === 0 ? 'unchecked' : checks.every((x) => x.ok) ? 'ok' : 'mismatch';

  return {
    status,
    checks,
    sections: usable,
    unreadable,
    summary: describe(status, checks, usable, unreadable),
  };
}

/**
 * Say what happened in one sentence.
 *
 * A mismatch names one disagreement rather than listing all four. "Four figures
 * disagree" tells someone nothing they can act on; "the statement lists 101
 * payments in, and 56 could not be read" tells them the file did not read
 * fully.
 *
 * Which one to name is not a matter of size. A count and an amount are not on
 * one scale — sorting all four by absolute delta ranks a ₦14.73 discrepancy
 * above 56 missing transactions, because minor units are large numbers and row
 * counts are small ones. A failing count is also the more diagnostic of the
 * two: it says rows are missing or doubled, where a money delta alone could be
 * a single misread digit. So counts are named first, and amounts only when
 * every count agreed.
 */
function describe(
  status: ReconcileStatus,
  checks: ReconcileCheck[],
  sections: DeclaredSection[],
  unreadable: string[]
): string {
  if (status === 'unchecked') {
    return unreadable.length > 0
      ? "This statement's own totals did not add up, so there was nothing to check the import against."
      : 'This statement does not print its own totals, so there was nothing to check the import against.';
  }

  const where =
    sections.length > 1
      ? `${sections.length} sections (${sections.map((s) => s.name).join(', ')})`
      : (sections[0]?.name ?? 'this statement');

  if (status === 'ok') {
    const counted = checks.filter((x) => x.kind === 'count').length > 0;
    return counted
      ? `Every total and count ${sections.length > 1 ? 'across' : 'on'} ${where} matches what was read.`
      : `The totals printed on ${where} match what was read.`;
  }

  const failed = checks.filter((x) => !x.ok);
  const byDelta = (a: ReconcileCheck, b: ReconcileCheck) =>
    Math.abs(b.delta) - Math.abs(a.delta);
  const worst =
    failed.filter((x) => x.kind === 'count').sort(byDelta)[0] ?? failed.sort(byDelta)[0];

  const short = worst.delta < 0;
  const size = Math.abs(worst.delta);

  if (worst.kind === 'count') {
    return `The statement lists ${worst.declared} ${worst.label.toLowerCase()}, and ${size} ${
      short ? 'could not be read' : 'more than that were read'
    }.`;
  }

  return `${worst.label} does not match the total printed on the statement — ${
    short ? 'short by' : 'over by'
  } ${(size / 100).toFixed(2)}.`;
}
