/**
 * The ingestion pipeline.
 *
 * One path in, whatever the source:
 *
 *   capture -> extract -> normalise -> dedupe -> categorise -> stage
 *
 * Nothing is written straight into the ledger. Everything lands as a
 * `StagedTransaction` carrying its own confidence and provenance, and the app
 * then either commits it silently (high confidence) or puts it in the review
 * queue. That single rule is what makes automatic capture safe: the worst case
 * for a bad parse is a row to confirm, never a silently wrong budget.
 */

import { money, type CurrencyCode } from '../core/money';
import { dedupeKey } from '../db/schema';
import {
  categorise,
  prettyMerchant,
  shouldAutoApply,
  type CategoriseDeps,
  type CategorySuggestion,
} from '../core/categorize';
import { parseEmail, type EmailMessage } from './email/parse';
import { needsLLM, parseReceipt, type ParsedReceipt } from './receipt/parse';
import type {
  Account,
  ConfidenceLevel,
  ID,
  Transaction,
  TransactionSource,
} from '../core/types';

export interface StagedTransaction {
  draft: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>;
  suggestion: CategorySuggestion | null;
  /** True when this should be written without asking. */
  autoCommit: boolean;
  /** Why it is or isn't being auto-committed — shown in the review queue. */
  rationale: string[];
  /** External id (Gmail message id, receipt id) for the ingest log. */
  externalId: string;
  source: TransactionSource;
}

export interface PipelineDeps extends CategoriseDeps {
  accounts: Account[];
  defaultAccountId: ID;
  defaultCurrency: CurrencyCode;
  /** dedupe keys already in the database. */
  existingKeys: Set<string>;
  /** External ids already ingested, so a re-sync is a no-op. */
  processedExternalIds: Set<string>;
  today: string;
}

/**
 * Route to an account by its masked number, falling back to the default.
 *
 * Getting this wrong moves money between the user's own accounts on paper, so
 * a mask that matches nothing falls back rather than guessing at the closest.
 */
function resolveAccount(
  mask: string | undefined,
  currency: CurrencyCode,
  deps: PipelineDeps
): Account | null {
  if (mask) {
    const byMask = deps.accounts.find((a) => !a.archived && a.mask === mask);
    if (byMask) return byMask;
  }
  const byCurrency = deps.accounts.find(
    (a) => !a.archived && a.currency === currency
  );
  return (
    deps.accounts.find((a) => a.id === deps.defaultAccountId) ?? byCurrency ?? null
  );
}

function confidenceLevel(score: number): ConfidenceLevel {
  if (score >= 0.75) return 'high';
  if (score >= 0.45) return 'medium';
  return 'low';
}

// -------------------------------------------------------------------- email

export function stageFromEmail(
  msg: EmailMessage,
  deps: PipelineDeps
): StagedTransaction | { skipped: string } {
  if (deps.processedExternalIds.has(msg.id)) {
    return { skipped: 'already ingested' };
  }

  const parsed = parseEmail(msg, {
    defaultCurrency: deps.defaultCurrency,
    today: deps.today,
  });
  if (!parsed) return { skipped: 'not a transaction email' };

  const account = resolveAccount(parsed.accountMask, parsed.amount.currency, deps);
  if (!account) return { skipped: 'no account to file this against' };

  // Sign carries direction; the parser reports magnitude.
  const signed = parsed.isInflow
    ? Math.abs(parsed.amount.minor)
    : -Math.abs(parsed.amount.minor);

  const key = dedupeKey(account.id, parsed.date, signed, parsed.amount.currency);
  if (deps.existingKeys.has(key)) {
    return { skipped: 'duplicate of a transaction already recorded' };
  }

  const suggestion = categorise(
    {
      merchant: parsed.merchant,
      rawDescription: parsed.rawDescription,
      amountMinor: signed,
      accountId: account.id,
      isInflow: parsed.isInflow,
    },
    deps
  );

  const rationale: string[] = [`Matched the ${parsed.templateId} email template`];
  if (suggestion) rationale.push(suggestion.reason);

  // Both the extraction AND the categorisation have to be confident. A
  // perfectly-read amount filed into the wrong category is still wrong.
  const extractionSolid = parsed.confidence === 'high';
  const autoCommit = extractionSolid && shouldAutoApply(suggestion);
  if (!extractionSolid) rationale.push(`Email parse confidence: ${parsed.confidence}`);

  return {
    draft: {
      accountId: account.id,
      kind: parsed.isInflow ? 'income' : 'expense',
      amountMinor: signed,
      currency: parsed.amount.currency,
      date: parsed.date,
      merchant: prettyMerchant(parsed.merchant) || parsed.merchant,
      rawDescription: parsed.rawDescription,
      categoryId: suggestion?.categoryId,
      source: 'email_import',
      confidence: suggestion ? confidenceLevel(suggestion.score) : 'unreviewed',
      reviewed: false,
      tags: [],
      dedupeKey: key,
      pending: false,
    },
    suggestion,
    autoCommit,
    rationale,
    externalId: msg.id,
    source: 'email_import',
  };
}

// ------------------------------------------------------------------ receipt

export interface ReceiptCapture {
  receiptId: ID;
  ocrText: string;
  /** Set when the user picked the account at capture time. */
  accountId?: ID;
}

