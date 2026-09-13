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
import { aiEnabled } from './aiToggle';

const PROXY_URL = process.env.EXPO_PUBLIC_LLM_PROXY_URL ?? '';
const GEMINI_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '';
/** Sent to the proxy so old app copies can be cut off by rotating it there
 *  and pushing an OTA update. Not a secret — it ships in the bundle too. */
const PROXY_TOKEN = process.env.EXPO_PUBLIC_LLM_PROXY_TOKEN ?? '';
/**
 * Which Gemini model to ask.
 *
 * This was pinned to `gemini-2.0-flash` and Google retired it, so every import
 * came back with "No suggestions came back" and a 404 nobody could see. Pinning
 * a name means this breaks again the next time they retire one.
 *
 * So: a preferred name, overridable without a code change via
 * `EXPO_PUBLIC_GEMINI_MODEL`, and a discovery fallback that asks the API what
 * it actually has when the preferred one is gone. Self-healing beats a name I
 * have to keep guessing right.
 */
const PREFERRED_MODEL = process.env.EXPO_PUBLIC_GEMINI_MODEL || 'gemini-3.6-flash';
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';

/** Resolved lazily, then reused for the rest of the session. */
let activeModel = PREFERRED_MODEL;
/**
 * Descriptors per request.
 *
 * Kept small on purpose. Each answer is a JSON object of roughly 40 tokens, so
 * a batch of 40 needs ~1600 output tokens and the old 2048 cap cut the reply
 * off mid-array. With `responseMimeType: application/json` a truncated reply is
 * still returned as text, it simply is not valid JSON — which is why this
 * failed as "no suggestions" rather than as an error.
 */
const BATCH_SIZE = 25;


export interface LlmStatus {
  /** A transport exists AND the user has AI switched on — i.e. a call will happen. */
  configured: boolean;
  /** A transport exists (proxy or key), regardless of the user's switch. */
  hasTransport: boolean;
  /** The user's AI switch. False here with `hasTransport` true means "off, on purpose". */
  enabled: boolean;
  transport: 'proxy' | 'direct' | 'none';
  name: string;
  /** True when the key ships inside the app and is therefore extractable. */
  keyInBundle: boolean;
  note: string;
}

const AI_OFF_NOTE =
  'Switched off in Settings to avoid usage costs. Unrecognised merchants go to the review queue instead.';

