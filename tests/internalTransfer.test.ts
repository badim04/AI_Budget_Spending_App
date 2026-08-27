/**
 * OPay's autosave sweeps every incoming naira into OWealth and sweeps it back
 * to pay. Both legs are in the statement, so one ₦5,000 payment can appear
 * three times and every leg asks to be categorised.
 *
 * On the statement these were built against, 60 of 229 rows were autosave
 * traffic — a quarter of the review queue, none of it a real decision.
 */

import { describe, it, expect } from 'vitest';
import {
  detectInternal,
  explainInternal,
  resolveInternalCategory,
} from '@/core/internalTransfer';
import type { Category } from '@/core/types';

const categories: Category[] = [
  { id: 'cat_transfer', name: 'Transfer', kind: 'transfer', icon: '🔄', color: '#888', excludeFromTotals: true, sortOrder: 90, archived: false, isSystem: true },
  { id: 'cat_groceries', name: 'Groceries', kind: 'expense', icon: '🛒', color: '#0f0', excludeFromTotals: false, sortOrder: 1, archived: false, isSystem: true },
  { id: 'cat_other_income', name: 'Other income', kind: 'income', icon: '➕', color: '#0fa', excludeFromTotals: false, sortOrder: 72, archived: false, isSystem: true },
];

describe('detectInternal', () => {
  it('spots a move into the pot', () => {
    expect(detectInternal('Auto Save to OWealth')).toEqual({ kind: 'move', pot: 'OWealth' });
    expect(detectInternal('Transfer to OWealth')).toEqual({ kind: 'move', pot: 'OWealth' });
    expect(detectInternal('OWealth Withdrawal')).toEqual({ kind: 'move', pot: 'OWealth' });
  });

  it('treats interest as income, not a move', () => {
    // The distinction that matters: this is money that did not exist before.
    expect(detectInternal('OWealth Interest Earned')).toEqual({
      kind: 'interest',
      pot: 'OWealth',
    });
  });

  it('knows the other banks that do this', () => {
    expect(detectInternal('Cashbox auto save')?.kind).toBe('move');
    expect(detectInternal('Spend and Save round up')?.kind).toBe('move');
  });

  it('leaves ordinary transactions alone', () => {
    expect(detectInternal('Transfer to RASHIDAT BASHIRU | OPay | 7046464337 | chi')).toBeNull();
    expect(detectInternal('OPay Card Payment | SportyBet')).toBeNull();
    expect(detectInternal('Mobile Data | MTN | 3.2GB')).toBeNull();
    expect(detectInternal('Stamp Duty')).toBeNull();
    expect(detectInternal('')).toBeNull();
  });

  it('does not claim a separate savings app is an internal move', () => {
    // Money sent to PiggyVest has genuinely left this account. It belongs
    // under Savings & investment, where it stays visible.
    expect(detectInternal('Transfer to PiggyVest')).toBeNull();
    expect(detectInternal('Cowrywise vault funding')).toBeNull();
  });
});

describe('resolveInternalCategory', () => {
  it('files a move under the category excluded from totals', () => {
    const id = resolveInternalCategory({ kind: 'move', pot: 'OWealth' }, categories);
    expect(id).toBe('cat_transfer');
    expect(categories.find((c) => c.id === id)?.excludeFromTotals).toBe(true);
  });

  it('files interest as income', () => {
    const id = resolveInternalCategory({ kind: 'interest', pot: 'OWealth' }, categories);
    expect(categories.find((c) => c.id === id)?.kind).toBe('income');
  });

  it('resolves by kind, so a renamed category still works', () => {
    const renamed = categories.map((c) =>
      c.id === 'cat_transfer' ? { ...c, name: 'Moving money about' } : c
    );
    expect(resolveInternalCategory({ kind: 'move', pot: 'OWealth' }, renamed)).toBe('cat_transfer');
  });

  it('gives up rather than guessing when there is nowhere to put it', () => {
    const none = categories.filter((c) => c.kind === 'expense');
    expect(resolveInternalCategory({ kind: 'move', pot: 'OWealth' }, none)).toBeUndefined();
  });

  it('ignores an archived category', () => {
    const archived = categories.map((c) =>
      c.id === 'cat_transfer' ? { ...c, archived: true } : c
    );
    expect(resolveInternalCategory({ kind: 'move', pot: 'OWealth' }, archived)).toBeUndefined();
  });
});

describe('explainInternal', () => {
  it('says why, in words the user can check', () => {
    expect(explainInternal({ kind: 'move', pot: 'OWealth' })).toMatch(/not spending/i);
    expect(explainInternal({ kind: 'interest', pot: 'OWealth' })).toMatch(/interest/i);
  });
});
