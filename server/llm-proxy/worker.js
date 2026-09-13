/**
 * Finlo LLM proxy — Cloudflare Worker.
 *
 * WHY THIS EXISTS
 *
 * An `EXPO_PUBLIC_*` variable is compiled into the JavaScript bundle inside the
 * APK. Anyone who receives the APK can unzip it and read the value in about a
 * minute. For a Gemini key that means a stranger can spend your quota, and on a
 * billed key, your money.
 *
 * This worker holds the key instead. The app calls the worker; the worker calls
 * Gemini. The key never leaves Cloudflare, so what ships to testers is a URL
 * that does nothing except categorise transaction descriptors.
 *
 * WHAT THIS DOES AND DOES NOT PROTECT
 *
 * It fully protects the Gemini key — that is the point, and it is absolute.
 *
 * It does NOT make the endpoint unusable by a determined stranger, because the
 * app token below also ships in the bundle. What it buys is control you did not
 * have before:
 *   - a spend ceiling you set here, not one a stranger sets for you
 *   - instant revocation: change APP_TOKEN and push an OTA update, and every
 *     old copy stops working within one app launch. Rotating a key baked into
 *     an APK instead requires every tester to reinstall.
 *   - a kill switch: set DISABLED=1 and the feature turns off everywhere
 *   - rate limiting per IP, so one abuser cannot drain the daily budget
 *
 * Deploy: see README.md in this folder. Free tier, no card, ~3 minutes.
 */

/**
 * Default model, overridable per-deployment with the GEMINI_MODEL env var and
 * with no code change — because Google retires these on their own schedule.
 * This was pinned to `gemini-2.0-flash`, which was retired, so every request
 * 404'd server-side with nothing on the phone to show for it. A name in one
 * place, changeable from `wrangler.toml`, is the fix.
 */
const DEFAULT_MODEL = 'gemini-3.6-flash';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
function geminiUrl(model) {
  return `${GEMINI_BASE}/${model}:generateContent`;
}

/** Hard caps. A single request should never be able to cost much. */
const MAX_DESCRIPTORS = 60;
const MAX_CATEGORIES = 80;
const MAX_DESCRIPTOR_CHARS = 200;
const MAX_PROMPT_CHARS = 24000;
const MAX_BODY_BYTES = 64 * 1024;

/** Per-IP budget. Generous for a real user, useless for a scraper. */
const RATE_LIMIT_REQUESTS = 60;
const RATE_LIMIT_WINDOW_SECONDS = 3600;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return preflight(env);
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, env);
    if (env.DISABLED === '1') return json({ error: 'Temporarily disabled' }, 503, env);

    if (!env.GEMINI_API_KEY) {
      return json({ error: 'Server is missing GEMINI_API_KEY' }, 500, env);
    }

    // App token. Not a real secret (it ships in the bundle) but it is the
    // rotation handle: change it here + push an OTA update to cut off old copies.
    if (env.APP_TOKEN) {
      const presented = request.headers.get('x-finlo-token') ?? '';
      if (!timingSafeEqual(presented, env.APP_TOKEN)) {
        return json({ error: 'Unauthorised' }, 401, env);
      }
    }

    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    const limited = await checkRateLimit(env, ip);
    if (limited) {
      return json(
        { error: 'Rate limit reached. Try again later.' },
        429,
        env,
        { 'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS) }
      );
    }

    // Reject oversized bodies before parsing them.
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (declared > MAX_BODY_BYTES) return json({ error: 'Body too large' }, 413, env);

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400, env);
    }

    const model = env.GEMINI_MODEL || DEFAULT_MODEL;

    /**
     * Free-text path: Ask Finlo and the month summary build a fully-formed,
     * guard-railed prompt on the app side (see `core/factSheet` and
     * `ingest/ask`) and just need it relayed. Serving it here means the same
     * key, token, rate limit and kill switch cover every AI feature — not only
     * categorisation, which is all this proxy used to do. Without it, Ask
     * through the proxy sent `{prompt}`, matched no `descriptors`, and got an
     * empty array back: the feature looked broken and no error said why.
     */
    const prompt =
      typeof payload?.prompt === 'string' ? payload.prompt.slice(0, MAX_PROMPT_CHARS) : '';
    if (prompt) {
      try {
        const text = await callPrompt(env.GEMINI_API_KEY, model, prompt, payload?.kind);
        return new Response(text, {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
        });
      } catch (e) {
        return json({ error: String(e?.message ?? e) }, 502, env);
      }
    }

    const descriptors = sanitiseDescriptors(payload?.descriptors);
    const categories = sanitiseCategories(payload?.categories);

    if (descriptors.length === 0) return json([], 200, env);
    if (categories.length === 0) {
      return json({ error: 'No categories supplied' }, 400, env);
    }

    try {
      const text = await callGemini(env.GEMINI_API_KEY, model, descriptors, categories);
      // Pass the model's text straight through. The app already parses
      // defensively (fences, prose, invented ids), so re-parsing here would
      // duplicate that logic and give it a second place to drift.
      return new Response(text, {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
      });
    } catch (e) {
      return json({ error: String(e?.message ?? e) }, 502, env);
    }
  },
};