export function llmStatus(): LlmStatus {
  const on = aiEnabled();
  if (PROXY_URL) {
    return {
      configured: on,
      hasTransport: true,
      enabled: on,
      transport: 'proxy',
      name: 'Proxy',
      keyInBundle: false,
      note: !on
        ? AI_OFF_NOTE
        : PROXY_TOKEN
          ? 'Requests go through your server. The Gemini key never ships in the app, and the app token can be rotated remotely.'
          : 'Requests go through your server; the Gemini key never ships in the app. Set EXPO_PUBLIC_LLM_PROXY_TOKEN to gate it.',
    };
  }
  if (GEMINI_KEY) {
    return {
      configured: on,
      hasTransport: true,
      enabled: on,
      transport: 'direct',
      name: `Gemini (${activeModel})`,
      keyInBundle: true,
      note: !on
        ? AI_OFF_NOTE
        : 'Key is embedded in the app bundle and can be extracted. Cap its quota, and move to a proxy before any public release.',
    };
  }
  return {
    configured: false,
    hasTransport: false,
    enabled: on,
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

export interface LlmRun {
  suggestions: LlmSuggestion[];
  /** How many descriptors were actually sent (cache hits are not re-sent). */
  requested: number;
  /** Plain-language reason nothing came back, for the user to see. */
  error?: string;
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
  return (await classifyWithLlmDetailed(descriptors, categories, opts)).suggestions;
}

/**
 * The same, but it tells you why it failed.
 *
 * The silent version was a mistake. When the model returned nothing the user
 * got "No suggestions came back" with no way to tell a dead network from an
 * exhausted quota from a reply that arrived and would not parse — and the
 * three have completely different fixes. The reason costs nothing to carry and
 * saves a debugging session.
 */
export async function classifyWithLlmDetailed(
  descriptors: string[],
  categories: Category[],
  opts: {
    signal?: AbortSignal;
    maxBatch?: number;
    maxRequests?: number;
    /** Called after each batch, so a long import can show progress. */
    onProgress?: (done: number, total: number) => void;
  } = {}
): Promise<LlmRun> {
  const status = llmStatus();
  if (!status.configured) {
    return {
      suggestions: [],
      requested: 0,
      error: status.hasTransport ? 'AI is switched off in Settings.' : 'No AI is configured.',
    };
  }
  if (descriptors.length === 0) return { suggestions: [], requested: 0 };

  const unique = [...new Set(descriptors.map((d) => d.trim()).filter(Boolean))];
  const cached: LlmSuggestion[] = [];
  const pending: string[] = [];
  for (const d of unique) {
    const hit = cache.get(d.toLowerCase());
    if (hit) cached.push(hit);
    else pending.push(d);
  }
  if (pending.length === 0) return { suggestions: cached, requested: 0 };

  // Chunked rather than truncated. The old code took the first 40 and dropped
  // the rest on the floor, so a 113-row import silently ignored 73 of them.
  const batchSize = opts.maxBatch ?? BATCH_SIZE;
  const maxRequests = opts.maxRequests ?? 8;
  const batches: string[][] = [];
  for (let i = 0; i < pending.length && batches.length < maxRequests; i += batchSize) {
    batches.push(pending.slice(i, i + batchSize));
  }

  const answers: LlmSuggestion[] = [];
  let failure: string | undefined;

  opts.onProgress?.(0, batches.length);

  for (const [index, batch] of batches.entries()) {
    try {
      const raw =
        status.transport === 'proxy'
          ? await callProxy(batch, categories, opts.signal)
          : await callGemini(batch, categories, opts.signal);

      const parsed = parseResponse(raw, categories);
      if (parsed.length === 0 && raw.trim()) {
        failure ??= 'The model replied with something this app could not read.';
      }
      for (const suggestion of parsed) {
        cache.set(suggestion.descriptor.toLowerCase(), suggestion);
        answers.push(suggestion);
      }
    } catch (e) {
      failure ??= describeFailure(e);
      // One dead batch should not throw away the ones that worked.
      break;
    }

    opts.onProgress?.(index + 1, batches.length);
  }

  const requested = batches.reduce((n, b) => n + b.length, 0);
  return {
    suggestions: [...cached, ...answers],
    requested,
    error: answers.length === 0 ? failure ?? 'The model returned no suggestions.' : undefined,
  };
}

/** Turn a thrown value into something worth showing a person. */
function describeFailure(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);

  if (/\b429\b/.test(message)) return 'Rate limit or quota reached. Try again later.';
  if (/\b40[013]\b/.test(message)) return `The AI rejected the request (${message}). Check the API key.`;
  if (/\b5\d\d\b/.test(message)) return `The AI service is having trouble (${message}).`;
  if (/abort/i.test(message)) return 'Cancelled.';
  if (/network|fetch|Failed to fetch|timeout/i.test(message)) {
    return 'Could not reach the AI. Check your connection.';
  }
  return message;
}

function buildPrompt(descriptors: string[], categories: Category[]): string {
  const list = categories
    .filter((c) => !c.archived && c.kind !== 'transfer')
    .map((c) => `${c.id}\t${c.name}\t${c.kind}`)
    .join('\n');

  return [
    'You categorise bank transaction descriptors for a personal finance app.',
    'Many are Nigerian mobile-money transfers.',
    '',
    'Reading a descriptor:',
    '- Fields are separated by "|". A peer transfer reads:',
    '    Transfer to NAME | BANK | ACCOUNT | note',
    '- The LAST field is often a note the sender typed themselves, saying what',
    '  the money was for: "milk", "rent", "ice cream", "fare", "school fees".',
    '  When present it is the strongest signal you have — the name says who was',
    '  paid, the note says why, and one person is paid for many reasons.',
    '- A note may be a personal shorthand you cannot decode. Return null for',
    '  those rather than guessing from the recipient name.',
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
  try {
    return await generate(activeModel, descriptors, categories, signal);
  } catch (e) {
    // "No longer available" is the one failure worth retrying, because the fix
    // is a different model name rather than anything the user can do.
    if (!isRetiredModel(e)) throw e;

    const replacement = await discoverModel(signal);
    if (!replacement || replacement === activeModel) throw e;

    activeModel = replacement;
    return await generate(activeModel, descriptors, categories, signal);
  }
}

function isRetiredModel(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return /\b404\b/.test(message) || /no longer available|not found|is not supported/i.test(message);
}

async function generate(
  model: string,
  descriptors: string[],
  categories: Category[],
  signal?: AbortSignal
): Promise<string> {
  const url = `${GEMINI_API}/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(descriptors, categories) }] }],
      generationConfig: {
        // Categorisation is a lookup, not a creative task.
        temperature: 0,
        responseMimeType: 'application/json',
        maxOutputTokens: 8192,
      },
    }),
  });

  if (!res.ok) {
    // Google puts the useful part in the body: bad key, quota, wrong model.
    const detail = await res.text().catch(() => '');
    const reason = /"message"\s*:\s*"([^"]+)"/.exec(detail)?.[1];
    throw new Error(`Gemini ${res.status}${reason ? `: ${reason}` : ''}`);
  }

  const json = await res.json();
  const candidate = json?.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text ?? '';

  // MAX_TOKENS means the array is cut short. The salvage in `parseResponse`
  // recovers the complete objects, so this is a warning, not a failure.
  if (!text && candidate?.finishReason) {
    throw new Error(`Gemini returned nothing (${candidate.finishReason})`);
  }
  return text;
}

/**
 * Ask the API which models this key can actually use.
 *
 * Prefers a "flash" model — categorisation is a cheap, high-volume lookup and
 * flash is the tier built for it — and among those the newest version number.
 * Exported for testing because the ranking is the part that will age.
 */
export function chooseModel(names: string[]): string | null {
  const usable = names
    .map((n) => n.replace(/^models[/]/, ''))
    .filter((n) => /^gemini-/.test(n))
    // Previews and experiments get retired without notice; that is the whole
    // problem this function exists to solve.
    .filter((n) => !/(vision|embedding|aqa|exp|preview|thinking|image|tts|live)/i.test(n));

  if (usable.length === 0) return null;

  const rank = (name: string): [number, number, number] => {
    const version = Number(/gemini-(\d+(?:[.]\d+)?)/.exec(name)?.[1] ?? 0);
    const tier = /flash-lite/.test(name) ? 1 : /flash/.test(name) ? 3 : /pro/.test(name) ? 2 : 0;
    // A bare "gemini-3.6-flash" beats "gemini-3.6-flash-002": fewer parts wins.
    return [tier, version, -name.split('-').length];
  };

  return usable.sort((a, b) => {
    const [at, av, ap] = rank(a);
    const [bt, bv, bp] = rank(b);
    return bt - at || bv - av || bp - ap;
  })[0];
}

async function discoverModel(signal?: AbortSignal): Promise<string | null> {
  const res = await fetch(`${GEMINI_API}/models?key=${encodeURIComponent(GEMINI_KEY)}`, { signal });
  if (!res.ok) return null;

  const json = await res.json();
  const names: string[] = (json?.models ?? [])
    .filter((m: { supportedGenerationMethods?: string[] }) =>
      (m.supportedGenerationMethods ?? []).includes('generateContent')
    )
    .map((m: { name?: string }) => m.name ?? '')
    .filter(Boolean);

  return chooseModel(names);
}

async function callProxy(
  descriptors: string[],
  categories: Category[],
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(PROXY_TOKEN ? { 'x-finlo-token': PROXY_TOKEN } : {}),
    },
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
  // A truncated reply has no closing bracket. Slicing to `lastIndexOf` would
  // then produce the empty string and lose everything the model did send, so
  // keep the tail and let the salvage below deal with it.
  const clip = (from: number, closer: string) => {
    const end = text.lastIndexOf(closer);
    return end > from ? text.slice(from, end + 1) : text.slice(from);
  };

  text = arrayStart !== -1 ? clip(arrayStart, ']') : clip(objStart, '}');

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // A reply cut off by the output limit is valid JSON right up to the point
    // it stops. Twenty good answers beat throwing all of them away.
    data = salvageObjects(text);
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
/**
 * Pull whole `{...}` objects out of a truncated array.
 *
 * Brace counting, string-aware so a `}` inside a merchant name does not close
 * an object early. Anything after the last complete object is discarded.
 */
function salvageObjects(text: string): unknown[] {
  const out: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        try {
          out.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          // A fragment that still will not parse is simply skipped.
        }
        start = -1;
      }
    }
  }

  return out;
}

/**
 * Ask the model one throwaway question and report exactly what happened.
 *
 * "It says Gemini is configured" and "Gemini works" are different claims, and
 * the app was making the first while meaning the second — a retired model name
 * meant every request 404'd and the only symptom was an empty review queue
 * suggestion. A key being present proves nothing. This proves it end to end,
 * in one tap, with three invented descriptors and no real financial data.
 */
export async function pingLlm(
  categories: Category[],
  signal?: AbortSignal
): Promise<{ ok: boolean; detail: string; model: string }> {
  const status = llmStatus();
  if (!status.configured) {
    return {
      ok: false,
      detail: status.hasTransport ? 'AI is switched off in Settings.' : 'No AI is configured.',
      model: status.name,
    };
  }

  const probes = ['COFFEE SHOP LAGOS', 'UBER TRIP', 'PHARMACY PURCHASE'];
  const started = Date.now();

  try {
    // Straight past the cache: a cached hit would prove nothing about the
    // connection, which is the entire point of asking.
    const raw =
      status.transport === 'proxy'
        ? await callProxy(probes, categories, signal)
        : await callGemini(probes, categories, signal);

    const parsed = parseResponse(raw, categories);
    const took = Date.now() - started;

    if (parsed.length === 0) {
      return {
        ok: false,
        detail: `Replied in ${took}ms but the answer could not be read.`,
        model: activeModel,
      };
    }

    const filed = parsed.filter((p) => p.categoryId).length;
    return {
      ok: true,
      detail: `Answered ${parsed.length} of ${probes.length} in ${took}ms, ${filed} with a category.`,
      model: activeModel,
    };
  } catch (e) {
    return { ok: false, detail: describeFailure(e), model: activeModel };
  }
}

export const LLM_CONFIDENCE_CEILING = 0.7;

export function cappedConfidence(raw: number): number {
  return Math.min(raw, LLM_CONFIDENCE_CEILING);
}
