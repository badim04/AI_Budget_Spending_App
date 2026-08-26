# Finlo — handoff

Everything a new session needs to continue. Written 2026-08-25.

---

## What this is

**Finlo** — multi-currency personal finance for Android, iOS and web from one
codebase. Expo SDK 52 + React Native 0.76 + TypeScript, expo-router.

- **Project:** `C:\Users\user\Documents\GitHub\AI Budget Spending App`
- **Package:** `com.badim04.finlo` · **version** 0.1.1 · **versionCode** 2
- **Expo:** owner `badim04s-team`, slug `budgetspenderappfinlo`,
  projectId `240fc2a2-71ba-4e64-b2b8-29efd995522d`
- **Git:** local only, branch `master`. **No GitHub remote yet.**
- **347 tests pass**, `tsc --noEmit -p tsconfig.json` is clean,
  `npx expo-doctor` passes.

Owner is in Nigeria; default currency NGN. Testers are real people getting an
APK link, including strangers.

---

## Read these first

| File | Why |
|---|---|
| `docs/ARCHITECTURE.md` | Why the code is shaped this way, and the traps already hit |
| `docs/SHIPPING.md` | Build, OTA update, and every key/credential step |
| `docs/SETUP.md` | Running it, Expo Go, troubleshooting |
| `README.md` | Feature status — what works vs what doesn't |

---

## The five rules that cost real time to learn

1. **Metro caches aggressively.** When behaviour does not match the code,
   restart with `npm start -- --clear` *before* debugging. This sent a whole
   session chasing a bug that was already fixed.
2. **Never `npm install <expo-pkg>`** — always `npx expo install`. And removing
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
   sessions in minutes. PowerShell writes UTF-16, so decode before grepping.

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
npm test                     # 347 tests
npx tsc --noEmit -p tsconfig.json
npm run web                  # localhost:8081
npm start                    # Expo Go via QR

npm run push -- "message"    # OTA: JS-only changes, live in seconds
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

1. **Rebuild** — the keys are set but the current APK predates them, so OCR,
   Gemini and Gmail all still read "Not configured" on device.
2. Verify on device: batch receipts, PDF statement import, report export.
3. Decide device-lock vs accounts.
4. Deploy the LLM proxy before wider distribution.
5. Push to GitHub — repo does not exist yet:
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
