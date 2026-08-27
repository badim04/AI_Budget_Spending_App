/**
 * The single source of truth at runtime.
 *
 * Everything the app knows lives here in memory; the repository is a write-behind
 * durability layer, not a query engine. That keeps every read synchronous — the
 * analytics functions take plain arrays and run in microseconds, so there is no
 * reason for a screen to await anything just to render a number.
 *
 * Every mutating action does the same three things in the same order:
 *   1. update memory (the UI reflects it on the next frame)
 *   2. persist (fire-and-forget; failures surface via `lastError`)
 *   3. never block the caller on I/O
 */

import { create } from 'zustand';
import { FxTable, type FxRate } from '../core/money';
import { nowISO, today } from '../core/dates';
import { dedupeKey } from '../db/schema';
import { createRepository, emptySnapshot, type Repository, type Snapshot } from '../db/repository';
import { SEED_CATEGORIES, DEFAULT_SETTINGS, STARTER_BUDGET_TEMPLATE } from '../db/seed';
import { buildDemoSnapshot } from '../db/demoData';
import {
  buildMerchantHistory,
  categorise,
  isFiled,
  merchantKey,
  suggestRuleFromCorrection,
  type CategoriseDeps,
  type CategoryRule,
  type CategorySuggestion,
} from '../core/categorize';
import { candidateToRule, detectRecurring, type RecurringCandidate } from '../core/recurring';
import type {
  Account,
  Budget,
  Category,
  CategoryKind,
  ID,
  Receipt,
  RecurringRule,
  Transaction,
  Goal,
} from '../core/types';

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

interface AppState extends Snapshot {
  status: LoadState;
  lastError: string | null;
  repositoryKind: string;
  /** Bumped on every mutation so memoised selectors recompute. */
  revision: number;

  load: () => Promise<void>;
  seedDemoData: () => Promise<void>;
  seedFreshUser: (opts: { currency: string; accountName: string }) => Promise<void>;
  resetAll: () => Promise<void>;

  addTransaction: (input: NewTransactionInput) => Promise<Transaction>;
  updateTransaction: (id: ID, patch: Partial<Transaction>) => Promise<void>;
  deleteTransaction: (id: ID) => Promise<void>;
  /** Confirms a suggested category and, on the second identical correction,
   *  offers to make it a permanent rule. */
  categoriseTransaction: (id: ID, categoryId: ID) => Promise<CategoryRule | null>;
  markReviewed: (id: ID) => Promise<void>;
  /**
   * Clear a whole batch of review items in one write.
   *
   * A statement import can drop 160 rows into the queue at once, and confirming
   * them one at a time is the single worst chore in the app. Passing a
   * `categoryId` files them all under it; omitting it just accepts the
   * suggestions already attached.
   */
  reviewMany: (ids: ID[], categoryId?: ID) => Promise<number>;
  commitStaged: (drafts: Array<Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>>) => Promise<number>;

  saveAccount: (a: Account) => Promise<void>;
  saveBudget: (b: Budget) => Promise<void>;
  saveCategory: (c: Category) => Promise<void>;
  /** Create a category from the picker, without leaving what you were doing. */
  addCategory: (input: { name: string; kind: CategoryKind; icon?: string; color?: string }) => Promise<Category>;
  saveRecurringRule: (r: RecurringRule) => Promise<void>;
  saveGoal: (g: Goal) => Promise<void>;
  deleteGoal: (id: ID) => Promise<void>;
  /** Contribute to (or withdraw from) a goal. */
  addToGoal: (id: ID, deltaMinor: number) => Promise<void>;
  /** Patterns that look recurring but have no rule yet. */
  recurringSuggestions: () => RecurringCandidate[];
  acceptRecurring: (candidate: RecurringCandidate) => Promise<void>;
  saveReceipt: (r: Receipt) => Promise<void>;
  addCategoryRule: (r: Omit<CategoryRule, 'id'>) => Promise<void>;
  setSetting: (key: string, value: string) => Promise<void>;
  setFxRates: (rates: FxRate[]) => Promise<void>;

