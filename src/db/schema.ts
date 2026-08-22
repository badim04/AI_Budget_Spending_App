/**
 * SQLite schema.
 *
 * Local-first: the phone holds the real database and works fully offline, which
 * is the only way a "log this as you spend" app is usable at a checkout counter
 * on bad signal. Sync is additive on top (every table carries updated_at and a
 * soft-delete column so a later CRDT-ish merge has what it needs), not a
 * prerequisite.
 *
 * Money is stored as INTEGER minor units. SQLite's REAL is a float, and storing
 * money in it would undo everything money.ts is careful about.
 *
 * Migrations are an append-only list. Never edit a shipped migration — a user
 * who already ran version 3 will never run your edited version 3 again.
 */

export const SCHEMA_VERSION = 1;

export interface Migration {
  version: number;
  name: string;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial',
    statements: [
      `PRAGMA journal_mode = WAL;`,
      `PRAGMA foreign_keys = ON;`,

      `CREATE TABLE IF NOT EXISTS accounts (
        id                    TEXT PRIMARY KEY NOT NULL,
        name                  TEXT NOT NULL,
        kind                  TEXT NOT NULL,
        currency              TEXT NOT NULL,
        opening_balance_minor INTEGER NOT NULL DEFAULT 0,
        opened_at             TEXT NOT NULL,
        institution           TEXT,
        mask                  TEXT,
        credit_limit_minor    INTEGER,
        color                 TEXT,
        icon                  TEXT,
        archived              INTEGER NOT NULL DEFAULT 0,
        created_at            TEXT NOT NULL,
        updated_at            TEXT NOT NULL
      );`,

      `CREATE TABLE IF NOT EXISTS categories (
        id                    TEXT PRIMARY KEY NOT NULL,
        name                  TEXT NOT NULL,
        kind                  TEXT NOT NULL,
        parent_id             TEXT REFERENCES categories(id) ON DELETE SET NULL,
        icon                  TEXT NOT NULL DEFAULT '',
        color                 TEXT NOT NULL DEFAULT '',
        exclude_from_totals   INTEGER NOT NULL DEFAULT 0,
        sort_order            INTEGER NOT NULL DEFAULT 0,
        is_system             INTEGER NOT NULL DEFAULT 0,
        archived              INTEGER NOT NULL DEFAULT 0,
        -- Stable slug the shipped keyword lexicon maps onto. Null for
        -- user-created categories, which the lexicon knows nothing about.
        slug                  TEXT UNIQUE
      );`,

      `CREATE TABLE IF NOT EXISTS transactions (
        id                    TEXT PRIMARY KEY NOT NULL,
        account_id            TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        kind                  TEXT NOT NULL,
        amount_minor          INTEGER NOT NULL,
        currency              TEXT NOT NULL,
        date                  TEXT NOT NULL,
        merchant              TEXT NOT NULL DEFAULT '',
        raw_description       TEXT,
        note                  TEXT,
        category_id           TEXT REFERENCES categories(id) ON DELETE SET NULL,
        transfer_pair_id      TEXT,
        source                TEXT NOT NULL DEFAULT 'manual',
        confidence            TEXT NOT NULL DEFAULT 'unreviewed',
        reviewed              INTEGER NOT NULL DEFAULT 0,
        original_amount_minor INTEGER,
        original_currency     TEXT,
        fx_rate_used          REAL,
        receipt_id            TEXT,
        recurring_rule_id     TEXT,
        tags                  TEXT NOT NULL DEFAULT '[]',
        -- Hash of account+date+amount+descriptor. UNIQUE is what actually stops
        -- the same payment arriving twice from an email receipt and a bank feed.
        dedupe_key            TEXT NOT NULL,
        pending               INTEGER NOT NULL DEFAULT 0,
        created_at            TEXT NOT NULL,
        updated_at            TEXT NOT NULL,
        deleted_at            TEXT
      );`,

      `CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_dedupe ON transactions(dedupe_key);`,
      // The dashboard's hot path is "all transactions in a date range", so date
      // leads the index; category and account follow for the filtered views.
      `CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_tx_account_date ON transactions(account_id, date DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_tx_category_date ON transactions(category_id, date DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_tx_unreviewed ON transactions(reviewed, date DESC) WHERE deleted_at IS NULL;`,

      `CREATE TABLE IF NOT EXISTS transaction_splits (
        id                    TEXT PRIMARY KEY NOT NULL,
        transaction_id        TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        category_id           TEXT NOT NULL REFERENCES categories(id),
        amount_minor          INTEGER NOT NULL,
        note                  TEXT
      );`,
      `CREATE INDEX IF NOT EXISTS idx_split_tx ON transaction_splits(transaction_id);`,

      `CREATE TABLE IF NOT EXISTS receipts (
        id                    TEXT PRIMARY KEY NOT NULL,
        file_uri              TEXT NOT NULL,
        thumbnail_uri         TEXT,
        mime_type             TEXT NOT NULL,
        byte_size             INTEGER NOT NULL DEFAULT 0,
        status                TEXT NOT NULL DEFAULT 'uploaded',
        ocr_text              TEXT,
        ocr_confidence        REAL,
        merchant              TEXT,
        date                  TEXT,
        total_minor           INTEGER,
        tax_minor             INTEGER,
        tip_minor             INTEGER,
        currency              TEXT,
        line_items            TEXT,
        transaction_id        TEXT REFERENCES transactions(id) ON DELETE SET NULL,
        error                 TEXT,
        captured_at           TEXT NOT NULL,
        created_at            TEXT NOT NULL,
        updated_at            TEXT NOT NULL
      );`,
      `CREATE INDEX IF NOT EXISTS idx_receipt_status ON receipts(status);`,
      `CREATE INDEX IF NOT EXISTS idx_receipt_tx ON receipts(transaction_id);`,

      // Full-text search over OCR text, so "which receipt had the router?" works.
      `CREATE VIRTUAL TABLE IF NOT EXISTS receipts_fts USING fts5(
        ocr_text, merchant, content='receipts', content_rowid='rowid'
      );`,

      `CREATE TABLE IF NOT EXISTS budgets (
        id                    TEXT PRIMARY KEY NOT NULL,
        name                  TEXT NOT NULL,
        category_ids          TEXT NOT NULL DEFAULT '[]',
        amount_minor          INTEGER NOT NULL,
        currency              TEXT NOT NULL,
        period                TEXT NOT NULL,
        rollover              TEXT NOT NULL DEFAULT 'reset',
        starts_on             TEXT NOT NULL,
        ends_on               TEXT,
        alert_threshold       REAL NOT NULL DEFAULT 0.8,
        archived              INTEGER NOT NULL DEFAULT 0,
        created_at            TEXT NOT NULL,
        updated_at            TEXT NOT NULL
      );`,

      `CREATE TABLE IF NOT EXISTS recurring_rules (
        id                    TEXT PRIMARY KEY NOT NULL,
        name                  TEXT NOT NULL,
        account_id            TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        category_id           TEXT REFERENCES categories(id) ON DELETE SET NULL,
        kind                  TEXT NOT NULL,
        amount_minor          INTEGER NOT NULL,
        currency              TEXT NOT NULL,
        frequency             TEXT NOT NULL,
        interval_count        INTEGER NOT NULL DEFAULT 1,
        starts_on             TEXT NOT NULL,
        ends_on               TEXT,
        day_of_month          INTEGER,
        day_of_week           INTEGER,
        auto_detected         INTEGER NOT NULL DEFAULT 0,
        variable_amount       INTEGER NOT NULL DEFAULT 0,
        last_generated_on     TEXT,
        merchant              TEXT,
        active                INTEGER NOT NULL DEFAULT 1,
        created_at            TEXT NOT NULL,
        updated_at            TEXT NOT NULL
      );`,

      `CREATE TABLE IF NOT EXISTS category_rules (
        id                    TEXT PRIMARY KEY NOT NULL,
        pattern               TEXT NOT NULL,
        match_type            TEXT NOT NULL DEFAULT 'contains',
        category_id           TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        min_amount_minor      INTEGER,
        max_amount_minor      INTEGER,
        account_id            TEXT REFERENCES accounts(id) ON DELETE CASCADE,
        priority              INTEGER NOT NULL DEFAULT 50,
        enabled               INTEGER NOT NULL DEFAULT 1,
        created_at            TEXT NOT NULL
      );`,

      `CREATE TABLE IF NOT EXISTS goals (
        id                    TEXT PRIMARY KEY NOT NULL,
        name                  TEXT NOT NULL,
        target_minor          INTEGER NOT NULL,
        currency              TEXT NOT NULL,
        account_id            TEXT REFERENCES accounts(id) ON DELETE SET NULL,
        saved_minor           INTEGER NOT NULL DEFAULT 0,
        target_date           TEXT,
        icon                  TEXT NOT NULL DEFAULT '',
        color                 TEXT NOT NULL DEFAULT '',
        archived              INTEGER NOT NULL DEFAULT 0,
        created_at            TEXT NOT NULL,
        updated_at            TEXT NOT NULL
      );`,

      `CREATE TABLE IF NOT EXISTS fx_rates (
        base                  TEXT NOT NULL,
        quote                 TEXT NOT NULL,
        rate                  REAL NOT NULL,
        as_of                 TEXT NOT NULL,
        source                TEXT,
        PRIMARY KEY (base, quote)
      );`,

      // Ingestion bookkeeping: which email/statement we already processed, so a
      // re-sync doesn't re-import six months of transactions.
      `CREATE TABLE IF NOT EXISTS ingest_log (
        id                    TEXT PRIMARY KEY NOT NULL,
        source                TEXT NOT NULL,
        external_id           TEXT NOT NULL,
        status                TEXT NOT NULL,
        transaction_id        TEXT,
        error                 TEXT,
        processed_at          TEXT NOT NULL
      );`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_ingest_external ON ingest_log(source, external_id);`,

      `CREATE TABLE IF NOT EXISTS settings (
        key                   TEXT PRIMARY KEY NOT NULL,
        value                 TEXT NOT NULL
      );`,
    ],
  },
];

/**
 * Triggers keeping the FTS index in step with the receipts table. Kept separate
 * from the CREATE TABLE list so the search index can be dropped and rebuilt
 * without touching user data.
 */
export const FTS_TRIGGERS = [
  `CREATE TRIGGER IF NOT EXISTS receipts_fts_insert AFTER INSERT ON receipts BEGIN
     INSERT INTO receipts_fts(rowid, ocr_text, merchant)
     VALUES (new.rowid, coalesce(new.ocr_text, ''), coalesce(new.merchant, ''));
   END;`,
  `CREATE TRIGGER IF NOT EXISTS receipts_fts_delete AFTER DELETE ON receipts BEGIN
     INSERT INTO receipts_fts(receipts_fts, rowid, ocr_text, merchant)
     VALUES ('delete', old.rowid, coalesce(old.ocr_text, ''), coalesce(old.merchant, ''));
   END;`,
  `CREATE TRIGGER IF NOT EXISTS receipts_fts_update AFTER UPDATE ON receipts BEGIN
     INSERT INTO receipts_fts(receipts_fts, rowid, ocr_text, merchant)
     VALUES ('delete', old.rowid, coalesce(old.ocr_text, ''), coalesce(old.merchant, ''));
     INSERT INTO receipts_fts(rowid, ocr_text, merchant)
     VALUES (new.rowid, coalesce(new.ocr_text, ''), coalesce(new.merchant, ''));
   END;`,
];

/**
 * A dedupe key that is stable across sources.
 *
 * Deliberately excludes the descriptor, which differs between an email receipt
 * ("Netflix") and a bank feed ("NETFLIX.COM 08/13 REF:1234") for the same
 * payment. Account + date + exact amount is specific enough in practice, and
 * two genuinely distinct payments of the identical amount on the same day to
 * the same account are rare enough to be worth the occasional manual split.
 */
export function dedupeKey(
  accountId: string,
  date: string,
  amountMinor: number,
  currency: string
): string {
  return `${accountId}|${date}|${amountMinor}|${currency}`;
}
