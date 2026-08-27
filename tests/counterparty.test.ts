/**
 * Grouping peer transfers by who they went to.
 *
 * Every descriptor here is copied from a real OPay statement. The note on the
 * end ("chi", "milk") is what makes plain merchant matching see twelve
 * different merchants where there is one person.
 */

import { describe, it, expect } from 'vitest';
import { readCounterparty, groupKey, describeGroup } from '@/core/counterparty';
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
