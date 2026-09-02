# Finlo — handoff

Everything a new session needs to continue. Written 2026-08-25,
updated 2026-08-26 (statement import correctness, review UX).

---

## What this is

**Finlo** — multi-currency personal finance for Android, iOS and web from one
codebase. Expo SDK 52 + React Native 0.76 + TypeScript, expo-router.

- **Project:** `C:\Users\user\Documents\GitHub\AI Budget Spending App`
- **Package:** `com.badim04.finlo` · **version** 1.2.0 · **versionCode** 3
- **Expo:** owner `badim04s-team`, slug `budgetspenderappfinlo`,
  projectId `240fc2a2-71ba-4e64-b2b8-29efd995522d`
- **Git:** remote is `github.com/badim04/AI_Budget_Spending_App`. **Nothing is pushed yet** — every commit below is local.
  - `v1.1.0` is a tag and `master` points at it: `git checkout v1.1.0`
  - work in progress is on branch **`v1.2`**
  - real bank statements are gitignored — they carry a real name, address and
    account number, and `tests/fixtures.ts` says so loudly when they are absent
- **574 tests pass, none skipped**, `tsc --noEmit -p tsconfig.json` is clean,
  `npx expo-doctor` passes.

Owner is in Nigeria; default currency NGN. Testers are real people getting an
APK link, including strangers.

---

## Read these first

| File | Why |
|---|---|
| `docs/BACKLOG.md` | **Everything not built**, each item startable cold |
| `docs/ARCHITECTURE.md` | Why the code is shaped this way, and the traps already hit |
| `docs/SHIPPING.md` | Build, OTA update, and every key/credential step |
| `docs/SETUP.md` | Running it, Expo Go, troubleshooting |
| `README.md` | Feature status — what works vs what doesn't |

---

## The rules that cost real time to learn

1. **Metro caches aggressively.** When behaviour does not match the code,
   restart with `npm start -- --clear` *before* debugging. This sent a whole
   session chasing a bug that was already fixed.
2. **Bumping `version` cuts off every phone running the old one.**
   `runtimeVersion.policy` is `appVersion`, so the OTA runtime *is* the version
   string. Changing `version` from 0.1.1 to 1.2.0 means an `eas update` now
   targets runtime `1.2.0`, and a handset still carrying the 0.1.1 binary will
   never be offered it — silently, because there is no error for "no update
   matches your runtime". After any version bump the next release has to be an
   APK; OTA resumes once that build is installed.

   The reverse bit someone too: v1.2's whole feature set shipped inside a binary
   still reporting **0.1.1** in Settings, because `app.json` had not been
   touched. The app was right and the number was wrong, which reads exactly like
   a failed build.

3. **A new native module means a new APK, and `--clear` first.**
   `expo-linear-gradient` was added in v1.2. Installing it left Metro's dev
   cache stale, and every route 500'd with
   `Cannot read properties of undefined (reading 'get')` — a bundler error that
   looks nothing like "you added a native module". `npx expo start --clear`
   fixed it in one go. On device, a native dependency cannot ship over the air:
   that release needs `npm run apk`, and OTA works again from the next one.

   **Never `npm install <expo-pkg>`** — always `npx expo install`. And removing
   packages prunes transitive deps: that silently deleted `expo-web-browser`
   (needed by expo-auth-session) and crashed Settings and Add on device while
   web, the bundler and every test stayed green. `tests/dependencies.test.ts`
   now guards it.
3. **A platform variant must never import its own base name.** On native Metro
   resolves `./repository` to `repository.native.ts` — itself. Re-exporting from
   that self-import made Metro emit a getter returning itself: infinite
   recursion, app dead at launch. Shared code lives in `repositoryShared.ts`.
   `tests/moduleGraph.test.ts` guards it.
4. **`.env` is gitignored, and EAS builds from git.** Local `.env` works for
   `npm run web` and never reaches the APK. Build-time keys must be set with
   `eas env:create` (now `eas env:set`) per environment.
5. **Get the real crash log.** `adb logcat` ended two multi-hour guessing
   sessions in minutes (`npm run logcat` filters it). PowerShell writes UTF-16,
   so decode before grepping.
7. **Never let the database enforce a guess, and never claim a write that has
   not happened.** A UNIQUE index on `dedupe_key` plus an unawaited optimistic
   write silently lost a tester's entire 228-row import. See ARCHITECTURE.