export function stageFromReceipt(
  capture: ReceiptCapture,
  deps: PipelineDeps
): StagedTransaction | { skipped: string; parsed: ParsedReceipt } {
  const parsed = parseReceipt(capture.ocrText, {
    defaultCurrency: deps.defaultCurrency,
    today: deps.today,
  });

  if (!parsed.total) {
    return { skipped: 'could not read a total', parsed };
  }

  const account =
    deps.accounts.find((a) => a.id === capture.accountId) ??
    resolveAccount(undefined, parsed.currency, deps);
  if (!account) return { skipped: 'no account to file this against', parsed };

  const date = parsed.date ?? deps.today;
  const merchant = parsed.merchant ?? 'Unknown merchant';
  const signed = -Math.abs(parsed.total.minor);
  const key = dedupeKey(account.id, date, signed, parsed.currency);

  if (deps.existingKeys.has(key)) {
    // Not an error: the bank alert probably arrived first. The receipt should
    // attach to that transaction rather than create a second one.
    return { skipped: 'matches a transaction already recorded', parsed };
  }

  const suggestion = categorise(
    {
      merchant,
      rawDescription: merchant,
      amountMinor: signed,
      accountId: account.id,
      isInflow: false,
    },
    deps
  );

  const rationale: string[] = [];
  if (parsed.warnings.length) rationale.push(...parsed.warnings);
  if (suggestion) rationale.push(suggestion.reason);
  if (needsLLM(parsed)) rationale.push('Low OCR confidence — worth a second look');

  return {
    draft: {
      accountId: account.id,
      kind: 'expense',
      amountMinor: signed,
      currency: parsed.currency,
      date,
      merchant: prettyMerchant(merchant) || merchant,
      rawDescription: merchant,
      categoryId: suggestion?.categoryId,
      // Splitting a supermarket receipt across categories by line item is
      // proposed here; the user confirms it in the review sheet.
      splits: proposeSplits(parsed, suggestion, deps),
      source: 'receipt_scan',
      confidence: suggestion ? confidenceLevel(suggestion.score) : 'unreviewed',
      reviewed: false,
      receiptId: capture.receiptId,
      tags: [],
      dedupeKey: key,
      pending: false,
    },
    suggestion,
    // Receipts always get a look. The user just took the photo, so they are
    // already in the app — a confirmation costs one tap and buys correctness.
    autoCommit: false,
    rationale,
    externalId: capture.receiptId,
    source: 'receipt_scan',
  };
}

/**
 * Propose per-line categories when a receipt clearly spans several.
 *
 * Only proposed when line items actually reconcile to the total; a partial OCR
 * read would otherwise produce splits that don't sum, which is worse than no
 * splits at all.
 */
function proposeSplits(
  parsed: ParsedReceipt,
  fallback: CategorySuggestion | null,
  deps: PipelineDeps
): Array<{ categoryId: ID; amountMinor: number }> | undefined {
  if (!parsed.total || parsed.lineItems.length < 2) return undefined;

  const itemSum = parsed.lineItems.reduce((a, i) => a + i.totalMinor, 0);
  const target = parsed.subtotal?.minor ?? parsed.total.minor;
  if (Math.abs(itemSum - target) > Math.max(100, target * 0.02)) return undefined;

  const byCategory = new Map<ID, number>();
  for (const item of parsed.lineItems) {
    const suggestion = categorise(
      {
        merchant: item.description,
        amountMinor: -item.totalMinor,
        accountId: deps.defaultAccountId,
        isInflow: false,
      },
      deps
    );
    const categoryId = suggestion?.categoryId ?? fallback?.categoryId;
    if (!categoryId) return undefined;
    byCategory.set(categoryId, (byCategory.get(categoryId) ?? 0) - item.totalMinor);
  }

  // One category means it isn't really a split.
  if (byCategory.size < 2) return undefined;

  const splits = [...byCategory.entries()].map(([categoryId, amountMinor]) => ({
    categoryId,
    amountMinor,
  }));

  // Splits must sum to the transaction total exactly; tax and rounding go to
  // the largest line so the invariant holds.
  const splitSum = splits.reduce((a, s) => a + s.amountMinor, 0);
  const drift = -Math.abs(parsed.total.minor) - splitSum;
  if (drift !== 0) {
    const largest = splits.reduce((a, b) =>
      Math.abs(b.amountMinor) > Math.abs(a.amountMinor) ? b : a
    );
    largest.amountMinor += drift;
  }
  return splits;
}

// ------------------------------------------------------------------- batches

export interface IngestReport {
  staged: StagedTransaction[];
  autoCommitted: number;
  needsReview: number;
  skipped: Array<{ externalId: string; reason: string }>;
}

export function ingestEmails(
  messages: EmailMessage[],
  deps: PipelineDeps
): IngestReport {
  const staged: StagedTransaction[] = [];
  const skipped: Array<{ externalId: string; reason: string }> = [];
  // Copy so keys added during this batch dedupe against each other too — two
  // alerts for the same payment often arrive in the same sync.
  const seen = new Set(deps.existingKeys);

  for (const msg of messages) {
    const result = stageFromEmail(msg, { ...deps, existingKeys: seen });
    if ('skipped' in result) {
      skipped.push({ externalId: msg.id, reason: result.skipped });
      continue;
    }
    seen.add(result.draft.dedupeKey);
    staged.push(result);
  }

  return {
    staged,
    autoCommitted: staged.filter((s) => s.autoCommit).length,
    needsReview: staged.filter((s) => !s.autoCommit).length,
    skipped,
  };
}

/** Turn a staged draft into a real transaction, ready to insert. */
export function commit(
  staged: StagedTransaction,
  id: string,
  now: string
): Transaction {
  return {
    ...staged.draft,
    id,
    // Auto-committed rows are still marked unreviewed: the app acted without
    // asking, so the user retains the chance to disagree.
    reviewed: false,
    createdAt: now,
    updatedAt: now,
  };
}

/** Attach a receipt to a transaction that already exists (the alert arrived
 *  first). This is the common case once email sync is switched on. */
export function attachReceiptToExisting(
  transaction: Transaction,
  receiptId: ID,
  now: string
): Transaction {
  return { ...transaction, receiptId, updatedAt: now };
}
