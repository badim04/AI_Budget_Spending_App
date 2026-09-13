# Accounts, login & sync — the plan you asked for

A step-by-step you can do later, in order, each step small enough to stop after.
Nothing here is built yet — this is the map. Decision already made (2026-08-28):
**real accounts with email sign-in and sync**, not just a local device lock.

> Why this is the biggest item in the app: it is not a screen. It makes Finlo a
> *controller of other people's financial data*, which brings a privacy policy
> and a breach duty. **Half-built auth is worse than none** — do the steps in
> order and don't ship sign-in before recovery (step 6) exists.

---

## What's already in place (so you're not starting from zero)

- **A backend seed:** `server/llm-proxy/` is a live Cloudflare Worker with tests.
  The account backend grows from here, not from something new.
- **Secure token storage on the phone:** `expo-secure-store` is already used
  (Gmail keeps its token there). Sessions go in the same place.
- **A storage abstraction:** the app reads/writes through a repository layer
  (`src/db/repository`), so adding a sync layer doesn't touch the screens.
- **The honest placeholder:** Settings › "Sign-in and app lock: Not set up" is
  the row that gets replaced when this lands.

---

## What you need to go and get (accounts to create)

Do these once, up front. All have free tiers big enough to start.

| # | Thing | Where | Why | Cost to start |
|---|---|---|---|---|
| 1 | A database | Cloudflare **D1** (SQLite, same dashboard as the Worker) or **Supabase** (Postgres) | Store users, sessions, and the synced ledger | Free |
| 2 | An email sender | **Resend** or **Postmark** | Send the 6-digit sign-in codes | Free tier |
| 3 | A privacy policy | A generator + a lawyer's eye, or iubenda | You're storing financial data — legally required first | Low |
| 4 | A domain (optional but wise) | Namecheap / Cloudflare | `api.finlo.app`, branded sign-in emails | ~$10/yr |

**Chosen (2026-09-10): Supabase**, to match the owner's other projects. It
collapses three of the steps below into one service — email-OTP **auth**,
Postgres with **row-level security** for sync, and **Storage** buckets for
receipt files — so there is no separate auth server, no email provider, and no
hand-rolled session table to get wrong. The Cloudflare Worker in
`server/llm-proxy/` stays exactly as it is (it holds the Gemini key); Supabase
does not touch it. Two services, each doing the thing it is best at.

Keys the app needs (public, safe to ship — RLS is what protects the data):
`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`, set with
`eas env:set` the same way the other keys were.

---

## The steps, in order

### Step 0 — Privacy policy & compliance (BEFORE any data is stored)

- Write a privacy policy: what you store (transactions, email), where (Cloudflare
  region), how long, how someone deletes their account and data.
- Nigeria is the market → **NDPR** applies; testers elsewhere → **GDPR**. Both
  need: a lawful basis, a delete-my-data path, and breach notification.
- Add a "Delete my account" path to the plan now, even though it's built last —
  designing without it is how you end up unable to honour a deletion request.

**Do not write a single row to a server before this exists.**

### Step 1 — Backend foundation (Supabase project + schema)

- Create the project at supabase.com, copy the URL + anon key into
  `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
- Run **`server/supabase/schema.sql`** in the SQL editor. It creates one generic
  `sync_items` table `(user_id, entity, entity_id, updated_at, deleted, version,
  payload jsonb)`, turns on RLS so a row is only ever visible to the user who
  owns it, a `profiles` table, the private `receipts` Storage bucket with a
  per-user path policy, and a `delete_my_account` function.
- **Why one generic table, not one per entity:** the local model evolves; a
  JSONB payload keyed by `(entity, entity_id)` keeps the server schema stable and
  still supports per-row conflict detection by `updated_at` + `version`.
- Status: **schema written this turn.** Client wiring is env-gated — with no keys
  set, the app behaves exactly as it does today.

### Step 2 — Auth (Supabase email OTP — no email provider to wire)

- Supabase Auth sends the 6-digit code itself (`signInWithOtp`), verifies it
  (`verifyOtp`), and manages the session. No Resend, no `/auth/*` routes, no
  session table.
- Session persistence: a **`expo-secure-store`** storage adapter (already used
  for the Gmail token), not AsyncStorage — no new native module, ships over the
  air.

### Step 3 — Sign-in flow

- A sign-in screen (email → code → done) calling `signInWithOtp` / `verifyOtp`.
  Replaces the Settings "Sign-in and app lock" row.
- Optional by design: the app must still work fully signed-out (it does today).
  Sign-in *adds* sync; it never gates the app.

### Step 4 — Sync

- Push: on change, upsert the changed rows into `sync_items` (one row per
  entity), each stamped with the local `updatedAt` and a bumped `version`.
- Pull: on launch and on demand, `select` rows where
  `server_updated_at > lastPulled`, and merge by id.
- **Surface conflicts, never resolve them silently.** When the incoming
  `version` is not a clean descendant of the local one, don't overwrite — mark
  the row and let the user pick, the same way the import reconciler refuses
  rather than guesses. Receipt files sync separately: upload to the `receipts`
  bucket under `auth.uid()/…`, store only the path in the payload.

### Step 5 — Guardrails & limits

- A per-user row cap (a runaway sync shouldn't fill the free tier).
- Encrypt-at-rest is on by Supabase default; document it in the policy.
- `delete_my_account`: the SQL function removes the user's `sync_items`,
  `profiles` row and receipt files. Fully removing the **auth** user needs the
  service role, so it runs in a small Supabase **Edge Function** (service key
  stays server-side, never in the app) — build it with this step.

### Step 6 — Recovery (ship-blocker — build before releasing sign-in)

- People lose access to email. A ledger that syncs but can't be recovered is
  **worse** than one that never synced.
- Minimum: a recovery code shown once at sign-up that re-associates an account.
- Only after this works does sign-in go into a build testers get.

---

## Order & rough effort

1. Privacy policy (step 0) — a day, mostly writing, do first.
2. Backend + DB + email + sign-in (steps 1-3) — the core lift.
3. Sync (step 4) — the subtle part; conflict handling is most of it.
4. Recovery + delete (steps 5-6) — small code, non-negotiable before release.

Bank feeds (Mono/Okra) and billing reuse this same backend later — build it
once, well.

## What would make it wrong (from the backlog, kept here so it's next to the plan)

- Storing data server-side **without the privacy policy in place first**.
- Shipping sign-in **before recovery** exists.
- Any sync that **resolves conflicts silently**.