// ------------------------------------------------------------------ helpers

function sanitiseDescriptors(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((d) => typeof d === 'string')
    .map((d) => d.trim().slice(0, MAX_DESCRIPTOR_CHARS))
    .filter(Boolean)
    .slice(0, MAX_DESCRIPTORS);
}

function sanitiseCategories(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string')
    .map((c) => ({
      id: c.id.slice(0, 64),
      name: String(c.name).slice(0, 64),
      kind: c.kind === 'income' ? 'income' : 'expense',
    }))
    .slice(0, MAX_CATEGORIES);
}

/**
 * Rate limit using Workers KV when a namespace is bound.
 *
 * Without KV the worker still runs — batch caps alone keep any single request
 * cheap — but binding KV is one command and is what stops a scraper looping.
 */
async function checkRateLimit(env, ip) {
  if (!env.RATE_LIMIT) return false;
  const key = `rl:${ip}:${Math.floor(Date.now() / 1000 / RATE_LIMIT_WINDOW_SECONDS)}`;
  const current = Number((await env.RATE_LIMIT.get(key)) ?? '0');
  if (current >= RATE_LIMIT_REQUESTS) return true;
  await env.RATE_LIMIT.put(key, String(current + 1), {
    expirationTtl: RATE_LIMIT_WINDOW_SECONDS * 2,
  });
  return false;
}

/**
 * Relay a ready-made prompt (Ask, month summary) and return the model's text.
 *
 * The app owns the prompt and its guardrails — this only carries it. Output is
 * capped by `kind` so a summary can't run long and a chat answer stays an
 * answer. Temperature is low but not zero: the figures in these prompts are
 * fixed by the app, only the wording varies.
 */
async function callPrompt(apiKey, model, prompt, kind) {
  const maxOutputTokens = kind === 'summary' ? 400 : 800;
  const res = await fetch(`${geminiUrl(model)}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens },
    }),
  });
  if (!res.ok) {
    // Never echo the upstream body — it can carry the key in an error URL.
    throw new Error(`Upstream ${res.status}`);
  }
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function callGemini(apiKey, model, descriptors, categories) {
  const list = categories.map((c) => `${c.id}\t${c.name}\t${c.kind}`).join('\n');
  const prompt = [
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

  const res = await fetch(`${geminiUrl(model)}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        maxOutputTokens: 2048,
      },
    }),
  });

  if (!res.ok) {
    // Never echo the upstream body — it can contain the key in an error URL.
    throw new Error(`Upstream ${res.status}`);
  }
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';
}

/** Constant-time-ish compare so the token cannot be guessed byte by byte. */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function corsHeaders(env) {
  // The mobile app sends no Origin. `ALLOWED_ORIGIN` only matters for the web
  // build; leave it unset in production to keep browsers out entirely.
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN ?? '',
    'Access-Control-Allow-Headers': 'Content-Type, x-finlo-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function preflight(env) {
  return new Response(null, { status: 204, headers: corsHeaders(env) });
}

function json(body, status, env, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env), ...extra },
  });
}
