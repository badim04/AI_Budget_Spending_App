/**
 * Default categories.
 *
 * The `slug` is load-bearing: it is what the shipped keyword lexicon in
 * `core/categorize.ts` maps onto. A category the user creates has no slug and
 * simply isn't reachable by the lexicon — it gets there through learned history
 * or an explicit rule instead.
 *
 * Two levels only, and a deliberately short list. Every extra category is a
 * decision the user has to make at the moment they are least willing to make
 * one, and the fastest way to kill a budgeting habit is a 60-item picker.
 */

import type { Category } from '../core/types';

export interface SeedCategory extends Omit<Category, 'id'> {
  id: string;
  slug: string | null;
}

const expense = (
  id: string,
  slug: string | null,
  name: string,
  icon: string,
  color: string,
  sortOrder: number,
  parentId?: string
): SeedCategory => ({
  id,
  slug,
  name,
  kind: 'expense',
  parentId,
  icon,
  color,
  excludeFromTotals: false,
  sortOrder,
  archived: false,
  isSystem: true,
});

const income = (
  id: string,
  slug: string | null,
  name: string,
  icon: string,
  color: string,
  sortOrder: number,
  parentId?: string
): SeedCategory => ({
  ...expense(id, slug, name, icon, color, sortOrder, parentId),
  kind: 'income',
});

/**
 * Group colours come from the validated categorical palette, in fixed order.
 * Children inherit their parent's hue — a chart never plots two levels at once,
 * so there is no pair that needs to be distinguishable.
 */
const C = {
  blue: '#3987e5',
  orange: '#d95926',
  aqua: '#199e70',
  yellow: '#c98500',
  magenta: '#d55181',
  green: '#008300',
  violet: '#9085e9',
  red: '#e66767',
  neutral: '#6f6d66',
};

export const SEED_CATEGORIES: SeedCategory[] = [
  // --- Food -------------------------------------------------------------
  expense('cat_food', null, 'Food', '🍚', C.orange, 10),
  expense('cat_groceries', 'groceries', 'Groceries', '🛒', C.orange, 11, 'cat_food'),
  expense('cat_eating_out', 'eating_out', 'Eating out', '🍽️', C.orange, 12, 'cat_food'),

  // --- Getting around ---------------------------------------------------
  expense('cat_transport', 'transport', 'Transport', '🚕', C.blue, 20),
  expense('cat_travel', 'travel', 'Travel', '✈️', C.blue, 21),

  // --- Home -------------------------------------------------------------
  expense('cat_home', null, 'Home', '🏠', C.aqua, 30),
  expense('cat_rent', 'rent_housing', 'Rent & housing', '🔑', C.aqua, 31, 'cat_home'),
  expense('cat_utilities', 'utilities', 'Utilities', '💡', C.aqua, 32, 'cat_home'),
  expense('cat_airtime', 'airtime_data', 'Airtime & data', '📱', C.aqua, 33, 'cat_home'),

  // --- Living -----------------------------------------------------------
  expense('cat_shopping', 'shopping', 'Shopping', '🛍️', C.magenta, 40),
  expense('cat_personal_care', 'personal_care', 'Personal care', '💇', C.magenta, 41),
  expense('cat_entertainment', 'entertainment', 'Entertainment', '🎬', C.magenta, 42),
  expense('cat_subscriptions', 'subscriptions', 'Subscriptions', '🔁', C.violet, 43),

  // --- Obligations ------------------------------------------------------
  expense('cat_health', 'health', 'Health', '⚕️', C.red, 50),
  expense('cat_education', 'education', 'Education', '📚', C.violet, 51),
  expense('cat_insurance', 'insurance', 'Insurance', '🛡️', C.violet, 52),
  expense('cat_giving', 'giving', 'Giving', '🎁', C.green, 53),
  expense('cat_fees', 'fees_charges', 'Fees & charges', '🏦', C.neutral, 54),

  // --- Money moving out but not being spent ----------------------------
  expense('cat_savings', 'savings_investment', 'Savings & investment', '📈', C.green, 60),

  // --- Income -----------------------------------------------------------
  income('cat_salary', 'salary', 'Salary', '💰', C.green, 70),
  income('cat_freelance', 'freelance_income', 'Freelance & business', '💼', C.green, 71),
  income('cat_other_income', null, 'Other income', '➕', C.green, 72),
  income('cat_refund', null, 'Refunds', '↩️', C.neutral, 73),

  // --- Excluded from every total ---------------------------------------
  {
    ...expense('cat_transfer', 'transfer', 'Transfer', '🔄', C.neutral, 90),
    kind: 'transfer',
    // The whole point: moving your own money between your own accounts is not
    // income and not spending, and counting it as either double-counts it.
    excludeFromTotals: true,
  },
  {
    ...expense('cat_reimbursable', null, 'Reimbursable', '🧾', C.neutral, 91),
    excludeFromTotals: true,
  },
  expense('cat_uncategorised', null, 'Uncategorised', '❓', C.neutral, 99),
];

/** slug -> category id, the map `categorise()` needs. */
export function buildSlugMap(categories: SeedCategory[] = SEED_CATEGORIES): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of categories) {
    if (c.slug) map.set(c.slug, c.id);
  }
  return map;
}

/**
 * Starter budgets, offered (not imposed) during onboarding.
 *
 * Percentages rather than amounts, so they scale to whatever the user's income
 * turns out to be. Loosely the 50/30/20 shape: needs, wants, savings.
 */
export const STARTER_BUDGET_TEMPLATE: Array<{
  name: string;
  categoryIds: string[];
  shareOfIncome: number;
  rollover: 'reset' | 'rollover' | 'average';
}> = [
  { name: 'Food', categoryIds: ['cat_groceries', 'cat_eating_out'], shareOfIncome: 0.18, rollover: 'rollover' },
  { name: 'Transport', categoryIds: ['cat_transport'], shareOfIncome: 0.1, rollover: 'rollover' },
  { name: 'Home & bills', categoryIds: ['cat_rent', 'cat_utilities', 'cat_airtime'], shareOfIncome: 0.32, rollover: 'reset' },
  { name: 'Lifestyle', categoryIds: ['cat_shopping', 'cat_entertainment', 'cat_personal_care', 'cat_subscriptions'], shareOfIncome: 0.15, rollover: 'average' },
  { name: 'Savings', categoryIds: ['cat_savings'], shareOfIncome: 0.2, rollover: 'rollover' },
];

export const DEFAULT_SETTINGS: Record<string, string> = {
  display_currency: 'NGN',
  week_starts_on: '1',
  theme: 'system',
  auto_apply_categories: 'true',
  receipt_retention_days: '0', // 0 = keep forever
  gmail_sync_enabled: 'false',
  notifications_budget_alerts: 'true',
};
