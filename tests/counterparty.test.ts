/**
 * Grouping peer transfers by who they went to.
 *
 * Every descriptor here is copied from a real OPay statement. The note on the
 * end ("chi", "milk") is what makes plain merchant matching see twelve
 * different merchants where there is one person.
 */

import { describe, it, expect } from 'vitest';
import { readCounterparty, groupKey, describeGroup, groupTitle } from '@/core/counterparty';
import { merchantKey } from '@/core/categorize';

describe('readCounterparty', () => {
  it('reads an outbound transfer', () => {
    const c = readCounterparty('Transfer to RASHIDAT BASHIRU | OPay | 7046464337 | chi');
    expect(c).toMatchObject({
      direction: 'out',
      name: 'RASHIDAT BASHIRU',
      bank: 'OPay',
      account: '7046464337',
    });
  });

  it('reads an inbound transfer', () => {
    const c = readCounterparty(
      'Transfer from ADEBAYO ABDULAKEEM OLADIMEJI | United Bank For Africa | 211****578 | MOB/UTO/x'
    );
    expect(c?.direction).toBe('in');
    expect(c?.name).toBe('ADEBAYO ABDULAKEEM OLADIMEJI');
    // Masked, so it must not be used as identity.
    expect(c?.account).toBeUndefined();
  });

  it('is not a transfer when nothing says to or from', () => {
    expect(readCounterparty('Mobile Data | 7046464337 | MTN | 3.2GB 2 Days Plan')).toBeNull();
    expect(readCounterparty('OPay Card Payment | SportyBet')).toBeNull();
    expect(readCounterparty('Stamp Duty')).toBeNull();
  });
});

describe('groupKey', () => {
  const key = (raw: string, inflow = false) => groupKey(raw, inflow, merchantKey);

  it('puts every transfer to the same person in one group, whatever the note', () => {
    const notes = [
      'Transfer to RASHIDAT BASHIRU | OPay | 7046464337 | chi',
      'Transfer to RASHIDAT BASHIRU | OPay | 7046464337 | milk',
      'Transfer to RASHIDAT BASHIRU | OPay | 7046464337 | ice cream',
    ];
    const keys = new Set(notes.map((n) => key(n)));
    expect(keys.size).toBe(1);
  });

  it('keeps money out and money in apart for the same person', () => {
    // This is the whole point: sending someone ₦5,000 and receiving ₦5,000
    // from them are not the same category, and never should be filed together.
    const out = key('Transfer to ADEBAYO ABDULAKEEM | OPay | 8102579422 | chi', false);
    const back = key('Transfer from ADEBAYO ABDULAKEEM | OPay | 8102579422 | refund', true);
    expect(out).not.toBe(back);
  });

  it('groups by account number when the name is written differently', () => {
    const a = key('Transfer to ADEBAYO ABDUL-AKEEM OLADIMEJI | OPay | 8102579422 | chi');
    const b = key('Transfer to ADEBAYO ABDULAKEEM OLADIMEJI | OPay | 8102579422 | rent');
    expect(a).toBe(b);
  });

  it('does not merge two different people', () => {
    const a = key('Transfer to RASHIDAT BASHIRU | OPay | 7046464337 | chi');
    const b = key('Transfer to SUNBO OLAYINKA BABALOLA | OPay | 8053382670 | chi');
    expect(a).not.toBe(b);
  });

  it('still groups ordinary merchants', () => {
    const a = key('OPay Card Payment | SportyBet');
    const b = key('OPay Card Payment | SportyBet');
    expect(a).toBe(b);
  });
});

describe('describeGroup', () => {
  it('names the person so the prompt reads like a sentence', () => {
    expect(describeGroup('Transfer to RASHIDAT BASHIRU | OPay | 7046464337 | chi', false)).toBe(
      'to Rashidat Bashiru'
    );
    expect(
      describeGroup('Transfer from HAMMED LEKAN ADELEKE | OPay | 8031234567 | x', true)
    ).toBe('from Hammed Lekan Adeleke');
  });
});

describe('grouping mode is the filer’s choice', () => {
  /**
   * The reason this exists, in the owner's words: money sent to a friend so
   * she can buy milk is not *his* groceries. The note describes the purpose
   * for the person receiving it; the account number describes who they are.
   * Which of those to file by is a judgement about the relationship, so the
   * app offers all three and does not decide.
   */
  const rows = [
    'Transfer to RASHIDAT BASHIRU | OPay | 7046464337 | milk',
    'Transfer to RASHIDAT BASHIRU | OPay | 7046464337 | gas',
    'Transfer to RASHIDAT BASHIRU | OPay | 7046464337 | fare',
    'Transfer to AISHAT BUKOLA ADEBAYO | OPay | 7063139770 | milk',
  ];
  const keys = (mode: 'account' | 'person' | 'note') =>
    rows.map((r) => groupKey(r, false, merchantKey, mode));

  it('by account: one bucket per person, whatever the money was for', () => {
    const k = keys('account');
    expect(new Set(k).size).toBe(2);
    expect(k[0]).toBe(k[1]);
    expect(k[1]).toBe(k[2]);
    expect(k[3]).not.toBe(k[0]);
  });

  it('by person: same shape, for banks that mask the account number', () => {
    const k = keys('person');
    expect(new Set(k).size).toBe(2);
    expect(k[0]).toBe(k[2]);
  });

  it('by note: buckets the purpose instead, across people', () => {
    const k = keys('note');
    // "milk" to two different people is one bucket; gas and fare are their own.
    expect(k[0]).toBe(k[3]);
    expect(new Set(k).size).toBe(3);
  });

  it('never merges money out with money in, in any mode', () => {
    const out = groupKey(rows[0], false, merchantKey, 'note');
    const back = groupKey('Transfer from RASHIDAT BASHIRU | OPay | 7046464337 | milk', true, merchantKey, 'note');
    expect(out).not.toBe(back);
  });

  it('titles a group by what it is grouped on', () => {
    expect(groupTitle(rows[0], 'account')).toBe('Rashidat Bashiru');
    expect(groupTitle(rows[0], 'person')).toBe('Rashidat Bashiru');
    expect(groupTitle(rows[0], 'note')).toBe('Milk');
  });

  it('reads naturally in the bulk prompt', () => {
    expect(describeGroup(rows[0], false, 'account')).toBe('to Rashidat Bashiru');
    expect(describeGroup(rows[0], false, 'note')).toBe('noted "milk"');
  });
});
