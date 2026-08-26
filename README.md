# Finlo

<img src="assets/icon.png" width="88" alt="Finlo" align="right" />

Multi-currency personal finance for **Android, iOS and web from one codebase**
(Expo + React Native + react-native-web). Daily → annual budgeting, forecasting,
and automatic capture from receipts and email.

Status: **runs end to end** — add, categorise, budget, forecast, capture receipts
and import from Gmail, with data persisted on device. See
[What's done vs what isn't](#whats-done-vs-what-isnt) for the honest list.

```bash
npm install
npm test                    # 347 tests, no device or emulator needed
npm run web                 # in a browser at localhost:8081
npm start                   # QR code -> Expo Go on your phone

npm run apk                 # build a shareable Android APK
npm run push -- "message"   # ship a JS update to everyone, no reinstall
```

**Shipping to testers, and where to get the optional API keys:
[docs/SHIPPING.md](docs/SHIPPING.md).**

**Picking this up in a new session? Start at [docs/HANDOFF.md](docs/HANDOFF.md).**

First run is empty; **Settings → Load demo data** fills it with eight months of
generated history so the charts and forecasts have something to show. `npx expo-doctor` passes 18/18, and `npx expo export
--platform web` builds all 19 routes with no warnings.

> **Dependency versions are managed by Expo, not by hand.** If you add a package,
> use `npx expo install <pkg>` rather than `npm install <pkg>`. Hand-pinned
> versions are what caused the initial `expo-asset cannot be found` failure —
> npm nested it under `node_modules/expo/` instead of hoisting it, and Metro
> resolves that package from the project root. `npx expo install --fix` repairs
> a tree that has drifted.

### Known issues

- `"shadow*" style props are deprecated` warning from react-native-web 0.19 —
  comes from `elevation.card` in the theme, harmless until RN Web 0.20.
- Web stores data in `localStorage` (no SQLite wasm build exists for SDK 52), so
  it is per-browser and cleared with site data. Phones use real SQLite.

---

## What it does

**Money that doesn't drift.** Every amount is an integer count of minor units
(kobo, cents, satang) — floats never touch a balance. Splitting ₦10,000 three
ways gives 3334/3333/3333, not three lots of 33.33 that quietly lose a kobo.
Multi-currency from day one: mixing currencies in arithmetic throws rather than
guessing, and conversion goes through a dated FX table so the rate used is a
recorded decision.

**Budgets that know what day it is.** "60% of your food budget is gone" is not
information. Every envelope is judged against elapsed time, so 60% on the 25th
reads as on track and 60% on the 5th raises a flag. Rollover, reset and
averaging policies; per-day safe-to-spend; a projected run-dry date.

**Forecasts that admit uncertainty.** Three models (Holt linear trend, seasonal
naive, mean) compete on a rolling-origin backtest; the winner ships with its
error rate attached, so a shaky forecast is labelled shaky instead of drawn as a
confident line. Prediction bands widen with the horizon. Scheduled bills are
projected as facts on their actual dates rather than smoothed into an average —
which is what makes the "you go negative on the 19th" warning trustworthy.

**Input that mostly isn't input.** Photograph a receipt or connect Gmail
read-only. A four-layer categoriser (your rules → what you've filed before →
a shipped merchant lexicon → LLM fallback) files it, and a dedupe key stops the
same payment arriving twice from a bank alert and a receipt. Nothing is written
silently unless both the extraction *and* the categorisation are confident;
everything else lands in a review queue with the guess pre-filled.

**Receipts are kept.** Stored on device with OCR text indexed for full-text
search — "which receipt had the router on it?" works.

---

## What's done vs what isn't

### Working end to end

| Area | Where | Tests |
|---|---|---|
| Money, multi-currency, FX, allocation | `src/core/money.ts` | 34 |
| Calendar, periods, recurrence | `src/core/dates.ts` | 30 |
| Budget engine, pace, rollover | `src/core/budget.ts` | 28 |
| Forecasting, backtesting, anomalies | `src/core/forecast.ts` | 26 |
| Auto-categorisation (4 layers) | `src/core/categorize.ts` | 26 |
| Receipt parsing from OCR text | `src/ingest/receipt/parse.ts` | 30 |
| Email parsing + sender verification | `src/ingest/email/parse.ts` | 20 |
| Analytics, insights, net worth | `src/core/analytics.ts` | — |
| Ingestion pipeline (dedupe, staging) | `src/ingest/pipeline.ts` | — |
| **Persistence** — SQLite (phone) / localStorage (web) | `src/db/repository*.ts` | — |
| **App state + CRUD** | `src/store/useAppStore.ts` | — |
| **Add / edit / delete transactions** | `app/transaction/new.tsx` | — |
| **Receipt capture** — camera, library, storage | `src/ingest/receipt/capture.ts` | — |
| **Gmail OAuth + fetch + import review** | `src/ingest/email/gmail.ts`, `app/review.tsx` | — |
| **Settings** — currency, accounts, demo data, reset | `app/(tabs)/settings.tsx` | — |
| **Recurring-rule detection** | `src/core/recurring.ts` | 21 |
| **AI categorisation fallback (Gemini)** | `src/ingest/llm.ts` | 13 |
| **Budget alert notifications** | `src/lib/notifications.ts`, `src/core/alerts.ts` | — |
| **Goals** | `app/(tabs)/goals.tsx` | — |
| Navigation — bottom bar on phones, side rail >=600pt | `app/(tabs)/_layout.tsx`, `src/components/ui/SideNav.tsx` | — |
| **Batch receipt capture** (up to 20) | `src/ingest/receipt/capture.ts`, `app/receipts.tsx` | — |
| **Statement import** — PDF, Excel, CSV, TXT | `src/ingest/statement/*` | 24 |
| **Report export** — PDF, Excel, CSV | `src/reports/*`, `app/reports.tsx` | 18 |
| **Permissions** — request, and deep-link when blocked | `src/lib/permissions.ts` | — |
| Design system, charts, 14 screens | `src/theme`, `src/components`, `app/` | — |

`src/core`, `src/db/schema.ts`, `src/db/seed.ts` and `src/ingest` typecheck clean
under `--strict` and import no React Native, which is why they run in plain Node.

### Needs a key you supply

Fully wired; they switch on when the key is present. Step-by-step:
[docs/SHIPPING.md](docs/SHIPPING.md).

- **Receipt OCR** — free key from ocr.space. Without it receipts are still
  captured, stored and searchable; you type the amount.
- **Gmail** — a Google OAuth client id from your own Cloud project. Needs the
  SHA-1 from your first EAS build, so build the APK first.
- **Gemini** (AI categorisation) — configured. Note the key ships in the bundle;
  cap its quota and move to `EXPO_PUBLIC_LLM_PROXY_URL` before a public release.

### Not built

- **Accounts / login** — no auth at all yet. Open decision: device lock
  (PIN + biometric, no server) vs real accounts (email codes, backend, sync).
- **Bank feeds** (Mono/Okra/Plaid) — deferred to v2. Statement import covers the
  same ground with no provider account and no server.
- **PowerPoint export** — deferred; PDF, Excel and CSV are built.
- **Editing a detected recurring rule** — add and delete work; editing does not.

---

## Layout

```
app/                     expo-router routes (file = screen)
  (tabs)/                home · activity · add · budgets · insights
src/
  core/                  pure domain logic — no React, no I/O, fully tested
  db/                    SQLite schema, seed categories, demo data
  ingest/                receipt + email parsing, the staging pipeline
  theme/                 design tokens, ThemeProvider
  components/            charts and UI primitives
tests/                   vitest, runs against src/core and src/ingest
docs/ARCHITECTURE.md     why it is built this way
```

## Design notes

Dark-first — a money app gets opened in bed and at checkout counters, so dark is
the designed surface and light is derived from the same ramps.

The categorical chart palette is validated, not eyeballed: worst adjacent
colour-vision-deficient separation ΔE 9.1 light / 8.4 dark, worst normal-vision
ΔE 19.6 / 19.3, checked against the actual app surfaces. Colour never carries
meaning alone — every series is directly labelled, every status ships with an
icon and a word. A ninth category folds into "Other" rather than inventing a
hue that collides with one already on screen.

## Security posture

- Email and receipt content is **untrusted input**. It is scanned for declared
  patterns only; nothing in a message is executed or followed as an instruction.
  There's a test for exactly that.
- Bank templates are gated on a **verified sender domain** with proper suffix
  matching, so `gtbank.com.phish.example` cannot pose as `gtbank.com`. Body-only
  matches are always low confidence and always go to review.
- Gmail access is `gmail.readonly` and the query is narrowed to money-shaped mail
  rather than the whole mailbox.
- Receipts stay on device by default. Sync is opt-in.
- No secrets in the repo — see `.env.example`.
