/**
 * The app's lighter register.
 *
 * `voice.ts` handles sentences about money and is careful for good reasons —
 * you do not tease someone about rent, and a percentage off a tiny base is
 * noise wearing a finding's costume. This file is for everywhere the app is
 * *not* commenting on someone's spending: empty screens, section intros, the
 * line under a heading when there is nothing to report.
 *
 * That distinction is the safety rule. Personality is free when there is no
 * money in the sentence and expensive when there is, so nothing here ever takes
 * a figure as an argument. If a line needs a number in it, it belongs in
 * `voice.ts` under `voice.ts`'s rules.
 *
 * Two more, inherited:
 *
 * **Stable within a day.** Picked from the date, never at random. A screen that
 * rewords itself when you scroll reads as broken, and an empty state is on
 * screen precisely when someone is least sure the app is working.
 *
 * **Warm, not chirpy.** These appear when someone has no data, no budgets, or
 * nothing worth flagging — moments where a joke at their expense lands badly.
 * The tone is a colleague being easy about it, not an app being pleased with
 * itself.
 *
 * Pure: no React, no I/O, no clock except what is passed in.
 */

export type CopySlot =
  | 'noTransactions'
  | 'noBudgets'
  | 'noGoals'
  | 'nothingToReview'
  | 'nothingStandsOut'
  | 'allCaughtUp'
  | 'noSearchMatch';

export interface CopyLine {
  /** The heading. Short enough to survive two lines on a phone. */
  title: string;
  /** One sentence under it, saying what would change things. */
  body: string;
}

/**
 * Every line ends by pointing somewhere.
 *
 * An empty state that is only a joke leaves someone exactly where they were.
 * The body always names the next move, so the personality is in the phrasing
 * and never instead of the help.
 */
const LINES: Record<CopySlot, CopyLine[]> = {
  noTransactions: [
    {
      title: 'A clean slate',
      body: 'Import a statement and Finlo will read a whole month in one go.',
    },
    {
      title: 'Nothing here yet',
      body: 'Add one transaction, or hand over a bank statement and skip the typing.',
    },
    {
      title: 'Empty, for now',
      body: 'Statements are the fast way in — PDF, Excel or CSV from your bank app.',
    },
  ],
  noBudgets: [
    {
      title: 'No envelopes yet',
      body: 'A budget turns a list of transactions into a plan you can be ahead or behind of.',
    },
    {
      title: 'Nothing set aside',
      body: 'Set one envelope and the trend line starts telling you whether it is too fast.',
    },
    {
      title: 'No limits set',
      body: 'Finlo can suggest an amount from your own recent months — you just confirm it.',
    },
  ],
  noGoals: [
    {
      title: 'Nothing saved for yet',
      body: 'A goal is a target and a date. Finlo works out the monthly cost and tells you when you drift.',
    },
    {
      title: 'No goals on the board',
      body: 'Name one thing you are saving toward and Finlo does the arithmetic.',
    },
  ],
  nothingToReview: [
    {
      title: 'Queue is empty',
      body: 'Everything imported has a category. Nothing is waiting on you.',
    },
    {
      title: 'All filed',
      body: 'Nothing left to categorise — the next import will land here.',
    },
    {
      title: 'Nothing waiting',
      body: 'Every transaction has been placed. Come back after the next import.',
    },
  ],
  nothingStandsOut: [
    {
      title: 'A quiet month',
      body: 'Nothing moved far enough from your usual to be worth flagging.',
    },
    {
      title: 'Steady so far',
      body: 'No category has jumped enough this period for Finlo to comment on it.',
    },
    {
      title: 'Nothing unusual',
      body: 'Your spending is tracking close to where it normally sits.',
    },
  ],
  allCaughtUp: [
    { title: 'All caught up', body: 'Nothing new since you last looked.' },
    { title: 'Nothing new', body: 'Finlo will put anything worth knowing here.' },
  ],
  noSearchMatch: [
    { title: 'No matches', body: 'Nothing here matches that. Try a shorter word.' },
    { title: 'Nothing found', body: 'Try part of a merchant name, or clear the search.' },
  ],
};

/** Same small stable hash as `greeting.ts` — same input, same pick, everywhere. */
function seedOf(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash;
}

/**
 * A line for this slot, stable for the day.
 *
 * `today` is a `YYYY-MM-DD` string rather than a `Date` so callers pass the
 * same value the rest of the app already computes, and so this stays testable
 * without faking a clock.
 */
export function copyFor(slot: CopySlot, today: string): CopyLine {
  const lines = LINES[slot];
  return lines[seedOf(`${slot}|${today}`) % lines.length];
}

/** Every line for a slot. Used by the tests to check the whole set holds up. */
export function allCopy(slot: CopySlot): readonly CopyLine[] {
  return LINES[slot];
}

export const COPY_SLOTS = Object.keys(LINES) as CopySlot[];
