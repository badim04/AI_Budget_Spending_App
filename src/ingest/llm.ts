/**
 * LLM categorisation fallback (layer 4).
 *
 * Runs only for descriptors the offline layers cannot recognise — user rules,
 * learned history and the shipped merchant lexicon all miss. That is the whole
 * design: the LLM is the long tail, not the default path, so the cost and the
 * latency scale with how unusual someone's spending is rather than with how
 * much of it there is.
 *
 * Two transports, checked in order:
 *   1. `EXPO_PUBLIC_LLM_PROXY_URL` — a server you control that holds the key.
 *   2. `EXPO_PUBLIC_GEMINI_API_KEY` — the key travels in the app bundle.
 *
 * (2) is genuinely less safe: anything with `EXPO_PUBLIC_` is compiled into the
 * JavaScript and can be read by unzipping the APK. It is a reasonable trade for
 * a free-tier key with a quota cap while testing, and it is the wrong answer
 * for a public release. `llmStatus()` reports which one is active so Settings
 * can say so out loud instead of letting it be a silent surprise.
 */

import type { Category, ID } from '../core/types';

const PROXY_URL = process.env.EXPO_PUBLIC_LLM_PROXY_URL ?? '';
const GEMINI_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '';
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export interface LlmStatus {
  configured: boolean;
  transport: 'proxy' | 'direct' | 'none';
  name: string;
  /** True when the key ships inside the app and is therefore extractable. */
  keyInBundle: boolean;
  note: string;
}

export function llmStatus(): LlmStatus {
  if (PROXY_URL) {
    return {
      configured: true,
      transport: 'proxy',
      name: 'Proxy',
      keyInBundle: false,
      note: 'Requests go through your server; the key never ships in the app.',
    };
  }
  if (GEMINI_KEY) {
    return {
      configured: true,
      transport: 'direct',
      name: `Gemini (${GEMINI_MODEL})`,
      keyInBundle: true,
      note: 'Key is embedded in the app bundle and can be extracted. Cap its quota, and move to a proxy before any public release.',
    };
  }
  return {
    configured: false,
    transport: 'none',
    name: 'Not configured',
    keyInBundle: false,
    note: 'Unrecognised merchants go to the review queue for you to categorise.',
  };
}

export interface LlmSuggestion {
  descriptor: string;
  categoryId: ID | null;
  confidence: number;
}

/** Cheap in-memory cache. The same unknown merchant recurs constantly within a
 *  single import, and paying for it twice is pure waste. */
const cache = new Map<string, LlmSuggestion>();

export function clearLlmCache(): void {
  cache.clear();
}

/**
 * Classify descriptors the offline layers could not.
 *
 * Batched into one request: fifty unknown rows from a statement import should
 * cost one call, not fifty. Returns an empty array on any failure — a
 * categorisation that did not happen is a review-queue item, never an error the
 * user has to deal with mid-import.
 */
export async function classifyWithLlm(
  descriptors: string[],
  categories: Category[],
  opts: { signal?: AbortSignal; maxBatch?: number } = {}
): Promise<LlmSuggestion[]> {
  const status = llmStatus();
  if (!status.configured || descriptors.length === 0) return [];

  const unique = [...new Set(descriptors.map((d) => d.trim()).filter(Boolean))];
  const cached: LlmSuggestion[] = [];
  const pending: string[] = [];
  for (const d of unique) {
    const hit = cache.get(d.toLowerCase());
    if (hit) cached.push(hit);
    else pending.push(d);
  }
  if (pending.length === 0) return cached;

  // Cap the batch so one enormous import cannot blow the context window.
  const batch = pending.slice(0, opts.maxBatch ?? 40);

  try {
    const raw =
      status.transport === 'proxy'
        ? await callProxy(batch, categories, opts.signal)
        : await callGemini(batch, categories, opts.signal);

    const parsed = parseResponse(raw, categories);
    for (const s of parsed) cache.set(s.descriptor.toLowerCase(), s);
    return [...cached, ...parsed];
  } catch {
    // Network down, quota exhausted, malformed reply — all the same outcome:
    // these rows simply go to review.
    return cached;
  }
}

