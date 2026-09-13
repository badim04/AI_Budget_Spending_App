# Backlog

Everything known but not built, written so each item can be picked up cold.

Each entry says **what**, **why it is not done**, **where to start**, and **what
would make it wrong** — that last one because most of the traps in this codebase
were only obvious after being hit.

Ordered by what unblocks the most. Update this file when an item lands; delete
the entry rather than marking it done, because a backlog of ticked items is just
another thing to read past.

> Companions: `docs/HANDOFF.md` (state, rules, design system),
> `docs/ARCHITECTURE.md` (why the code is shaped this way).

---

## 1. Accounts and sync — **chosen, not started**

**Decision made 2026-08-28:** real accounts (email codes + sync), *not* a local
device lock. The owner was offered both and picked accounts.

> **Step-by-step plan written 2026-09-03: `docs/ACCOUNTS_AND_BACKEND.md`.** It
> lists the accounts to create (Cloudflare D1 + Resend recommended), the ordered
> phases (privacy policy → backend → email codes → sign-in → sync → recovery),
> and the effort. Start there; this entry is the summary.

**Why it is not done.** It is not a screen. It needs a server, session and token
handling, email delivery, and it makes this project a **controller of other
people's financial data** — which brings a privacy policy and NDPR/GDPR
obligations, plus a breach duty. Half-built auth is worse than none, so it was
not started inside a feature batch.

**Where to start.**
- `server/llm-proxy/` is already a Cloudflare Worker with tests. Grow the
  backend from there rather than standing up something new.
