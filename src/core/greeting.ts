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

export type GreetingLanguage =
  // Home: the owner, the testers, the market.
  | 'en'
  | 'pcm'
  | 'yo'
  | 'ig'
  | 'ha'
  // Everywhere else.
  | 'fr'
  | 'es'
  | 'it'
  | 'ja'
  | 'ko'
  | 'zh'
  | 'ar'
  /*
    Romanisations, as separate languages rather than a display toggle.

    Someone who wants to be greeted in Japanese but does not read kana is asking
    for a different thing from someone who reads kana — not for the same thing
    rendered differently. Making them separate entries means they can be ticked
    independently in a mix, which a toggle could not express.

    `-Latn` is the BCP 47 script subtag, so these are real language tags rather
    than invented codes.
  */
  | 'ja-Latn'
  | 'ko-Latn'
  | 'zh-Latn'
  | 'ar-Latn';

/** How often a mix changes language. */
export type MixPace = 'daily' | 'slot';

/** What the picker offers. `rotate` moves through a chosen set of languages. */
export type GreetingMode = GreetingLanguage | 'rotate';

export const GREETING_LANGUAGES: Array<{
  code: GreetingLanguage;
  label: string;
  /** Shown in the picker so the choice can be made by reading, not guessing. */
  sample: string;
  /**
   * Right-to-left script.
   *
   * Only Arabic here, and it matters: the greeting is RTL and the name after it
   * is Latin, so without an isolate the comma and the emoji end up on the wrong
   * side of the line. See `greeting` for the fix.
   */
  rtl?: boolean;
  /** Set when this entry is a Latin-script rendering of another language. */
  romanises?: GreetingLanguage;
}> = [
  { code: 'en', label: 'English', sample: 'Good morning' },
  { code: 'pcm', label: 'Pidgin', sample: 'Morning o' },
  { code: 'yo', label: 'Yorùbá', sample: 'Ẹ káàárọ̀' },
  { code: 'ig', label: 'Igbo', sample: 'Ụtụtụ ọma' },
  { code: 'ha', label: 'Hausa', sample: 'Barka da safe' },
  { code: 'fr', label: 'Français', sample: 'Bonjour' },
  { code: 'es', label: 'Español', sample: 'Buenos días' },
  { code: 'it', label: 'Italiano', sample: 'Buongiorno' },

  /*
    Each script is followed immediately by its Latin rendering.

    Ordering is the whole of the pairing: with the romanisations grouped at the
    end of the list, "日本語" sat four chips away from "Japanese (rōmaji)" and
    nothing on screen said they were the same greeting. Adjacent, the labels do
    that work and the picker needs no extra chrome to explain itself.
  */
  { code: 'ja', label: '日本語', sample: 'おはようございます' },
  { code: 'ja-Latn', label: 'Japanese (rōmaji)', sample: 'Ohayō gozaimasu', romanises: 'ja' },

  { code: 'ko', label: '한국어', sample: '좋은 아침이에요' },
  { code: 'ko-Latn', label: 'Korean (romaja)', sample: 'Joeun achimieyo', romanises: 'ko' },

  { code: 'zh', label: '中文', sample: '早上好' },
  { code: 'zh-Latn', label: 'Chinese (pinyin)', sample: 'Zǎoshang hǎo', romanises: 'zh' },

  { code: 'ar', label: 'العربية', sample: 'صباح الخير', rtl: true },
  /*
    Deliberately NOT rtl.

    A romanisation of an RTL language is left-to-right text — it is Latin script
    — so it must not get the isolate treatment its parent needs. Marking it RTL
    because Arabic is RTL would break the one line it was added to fix.
  */
  { code: 'ar-Latn', label: 'Arabic (Latin)', sample: 'Sabah al-khayr', romanises: 'ar' },
];

