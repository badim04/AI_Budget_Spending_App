import { describe, it, expect } from 'vitest';
import { cappedConfidence, parseResponse, LLM_CONFIDENCE_CEILING } from '@/ingest/llm';
import { composeAlert } from '@/core/alerts';
import type { BudgetStatus, Category } from '@/core/types';

const categories: Category[] = [
  { id: 'cat_food', name: 'Food', kind: 'expense', icon: '🍚', color: '#f00', excludeFromTotals: false, sortOrder: 1, archived: false, isSystem: true },
  { id: 'cat_transport', name: 'Transport', kind: 'expense', icon: '🚕', color: '#00f', excludeFromTotals: false, sortOrder: 2, archived: false, isSystem: true },
];

describe('parseResponse', () => {
  it('parses a clean JSON array', () => {
    const out = parseResponse(
      '[{"descriptor":"MAMA PUT","categoryId":"cat_food","confidence":0.8}]',
      categories
    );
    expect(out).toEqual([{ descriptor: 'MAMA PUT', categoryId: 'cat_food', confidence: 0.8 }]);
  });

  it('strips markdown fences', () => {
    const out = parseResponse(
      '```json\n[{"descriptor":"UBER","categoryId":"cat_transport","confidence":0.9}]\n```',
      categories
    );
    expect(out[0].categoryId).toBe('cat_transport');
  });

  it('ignores prose around the JSON', () => {
    const out = parseResponse(
      'Sure! Here you go:\n[{"descriptor":"UBER","categoryId":"cat_transport","confidence":0.9}]\nHope that helps.',
      categories
    );
    expect(out).toHaveLength(1);
  });

  it('drops a category id the model invented', () => {
    // The important one: an unknown id written to the DB is a dangling key.
    const out = parseResponse(
      '[{"descriptor":"X","categoryId":"cat_hallucinated","confidence":0.95}]',
      categories
    );
    expect(out[0].categoryId).toBeNull();
  });

  it('accepts a single object instead of an array', () => {
    const out = parseResponse('{"descriptor":"UBER","categoryId":"cat_transport","confidence":0.7}', categories);
    expect(out).toHaveLength(1);
  });

  it('clamps confidence into 0..1', () => {
    const out = parseResponse(
      '[{"descriptor":"A","categoryId":null,"confidence":5},{"descriptor":"B","categoryId":null,"confidence":-2}]',
      categories
    );
    expect(out[0].confidence).toBe(1);
    expect(out[1].confidence).toBe(0);
  });

  it('returns nothing for junk rather than throwing', () => {
    expect(parseResponse('', categories)).toEqual([]);
    expect(parseResponse('total nonsense', categories)).toEqual([]);
    expect(parseResponse('[{"nope":1}]', categories)).toEqual([]);
    expect(parseResponse('[[[', categories)).toEqual([]);
  });

  it('skips rows with no descriptor', () => {
    expect(parseResponse('[{"categoryId":"cat_food","confidence":0.9}]', categories)).toEqual([]);
  });
});

describe('cappedConfidence', () => {
  it('never lets an LLM answer reach the auto-apply threshold', () => {
    // AUTO_APPLY_THRESHOLD is 0.75, so the ceiling must sit below it.
    expect(LLM_CONFIDENCE_CEILING).toBeLessThan(0.75);
    expect(cappedConfidence(0.99)).toBe(LLM_CONFIDENCE_CEILING);
    expect(cappedConfidence(0.3)).toBe(0.3);
  });
});

describe('composeAlert', () => {
  const status = (over: Partial<BudgetStatus> = {}): BudgetStatus =>
    ({
      budget: { name: 'Food', currency: 'NGN' },
      range: { start: '2026-08-01', end: '2026-08-31', label: 'August 2026' },
      remaining: { minor: -250000, currency: 'NGN' },
      utilisation: 1.2,
      periodProgress: 0.6,
      state: 'over',
      ...over,
    }) as BudgetStatus;

  it('names the overspend and the days left', () => {
    const msg = composeAlert([status()], '2026-08-22');
    expect(msg).toMatch(/Food is ₦2,500 over with 9 days left/);
  });

  it('uses percentage wording when merely ahead of pace', () => {
    const msg = composeAlert(
      [status({ state: 'warning', utilisation: 0.92, remaining: { minor: 50000, currency: 'NGN' } })],
      '2026-08-22'
    );
    expect(msg).toMatch(/92% spent with 9 days left/);
  });

  it('mentions how many others need attention', () => {
    const msg = composeAlert([status(), status(), status()], '2026-08-22');
    expect(msg).toMatch(/2 other envelopes need a look/);
  });

  it('gets the singular right', () => {
    expect(composeAlert([status(), status()], '2026-08-22')).toMatch(/1 other envelope needs a look/);
    expect(composeAlert([status()], '2026-08-30')).toMatch(/1 day left/);
  });
});
