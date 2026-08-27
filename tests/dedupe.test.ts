/**
 * The import that lost 228 transactions.
 *
 * A tester imported a 24 Jul – 25 Aug OPay statement. The app said it imported
 * everything, she reviewed roughly 200 rows, and then all of it vanished except
 * about fifteen. Restarting did not bring it back, because it had never been
 * written.
 *
 * Three things had to line up:
 *
 *  1. `dedupe_key` is account+date+amount, and the schema made it UNIQUE, on
 *     the stated theory that two identical payments on one day are rare. On a
 *     Nigerian fintech statement they are routine — stamp duty is a flat charge
 *     on every qualifying transfer. Her file had 13 colliding transactions.
 *  2. The insert declared only `ON CONFLICT(id)`, so a dedupe collision was an
 *     unhandled UNIQUE violation inside the batch's transaction, rolling back
 *     every row in the import.
 *  3. `commitStaged` updated the store first and never awaited the write, so
 *     the failure landed in `lastError`, which nothing renders, and the screen
 *     reported success. The rows survived in memory until the next reload.
 *
 * These tests pin down (1) and the count-blindness that came with it. Migration
 * 2 covers the schema, and `commitStaged` now writes before it shows.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { STATEMENT_XLSX } from './fixtures';
import { countKeys, markDuplicates } from '@/core/dedupe';
import { dedupeKey, MIGRATIONS, SCHEMA_VERSION } from '@/db/schema';
import { readStatement } from '@/ingest/statement/sources';
import { parseStatementGrid } from '@/ingest/statement/parse';

describe('the schema does not reject real transactions', () => {
  it('has no UNIQUE index on dedupe_key after every migration', () => {
    const statements = MIGRATIONS.flatMap((m) => m.statements);

    // Replay the index in migration order; the last word wins.
    let unique = false;
    for (const statement of statements) {
      if (!/idx_tx_dedupe/.test(statement)) continue;
      if (/^\s*DROP INDEX/i.test(statement)) unique = false;
      else if (/CREATE\s+UNIQUE\s+INDEX/i.test(statement)) unique = true;
      else if (/CREATE\s+INDEX/i.test(statement)) unique = false;
    }

    expect(
      unique,
      'A UNIQUE index on dedupe_key rejects genuinely distinct transactions — ' +
        'three ₦50 stamp duty charges on one day — and takes the whole batch ' +
        'down with it. Dedupe is decided at import time, where the user can see it.'
    ).toBe(false);
  });

  it('bumps the schema version so installed apps actually run the fix', () => {
    expect(SCHEMA_VERSION).toBe(Math.max(...MIGRATIONS.map((m) => m.version)));
  });
});

describe('markDuplicates', () => {
  const key = (r: { date: string; amountMinor: number }) => `acc|${r.date}|${r.amountMinor}|NGN`;

  it('imports three identical charges as three', () => {
    // The exact shape of the loss: 21 Aug had three ₦50 stamp duty rows.
    const rows = [
      { date: '2026-08-21', amountMinor: -5000 },
      { date: '2026-08-21', amountMinor: -5000 },
      { date: '2026-08-21', amountMinor: -5000 },
    ];
    expect(markDuplicates(rows, key, new Map())).toEqual([false, false, false]);
  });

  it('treats only as many as already exist as duplicates', () => {
    const rows = [
      { date: '2026-08-21', amountMinor: -5000 },
      { date: '2026-08-21', amountMinor: -5000 },
      { date: '2026-08-21', amountMinor: -5000 },
    ];
    const existing = countKeys(['acc|2026-08-21|-5000|NGN']);
    // One is already stored, so the other two are still new.
    expect(markDuplicates(rows, key, existing)).toEqual([true, false, false]);
  });

  it('is a no-op when the whole window is already stored', () => {
    const rows = [
      { date: '2026-08-21', amountMinor: -5000 },
      { date: '2026-08-22', amountMinor: -120000 },
    ];
    const existing = countKeys(['acc|2026-08-21|-5000|NGN', 'acc|2026-08-22|-120000|NGN']);
    expect(markDuplicates(rows, key, existing)).toEqual([true, true]);
  });

  it('keeps different days and amounts apart', () => {
    const rows = [
      { date: '2026-08-21', amountMinor: -5000 },
      { date: '2026-08-22', amountMinor: -5000 },
    ];
    const existing = countKeys(['acc|2026-08-21|-5000|NGN']);
    expect(markDuplicates(rows, key, existing)).toEqual([true, false]);
  });
});

const XLSX_FILE = STATEMENT_XLSX ?? '';

describe.skipIf(STATEMENT_XLSX == null)('the statement that triggered it', () => {
  it('really does contain colliding dedupe keys', () => {
    const source = readStatement(new Uint8Array(readFileSync(XLSX_FILE)), 's.xlsx');
    const parsed = parseStatementGrid(source.rows, { currency: 'NGN', today: '2026-08-26' });

    const keys = parsed.rows.map((r) => dedupeKey('acc_wallet', r.date, r.amountMinor, 'NGN'));
    const distinct = new Set(keys).size;

    // If this ever stops colliding the test above stops proving anything.
    expect(distinct).toBeLessThan(parsed.rows.length);
  });

  it('imports every row of it, collisions and all', () => {
    const source = readStatement(new Uint8Array(readFileSync(XLSX_FILE)), 's.xlsx');
    const parsed = parseStatementGrid(source.rows, { currency: 'NGN', today: '2026-08-26' });

    const flags = markDuplicates(
      parsed.rows,
      (r) => dedupeKey('acc_wallet', r.date, r.amountMinor, 'NGN'),
      new Map()
    );

    // Nothing already stored, so nothing is a duplicate: all 229 import.
    expect(flags.filter(Boolean)).toHaveLength(0);
    expect(flags).toHaveLength(parsed.rows.length);
  });
});
