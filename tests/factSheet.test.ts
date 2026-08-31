/**
 * The brief sent to the model, and the promises made about it.
 *
 * Two of these are privacy tests rather than correctness tests, and they are
 * the reason this file exists. A Nigerian statement descriptor reads
 * `Transfer to RASHIDAT BASHIRU | OPay | 7046464337 | milk` — a third party's
 * full name and account number, belonging to someone who never agreed to
 * anything. Answering "how much did I spend on food" must not leak that to a
 * model provider.
 *
 * The rest pin the other half of the deal: every figure is computed here, so
 * the sheet must actually contain the numbers rather than the rows to add up.
 */

import { describe, it, expect } from 'vitest';
import { buildFactSheet, looksLikePerson, redact } from '@/core/factSheet';
import { buildAskPrompt, SUGGESTED_QUESTIONS, type AskTurn } from '@/ingest/ask';
import type { AnalyticsContext } from '@/core/analytics';
import type { Account, BudgetStatus, Category, Goal, Transaction } from '@/core/types';

const TODAY = '2026-08-15';

const categories = [
  { id: 'cat_food', name: 'Food', kind: 'expense', icon: '🍽️', color: '#f00', archived: false },
  { id: 'cat_pay', name: 'Salary', kind: 'income', icon: '💰', color: '#0f0', archived: false },
] as unknown as Category[];

const account = {
  id: 'acc1',
  name: 'Main',
  kind: 'bank',
  currency: 'NGN',
  openingBalanceMinor: 0,
  openedAt: '2025-01-01',
  archived: false,
} as unknown as Account;

let seq = 0;
function tx(date: string, amountMinor: number, merchant = 'Shoprite Ikeja'): Transaction {
  seq += 1;
  return {
    id: `t${seq}`,
    accountId: 'acc1',
    kind: amountMinor > 0 ? 'income' : 'expense',
    amountMinor,
    currency: 'NGN',
    date,
    merchant,
    rawDescription: merchant,
    categoryId: amountMinor > 0 ? 'cat_pay' : 'cat_food',
    source: 'csv_import',
    confidence: 'high',
    reviewed: true,
    tags: [],
    dedupeKey: `k${seq}`,
    pending: false,
    createdAt: date,
    updatedAt: date,
  } as unknown as Transaction;
}

function sheetOf(transactions: Transaction[], goals: Goal[] = [], budgets: BudgetStatus[] = []) {
  const ctx = {
    transactions,
    categories,
    accounts: [account],
    displayCurrency: 'NGN',
    fx: {},
    asOf: TODAY,
  } as unknown as AnalyticsContext;

  return buildFactSheet({ ctx, budgetStatuses: budgets, goals, transactions, asOf: TODAY });
}

describe('redact', () => {
  it('removes account numbers, however they are written', () => {
    expect(redact('Transfer to X | OPay | 7046464337 | milk')).not.toContain('7046464337');
    expect(redact('United Bank | 211****578 | MOB')).not.toContain('211****578');
    expect(redact('ref 260630110100003303851402')).not.toContain('260630110100003303851402');
  });

  it('leaves ordinary money text alone', () => {
    expect(redact('Groceries 12,500.00')).toBe('Groceries 12,500.00');
    expect(redact('MTN 3.2GB 2 Days Plan')).toBe('MTN 3.2GB 2 Days Plan');
  });
});

describe('looksLikePerson', () => {
  it('spots an individual', () => {
    expect(looksLikePerson('Rashidat Bashiru')).toBe(true);
    expect(looksLikePerson('Abdullah Olalekan Adigun')).toBe(true);
  });

  it('does not mistake a business for one', () => {
    for (const name of ['Shoprite Ikeja', 'Ikeja Electric', 'MTN Data', 'Zzqq Ventures', 'Netflix']) {
      expect(looksLikePerson(name), name).toBe(false);
    }
  });
});

