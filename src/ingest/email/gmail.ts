/**
 * Gmail ingestion.
 *
 * Read-only, and narrow on purpose: `buildGmailQuery` restricts the search to
 * known money senders and money-shaped subjects within a date window, so the
 * app reads as little of the mailbox as it can while still doing its job.
 *
 * The OAuth client id cannot be checked into a repo or created on the user's
 * behalf — it is per-project and tied to their Google Cloud account. Everything
 * else is wired: the moment `EXPO_PUBLIC_GOOGLE_CLIENT_ID_*` is set, the flow
 * runs end to end.
 *
 * SECURITY: message bodies are third-party input. They are handed to
 * `parseEmail`, which scans for declared patterns only — no message content is
 * ever executed or treated as an instruction.
 */

import { Platform } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';
import { GMAIL_SCOPES, buildGmailQuery, htmlToText, type EmailMessage } from './parse';

const TOKEN_KEY = 'finlo.gmail.token';
const DISCOVERY: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

export function gmailClientId(): string {
  const byPlatform = {
    ios: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS,
    android: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID,
    web: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB,
  } as Record<string, string | undefined>;
  return byPlatform[Platform.OS] ?? process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB ?? '';
}

export function gmailConfigured(): boolean {
  return gmailClientId().length > 0;
}

export const GMAIL_SETUP_HELP = [
  'Gmail sync needs a Google OAuth client id (free):',
  '1. console.cloud.google.com → create a project',
  '2. Enable the Gmail API',
  '3. Credentials → OAuth client ID → pick iOS / Android / Web',
  '4. Put the id in .env as EXPO_PUBLIC_GOOGLE_CLIENT_ID_<PLATFORM>',
  '5. Restart with: npm run web -- --clear',
].join('\n');

// ---------------------------------------------------------------- token store

interface StoredToken {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms. */
  expiresAt: number;
}

async function saveToken(token: StoredToken): Promise<void> {
  const raw = JSON.stringify(token);
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(TOKEN_KEY, raw);
  } else {
    await SecureStore.setItemAsync(TOKEN_KEY, raw);
  }
}

export async function loadToken(): Promise<StoredToken | null> {
  try {
    const raw =
      Platform.OS === 'web'
        ? globalThis.localStorage?.getItem(TOKEN_KEY)
        : await SecureStore.getItemAsync(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as StoredToken) : null;
  } catch {
    return null;
  }
}

