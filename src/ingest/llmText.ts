/**
 * One place that turns a ready-made prompt into text.
 *
 * Ask Finlo and the month summary both hand the model a fully-formed,
 * guard-railed prompt and want a few sentences back. They used to each carry
 * their own copy of "call the proxy, else call the key" — two places for one
 * decision, which is exactly how the proxy came to be wired for categorisation
 * and Ask but not tested end to end for either. This is that decision, once.
 *
 * Categorisation does NOT come through here: it needs JSON mode, batching and a
 * category list, and stays in `llm.ts`. This is the free-text path only.
 *
 * Transport, in order: a proxy you control (the key never ships), else the key
 * in the bundle. The AI kill switch is folded into `textConfigured()` so a
 * caller can gate on it, but `generateText` itself does not check it — a
 * diagnostic that wants to force a call still can.
 */

import { aiEnabled } from './aiToggle';

const PROXY_URL = process.env.EXPO_PUBLIC_LLM_PROXY_URL ?? '';
const GEMINI_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '';
const PROXY_TOKEN = process.env.EXPO_PUBLIC_LLM_PROXY_TOKEN ?? '';
const MODEL = process.env.EXPO_PUBLIC_GEMINI_MODEL || 'gemini-3.6-flash';
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';

export function textTransport(): 'proxy' | 'direct' | 'none' {
  if (PROXY_URL) return 'proxy';
  if (GEMINI_KEY) return 'direct';
  return 'none';
}

/** A transport exists AND the user has AI switched on. */
export function textConfigured(): boolean {
  return aiEnabled() && textTransport() !== 'none';
}

export interface GenerateOpts {
  /** Lets the proxy size the reply — a summary is shorter than a chat answer. */
  kind?: 'ask' | 'summary';
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

/**
 * Send a prompt, get the model's text back. Throws with a message worth showing
 * on failure — a dead network, an exhausted quota and a retired model all look
 * identical from the outside otherwise.
 */
export async function generateText(prompt: string, opts: GenerateOpts = {}): Promise<string> {
  if (PROXY_URL) {
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(PROXY_TOKEN ? { 'x-finlo-token': PROXY_TOKEN } : {}),
      },
      signal: opts.signal,
      body: JSON.stringify({ prompt, kind: opts.kind ?? 'ask' }),
    });
    if (!res.ok) throw new Error(`Proxy ${res.status}`);
    return (await res.text()).trim();
  }

  const url = `${GEMINI_API}/models/${MODEL}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: opts.temperature ?? 0.2,
        maxOutputTokens: opts.maxOutputTokens ?? 700,
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const reason = /"message"\s*:\s*"([^"]+)"/.exec(detail)?.[1];
    throw new Error(`Gemini ${res.status}${reason ? `: ${reason}` : ''}`);
  }

  const json = await res.json();
  return (json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
}
