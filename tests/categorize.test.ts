import { describe, it, expect } from 'vitest';
import {
  AUTO_APPLY_THRESHOLD,
  buildMerchantHistory,
  categorise,
  merchantKey,
  normaliseMerchant,
  prettyMerchant,
  shouldAutoApply,
  suggestRuleFromCorrection,
  type CategoriseDeps,
  type CategoryRule,
} from '@/core/categorize';
import type { Category, Transaction } from '@/core/types';

const categories: Category[] = [
  { id: 'c_groceries', name: 'Groceries', kind: 'expense', icon: '🛒', color: '#0f0', excludeFromTotals: false, sortOrder: 1, archived: false, isSystem: true },
  { id: 'c_eating', name: 'Eating out', kind: 'expense', icon: '🍽️', color: '#f90', excludeFromTotals: false, sortOrder: 2, archived: false, isSystem: true },
  { id: 'c_transport', name: 'Transport', kind: 'expense', icon: '🚕', color: '#09f', excludeFromTotals: false, sortOrder: 3, archived: false, isSystem: true },
  { id: 'c_subs', name: 'Subscriptions', kind: 'expense', icon: '🔁', color: '#a0f', excludeFromTotals: false, sortOrder: 4, archived: false, isSystem: true },
  { id: 'c_salary', name: 'Salary', kind: 'income', icon: '💰', color: '#0fa', excludeFromTotals: false, sortOrder: 5, archived: false, isSystem: true },
];

const slugToCategoryId = new Map<string, string>([
  ['groceries', 'c_groceries'],
  ['eating_out', 'c_eating'],
  ['transport', 'c_transport'],
  ['subscriptions', 'c_subs'],
  ['salary', 'c_salary'],
]);

function deps(over: Partial<CategoriseDeps> = {}): CategoriseDeps {
  return {
    rules: [],
    history: { counts: new Map() },
    categories,
    slugToCategoryId,
    ...over,
  };
}

function tx(over: Partial<Transaction>): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    accountId: 'acc1',
    kind: 'expense',
    amountMinor: -1000,
    currency: 'NGN',
    date: '2026-08-01',
    merchant: 'x',
    source: 'manual',
    confidence: 'high',
    reviewed: true,
    tags: [],
    dedupeKey: 'k',
    pending: false,
    createdAt: '',
    updatedAt: '',
    ...over,
  } as Transaction;
}

describe('normaliseMerchant', () => {
  it('strips payment-rail noise, references and dates', () => {
    expect(normaliseMerchant('POS/1234 SHOPRITE IKEJA LAG 12/08 REF:88213')).toBe('shoprite ikeja');
  });

  it('collapses different renderings of the same merchant', () => {
    const a = normaliseMerchant('WEB PURCHASE NETFLIX.COM 08/13');
    const b = normaliseMerchant('Netflix.com');
    const c = normaliseMerchant('NIP TRF NETFLIX COM REF 99182');
    expect(merchantKey(a)).toBe(merchantKey(b));
    expect(merchantKey(a)).toBe(merchantKey(c));
  });

  it('survives an empty or junk descriptor', () => {
    expect(normaliseMerchant('')).toBe('');
    expect(normaliseMerchant('POS 12345678')).toBe('');
  });
});

describe('prettyMerchant', () => {
  it('title-cases a cleaned descriptor', () => {
    expect(prettyMerchant('POS/1234 SHOPRITE IKEJA')).toBe('Shoprite Ikeja');
  });

  it('falls back to the raw string when nothing survives cleaning', () => {
    expect(prettyMerchant('POS 999999')).toBe('POS 999999');
  });
});

