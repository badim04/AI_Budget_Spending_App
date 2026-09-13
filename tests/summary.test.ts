/**
 * The month-summary prompt carries the same load-bearing guardrails as Ask.
 *
 * The point of the summary is that the model phrases figures the tested core
 * already computed — it never adds them up. That rule has to be in the string
 * that actually gets sent, not only in a comment, so this pins it there.
 */

import { describe, it, expect } from 'vitest';
import { buildSummaryPrompt } from '../src/ingest/summary';

describe('buildSummaryPrompt', () => {
  const sheet = 'SPENDING\n- Spent so far in August: ₦120,000\n- Received: ₦300,000';
  const prompt = buildSummaryPrompt(sheet);

  it('embeds the fact sheet verbatim', () => {
    expect(prompt).toContain(sheet);
  });

  it('forbids arithmetic — the whole reason the summary is safe', () => {
    expect(prompt).toMatch(/do not calculate/i);
    expect(prompt).toMatch(/must appear in the facts/i);
  });

  it('keeps it short and descriptive, not advisory', () => {
    expect(prompt).toMatch(/two or three sentences/i);
    expect(prompt).toMatch(/do not (tell|recommend)/i);
  });

  it('protects withheld names', () => {
    expect(prompt).toMatch(/names are withheld/i);
  });
});
