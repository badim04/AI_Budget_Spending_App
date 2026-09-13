/**
 * Contract tests for the LLM proxy worker.
 *
 * The worker is the thing standing between a stranger with your APK and your
 * Gemini key, so its refusals matter more than its happy path. Upstream Gemini
 * is stubbed — this is about the gate, not the model.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../server/llm-proxy/worker.js';

const categories = [
  { id: 'cat_food', name: 'Food', kind: 'expense' },
  { id: 'cat_transport', name: 'Transport', kind: 'expense' },
];

const env = { GEMINI_API_KEY: 'server-side-key', APP_TOKEN: 'tok123' };
const AUTH = { 'x-finlo-token': 'tok123' };

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://proxy.test/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/**
 * Stub Gemini.
 *
 * Deliberately does NOT throw on an unexpected host: Vitest's own module
 * loading goes through `globalThis.fetch`, so a throwing stub fails the test
 * run for reasons that have nothing to do with the worker. Non-Gemini calls
 * pass through to the real fetch instead, and `geminiCalls()` counts only the
 * ones we care about.
 */
function stubGemini(text = '[{"descriptor":"MAMA PUT","categoryId":"cat_food","confidence":0.8}]') {
  const spy = vi.fn(async (url: unknown) => {
    // Anything that is not Gemini gets a benign reply rather than being
    // delegated to the real fetch — Vitest's internals also reach for
    // globalThis.fetch, sometimes with no URL at all, and forwarding that
    // crashes undici for reasons unrelated to the worker.
    if (!String(url).includes('generativelanguage')) {
      return new Response('{}', { status: 200 });
    }
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
    };
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** Only the calls that actually reached Gemini. */
function geminiCalls(spy: ReturnType<typeof stubGemini>) {
  return spy.mock.calls.filter((c) => String(c[0]).includes('generativelanguage'));
}

beforeEach(() => stubGemini());
afterEach(() => vi.unstubAllGlobals());

describe('authorisation', () => {
  it('refuses a request with no token', async () => {
    const res = await worker.fetch(post({ descriptors: ['X'], categories }), env);
    expect(res.status).toBe(401);
  });

  it('refuses a wrong token', async () => {
    const res = await worker.fetch(post({ descriptors: ['X'], categories }, { 'x-finlo-token': 'nope' }), env);
    expect(res.status).toBe(401);
  });

  it('refuses a token of the same length but different bytes', async () => {
    const res = await worker.fetch(post({ descriptors: ['X'], categories }, { 'x-finlo-token': 'tok124' }), env);
    expect(res.status).toBe(401);
  });

  it('accepts the right token', async () => {
    const res = await worker.fetch(post({ descriptors: ['MAMA PUT'], categories }, AUTH), env);
    expect(res.status).toBe(200);
  });

  it('never calls upstream when the token is wrong', async () => {
    const spy = stubGemini();
    await worker.fetch(post({ descriptors: ['X'], categories }, { 'x-finlo-token': 'nope' }), env);
    expect(geminiCalls(spy)).toHaveLength(0);
  });
});

describe('response shape', () => {
  it('passes the model JSON straight through for the app to parse', async () => {
    const res = await worker.fetch(post({ descriptors: ['MAMA PUT'], categories }, AUTH), env);
    const body = JSON.parse(await res.text());
    expect(body[0]).toMatchObject({ categoryId: 'cat_food' });
  });

  it('never leaks the key in an upstream error', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 400,
      text: async () => `bad key: ${env.GEMINI_API_KEY}`,
      json: async () => ({}),
    }));
    const res = await worker.fetch(post({ descriptors: ['X'], categories }, AUTH), env);
    const text = await res.text();
    expect(res.status).toBe(502);
    expect(text).not.toContain(env.GEMINI_API_KEY);
  });
});

