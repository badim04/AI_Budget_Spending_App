/**
 * Persistence — SQLite driver for iOS and Android.
 *
 * Metro picks this file over `repository.ts` on native, so the browser bundle
 * never sees expo-sqlite. This is the driver that uses the real schema and
 * migrations from `schema.ts`.
 *
 * Rows are stored the way SQLite is good at: money as INTEGER minor units,
 * booleans as 0/1, arrays as JSON text. Everything is converted back into the
 * domain shape on load, in exactly one place (the `row*` functions below), so a
 * column rename has one site to fix.
 */

import * as SQLite from 'expo-sqlite';
import { FTS_TRIGGERS, MIGRATIONS } from './schema';
import { emptySnapshot, type Repository, type Snapshot } from './repository';
import type {
  Account,
  Budget,
  Category,
  ID,
  Receipt,
  RecurringRule,
  Transaction,
  Goal,
} from '../core/types';
import type { CategoryRule } from '../core/categorize';
import type { FxRate } from '../core/money';

const DB_NAME = 'finlo.db';

const bool = (v: unknown) => (v ? 1 : 0);
const unbool = (v: unknown) => v === 1 || v === true;
const json = (v: unknown) => JSON.stringify(v ?? null);
const unjson = <T,>(v: unknown, fallback: T): T => {
  if (typeof v !== 'string' || !v) return fallback;
  try {
    const parsed = JSON.parse(v);
    return parsed == null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
};

class SqliteRepository implements Repository {
  readonly kind = 'sqlite' as const;
  private db: SQLite.SQLiteDatabase | null = null;

  private get database(): SQLite.SQLiteDatabase {
    if (!this.db) throw new Error('Repository used before init()');
    return this.db;
  }

  async init(): Promise<void> {
    if (this.db) return;
    this.db = await SQLite.openDatabaseAsync(DB_NAME);

    // user_version is SQLite's own migration counter, so the app never needs a
    // separate migrations table and can't get out of step with one.
    const row = await this.db.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version'
    );
    let version = row?.user_version ?? 0;

    for (const migration of MIGRATIONS) {
      if (migration.version <= version) continue;
      for (const statement of migration.statements) {
        await this.db.execAsync(statement);
      }
      version = migration.version;
      await this.db.execAsync(`PRAGMA user_version = ${version}`);
    }

    for (const trigger of FTS_TRIGGERS) {
      try {
        await this.db.execAsync(trigger);
      } catch {
        // FTS5 is compiled into the SQLite that ships with Expo, but if a build
        // lacks it, search degrades rather than the app failing to open.
      }
    }
  }

  async loadSnapshot(): Promise<Snapshot> {
    const db = this.database;
    const snap = emptySnapshot();

    snap.accounts = (await db.getAllAsync<any>('SELECT * FROM accounts')).map(rowAccount);
    snap.categories = (
      await db.getAllAsync<any>('SELECT * FROM categories ORDER BY sort_order')
    ).map(rowCategory);
    snap.budgets = (await db.getAllAsync<any>('SELECT * FROM budgets')).map(rowBudget);
    snap.recurringRules = (
      await db.getAllAsync<any>('SELECT * FROM recurring_rules')
    ).map(rowRecurring);
    snap.receipts = (await db.getAllAsync<any>('SELECT * FROM receipts')).map(rowReceipt);
    snap.goals = (await db.getAllAsync<any>('SELECT * FROM goals')).map(rowGoal);
    snap.categoryRules = (
      await db.getAllAsync<any>('SELECT * FROM category_rules')
    ).map(rowCategoryRule);

    // Splits are fetched in one query and grouped in memory rather than with a
    // per-transaction query — N+1 here would be thousands of round trips.
    const txRows = await db.getAllAsync<any>(
      'SELECT * FROM transactions ORDER BY date DESC'
    );
    const splitRows = await db.getAllAsync<any>('SELECT * FROM transaction_splits');
    const splitsByTx = new Map<string, Array<{ categoryId: string; amountMinor: number; note?: string }>>();
    for (const s of splitRows) {
      const list = splitsByTx.get(s.transaction_id) ?? [];
      list.push({ categoryId: s.category_id, amountMinor: s.amount_minor, note: s.note ?? undefined });
      splitsByTx.set(s.transaction_id, list);
    }
    snap.transactions = txRows.map((r) => rowTransaction(r, splitsByTx.get(r.id)));

    const fx = await db.getAllAsync<any>('SELECT * FROM fx_rates');
    snap.fxRates = fx.map((r) => ({
      from: r.base,
      to: r.quote,
      rate: r.rate,
      asOf: r.as_of,
      source: r.source ?? undefined,
    }));

    const settings = await db.getAllAsync<any>('SELECT * FROM settings');
    snap.settings = Object.fromEntries(settings.map((s) => [s.key, s.value]));

    return snap;
  }

  async saveTransaction(t: Transaction): Promise<void> {
    await this.saveTransactions([t]);
  }

  async saveTransactions(list: Transaction[]): Promise<void> {
    const db = this.database;
    // One transaction for the whole batch: an email sync inserting 40 rows
    // should be one fsync, not 40.
    await db.withTransactionAsync(async () => {
      for (const t of list) {
        await db.runAsync(
          `INSERT INTO transactions (
             id, account_id, kind, amount_minor, currency, date, merchant,
             raw_description, note, category_id, transfer_pair_id, source,
             confidence, reviewed, original_amount_minor, original_currency,
             fx_rate_used, receipt_id, recurring_rule_id, tags, dedupe_key,
             pending, created_at, updated_at, deleted_at
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             account_id=excluded.account_id, kind=excluded.kind,
             amount_minor=excluded.amount_minor, currency=excluded.currency,
             date=excluded.date, merchant=excluded.merchant,
             raw_description=excluded.raw_description, note=excluded.note,
             category_id=excluded.category_id,
             transfer_pair_id=excluded.transfer_pair_id, source=excluded.source,
             confidence=excluded.confidence, reviewed=excluded.reviewed,
             original_amount_minor=excluded.original_amount_minor,
             original_currency=excluded.original_currency,
             fx_rate_used=excluded.fx_rate_used, receipt_id=excluded.receipt_id,
             recurring_rule_id=excluded.recurring_rule_id, tags=excluded.tags,
             pending=excluded.pending, updated_at=excluded.updated_at,
             deleted_at=excluded.deleted_at`,
          [
            t.id, t.accountId, t.kind, t.amountMinor, t.currency, t.date,
            t.merchant, t.rawDescription ?? null, t.note ?? null,
            t.categoryId ?? null, t.transferPairId ?? null, t.source,
            t.confidence, bool(t.reviewed), t.originalAmountMinor ?? null,
            t.originalCurrency ?? null, t.fxRateUsed ?? null, t.receiptId ?? null,
            t.recurringRuleId ?? null, json(t.tags), t.dedupeKey, bool(t.pending),
            t.createdAt, t.updatedAt, t.deletedAt ?? null,
          ]
        );

        // Splits are replaced wholesale — diffing them would be more code than
        // it saves, and a transaction never has more than a handful.
        await db.runAsync('DELETE FROM transaction_splits WHERE transaction_id = ?', [t.id]);
        for (const [i, s] of (t.splits ?? []).entries()) {
          await db.runAsync(
            `INSERT INTO transaction_splits (id, transaction_id, category_id, amount_minor, note)
             VALUES (?,?,?,?,?)`,
            [`${t.id}_${i}`, t.id, s.categoryId, s.amountMinor, s.note ?? null]
          );
        }
      }
    });
  }

  async deleteTransaction(id: ID): Promise<void> {
    await this.database.runAsync(
      'UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE id = ?',
      [new Date().toISOString(), new Date().toISOString(), id]
    );
  }

  async saveAccount(a: Account): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO accounts (id, name, kind, currency, opening_balance_minor, opened_at,
         institution, mask, credit_limit_minor, color, icon, archived, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind,
         currency=excluded.currency, opening_balance_minor=excluded.opening_balance_minor,
         opened_at=excluded.opened_at, institution=excluded.institution, mask=excluded.mask,
         credit_limit_minor=excluded.credit_limit_minor, color=excluded.color,
         icon=excluded.icon, archived=excluded.archived, updated_at=excluded.updated_at`,
      [
        a.id, a.name, a.kind, a.currency, a.openingBalanceMinor, a.openedAt,
        a.institution ?? null, a.mask ?? null, a.creditLimitMinor ?? null,
        a.color ?? null, a.icon ?? null, bool(a.archived), a.createdAt, a.updatedAt,
      ]
    );
  }

  async saveCategory(c: Category & { slug?: string | null }): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO categories (id, name, kind, parent_id, icon, color,
         exclude_from_totals, sort_order, is_system, archived, slug)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind,
         parent_id=excluded.parent_id, icon=excluded.icon, color=excluded.color,
         exclude_from_totals=excluded.exclude_from_totals, sort_order=excluded.sort_order,
         archived=excluded.archived`,
      [
        c.id, c.name, c.kind, c.parentId ?? null, c.icon, c.color,
        bool(c.excludeFromTotals), c.sortOrder, bool(c.isSystem), bool(c.archived),
        c.slug ?? null,
      ]
    );
  }

  async saveBudget(b: Budget): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO budgets (id, name, category_ids, amount_minor, currency, period,
         rollover, starts_on, ends_on, alert_threshold, archived, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, category_ids=excluded.category_ids,
         amount_minor=excluded.amount_minor, currency=excluded.currency, period=excluded.period,
         rollover=excluded.rollover, starts_on=excluded.starts_on, ends_on=excluded.ends_on,
         alert_threshold=excluded.alert_threshold, archived=excluded.archived,
         updated_at=excluded.updated_at`,
      [
        b.id, b.name, json(b.categoryIds), b.amountMinor, b.currency, b.period,
        b.rollover, b.startsOn, b.endsOn ?? null, b.alertThreshold, bool(b.archived),
        b.createdAt, b.updatedAt,
      ]
    );
  }

  async saveRecurringRule(r: RecurringRule): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO recurring_rules (id, name, account_id, category_id, kind, amount_minor,
         currency, frequency, interval_count, starts_on, ends_on, day_of_month, day_of_week,
         auto_detected, variable_amount, last_generated_on, merchant, active, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, category_id=excluded.category_id,
         amount_minor=excluded.amount_minor, frequency=excluded.frequency,
         interval_count=excluded.interval_count, starts_on=excluded.starts_on,
         ends_on=excluded.ends_on, day_of_month=excluded.day_of_month,
         variable_amount=excluded.variable_amount, last_generated_on=excluded.last_generated_on,
         merchant=excluded.merchant, active=excluded.active, updated_at=excluded.updated_at`,
      [
        r.id, r.name, r.accountId, r.categoryId ?? null, r.kind, r.amountMinor,
        r.currency, r.frequency, r.interval, r.startsOn, r.endsOn ?? null,
        r.dayOfMonth ?? null, r.dayOfWeek ?? null, bool(r.autoDetected),
        bool(r.variableAmount), r.lastGeneratedOn ?? null, r.merchant ?? null,
        bool(r.active), r.createdAt, r.updatedAt,
      ]
    );
  }

  async saveGoal(g: Goal): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO goals (id, name, target_minor, currency, account_id, saved_minor,
                          target_date, icon, color, archived, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, target_minor=excluded.target_minor,
         currency=excluded.currency, account_id=excluded.account_id,
         saved_minor=excluded.saved_minor, target_date=excluded.target_date,
         icon=excluded.icon, color=excluded.color, archived=excluded.archived,
         updated_at=excluded.updated_at`,
      [
        g.id, g.name, g.targetMinor, g.currency, g.accountId ?? null, g.savedMinor,
        g.targetDate ?? null, g.icon, g.color, g.archived ? 1 : 0, g.createdAt, g.updatedAt,
      ]
    );
  }

  async deleteGoal(id: ID): Promise<void> {
    await this.database.runAsync('DELETE FROM goals WHERE id = ?', [id]);
  }

  async saveReceipt(r: Receipt): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO receipts (id, file_uri, thumbnail_uri, mime_type, byte_size, status,
         ocr_text, ocr_confidence, merchant, date, total_minor, tax_minor, tip_minor,
         currency, line_items, transaction_id, error, captured_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET status=excluded.status, ocr_text=excluded.ocr_text,
         ocr_confidence=excluded.ocr_confidence, merchant=excluded.merchant, date=excluded.date,
         total_minor=excluded.total_minor, tax_minor=excluded.tax_minor,
         tip_minor=excluded.tip_minor, currency=excluded.currency,
         line_items=excluded.line_items, transaction_id=excluded.transaction_id,
         error=excluded.error, thumbnail_uri=excluded.thumbnail_uri,
         updated_at=excluded.updated_at`,
      [
        r.id, r.fileUri, r.thumbnailUri ?? null, r.mimeType, r.byteSize, r.status,
        r.ocrText ?? null, r.ocrConfidence ?? null, r.merchant ?? null, r.date ?? null,
        r.totalMinor ?? null, r.taxMinor ?? null, r.tipMinor ?? null, r.currency ?? null,
        json(r.lineItems), r.transactionId ?? null, r.error ?? null,
        r.capturedAt, r.createdAt, r.updatedAt,
      ]
    );
  }

  async saveCategoryRule(r: CategoryRule): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO category_rules (id, pattern, match_type, category_id, min_amount_minor,
         max_amount_minor, account_id, priority, enabled, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET pattern=excluded.pattern, match_type=excluded.match_type,
         category_id=excluded.category_id, min_amount_minor=excluded.min_amount_minor,
         max_amount_minor=excluded.max_amount_minor, priority=excluded.priority,
         enabled=excluded.enabled`,
      [
        r.id, r.pattern, r.matchType, r.categoryId, r.minAmountMinor ?? null,
        r.maxAmountMinor ?? null, r.accountId ?? null, r.priority, bool(r.enabled),
        new Date().toISOString(),
      ]
    );
  }

  async saveFxRates(rates: FxRate[]): Promise<void> {
    const db = this.database;
    await db.withTransactionAsync(async () => {
      for (const r of rates) {
        await db.runAsync(
          `INSERT INTO fx_rates (base, quote, rate, as_of, source) VALUES (?,?,?,?,?)
           ON CONFLICT(base, quote) DO UPDATE SET rate=excluded.rate,
             as_of=excluded.as_of, source=excluded.source`,
          [r.from, r.to, r.rate, r.asOf, r.source ?? null]
        );
      }
    });
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO settings (key, value) VALUES (?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      [key, value]
    );
  }

  async isIngested(source: string, externalId: string): Promise<boolean> {
    const row = await this.database.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) as n FROM ingest_log WHERE source = ? AND external_id = ?',
      [source, externalId]
    );
    return (row?.n ?? 0) > 0;
  }

  async markIngested(source: string, externalId: string, transactionId?: ID): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO ingest_log (id, source, external_id, status, transaction_id, processed_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(source, external_id) DO UPDATE SET status=excluded.status,
         transaction_id=excluded.transaction_id, processed_at=excluded.processed_at`,
      [
        `${source}_${externalId}`, source, externalId, 'processed',
        transactionId ?? null, new Date().toISOString(),
      ]
    );
  }

  async reset(): Promise<void> {
    const db = this.database;
    const tables = [
      'transaction_splits', 'transactions', 'receipts', 'budgets', 'recurring_rules',
      'category_rules', 'goals', 'fx_rates', 'ingest_log', 'settings', 'categories', 'accounts',
    ];
    await db.withTransactionAsync(async () => {
      for (const t of tables) {
        await db.runAsync(`DELETE FROM ${t}`);
      }
    });
  }
}

