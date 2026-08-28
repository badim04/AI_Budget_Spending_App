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

### The note is the best signal on a peer transfer

A mobile-money descriptor ends with free text the sender typed:

```
Transfer to RASHIDAT BASHIRU | OPay | 7046464337 | milk
Transfer to RASHIDAT BASHIRU | OPay | 7046464337 | ice cream
```

The app was discarding it. The recipient's name says *who* got the money; the
note says *why* — and one person receives money for many reasons, so the note
is the better signal for a category and the worse one for grouping. That is why
`counterparty.ts` deliberately keeps the note **out** of its grouping key while
`categorize.ts` leans on it.

Three things use it:

1. **A note-only vocabulary** (`NOTE_LEXICON`). "light" means electricity and
   "fare" means transport when a person types them on a transfer, and neither
   is safe against a merchant name — "Light House Cafe" is not a power bill. It
   scores above the general lexicon, because the payer wrote it themselves to
   say what the money was for, which clears the auto-apply line for a short
   word like "rent".
2. **Learned notes** (`MerchantHistory.notes`). File one transfer noted "milk"
   as Groceries and every future "milk" is recognised, whoever it went to. This
   is also how a personal shorthand no lexicon could ever ship — "chi", which
   recurs across dozens of recipients in one real statement — becomes
   categorisable after being confirmed once.
3. **The LLM prompt**, which now explains the `to NAME | BANK | ACCOUNT | note`
   shape and says the last field is the strongest signal, with instructions to
   return null on a shorthand it cannot decode rather than guessing from the
   recipient's name.

Merchant history and note history are both consulted and the **stronger score
wins**, rather than one taking fixed priority: a well-established note should be
able to outrank a weak habit with one recipient, and a merchant you have filed
ten times should survive a note that means nothing yet.

`transferNote` lives in `src/core/notes.ts`, a leaf module that imports nothing.
It cannot go in `counterparty.ts` or `categorize.ts` — those already import each
other's way — and a cycle in Metro hands back a half-initialised module, which
this codebase has lost a day to before.

Every entry in that vocabulary is a guess about intent, and a wrong guess is a
miscategorised transaction, so it stays short. `gas` was cut because it would
file a filling station as a utility bill; `test` because a transfer noted "test"
usually is one.

### The note says why, the account says who

A peer transfer carries a note the sender typed: `Transfer to RASHIDAT BASHIRU
| OPay | 7046464337 | milk`. That note describes the purpose **for the person
receiving the money**. Sending a friend money so she can buy milk is not the
sender's groceries — it is a gift, or support, or a loan, and only the person
filing it knows which.

So `groupKey` takes a `GroupMode`. `account` is the default because an account
number is the only stable identity: a name can be spelled three ways and two
people can share one. `person` falls back to the name for banks that mask the
number. `note` exists because it is occasionally what someone wants. The app
offers all three in the review queue and does not decide.

Direction is baked into every mode. Money sent to someone and money received
from them are never one bucket.

On the real 229-row statement this turns 128 money-out rows into 47 decisions
by account, or 19 by note. One card reads "Rashidat Bashiru · 7046464337 · 10
transactions · ₦33,000" and one tap files all ten.

Note extraction lives in `src/core/notes.ts`, which imports nothing: it is
needed by both `categorize.ts` and `counterparty.ts`, and `counterparty.ts`
already depends on `categorize.ts`. Putting it in either would close an import
cycle, and Metro answers a cycle with a half-initialised module — a failure
this codebase has already lost a day to.

### Time is a control, not a constant

Every screen was pinned to today, which answers one question and refuses every
follow-up: was last month worse, what did August actually look like, is this
fortnight ahead of the last one. `src/core/periods.ts` makes the period a value
the dashboard and Insights both move through, and two rules keep it honest.

**You cannot walk into the future.** A month that has not happened has no data,
and an empty screen reads as a broken app rather than as "not yet". Forward is
disabled at the current month rather than hidden — a greyed arrow says "this is
the edge", a missing one says "this feature does not exist".

