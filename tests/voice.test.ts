/**
 * The app's voice, and the arithmetic behind it.
 *
 * Tone is subjective; the claims underneath it are not. These tests are mostly
 * about the second thing — an app that says something friendly and wrong is
 * worse than one that says something dry and right.
 *
 * The case that drove it: Insights announced "Transport is up 887%". True, and
 * meaningless — transport went from ₦1,500 to ₦14,800, and a ratio taken from
 * a base that small is noise dressed as a finding.
 */

import { describe, it, expect } from 'vitest';
import { categoryNudge, greeting, isEssential, spendSummary, topNudges } from '@/core/voice';

const NGN = 'NGN';
const nudge = (name: string, current: number, previous: number, icon = '🍔') =>
  categoryNudge({ categoryName: name, icon, currentMinor: current, previousMinor: previous }, NGN);

/**
 * Greetings live in `core/greeting` now and are covered by
 * `tests/greeting.test.ts`. What is checked here is only that `voice` still
 * speaks for the whole app — the module's own claim is that there is one voice,
 * and an import that quietly stopped resolving would make that false.
 */
describe('greeting', () => {
  it('is still reachable through the voice module', () => {
    const line = greeting(new Date('2026-08-26T14:00:00'), 'Abdulakeem Oladimeji');
    expect(line).toContain('Abdulakeem');
    expect(line).toContain('👋');
  });
});

describe('a percentage needs a base worth dividing by', () => {
  it('refuses to quote 887% off a tiny base', () => {
    // The real numbers: ₦1,500 last month, ₦14,800 this month.
    const result = nudge('Transport', 14_800_00, 1_500_00, '🚕');
    expect(result).not.toBeNull();
    expect(result!.body).not.toMatch(/%/);
    // It still says what happened, in money.
    expect(result!.body).toMatch(/14,800/);
  });

  it('does quote a percentage when the base is solid', () => {
    const result = nudge('Groceries', 26_000_00, 18_000_00, '🛒');
    expect(result!.body).toMatch(/44%/);
  });

  it('calls a category with no history new, rather than infinite', () => {
    const result = nudge('Shopping', 13_325_00, 0, '🛍️');
    expect(result!.headline).toMatch(/new this month/i);
    expect(result!.body).not.toMatch(/%|Infinity|NaN/);
  });
});

describe('it knows when to say nothing', () => {
  it('stays quiet about a change too small to act on', () => {
    expect(nudge('Airtime', 4_100_00, 4_000_00, '📱')).toBeNull();
  });

  it('stays quiet when the move is a small share of a big number', () => {
    // ₦2,000 on a ₦450,000 category is not news.
    expect(nudge('Rent & housing', 452_000_00, 450_000_00, '🔑')).toBeNull();
  });

  it('speaks when the money is material', () => {
    expect(nudge('Eating out', 52_700_00, 5_500_00, '🍔')).not.toBeNull();
  });
});

describe('essentials are not lifestyle choices', () => {
  it('recognises them however they are named', () => {
    expect(isEssential('Rent & housing')).toBe(true);
    expect(isEssential('School fees')).toBe(true);
    expect(isEssential('Health')).toBe(true);
    expect(isEssential('Loan repayment')).toBe(true);
    expect(isEssential('Eating out')).toBe(false);
    expect(isEssential('Entertainment')).toBe(false);
  });

  it('does not tease someone about their rent going up', () => {
    const result = nudge('Rent & housing', 60_000_00, 45_000_00, '🔑');
    expect(result!.tone).toBe('neutral');
    expect(result!.body).not.toMatch(/keeping an eye|busy month/i);
  });

  it('does raise an eyebrow at discretionary spend', () => {
    const result = nudge('Eating out', 52_700_00, 5_500_00, '🍔');
    expect(result!.tone).toBe('watch');
    expect(result!.headline).toMatch(/busy month/i);
  });

  it('is encouraging when spending falls, whatever the category', () => {
    expect(nudge('Eating out', 5_000_00, 52_700_00, '🍔')!.tone).toBe('good');
    expect(nudge('Rent & housing', 30_000_00, 45_000_00, '🔑')!.tone).toBe('good');
  });
});

describe('spendSummary', () => {
  it('leads with the money, not the ratio', () => {
    const result = spendSummary(268_885_00, 311_185_00, NGN);
    expect(result.headline).toMatch(/42,300 less than last month/);
    expect(result.tone).toBe('good');
  });

  it('flags being ahead without scolding', () => {
    const result = spendSummary(311_185_00, 268_885_00, NGN);
    expect(result.headline).toMatch(/42,300 more than last month/);
    expect(result.tone).toBe('watch');
    expect(result.body).not.toMatch(/too much|overspend/i);
  });

  it('says steady when it is steady', () => {
    expect(spendSummary(100_000_00, 100_100_00, NGN).tone).toBe('neutral');
  });

  it('admits there is nothing to compare against', () => {
    const result = spendSummary(50_000_00, 0, NGN);
    expect(result.tone).toBe('neutral');
    expect(result.body).toMatch(/once there is a month behind you/i);
  });

  it('says "at this point" for an unfinished month', () => {
    expect(spendSummary(10_000_00, 50_000_00, NGN, { partial: true }).body).toMatch(/at this point/);
  });
});

describe('topNudges', () => {
  const deltas = [
    { categoryName: 'Eating out', icon: '🍔', currentMinor: 52_700_00, previousMinor: 5_500_00 },
    { categoryName: 'Transport', icon: '🚕', currentMinor: 14_800_00, previousMinor: 1_500_00 },
    { categoryName: 'Airtime', icon: '📱', currentMinor: 4_100_00, previousMinor: 4_000_00 },
    { categoryName: 'Groceries', icon: '🛒', currentMinor: 26_000_00, previousMinor: 18_000_00 },
  ];

  it('drops the ones with nothing to say', () => {
    expect(topNudges(deltas, NGN).some((n) => /airtime/i.test(n.headline))).toBe(false);
  });

  it('leads with the biggest mover in money', () => {
    expect(topNudges(deltas, NGN)[0].headline).toMatch(/eating out/i);
  });

  it('caps the briefing', () => {
    expect(topNudges(deltas, NGN, 2)).toHaveLength(2);
  });

  it('returns nothing at all rather than filler', () => {
    expect(topNudges([{ categoryName: 'Airtime', icon: '📱', currentMinor: 100, previousMinor: 90 }], NGN)).toEqual([]);
  });
});
