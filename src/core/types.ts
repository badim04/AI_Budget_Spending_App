/**
 * The domain model.
 *
 * Everything the app knows about money is one of these shapes. They are plain
 * data — no methods, no class instances — so they can cross the SQLite boundary,
 * the network boundary, and the React render boundary without transformation.
 */

import type { CurrencyCode, Money } from './money';

export type ID = string;
/** ISO-8601 date, day precision: "2026-08-13". Days, not timestamps, because
 *  budgeting questions are asked in days and timezone drift on a timestamp can
 *  move a transaction into the wrong month. */
export type ISODate = string;
export type ISODateTime = string;

// ------------------------------------------------------------------ accounts

export type AccountKind =
  | 'cash'
  | 'bank'
  | 'mobile_money'
  | 'credit_card'
  | 'savings'
  | 'investment'
  | 'crypto'
  | 'loan';

export interface Account {
  id: ID;
  name: string;
  kind: AccountKind;
  currency: CurrencyCode;
  /** Opening balance in minor units, at `openedAt`. Running balance is derived
   *  from this plus transactions — never stored, so it can't go out of sync. */
  openingBalanceMinor: number;
  openedAt: ISODate;
  institution?: string;
  /** Last 4 digits / masked identifier, for matching imported statements. */
  mask?: string;
  archived: boolean;
  color?: string;
  icon?: string;
  /** For credit cards and loans: the limit, so utilisation can be shown. */
  creditLimitMinor?: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

// ---------------------------------------------------------------- categories

export type CategoryKind = 'expense' | 'income' | 'transfer';

/**
 * Categories form a two-level tree: a group ("Food") with children
 * ("Groceries", "Eating out"). Two levels is deliberate — deeper trees are
 * where budget apps become tedious to maintain and people stop categorising.
 */
export interface Category {
  id: ID;
  name: string;
  kind: CategoryKind;
  parentId?: ID;
  icon: string;
  color: string;
  /** Excluded from spending totals and budgets — for transfers between your own
   *  accounts, and for reimbursables you don't want polluting the trend. */
  excludeFromTotals: boolean;
  /** Ordering in pickers; frequently used categories float up. */
  sortOrder: number;
  archived: boolean;
  /** Set by the seeder; user-created categories are false. Protects defaults
   *  from being deleted out from under the categorisation rules. */
  isSystem: boolean;
}

// -------------------------------------------------------------- transactions

export type TransactionKind = 'expense' | 'income' | 'transfer';

export type TransactionSource =
  | 'manual'
  | 'receipt_scan'
  | 'email_import'
  | 'sms_import'
  | 'bank_feed'
  | 'csv_import'
  | 'recurring_rule';

/** How confident we are that this transaction is correctly categorised. */
export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'unreviewed';

export interface TransactionSplit {
  categoryId: ID;
  amountMinor: number;
  note?: string;
}

export interface Transaction {
  id: ID;
  accountId: ID;
  kind: TransactionKind;
  /** Signed minor units in the ACCOUNT's currency: negative for money out,
   *  positive for money in. Sign carries direction so a sum over any set of
   *  transactions is a valid net figure without branching on kind. */
  amountMinor: number;
  currency: CurrencyCode;

  /** When the money actually moved (not when we recorded it). */
  date: ISODate;
  /** Merchant / counterparty as shown to the user, after cleanup. */
  merchant: string;
  /** The raw descriptor from the bank, email, or receipt. Kept verbatim because
   *  the categoriser learns from it and cleanup is lossy. */
  rawDescription?: string;
  note?: string;

  categoryId?: ID;
  /** Present when one payment covers several categories (a supermarket run
   *  that is part groceries, part household). Splits must sum to amountMinor. */
  splits?: TransactionSplit[];

  /** Both sides of an internal transfer point at each other. */
  transferPairId?: ID;

  source: TransactionSource;
  confidence: ConfidenceLevel;
  /** True once a human has looked at it. Drives the "needs review" queue. */
  reviewed: boolean;

  /** Original amount when the payment was made in a different currency than the
   *  account (a USD subscription on an NGN card). Kept so the app can show what
   *  was actually charged alongside what it cost. */
  originalAmountMinor?: number;
  originalCurrency?: CurrencyCode;
  fxRateUsed?: number;

  receiptId?: ID;
  recurringRuleId?: ID;
  tags: string[];

  /** Stable hash of (account, date, amount, descriptor) used to drop duplicates
   *  when the same payment arrives from both an email receipt and a bank feed. */
  dedupeKey: string;

  /** Pending transactions (card auth not yet settled) are shown but excluded
   *  from reconciled balances. */
  pending: boolean;

  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  deletedAt?: ISODateTime;
}

// ------------------------------------------------------------------ receipts

export type ReceiptStatus =
  | 'uploaded'
  | 'ocr_pending'
  | 'ocr_done'
  | 'parsed'
  | 'matched'
  | 'failed';

export interface ReceiptLineItem {
  description: string;
  quantity?: number;
  unitPriceMinor?: number;
  totalMinor: number;
  /** Category guessed per line — a supermarket receipt is rarely one category. */
  suggestedCategoryId?: ID;
}

export interface Receipt {
  id: ID;
  /** Path in local app storage. Receipts stay on device by default; sync is opt-in. */
  fileUri: string;
  /** Small preview for lists, so the grid doesn't decode full-size images. */
  thumbnailUri?: string;
  mimeType: string;
  byteSize: number;
  status: ReceiptStatus;

