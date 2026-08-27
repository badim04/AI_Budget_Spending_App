/**
 * Reading the note somebody typed on a transfer.
 *
 * A peer transfer's descriptor ends with free text the sender wrote:
 *
 *   Transfer to RASHIDAT BASHIRU | OPay | 7046464337 | milk
 *   Transfer to RASHIDAT BASHIRU | OPay | 7046464337 | ice cream
 *
 * That is a human saying what the money was for, and it was being thrown away.
 * The recipient's name says *who* got it; the note says *why*, and the same
 * person receives money for different reasons — so the note is the better
 * signal for a category and the worse one for grouping.
 *
 * Every descriptor here is copied from a real OPay statement.
 */

import { describe, it, expect } from 'vitest';
import { noteKey, transferNote } from '@/core/notes';
import { buildMerchantHistory, categorise, type CategoriseDeps } from '@/core/categorize';
import type { Category, Transaction } from '@/core/types';

describe('transferNote', () => {
  it('reads the note a person typed', () => {
    expect(transferNote('Transfer to RASHIDAT BASHIRU | OPay | 7046464337 | milk')).toBe('milk');
    expect(transferNote('Transfer to RASHIDAT BASHIRU | OPay | 7046464337 | ice cream')).toBe(
      'ice cream'
    );
  });

  it('is not fooled by the machinery in the same position', () => {
    // Account or phone number.
    expect(transferNote('Transfer to X | OPay | 7046464337')).toBeNull();
    // Masked account.
    expect(transferNote('Transfer from Y | United Bank For Africa | 211****578')).toBeNull();
    // Channel.
    expect(transferNote('Stamp Duty | Mobile')).toBeNull();
    // Bank name.
    expect(transferNote('Transfer from Z | Nombank Microfinance Bank')).toBeNull();
    // Reference.
    expect(transferNote('Transfer to X | OPay | 260630010100025293934580')).toBeNull();
  });

  it('rejects a hyphenated machine id', () => {
    const raw =
      'Transfer from NOMBA FINANCIAL SERVICES LIMITED | OPay | 559****478 | ' +
      'API-TRANSFER-45A9E-b07b86ff-0978-4200-a5b1-65738744a716';
    expect(transferNote(raw)).toBeNull();
  });

  it('needs a structured descriptor to find a note in', () => {
    expect(transferNote('Stamp Duty')).toBeNull();
    expect(transferNote('')).toBeNull();
  });

  it('normalises for learning', () => {
    expect(noteKey('Ice Cream')).toBe('ice cream');
    expect(noteKey('  CHI!  ')).toBe('chi');
    expect(noteKey('milk')).toBe(noteKey('MILK'));
  });
});

// --------------------------------------------------------------- categorise

const categories: Category[] = [
  { id: 'c_groceries', name: 'Groceries', kind: 'expense', icon: '🛒', color: '#0f0', excludeFromTotals: false, sortOrder: 1, archived: false, isSystem: true },
  { id: 'c_eating', name: 'Eating out', kind: 'expense', icon: '🍽️', color: '#f90', excludeFromTotals: false, sortOrder: 2, archived: false, isSystem: true },
  { id: 'c_rent', name: 'Rent & housing', kind: 'expense', icon: '🔑', color: '#0af', excludeFromTotals: false, sortOrder: 3, archived: false, isSystem: true },
  { id: 'c_utilities', name: 'Utilities', kind: 'expense', icon: '💡', color: '#fa0', excludeFromTotals: false, sortOrder: 4, archived: false, isSystem: true },
  { id: 'c_giving', name: 'Giving', kind: 'expense', icon: '🎁', color: '#f0f', excludeFromTotals: false, sortOrder: 5, archived: false, isSystem: true },
];

const slugToCategoryId = new Map<string, string>([
  ['groceries', 'c_groceries'],
  ['eating_out', 'c_eating'],
  ['rent_housing', 'c_rent'],
  ['utilities', 'c_utilities'],
  ['giving', 'c_giving'],
]);

function deps(over: Partial<CategoriseDeps> = {}): CategoriseDeps {
  return {
    rules: [],
    history: { counts: new Map(), notes: new Map() },
    categories,
    slugToCategoryId,
    ...over,
  };
}

const file = (description: string, d = deps()) =>
  categorise(
    {
      merchant: description,
      rawDescription: description,
      amountMinor: -500000,
      accountId: 'acc',
      isInflow: false,
    },
    d
  );

describe('the note as a category signal', () => {
  it('files a transfer by what the sender said it was for', () => {
    expect(file('Transfer to RASHIDAT BASHIRU | OPay | 7046464337 | milk')?.categoryId).toBe(
      'c_groceries'
    );
    expect(file('Transfer to RASHIDAT BASHIRU | OPay | 7046464337 | ice cream')?.categoryId).toBe(
      'c_eating'
    );
    expect(file('Transfer to LANDLORD | OPay | 8011111111 | rent')?.categoryId).toBe('c_rent');
  });

  it('trusts the payer enough to file it without asking', () => {
    // A short word like "rent" scores below the line in the general lexicon.
    // In the note the sender typed, it is about as clear as intent gets.
    const suggestion = file('Transfer to LANDLORD | OPay | 8011111111 | rent');
    expect(suggestion!.score).toBeGreaterThanOrEqual(0.75);
  });

  it('says why, in the payer\'s own words', () => {
    expect(file('Transfer to X | OPay | 8011111111 | milk')?.reason).toContain('milk');
  });

  it('keeps note-only words out of merchant matching', () => {
    // "light" is electricity when typed on a transfer, and a proper noun here.
    // Matching it against a merchant name would file a coffee as a power bill.
    expect(file('LIGHT HOUSE CAFE LAGOS')?.categoryId).not.toBe('c_utilities');
  });

  it('reads light as electricity inside a note', () => {
    expect(file('Transfer to X | OPay | 8011111111 | light')?.categoryId).toBe('c_utilities');
  });
});

