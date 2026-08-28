/**
 * How Finlo talks.
 *
 * The app reported "Transport is up 887%" and left it there. That is a
 * dashboard talking. A companion says which category, how much in money, and
 * whether it is worth caring about — and then stops.
 *
 * Four rules keep the voice from becoming either a nag or a liar:
 *
 *  1. **A percentage needs a base worth dividing by, and a ceiling.** ₦1,500
 *     to ₦14,800 is "+887%", which is true and useless — nobody holds a
 *     ninefold increase in their head as a percentage. Below a floor the
 *     sentence talks in naira; above a ceiling it talks in multiples; in
 *     between, where a percentage is genuinely the clearest form, it uses one.
 *  2. **Essentials are not lifestyle choices.** Rent going up is not something
 *     to be teased about, and a joke about it is the moment someone stops
 *     trusting the app. Those categories get a flat, factual line.
 *  3. **Say nothing rather than something empty.** A change too small to act
 *     on returns null, and the screen shows one fewer card. Filler is how an
 *     app teaches people to skip its messages.
 *  4. **The tone follows the money, not the writer's mood.** Spending less is
 *     encouragement; spending much more is a raised eyebrow, never a telling
 *     off. It is their money.
 *
 * Deterministic: the same numbers always produce the same sentence. Variety
 * comes from the category, not from a random pick, because a figure that
 * reads differently on each refresh looks broken.
 *
 * Pure: no React, no I/O, no clock except what is passed in.
 */

import { formatMoney, money, type CurrencyCode } from './money';

export type NudgeTone = 'good' | 'neutral' | 'watch';

export interface Nudge {
  icon: string;
  headline: string;
  body: string;
  tone: NudgeTone;
}

/** Below this, last period's figure is too small to take a ratio of. */
const PERCENT_FLOOR_MINOR = 1_000_00;

/**
 * Past this, a percentage stops being a number people use.
 *
 * "Up 887%" is arithmetically fine and communicates nothing — nobody holds a
 * ninefold increase in their head as a percentage. Beyond this the sentence
 * switches to a multiple, which is how a person would actually say it.
 */
const PERCENT_CEILING = 300;

/** Below this, a change is not worth a sentence. */
const MATERIAL_MINOR = 200_00;

/** A change has to be at least this big a share to be worth remarking on. */
const MATERIAL_FRACTION = 0.15;

/**
 * Categories nobody chose to have.
 *
 * Matched on the name so a renamed or user-created category still lands
 * correctly — "House rent" and "Rent & housing" both read as essential.
 */
const ESSENTIAL = /rent|housing|mortgage|utilit|electric|water|health|medical|insurance|school|tuition|educat|fee|charge|tax|loan|debt|repay/i;

export function isEssential(categoryName: string): boolean {
  return ESSENTIAL.test(categoryName);
}

/** "Good afternoon, Hakeem 👋" */
export function greeting(now: Date, name?: string): string {
  const hour = now.getHours();
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const who = name?.trim() ? `, ${name.trim().split(/\s+/)[0]}` : '';
  return `${part}${who} 👋`;
}

/**
 * The line under the headline figure on Home.
 *
 * Answers "is this a lot?", which is the only thing a spend total means on its
 * own. Without a previous period to compare against it says so plainly rather
 * than inventing a verdict.
 */
export function spendSummary(
  currentMinor: number,
  previousMinor: number,
  currency: CurrencyCode,
  opts: { partial?: boolean } = {}
): Nudge {
  const delta = currentMinor - previousMinor;
  const at = opts.partial ? ' at this point' : '';
  const amount = (m: number) => formatMoney(money(Math.abs(m), currency), { compactDecimals: true });

  if (previousMinor === 0) {
    return {
      icon: '👋',
      headline: 'First month on the board',
      body: 'Once there is a month behind you, this is where the comparison goes.',
      tone: 'neutral',
    };
  }

  if (Math.abs(delta) < MATERIAL_MINOR) {
    return {
      icon: '⚖️',
      headline: 'About the same as last month',
      body: `Within ${amount(MATERIAL_MINOR)} of where you were${at}. Steady.`,
      tone: 'neutral',
    };
  }

  if (delta < 0) {
    return {
      icon: '📉',
      headline: `${amount(delta)} less than last month`,
      body: `You are spending lighter${at}. Nice work.`,
      tone: 'good',
    };
  }

  return {
    icon: '📈',
    headline: `${amount(delta)} more than last month`,
    body: `You are ahead of last month${at}. Worth a look at what moved.`,
    tone: 'watch',
  };
}

/**
 * One category that moved, in a sentence a person would say.
 *
 * Returns null when there is nothing worth saying — which is most categories,
 * most months.
 */