8. **Node and Chrome have APIs the phone does not.** `new TextDecoder('latin1')`
   at module scope killed the app the moment the import screen was required —
   Expo's polyfill decodes UTF-8 only. Tests, web and the bundler were all
   green. Decode bytes with `src/ingest/bytes.ts`;
   `tests/runtimeCompat.test.ts` guards it. And test on device with a **dev
   build**, where an error is a red screen instead of the app closing.

---

## Architecture in one paragraph

`src/core` is pure — no React, no I/O — so the financial logic is tested in
plain Node in under a second. Money is integer minor units, never floats;
`fromDecimal` scales the decimal *string* because `Math.round(1.005 * 100)` is
100, not 101. Dates are `YYYY-MM-DD` parsed as UTC. Everything else depends
inward on `core`; nothing in `core` depends outward.

```
app/                  expo-router routes
  (tabs)/             home · transactions · capture · budgets · insights · goals · settings
  import.tsx          bank statement import
  receipts.tsx        batch receipt review
  reports.tsx         export PDF/Excel/CSV
  review.tsx          Gmail import review
  transaction/new.tsx add / edit
src/core/             money, dates, budget, forecast, categorize, analytics
src/ingest/           receipt (capture/ocr/parse), email (gmail/parse), statement, llm, pipeline
src/reports/          build → html | tabular → export
src/db/               repository (+ .native), schema, seed, demoData
src/store/            useAppStore (zustand)
server/llm-proxy/     Cloudflare Worker holding the Gemini key
```

---

## Working end to end

Add/edit/delete transactions · four-layer auto-categorisation · budgets with
pace and rollover · forecasting with backtested error · receipt capture
(single + **batch up to 20**) · statement import (**PDF, Excel, CSV, TXT**,
password-protected PDFs supported) · Gmail OAuth + import review · report
export (**PDF, Excel, CSV**) · SQLite on device / localStorage on web · OTA
updates · budget alert notifications · goals · demo data.

Navigation: bottom bar on phones (5 tabs), side rail ≥600pt. Goals and Settings
sit in the dashboard header.

---

## Not built

- **Accounts / login.** No auth at all. The open question: device lock
  (PIN + biometric via `expo-local-authentication`, ~1–2 hrs, no server) versus
  real accounts (email codes, backend, sync, storing other people's financial
  data). **Owner has not chosen yet — ask before building.**
- **PowerPoint export** — asked for, deliberately deferred; niche and no good
  RN library.
- **Bank feeds** (Mono/Okra/Plaid) — v2. Needs a paid provider, a server, and
  per-account fees. Statement import covers it for now.
- **Recurring-rule auto-detection** — date maths done, clustering not.
- **iOS build** — needs a paid Apple Developer account ($99/yr).

---

## Keys and their state

Set in EAS for the `preview` environment (done 2026-08-25):
`EXPO_PUBLIC_OCR_API_KEY`, `EXPO_PUBLIC_GEMINI_API_KEY`,
`EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID`.

```bash
# add or change one (env:create is deprecated, same effect)
npx eas-cli@latest env:set --environment preview --name NAME --value "V" --visibility plaintext
npx eas-cli@latest env:list --environment preview
```

**Security debt, deliberate and time-boxed:** the Gemini key currently ships
inside the APK. Anyone who unzips it can read it. Owner accepted this while
testers are people he knows. `server/llm-proxy/` is written, tested (16 tests)
and ready — deploying it moves the key server-side and makes the app token
rotatable via OTA. **Do this before the APK goes to strangers.**

Gmail is capped at 100 manually-added test users because `gmail.readonly` is a
Google *restricted scope*; going public needs a CASA security assessment
(thousands of dollars). Statement import is the answer for wide distribution.

---

## Commands

```bash
npm test                     # 574 tests
npx tsc --noEmit -p tsconfig.json
npm run web                  # localhost:8081
npm start                    # Expo Go via QR

npm run dev                  # dev build + Metro: save a file, phone reloads (~1s)
npm run dev:usb              # same, over a USB cable
npm run apk:dev              # build the dev client — ONCE, then never again
npm run logcat               # filtered adb logcat

npm run push -- "message"    # OTA: JS-only changes, live in seconds
npm run push:check           # can this network reach Expo? (no upload)
npm run apk                  # new APK: needed for native changes
```

**JS only (`app/`, `src/`) → `npm run push`. Touched `app.json` or installed a
package → `npm run apk`.**