/** Codes only, for defaults and validation. */
export const ALL_LANGUAGES: GreetingLanguage[] = GREETING_LANGUAGES.map((l) => l.code);

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
  fr: {
    earlyMorning: ['Bonjour'],
    morning: ['Bonjour'],
    afternoon: ['Bon après-midi', 'Bonjour'],
    evening: ['Bonsoir'],
    // "Bonne nuit" is a goodbye, not a hello. Bonsoir holds all evening.
    night: ['Bonsoir'],
  },
  es: {
    earlyMorning: ['Buenos días'],
    morning: ['Buenos días'],
    afternoon: ['Buenas tardes'],
    // Spanish moves to "noches" in the evening; there is no separate night form.
    evening: ['Buenas noches'],
    night: ['Buenas noches'],
  },
  it: {
    earlyMorning: ['Buongiorno'],
    morning: ['Buongiorno'],
    afternoon: ['Buon pomeriggio', 'Buongiorno'],
    evening: ['Buonasera'],
    // "Buonanotte" is a goodbye. Buonasera is the greeting.
    night: ['Buonasera'],
  },
  ja: {
    // Polite forms throughout: the casual ones would be odd from an app.
    earlyMorning: ['おはようございます'],
    morning: ['おはようございます'],
    afternoon: ['こんにちは'],
    evening: ['こんばんは'],
    night: ['こんばんは'],
  },
  ko: {
    earlyMorning: ['좋은 아침이에요'],
    morning: ['좋은 아침이에요', '안녕하세요'],
    afternoon: ['안녕하세요'],
    evening: ['좋은 저녁이에요', '안녕하세요'],
    night: ['안녕하세요'],
  },
  zh: {
    earlyMorning: ['早上好'],
    morning: ['早上好'],
    afternoon: ['下午好'],
    evening: ['晚上好'],
    night: ['晚上好'],
  },
  ar: {
    // Arabic has a morning form and an afternoon/evening form, and no third.
    earlyMorning: ['صباح الخير'],
    morning: ['صباح الخير'],
    afternoon: ['مساء الخير'],
    evening: ['مساء الخير'],
    night: ['مساء الخير'],
  },

  /*
    The romanisations, line for line with their parents above.

    Each uses the standard system for its language rather than an ad-hoc
    spelling, because the point is that someone can read it aloud and be
    understood: Hepburn for Japanese, Revised Romanization for Korean, Hanyu
    Pinyin with tone marks for Chinese. Pinyin keeps its tone marks — they are
    the pronunciation, and stripping them makes the word ambiguous.

    Arabic is romanised without academic diacritics. This is for reading, not
    for transcription, and "Ṣabāḥ al-khayr" helps nobody who came here because
    they could not read the script in the first place.
  */
  'ja-Latn': {
    earlyMorning: ['Ohayō gozaimasu'],
    morning: ['Ohayō gozaimasu'],
    afternoon: ['Konnichiwa'],
    evening: ['Konbanwa'],
    night: ['Konbanwa'],
  },
  'ko-Latn': {
    earlyMorning: ['Joeun achimieyo'],
    morning: ['Joeun achimieyo', 'Annyeonghaseyo'],
    afternoon: ['Annyeonghaseyo'],
    evening: ['Joeun jeonyeogieyo', 'Annyeonghaseyo'],
    night: ['Annyeonghaseyo'],
  },
  'zh-Latn': {
    earlyMorning: ['Zǎoshang hǎo'],
    morning: ['Zǎoshang hǎo'],
    afternoon: ['Xiàwǔ hǎo'],
    evening: ['Wǎnshang hǎo'],
    night: ['Wǎnshang hǎo'],
  },
  'ar-Latn': {
    earlyMorning: ['Sabah al-khayr'],
    morning: ['Sabah al-khayr'],
    afternoon: ['Masa al-khayr'],
    evening: ['Masa al-khayr'],
    night: ['Masa al-khayr'],
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
  /**
   * Which languages `rotate` moves through.
   *
   * Empty or absent means all of them. Someone who wants English, Pidgin and
   * Yorùbá and nothing else says so here — a mix that always included twelve
   * languages would be a novelty rather than a setting.
   */
  mix?: readonly GreetingLanguage[];
  /** `daily` changes at midnight; `slot` changes as the day moves. */
  pace?: MixPace;
  /** Overrides the day used for the stable pick. Defaults to `now`. */
  today?: string;
}

/**
 * Keep the greeting and the Latin name from fighting over the line.
 *
 * "صباح الخير, Adebayo 👋" is right-to-left text followed by left-to-right
 * text, and the Unicode bidi algorithm resolves the trailing comma and emoji
 * against the *paragraph* direction — so on an RTL greeting they jump to the
 * far side and the line reads as gibberish. Wrapping the Latin run in a
 * first-strong isolate (U+2068 … U+2069) tells the algorithm to resolve that
 * span on its own, which is exactly what it is for.
 *
 * Two invisible characters, and the alternative is a language that renders
 * wrong for everyone who reads it.
 */
const ISOLATE_START = '\u2068';
const ISOLATE_END = '\u2069';

function isolate(text: string): string {
  return `${ISOLATE_START}${text}${ISOLATE_END}`;
}

export function isRtl(language: GreetingLanguage): boolean {
  return GREETING_LANGUAGES.find((l) => l.code === language)?.rtl === true;
}

/**
 * Resolve which language to greet in.
 *
 * Exported because the pick is the interesting part and deserves its own tests
 * — `greeting` only formats what this decides.
 */
export function languageFor(options: GreetingOptions, slot: Slot, day: string): GreetingLanguage {
  const mode = options.mode ?? 'en';
  if (mode !== 'rotate') return mode;

  /*
    A one-language mix is not a mix.

    Someone can tick a single box, and the honest response is to use it every
    time rather than pretend to rotate. Filtering to known codes as well, so a
    stale setting from an older build cannot select a language that no longer
    exists and fall through to an empty list.
  */
  const chosen = (options.mix ?? []).filter((code) => ALL_LANGUAGES.includes(code));
  const pool = chosen.length > 0 ? chosen : ALL_LANGUAGES;
  if (pool.length === 1) return pool[0];

  // `slot` pace re-picks as the day moves; `daily` holds until midnight.
  const seed = (options.pace ?? 'daily') === 'slot' ? `${day}|${slot}` : day;
  return pool[seedOf(seed) % pool.length];
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
    options.today ?? `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;

  const language = languageFor(options, slot, day);
  const lines = LINES[language]?.[slot] ?? LINES.en[slot];
  // Seeded on day *and* slot, so morning and evening are not forced to the
  // same index and the whole day does not read as one repeated phrase.
  const line = lines[seedOf(`${day}|${slot}|${language}`) % lines.length];

  const who = firstName(options.name);
  if (!who) return `${line} 👋`;

  return isRtl(language)
    ? `${line}، ${isolate(who)} 👋`
    : `${line}, ${who} 👋`;
}

/** Parse the stored comma-separated mix, dropping anything unrecognised. */
export function parseMix(raw?: string): GreetingLanguage[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((code) => code.trim() as GreetingLanguage)
    .filter((code) => ALL_LANGUAGES.includes(code));
}

export function serialiseMix(mix: readonly GreetingLanguage[]): string {
  return mix.join(',');
}
