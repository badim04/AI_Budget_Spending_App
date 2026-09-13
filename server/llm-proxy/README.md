# Finlo LLM proxy

Keeps your Gemini key off testers' phones. Free, no card, ~3 minutes.

## Why you need this before sending the APK around

`EXPO_PUBLIC_GEMINI_API_KEY` is compiled into the JavaScript inside the APK.
Anyone who receives that file can unzip it and read the key in about a minute —
no skill required. They can then spend your quota, and on a billed key, your
money.

This worker holds the key on Cloudflare instead. The app talks to the worker,
the worker talks to Gemini. What ships to testers is just a URL.

## Deploy

```bash
cd server/llm-proxy
npm install
npx wrangler login
```

Set the two secrets. These are stored on Cloudflare, never in the repo, never in
the app:

```bash
npx wrangler secret put GEMINI_API_KEY
# paste your Gemini key when prompted

npx wrangler secret put APP_TOKEN
# paste any long random string, e.g. from:  openssl rand -hex 24
```

Deploy:

```bash
npm run deploy
```

You get a URL like `https://finlo-llm-proxy.<your-subdomain>.workers.dev`.

## Point the app at it

In the app's `.env`:

```
EXPO_PUBLIC_LLM_PROXY_URL=https://finlo-llm-proxy.your-subdomain.workers.dev
EXPO_PUBLIC_LLM_PROXY_TOKEN=the_random_string_you_just_set

# Delete this line, or leave it blank. The proxy wins whenever it is set,
# but leaving a real key here means it still ships in the bundle.
EXPO_PUBLIC_GEMINI_API_KEY=
```

Then rebuild (`.env` values are baked in at build time):

```bash
npm run apk
```

Settings → Smart categorisation should read **AI fallback: Proxy**, with no
warning triangle.

## The model, and Ask / summaries

The proxy defaults to `gemini-3.6-flash` and relays **every** AI feature — the
categoriser, **Ask Finlo**, and the **month summary** — so one deployment covers
all of them. (It used to serve categorisation only, which is why Ask through a
proxy answered nothing.) To pin a different model without touching code, set it
in `wrangler.toml` and redeploy:

```toml
[vars]
GEMINI_MODEL = "gemini-3.6-flash"
```

The old code was pinned to `gemini-2.0-flash`, which Google has retired — if a
deployment predates this note, redeploy so it stops 404ing.

## Add rate limiting (recommended, 1 command)

Without this, the batch caps keep any single request cheap, but nothing stops a
loop.

```bash
npx wrangler kv namespace create RATE_LIMIT
```

Paste the printed id into `wrangler.toml`, uncomment the `[[kv_namespaces]]`
block, and `npm run deploy` again. That gives you 60 requests per IP per hour.

## What this does and does not protect

**Fully protected: your Gemini key.** It never leaves Cloudflare. This part is
absolute — that is the whole point of the proxy.

**Not fully protected: the endpoint itself.** `APP_TOKEN` also ships in the
bundle, so a determined person who unpacks the APK can call your worker. What
you gain is control you did not have before:

| | Key in the APK | Behind this proxy |
|---|---|---|
| Someone extracts the credential | Your Gemini key | A token that only works with your worker |
| Revoking it | Everyone must reinstall | Change `APP_TOKEN`, `npm run push` — done in a minute |
| Spend ceiling | Whatever Google allows | Whatever you set here |
| Turning the feature off | Impossible | `DISABLED = "1"`, redeploy |
| Rate limiting | None | Per IP, per hour |

For a test build going to friends and a few strangers, that is the right trade.

## Operating it

```bash
npm run tail        # live logs
npm run deploy      # after any change
```

Kill switch: set `DISABLED = "1"` in `wrangler.toml`, `npm run deploy`. The app
degrades cleanly — unrecognised merchants just go to the review queue, which is
what happens with no AI configured at all.

Rotate the app token: `npx wrangler secret put APP_TOKEN`, update
`EXPO_PUBLIC_LLM_PROXY_TOKEN` in `.env`, then `npm run push -- "rotate token"`.
Every copy picks it up on next launch.

## Costs

Cloudflare Workers free tier: 100,000 requests/day. Gemini Flash free tier is
generous and the app only calls it for descriptors the offline categoriser
cannot recognise — which for a normal user is a handful per month, not per day.
Set a quota cap in [Google AI Studio](https://aistudio.google.com/apikey)
regardless.