// ------------------------------------------------------------ row mapping

function rowAccount(r: any): Account {
  return {
    id: r.id, name: r.name, kind: r.kind, currency: r.currency,
    openingBalanceMinor: r.opening_balance_minor, openedAt: r.opened_at,
    institution: r.institution ?? undefined, mask: r.mask ?? undefined,
    creditLimitMinor: r.credit_limit_minor ?? undefined,
    color: r.color ?? undefined, icon: r.icon ?? undefined,
    archived: unbool(r.archived), createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function rowCategory(r: any): Category {
  return {
    id: r.id, name: r.name, kind: r.kind, parentId: r.parent_id ?? undefined,
    icon: r.icon, color: r.color, excludeFromTotals: unbool(r.exclude_from_totals),
    sortOrder: r.sort_order, archived: unbool(r.archived), isSystem: unbool(r.is_system),
  };
}

function rowTransaction(r: any, splits?: Transaction['splits']): Transaction {
  return {
    id: r.id, accountId: r.account_id, kind: r.kind, amountMinor: r.amount_minor,
    currency: r.currency, date: r.date, merchant: r.merchant,
    rawDescription: r.raw_description ?? undefined, note: r.note ?? undefined,
    categoryId: r.category_id ?? undefined,
    splits: splits && splits.length ? splits : undefined,
    transferPairId: r.transfer_pair_id ?? undefined, source: r.source,
    confidence: r.confidence, reviewed: unbool(r.reviewed),
    originalAmountMinor: r.original_amount_minor ?? undefined,
    originalCurrency: r.original_currency ?? undefined,
    fxRateUsed: r.fx_rate_used ?? undefined, receiptId: r.receipt_id ?? undefined,
    recurringRuleId: r.recurring_rule_id ?? undefined,
    tags: unjson<string[]>(r.tags, []), dedupeKey: r.dedupe_key,
    pending: unbool(r.pending), createdAt: r.created_at, updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? undefined,
  };
}

function rowBudget(r: any): Budget {
  return {
    id: r.id, name: r.name, categoryIds: unjson<string[]>(r.category_ids, []),
    amountMinor: r.amount_minor, currency: r.currency, period: r.period,
    rollover: r.rollover, startsOn: r.starts_on, endsOn: r.ends_on ?? undefined,
    alertThreshold: r.alert_threshold, archived: unbool(r.archived),
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function rowRecurring(r: any): RecurringRule {
  return {
    id: r.id, name: r.name, accountId: r.account_id,
    categoryId: r.category_id ?? undefined, kind: r.kind, amountMinor: r.amount_minor,
    currency: r.currency, frequency: r.frequency, interval: r.interval_count,
    startsOn: r.starts_on, endsOn: r.ends_on ?? undefined,
    dayOfMonth: r.day_of_month ?? undefined, dayOfWeek: r.day_of_week ?? undefined,
    autoDetected: unbool(r.auto_detected), variableAmount: unbool(r.variable_amount),
    lastGeneratedOn: r.last_generated_on ?? undefined, merchant: r.merchant ?? undefined,
    active: unbool(r.active), createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function rowGoal(r: any): Goal {
  return {
    id: r.id,
    name: r.name,
    targetMinor: r.target_minor,
    currency: r.currency,
    accountId: r.account_id ?? undefined,
    savedMinor: r.saved_minor,
    targetDate: r.target_date ?? undefined,
    icon: r.icon ?? '',
    color: r.color ?? '',
    archived: !!r.archived,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowReceipt(r: any): Receipt {
  return {
    id: r.id, fileUri: r.file_uri, thumbnailUri: r.thumbnail_uri ?? undefined,
    mimeType: r.mime_type, byteSize: r.byte_size, status: r.status,
    ocrText: r.ocr_text ?? undefined, ocrConfidence: r.ocr_confidence ?? undefined,
    merchant: r.merchant ?? undefined, date: r.date ?? undefined,
    totalMinor: r.total_minor ?? undefined, taxMinor: r.tax_minor ?? undefined,
    tipMinor: r.tip_minor ?? undefined, currency: r.currency ?? undefined,
    lineItems: unjson(r.line_items, undefined as Receipt['lineItems']),
    transactionId: r.transaction_id ?? undefined, error: r.error ?? undefined,
    capturedAt: r.captured_at, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function rowCategoryRule(r: any): CategoryRule {
  return {
    id: r.id, pattern: r.pattern, matchType: r.match_type, categoryId: r.category_id,
    minAmountMinor: r.min_amount_minor ?? undefined,
    maxAmountMinor: r.max_amount_minor ?? undefined,
    accountId: r.account_id ?? undefined, priority: r.priority, enabled: unbool(r.enabled),
  };
}

let instance: Repository | null = null;

export function createRepository(): Repository {
  if (!instance) instance = new SqliteRepository();
  return instance;
}

export { emptySnapshot };
export type { Repository, Snapshot };
