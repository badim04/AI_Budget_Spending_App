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
  GREETING_LANGUAGES,
  firstName,
  greeting,
  properCase,
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

    it('offers a readable sample for each, so the picker can be read not guessed', () => {
      for (const language of GREETING_LANGUAGES) {
        expect(language.label.length).toBeGreaterThan(2);
        expect(language.sample.length).toBeGreaterThan(2);
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