Build hangs after "Computed project fingerprint" on a weak connection — the
upload already succeeded, so check the dashboard before retrying. `api.expo.dev`
is IPv6-only from here; if DNS fails use
`$env:NODE_OPTIONS="--dns-result-order=ipv4first"`.

---

## Immediate next steps

1. **Ship over the air** — all JS, no build:
   `npm run push -- "Import correctness, review queue, Gemini model"`.
   If it dies with `EAI_AGAIN`, that is DNS, not the app — the update simply
   did not upload. `npm run push:check` says which host failed and whether a
   public resolver can find it. When it can, the fix is to point Windows DNS at
   1.1.1.1 / 8.8.8.8, or tether to the phone. This network's resolver
   intermittently fails on `*.storage.googleapis.com`.
   Then force-close Finlo and reopen it twice.

   **Re-import the statement afterwards and delete the earlier import.** The
   rows already in the database were read with the broken column alignment, so
   some of their amounts are wrong (a 15,000.00 transfer was stored as
   16,840.00, the running balance beside it).
2. **Rebuild** — the keys are set but the current APK predates them, so OCR,
   Gemini and Gmail all still read "Not configured" on device. This build also
   picks up `expo-dev-client`.
3. **Build the dev client once** (`npm run apk:dev`) and stop rebuilding for
   JS changes. See `docs/SETUP.md` › "Which loop to use".
4. Verify on device: batch receipts, PDF statement import, report export.
5. Decide device-lock vs accounts.
6. Deploy the LLM proxy before wider distribution.
7. Push to GitHub — repo does not exist yet:
   ```bash
   git remote add origin https://github.com/badim04/finlo.git   # create it private first
   git push -u origin master
   ```

---

## Style the owner expects

Direct, no filler. Say what broke and why, including when the cause was mine.
Verify before claiming something works — "it compiles" is not "it runs".
Short answers when he says "quick one". He is testing on a real Android device
over a slow connection, so a wasted 15-minute build is expensive: prefer getting
a log over guessing.

---

## Design system (added 2026-08-28)

The app is being taken from "accounting dashboard" to "consumer finance app".
The rule, which holds without being asked: **no screen ships as a single
column of identical rectangles.** Two or three across, or a sideways row.

Pieces to build with — do not invent new ones without checking these first:

| Component | For |
|---|---|
| `ui/Tiles` → `Tile`, `TileGrid` | 2-col coloured tiles, tag + faded glyph |
| `ui/Tiles` → `ScrollRow`, `MiniCard` | sideways rows that bleed off-screen |
| `ui/Tiles` → `Banner` | full-width, one message |
| `ui/Tiles` → `HeroCarousel` | swipeable headline, with dots |
| `ui/Tiles` → `StatRow`, `StatTile` | 2–3 figures across, each with its movement |
| `ui/Tiles` → `SegmentedControl` | one choice from two or three, as a track |
| `charts/Ring`, `RingLegend` | donut with the total in the hole, key beside it |
| `ui/Screen` → `Screen`, `Grid`, `Split` | the page shell, the reflowing grid, two panels side by side |
| `theme/layout` → `useLayout`, `columnsFor` | phone / tablet / desktop, and how many fit across |
| `ui/FeatureCard` | one saturated fill behind a headline figure |
| `ui/SettingsList` | grouped rows with state on the right |
| `ui/DateField` | calendar picker — never a typed date |
| `ui/Primitives` → `Button`, `FabButton` | pill, press-scale, `tone`/`size`/`loading` |
| `art/Mascot` (Fin, 5 poses), `art/Spot` (8 scenes) | SVG, theme-coloured |
| `core/voice` | every sentence about a change in spending |

**Three palettes that must not be confused.** `series` encodes a category and
can never be picked for looks. `feature` is a saturated fill behind a headline.
`tile` is six quiet tinted panels identifying a destination. Only `series`
carries data.

### Done 2026-08-28

- **Activity** opens on money-out/money-in side by side, a segmented track
  instead of stacked chip rows, search behind a toggle, and a **two-column**
  review queue. Day headings carry the day's net, so scrolling finds the
  expensive days instead of just moving through rows.
- **Settings** is groups of hairline-separated `SettingsRow`s read down the
  right-hand edge — the shape `ui/SettingsList` was built for and which most of
  the page was bypassing with `divided={false} padded` blocks. A three-across
  status strip answers "is this set up?" before the page moves, and the two
  irreversible actions are last, apart, behind a red border.
- **Insights** leads with a **ring** and its legend side by side; net worth,
  savings rate and runway are three across where two tinted panels and a
  full-width hero used to be; the category movers are a 2-col grid.
