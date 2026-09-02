/**
 * How Finlo says hello.
 *
 * The interesting tests here are the two that pull against each other: the
 * greeting has to feel varied and it has to never change under someone's thumb.
 * A random pick satisfies the first and fails the second — you scroll, the
 * component re-renders, and the header rewords itself. So variety is seeded
 * from the day, and both properties are pinned below.
 *
 * The rest are about names. Getting someone's own name wrong on the first line
 * of the screen is a small rudeness that software commits constantly.
 */

import { describe, it, expect } from 'vitest';
import {
  ALL_LANGUAGES,
  GREETING_LANGUAGES,
  firstName,
  greeting,
  isRtl,
  languageFor,
  parseMix,
  properCase,
  serialiseMix,
  slotFor,
  type GreetingLanguage,
} from '@/core/greeting';

const AT = (iso: string) => new Date(iso);

describe('slotFor', () => {
  it('splits the day into five, not three', () => {
    expect(slotFor(2)).toBe('night');
    expect(slotFor(6)).toBe('earlyMorning');
    expect(slotFor(9)).toBe('morning');
    expect(slotFor(14)).toBe('afternoon');
    expect(slotFor(19)).toBe('evening');
    expect(slotFor(23)).toBe('night');
  });

  /** Someone awake at 11pm knows they are up late. */
  it('does not call 11pm the evening', () => {
    expect(slotFor(23)).not.toBe('evening');
  });
});

describe('properCase', () => {
  it('capitalises a name typed in lower case', () => {
    expect(properCase('abdulakeem')).toBe('Abdulakeem');
    expect(properCase('adebayo hakeem')).toBe('Adebayo Hakeem');
  });

  it('capitalises past a hyphen and an apostrophe', () => {
    // charAt(0).toUpperCase() alone gives "Abdul-akeem", which is wrong.
    expect(properCase('abdul-akeem')).toBe('Abdul-Akeem');
    expect(properCase("o'brien")).toBe("O'Brien");
  });

  it('fixes SHOUTING', () => {
    expect(properCase('ADEBAYO')).toBe('Adebayo');
  });

  /**
   * A capital past the first letter is a decision, not a mistake.
   */
  it('leaves a deliberately cased name exactly as typed', () => {
    expect(properCase('McArthur')).toBe('McArthur');
    expect(properCase('adeBAYO')).toBe('adeBAYO');
  });

  it('survives empty and whitespace-only input', () => {
    expect(properCase('')).toBe('');
    expect(properCase('   ')).toBe('');
  });
});

describe('firstName', () => {
  it('takes the first word and cases it', () => {
    expect(firstName('abdulakeem oladimeji adebayo')).toBe('Abdulakeem');
  });

  it('returns nothing for nothing', () => {
    expect(firstName()).toBe('');
    expect(firstName('  ')).toBe('');
  });
});