describe('user rules', () => {
  const rule: CategoryRule = {
    id: 'r1',
    pattern: 'shoprite',
    matchType: 'contains',
    categoryId: 'c_groceries',
    priority: 100,
    enabled: true,
  };

  it('wins over everything else', () => {
    const s = categorise(
      { merchant: 'SHOPRITE', amountMinor: -5000, accountId: 'acc1', isInflow: false },
      deps({ rules: [{ ...rule, categoryId: 'c_transport' }] })
    );
    expect(s?.categoryId).toBe('c_transport'); // rule overrides the lexicon
    expect(s?.source).toBe('user_rule');
    expect(s?.score).toBe(1);
  });

  it('respects the enabled flag', () => {
    const s = categorise(
      { merchant: 'SHOPRITE', amountMinor: -5000, accountId: 'acc1', isInflow: false },
      deps({ rules: [{ ...rule, enabled: false, categoryId: 'c_transport' }] })
    );
    expect(s?.source).toBe('keyword');
  });

  it('honours amount and account narrowing', () => {
    const narrowed = { ...rule, minAmountMinor: 10_000, categoryId: 'c_transport' };
    const small = categorise(
      { merchant: 'SHOPRITE', amountMinor: -5000, accountId: 'acc1', isInflow: false },
      deps({ rules: [narrowed] })
    );
    expect(small?.source).toBe('keyword');

    const large = categorise(
      { merchant: 'SHOPRITE', amountMinor: -50_000, accountId: 'acc1', isInflow: false },
      deps({ rules: [narrowed] })
    );
    expect(large?.source).toBe('user_rule');
  });

  it('picks the highest priority when several rules match', () => {
    const s = categorise(
      { merchant: 'SHOPRITE', amountMinor: -5000, accountId: 'acc1', isInflow: false },
      deps({
        rules: [
          { ...rule, id: 'lo', priority: 1, categoryId: 'c_eating' },
          { ...rule, id: 'hi', priority: 99, categoryId: 'c_transport' },
        ],
      })
    );
    expect(s?.categoryId).toBe('c_transport');
  });

  it('does not let one broken regex break categorisation', () => {
    const s = categorise(
      { merchant: 'SHOPRITE', amountMinor: -5000, accountId: 'acc1', isInflow: false },
      deps({ rules: [{ ...rule, matchType: 'regex', pattern: '([unclosed' }] })
    );
    expect(s?.source).toBe('keyword'); // fell through instead of throwing
  });
});

describe('learned history', () => {
  it('learns from reviewed transactions', () => {
    const history = buildMerchantHistory([
      tx({ rawDescription: 'POS MAMA PUT KITCHEN', categoryId: 'c_eating', reviewed: true }),
      tx({ rawDescription: 'POS MAMA PUT KITCHEN', categoryId: 'c_eating', reviewed: true }),
      tx({ rawDescription: 'POS MAMA PUT KITCHEN', categoryId: 'c_eating', reviewed: true }),
    ]);
    const s = categorise(
      { merchant: 'MAMA PUT KITCHEN', amountMinor: -3000, accountId: 'acc1', isInflow: false },
      deps({ history })
    );
    expect(s?.categoryId).toBe('c_eating');
    expect(s?.source).toBe('history');
    expect(s?.reason).toMatch(/3 times/);
  });

  it('ignores unreviewed transactions so it cannot train on its own guesses', () => {
    const history = buildMerchantHistory([
      tx({ rawDescription: 'MAMA PUT KITCHEN', categoryId: 'c_eating', reviewed: false }),
      tx({ rawDescription: 'MAMA PUT KITCHEN', categoryId: 'c_eating', reviewed: false }),
    ]);
    expect(history.counts.size).toBe(0);
  });

  it('is less confident when past choices disagree', () => {
    const consistent = buildMerchantHistory([
      tx({ rawDescription: 'CONSISTENT SHOP', categoryId: 'c_eating' }),
      tx({ rawDescription: 'CONSISTENT SHOP', categoryId: 'c_eating' }),
      tx({ rawDescription: 'CONSISTENT SHOP', categoryId: 'c_eating' }),
      tx({ rawDescription: 'CONSISTENT SHOP', categoryId: 'c_eating' }),
    ]);
    const mixed = buildMerchantHistory([
      tx({ rawDescription: 'MIXED SHOP', categoryId: 'c_eating' }),
      tx({ rawDescription: 'MIXED SHOP', categoryId: 'c_eating' }),
      tx({ rawDescription: 'MIXED SHOP', categoryId: 'c_transport' }),
      tx({ rawDescription: 'MIXED SHOP', categoryId: 'c_groceries' }),
    ]);
    const a = categorise({ merchant: 'CONSISTENT SHOP', amountMinor: -1, accountId: 'acc1', isInflow: false }, deps({ history: consistent }));
    const b = categorise({ merchant: 'MIXED SHOP', amountMinor: -1, accountId: 'acc1', isInflow: false }, deps({ history: mixed }));
    expect(a!.score).toBeGreaterThan(b!.score);
  });

  it('takes priority over the keyword lexicon', () => {
    // The user files Uber under Transport normally, but has overridden it.
    const history = buildMerchantHistory([
      tx({ rawDescription: 'UBER', categoryId: 'c_eating' }),
      tx({ rawDescription: 'UBER', categoryId: 'c_eating' }),
    ]);
    const s = categorise(
      { merchant: 'UBER', amountMinor: -2000, accountId: 'acc1', isInflow: false },
      deps({ history })
    );
    expect(s?.categoryId).toBe('c_eating');
    expect(s?.source).toBe('history');
  });
});

