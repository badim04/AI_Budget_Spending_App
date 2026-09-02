/**
 * How Finlo says hello.
 *
 * Split out of `voice.ts`, which is about turning money into sentences. This is
 * about turning a name and a clock into one — a different job, and one with a
 * constraint the money voice does not have: it is the first thing on screen
 * every single time the app opens, so it has to stay fresh without ever looking
 * unstable.
 *
 * Those two pull against each other, and the resolution is the whole design:
 *
 * **Variety comes from the day, not from the render.** A greeting picked at
 * random re-rolls on every re-render — you scroll, the app re-renders, and the
 * header changes wording under your thumb. That reads as a bug, and `voice.ts`
 * already bans it for figures for the same reason. So the pick is seeded from
 * the date: stable from midnight to midnight, different tomorrow. Same rule,
 * met a different way.
 *
 * **Languages, because Nigeria.** The owner and the testers are Nigerian, and
 * "Good morning" is not the only way any of them start a sentence. English,
 * Nigerian Pidgin, Yoruba, Igbo and Hausa are offered, plus a rotating mode
 * that moves through them.
 *
 * Only widely-attested standard forms are used, with the tone marks Yoruba and
 * Igbo actually take. A greeting misspelled in someone's own language is worse
 * than not offering it, so this list stays short and conservative rather than
 * clever, and anything uncertain was left out. **Worth a native speaker's eye
 * before it goes to testers.**
 *
 * Pure: no React, no I/O, no clock except what is passed in.
 */

export type GreetingLanguage = 'en' | 'pcm' | 'yo' | 'ig' | 'ha';

/** What the picker offers. `rotate` moves through the languages by the day. */
export type GreetingMode = GreetingLanguage | 'rotate';

export const GREETING_LANGUAGES: Array<{
  code: GreetingLanguage;
  label: string;
  /** Shown in the picker so the choice can be made by reading, not guessing. */
  sample: string;
}> = [
  { code: 'en', label: 'English', sample: 'Good morning' },
  { code: 'pcm', label: 'Pidgin', sample: 'Morning o' },
  { code: 'yo', label: 'Yorùbá', sample: 'Ẹ káàárọ̀' },
  { code: 'ig', label: 'Igbo', sample: 'Ụtụtụ ọma' },
  { code: 'ha', label: 'Hausa', sample: 'Barka da safe' },
];

/**
 * Five slices, not three.
 *
 * "Good evening" at 11pm is technically correct and slightly wrong — someone
 * awake then knows they are up late, and an app that notices is warmer than one
 * that does not. `night` and `earlyMorning` exist for that, and only English
 * and Pidgin carry a distinct form for them; the others fall back to the
 * nearest standard greeting rather than having one invented for them.
 */
type Slot = 'earlyMorning' | 'morning' | 'afternoon' | 'evening' | 'night';

export function slotFor(hour: number): Slot {
  if (hour < 5) return 'night';
  if (hour < 8) return 'earlyMorning';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'night';
}

/**
 * The greetings themselves.
 *
 * More than one per slot so the day-seeded pick has something to choose from.
 * Every line has to work with a name appended after a comma, which rules out
 * anything ending in punctuation.
 */
