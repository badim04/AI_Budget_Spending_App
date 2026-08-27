# Setup

## Running it on your phone

### The fast way — Expo Go (no build, ~2 minutes)

1. Install **Expo Go** — [Play Store](https://play.google.com/store/apps/details?id=host.exp.exponent) / [App Store](https://apps.apple.com/app/expo-go/id982107779).
2. Phone and laptop must be on **the same Wi-Fi**.
3. In the project folder:

```bash
npm start
```

4. A QR code appears in the terminal. **Android:** scan it inside Expo Go.
   **iPhone:** scan it with the Camera app, then tap the banner.

The app opens with your data stored in **real SQLite on the device** — not the
browser storage the web build uses.

If the QR does nothing, your network is blocking the LAN connection (common on
office, hotel and some home mesh Wi-Fi). Use a tunnel instead:

```bash
npx expo start --tunnel
```

Slower, but it works from anywhere, including mobile data.

### What works in Expo Go vs a real build

| | Expo Go | Dev build / store build |
|---|---|---|
| Everything except the rows below | ✅ | ✅ |
| SQLite persistence | ✅ | ✅ |
| Camera + photo library | ✅ | ✅ |
| Gmail OAuth | ⚠️ needs the Expo Go redirect URI | ✅ |
| Push notifications for budget alerts | ❌ | ✅ |
| App icon / splash / your own name | ❌ | ✅ |

Expo Go is the right way to check the app on a real phone. You need your own
build only when you want it installed as *your* app, or want notifications.

### The dev build — change code, see it on the phone in a second

This is the answer to "do I have to build an APK every time?". No. Build once,
then never again until you touch native code.

A **development build** is your real app — your icon, your package name, every
native module the preview APK has — except its JavaScript comes from Metro
running on your laptop instead of being frozen inside the APK. Save a file, the
phone reloads. About a second.

Build it once:

```bash
npm run apk:dev
```

Install that APK the same way you install the preview one. It has the same
package name, so it replaces the Finlo already on the phone and keeps its
data. Re-installing the preview APK later puts you back.

From then on, every session is just:

```bash
npm run dev
```

Open Finlo on the phone and it connects to your laptop. Phone and laptop must
be on the same Wi-Fi. If they are not, or the network blocks it:

```bash
npm run dev:usb      # USB cable, adb; fastest and most reliable
npm run dev:tunnel   # works from anywhere, including mobile data; slower
```

What that buys you:

- **Save a file, see it.** Fast Refresh, ~1 second, state preserved.
- **Errors become a red screen with a stack trace** instead of the app silently
  closing. The bank-statement import crash was a one-line `RangeError` that a
  dev build would have shown in thirty seconds; finding it without one took a
  full build cycle.
- **`.env` works.** The bundle is built on your laptop, so `EXPO_PUBLIC_*` keys
  come straight from `.env` — no `eas env:set`, no rebuild, just restart Metro.
  That trap only applies to cloud builds.
- **Dev menu**: shake the phone, or press `m` in the terminal. Reload, element
  inspector, performance monitor. `j` opens the JS debugger.

You need a new APK again only when you add or remove a native package, or edit
`app.json` — plugins, permissions, icon, splash, package name.

### Which loop to use

Cheapest first. Most changes never need to go past the second row.

| Loop | Change to seen | Good for |
|---|---|---|
| `npm test` | ~3 s | money, dates, parsing, categorisation, forecasting |
| `npm run web` | ~1 s | screens, layout, navigation, anything not native |
| `npm run dev` | ~1 s, on the real phone | everything, including native and Hermes |
| `npm run push -- "msg"` | ~30 s + app restart | getting a JS fix to testers |
| `npm run apk` | ~15 min | native changes, and new tester builds |

The gap between rows 2 and 3 is where bugs hide. Node and Chrome have Web APIs
that React Native does not, so logic can pass every test and still crash on the
phone. When something is wrong only on device, go straight to row 3 — or get
the log:

```bash
npm run logcat
```

### Your own installable build

No Mac or Android Studio required — it builds in Expo's cloud:

```bash
npm install -g eas-cli
eas login
eas build --profile preview --platform android
```

That produces an `.apk` you can download and install directly. For iPhone,
`--platform ios` requires a paid Apple Developer account ($99/yr) — this is
Apple's rule, not Expo's. Without one, Expo Go is the only way onto an iPhone.

---

## Optional keys

The app runs fully without either of these. They only turn on automatic capture.

### Receipt OCR

Without a key, receipts are still photographed, stored, attached to the
transaction and full-text searchable — you just type the amount yourself.

With a key, the total, merchant, date and line items are read for you.

1. Get a free key at [ocr.space/ocrapi](https://ocr.space/ocrapi) (25k requests/month).
2. Add it to `.env`:

```
EXPO_PUBLIC_OCR_API_KEY=your_key_here
```

3. Restart with `npm start -- --clear`. Settings will show **Receipt OCR: OCR.space**.

To use a different provider, implement `OcrProvider` in
`src/ingest/receipt/ocr.ts` — the interface is two methods.

### Gmail

Google requires an OAuth client tied to your own Google Cloud project. It cannot
be shipped in a repo and I cannot create one for you.

1. [console.cloud.google.com](https://console.cloud.google.com) → new project
2. **APIs & Services → Library** → enable **Gmail API**
3. **OAuth consent screen** → External → add yourself as a test user
4. **Credentials → Create OAuth client ID**, one per platform you'll use:
   - Web → authorised redirect URI `http://localhost:8081`
   - iOS → bundle id `com.badim04.finlo`
   - Android → package `com.badim04.finlo` (needs your signing SHA-1)
5. Put the ids in `.env`:

```
EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB=...apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS=...apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID=...apps.googleusercontent.com
```

6. Restart with `--clear`, then **Settings → Connect Gmail**.

The scope requested is `gmail.readonly`, and the search is narrowed by
`buildGmailQuery()` to known bank/merchant senders and money-shaped subjects in
a date window. The app never sends mail and never writes to the mailbox.

---

## Troubleshooting

**A change doesn't show up.** Metro caches aggressively — this bit me repeatedly
while building the app, to the point of sending me chasing a bug that had
already been fixed. When behaviour doesn't match the code, restart with a clear
before debugging anything else:

```bash
npm start -- --clear
```

**`expo-asset cannot be found`, or similar.** The dependency tree drifted. Never
`npm install <pkg>` for an Expo package — use `npx expo install <pkg>`. To repair:

```bash
npx expo install --fix
```

**Check the whole toolchain:**

```bash
npx expo-doctor
```

**Web data disappeared.** The browser build stores everything in that browser's
`localStorage`. Clearing site data erases it, and it does not follow you between
browsers or devices. Phones use SQLite and are unaffected.
