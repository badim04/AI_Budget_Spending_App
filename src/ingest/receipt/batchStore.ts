/**
 * Handoff slot for a captured batch.
 *
 * A batch of receipts carries image URIs, OCR text and parsed totals. That does
 * not belong in navigation params — expo-router serialises those into the URL,
 * and a dozen receipts would blow past any sane length and mangle the OCR text
 * on the way. So the batch is parked here and the route carries only a token.
 *
 * Deliberately module-level and deliberately not persisted: this is in-flight
 * UI state that lives for one navigation. The receipts themselves are already
 * saved to the database before the user ever reaches the review screen, so
 * losing this slot loses nothing but the review queue ordering.
 */

export interface PendingReceipt {
  receiptId: string;
  fileUri: string;
  merchant: string | null;
  totalMinor: number | null;
  date: string | null;
  currency: string | null;
  /** OCR warning worth showing beside the row, e.g. "no total label found". */
  note: string | null;
}

const batches = new Map<string, PendingReceipt[]>();

/** Keep a couple of batches at most — this is a handoff, not a cache. */
const MAX_BATCHES = 3;

export function putBatch(items: PendingReceipt[]): string {
  const token = `batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  batches.set(token, items);

  while (batches.size > MAX_BATCHES) {
    const oldest = batches.keys().next().value;
    if (oldest === undefined) break;
    batches.delete(oldest);
  }
  return token;
}

/**
 * Read a batch.
 *
 * Non-destructive: the review screen re-reads on every render while the user
 * edits, so consuming here would empty the list underneath them. The entry is
 * evicted by the size cap instead.
 */
export function takeBatch(token: string): PendingReceipt[] {
  return batches.get(token) ?? [];
}

export function clearBatch(token: string): void {
  batches.delete(token);
}
