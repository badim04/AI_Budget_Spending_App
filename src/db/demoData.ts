/**
 * Demo data.
 *
 * Generated rather than hand-listed, so there is enough history for the
 * forecaster to have something to fit — eight months of plausible spending with
 * a mild upward drift, a December-ish spike, and irregular one-offs.
 *
 * This exists so `npm start` shows a working app on first run. Replacing it
 * with the SQLite repository is a one-line change in `useDashboardData`.
 */

import type { FxRate } from '../core/money';
import { addDays, addMonths, endOfMonth, startOfMonth, today } from '../core/dates';
import { dedupeKey } from './schema';
import { SEED_CATEGORIES } from './seed';
import type {
  Account,
  Budget,
  Category,
  RecurringRule,
  Transaction,
} from '../core/types';

const AS_OF = '2026-08-13';

/** Deterministic PRNG — the demo must look the same on every launch, or the
 *  charts jitter between reloads and the app feels broken. */
function makeRandom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const ACCOUNTS: Account[] = [
  {
    id: 'acc_main', name: 'Main current account', kind: 'bank', currency: 'NGN',
    openingBalanceMinor: 1_250_000_00, openedAt: '2025-01-01', institution: 'GTBank',
    mask: '1234', archived: false, createdAt: '', updatedAt: '',
  },
  {
    id: 'acc_wallet', name: 'Mobile wallet', kind: 'mobile_money', currency: 'NGN',
    openingBalanceMinor: 45_000_00, openedAt: '2025-06-01', institution: 'Opay',
    mask: '9911', archived: false, createdAt: '', updatedAt: '',
  },
  {
    id: 'acc_usd', name: 'USD savings', kind: 'savings', currency: 'USD',
    openingBalanceMinor: 3_200_00, openedAt: '2025-03-01', archived: false,
    createdAt: '', updatedAt: '',
  },
];

const FX_RATES: FxRate[] = [
  { from: 'NGN', to: 'USD', rate: 1 / 1580, asOf: '2026-08-12', source: 'demo' },
  { from: 'NGN', to: 'EUR', rate: 1 / 1720, asOf: '2026-08-12', source: 'demo' },
  { from: 'NGN', to: 'GBP', rate: 1 / 2010, asOf: '2026-08-12', source: 'demo' },
];

const RECURRING: RecurringRule[] = [
  {
    id: 'rec_rent', name: 'Rent', accountId: 'acc_main', categoryId: 'cat_rent',
    kind: 'expense', amountMinor: -450_000_00, currency: 'NGN', frequency: 'monthly',
    interval: 1, startsOn: '2025-01-05', dayOfMonth: 5, autoDetected: false,
    variableAmount: false, active: true, merchant: 'Landlord', createdAt: '', updatedAt: '',
  },
  {
    id: 'rec_salary', name: 'Salary', accountId: 'acc_main', categoryId: 'cat_salary',
    kind: 'income', amountMinor: 1_150_000_00, currency: 'NGN', frequency: 'monthly',
    interval: 1, startsOn: '2025-01-25', dayOfMonth: 25, autoDetected: true,
    variableAmount: false, active: true, merchant: 'Employer', createdAt: '', updatedAt: '',
  },
  {
    id: 'rec_power', name: 'Electricity', accountId: 'acc_main', categoryId: 'cat_utilities',
    kind: 'expense', amountMinor: -32_000_00, currency: 'NGN', frequency: 'monthly',
    interval: 1, startsOn: '2025-01-12', dayOfMonth: 12, autoDetected: true,
    variableAmount: true, active: true, merchant: 'Ikeja Electric', createdAt: '', updatedAt: '',
  },
  {
    id: 'rec_netflix', name: 'Netflix', accountId: 'acc_main', categoryId: 'cat_subscriptions',
    kind: 'expense', amountMinor: -7_200_00, currency: 'NGN', frequency: 'monthly',
    interval: 1, startsOn: '2025-01-18', dayOfMonth: 18, autoDetected: true,
    variableAmount: false, active: true, merchant: 'Netflix', createdAt: '', updatedAt: '',
  },
  {
    id: 'rec_internet', name: 'Internet', accountId: 'acc_main', categoryId: 'cat_utilities',
    kind: 'expense', amountMinor: -25_000_00, currency: 'NGN', frequency: 'monthly',
    interval: 1, startsOn: '2025-01-08', dayOfMonth: 8, autoDetected: true,
    variableAmount: false, active: true, merchant: 'Spectranet', createdAt: '', updatedAt: '',
  },
];