describe('limits', () => {
  it('caps the descriptor batch so one request cannot be expensive', async () => {
    const spy = stubGemini('[]');
    const many = Array.from({ length: 500 }, (_, i) => `DESCRIPTOR ${i}`);
    await worker.fetch(post({ descriptors: many, categories }, AUTH), env);

    const sent = JSON.parse((geminiCalls(spy)[0] as any[])[1].body);
    const prompt = sent.contents[0].parts[0].text as string;
    const lines = prompt.split('\n').filter((l) => /^\d+\. DESCRIPTOR/.test(l));
    expect(lines).toHaveLength(60);
  });

  it('truncates an absurdly long descriptor', async () => {
    const spy = stubGemini('[]');
    await worker.fetch(post({ descriptors: ['A'.repeat(5000)], categories }, AUTH), env);
    const prompt = JSON.parse((geminiCalls(spy)[0] as any[])[1].body).contents[0].parts[0].text;
    expect(prompt).not.toContain('A'.repeat(300));
  });

  it('short-circuits empty input without calling upstream', async () => {
    const spy = stubGemini();
    const res = await worker.fetch(post({ descriptors: [], categories }, AUTH), env);
    expect(res.status).toBe(200);
    expect(geminiCalls(spy)).toHaveLength(0);
  });
});

describe('operational controls', () => {
  it('honours the kill switch', async () => {
    const res = await worker.fetch(post({ descriptors: ['X'], categories }, AUTH), {
      ...env,
      DISABLED: '1',
    });
    expect(res.status).toBe(503);
  });

  it('fails loudly when the server has no key rather than calling out', async () => {
    const res = await worker.fetch(post({ descriptors: ['X'], categories }, AUTH), {
      APP_TOKEN: 'tok123',
    });
    expect(res.status).toBe(500);
  });

  it('rejects non-POST', async () => {
    const res = await worker.fetch(new Request('https://proxy.test/', { method: 'GET' }), env);
    expect(res.status).toBe(405);
  });

  it('rejects malformed JSON', async () => {
    const res = await worker.fetch(
      new Request('https://proxy.test/', { method: 'POST', headers: AUTH, body: 'not json' }),
      env
    );
    expect(res.status).toBe(400);
  });

  it('rejects a request with no categories', async () => {
    const res = await worker.fetch(post({ descriptors: ['X'], categories: [] }, AUTH), env);
    expect(res.status).toBe(400);
  });

  it('keeps browsers out by default (no CORS origin)', async () => {
    const res = await worker.fetch(post({ descriptors: ['MAMA PUT'], categories }, AUTH), env);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('');
  });
});

/**
 * The free-text path that Ask Finlo and the month summary use.
 *
 * The proxy used to serve only categorisation, so a `{prompt}` body matched no
 * `descriptors` and came back as `[]` — Ask through the proxy silently answered
 * nothing. These pin that it now relays a prompt, under the same gate.
 */
describe('free-text prompt path (Ask, summaries)', () => {
  it('relays a prompt and returns the model text verbatim', async () => {
    stubGemini('Your spending held steady this month.');
    const res = await worker.fetch(post({ prompt: 'Summarise my month', kind: 'summary' }, AUTH), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('Your spending held steady this month.');
  });

  it('requires the token like every other path', async () => {
    const spy = stubGemini('should not be reached');
    const res = await worker.fetch(post({ prompt: 'Summarise' }, { 'x-finlo-token': 'wrong' }), env);
    expect(res.status).toBe(401);
    expect(geminiCalls(spy)).toHaveLength(0);
  });

  it('caps an over-long prompt before spending tokens on it', async () => {
    const spy = stubGemini('ok');
    await worker.fetch(post({ prompt: 'A'.repeat(50000) }, AUTH), env);
    const sent = JSON.parse((geminiCalls(spy)[0] as any[])[1].body);
    expect(sent.contents[0].parts[0].text.length).toBeLessThanOrEqual(24000);
  });

  it('honours the kill switch on the prompt path too', async () => {
    const res = await worker.fetch(post({ prompt: 'Summarise' }, AUTH), { ...env, DISABLED: '1' });
    expect(res.status).toBe(503);
  });
});
