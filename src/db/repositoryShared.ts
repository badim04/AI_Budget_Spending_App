/**
 * Persistence — the shape both drivers implement.
 *
 * This file exists to break a platform-resolution trap. Metro resolves
 * `./repository` to `repository.native.ts` on Android and iOS, so when
 * `repository.native.ts` imported `./repository` it was importing ITSELF. Its
 * `export { emptySnapshot }` then re-exported its own import, and because Metro
 * compiles re-exports into property getters, that getter resolved to itself —
 * infinite recursion, `RangeError: Maximum call stack size exceeded`, before a
 * single line of app code ran.
 *
 * Web never saw it: with no `.native` file in play, `./repository` resolved to
 * the web driver and the cycle did not exist.
 *
 * Nothing here is platform-specific and there is no `.native` variant of this
 * file, so both drivers can import it safely.
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

export interface Snapshot {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  recurringRules: RecurringRule[];
  goals: Goal[];
  receipts: Receipt[];
  categoryRules: CategoryRule[];
  fxRates: FxRate[];
  settings: Record<string, string>;
}

export function emptySnapshot(): Snapshot {
  return {
    accounts: [],
    categories: [],
    transactions: [],
    budgets: [],
    recurringRules: [],
    goals: [],
    receipts: [],
    categoryRules: [],
    fxRates: [],
    settings: {},
  };
}

export interface Repository {
  /** Platform label, surfaced in Settings so it is obvious where data lives. */
  readonly kind: 'sqlite' | 'localstorage' | 'memory';
  init(): Promise<void>;
  loadSnapshot(): Promise<Snapshot>;

  saveTransaction(t: Transaction): Promise<void>;
  saveTransactions(ts: Transaction[]): Promise<void>;
  deleteTransaction(id: ID): Promise<void>;

  saveAccount(a: Account): Promise<void>;
  saveCategory(c: Category): Promise<void>;
  saveBudget(b: Budget): Promise<void>;
  saveRecurringRule(r: RecurringRule): Promise<void>;
  saveGoal(g: Goal): Promise<void>;
  deleteGoal(id: ID): Promise<void>;
  saveReceipt(r: Receipt): Promise<void>;
  saveCategoryRule(r: CategoryRule): Promise<void>;
  saveFxRates(rates: FxRate[]): Promise<void>;
  setSetting(key: string, value: string): Promise<void>;

  /** Ingestion bookkeeping, so a re-sync of the same mailbox is a no-op. */
  isIngested(source: string, externalId: string): Promise<boolean>;
  markIngested(source: string, externalId: string, transactionId?: ID): Promise<void>;

  /** Wipes everything. Used by "Reset app data" in Settings. */
  reset(): Promise<void>;
}