describe('learning from notes', () => {
  function tx(id: string, description: string, categoryId: string): Transaction {
    return {
      id, accountId: 'acc', kind: 'expense', amountMinor: -500000, currency: 'NGN',
      date: '2026-08-01', merchant: description, rawDescription: description, categoryId,
      source: 'csv_import', confidence: 'high', reviewed: true, tags: [],
      dedupeKey: id, pending: false, createdAt: '2026-08-01', updatedAt: '2026-08-01',
    };
  }

  it('learns a personal shorthand no lexicon could ship', () => {
    // "chi" recurs all over this statement and means nothing to a dictionary.
    // Filed once, it should be recognised everywhere after.
    const history = buildMerchantHistory([
      tx('t1', 'Transfer to RASHIDAT BASHIRU | OPay | 7046464337 | chi', 'c_giving'),
    ]);

    const suggestion = file(
      'Transfer to SUNBO OLAYINKA BABALOLA | OPay | 8053382670 | chi',
      deps({ history })
    );

    // A different recipient entirely — the note is what carried the meaning.
    expect(suggestion?.categoryId).toBe('c_giving');
    expect(suggestion?.reason).toContain('chi');
  });

  it('gets more certain the more often the note is confirmed', () => {
    const once = buildMerchantHistory([
      tx('t1', 'Transfer to A | OPay | 8011111111 | chi', 'c_giving'),
    ]);
    const often = buildMerchantHistory([
      tx('t1', 'Transfer to A | OPay | 8011111111 | chi', 'c_giving'),
      tx('t2', 'Transfer to B | OPay | 8022222222 | chi', 'c_giving'),
      tx('t3', 'Transfer to C | OPay | 8033333333 | chi', 'c_giving'),
      tx('t4', 'Transfer to D | OPay | 8044444444 | chi', 'c_giving'),
    ]);

    const weak = file('Transfer to E | OPay | 8055555555 | chi', deps({ history: once }));
    const strong = file('Transfer to E | OPay | 8055555555 | chi', deps({ history: often }));
    expect(strong!.score).toBeGreaterThan(weak!.score);
  });

  it('lets a well-established note outrank a weaker merchant habit', () => {
    // One transfer to this person was filed as Giving; "milk" has been filed
    // as Groceries four times. The same person gets money for many reasons.
    const history = buildMerchantHistory([
      tx('m1', 'Transfer to RASHIDAT BASHIRU | OPay | 7046464337 | chi', 'c_giving'),
      tx('n1', 'Transfer to A | OPay | 8011111111 | milk', 'c_groceries'),
      tx('n2', 'Transfer to B | OPay | 8022222222 | milk', 'c_groceries'),
      tx('n3', 'Transfer to C | OPay | 8033333333 | milk', 'c_groceries'),
      tx('n4', 'Transfer to D | OPay | 8044444444 | milk', 'c_groceries'),
    ]);

    const suggestion = file(
      'Transfer to RASHIDAT BASHIRU | OPay | 7046464337 | milk',
      deps({ history })
    );
    expect(suggestion?.categoryId).toBe('c_groceries');
  });

  it('still prefers the merchant when the note means nothing yet', () => {
    const history = buildMerchantHistory([
      tx('m1', 'Transfer to RASHIDAT BASHIRU | OPay | 7046464337 | chi', 'c_giving'),
      tx('m2', 'Transfer to RASHIDAT BASHIRU | OPay | 7046464337 | chi', 'c_giving'),
    ]);

    const suggestion = file(
      'Transfer to RASHIDAT BASHIRU | OPay | 7046464337 | something new',
      deps({ history })
    );
    expect(suggestion?.categoryId).toBe('c_giving');
  });

  it('only learns from rows a person actually confirmed', () => {
    const unreviewed = { ...(() => {
      const t = {
        id: 't1', accountId: 'acc', kind: 'expense' as const, amountMinor: -500000,
        currency: 'NGN', date: '2026-08-01',
        merchant: 'Transfer to A | OPay | 8011111111 | zzz',
        rawDescription: 'Transfer to A | OPay | 8011111111 | zzz',
        categoryId: 'c_giving', source: 'csv_import' as const, confidence: 'low' as const,
        reviewed: false, tags: [], dedupeKey: 't1', pending: false,
        createdAt: '2026-08-01', updatedAt: '2026-08-01',
      };
      return t;
    })() } as Transaction;

    const history = buildMerchantHistory([unreviewed]);
    expect(history.notes.size).toBe(0);
  });
});
