# Shipping Finlo to testers

Everything here is already configured. What's left needs *your* accounts, which
is why you have to run it rather than me.

---

## 1. One-time setup (~5 minutes)

Your Expo project is **already linked** in `app.json`
(`projectId 240fc2a2-71ba-4e64-b2b8-29efd995522d`, owner `badim04`), so you can
skip `eas init` unless the CLI complains.

```bash
npm install -g eas-cli
eas login
```

If EAS ever says the project is not linked:

```bash
npx eas-cli@latest init --id 240fc2a2-71ba-4e64-b2b8-29efd995522d
```

## 2. Build the APK

```bash
npm run apk
```

That's `eas build --profile preview --platform android`. First run asks to
generate an Android keystore — say **yes** and let EAS keep it. That keystore is
your app's signing identity: if you lose it you cannot ship an update to anyone
who already installed, they have to uninstall first. EAS backs it up for you.

Build takes ~10–20 minutes on the free queue. When it finishes you get a URL
like `https://expo.dev/artifacts/eas/xxxx.apk`.

**Send that link to testers.** They open it on an Android phone, download, and
tap it. Android will warn about "unknown sources" — that is normal for any APK
outside the Play Store; they tap through it once.

No Android Studio, no Java, no Mac required — it builds on Expo's servers.

### iPhone

`npm run ios:build` works but needs a paid **Apple Developer** account
($99/year) and each tester's device UDID registered, or a TestFlight submission.
That is Apple's rule, not Expo's. Until you pay for that, iPhone testers use
**Expo Go** (`npm start`, scan the QR).

---

## 3. Shipping updates — the part that matters

You do **not** rebuild and resend the APK for most changes.

```bash
npm run push -- "fixed the budget rollover"
```

That's `eas update --branch preview`. It uploads the new JavaScript. Every
tester who already installed the APK gets it **the next time they open the app**
— they download it in the background, and Settings shows "Restart to apply".

Typical loop:

```bash
# change some code
npm test
npm run push -- "what changed"
```

Seconds, not twenty minutes. No reinstall, no new link.

### When you DO need a new APK

OTA replaces JavaScript. It cannot replace native code. Rebuild when you:

- add an Expo package with a native module (`npx expo install expo-anything`)
- change permissions, the app name, the icon, or the bundle id
- upgrade the Expo SDK
- bump `version` in `app.json`

`runtimeVersion` is set to the `appVersion` policy, so bumping `version` from
`0.1.0` to `0.2.0` deliberately cuts old builds off from new updates instead of
pushing them JavaScript their native side can't run. That is the safe default —
it means a mismatch shows up as "no update" rather than a crash.

Rule of thumb: **changed only files in `app/` or `src/`? → `npm run push`.
Touched `app.json` or installed a package? → `npm run apk`.**

### Checking it works

Settings → **App version** shows the running version, the channel, and a
"Check for updates" button. In Expo Go it correctly says "not applicable" —
OTA only exists in real builds.

---

## 4. The keys — exactly what to do

### Receipt OCR — 2 minutes, free, no build needed

