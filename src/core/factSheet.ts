/**
 * The brief handed to the model when you ask it a question about your money.
 *
 * Three decisions shape this file, and the first two are the whole reason it
 * exists rather than the question being sent with a pile of raw transactions.
 *
 * **1. The model never does arithmetic.**
 * Every figure here is computed by `core/analytics`, `core/budget` and
 * `core/forecast` — the same tested functions the screens read. The model is
 * given the answers and asked to phrase them. A language model asked to total a
 * column will produce a number that looks like a total, and there is no way to
 * tell from the output whether it added correctly. In an app whose entire
 * argument is that the numbers are right, that is not a trade worth making.
 *
 * **2. Nothing identifying goes to Google.**
 * A Nigerian statement descriptor reads `Transfer to RASHIDAT BASHIRU | OPay |
 * 7046464337 | milk` — a third party's full name and account number, for
 * someone who never agreed to anything. Sending that to a model provider to
 * answer "how much did I spend on food" would be leaking other people's data to
 * answer a question about your own. So the sheet carries aggregates, category
 * names and *tidied* merchant names, and `redact` strips anything that looks
 * like an account number, phone number or long digit run before a single line
 * leaves the device.
 *
 * **3. It is small, and it says what it does not know.**
 * A brief that dumps everything costs tokens, buries the relevant line, and
 * makes the model likelier to answer from the wrong part of it. Sections that
 * have no data say so explicitly, so the model can say "you have no budgets
 * set" rather than inventing one.
 *
 * Pure: no React, no I/O, no network, no clock of its own.
 */

import type { BudgetStatus, Goal, ISODate, Transaction } from './types';
import {
  categoryTotals,
  comparePeriods,
  netWorth,
  runwayMonths,
  savingsRate,
  topMerchants,
  totalIncome,
  totalSpend,
  type AnalyticsContext,
} from './analytics';
import { monthOf, previousMonth } from './periods';
import { formatMoney } from './money';
import { formatDate } from './dates';
import { readCounterparty } from './counterparty';

/**
 * Strip anything that identifies a person or an account.
 *
 * Deliberately aggressive: a false positive costs the model a little context,
 * and a false negative sends someone's account number to a third party. Runs
 * over every string that goes into the sheet, not just the ones expected to
 * need it, because the expectation is what fails.
 */
export function redact(text: string): string {
  return (
    text
      // Account and phone numbers: any run of 7+ digits, masked or not.
      .replace(/\b[\d*x]{7,}\b/gi, '[account]')
      // Masked forms banks print: 211****578
      .replace(/\b\d{2,4}\*{2,}\d{2,4}\b/g, '[account]')
      // Long reference strings: mixed alphanumerics with no vowels to speak of.
      .replace(/\b[A-Z0-9]{12,}\b/g, '[ref]')
      .replace(/\s{2,}/g, ' ')
      .trim()
  );
}

/**
 * Is this counterparty a person rather than a business?
 *
 * The first version guessed from the shape of the name — two or three
 * capitalised words with no company suffix — and a test immediately caught it
 * calling "Ikeja Electric" a person. That is the wrong kind of wrong twice
 * over: the utility bill stops being nameable in an answer, and the heuristic
 * that produced it would keep needing new exceptions forever.
 *
 * `readCounterparty` already answers this structurally. A peer transfer is
 * printed as `Transfer to NAME | BANK | ACCOUNT | note`, and that shape — not
 * the spelling of the name — is what says a human is on the other end. It is
 * already tested in `tests/counterparty.test.ts` and used by the review queue.
 *
 * The name-shape check stays only as a fallback for banks that print a bare
 * name with no descriptor around it, and it errs toward withholding: a false
 * positive costs an answer some detail, a false negative hands someone else's
 * identity to a model provider.
 */
