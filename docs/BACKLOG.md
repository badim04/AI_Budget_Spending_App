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
`RecurringCandidate`; Budgets surfaces suggestions. The gap is precision.

**What would make it wrong.** Proposing a rule from two occurrences. A wrong
recurring rule pollutes the forecast and the "coming up" row, and both are
things people plan around.

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

**The Gemini key ships inside the APK.** Anyone who unzips it can read it. The
owner accepted this while testers are people he knows.
`server/llm-proxy/` is written, tested (16 tests) and ready — deploying it moves
the key server-side and makes the token rotatable over the air.

**Do this before the APK goes to strangers.** It is the one item here with a
deadline attached to it.

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