1. Open **[ocr.space/ocrapi](https://ocr.space/ocrapi)**, enter your email under
   "Register for free API key". The key arrives by email in under a minute.
2. Open `.env` in the project root and fill in:

```
EXPO_PUBLIC_OCR_API_KEY=K81234567288957
```

3. `npm start -- --clear`

Settings → Automatic capture should read **Receipt OCR: OCR.space**. Free tier
is 25,000 receipts/month.

### Gmail — do this AFTER your first APK build

The order matters: the Android OAuth client needs a SHA-1 fingerprint that does
not exist until EAS has created your keystore.

**Step 1 — get your SHA-1.** I cannot generate this; it belongs to the signing
keystore EAS creates for you. After `npm run apk` finishes:

```bash
eas credentials
```

Choose **Android → production → Keystore → Show keystore fingerprints**, and
copy the **SHA-1**. (Or in the Expo dashboard: your project → Credentials →
Android → the application identifier → the SHA-1 is listed there. That is the
wizard in your screenshot — finish it and the fingerprint appears.)

**Step 2 — create the OAuth clients.** In Google Cloud Console → Credentials →
Create credentials → OAuth client ID. You need **two**, not one:

| Application type | What to enter |
|---|---|
| **Android** | Package name `com.badim04.finlo`, plus the SHA-1 from step 1 |
| **Web** | Authorised redirect URI `http://localhost:8081` (for `npm run web`) |

> Your screenshot had **Desktop app** selected — that type will not work here.
> Google rejects the callback because a Desktop client expects a loopback
> redirect, not an app scheme. Delete it and create an **Android** client.

**Step 3 — put the ids in `.env`:**

```
EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID=1234-abc.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB=1234-xyz.apps.googleusercontent.com
```

**Step 4 — register the callback scheme.** Google's native clients only accept
the *reversed client ID* as a redirect. Take your **Android** client id, drop
the `.apps.googleusercontent.com`, and add it to `app.json`:

```json
"scheme": ["finlo", "com.googleusercontent.apps.1234-abc"]
```

Settings → Smart categorisation shows the exact string once the id is in `.env`.
Without this the consent screen opens and then fails with
`redirect_uri_mismatch`, because Android has no intent filter to hand the
callback back to the app.

**Step 5 — consent screen.** OAuth consent screen → External → add every Gmail
address that will test this under **Test users** (up to 100). Add the scope
`.../auth/gmail.readonly`.

**Step 6 — rebuild.** Changing `app.json` is a native change, so:

```bash
npm run apk
```

Then Settings → Connect Gmail.

> Client IDs are not secrets — Google's flow assumes they are public. The
> consent screen is what protects the account.

### Gemini (AI categorisation) — already configured

Your key is in `.env` as `EXPO_PUBLIC_GEMINI_API_KEY`. It works now, on web and
in the APK.

**Two things to know.** `EXPO_PUBLIC_*` values are compiled into the app bundle,
so anyone who unzips the APK can read that key. And it is in our chat
transcript. Both mean you should:

1. Cap it — [Google AI Studio](https://aistudio.google.com/apikey) → restrict
   the key to the Generative Language API and set a quota.
2. Rotate it before you share the APK widely, and again before any public
   release.

For a public release, stand up a tiny proxy that holds the key server-side and
set `EXPO_PUBLIC_LLM_PROXY_URL` instead. The app already prefers the proxy when
that variable is present — no code change needed. Settings shows which
transport is live and warns when the key is in the bundle.

## 5. What is built now, and what is left

Built and tested since the last round:

| | Where | Status |
|---|---|---|
| **Push notifications** for budget alerts | Settings → Budget alerts | Local, on-device. One 7pm check, only when an envelope is over or ahead of pace. Needs a real build — Expo Go can't schedule them. |
| **Recurring-rule detection** | Budgets → Repeating payments | Finds patterns, proposes them, never auto-creates. Also shows your total monthly commitment. |
| **Goals** | Goals tab | Target + date → the monthly rate to hit it, and a warning when you drift. |
| **AI categorisation** | Settings → Smart categorisation | Gemini, only for descriptors the offline layers miss. Capped below auto-apply, so it always goes to review. |
| **Bank statement import** | Settings → Import a bank statement | CSV, any column layout, date range, auto-categorised, duplicates skipped. Your v1 for bank feeds. |

Still not built:

- **Bank feeds** (Mono/Okra/Plaid) — deferred to v2 as agreed. Statement import
  covers the same ground without a paid provider or a server.
- **Recurring rules editing UI** — detected rules can be added and appear in
  forecasts, but editing one means deleting and re-adding.

## 6. Quick reference

```bash
npm start                      # Expo Go on your phone via QR
npm run web                    # browser
npm test                       # 194 tests

npm run apk                    # build a shareable APK
npm run push -- "message"      # OTA update to everyone on preview
npm run doctor                 # health-check the toolchain

eas build:list                 # past builds + their APK links
eas update:list --branch preview
```