const BUDGETS: Budget[] = [
  {
    id: 'bud_food', name: 'Food', categoryIds: ['cat_groceries', 'cat_eating_out'],
    amountMinor: 180_000_00, currency: 'NGN', period: 'monthly', rollover: 'rollover',
    startsOn: '2026-01-01', alertThreshold: 0.8, archived: false, createdAt: '', updatedAt: '',
  },
  {
    id: 'bud_transport', name: 'Transport', categoryIds: ['cat_transport'],
    amountMinor: 90_000_00, currency: 'NGN', period: 'monthly', rollover: 'rollover',
    startsOn: '2026-01-01', alertThreshold: 0.8, archived: false, createdAt: '', updatedAt: '',
  },
  {
    id: 'bud_bills', name: 'Home & bills', categoryIds: ['cat_rent', 'cat_utilities', 'cat_airtime'],
    amountMinor: 540_000_00, currency: 'NGN', period: 'monthly', rollover: 'reset',
    startsOn: '2026-01-01', alertThreshold: 0.9, archived: false, createdAt: '', updatedAt: '',
  },
  {
    id: 'bud_life', name: 'Lifestyle',
    categoryIds: ['cat_shopping', 'cat_entertainment', 'cat_personal_care', 'cat_subscriptions'],
    amountMinor: 120_000_00, currency: 'NGN', period: 'monthly', rollover: 'average',
    startsOn: '2026-01-01', alertThreshold: 0.75, archived: false, createdAt: '', updatedAt: '',
  },
];

/** Merchant -> category, with a typical spend range in whole naira. */
const PATTERNS: Array<[string, string, number, number, number]> = [
  // merchant, categoryId, min, max, times per month
  ['Shoprite Ikeja', 'cat_groceries', 12_000, 38_000, 3],
  ['Prince Ebeano', 'cat_groceries', 8_000, 25_000, 2],
  ['Chicken Republic', 'cat_eating_out', 3_500, 9_000, 4],
  ['Uber', 'cat_transport', 1_800, 7_500, 8],
  ['Bolt', 'cat_transport', 1_500, 6_000, 5],
  ['Total Energies', 'cat_transport', 15_000, 30_000, 1],
  ['MTN Data', 'cat_airtime', 5_000, 15_000, 2],
  ['Jumia', 'cat_shopping', 6_000, 45_000, 1],
  ['Filmhouse Cinema', 'cat_entertainment', 5_000, 12_000, 1],
  ['Spotify', 'cat_subscriptions', 2_500, 2_500, 1],
  ['MedPlus Pharmacy', 'cat_health', 3_000, 18_000, 1],
];

