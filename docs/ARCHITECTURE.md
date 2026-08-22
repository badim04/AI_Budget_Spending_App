# Architecture

Why it's built this way, and what to do next.

## The one structural rule

`src/core` is pure. No React, no React Native, no filesystem, no network. It is
a set of functions from data to data.

That constraint buys three things. Tests run in plain Node in under a second, so
the financial logic is actually tested rather than nominally tested. The same
engine runs unchanged on Android, iOS and web. And when a number on screen looks
wrong, there is exactly one place it could have come from.

Everything else depends inward on `core`. Nothing in `core` depends outward.

```
        app/ (screens)
             │
     components/ · hooks/
             │
    ingest/ ─────┐
             │   │
           core/ ◄── db/
```

## Decisions worth knowing about

### Money is integers, and the string is the source of truth

Amounts are integer minor units. The one subtle part is `fromDecimal`, which
scales the decimal *string* rather than multiplying the float:
`Math.round(1.005 * 100)` is 100, not 101, because `1.005 * 100` evaluates to
`100.49999999999999`. The error is introduced by the multiplication, so rounding
afterwards cannot recover it. Shifting the decimal point textually avoids the
multiplication entirely.

`allocate()` distributes remainders one minor unit at a time so splits always
sum back to the original. This matters for splitting a bill and for spreading an
annual charge across twelve months.

### Dates are day-strings parsed as UTC

Every date is `"YYYY-MM-DD"`, parsed to UTC midnight, formatted back. A local
`Date` would put a transaction recorded at 23:30 in Lagos into the previous day
for a user whose device is on UTC — which silently moves spending between months
and makes two people's totals disagree.

`addMonths` clamps rather than overflowing: Jan 31 + 1 month is Feb 28, not
Mar 3. Without the clamp a monthly rule set to the 31st marches through the
calendar until it leaves the month entirely.

### Budgets are judged against elapsed time

`budgetStatus` compares utilisation to `periodProgress` with a 10-point
tolerance. A user who front-loads groceries on the 1st shouldn't be scolded every
month for a pattern that always works out. The pace marker on the progress bar is
the visual form of the same idea.

Rollover has three policies because people genuinely differ: `reset` (classic
envelope), `rollover` (leftovers carry, overspend bites), `average` (deviations
carry at half weight, so one expensive month is absorbed). Look-back is capped at
24 periods — beyond that it's archaeology, and an unbounded walk would rescan the
whole history on every render.

The accumulated carry is also capped at `ROLLOVER_CAP_PERIODS` (3) times the
allocation. This was found by running the app rather than by testing it: a budget
whose `startsOn` predated the transaction history accrued a full surplus for every
empty period, and the dashboard cheerfully offered ₦4.8M "safe to spend" from
envelopes totalling ₦930k a month. An envelope untouched for six months is
over-funded, not owed.

### Forecasts are backtested before they're shown

Personal finance series are short (6–24 points), noisy, and obviously seasonal.
That rules out anything needing a long training series. Three classical models
compete on a rolling-origin backtest, and the winner carries its MAPE onto the
chart so the UI can say "±18%" instead of drawing a confident line through noise.

The forecast fits on **complete** months only. Including the current partial
month drags every projection downward, which is the single most common bug in
home-grown spend forecasting.

Scheduled bills are projected separately from discretionary spend. Rent on the
1st is a fact, not a statistical event; blending it into a smoothed average is
what makes naive balance projections wrong exactly when they matter.

Anomaly detection uses median + MAD rather than mean + standard deviation,
because one previous outlier inflates the standard deviation enough to hide the
next one.

### Categorisation learns, but only from confirmed data

Four layers: user rules → learned merchant history → shipped keyword lexicon →
LLM fallback. The first three are local, offline, and microseconds.

`buildMerchantHistory` counts **reviewed** transactions only. Learning from our
own unreviewed guesses would let one early mistake reinforce itself into a
confident permanent error — the model would train on its own output.

`AUTO_APPLY_THRESHOLD` is deliberately high (0.75). A wrong silent
categorisation costs more trust than an extra tap costs patience.

### Ingestion stages, it doesn't write

Everything — receipt, email, future bank feed — produces a `StagedTransaction`
with its own confidence and provenance. Only a staged row that is confident in
*both* extraction and categorisation auto-commits. A perfectly-read amount filed
into the wrong category is still wrong.

`dedupeKey` is `account|date|amount|currency` and deliberately excludes the
descriptor, because the same payment reads as "Netflix" in an email and
"NETFLIX.COM 08/13 REF:1234" in a bank feed. It's a UNIQUE index, so the
database enforces it rather than the application remembering to.

### Email is untrusted input

Templates are gated on verified sender domains with proper suffix matching
(`endsWith('.' + domain)`), so a lookalike host can't pose as a bank. Content is
scanned for declared regex patterns and nothing else — nothing in a message is
executed, evaluated, or followed as an instruction, and `tests/email.test.ts`
asserts that directly. Body-only matches are always low confidence.

`htmlToText` removes `<script>` and `<style>` bodies entirely rather than
stripping tags, so JavaScript numbers never reach the amount matcher.

### The receipt parser optimises for the total

A receipt whose total is wrong corrupts a budget; one whose line items are
partial just means less detail. So the total has three independent strategies
(labelled match → largest amount → reconstruct from subtotal+tax) plus a
consistency check that warns when they disagree by more than 2%.

Two bugs found while testing this are worth remembering, because both were
silent: the amount regex read `4730.00` as `473` (a factor-of-ten error, no
exception thrown), and `SUB TOTAL` matched the `total` label (under-reporting
every receipt that had both).

## What to build next, in order

1. **SQLite repositories.** Highest value. Schema and migrations are written;
   what's missing is a thin repository layer over `expo-sqlite` and swapping
   `loadDemoData()` for it inside `useDashboardData`. Nothing else changes.

2. **Receipt capture.** `expo-camera` → `expo-image-manipulator` (downscale, the
   OCR cost is per pixel) → OCR → `parseReceipt` → `stageFromReceipt`. On-device
   OCR (ML Kit / Vision) keeps receipts private and free; a cloud OCR is more
   accurate on crumpled paper. Start on-device and use `needsLLM()` to escalate.

3. **Gmail sync.** `expo-auth-session` with `GMAIL_SCOPES`, then
   `buildGmailQuery(since)` → fetch → `htmlToText` → `ingestEmails`. Store the
   last sync cursor in `settings`. Every message id goes into `ingest_log` so a
   re-sync is a no-op.

4. **Review queue UI.** The staging pipeline already produces everything it
   needs: suggestion, rationale, confidence. This is the screen that makes
   automatic capture feel safe.

5. **Recurring-rule detection.** Cluster transactions by merchant key, look for
   a consistent interval and amount, propose a rule. The date maths
   (`occurrencesBetween`, `toMonthlyEquivalent`) is done.

6. **Bank feeds, last.** Mono/Okra for Nigeria, Plaid for US/EU, GoCardless for
   the EU. Deferred deliberately: they cost money per connected account, they
   need a server (the secret can't live in the app bundle), and email alerts
   already cover most of the same ground for free. Add one when a user asks.

## Testing

`npm test` — 194 tests over `core` and `ingest`, no device needed.

The tests are written against behaviour that would be wrong in a way a user
would notice: negative zero rendering as "-₦0.00", a refund double-counting
against a budget, an overspent envelope draining another envelope's
safe-to-spend, a receipt total picking up the cash tendered instead. When adding
a feature, write the test that describes the bad outcome first.