  /** Everything `categorise()` needs, rebuilt from current state. */
  categoriseDeps: () => CategoriseDeps;
  suggestCategory: (input: {
    merchant: string;
    rawDescription?: string;
    amountMinor: number;
    accountId: ID;
  }) => CategorySuggestion | null;
  fxTable: () => FxTable;
  isDuplicate: (accountId: ID, date: string, amountMinor: number, currency: string) => boolean;
}

export interface NewTransactionInput {
  accountId: ID;
  /** Signed: negative is money out. */
  amountMinor: number;
  currency: string;
  date: string;
  merchant: string;
  categoryId?: ID;
  note?: string;
  rawDescription?: string;
  source?: Transaction['source'];
  receiptId?: ID;
  reviewed?: boolean;
  splits?: Transaction['splits'];
  tags?: string[];
}

let repo: Repository | null = null;
function repository(): Repository {
  if (!repo) repo = createRepository();
  return repo;
}

function newId(prefix: string): string {
  // Timestamp prefix keeps ids roughly sortable, which makes debugging a
  // transaction list far easier than opaque random strings.
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useAppStore = create<AppState>((set, get) => ({
  ...emptySnapshot(),
  status: 'idle',
  lastError: null,
  repositoryKind: 'unknown',
  revision: 0,

  // --------------------------------------------------------------- lifecycle

  load: async () => {
    if (get().status === 'loading') return;
    set({ status: 'loading' });
    try {
      const r = repository();
      await r.init();
      const snapshot = await r.loadSnapshot();

      // First launch: nothing persisted. Seed the categories a user needs
      // before they can file anything, but do NOT invent their accounts or
      // budgets — that is what onboarding is for.
      if (snapshot.categories.length === 0) {
        snapshot.categories = SEED_CATEGORIES as Category[];
        snapshot.settings = { ...DEFAULT_SETTINGS, ...snapshot.settings };
        for (const c of snapshot.categories) await r.saveCategory(c);
        for (const [k, v] of Object.entries(snapshot.settings)) await r.setSetting(k, v);
      }

      // Handy when a device reports the wrong storage backend.
      if (process.env.NODE_ENV !== 'production') {
        console.log('[finlo] repository kind =', r.kind);
      }
      set({
        ...snapshot,
        status: 'ready',
        lastError: null,
        repositoryKind: r.kind,
        revision: get().revision + 1,
      });
    } catch (e) {
      set({ status: 'error', lastError: e instanceof Error ? e.message : String(e) });
    }
  },

  seedDemoData: async () => {
    const r = repository();
    const demo = buildDemoSnapshot();
    await r.reset();
    for (const c of demo.categories) await r.saveCategory(c);
    for (const a of demo.accounts) await r.saveAccount(a);
    for (const b of demo.budgets) await r.saveBudget(b);
    for (const rule of demo.recurringRules) await r.saveRecurringRule(rule);
    await r.saveTransactions(demo.transactions);
    await r.saveFxRates(demo.fxRates);
    for (const [k, v] of Object.entries(demo.settings)) await r.setSetting(k, v);
    set({ ...demo, status: 'ready', revision: get().revision + 1 });
  },

  seedFreshUser: async ({ currency, accountName }) => {
    const r = repository();
    const now = nowISO();
    const account: Account = {
      id: newId('acc'),
      name: accountName || 'Main account',
      kind: 'bank',
      currency,
      openingBalanceMinor: 0,
      openedAt: today(),
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    await r.saveAccount(account);
    await r.setSetting('display_currency', currency);
    await r.setSetting('onboarded', 'true');

    // Starter envelopes, sized at zero. A budget with a made-up number is worse
    // than no budget: the user trusts it and it is fiction.
    const budgets: Budget[] = STARTER_BUDGET_TEMPLATE.map((tpl) => ({
      id: newId('bud'),
      name: tpl.name,
      categoryIds: tpl.categoryIds,
      amountMinor: 0,
      currency,
      period: 'monthly' as const,
      rollover: tpl.rollover,
      startsOn: today(),
      alertThreshold: 0.8,
      archived: false,
      createdAt: now,
      updatedAt: now,
    }));
    for (const b of budgets) await r.saveBudget(b);

    set({
      accounts: [account],
      budgets,
      settings: { ...get().settings, display_currency: currency, onboarded: 'true' },
      status: 'ready',
      revision: get().revision + 1,
    });
  },

  resetAll: async () => {
    await repository().reset();
    set({ ...emptySnapshot(), status: 'idle', revision: get().revision + 1 });
    await get().load();
  },

  // ------------------------------------------------------------ transactions

  addTransaction: async (input) => {
    const now = nowISO();
    const suggestion = input.categoryId
      ? null
      : get().suggestCategory({
          merchant: input.merchant,
          rawDescription: input.rawDescription,
          amountMinor: input.amountMinor,
          accountId: input.accountId,
        });

    const transaction: Transaction = {
      id: newId('tx'),
      accountId: input.accountId,
      kind: input.amountMinor > 0 ? 'income' : 'expense',
      amountMinor: input.amountMinor,
      currency: input.currency,
      date: input.date,
      merchant: input.merchant,
      rawDescription: input.rawDescription,
      note: input.note,
      categoryId: input.categoryId ?? suggestion?.categoryId,
      splits: input.splits,
      source: input.source ?? 'manual',
      confidence: input.categoryId ? 'high' : suggestion ? 'medium' : 'unreviewed',
      // A transaction the user typed by hand is reviewed by definition — they
      // just looked at every field.
      reviewed: input.reviewed ?? (input.source ?? 'manual') === 'manual',
      receiptId: input.receiptId,
      tags: input.tags ?? [],
      dedupeKey: `${dedupeKey(input.accountId, input.date, input.amountMinor, input.currency)}|${Date.now()}`,
      pending: false,
      createdAt: now,
      updatedAt: now,
    };

    set((s) => ({ transactions: [transaction, ...s.transactions], revision: s.revision + 1 }));
    repository().saveTransaction(transaction).catch((e) =>
      set({ lastError: `Could not save transaction: ${e}` })
    );
    return transaction;
  },

  updateTransaction: async (id, patch) => {
    const existing = get().transactions.find((t) => t.id === id);
    if (!existing) return;
    const updated: Transaction = { ...existing, ...patch, updatedAt: nowISO() };
    // Direction is derived, never stored independently — otherwise editing an
    // amount from -500 to +500 leaves kind saying "expense".
    updated.kind = updated.transferPairId
      ? 'transfer'
      : updated.amountMinor > 0
        ? 'income'
        : 'expense';

    set((s) => ({
      transactions: s.transactions.map((t) => (t.id === id ? updated : t)),
      revision: s.revision + 1,
    }));
    repository().saveTransaction(updated).catch((e) =>
      set({ lastError: `Could not save transaction: ${e}` })
    );
  },

  deleteTransaction: async (id) => {
    const stamp = nowISO();
    set((s) => ({
      transactions: s.transactions.map((t) =>
        t.id === id ? { ...t, deletedAt: stamp, updatedAt: stamp } : t
      ),
      revision: s.revision + 1,
    }));
    repository().deleteTransaction(id).catch((e) =>
      set({ lastError: `Could not delete transaction: ${e}` })
    );
  },

  categoriseTransaction: async (id, categoryId) => {
    const existing = get().transactions.find((t) => t.id === id);
    if (!existing) return null;

    await get().updateTransaction(id, {
      categoryId,
      reviewed: true,
      confidence: 'high',
    });

    // Two identical corrections for the same merchant is the signal that this
    // is a standing preference, not a one-off.
    const history = buildMerchantHistory(get().transactions);
    const proposed = suggestRuleFromCorrection(
      existing.rawDescription || existing.merchant,
      categoryId,
      history
    );
    if (!proposed) return null;

    const alreadyHaveRule = get().categoryRules.some(
      (r) => r.pattern === proposed.pattern && r.categoryId === categoryId
    );
    return alreadyHaveRule ? null : { ...proposed, id: newId('rule') };
  },

  markReviewed: async (id) => {
    await get().updateTransaction(id, { reviewed: true });
  },

  reviewMany: async (ids, categoryId) => {
    const wanted = new Set(ids);
    const stamp = nowISO();
    const touched: Transaction[] = [];

    // One state update and one pass over the list, rather than N of each. At
    // 160 rows the per-row version re-rendered the whole screen 160 times.
    set((s) => ({
      transactions: s.transactions.map((t) => {
        if (!wanted.has(t.id) || t.deletedAt) return t;

        const nextCategoryId = categoryId ?? t.categoryId;
        // Nothing to accept: no real suggestion and nothing chosen. The seeded
        // "Uncategorised" category counts as nothing.
        if (!categoryId && !isFiled(nextCategoryId)) return t;
        if (!nextCategoryId) return t;

        const updated: Transaction = {
          ...t,
          categoryId: nextCategoryId,
          reviewed: true,
          confidence: categoryId ? 'high' : t.confidence,
          updatedAt: stamp,
        };
        touched.push(updated);
        return updated;
      }),
      revision: s.revision + 1,
    }));

    for (const transaction of touched) {
      repository().saveTransaction(transaction).catch((e) =>
        set({ lastError: `Could not save transaction: ${e}` })
      );
    }

    return touched.length;
  },

  /**
   * Write an import to the database, then show it.
   *
   * Deliberately not optimistic, and this is the one place that matters.
   *
   * It used to update the store first and fire the write without awaiting it.
   * When the write failed — a UNIQUE violation on `dedupe_key` rolled back all
   * 228 rows of a statement import — the failure went into `lastError`, which
   * nothing displayed, and the screen reported success. The rows lived in
   * memory until the next reload and then disappeared, with no error anywhere,
   * long after the import that had "worked".
   *
   * An optimistic update is a promise that the write will succeed. For a
   * hundred rows of somebody's financial history that is not a promise worth
   * making: persist first, and let the caller show a real failure.
   */
  commitStaged: async (drafts) => {
    const now = nowISO();
    const rows: Transaction[] = drafts.map((d) => ({
      ...d,
      id: newId('tx'),
      createdAt: now,
      updatedAt: now,
    }));
    if (rows.length === 0) return 0;

    // Throws on failure. The import screen catches it and says so.
    await repository().saveTransactions(rows);

    set((s) => ({ transactions: [...rows, ...s.transactions], revision: s.revision + 1 }));
    return rows.length;
  },

  // -------------------------------------------------------------- entities

  saveAccount: async (a) => {
    set((s) => ({
      accounts: upsert(s.accounts, a),
      revision: s.revision + 1,
    }));
    repository().saveAccount(a).catch((e) => set({ lastError: String(e) }));
  },

  saveBudget: async (b) => {
    set((s) => ({ budgets: upsert(s.budgets, b), revision: s.revision + 1 }));
    repository().saveBudget(b).catch((e) => set({ lastError: String(e) }));
  },

  saveCategory: async (c) => {
    set((s) => ({ categories: upsert(s.categories, c), revision: s.revision + 1 }));
    repository().saveCategory(c).catch((e) => set({ lastError: String(e) }));
  },

  addCategory: async (input) => {
    const name = input.name.trim();
    const existing = get().categories.find(
      (c) => !c.archived && c.kind === input.kind && c.name.toLowerCase() === name.toLowerCase()
    );
    // Typing a name that already exists should select it, not create a twin.
    if (existing) return existing;

    const category: Category = {
      id: newId('cat'),
      name,
      kind: input.kind,
      icon: input.icon ?? (input.kind === 'income' ? '➕' : '🏷️'),
      color: input.color ?? '#7C8CF8',
      excludeFromTotals: false,
      // After the seeded ones, so a new category does not jump the list.
      sortOrder: Math.max(0, ...get().categories.map((c) => c.sortOrder)) + 1,
      archived: false,
      isSystem: false,
    };

    await get().saveCategory(category);
    return category;
  },

  saveRecurringRule: async (r) => {
    set((s) => ({ recurringRules: upsert(s.recurringRules, r), revision: s.revision + 1 }));
    repository().saveRecurringRule(r).catch((e) => set({ lastError: String(e) }));
  },

  saveGoal: async (g) => {
    await repository().saveGoal(g);
    set({ goals: upsert(get().goals, g), revision: get().revision + 1 });
  },

  deleteGoal: async (id) => {
    await repository().deleteGoal(id);
    set({ goals: get().goals.filter((g) => g.id !== id), revision: get().revision + 1 });
  },

  addToGoal: async (id, deltaMinor) => {
    const goal = get().goals.find((g) => g.id === id);
    if (!goal) return;
    // Never let a goal go negative — withdrawing more than was saved is a
    // mistake, and a negative "saved" makes the progress ring nonsense.
    const savedMinor = Math.max(0, goal.savedMinor + deltaMinor);
    await get().saveGoal({ ...goal, savedMinor, updatedAt: nowISO() });
  },

  recurringSuggestions: () => {
    const { transactions, recurringRules } = get();
    // Merchants that already have a rule are not suggested again.
    const existingKeys = new Set(
      recurringRules.map((r) => merchantKey(r.merchant ?? r.name)).filter(Boolean)
    );
    return detectRecurring(transactions, { existingKeys });
  },

  acceptRecurring: async (candidate) => {
    const rule = candidateToRule(candidate, newId('rec'), nowISO());
    await get().saveRecurringRule(rule);
  },

  saveReceipt: async (r) => {
    set((s) => ({ receipts: upsert(s.receipts, r), revision: s.revision + 1 }));
    repository().saveReceipt(r).catch((e) => set({ lastError: String(e) }));
  },

  addCategoryRule: async (rule) => {
    const withId: CategoryRule = { ...rule, id: newId('rule') };
    set((s) => ({ categoryRules: [...s.categoryRules, withId], revision: s.revision + 1 }));
    repository().saveCategoryRule(withId).catch((e) => set({ lastError: String(e) }));
  },

  setSetting: async (key, value) => {
    set((s) => ({ settings: { ...s.settings, [key]: value }, revision: s.revision + 1 }));
    repository().setSetting(key, value).catch((e) => set({ lastError: String(e) }));
  },

  setFxRates: async (rates) => {
    set((s) => ({ fxRates: rates, revision: s.revision + 1 }));
    repository().saveFxRates(rates).catch((e) => set({ lastError: String(e) }));
  },

  // -------------------------------------------------------------- selectors

  categoriseDeps: () => {
    const s = get();
    const slugToCategoryId = new Map<string, string>();
    for (const c of SEED_CATEGORIES) {
      // Only map slugs whose category still exists — a user can archive or
      // delete a seeded category, and the lexicon must not resurrect it.
      if (c.slug && s.categories.some((x) => x.id === c.id && !x.archived)) {
        slugToCategoryId.set(c.slug, c.id);
      }
    }
    return {
      rules: s.categoryRules,
      history: buildMerchantHistory(s.transactions),
      categories: s.categories,
      slugToCategoryId,
    };
  },

  suggestCategory: (input) =>
    categorise(
      {
        merchant: input.merchant,
        rawDescription: input.rawDescription,
        amountMinor: input.amountMinor,
        accountId: input.accountId,
        isInflow: input.amountMinor > 0,
      },
      get().categoriseDeps()
    ),

  fxTable: () => {
    const s = get();
    const base = s.settings.display_currency ?? 'NGN';
    // Only rates that touch the base can be loaded; others would throw in the
    // FxTable constructor and take the whole dashboard down with them.
    const usable = s.fxRates.filter((r) => r.from === base || r.to === base);
    return new FxTable(base, usable);
  },

  isDuplicate: (accountId, date, amountMinor, currency) => {
    const key = dedupeKey(accountId, date, amountMinor, currency);
    return get().transactions.some((t) => !t.deletedAt && t.dedupeKey.startsWith(key));
  },
}));

function upsert<T extends { id: string }>(list: T[], row: T): T[] {
  const i = list.findIndex((x) => x.id === row.id);
  if (i === -1) return [...list, row];
  const next = [...list];
  next[i] = row;
  return next;
}

/** Convenience for screens that just need "is there anything here yet?". */
export function useHasData(): boolean {
  return useAppStore((s) => s.accounts.length > 0 || s.transactions.length > 0);
}

export { merchantKey };