**A comparison is between two stretches of equal length.** Eleven days of a
live month against a whole previous month is not a comparison, it is an
announcement that spending has collapsed. `elapsedRange` trims the current
period to today and `matchingSlice` trims the baseline to match, so August-so-far
is measured against the same days of July and the card says "at the same point"
out loud. A hand-picked custom range is compared whole, because its length was
chosen deliberately.

`comparePeriods` in `analytics.ts` generalises the old `yearOverYear`, which
could only ever answer one question. Category movers are ranked by *absolute*
change: a category that fell by ₦40,000 is exactly as interesting as one that
rose by it.

### Artwork is drawn, not imported

`src/components/art/` holds a mascot (Fin, five poses) and eight spot
illustrations, all as SVG paths. A PNG would look better in a mockup and would
also be four files per pose, wrong in dark mode, fixed at one size, and a
designer round-trip for every new state. Vector paths recolour with the theme,
scale to any size, cost nothing to ship, and a new pose is a few lines.

The constraint that shapes them: Fin has to read at 40px. Two eyes, a mouth, a
silhouette. Anything more disappears at the size it is actually used, so the
detail budget goes on the highlight in the eye — which is the whole difference
between alive and printed.

Spots take a `TileTone` rather than fixed colour, so one drawing is six moods
and a spot on a green tile is green.

### One fact, one register

The dashboard once rendered a bar labelled "▲ 9.6×" directly above a banner
reading "Eating out is up 858%" — the same fact twice, one of them meaningless.
They came from different modules that each formatted their own percentage.

`describeChange` and `compactChange` in `core/voice.ts` are now the only two
places a change is turned into words, and `analytics.ts` calls them for the
insight text. The floor, the ceiling and the choice between naira, percent and
multiples live in one file, so the badge and the sentence cannot drift apart
again.

### Dates are picked, not typed

Every date was a text box wanting `YYYY-MM-DD`: needs a keyboard, needs the
format remembered, silently accepts `2026-13-45`, and on a phone means
switching to the number pad and back for one field.

`components/ui/DateField` is a month grid with three shortcuts (today,
yesterday, start of month — most dates in a finance app are one of those) and
`maxToday`, which blocks the future for anything that has already happened.
Blocking is kinder than validating afterwards. Everything is a `YYYY-MM-DD`
string parsed as UTC via `core/dates`, never a local `Date` waiting to shift by
one.

### Side by side is not decoration, it is the comparison

`Tiles.tsx` grew three pieces, each because two or more screens were hand-rolling
a worse version of it.

**`StatRow` / `StatTile`.** Money out and money in are one fact with two halves,
and stacking them turns a comparison into a sequence: you read the first, scroll,
and have to hold it in your head to make sense of the second. Side by side the
comparison is free. Widths are always equal, however different the labels — an
unequal column reads as a hierarchy, and neither half outranks the other. The
movement is a chip with an arrow rather than coloured text, because a sign has to
survive being glanced at and has to work for someone who cannot separate the red
from the green. `value` arrives already formatted: a layout component that
reached into `core/money` would become the second place deciding how a naira is
written.

**`SegmentedControl`.** Every screen had grown its own row of pill chips, and a
row of chips does not say how many there are or that they are exclusive — it
looks like filters you can combine. A sunken track with one raised segment is
what the phone already uses for "pick exactly one", and it takes one line where
chips wrapped to two. Counts ride as a badge so three segments still fit across
the narrowest phone.

**`charts/Ring`.** A bar chart answers "which is biggest"; a donut answers "how
is the whole divided", which is the question someone actually has about a month
of spending. The total goes in the hole so the parts and the whole are read in
one movement. Slices below a minimum sweep are merged into a remainder rather
than dropped — a gap in a ring drawn around a total that still counts them is a
chart disagreeing with its own centre. Colour comes from the caller and never
from the chart: a slice hue encodes a category, and it is the validated `series`
set that owns it.