function buildPrompt(descriptors: string[], categories: Category[]): string {
  const list = categories
    .filter((c) => !c.archived && c.kind !== 'transfer')
    .map((c) => `${c.id}\t${c.name}\t${c.kind}`)
    .join('\n');

  return [
    'You categorise bank transaction descriptors for a personal finance app.',
    '',
    'Rules:',
    '- Return ONLY a JSON array, no prose, no markdown fences.',
    '- Each element: {"descriptor": string, "categoryId": string|null, "confidence": number}',
    '- categoryId MUST be one of the ids listed below, or null. Never invent one.',
    '- confidence is 0.0-1.0. Use below 0.6 when you are guessing.',
    '- If a descriptor is ambiguous or unreadable, use null rather than guessing.',
    '',
    'Categories (id, name, kind):',
    list,
    '',
    'Descriptors:',
    ...descriptors.map((d, i) => `${i + 1}. ${d}`),
  ].join('\n');
}

async function callGemini(
  descriptors: string[],
  categories: Category[],
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(GEMINI_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(descriptors, categories) }] }],
      generationConfig: {
        // Categorisation is a lookup, not a creative task.
        temperature: 0,
        responseMimeType: 'application/json',
        maxOutputTokens: 2048,
      },
    }),
  });

  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const json = await res.json();
  return json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function callProxy(
  descriptors: string[],
  categories: Category[],
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      descriptors,
      categories: categories
        .filter((c) => !c.archived)
        .map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
    }),
  });
  if (!res.ok) throw new Error(`Proxy ${res.status}`);
  return await res.text();
}

/**
 * Parse the reply defensively.
 *
 * Models wrap JSON in markdown fences, add a preamble, or return a single
 * object instead of an array. More importantly, they invent category ids — so
 * every id is checked against the real list and dropped if unknown. An
 * invented id would otherwise be written straight into the database as a
 * dangling foreign key.
 */
export function parseResponse(raw: string, categories: Category[]): LlmSuggestion[] {
  if (!raw) return [];
  const valid = new Set(categories.map((c) => c.id));

  let text = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fence) text = fence[1].trim();

  // Grab the outermost array or object if there is surrounding prose.
  const arrayStart = text.indexOf('[');
  const objStart = text.indexOf('{');
  if (arrayStart === -1 && objStart === -1) return [];
  if (arrayStart !== -1) {
    text = text.slice(arrayStart, text.lastIndexOf(']') + 1);
  } else {
    text = text.slice(objStart, text.lastIndexOf('}') + 1);
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }

  const rows = Array.isArray(data) ? data : [data];
  const out: LlmSuggestion[] = [];

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const descriptor = typeof r.descriptor === 'string' ? r.descriptor : null;
    if (!descriptor) continue;

    const rawId = typeof r.categoryId === 'string' ? r.categoryId : null;
    const categoryId = rawId && valid.has(rawId) ? rawId : null;

    const rawConf = typeof r.confidence === 'number' ? r.confidence : 0.5;
    const confidence = Math.max(0, Math.min(1, rawConf));

    out.push({ descriptor, categoryId, confidence });
  }
  return out;
}

/**
 * Confidence ceiling for an LLM answer.
 *
 * Capped below `AUTO_APPLY_THRESHOLD` (0.75) on purpose: a model's stated
 * confidence is not calibrated against this user's actual filing habits, so an
 * LLM guess always lands in the review queue rather than being written
 * silently. Once the user confirms it once, layer 2 learns it and it never
 * needs the model again.
 */
export const LLM_CONFIDENCE_CEILING = 0.7;

export function cappedConfidence(raw: number): number {
  return Math.min(raw, LLM_CONFIDENCE_CEILING);
}