export function categoryNudge(
  input: {
    categoryName: string;
    icon: string;
    currentMinor: number;
    previousMinor: number;
  },
  currency: CurrencyCode
): Nudge | null {
  const { categoryName, icon, currentMinor, previousMinor } = input;
  const delta = currentMinor - previousMinor;
  const amount = (m: number) => formatMoney(money(Math.abs(m), currency), { compactDecimals: true });

  // Too small to matter, in money or in proportion.
  if (Math.abs(delta) < MATERIAL_MINOR) return null;
  const base = Math.max(previousMinor, currentMinor);
  if (base > 0 && Math.abs(delta) / base < MATERIAL_FRACTION) return null;

  const comparison = describeChange(currentMinor, previousMinor, currency);

  const essential = isEssential(categoryName);

  if (previousMinor === 0) {
    return {
      icon,
      headline: `${categoryName} is new this month`,
      body: `${amount(currentMinor)} so far, with nothing here last month.`,
      tone: essential ? 'neutral' : 'watch',
    };
  }

  if (delta < 0) {
    return {
      icon,
      headline: `${categoryName} is down`,
      body: `${amount(currentMinor)} this month, ${comparison}.`,
      tone: 'good',
    };
  }

  // Up. Essentials get the facts and no commentary.
  if (essential) {
    return {
      icon,
      headline: `${categoryName} is higher this month`,
      body: `${amount(currentMinor)}, ${comparison}.`,
      tone: 'neutral',
    };
  }

  return {
    icon,
    headline: `${categoryName} had a busy month`,
    body: `${amount(currentMinor)}, ${comparison}. Worth keeping an eye on.`,
    tone: 'watch',
  };
}

/**
 * How this period compares, said the way a person would say it.
 *
 * Three registers, picked by how big the move is rather than by preference:
 * money when the base is too small to divide by, a multiple when the ratio is
 * past the point of being holdable, and a percentage in the middle where a
 * percentage is genuinely the clearest form.
 */
export function describeChange(
  currentMinor: number,
  previousMinor: number,
  currency: CurrencyCode
): string {
  const delta = currentMinor - previousMinor;
  const direction = delta >= 0 ? 'more than' : 'less than';
  const inMoney = formatMoney(money(Math.abs(delta), currency), { compactDecimals: true });

  if (previousMinor < PERCENT_FLOOR_MINOR) {
    return `${inMoney} ${direction} last month`;
  }

  const percent = Math.round((delta / previousMinor) * 100);

  if (Math.abs(percent) > PERCENT_CEILING) {
    const times = currentMinor / previousMinor;
    // One decimal below 10x, whole numbers above: "2.4x" is useful, "11.3x" is not.
    const shown = times >= 10 ? Math.round(times) : Math.round(times * 10) / 10;
    return `about ${shown}× last month`;
  }

  return `${Math.abs(percent)}% ${direction} last month`;
}

/**
 * The same comparison, short enough for a chip beside a bar.
 *
 * Returns null when there is nothing to say, so a row with no prior month
 * shows no badge at all rather than a meaningless one. Same ceiling as the
 * sentence form: past 300% it switches to a multiple, because "▲ 887%" tells
 * a reader nothing except that a big number exists.
 */
export function compactChange(
  currentMinor: number,
  previousMinor: number
): { label: string; rising: boolean } | null {
  if (previousMinor < PERCENT_FLOOR_MINOR) return null;

  const delta = currentMinor - previousMinor;
  const percent = Math.round((delta / previousMinor) * 100);
  // A change that rounds to nothing is not a change.
  if (Math.abs(percent) < 1) return null;

  const rising = delta > 0;
  if (Math.abs(percent) > PERCENT_CEILING) {
    const times = currentMinor / previousMinor;
    const shown = times >= 10 ? Math.round(times) : Math.round(times * 10) / 10;
    return { label: `${shown}×`, rising };
  }

  return { label: `${Math.abs(percent)}%`, rising };
}

/**
 * The few nudges worth showing, biggest mover first.
 *
 * Capped hard. Three observations is a briefing; ten is a wall nobody reads,
 * and the eleventh teaches people that none of them matter.
 */
export function topNudges(
  deltas: readonly {
    categoryName: string;
    icon: string;
    currentMinor: number;
    previousMinor: number;
  }[],
  currency: CurrencyCode,
  limit = 3
): Nudge[] {
  return deltas
    .map((d) => ({ delta: d, nudge: categoryNudge(d, currency) }))
    .filter((x): x is { delta: (typeof deltas)[number]; nudge: Nudge } => x.nudge != null)
    .sort(
      (a, b) =>
        Math.abs(b.delta.currentMinor - b.delta.previousMinor) -
        Math.abs(a.delta.currentMinor - a.delta.previousMinor)
    )
    .slice(0, limit)
    .map((x) => x.nudge);
}