  /** Full OCR text, retained for search — "which receipt had the router on it?" */
  ocrText?: string;
  ocrConfidence?: number;

  merchant?: string;
  date?: ISODate;
  totalMinor?: number;
  taxMinor?: number;
  tipMinor?: number;
  currency?: CurrencyCode;
  lineItems?: ReceiptLineItem[];

  transactionId?: ID;
  /** Set when parsing failed, so the UI can explain rather than just show empty. */
  error?: string;

  capturedAt: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

// ------------------------------------------------------------------- budgets

export type BudgetPeriod =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'annually';

/**
 * What happens to an unspent (or overspent) amount at period end.
 * - `reset`   : classic envelope, starts fresh each period
 * - `rollover`: leftovers carry forward, overspend eats next period
 * - `average` : the target is an average over time, so a spike is absorbed
 */
export type RolloverPolicy = 'reset' | 'rollover' | 'average';

export interface Budget {
  id: ID;
  name: string;
  categoryIds: ID[];
  /** Empty means "everything not covered by another budget" — the catch-all. */
  amountMinor: number;
  currency: CurrencyCode;
  period: BudgetPeriod;
  rollover: RolloverPolicy;
  /** Budgets can start mid-month; periods are generated from this anchor. */
  startsOn: ISODate;
  endsOn?: ISODate;
  /** Fraction of the budget at which to warn, e.g. 0.8 for 80%. */
  alertThreshold: number;
  archived: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

// ----------------------------------------------------------------- recurring

export type Frequency =
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'semimonthly'
  | 'monthly'
  | 'quarterly'
  | 'semiannually'
  | 'annually';

export interface RecurringRule {
  id: ID;
  name: string;
  accountId: ID;
  categoryId?: ID;
  kind: TransactionKind;
  amountMinor: number;
  currency: CurrencyCode;
  frequency: Frequency;
  /** Every N periods — frequency 'monthly' with interval 3 is quarterly. */
  interval: number;
  startsOn: ISODate;
  endsOn?: ISODate;
  /** For monthly rules: which day. 31 clamps to the last day of short months. */
  dayOfMonth?: number;
  /** For weekly rules: 0=Sunday .. 6=Saturday. */
  dayOfWeek?: number;
  /** Detected automatically from transaction history rather than user-entered. */
  autoDetected: boolean;
  /** Amounts that vary (a utility bill) are projected from a rolling average. */
  variableAmount: boolean;
  lastGeneratedOn?: ISODate;
  active: boolean;
  merchant?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

// -------------------------------------------------------------------- goals

export interface Goal {
  id: ID;
  name: string;
  targetMinor: number;
  currency: CurrencyCode;
  /** Which account holds the money, so progress is read not typed. */
  accountId?: ID;
  savedMinor: number;
  targetDate?: ISODate;
  icon: string;
  color: string;
  archived: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

// ------------------------------------------------------- derived / analytics

export interface PeriodRange {
  start: ISODate;
  /** Inclusive. A month is 2026-08-01..2026-08-31. */
  end: ISODate;
  label: string;
}

export interface CategoryTotal {
  categoryId: ID;
  categoryName: string;
  color: string;
  icon: string;
  total: Money;
  transactionCount: number;
  /** Share of the parent total, 0..1. */
  share: number;
  /** Change against the previous comparable period, as a fraction. Null when
   *  there is no prior data to compare against. */
  changeVsPrevious: number | null;
  /**
   * The categories rolled up into this row, for the synthetic "Other" bucket.
   * Absent on a real category. Lets a tap on "Other (3)" open the three
   * categories it stands for instead of a dead end.
   */
  memberIds?: ID[];
}

export interface BudgetStatus {
  budget: Budget;
  range: PeriodRange;
  allocated: Money;
  /** Includes any rollover carried in from prior periods. */
  effectiveAllocated: Money;
  spent: Money;
  remaining: Money;
  /** 0..1+, where >1 is overspent. Null when the allocation is zero. */
  utilisation: number | null;
  /** How far through the period we are, 0..1 — the reference line for pace. */
  periodProgress: number;
  /** Projected end-of-period spend at the current rate. */
  projected: Money;
  state: 'on_track' | 'warning' | 'over' | 'ended_under' | 'ended_over';
  /** Spend per remaining day that would land exactly on budget. */
  safeToSpendPerDay: Money;
}

export interface CashflowPoint {
  date: ISODate;
  inflow: Money;
  outflow: Money;
  net: Money;
  /** Running balance across all included accounts at end of this bucket. */
  balance: Money;
}

export interface Forecast {
  points: Array<{
    date: ISODate;
    value: Money;
    /** Prediction interval — the band the chart shades. */
    lower: Money;
    upper: Money;
  }>;
  method: 'holt_linear' | 'seasonal_naive' | 'mean' | 'insufficient_data';
  /** Mean absolute percentage error from backtesting, 0..1. Lower is better.
   *  Shown to the user so a shaky forecast is visibly shaky. */
  mape: number | null;
  confidence: ConfidenceLevel;
}

export interface Insight {
  id: string;
  severity: 'positive' | 'neutral' | 'warning' | 'critical';
  title: string;
  body: string;
  /** Where tapping the insight should take the user. */
  action?: { route: string; params?: Record<string, string> };
  /** Higher sorts first on the dashboard. */
  weight: number;
}

export interface NetWorthPoint {
  date: ISODate;
  assets: Money;
  liabilities: Money;
  net: Money;
}
