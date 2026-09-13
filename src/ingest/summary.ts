/**
 * A month in two or three sentences.
 *
 * This reuses the exact brief Ask Finlo sends (`core/factSheet`): the same
 * redaction of account numbers, the same aggregation of transfers to
 * individuals under "names withheld", and the same rule that the model may not
 * do arithmetic. So the summary inherits every privacy and correctness
 * guarantee that file already carries — it only asks for a readout of the month
 * instead of an answer to a typed question.
 *
 * Deliberately on demand, not on load. A summary is a nicety, and firing a
 * paid call every time the Insights tab opens is the kind of cost that creeps.
 * The screen offers a button; nothing is sent until it is pressed.
 */

import { generateText, textConfigured } from './llmText';

export interface SummaryResult {
  ok: boolean;
  text: string;
  error?: string;
}

/** AI is on and a transport exists. */
export function summaryConfigured(): boolean {
  return textConfigured();
}

/**
 * The instructions wrapped around the fact sheet.
 *
 * Exported so a test can assert the guardrails are in the string that gets
 * sent, the same way `buildAskPrompt` is tested — the "do not calculate" line
 * is load-bearing, not decorative.
 */
export function buildSummaryPrompt(factSheet: string): string {
  return [
    'You are Finlo, a personal finance app. Write the user a short, plain-language',
    'summary of their month from the facts below. You are talking to the person',
    'whose money it is.',
    '',
    '--- FACTS ---',
    factSheet,
    '--- END FACTS ---',
    '',
    'RULES, in order of importance:',
    '1. Do not calculate. Every figure you use must appear in the facts above,',
    '   copied exactly with its currency symbol. Never add, subtract, average or',
    '   convert. If something would need a number that is not written above, leave',
    '   it out.',
    '2. Two or three sentences. Lead with the single most useful thing — the',
    '   biggest change, or how spending compares with last month. No preamble, no',
    '   "based on the facts", no bullet lists, no heading.',
    '3. Describe, do not advise. You may point out a pattern. Do not tell the user',
    '   what to do with their money and do not recommend investments.',
    '4. If the facts are too thin to say anything real, say plainly that there is',
    '   not much recorded for this month yet.',
    '5. Some names are withheld on purpose. Refer to "transfers to individuals",',
    '   never invent who they were.',
  ].join('\n');
}

export async function summariseMonth(
  factSheet: string,
  opts: { signal?: AbortSignal } = {}
): Promise<SummaryResult> {
  if (!textConfigured()) {
    return { ok: false, text: '', error: 'AI is off or not configured.' };
  }

  try {
    const text = await generateText(buildSummaryPrompt(factSheet), {
      kind: 'summary',
      temperature: 0.3,
      maxOutputTokens: 400,
      signal: opts.signal,
    });
    if (!text) return { ok: false, text: '', error: 'The model returned nothing.' };
    return { ok: true, text };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, text: '', error: /abort/i.test(message) ? 'Cancelled.' : message };
  }
}