function buildTransactions(): Transaction[] {
  const rnd = makeRandom(20260813);
  const out: Transaction[] = [];
  let n = 0;

  const push = (
    accountId: string,
    date: string,
    amountMinor: number,
    merchant: string,
    categoryId: string,
    extra: Partial<Transaction> = {}
  ) => {
    const currency = ACCOUNTS.find((a) => a.id === accountId)!.currency;
    out.push({
      id: `tx_${++n}`,
      accountId,
      kind: amountMinor > 0 ? 'income' : 'expense',
      amountMinor,
      currency,
      date,
      merchant,
      rawDescription: merchant.toUpperCase(),
      categoryId,
      source: 'manual',
      confidence: 'high',
      reviewed: true,
      tags: [],
      dedupeKey: dedupeKey(accountId, date, amountMinor, currency) + `|${n}`,
      pending: false,
      createdAt: `${date}T09:00:00Z`,
      updatedAt: `${date}T09:00:00Z`,
      ...extra,
    });
  };

  // Eight months of history, ending with the current partial month.
  for (let monthsBack = 7; monthsBack >= 0; monthsBack--) {
    const monthStart = startOfMonth(addMonths(AS_OF, -monthsBack));
    const monthEnd = monthsBack === 0 ? AS_OF : endOfMonth(monthStart);
    const daysInMonth = Math.round(
      (new Date(monthEnd).getTime() - new Date(monthStart).getTime()) / 86_400_000
    );
    // Gentle inflation so the trend line has something to find.
    const drift = 1 + (7 - monthsBack) * 0.025;

    for (const [merchant, categoryId, min, max, perMonth] of PATTERNS) {
      const count = monthsBack === 0
        ? Math.round((perMonth * daysInMonth) / 30)
        : perMonth;
      for (let i = 0; i < count; i++) {
        const day = Math.min(daysInMonth, Math.floor(rnd() * daysInMonth));
        const amount = Math.round((min + rnd() * (max - min)) * drift) * 100;
        push('acc_main', addDays(monthStart, day), -amount, merchant, categoryId);
      }
    }

    // Recurring rules materialised as real transactions.
    for (const rule of RECURRING) {
      const day = Math.min(daysInMonth, (rule.dayOfMonth ?? 1) - 1);
      const date = addDays(monthStart, Math.max(0, day));
      if (date > AS_OF) continue;
      const jitter = rule.variableAmount ? 0.75 + rnd() * 0.5 : 1;
      push(
        rule.accountId,
        date,
        Math.round(rule.amountMinor * jitter),
        rule.merchant ?? rule.name,
        rule.categoryId ?? 'cat_uncategorised'
      );
    }
  }

  // A handful of unreviewed rows so the review queue and its insight appear.
  const recent = addDays(AS_OF, -2);
  push('acc_wallet', recent, -18_500_00, 'Zzqq Ventures', 'cat_uncategorised', {
    reviewed: false, confidence: 'unreviewed', source: 'email_import',
  });
  push('acc_wallet', addDays(AS_OF, -1), -4_200_00, 'Mama Put Kitchen', 'cat_eating_out', {
    reviewed: false, confidence: 'medium', source: 'receipt_scan',
  });
  push('acc_main', addDays(AS_OF, -3), -96_000_00, 'Shoprite Ikeja', 'cat_groceries', {
    reviewed: false, confidence: 'high', source: 'email_import',
  });

  // A foreign-currency subscription, to exercise the FX path on screen.
  push('acc_usd', addDays(AS_OF, -5), -20_00, 'Anthropic', 'cat_subscriptions');

  return out;
}

export interface DemoStore {
  asOf: string;
  displayCurrency: string;
  fxBase: string;
  fxRates: FxRate[];
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  recurringRules: RecurringRule[];
}

let cached: DemoStore | null = null;

export function loadDemoData(): DemoStore {
  if (cached) return cached;
  cached = {
    asOf: AS_OF,
    displayCurrency: 'NGN',
    fxBase: 'NGN',
    fxRates: FX_RATES,
    accounts: ACCOUNTS,
    categories: SEED_CATEGORIES as Category[],
    transactions: buildTransactions(),
    budgets: BUDGETS,
    recurringRules: RECURRING,
  };
  return cached;
}

/**
 * The same demo data shaped as a persistable Snapshot.
 *
 * `loadDemoData` is kept for the pure-function tests; this is what "Load demo
 * data" in Settings writes into the real repository, so the demo behaves like
 * genuine user data — editable, deletable, and surviving a restart.
 */
export function buildDemoSnapshot() {
  const demo = loadDemoData();
  return {
    accounts: demo.accounts,
    categories: demo.categories,
    transactions: demo.transactions,
    budgets: demo.budgets,
    recurringRules: demo.recurringRules,
    receipts: [],
    categoryRules: [],
    fxRates: demo.fxRates,
    settings: {
      display_currency: demo.displayCurrency,
      onboarded: 'true',
      demo_data: 'true',
      week_starts_on: '1',
      theme: 'system',
    } as Record<string, string>,
  };
}