- Settings › Account currently states the position honestly ("no sign-in, no app
  lock, anyone who can open your phone can open Finlo"). That row is what gets
  replaced.
- The device-lock alternative (`expo-local-authentication`, ~1–2 hrs, no server)
  is still the cheap stopgap if accounts stall. It was not chosen, but it is not
  ruled out as an interim.

**What would make it wrong.**
- Storing financial data server-side without a privacy policy in place first.
- Shipping sign-in before there is account *recovery* — people lose access to
  email, and a ledger that cannot be recovered is worse than one never synced.
- Any sync design that resolves conflicts silently. Money data needs the
  conflict surfaced, the same way the import reconciler refuses rather than
  guesses.

---

## 2. Billing

Only matters if `/premium` is ever to be more than a plan page.

Today that page shows plans and prices and **deliberately does not sell**: no
payment processor, no entitlement check, nothing behind the paywall. It says
"Not on sale yet" at the top and the CTA registers interest.

**Where to start.** The page keeps its layout; the CTA changes. Needs a
processor (Paystack or Flutterwave make sense for NGN), and an entitlement check
the app can read offline — otherwise a paid user on a plane loses their features.

**What would make it wrong.** Putting anything behind the paywall that is free
today. The page currently promises "free today, and staying free" for statement
import, receipts, budgets, goals, forecasting, the health score and reports.

---

## 3. Screens without the responsive / design pass

`/reports` and `/review` still take their width from the layout but have not had
the structural pass the tab screens got — check them against the standing rule:
**no screen ships as a single column of identical rectangles.**

**Where to start.** `src/components/ui/Screen.tsx` (`Screen`, `Grid`, `Split`)
and `src/theme/layout.ts` (`useLayout`, `columnsFor`) are the whole vocabulary.
`app/(tabs)/capture.tsx` is the cleanest recent example of the conversion.

---

## 4. Illustrations on Budgets list items

Goals cards now carry a `Spot` at watermark weight. Budget envelopes do not.

**Where to start.** `src/components/art/Spot.tsx` — eight scenes, each takes a
`TileTone` and recolours to it. The Goals card in `app/(tabs)/goals.tsx` shows
the pattern (absolute-positioned, ~0.1 opacity, bled off the corner).

---

## 5. Recurring-rule auto-detection

The date maths is done (`occurrencesBetween`, `toMonthlyEquivalent`,
`detectRecurring`). What is missing is clustering transactions into proposals
good enough to show without annoying anyone.

**Where to start.** `src/core/recurring.ts` already has `detectRecurring` and
`RecurringCandidate`; Budgets surfaces suggestions. The gap is precision. The AI
labelling in the next section is the natural finish: local clustering finds the
candidate, the model names it ("this looks like your Netflix").

**What would make it wrong.** Proposing a rule from two occurrences. A wrong
recurring rule pollutes the forecast and the "coming up" row, and both are
things people plan around.

---

## 5a. AI features — foundation built 2026-09-03, three still to build

The plumbing is done and shipped: a **kill switch** (`src/ingest/aiToggle.ts`,
Settings → Use AI — the instant, free cost lever), a **shared free-text
transport** (`src/ingest/llmText.ts`, proxy-or-key in one place), and the
**proxy now relays every AI feature** (`server/llm-proxy/worker.js` — free-text
`{prompt}` path + configurable model). The first feature, the **month summary**
(`src/ingest/summary.ts`, surfaced in Insights), is live. So a new AI feature is
now: build a brief from the tested core → call `generateText` → gate on the
switch. Three remain:

- **Recurring-bill labelling.** Feed `detectRecurring` candidates to the model
  for a human name; user confirms. Pairs with item 5. Cheap: one short call.
- **Merchant naming.** Turn `TRF/OPAY/REF12345` into "OPay transfer" for cleaner
  history. Do it in the review queue, on demand, never silently overwriting a
  name the user set.
- **Natural-language search / add.** "how much on transport in July?" or "add
  ₦3k lunch yesterday" parsed into a query or a staged transaction. The biggest
  of the three — needs a parse-to-structure step and a confirmation before any
  write. Reuse `core/factSheet`'s redaction for anything sent out.

**What would make it wrong.** Any feature that lets the model produce a *number*
the tested core did not compute (see `core/factSheet` and `ingest/summary` — the
model phrases, it never calculates). And auto-spending: every one of these is a
paid call, so it fires on a tap, not on a screen opening.

**Cost/premium gating.** The client switch is instant but bypassable; the
**proxy** is the real lever (`DISABLED=1`, rotate the token, per-IP rate limit —
all over the air). Premium-gating enforced server-side belongs there once
billing exists (item 2), not in the client.

---

## 5b. Full UI text translation (i18n) — **decided against for now**

**What is done (2026-09-09):** locale-aware *formatting*. Numbers, currency
symbol placement and dates follow the device locale, overridable in
Settings → Number & date format. The engine is `src/core/locale.ts` (a module
variable read by `formatMoney` and `formatDate`, default `en-US` so every test
stays deterministic), detected with `Intl` and **no native module**, so it ships
over the air. `formatMoney` moves the symbol to the suffix where the locale wants
it ("1.234,56 €"); `formatDate` reorders and renames months for non-English
locales and keeps the hand-built English format otherwise. Tests: `locale.test.ts`.

**What is NOT done:** translating the app's *text*. Every label is still English.

**Why it is not done.** The owner chose formatting-first. Full translation is
large and, done carelessly, mistranslates financial terms — `core/greeting.ts`
already warns its own greetings need a native speaker's eye. It needs a `t()`
system, every string extracted, and real translations (machine translation of a
finance UI is a trap).

**Where to start.** Add a tiny `src/core/strings.ts` keyed by the same locale
`getActiveLocale()` already resolves; wrap UI strings; get native review per
language. The Nigerian languages in `greeting.ts` (yo/ig/ha/pcm) and French are
the natural first targets. Do not ship a language until a native speaker has read
the money-related strings.

---

## 5c. Statement reading for more banks — **hardened 2026-09-09, still OPay-proven only**

**What is done.** Header detection now recognises French/German/Spanish/
Portuguese column names (a non-English CSV previously failed header detection and
imported *nothing*), and `parse.ts` now learns day-first vs month-first from the
file's own evidence (`detectDateOrder`) so a US statement of ambiguous dates is
not silently misdated into the wrong month — an error the reconciler cannot catch,
because moving a row between months changes no total. Tests:
`statementInternational.test.ts`.

**What would make it wrong / still open.**
- **A bank that prints no totals in its preamble** gets no reconciler safety net
  (`reconcile.ts` needs the bank's own arithmetic). For those, a misread column
  is still a plausible-wrong number. The header/date work is additive and cannot
  regress OPay (`statementFiles.test.ts` pins it to the kobo), but it cannot
  *prove* another bank either.
- **PDF x-coordinate column recovery** (`statement/sources.ts`) is exact on OPay
  and untested elsewhere; a different layout could still mis-assign a column.
- Best next step remains **a real sample from a failing bank**, fixed against its
  own ground truth the way OPay was.

---

## 6. Bank feeds (Mono / Okra / Plaid)

Deferred deliberately since v1. They cost money per connected account, need a
server (the secret cannot live in the app bundle), and statement import covers
most of the ground for free. Revisit after accounts exist — same backend.

---

## 7. iOS build

Needs a paid Apple Developer account ($99/yr). Nothing in the code blocks it.

---

## 8. PowerPoint export

Asked for once, deliberately deferred: niche, and no good React Native library.
PDF, Excel and CSV all work.

---

## Security debt, still open

**The Gemini key still ships inside the APK** until the proxy is *deployed*.
Anyone who unzips the APK can read the key. The owner accepted this while testers
are people he knows.

`server/llm-proxy/` is written, tested (**20 tests**) and, as of 2026-09-03,
improved: it no longer pins the retired `gemini-2.0-flash` (model is now
`GEMINI_MODEL`-configurable), and it relays **every** AI feature, not just
categorisation. Deploying it moves the key server-side and makes the token
rotatable over the air — the deploy is a **user step**, ~3 minutes, see
`server/llm-proxy/README.md`.

Partial mitigation now in the app: a **client AI kill switch** (Settings → Use
AI) turns off all Gemini calls instantly. It is free and immediate but bypassable
in a bundle — it reduces *cost* exposure, not *key* exposure. Only the deployed
proxy fixes the key.

**Deploy the proxy before the APK goes to strangers.** It is the one item here
with a deadline attached to it.

---

## Things that are deliberately NOT on this list

So nobody re-proposes them:

- **A "spending score" that grades unmeasured things.** `core/health.ts` refuses
  to score insurance or pensions because the app cannot see them. Adding them as
  zeros would tell someone with excellent finances they were failing.
- **Stored streaks.** `core/challenges.ts` recomputes from the ledger every
  time. A stored streak survives a deleted transaction and starts lying.
- **A tolerance on import reconciliation.** Money is integer minor units on both
  sides and the bank's totals are exact. A threshold there would be a threshold
  on how wrong someone's financial history is allowed to be.