describe('keyword lexicon', () => {
  it('recognises common merchants', () => {
    const cases: Array<[string, string]> = [
      ['SHOPRITE IKEJA', 'c_groceries'],
      ['NETFLIX.COM', 'c_subs'],
      ['UBER TRIP', 'c_transport'],
      ['CHICKEN REPUBLIC VI', 'c_eating'],
      ['TOTAL ENERGIES FUEL', 'c_transport'],
    ];
    for (const [descriptor, expected] of cases) {
      const s = categorise(
        { merchant: descriptor, amountMinor: -1000, accountId: 'acc1', isInflow: false },
        deps()
      );
      expect(s?.categoryId, descriptor).toBe(expected);
    }
  });

  it('prefers the more specific keyword', () => {
    // "uber eats" must beat "uber"
    const s = categorise(
      { merchant: 'UBER EATS ORDER', amountMinor: -4000, accountId: 'acc1', isInflow: false },
      deps()
    );
    expect(s?.categoryId).toBe('c_eating');
  });

  it('matches whole words only', () => {
    const s = categorise(
      { merchant: 'UBEROI TAILORS', amountMinor: -4000, accountId: 'acc1', isInflow: false },
      deps()
    );
    expect(s?.categoryId).not.toBe('c_transport');
  });

  it('does not file an inflow as an expense category', () => {
    // A refund from a grocery store is not grocery spending.
    const s = categorise(
      { merchant: 'SHOPRITE REFUND', amountMinor: 5000, accountId: 'acc1', isInflow: true },
      deps()
    );
    expect(s?.categoryId).not.toBe('c_groceries');
  });

  it('matches income keywords on inflows', () => {
    const s = categorise(
      { merchant: 'SALARY PAYMENT AUGUST', amountMinor: 500_000, accountId: 'acc1', isInflow: true },
      deps()
    );
    expect(s?.categoryId).toBe('c_salary');
  });

  it('returns null for a descriptor nothing recognises', () => {
    const s = categorise(
      { merchant: 'ZZQQ VENTURES', amountMinor: -1000, accountId: 'acc1', isInflow: false },
      deps()
    );
    expect(s).toBeNull();
  });

  it('returns null for an empty descriptor', () => {
    expect(categorise({ merchant: '', amountMinor: -1, accountId: 'a', isInflow: false }, deps())).toBeNull();
  });
});

describe('auto-apply threshold', () => {
  it('auto-applies an explicit user rule', () => {
    const s = categorise(
      { merchant: 'SHOPRITE', amountMinor: -1, accountId: 'acc1', isInflow: false },
      deps({ rules: [{ id: 'r', pattern: 'shoprite', matchType: 'contains', categoryId: 'c_groceries', priority: 1, enabled: true }] })
    );
    expect(shouldAutoApply(s)).toBe(true);
  });

  it('sends a weak guess to the review queue instead', () => {
    const history = buildMerchantHistory([tx({ rawDescription: 'ONE OFF PLACE', categoryId: 'c_eating' })]);
    const s = categorise(
      { merchant: 'ONE OFF PLACE', amountMinor: -1, accountId: 'acc1', isInflow: false },
      deps({ history })
    );
    expect(s!.score).toBeLessThan(AUTO_APPLY_THRESHOLD);
    expect(shouldAutoApply(s)).toBe(false);
  });

  it('never auto-applies a null suggestion', () => {
    expect(shouldAutoApply(null)).toBe(false);
  });
});

describe('suggestRuleFromCorrection', () => {
  it('offers a rule once the same correction is made twice', () => {
    const history = buildMerchantHistory([
      tx({ rawDescription: 'SPECIAL VENDOR', categoryId: 'c_eating' }),
      tx({ rawDescription: 'SPECIAL VENDOR', categoryId: 'c_eating' }),
    ]);
    const rule = suggestRuleFromCorrection('SPECIAL VENDOR', 'c_eating', history);
    expect(rule).not.toBeNull();
    expect(rule?.categoryId).toBe('c_eating');
    expect(rule?.priority).toBe(100);
  });

  it('does not offer a rule after a single correction', () => {
    const history = buildMerchantHistory([tx({ rawDescription: 'ONCE', categoryId: 'c_eating' })]);
    expect(suggestRuleFromCorrection('ONCE', 'c_eating', history)).toBeNull();
  });
});
