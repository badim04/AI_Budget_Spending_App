/**
 * Persistence — web driver.
 *
 * Metro resolves `./repository` to `repository.native.ts` on iOS/Android and to
 * this file everywhere else, so the browser never bundles expo-sqlite (which has
 * no web build in SDK 52 — there is no wasm in the package).
 *
 * The read model lives in memory: the analytics engine takes plain arrays, so
 * queries never touch the driver. A repository only has to do two things —
 * hand back everything on boot, and durably record each change.
 *
 * Shared types live in `repositoryShared.ts`, NOT here — see the note in that
 * file for why importing `./repository` from a platform variant is a trap.
 */

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
import { emptySnapshot, type Repository, type Snapshot } from './repositoryShared';

export { emptySnapshot };
export type { Repository, Snapshot };

// ------------------------------------------------------------- web driver

const KEY = 'finlo.snapshot.v1';
const INGEST_KEY = 'finlo.ingested.v1';

/**
 * localStorage-backed store for the browser.
 *
 * Writes are debounced: typing an amount into a form updates state on every
 * keystroke, and serialising the whole snapshot each time would make the input
 * lag on a few thousand transactions.
 */
class WebRepository implements Repository {
  readonly kind = 'localstorage' as const;
  private snapshot: Snapshot = emptySnapshot();
  private ingested = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  async init(): Promise<void> {
    try {
      const raw = globalThis.localStorage?.getItem(KEY);
      if (raw) this.snapshot = { ...emptySnapshot(), ...JSON.parse(raw) };
      const rawIngest = globalThis.localStorage?.getItem(INGEST_KEY);
      if (rawIngest) this.ingested = new Set(JSON.parse(rawIngest));
    } catch {
      // Corrupt or unavailable storage (private mode, quota) must not stop the
      // app from opening — it falls back to an empty, in-memory session.
      this.snapshot = emptySnapshot();
    }
  }

  async loadSnapshot(): Promise<Snapshot> {
    return this.snapshot;
  }

  private flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      try {
        globalThis.localStorage?.setItem(KEY, JSON.stringify(this.snapshot));
        globalThis.localStorage?.setItem(INGEST_KEY, JSON.stringify([...this.ingested]));
      } catch {
        // Over quota. Nothing useful to do here beyond keeping the session alive.
      }
    }, 120);
  }

  private upsert<T extends { id: string }>(list: T[], row: T): T[] {
    const i = list.findIndex((x) => x.id === row.id);
    if (i === -1) return [...list, row];
    const next = [...list];
    next[i] = row;
    return next;
  }

  async saveTransaction(t: Transaction) {
    this.snapshot.transactions = this.upsert(this.snapshot.transactions, t);
    this.flush();
  }
  async saveTransactions(ts: Transaction[]) {
    for (const t of ts) this.snapshot.transactions = this.upsert(this.snapshot.transactions, t);
    this.flush();
  }
  async deleteTransaction(id: ID) {
    // Soft delete: analytics already filters on deletedAt, and a hard delete
    // would break a receipt or transfer that points at this row.
    this.snapshot.transactions = this.snapshot.transactions.map((t) =>
      t.id === id ? { ...t, deletedAt: new Date().toISOString() } : t
    );
    this.flush();
  }
  async saveAccount(a: Account) {
    this.snapshot.accounts = this.upsert(this.snapshot.accounts, a);
    this.flush();
  }
  async saveCategory(c: Category) {
    this.snapshot.categories = this.upsert(this.snapshot.categories, c);
    this.flush();
  }
  async saveBudget(b: Budget) {
    this.snapshot.budgets = this.upsert(this.snapshot.budgets, b);
    this.flush();
  }
  async saveRecurringRule(r: RecurringRule) {
    this.snapshot.recurringRules = this.upsert(this.snapshot.recurringRules, r);
    this.flush();
  }
  async saveGoal(g: Goal) {
    this.snapshot.goals = this.upsert(this.snapshot.goals, g);
    this.flush();
  }
  async deleteGoal(id: ID) {
    this.snapshot.goals = this.snapshot.goals.filter((g) => g.id !== id);
    this.flush();
  }
  async saveReceipt(r: Receipt) {
    this.snapshot.receipts = this.upsert(this.snapshot.receipts, r);
    this.flush();
  }
  async saveCategoryRule(r: CategoryRule) {
    this.snapshot.categoryRules = this.upsert(this.snapshot.categoryRules, r);
    this.flush();
  }
  async saveFxRates(rates: FxRate[]) {
    this.snapshot.fxRates = rates;
    this.flush();
  }
  async setSetting(key: string, value: string) {
    this.snapshot.settings = { ...this.snapshot.settings, [key]: value };
    this.flush();
  }
  async isIngested(source: string, externalId: string) {
    return this.ingested.has(`${source}|${externalId}`);
  }
  async markIngested(source: string, externalId: string) {
    this.ingested.add(`${source}|${externalId}`);
    this.flush();
  }
  async reset() {
    this.snapshot = emptySnapshot();
    this.ingested.clear();
    try {
      globalThis.localStorage?.removeItem(KEY);
      globalThis.localStorage?.removeItem(INGEST_KEY);
    } catch {
      /* ignore */
    }
  }
}

let instance: Repository | null = null;

export function createRepository(): Repository {
  if (!instance) instance = new WebRepository();
  return instance;
}