- **Budgets** envelopes are **two across** under an allocated/spent/left strip.
  The pace marker survives the shrink, because without it a bar says how much is
  gone and with it the bar says whether that is too fast.

### v1.2, in progress (branch `v1.2`)

- **Dark mode is navy** (`#080d1c` canvas), light mode is a cool near-white.
  The reference designs in `UIUX Designs/` are the source; the brand purple
  stays as the accent.
- **The web build is a web build.** Every screen took its width from a literal
  `maxWidth: 560–640`, so a 1440pt display showed a phone-shaped strip.
  `theme/layout.ts` + `ui/Screen.tsx` own it now, and grids go 2 / 3 / 4 across
  as the window grows — the extra width becomes more columns, never wider rows.
- **Analysis and Insights are separate pages.** Analysis has the charts and a
  monthly/quarterly/yearly grain toggle; Insights has the health score and the
  sentences. Each has a track at the top to reach the other.
- **`core/health.ts`** — a financial health score that refuses to score what it
  cannot see. Read its header before changing it; the rules there are the
  difference between a useful number and a made-up one.
- **`core/challenges.ts`** — streaks that cannot be gamed by not using the app.
  A day is only scored when the ledger was demonstrably live around it. Read
  the header before touching the coverage rule.
- **`core/notifications.ts`** — a dated log, deliberately a different register
  from Insights. Everything is derived and dated by a real event; only read
  markers persist.
- **New routes:** `/notifications`, `/help`, `/premium`. Premium shows plans and
  does **not** sell — there is no billing, no entitlement check and nothing
  behind the paywall, and the page says so at the top.

### Ask Finlo, and the one AI call that sends your figures

`app/ask.tsx` answers questions about the user's own money. Two rules make it
safe to have at all, both enforced in `core/factSheet.ts`:

- **The model never calculates.** It is handed figures already computed by the
  tested core and told, in the prompt, that every number it gives must appear in
  that brief verbatim. A model asked to total a column returns something that
  looks exactly like a total.
- **Other people's names never leave the phone.** A peer-transfer descriptor
  carries a third party's full name and account number. `redact` strips digits
  and refs, and `readCounterparty` decides who is a person — structurally, from
  the `Transfer to NAME | BANK | ACCOUNT` shape, not by guessing from spelling.
  Individuals are aggregated as "transfers to individuals (names withheld)".

It is the only feature that sends financial data anywhere, so it asks once, in
plain words, and lets you read the exact brief before agreeing.

### Verify with a bundle, not just a typecheck

`npx tsc --noEmit` is necessary and not sufficient. Metro and Babel fail on
things tsc will pass, and a mid-edit hot reload once put a duplicate-import
compile error on screen while the typecheck was green. Before claiming a screen
works:

```bash
npx expo export --platform web --output-dir /tmp/webcheck
```

### Still to do

Moved to **`docs/BACKLOG.md`** — one list, not two. It carries accounts/sync
(chosen, not started), billing, the screens still needing the responsive pass,
recurring detection, bank feeds, and the Gemini-key debt that has a deadline.

### Numbers: what is proven and what is not

Proven, and tested against ground truth: the same OPay account exported as PDF
and as XLSX produces identical transactions **to the kobo** — 229 rows, both
sections — and both match the totals the bank printed inside the file
(₦695,309.46 out / ₦688,525.77 in, 128 debits and 101 credits across Wallet and
Savings). Every import is now checked against those figures and refuses on a
mismatch.
Money is integer minor units end to end; dates are `YYYY-MM-DD` parsed as UTC.

Residual risk, in order:

1. **A bank whose PDF layout differs from OPay's.** The reader recovers columns
   from x-coordinates and is exact on the one bank tested. Another layout could
   mis-assign a column, and a wrong amount looks plausible.
   *Now guarded:* `src/ingest/statement/reconcile.ts` reads the totals the bank
   prints in its own preamble and refuses an import that disagrees with them.
   Building it found a live bug — the PDF was silently dropping the whole
   Savings section, 58 transactions, because that table sits on different x
   positions. See ARCHITECTURE › "A statement can change shape half way down".
2. **Categorisation is a guess until confirmed.** Amounts are right; "spent on
   food" is only as good as the filing.
3. **FX**, if more than one currency is ever used. Stale rates are excluded and
   flagged rather than guessed.
4. Internal-transfer exclusion changes totals **by design** (Settings toggle).