export async function clearToken(): Promise<void> {
  if (Platform.OS === 'web') globalThis.localStorage?.removeItem(TOKEN_KEY);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function isConnected(): Promise<boolean> {
  const token = await loadToken();
  return !!token && token.expiresAt > Date.now();
}

// -------------------------------------------------------------------- auth

/**
 * The scheme Google requires for a native OAuth client.
 *
 * Google's Android and iOS client types do NOT accept an arbitrary app scheme
 * like `finlo://`. They only accept the "reversed client ID" —
 * `com.googleusercontent.apps.<id>` — and anything else comes back as
 * `redirect_uri_mismatch`. This is derived from the client id rather than
 * hardcoded so there is nothing to keep in sync.
 *
 * The scheme also has to be registered in app.json, or Android has no intent
 * filter to hand the callback back to us. `googleSchemeForConfig()` prints
 * exactly what to paste, and Settings shows it.
 */
export function googleNativeScheme(clientId: string): string {
  const suffix = clientId.replace(/\.apps\.googleusercontent\.com$/, '');
  return `com.googleusercontent.apps.${suffix}`;
}

/** The string to add to app.json's `scheme` array. Empty when unconfigured. */
export function googleSchemeForConfig(): string {
  const clientId = gmailClientId();
  return clientId ? googleNativeScheme(clientId) : '';
}

export function redirectUri(): string {
  // On web the origin itself is the redirect, and it must be listed as an
  // "Authorised redirect URI" on a *Web* OAuth client.
  if (Platform.OS === 'web') return AuthSession.makeRedirectUri();

  const clientId = gmailClientId();
  if (!clientId) return AuthSession.makeRedirectUri({ scheme: 'finlo', path: 'gmail-auth' });

  return AuthSession.makeRedirectUri({
    scheme: googleNativeScheme(clientId),
    path: 'oauthredirect',
  });
}

/**
 * Interactive consent.
 *
 * PKCE, no client secret — the correct public-client flow for a mobile app,
 * and the only safe one, since anything shipped in the bundle is readable.
 */
export async function connectGmail(): Promise<{ ok: boolean; error?: string }> {
  const clientId = gmailClientId();
  if (!clientId) return { ok: false, error: GMAIL_SETUP_HELP };

  try {
    const request = new AuthSession.AuthRequest({
      clientId,
      scopes: GMAIL_SCOPES,
      redirectUri: redirectUri(),
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
      extraParams: {
        access_type: 'offline',
        // Without this Google returns no refresh token on repeat consents,
        // and the connection silently dies after an hour.
        prompt: 'consent',
      },
    });

    const result = await request.promptAsync(DISCOVERY);
    if (result.type !== 'success' || !result.params.code) {
      return { ok: false, error: result.type === 'dismiss' ? 'Cancelled' : 'Consent failed' };
    }

    const token = await AuthSession.exchangeCodeAsync(
      {
        clientId,
        code: result.params.code,
        redirectUri: redirectUri(),
        extraParams: { code_verifier: request.codeVerifier ?? '' },
      },
      DISCOVERY
    );

    await saveToken({
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: Date.now() + (token.expiresIn ?? 3600) * 1000,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function validAccessToken(): Promise<string | null> {
  const stored = await loadToken();
  if (!stored) return null;
  // 60s of slack so a token doesn't expire mid-request.
  if (stored.expiresAt > Date.now() + 60_000) return stored.accessToken;
  if (!stored.refreshToken) return null;

  try {
    const refreshed = await AuthSession.refreshAsync(
      { clientId: gmailClientId(), refreshToken: stored.refreshToken },
      DISCOVERY
    );
    await saveToken({
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? stored.refreshToken,
      expiresAt: Date.now() + (refreshed.expiresIn ?? 3600) * 1000,
    });
    return refreshed.accessToken;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------- fetch

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** Gmail returns base64url, which is not what atob expects. */
function decodeBase64Url(data: string): string {
  const normalised = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  try {
    const binary = globalThis.atob(padded);
    // Round-trip through percent-encoding so multi-byte UTF-8 (₦, é) survives.
    return decodeURIComponent(
      Array.from(binary)
        .map((ch) => '%' + ch.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
    );
  } catch {
    return '';
  }
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
  headers?: Array<{ name: string; value: string }>;
}

/** Prefer text/plain; fall back to stripping the HTML alternative. */
function extractBody(payload: GmailPart | undefined): string {
  if (!payload) return '';
  const plain = findPart(payload, 'text/plain');
  if (plain?.body?.data) return decodeBase64Url(plain.body.data);
  const html = findPart(payload, 'text/html');
  if (html?.body?.data) return htmlToText(decodeBase64Url(html.body.data));
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  return '';
}

function findPart(part: GmailPart, mimeType: string): GmailPart | null {
  if (part.mimeType === mimeType && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return null;
}

function header(headers: Array<{ name: string; value: string }> | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

export interface FetchOptions {
  since: string;
  /** Hard cap on messages per sync, so a first connect can't fetch 5,000. */
  max?: number;
  onProgress?: (done: number, total: number) => void;
}

export async function fetchCandidateEmails(
  opts: FetchOptions
): Promise<{ ok: true; messages: EmailMessage[] } | { ok: false; error: string }> {
  const token = await validAccessToken();
  if (!token) return { ok: false, error: 'Not connected to Gmail, or the session expired.' };

  const max = opts.max ?? 100;
  const query = buildGmailQuery(opts.since);
  const auth = { Authorization: `Bearer ${token}` };

  try {
    const listResponse = await fetch(
      `${API}/messages?q=${encodeURIComponent(query)}&maxResults=${max}`,
      { headers: auth }
    );
    if (!listResponse.ok) {
      return { ok: false, error: `Gmail list failed (${listResponse.status})` };
    }
    const list = await listResponse.json();
    const ids: string[] = (list.messages ?? []).map((m: { id: string }) => m.id);
    if (ids.length === 0) return { ok: true, messages: [] };

    const messages: EmailMessage[] = [];
    // Sequential rather than Promise.all: Gmail rate-limits per user, and a
    // burst of 100 parallel gets returns 429s that look like an outage.
    for (const [i, id] of ids.entries()) {
      const detail = await fetch(`${API}/messages/${id}?format=full`, { headers: auth });
      if (!detail.ok) continue;
      const msg = await detail.json();
      const headers = msg.payload?.headers;
      messages.push({
        id: msg.id,
        from: header(headers, 'From'),
        subject: header(headers, 'Subject'),
        body: extractBody(msg.payload),
        receivedAt: new Date(Number(msg.internalDate ?? Date.now())).toISOString(),
      });
      opts.onProgress?.(i + 1, ids.length);
    }
    return { ok: true, messages };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
