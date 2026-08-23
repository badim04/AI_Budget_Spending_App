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

### If the build stops before it starts

**"It looks like you haven't initialized the git repository yet."**
Answer **yes**. EAS needs a git repo to know what to upload. It makes one commit
called "Initial v1". Nothing secret goes in — `.env`, `node_modules` and `dist`
are all gitignored, and I verified the key appears in zero commits.

**"Slug for project identified by extra.eas.projectId (...) does not match the
slug field (finlo)."**
This is the one that stopped your build. Your Expo project is called
`Budget_Spender_App…`; `app.json` says `finlo`. Pick either fix:

- **Rename the Expo project** (recommended, keeps everything else working):
  expo.dev → your project → Project settings → General → rename to `finlo`.
  The projectId and the updates URL are unaffected.
- **Or match app.json to the project**: run `npx eas-cli@latest project:info`,
  read the slug it prints, and set `"slug"` in `app.json` to exactly that.

Then `npm run apk` again.

**Check what actually happened:**

```bash
npx eas-cli@latest build:list --platform android --limit 5
```

If nothing is listed, no build ever started. Every build also appears at
expo.dev → your project → Builds, with its logs.

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

**Step 1 — get your SHA-1.** I cannot generate this; it belongs to a signing
keystore that only exists once EAS creates one for you. **You do not need a
successful build** — you can create the keystore directly:

```bash
npx eas-cli@latest credentials
```

Choose **Android → production → Keystore → Set up a new keystore** (let EAS
generate it), then **Show keystore fingerprints** and copy the **SHA-1**.

That is exactly the "New application identifier" wizard in your Expo dashboard
screenshot — finishing it produces the same keystore, and the SHA-1 then appears
under Credentials → Android.

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

### Gemini (AI categorisation) — move it behind the proxy before you share

Your key works right now. But you said you are sending the APK to a bunch of
people, including strangers — so it has to move before you do that.

**The problem.** `EXPO_PUBLIC_*` values are compiled into the JavaScript inside
the APK. Anyone who gets that file can unzip it and read your Gemini key in
about a minute. No skill required. They can then spend your quota, and on a
billed key, your money. Capping the quota limits the damage; it does not stop it.

**The fix, ~3 minutes, free, no card:** a tiny Cloudflare Worker that holds the
key. I have written and configured it — see
[`server/llm-proxy/README.md`](../server/llm-proxy/README.md).

```bash
cd server/llm-proxy && npm install
npx wrangler login
npx wrangler secret put GEMINI_API_KEY     # paste your key
npx wrangler secret put APP_TOKEN          # any long random string
npm run deploy
```

Then in the app's `.env`:

```
EXPO_PUBLIC_LLM_PROXY_URL=https://finlo-llm-proxy.your-subdomain.workers.dev
EXPO_PUBLIC_LLM_PROXY_TOKEN=that_random_string
EXPO_PUBLIC_GEMINI_API_KEY=
```

Blank the Gemini line — otherwise it still ships in the bundle even though the
proxy takes priority. Rebuild (`npm run apk`), and Settings → Smart
categorisation reads **AI fallback: Proxy** with no warning.

**Be clear about what this buys.** Your Gemini key becomes completely
unreachable — that part is absolute. The app token still ships in the bundle, so
a determined person could still call your worker. What changes is that you gain
control you did not have:

| | Key in the APK | Behind the proxy |
|---|---|---|
| What a stranger can extract | Your Gemini key | A token that only works on your worker |
| Revoking it | Everyone reinstalls | Rotate + `npm run push`, done in a minute |
| Spend ceiling | Whatever Google allows | Whatever you set |
| Turning it off | Impossible | One flag, redeploy |
| Rate limiting | None | 60/hour per IP |

**Regardless:** rotate the current key at
[aistudio.google.com/apikey](https://aistudio.google.com/apikey) — it has been
in a chat transcript — and set a quota cap on the replacement.

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