const LINES: Record<GreetingLanguage, Record<Slot, string[]>> = {
  en: {
    earlyMorning: ['Up early', 'Morning', 'Good morning'],
    morning: ['Good morning', 'Morning', 'Hello'],
    afternoon: ['Good afternoon', 'Afternoon', 'Hello'],
    evening: ['Good evening', 'Evening', 'Hello'],
    night: ['Still up', 'Good evening', 'Late one'],
  },
  pcm: {
    earlyMorning: ['You don wake', 'Morning o'],
    morning: ['Morning o', 'How you dey', 'How far'],
    afternoon: ['Afternoon o', 'How you dey', 'How far'],
    evening: ['Evening o', 'How the day go', 'How far'],
    night: ['You never sleep', 'Evening o'],
  },
  yo: {
    // Ẹ káàárọ̀ / Ẹ káàsán / Ẹ kúùrọ̀lẹ́ are the standard three.
    earlyMorning: ['Ẹ káàárọ̀'],
    morning: ['Ẹ káàárọ̀'],
    afternoon: ['Ẹ káàsán'],
    evening: ['Ẹ kúùrọ̀lẹ́'],
    night: ['Ẹ kúùrọ̀lẹ́'],
  },
  ig: {
    // The "ọma" (good) forms, which are the safe standard ones.
    earlyMorning: ['Ụtụtụ ọma'],
    morning: ['Ụtụtụ ọma'],
    afternoon: ['Ehihie ọma'],
    evening: ['Mgbede ọma'],
    night: ['Abalị ọma'],
  },
  ha: {
    // Barka da safe / rana / yamma — the standard set.
    earlyMorning: ['Barka da safe'],
    morning: ['Barka da safe'],
    afternoon: ['Barka da rana'],
    evening: ['Barka da yamma'],
    night: ['Barka da dare'],
  },
};

/** A small, stable hash. Same input, same number, on every device. */
function seedOf(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash;
}

/**
 * Capitalise a name the way its owner would write it.
 *
 * Someone who types "abdul-akeem" should not be greeted as "abdul-akeem", and
 * `charAt(0).toUpperCase()` alone gets "Abdul-akeem". Hyphens and apostrophes
 * both start a new part of a name — Abdul-Akeem, O'Brien — so each segment is
 * capitalised.
 *
 * A name already containing a capital past the first letter is left exactly as
 * typed: "McArthur" and "adeBAYO" are choices, and overriding them is the kind
 * of small rudeness software does constantly.
 */
export function properCase(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  /*
    A capital in a surprising place is a decision; ALL CAPS is not.

    The first version left anything with two capitals alone, which correctly
    protected "McArthur" and then also protected "ADEBAYO" — shouting, and the
    one case most worth fixing. The distinguishing signal is a lower-case letter
    immediately followed by an upper-case one: McArthur and adeBAYO have it,
    ADEBAYO cannot, and "O'Brien" does not (the apostrophe breaks the run), so
    it is normalised and comes out right anyway.
  */
  if (/[a-zà-ÿ][A-ZÀ-Ý]/.test(trimmed)) return trimmed;

  return trimmed
    .split(/(\s+)/)
    .map((part) =>
      /^\s+$/.test(part)
        ? part
        : part
            .split(/([-'’])/)
            .map((piece) =>
              /^[-'’]$/.test(piece)
                ? piece
                : piece.charAt(0).toLocaleUpperCase() + piece.slice(1).toLocaleLowerCase()
            )
            .join('')
    )
    .join('');
}

/** The first word of a name, properly cased. "abdulakeem oladimeji" -> "Abdulakeem" */
export function firstName(name?: string): string {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? '';
  return properCase(first);
}

export interface GreetingOptions {
  name?: string;
  mode?: GreetingMode;
  /** Overrides the day used for the stable pick. Defaults to `now`. */
  today?: string;
}

/**
 * "Ẹ káàsán, Abdulakeem 👋"
 *
 * `now` supplies both the hour and — unless `today` says otherwise — the day
 * that seeds the pick, so the wording holds steady until midnight.
 */
export function greeting(now: Date, nameOrOptions?: string | GreetingOptions): string {
  const options: GreetingOptions =
    typeof nameOrOptions === 'string' ? { name: nameOrOptions } : (nameOrOptions ?? {});

  const slot = slotFor(now.getHours());
  const day =
    options.today ??
    `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;

  const mode: GreetingMode = options.mode ?? 'en';
  const language: GreetingLanguage =
    mode === 'rotate'
      ? GREETING_LANGUAGES[seedOf(day) % GREETING_LANGUAGES.length].code
      : mode;

  const lines = LINES[language]?.[slot] ?? LINES.en[slot];
  // Seeded on day *and* slot, so morning and evening are not forced to the
  // same index and the whole day does not read as one repeated phrase.
  const line = lines[seedOf(`${day}|${slot}`) % lines.length];

  const who = firstName(options.name);
  return `${line}${who ? `, ${who}` : ''} 👋`;
}
