/**
 * The user's AI kill switch — a cost lever, not a capability check.
 *
 * `llmStatus()` answers "is there a transport for an AI call" (a proxy URL or a
 * key). This answers a different question: "does the user want to spend on it
 * right now." They are separate on purpose — a key can be perfectly configured
 * and the owner can still want it off because the bill is climbing, or later
 * want it on only for premium.
 *
 * Held as a module-level flag rather than read from the store because the
 * dependency edge points the other way: `ingest` must not import the store, or
 * Metro closes a cycle and hands back a half-initialised module (a failure this
 * codebase has lost a day to before). So the store pushes the value in — on
 * load, and whenever the setting changes — and everything on the AI path reads
 * it from here.
 *
 * Default on: a fresh install with a key configured should just work. The whole
 * point of the switch is turning it *off*.
 *
 * This is the client-side lever. The real, unbypassable one is the proxy
 * (`server/llm-proxy`), where `DISABLED=1` or a rotated token cuts every copy
 * off server-side — a client flag can be edited out of a bundle, a server one
 * cannot. The two work together: this is the free, instant switch; the proxy is
 * the one that holds when the APK is in a stranger's hands.
 */

let enabled = true;

/** Called by the store from the persisted `ai_enabled` setting. */
export function setAiEnabled(on: boolean): void {
  enabled = on;
}

/** Whether the user currently wants AI calls to happen at all. */
export function aiEnabled(): boolean {
  return enabled;
}