describe('greeting', () => {
  it('greets by first name, properly cased', () => {
    expect(greeting(AT('2026-08-26T14:00:00'), 'abdulakeem oladimeji')).toContain(
      ', Abdulakeem'
    );
  });

  it('reads naturally with no name at all', () => {
    const line = greeting(AT('2026-08-26T14:00:00'));
    expect(line).not.toContain(',');
    expect(line).toContain('👋');
  });

  /**
   * The constraint that shapes the whole module.
   *
   * `voice.ts` bans a figure that reads differently on each refresh, for the
   * same reason: it looks broken. A greeting is on screen more often than any
   * figure, so it matters more here, not less.
   */
  it('does not change between renders on the same day', () => {
    const at = AT('2026-08-26T09:15:00');
    const first = greeting(at, { name: 'Adebayo', mode: 'rotate' });
    for (let i = 0; i < 50; i++) {
      expect(greeting(at, { name: 'Adebayo', mode: 'rotate' })).toBe(first);
    }
  });

  it('does change across days, so it does not go stale', () => {
    const seen = new Set<string>();
    for (let day = 1; day <= 28; day++) {
      const iso = `2026-09-${String(day).padStart(2, '0')}T09:00:00`;
      seen.add(greeting(AT(iso), { mode: 'en' }));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('does not repeat the same phrase all day', () => {
    const day = AT('2026-08-26T00:00:00');
    const slots = [6, 10, 14, 19, 23].map((hour) => {
      const at = new Date(day);
      at.setHours(hour);
      return greeting(at, { mode: 'en' });
    });
    expect(new Set(slots).size).toBeGreaterThan(2);
  });

  describe('languages', () => {
    const codes = GREETING_LANGUAGES.map((l) => l.code);

    it.each(codes)('%s greets in every slot without falling back to English', (code) => {
      for (const hour of [2, 6, 10, 14, 19, 23]) {
        const at = AT('2026-08-26T00:00:00');
        at.setHours(hour);
        const line = greeting(at, { mode: code as GreetingLanguage, name: 'Adebayo' });

        expect(line).toContain('Adebayo');
        expect(line.trim().length).toBeGreaterThan(3);
        if (code !== 'en') {
          // A language that silently rendered the English line would look
          // supported and not be.
          expect(line).not.toMatch(/Good (morning|afternoon|evening)/);
        }
      }
    });

    it('rotate moves through the languages rather than sitting on one', () => {
      const seen = new Set<string>();
      for (let day = 1; day <= 28; day++) {
        const iso = `2026-09-${String(day).padStart(2, '0')}T09:00:00`;
        seen.add(greeting(AT(iso), { mode: 'rotate' }));
      }
      expect(seen.size).toBeGreaterThanOrEqual(3);
    });

    it('offers every one it claims to', () => {
      expect(ALL_LANGUAGES).toHaveLength(16);
      expect(new Set(ALL_LANGUAGES).size).toBe(ALL_LANGUAGES.length);
      for (const code of [
        'en', 'pcm', 'yo', 'ig', 'ha', 'fr', 'es', 'it', 'ja', 'ko', 'zh', 'ar',
        'ja-Latn', 'ko-Latn', 'zh-Latn', 'ar-Latn',
      ]) {
        expect(ALL_LANGUAGES).toContain(code as GreetingLanguage);
      }
    });

    it('offers a readable sample for each, so the picker can be read not guessed', () => {
      for (const language of GREETING_LANGUAGES) {
        // "中文" is two characters and perfectly readable; an assertion tuned to
        // Latin word lengths is the wrong test once the list stops being Latin.
        expect(language.label.length, language.code).toBeGreaterThanOrEqual(2);
        expect(language.sample.length, language.code).toBeGreaterThanOrEqual(2);
        expect(language.sample.trim(), language.code).toBe(language.sample);
      }
    });
  });

  /** Every line has to work with ", Name" appended after it. */
  it('never produces a line that ends in punctuation before the name', () => {
    for (const language of GREETING_LANGUAGES) {
      for (const hour of [2, 6, 10, 14, 19, 23]) {
        const at = AT('2026-08-26T00:00:00');
        at.setHours(hour);
        const line = greeting(at, { mode: language.code, name: 'Adebayo' });
        expect(line, `${language.code}@${hour}`).not.toMatch(/[.!?],/);
      }
    }
  });
});

describe('a chosen mix', () => {
  const MIX: GreetingLanguage[] = ['en', 'pcm', 'yo'];

  it('only ever uses the languages that were ticked', () => {
    const seen = new Set<GreetingLanguage>();
    for (let day = 1; day <= 40; day++) {
      const iso = `2026-09-${String(((day - 1) % 30) + 1).padStart(2, '0')}`;
      for (const hour of [6, 10, 14, 19, 23]) {
        seen.add(languageFor({ mode: 'rotate', mix: MIX, pace: 'slot' }, slotFor(hour), iso));
      }
    }
    for (const code of seen) expect(MIX).toContain(code);
    expect(seen.size).toBeGreaterThan(1);
  });

  /** Ticking one box is a choice, not a rotation to fake. */
  it('uses a single ticked language every time', () => {
    for (const hour of [6, 14, 23]) {
      const at = AT('2026-08-31T00:00:00');
      at.setHours(hour);
      expect(greeting(at, { mode: 'rotate', mix: ['ja'] })).toMatch(/[ぁ-んァ-ン一-龯]/);
    }
  });

  it('falls back to every language when nothing is ticked', () => {
    const seen = new Set<GreetingLanguage>();
    for (let day = 1; day <= 28; day++) {
      seen.add(languageFor({ mode: 'rotate', mix: [] }, 'morning', `2026-09-${day}`));
    }
    expect(seen.size).toBeGreaterThan(3);
  });

  /**
   * A setting written by an older build must not select a language that no
   * longer exists and leave the pool empty.
   */
  it('ignores codes it does not recognise', () => {
    expect(parseMix('en,klingon,yo')).toEqual(['en', 'yo']);
    expect(parseMix('')).toEqual([]);
    expect(parseMix(undefined)).toEqual([]);
    expect(serialiseMix(['en', 'ar'])).toBe('en,ar');

    const only = languageFor({ mode: 'rotate', mix: ['nope' as GreetingLanguage] }, 'morning', '2026-09-01');
    expect(ALL_LANGUAGES).toContain(only);
  });

  describe('pace', () => {
    const DAY = '2026-09-03';

    it('daily holds the same language all day', () => {
      const slots = (['earlyMorning', 'morning', 'afternoon', 'evening', 'night'] as const).map(
        (slot) => languageFor({ mode: 'rotate', mix: MIX, pace: 'daily' }, slot, DAY)
      );
      expect(new Set(slots).size).toBe(1);
    });

    it('slot changes it as the day moves', () => {
      const seen = new Set<GreetingLanguage>();
      for (let day = 1; day <= 10; day++) {
        const iso = `2026-09-${String(day).padStart(2, '0')}`;
        for (const slot of ['morning', 'afternoon', 'evening'] as const) {
          seen.add(languageFor({ mode: 'rotate', mix: MIX, pace: 'slot' }, slot, iso));
        }
      }
      expect(seen.size).toBeGreaterThan(1);
    });

    it('is still stable within one slot on one day', () => {
      const at = AT('2026-09-03T10:00:00');
      const first = greeting(at, { mode: 'rotate', mix: MIX, pace: 'slot', name: 'Adebayo' });
      for (let i = 0; i < 20; i++) {
        expect(greeting(at, { mode: 'rotate', mix: MIX, pace: 'slot', name: 'Adebayo' })).toBe(first);
      }
    });
  });
});

describe('right-to-left', () => {
  it('knows which language needs it', () => {
    expect(isRtl('ar')).toBe(true);
    expect(isRtl('en')).toBe(false);
    expect(isRtl('ja')).toBe(false);
  });

  /**
   * Without an isolate the bidi algorithm resolves the trailing comma and emoji
   * against the paragraph direction, and they jump to the far side of the line.
   */
  it('isolates a Latin name inside an Arabic greeting', () => {
    const line = greeting(AT('2026-08-31T09:00:00'), { mode: 'ar', name: 'Adebayo' });
    expect(line).toContain('\u2068Adebayo\u2069');
    // Arabic comma, not the Latin one.
    expect(line).toContain('\u060c');
    expect(line).not.toContain(', ');
  });

  it('adds no isolate when there is no name to isolate', () => {
    const line = greeting(AT('2026-08-31T09:00:00'), { mode: 'ar' });
    expect(line).not.toContain('\u2068');
  });

  it('leaves left-to-right languages untouched', () => {
    const line = greeting(AT('2026-08-31T09:00:00'), { mode: 'fr', name: 'Adebayo' });
    expect(line).not.toContain('\u2068');
    expect(line).toContain(', Adebayo');
  });
});

describe('romanisations', () => {
  const PAIRS = GREETING_LANGUAGES.filter((l) => l.romanises);
  const HOURS = [2, 6, 10, 14, 19, 23];

  const lineAt = (code: GreetingLanguage, hour: number) => {
    const at = AT('2026-08-31T00:00:00');
    at.setHours(hour);
    return greeting(at, { mode: code });
  };

  it('offers one for each of the four non-Latin scripts', () => {
    expect(PAIRS.map((l) => l.romanises).sort()).toEqual(['ar', 'ja', 'ko', 'zh']);
  });

  /**
   * The whole point: readable by someone who cannot read the source script.
   */
  it.each(PAIRS.map((l) => l.code))('%s is written in Latin script only', (code) => {
    for (const hour of HOURS) {
      const line = lineAt(code as GreetingLanguage, hour).replace(' 👋', '');
      // No CJK, kana, hangul or Arabic anywhere in it.
      expect(line, `${code}@${hour}`).not.toMatch(
        /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u0600-\u06ff]/
      );
      expect(line.length).toBeGreaterThan(3);
    }
  });

  it.each(PAIRS.map((l) => l.code))('%s says something different in each part of the day', (code) => {
    const seen = new Set(HOURS.map((h) => lineAt(code as GreetingLanguage, h)));
    expect(seen.size).toBeGreaterThan(1);
  });

  /**
   * A romanisation of an RTL language is Latin text and reads left to right.
   *
   * Marking it RTL because its parent is would apply the bidi isolate to a line
   * that does not need one, breaking exactly what the isolate was added to fix.
   */
  it('never marks a romanisation as right-to-left', () => {
    for (const language of PAIRS) {
      expect(isRtl(language.code), language.code).toBe(false);
    }
    expect(isRtl('ar')).toBe(true);
  });

  it('gives ar-Latn a Latin comma and no isolate', () => {
    const line = greeting(AT('2026-08-31T09:00:00'), { mode: 'ar-Latn', name: 'Adebayo' });
    expect(line).toContain(', Adebayo');
    expect(line).not.toContain('\u2068');
    expect(line).not.toContain('\u060c');
  });

  it('keeps pinyin tone marks, which carry the pronunciation', () => {
    const line = greeting(AT('2026-08-31T09:00:00'), { mode: 'zh-Latn' });
    expect(line).toMatch(/[āáǎàēéěèīíǐìōóǒòūúǔù]/);
  });

  /** Each is a separate entry, so it can be ticked on its own in a mix. */
  it('can be mixed independently of the script it romanises', () => {
    const seen = new Set<GreetingLanguage>();
    for (let day = 1; day <= 30; day++) {
      seen.add(
        languageFor(
          { mode: 'rotate', mix: ['ja-Latn', 'ko-Latn'], pace: 'daily' },
          'morning',
          `2026-09-${day}`
        )
      );
    }
    expect([...seen].sort()).toEqual(['ja-Latn', 'ko-Latn']);
  });
});