const COMPANY_HINT =
  /\b(ltd|limited|plc|inc|llc|enterprises?|ventures?|stores?|shop|supermarket|market|bank|mfb|microfinance|telecom|electric|electricity|power|energy|water|gas|cable|media|network|data|services?|group|company|holdings|foods?|restaurant|kitchen|cafe|hotel|pharmacy|hospital|clinic|school|academy|university|church|mosque|mtn|glo|airtel|9mobile|netflix|spotify|uber|bolt|jumia|konga|shoprite|opay|kuda|paystack|flutterwave)\b/i;

export function looksLikePerson(name: string, rawDescriptor?: string): boolean {
  // Structural signal first: it is the one that is actually reliable.
  if (rawDescriptor) {
    const counterparty = readCounterparty(rawDescriptor);
    if (counterparty) return true;
  }

  const clean = name.trim();
  if (COMPANY_HINT.test(clean)) return false;
  const words = clean.split(/\s+/).filter((w) => /^[A-Za-z][a-z']*$/.test(w) || /^[A-Z]+$/.test(w));
  return words.length >= 2 && words.length <= 4 && clean.length <= 40;
}

export interface FactSheetInput {
  ctx: AnalyticsContext;
  budgetStatuses: readonly BudgetStatus[];
  goals: readonly Goal[];
  transactions: readonly Transaction[];
  asOf: ISODate;
}

export interface FactSheet {
  /** The brief itself, ready to send. */
  text: string;
  /** Roughly how much of the budget it uses, for the caller to reason about. */
  approxTokens: number;
  /** Sections that had nothing in them, so the UI can say what it cannot answer. */
  missing: string[];
}

function line(label: string, value: string): string {
  return `- ${label}: ${value}`;
}

export function buildFactSheet(input: FactSheetInput): FactSheet {
  const { ctx, budgetStatuses, goals, transactions, asOf } = input;
  const missing: string[] = [];
  const out: string[] = [];

  const thisMonth = monthOf(asOf);
  const lastMonth = previousMonth(thisMonth);
  const money = (m: { minor: number; currency: string }) => formatMoney(m as never);

  out.push(`TODAY: ${formatDate(asOf, 'long')}`);
  out.push(`CURRENCY: ${ctx.displayCurrency}`);
  out.push('');

  // --- this month and last -------------------------------------------------
  out.push('SPENDING');
  const spentNow = totalSpend(thisMonth, ctx);
  const earnedNow = totalIncome(thisMonth, ctx);
  const spentPrev = totalSpend(lastMonth, ctx);
  const earnedPrev = totalIncome(lastMonth, ctx);

  out.push(line(`Spent so far in ${thisMonth.label}`, money(spentNow)));
  out.push(line(`Received so far in ${thisMonth.label}`, money(earnedNow)));
  out.push(line(`Spent in all of ${lastMonth.label}`, money(spentPrev)));
  out.push(line(`Received in all of ${lastMonth.label}`, money(earnedPrev)));

  const rate = savingsRate(lastMonth, ctx);
  out.push(
    line(
      `Savings rate in ${lastMonth.label}`,
      rate == null ? 'not known (no income recorded)' : `${Math.round(rate * 100)}%`
    )
  );
  out.push('');

  // --- where it went -------------------------------------------------------
  const categories = categoryTotals(thisMonth, ctx, 'expense').slice(0, 10);
  out.push(`CATEGORIES THIS MONTH (${thisMonth.label})`);
  if (categories.length === 0) {
    out.push('- none recorded');
    missing.push('categories');
  } else {
    for (const row of categories) {
      out.push(
        line(
          redact(row.categoryName),
          `${money(row.total)} across ${row.transactionCount} transaction${row.transactionCount === 1 ? '' : 's'}`
        )
      );
    }
  }
  out.push('');

  // --- what moved ----------------------------------------------------------
  const comparison = comparePeriods(thisMonth, lastMonth, ctx);
  if (comparison.categories.length > 0) {
    out.push('BIGGEST CHANGES VS LAST MONTH');
    for (const d of comparison.categories.slice(0, 6)) {
      out.push(
        line(
          redact(d.categoryName),
          `${d.deltaMinor > 0 ? 'up' : 'down'} ${formatMoney({
            minor: Math.abs(d.deltaMinor),
            currency: ctx.displayCurrency,
          } as never)}`
        )
      );
    }
    out.push('');
  }

  // --- budgets -------------------------------------------------------------
  out.push('BUDGETS');
  const live = budgetStatuses.filter((b) => b.budget.amountMinor > 0);
  if (live.length === 0) {
    out.push('- none set');
    missing.push('budgets');
  } else {
    for (const b of live) {
      out.push(
        line(
          redact(b.budget.name),
          `${money(b.spent)} spent of ${money(b.effectiveAllocated)} (${b.state.replace(/_/g, ' ')})`
        )
      );
    }
  }
  out.push('');

  // --- goals ---------------------------------------------------------------
  out.push('GOALS');
  const activeGoals = goals.filter((g) => !g.archived);
  if (activeGoals.length === 0) {
    out.push('- none set');
    missing.push('goals');
  } else {
    for (const g of activeGoals) {
      out.push(
        line(
          redact(g.name),
          `${formatMoney({ minor: g.savedMinor, currency: g.currency } as never)} saved of ${formatMoney(
            { minor: g.targetMinor, currency: g.currency } as never
          )}${g.targetDate ? `, target ${formatDate(g.targetDate, 'medium')}` : ''}`
        )
      );
    }
  }
  out.push('');

  // --- where the money goes, by merchant -----------------------------------
  /**
   * Businesses by name, people by count.
   *
   * "Shoprite" is a fact about your spending. "Rashidat Bashiru" is a fact
   * about someone else, and it is never needed to answer a question about your
   * own money.
   */
  const merchants = topMerchants(thisMonth, ctx, 12);
  /** The raw descriptor a merchant's transactions were read from, if any. */
  const rawFor = new Map<string, string>();
  for (const t of transactions) {
    if (!t.rawDescription || rawFor.has(t.merchant)) continue;
    rawFor.set(t.merchant, t.rawDescription);
  }
  const isPerson = (name: string) => looksLikePerson(name, rawFor.get(name));
  const businesses = merchants.filter((m) => !isPerson(m.merchant));
  const people = merchants.filter((m) => isPerson(m.merchant));

  out.push('TOP PLACES THIS MONTH');
  if (businesses.length === 0) out.push('- none recorded');
  for (const m of businesses.slice(0, 8)) {
    out.push(line(redact(m.merchant), `${money(m.total)} over ${m.count} visit${m.count === 1 ? '' : 's'}`));
  }
  if (people.length > 0) {
    const total = people.reduce((sum, m) => sum + m.total.minor, 0);
    const count = people.reduce((sum, m) => sum + m.count, 0);
    out.push(
      line(
        'Transfers to individuals',
        `${formatMoney({ minor: total, currency: ctx.displayCurrency } as never)} over ${count} transfer${count === 1 ? '' : 's'} to ${people.length} ${people.length === 1 ? 'person' : 'people'} (names withheld)`
      )
    );
  }
  out.push('');

  // --- position ------------------------------------------------------------
  const worth = netWorth(ctx, asOf);
  const runway = runwayMonths(ctx);
  out.push('POSITION');
  out.push(line('Net worth', money(worth.net)));
  out.push(line('Assets', money(worth.assets)));
  out.push(line('Owed', money(worth.liabilities)));
  out.push(
    line(
      'Runway at median spending',
      runway == null ? 'not known' : `${runway.toFixed(1)} months`
    )
  );
  out.push(line('Transactions on record', String(transactions.filter((t) => !t.deletedAt).length)));

  const text = out.join('\n');
  return {
    text,
    // Four characters to a token is the usual rough rule; this only needs to be
    // right enough to keep the brief from silently growing past the window.
    approxTokens: Math.ceil(text.length / 4),
    missing,
  };
}
