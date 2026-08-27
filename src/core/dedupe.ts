/**
 * Which rows of an import have I already got?
 *
 * A dedupe key is account + date + amount, so it matches the same payment
 * arriving from two sources — an email receipt and a bank statement — where
 * the descriptions differ. What it cannot do is tell two identical payments
 * apart, and those are not rare: stamp duty is a flat charge on every
 * qualifying transfer, so three ₦50 rows land on the same day for the same
 * amount. One real 229-row statement held 13 such transactions.
 *
 * So compare *counts*, not membership. If the database holds one ₦50 stamp
 * duty for 21 August and the file has three, the first is a duplicate and the
 * other two are new. Treating the key as a set imported one and silently threw
 * away two real charges.
 *
 * Pure and order-dependent: rows are matched in the order given, so a caller
 * that sorts oldest-first gets the oldest occurrences treated as the
 * already-seen ones.
 */

/** How many times each key already exists. */
export function countKeys(keys: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

/**
 * Flag each row as a duplicate of something already stored.
 *
 * Returns a parallel array: `result[i]` is true when `rows[i]` is covered by an
 * existing record.
 */
export function markDuplicates<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  existing: Map<string, number>
): boolean[] {
  const seen = new Map<string, number>();

  return rows.map((row) => {
    const key = keyOf(row);
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    // The Nth occurrence in the file is a duplicate only if the database
    // already holds at least N of them.
    return occurrence <= (existing.get(key) ?? 0);
  });
}