### Structural variety is the design, not more colour

Finlo was one column of full-width rectangles, top to bottom, every one the
same shape. Styling those rectangles more brightly does not change what they
are: that is the layout of a report, and it is why the app read as accounting
software however the cards were painted.

`src/components/ui/Tiles.tsx` adds the vocabulary that was missing, and the
point of each piece is the shape rather than the colour:

- **`HeroCarousel`** — one big figure at a time, swiped, with dots. Three
  things about your money in the space one used to take.
- **`TileGrid` / `Tile`** — two columns, each tile a different fixed colour
  with a bright action tag and a faded oversized glyph bled off the corner. The
  colours are a fixed set of six and each destination keeps its own, so you
  learn "the green one is goals" and stop reading labels.
- **`ScrollRow` / `MiniCard`** — a row that deliberately bleeds past the page
  gutter. A card cut off at the right edge is what tells someone there is more
  sideways; a row that stops neatly inside the margin looks finished and nobody
  swipes it.
- **`Banner`** — full width, one message, in the app's own voice.

Three palettes now coexist and must not be confused. `series` encodes a
category and cannot be chosen for looks. `feature` is one saturated fill behind
a headline figure. `tile` is six quiet tinted panels that identify a
destination. Only the first carries data.

The tile "illustration" is an emoji at 13% opacity, rotated, oversized and
clipped by the tile. Real vector art would be better and needs a designer; this
gets most of the texture with no asset pipeline, and it inherits the tile's own
colour so it can never fight the palette.

### The app has a voice, and the voice does arithmetic

Insights used to say "Transport is up 887%". True — transport went from ₦1,500
to ₦14,800 — and useless. Nobody holds a ninefold increase as a percentage, and
a ratio taken off a base that small is noise wearing the costume of a finding.

`src/core/voice.ts` owns how Finlo speaks, and the rules are as much about
statistics as tone:

- **A ratio needs a base worth dividing by, and a ceiling.** Under ₦1,000 the
  sentence talks in naira; over 300% it talks in multiples ("about 9.6× last
  month"); in between, where a percentage is genuinely clearest, it uses one.
  `compactChange` applies the same rules to the badge beside a bar.
- **Essentials are not lifestyle choices.** Rent going up gets a flat factual
  line. Teasing someone about their rent is the moment they stop trusting the
  app.
- **Say nothing rather than something empty.** A change too small to act on
  returns null and the card does not render. Filler is how an app teaches
  people to skip its messages.
- **Deterministic.** The same numbers always produce the same sentence. A
  figure that reads differently on each refresh looks broken.

It is pure and has no clock of its own, so the whole voice is testable —
`tests/voice.test.ts` pins the 887% case directly.

### Settings is a list, not eight dashboards

Every setting had its own bordered card under its own heading, so a page with
eight settings read as eight subsystems. To the person using it they are a
handful of things about their money, their automation and the app. They are now
named groups of hairline-separated rows, each showing its state on the right,
so the page can be read down its right-hand edge without opening anything.

### Colour and motion, and where each is allowed

The palette began as deliberate restraint — numbers are the interface,
everything else recedes. That is still right for data, and now sits alongside a
second idea: **data colour is earned, chrome colour is chosen.**

A chart series hue encodes a category, so it cannot be picked for looks; the
eight-hue set is validated for contrast and colour-vision deficiency and adding
a ninth breaks it. A `feature` fill sits behind a headline figure to draw the
eye and encodes nothing, so it can be as loud as the brand wants. Both live in
`theme/tokens.ts` and the distinction is the whole reason they can coexist.

Motion follows one rule that outranks the rest: **the animation is decoration,
the number is not.** `useCountUp` drives a headline figure from JavaScript,
because text content cannot be animated natively — and `requestAnimationFrame`
does not fire while the app is backgrounded or the screen is off. A count
interrupted halfway would leave a figure on screen that is simply wrong, so a
timer always fires and always lands on the true value. That was not
hypothetical: it showed up the first time the dashboard was paged to another
month in a tab that was not compositing.

Everything else runs on the native driver (transform and opacity only),
everything is 90–320ms, and everything checks `AccessibilityInfo` first —
someone who asked the OS for reduced motion asked for a reason.

Built on React Native's `Animated` rather than Reanimated, which is installed
and configured. Reanimated worklets need the native side to match the JS, and
this app ships JavaScript-only updates to builds that may be older than the
change.

### The import that lost 228 transactions

The worst bug this app has had. A tester imported a month of statement, the app
said it worked, she spent an hour reviewing ~200 rows, and then all of it
vanished except about fifteen. Restarting did not help, because it had never
been written.

Three things had to line up, and every one of them is a lesson:

1. **A constraint enforcing a heuristic.** `dedupe_key` is account+date+amount
   and the schema made it UNIQUE, on the stated theory that two identical
   payments on one day are rare. On a Nigerian fintech statement they are
   routine — stamp duty is a flat charge on every qualifying transfer. Her file
   had 13 colliding transactions across 10 keys. Deduplication is a product
   judgement, made visibly at import time where the user is told what was
   skipped; a database constraint cannot ask, it can only reject, and rejecting
   a transaction someone actually made is never right. Migration 2 makes the
   index non-unique.

2. **A partial conflict handler.** The insert declared `ON CONFLICT(id)` only,
   so a dedupe collision was an *unhandled* UNIQUE violation — raised inside
   `withTransactionAsync`, which rolled back every row in the import.

3. **An optimistic write nobody checked.** `commitStaged` updated the store
   first and never awaited the repository. The rejection went to `lastError`,
   which nothing renders, and the screen reported success. The rows lived in
   memory until the next reload — a pull-to-refresh, reopening the app — and
   then disappeared, long after the import that had "worked".

An optimistic update is a promise that the write will succeed. For a hundred
rows of someone's financial history that is not a promise worth making, so
`commitStaged` now persists first and lets the caller show a real failure.
`tests/dedupe.test.ts` pins all of it, including a check that replays every
migration to assert no UNIQUE index on `dedupe_key` survives.

### Money moved between your own pockets is not spending

OPay's autosave sweeps incoming money into OWealth and sweeps it back to pay,
so one ₦5,000 payment appears three times and every leg asks to be
categorised. On the reference statement that was 60 of 229 rows — a quarter of
the review queue, none of it a real decision.

`src/core/internalTransfer.ts` detects those from the **raw** descriptor
(`normaliseMerchant` strips "transfer", "credit" and "debit", which is exactly
the vocabulary needed) and files them under the Transfer category, which is
excluded from every total. Two things that share the pot's name are kept apart:
a move is not spending, but "OWealth Interest Earned" is real income.

Only same-wallet pots count — OWealth, Cashbox, Spend-and-Save. Money sent to
PiggyVest or Cowrywise has genuinely left the account and stays visible under
Savings & investment. Plenty of people use no pot at all, so it is a Settings
switch rather than an assumption.

### A total that disagrees with the list under it is worse than no total

The dashboard headline read "Spent this month ₦0.00" while the breakdown two
inches below it listed ₦113,120 across 19 transactions. Both were computing
honestly — they were answering different questions. `spent` came from
`aggregateBudgets`, which sums what fell *inside a budget envelope*, and with
no budgets defined that is zero by definition.

`useDashboardData` now reports two figures. `spent` is everything spent in the
period, on the same basis the breakdown uses, so the two can never disagree.
`budgetedSpend` keeps the old meaning and stays paired with `allocated` inside
the budget card.

The same reasoning removed "of ₦0" and a pace bar with nothing to pace against:
safe-to-spend is derived entirely from envelopes, so with no budgets it is not
a small number, it is not a number at all. The screen says so and offers to set
one.

### Two things both called "Uncategorised"

A transaction with no `categoryId` is bucketed by the analytics layer under the
sentinel `__uncategorised__`, which is not a row in the categories table. The
seeded catch-all category is a real row with the id `cat_uncategorised`.

Tapping the Uncategorised bar handed the chart's sentinel to the transactions
list, which matched on the real id, and 19 transactions rendered as an empty
screen. Nothing threw and nothing logged.

`matchesCategorySelection` in `src/core/analytics.ts` owns that comparison now,
treats either spelling as "not filed", and is covered by
`tests/categorySelection.test.ts` — the check belongs in one tested function
rather than being re-derived at every call site.

### The review queue is organised around decisions, not rows

A statement import used to drop every row into "needs review", including the
ones an explicit user rule had already matched. 162 rows meant 162 taps. Four
changes, each aimed at a different reason that was slow:

- **Confident matches arrive filed.** `shouldAutoApply` already encoded "sure
  enough to apply without asking"; the importer now honours it and only queues
  genuine unknowns and model guesses.
- **One decision covers a counterparty, not a row.** `src/core/counterparty.ts`
  reads "Transfer to RASHIDAT BASHIRU | OPay | 7046464337 | chi" into a person
  and an account number, so twelve transfers with twelve different notes are
  one group. Direction is part of the key: money sent to someone and money
  received from them are never the same category.
- **Money out and money in are separate queues.** Different categories,
  different question in the reader's head.
- **A filed row stays visible until you clear it.** A queue that deletes the
  row you just touched moves the next one under your thumb and gives you
  nothing to check your work against.

The picker itself is `src/components/CategorySheet.tsx` — every category rather
than the first ten, filtered to the direction, with the bulk choice made as a
toggle *before* committing rather than a native alert asking afterwards.

### A statement is read by geometry, not by reading order

`src/ingest/pdf/table.ts` assigns every text run to a column by its x
coordinate. The obvious approach — walk the lines in reading order, start a row
when one begins with a date, append everything else to it — is what shipped
first, and it silently produced wrong money.

A statement row is a grid, but a long description wraps. So one transaction is
printed as three visual lines, with the amounts on the middle one and the
description spilling above and below it. Appending the spill to the end of the
row left the row one cell short in the middle and two long at the end. Every
column after the description shifted left by one, and the parser read the
running balance where the credit belonged: a ₦15,000.00 transfer imported as
₦16,840.00.

Nothing failed. No exception, no warning, a number that looks exactly like a
number that belongs on a bank statement. That is the worst thing this app can
do, so the reader now uses the layout the PDF already contains — statement
tables are laid out on fixed left-aligned x positions, so clustering the
positions the data actually uses recovers the real columns, and a wrapped line
merges into the *column* it was printed in.

Column anchors are taken from the rows, never the header: a heading like
"Debit(₦)" is emitted as two runs at two positions, and treating that stray
"(₦)" as a column boundary splits the amount column in half.

The check that matters is in `tests/statementFiles.test.ts`: the same account
and period, exported by the bank as both a PDF and an XLSX, must produce the
same transactions to the kobo — and both must match the totals the bank printed
in the file's own preamble. Ground truth beats a snapshot of whatever the
parser happened to do.

Related: an exporter's declared spreadsheet range is not to be trusted either.
The OPay XLSX declares `A10:H178` while its header sits at A7 and two real
transactions at A8 and A9, so `readSpreadsheet` recomputes the range from the
cells that actually exist.

### A statement can change shape half way down

The PDF reader was silently dropping 58 transactions, and every test said it was
fine.

An OPay statement covering a wallet and a savings account prints **two** tables,
and the second is laid out on its own x positions — the description column moves
from 177.9 to 195.4, the debit column from 303.8 to 259.5. `tabulate` clustered
column anchors across the whole file and emitted one grid under one header, so
every savings row landed a column to the right of where the header said it was.
`parseStatementGrid` read `cells[columns.date]`, found an empty string, and hit
`if (!dateCell) continue` — the branch meant for trailing totals rows. No
exception, no warning, not even an entry in `problems`.

The suite passed because it had been written against wallet-only totals, and
nobody knew the savings section existed. Worse, `tests/fixtures.ts` searched only
`Downloads`; the statements had moved into the repo, so the thirteen
cross-format checks had been skipping — reported as passes — for some time.

Three changes, at three different layers:

- `tabulateSections` computes anchors **per section**. A repeated page header is
  told apart from a new section by the only thing that actually distinguishes
  them: a page repeat sits on the same x positions, a new section does not.
- `parseStatementGrid` **re-reads the header** whenever it meets one instead of
  skipping it, so the column map is allowed to change mid-file. A transaction row
  cannot be mistaken for a header — `detectColumns` needs a cell naming a date
  column and one naming a description column, and a row of dates and amounts has
  neither.
- `tests/fixtures.ts` searches every location the files have lived in, because
  each move had silently switched the strongest tests in the repo off.

### Reconcile against the bank's own arithmetic, or the next one is silent too

Every failure this importer has had was silent, and each was found by accident.
The fix is to stop relying on accident: the bank prints its own totals in the
file preamble, and that is ground truth written by the institution that moved the
money.

`src/ingest/statement/reconcile.ts` reads them from both layouts banks use — the
stacked one a PDF emits (a row of labels, then a row of values, with the currency
symbol as its own text run) and the inline one a spreadsheet uses — sums them
across sections, and compares. Zero tolerance: money is integer minor units on
both sides and the declared figures are exact. A tolerance here would be a
tolerance on how wrong someone's financial history is allowed to be.

Two things make it safe to give this a veto over imports:

**The declaration is checked before it is trusted.** A section must satisfy
`opening + credit − debit = closing`. If it does not, we misread the preamble
rather than the rows, and that section is excluded from the verdict instead of
being allowed to block a good import. Without that guard, a bank whose preamble
we parse badly would be permanently unimportable — which is just the old silent
failure wearing a new costume.

**A mismatch names a count before an amount.** Sorting all four checks by
absolute delta ranks a ₦14.73 discrepancy above 56 missing transactions, because
minor units are large numbers and row counts are small ones. A failing count is
also the more diagnostic: it says rows are missing or doubled, where a money
delta alone could be one misread digit.

The screen refuses rather than warns. A warning above a working button is no
guard at all when the whole failure mode is that a wrong amount looks exactly
like a right one — there is nothing on the screen for the reader to catch it
with. The override is a separate, deliberate tap taken after seeing which figure
disagrees and by how much.

### The device has fewer Web APIs than Node or Chrome

`src/ingest/bytes.ts` decodes Latin-1, UTF-8 and UTF-16 by hand instead of
calling `new TextDecoder(...)`. That looks like reinvention. It is not.

React Native has no `TextDecoder`. Expo installs a polyfill, and that polyfill
decodes **UTF-8 and nothing else** — every other label throws
`RangeError: Unknown encoding`.

The PDF reader built one at module scope:

```ts
const DECODER = new TextDecoder('latin1');   // fine in Node, fine in Chrome
```

Node has a complete implementation, so every test passed. Chrome has one, so
`npm run web` was fine. Metro bundles the line without comment, so the build
was green. On the phone it threw while the module was being evaluated, which
meant tapping "Import a bank statement" closed the app instantly — no error, no
red screen, nothing to read. Only `adb logcat` showed it.

Two lessons, both encoded in `tests/runtimeCompat.test.ts`:

1. Shipped code constructs no `TextDecoder` at all. A static scan enforces it.
2. The import path is exercised under a stub that behaves exactly like Expo's
   polyfill, so the *whole class* of failure — not just the spelling we already
   know about — fails in Node in milliseconds instead of on a device after a
   fifteen-minute build.

The general rule: **a green test suite says the logic is right, not that it
runs on the phone.** Anything touching bytes, encodings, timers, `Intl`,
`crypto` or streams deserves a device check, and the fastest device check is
the dev build (`npm run dev`), not another APK.

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
