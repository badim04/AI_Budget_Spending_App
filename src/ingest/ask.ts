/**
 * Asking a question about your own money, in words.
 *
 * The model is given a fact sheet built by `core/factSheet` — every figure in
 * it already computed by the tested core — and asked to answer *from that and
 * nothing else*. It is a phrasing job, not a calculating one.
 *
 * Why that division matters more here than anywhere else in the app: a model
 * asked to total a column returns a number that looks exactly like a total, and
 * nothing about the output says whether it added correctly. Finlo's whole
 * argument is that the numbers are right — it refuses an import that disagrees
 * with the bank by a kobo. Letting a model improvise figures on top of that
 * would undo it in one screen.
 *
 * So the prompt does four things, and the fourth is the important one:
 *
 *   1. States that the facts are complete and authoritative.
 *   2. Forbids arithmetic beyond what is written down.
 *   3. Forbids advice framed as regulated financial advice.
 *   4. Requires "I don't have that" when the sheet does not contain the answer.
 *
 * Nothing here is stored. The question and the sheet go out, the answer comes
 * back, and the conversation lives in component state until the screen closes.
 */

import type { Category } from '../core/types';
import { aiEnabled } from './aiToggle';
import { generateText, textTransport } from './llmText';

/** Long enough for a real answer, short enough that it stays an answer. */
const MAX_OUTPUT_TOKENS = 700;

export interface AskTurn {
  role: 'user' | 'model';
  text: string;
}

export interface AskResult {
  ok: boolean;
  answer: string;
  /** Set when the call failed; the screen shows this instead of a fake answer. */
  error?: string;
}

/**
 * The instructions wrapped around the question.
 *
 * Exported so `tests/ask.test.ts` can assert the guardrails are actually in the
 * string that gets sent, rather than only in this comment.
 */
export function buildAskPrompt(
  question: string,
  factSheet: string,
  categories: readonly Category[],
  history: readonly AskTurn[] = []
): string {
  const names = categories
    .filter((c) => !c.archived)
    .map((c) => c.name)
    .join(', ');

  const conversation = history
    .slice(-6)
    .map((turn) => `${turn.role === 'user' ? 'Question' : 'Answer'}: ${turn.text}`)
    .join('\n');

  return [
    'You are Finlo, a personal finance app, answering a question about the',
    "user's own money. You are talking to the person whose money it is.",
    '',
    'THE FACTS BELOW ARE THE ONLY INFORMATION YOU HAVE. They were computed by',
    'the app from the user\'s real transactions and they are correct.',
    '',
    '--- FACTS ---',
    factSheet,
    '--- END FACTS ---',
    '',
    `The user's spending categories are: ${names || 'none set up yet'}.`,
    '',
    'RULES, in order of importance:',
    '1. Do not calculate. Every number you give must appear in the facts above,',
    '   copied exactly, including its currency symbol. Do not add, subtract,',
    '   average, or convert figures. If answering needs a number that is not',
    '   written above, say you do not have it.',
    '2. If the facts do not answer the question, say so plainly and say what',
    '   would let you answer — for example that no budgets are set. Never guess',
    '   and never fill a gap with a plausible figure.',
    '3. Do not give regulated financial advice. You can describe what the',
    '   numbers show and point out patterns. Do not recommend investments, and',
    '   do not tell the user what to do with their savings. If asked, say that',
    '   you are not a licensed adviser and stick to describing their spending.',
    '4. Some names are withheld from the facts on purpose, to protect other',
    '   people. If asked who someone is, say the app does not share that.',
    '',
    'STYLE: two or three sentences. Direct, no preamble, no bullet lists unless',
    'the question genuinely asks for several items. Never open with "Based on',
    'the facts". Use the currency symbol shown in the facts.',
    '',
    conversation ? `Earlier in this conversation:\n${conversation}\n` : '',
    `Question: ${question}`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

/** A transport exists (proxy or key), regardless of the user's AI switch. */
export function askHasTransport(): boolean {
  return textTransport() !== 'none';
}

/** A transport exists AND the user has AI switched on — i.e. a call will happen. */
export function askConfigured(): boolean {
  return aiEnabled() && askHasTransport();
}

/**
 * Suggested openers.
 *
 * Deliberately questions the fact sheet can actually answer — an example the
 * app cannot answer is a promise it breaks on the user's first tap.
 */
export const SUGGESTED_QUESTIONS = [
  'Where did most of my money go this month?',
  'Am I spending more than last month?',
  'What changed the most since last month?',
  'How am I doing against my budgets?',
  'How long would my money last?',
] as const;

export async function askAboutMoney(
  question: string,
  factSheet: string,
  categories: readonly Category[],
  opts: { history?: readonly AskTurn[]; signal?: AbortSignal } = {}
): Promise<AskResult> {
  const trimmed = question.trim();
  if (!trimmed) return { ok: false, answer: '', error: 'Ask a question first.' };
  if (!askConfigured()) {
    return {
      ok: false,
      answer: '',
      error: askHasTransport()
        ? 'AI is switched off in Settings. Turn it on to ask.'
        : 'No AI is configured. Add a key in Settings, or deploy the proxy.',
    };
  }

  const prompt = buildAskPrompt(trimmed, factSheet, categories, opts.history);

  try {
    // Low but not zero: the figures in the brief are fixed, only wording varies.
    const answer = await generateText(prompt, {
      kind: 'ask',
      temperature: 0.2,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      signal: opts.signal,
    });
    if (!answer) {
      return { ok: false, answer: '', error: 'The model returned nothing. Try rephrasing.' };
    }
    return { ok: true, answer };
  } catch (e) {
    // Say what actually went wrong: a dead connection, an exhausted quota and a
    // retired model all look identical from the outside otherwise.
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      answer: '',
      error: /abort/i.test(message) ? 'Cancelled.' : message,
    };
  }
}