describe('buildFactSheet', () => {
  /**
   * The privacy promise, end to end.
   */
  it('never lets a person’s name or account number into the brief', () => {
    const rows = [
      tx('2026-08-02', -33_000_00, 'Rashidat Bashiru'),
      tx('2026-08-03', -5_000_00, 'Abdullah Olalekan Adigun'),
      tx('2026-08-04', -12_000_00, 'Shoprite Ikeja'),
    ];
    const { text } = sheetOf(rows);

    expect(text).not.toContain('Rashidat');
    expect(text).not.toContain('Bashiru');
    expect(text).not.toContain('Abdullah');
    // The business is fine, and is what makes the answer useful.
    expect(text).toContain('Shoprite');
    // The spend still counts — withheld, not dropped.
    expect(text).toMatch(/Transfers to individuals/);
    expect(text).toMatch(/names withheld/);
  });

  it('strips a raw statement descriptor even when it reaches a name field', () => {
    const rows = [tx('2026-08-02', -2_000_00, 'Transfer to SOMEONE | OPay | 7046464337 | milk')];
    const { text } = sheetOf(rows);
    expect(text).not.toContain('7046464337');
  });

  /**
   * The other half: the model is given answers, not rows to add up.
   */
  it('contains computed totals rather than a transaction list', () => {
    const rows = [
      tx('2026-08-02', -10_000_00),
      tx('2026-08-03', -5_000_00),
      tx('2026-08-01', 100_000_00),
    ];
    const { text } = sheetOf(rows);

    expect(text).toMatch(/Spent so far in .*15,000/);
    expect(text).toMatch(/Received so far in .*100,000/);
    expect(text).toContain('CATEGORIES THIS MONTH');
    expect(text).toContain('POSITION');
  });

  it('says a section is empty instead of leaving it out', () => {
    const { text, missing } = sheetOf([tx('2026-08-02', -1_000_00)]);

    expect(text).toContain('BUDGETS\n- none set');
    expect(text).toContain('GOALS\n- none set');
    expect(missing).toContain('budgets');
    expect(missing).toContain('goals');
  });

  it('stays small enough to be worth sending', () => {
    const rows = Array.from({ length: 400 }, (_, i) =>
      tx(`2026-08-${String((i % 14) + 1).padStart(2, '0')}`, -(i + 1) * 100)
    );
    const { approxTokens } = sheetOf(rows);
    // A brief that grows with the ledger would eventually crowd out the answer.
    expect(approxTokens).toBeLessThan(1500);
  });

  it('is deterministic', () => {
    const rows = [tx('2026-08-02', -10_000_00), tx('2026-08-01', 50_000_00)];
    expect(sheetOf(rows).text).toBe(sheetOf(rows).text);
  });
});

describe('buildAskPrompt', () => {
  /** The guardrails have to be in the string, not only in the comments. */
  it('forbids calculating and forbids guessing', () => {
    const prompt = buildAskPrompt('how much on food?', 'FACTS', categories);

    expect(prompt).toMatch(/Do not calculate/i);
    expect(prompt).toMatch(/must appear in the facts above/i);
    expect(prompt).toMatch(/say you do not have it/i);
    expect(prompt).toMatch(/Never guess/i);
  });

  it('refuses regulated advice and explains the withheld names', () => {
    const prompt = buildAskPrompt('what should I invest in?', 'FACTS', categories);
    expect(prompt).toMatch(/not a licensed adviser/i);
    expect(prompt).toMatch(/withheld from the facts on purpose/i);
  });

  it('carries the fact sheet and the question', () => {
    const prompt = buildAskPrompt('why is transport up?', 'SPENT: 100', categories);
    expect(prompt).toContain('SPENT: 100');
    expect(prompt).toContain('why is transport up?');
    expect(prompt).toContain('Food');
  });

  it('keeps only recent history, so the prompt cannot grow without bound', () => {
    const history: AskTurn[] = Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'model',
      text: `turn ${i}`,
    }));
    const prompt = buildAskPrompt('and now?', 'FACTS', categories, history);

    expect(prompt).toContain('turn 39');
    expect(prompt).not.toContain('turn 0');
  });
});

describe('suggested questions', () => {
  /** An example the app cannot answer is a promise broken on the first tap. */
  it('only suggests things the fact sheet actually covers', () => {
    const { text } = sheetOf([tx('2026-08-02', -10_000_00), tx('2026-08-01', 90_000_00)]);
    const covered = [/SPENDING/, /CATEGORIES THIS MONTH/, /BUDGETS/, /POSITION/, /Runway/];
    for (const pattern of covered) expect(text).toMatch(pattern);
    expect(SUGGESTED_QUESTIONS.length).toBeGreaterThan(3);
  });
});
