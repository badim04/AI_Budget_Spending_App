/**
 * Auto-categorisation.
 *
 * The goal is that the user never picks a category twice for the same merchant.
 * Four layers, tried in order, each one cheaper and more certain than the next:
 *
 *   1. User rules      — an explicit "always file X as Y". Absolute.
 *   2. Learned history — this merchant was filed as Y the last N times.
 *   3. Keyword match   — a shipped lexicon of merchant and descriptor patterns.
 *   4. LLM fallback    — only for descriptors nothing else recognises.
 *
 * Layers 1–3 run locally, offline, in microseconds, and handle the large
 * majority of transactions once the user has a few weeks of history. Layer 4 is
 * an interface here, not an implementation, so the engine stays pure and
 * testable and the network call lives at the edge.
 */

import type { Category, ConfidenceLevel, ID, Transaction } from './types';

export interface CategoryRule {
  id: ID;
  /** Matched case-insensitively against the normalised merchant + raw descriptor. */
  pattern: string;
  matchType: 'contains' | 'starts_with' | 'exact' | 'regex';
  categoryId: ID;
  /** Optional narrowing: only apply within an amount range or on one account. */
  minAmountMinor?: number;
  maxAmountMinor?: number;
  accountId?: ID;
  /** Higher wins when several rules match. User-created rules default high. */
  priority: number;
  enabled: boolean;
}

export interface CategorySuggestion {
  categoryId: ID;
  confidence: ConfidenceLevel;
  /** 0..1 — drives whether we auto-apply or ask. */
  score: number;
  /** Shown in the UI: "because you filed Shoprite as Groceries 6 times". */
  reason: string;
  source: 'user_rule' | 'history' | 'keyword' | 'llm' | 'fallback';
}

// ------------------------------------------------------- merchant normalising

/**
 * Bank descriptors are hostile: "POS/1234 SHOPRITE IKEJA LAG 12/08 REF:88213".
 * Normalising strips the machine noise so that the same merchant seen through a
 * card feed, an email receipt, and a manual entry all collapse to one key.
 */
export function normaliseMerchant(raw: string): string {
  if (!raw) return '';
  let s = raw.toLowerCase();

  // Payment-rail prefixes that carry no merchant information.
  s = s.replace(
    /\b(pos|atm|web|ussd|nip|neft|ach|sepa|visa|mastercard|verve|card|txn|trf|transfer|payment|purchase|debit|credit|dr|cr)\b[\s\/:.-]*/g,
    ' '
  );
  // Reference numbers, terminal ids, trailing digit soup.
  s = s.replace(/\bref[:\s#]*[a-z0-9-]+/g, ' ');
  s = s.replace(/\b[a-z]{0,3}\d{4,}\b/g, ' ');
  // Embedded dates in any common order.
  s = s.replace(/\b\d{1,4}[\/.-]\d{1,2}([\/.-]\d{1,4})?\b/g, ' ');
  // Trailing location/branch noise for the common city abbreviations.
  s = s.replace(/\b(lag|lagos|abj|abuja|ng|nga|uk|usa|ltd|limited|plc|inc|llc)\b/g, ' ');
  // Anything left that isn't a letter, digit, or space.
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  return s;
}

/** A stable key for grouping the same merchant across sources. */
export function merchantKey(raw: string): string {
  const norm = normaliseMerchant(raw);
  // First three tokens are almost always the brand; the rest is branch detail.
  return norm.split(' ').slice(0, 3).join(' ');
}

/** Title-cased merchant for display: "shoprite ikeja" -> "Shoprite Ikeja". */
export function prettyMerchant(raw: string): string {
  const norm = normaliseMerchant(raw);
  if (!norm) return raw.trim();
  return norm
    .split(' ')
    .filter(Boolean)
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

// ----------------------------------------------------------------- the lexicon

/**
 * Keyword lexicon, keyed by the seeded category slug.
 *
 * Entries are matched as whole words against the normalised descriptor, so
 * "uber" matches "uber trip" but not "uberoi". Ordering within a category does
 * not matter; specificity across categories is handled by scoring the longest
 * match, so "uber eats" beats "uber".
 */
export const KEYWORD_LEXICON: Record<string, string[]> = {
  groceries: [
    'shoprite', 'spar', 'justrite', 'market square', 'ebeano', 'addide', 'prince ebeano',
    'grocery', 'groceries', 'supermarket', 'foodco', 'hubmart', 'tesco', 'aldi', 'lidl',
    'walmart', 'kroger', 'whole foods', 'trader joe', 'sainsbury', 'carrefour', 'game stores',
  ],
  eating_out: [
    'restaurant', 'kfc', 'dominos', 'pizza', 'chicken republic', 'the place', 'cold stone',
    'burger', 'cafe', 'coffee', 'starbucks', 'mcdonald', 'subway', 'sweet sensation',
    'uber eats', 'bolt food', 'glovo', 'jumia food', 'chowdeck', 'deliveroo', 'doordash',
    'grubhub', 'chicken', 'suya', 'bukka', 'eatery', 'bar', 'lounge', 'grill',
  ],
  transport: [
    'uber', 'bolt', 'lyft', 'taxi', 'rida', 'indrive', 'cab', 'brt', 'transport',
    'fuel', 'petrol', 'diesel', 'total energies', 'mobil', 'conoil', 'oando', 'nnpc',
    'shell', 'gas station', 'parking', 'toll', 'lekki toll', 'train', 'metro', 'transit',
  ],
  travel: [
    'airline', 'air peace', 'arik', 'ibom air', 'green africa', 'emirates', 'qatar airways',
    'british airways', 'klm', 'lufthansa', 'booking com', 'airbnb', 'hotel', 'expedia',
    'travelstart', 'wakanow', 'flight', 'visa application', 'passport',
  ],
  utilities: [
    'ikeja electric', 'eko disco', 'aedc', 'phcn', 'nepa', 'electricity', 'prepaid meter',
    'water board', 'waste', 'lawma', 'gas refill', 'utility', 'dstv', 'gotv', 'startimes',
    'cable', 'internet', 'broadband', 'spectranet', 'smile', 'fibre', 'wifi',
  ],
  airtime_data: [
    'mtn', 'airtel', 'glo', '9mobile', 'etisalat', 'airtime', 'recharge', 'data bundle',
    'top up', 'topup', 'vodafone', 'verizon', 'at&t', 'giffgaff', 'phone credit',
  ],
  rent_housing: [
    'rent', 'landlord', 'service charge', 'estate dues', 'mortgage', 'accommodation',
    'lease', 'apartment', 'housing',
  ],
  health: [
    'pharmacy', 'hospital', 'clinic', 'medplus', 'healthplus', 'medical', 'doctor',
    'dentist', 'optician', 'lab test', 'diagnostic', 'hmo', 'health insurance', 'drugs',
  ],
  subscriptions: [
    'netflix', 'spotify', 'apple com bill', 'apple music', 'youtube premium', 'showmax',
    'amazon prime', 'disney', 'adobe', 'microsoft', 'office 365', 'google one',
    'icloud', 'dropbox', 'notion', 'canva', 'openai', 'anthropic', 'claude', 'chatgpt',
    'github', 'figma', 'subscription', 'membership',
  ],
  shopping: [
    'jumia', 'konga', 'amazon', 'aliexpress', 'shein', 'temu', 'ebay', 'asos', 'zara',
    'h m', 'nike', 'adidas', 'slot', 'pointek', 'store', 'boutique', 'mall', 'clothing',
  ],
  education: [
    'school fees', 'tuition', 'university', 'college', 'waec', 'jamb', 'neco', 'course',
    'udemy', 'coursera', 'edx', 'books', 'bookshop', 'stationery', 'exam',
  ],
  entertainment: [
    'cinema', 'filmhouse', 'silverbird', 'genesis cinema', 'imax', 'concert', 'ticket',
    'game', 'playstation', 'xbox', 'steam', 'nintendo', 'club', 'party',
  ],
  personal_care: [
    'salon', 'barber', 'spa', 'gym', 'fitness', 'haircut', 'nails', 'skincare',
    'cosmetics', 'massage',
  ],
  fees_charges: [
    'bank charge', 'sms alert', 'maintenance fee', 'stamp duty', 'vat', 'commission',
    'service fee', 'atm fee', 'card maintenance', 'account fee', 'overdraft', 'penalty',
    'late fee', 'interest charge',
  ],
  giving: [
    'church', 'tithe', 'offering', 'mosque', 'zakat', 'donation', 'charity', 'ngo',
    'gift', 'support',
  ],
  insurance: ['insurance', 'axa', 'leadway', 'aiico', 'cornerstone', 'premium', 'policy'],
  savings_investment: [
    'piggyvest', 'cowrywise', 'risevest', 'bamboo', 'trove', 'chaka', 'stanbic',
    'mutual fund', 'treasury bill', 'fixed deposit', 'investment', 'savings', 'vault',
    'binance', 'coinbase', 'luno', 'quidax',
  ],
  salary: ['salary', 'payroll', 'wages', 'stipend', 'remuneration', 'monthly pay'],
  freelance_income: [
    'upwork', 'fiverr', 'freelance', 'contract payment', 'consulting', 'invoice payment',
    'client payment', 'gig',
  ],
  transfer: [
    'transfer to', 'transfer from', 'own account', 'self transfer', 'wallet funding',
    'moved to savings',
  ],
};

/** Reverse index built once: keyword -> category slug, longest keyword first. */
const LEXICON_ENTRIES: Array<{ keyword: string; slug: string; weight: number }> = (() => {
  const entries: Array<{ keyword: string; slug: string; weight: number }> = [];
  for (const [slug, keywords] of Object.entries(KEYWORD_LEXICON)) {
    for (const keyword of keywords) {
      // Longer, more specific keywords should win: "uber eats" over "uber".
      entries.push({ keyword, slug, weight: keyword.length });
    }
  }
  return entries.sort((a, b) => b.weight - a.weight);
})();

// -------------------------------------------------------------------- history

export interface MerchantHistory {
  /** merchantKey -> categoryId -> times chosen */
  counts: Map<string, Map<ID, number>>;
}

/**
 * Build the learned model from past transactions.
 *
 * Only reviewed transactions count. Learning from our own unreviewed guesses
 * would let one early mistake reinforce itself into a confident, permanent
 * error — the model would train on its own output.
 */
export function buildMerchantHistory(transactions: Transaction[]): MerchantHistory {
  const counts = new Map<string, Map<ID, number>>();
  for (const t of transactions) {
    if (t.deletedAt || !t.categoryId || !t.reviewed) continue;
    const key = merchantKey(t.rawDescription || t.merchant);
    if (!key) continue;
    let inner = counts.get(key);
    if (!inner) {
      inner = new Map();
      counts.set(key, inner);
    }
    inner.set(t.categoryId, (inner.get(t.categoryId) ?? 0) + 1);
  }
  return { counts };
}

// ------------------------------------------------------------------- matching

function matchesRule(rule: CategoryRule, haystack: string, amountMinor: number, accountId: ID): boolean {
  if (!rule.enabled) return false;
  if (rule.accountId && rule.accountId !== accountId) return false;
  if (rule.minAmountMinor != null && Math.abs(amountMinor) < rule.minAmountMinor) return false;
  if (rule.maxAmountMinor != null && Math.abs(amountMinor) > rule.maxAmountMinor) return false;

  const needle = rule.pattern.toLowerCase();
  switch (rule.matchType) {
    case 'contains':
      return haystack.includes(needle);
    case 'starts_with':
      return haystack.startsWith(needle);
    case 'exact':
      return haystack === needle;
    case 'regex':
      try {
        return new RegExp(rule.pattern, 'i').test(haystack);
      } catch {
        // A user-authored regex that doesn't compile must not break every
        // subsequent categorisation — treat it as simply not matching.
        return false;
      }
  }
}

export interface CategoriseInput {
  merchant: string;
  rawDescription?: string;
  amountMinor: number;
  accountId: ID;
  /** Positive amounts skip expense categories entirely. */
  isInflow: boolean;
}

export interface CategoriseDeps {
  rules: CategoryRule[];
  history: MerchantHistory;
  categories: Category[];
  /** Maps a lexicon slug to the user's actual category id. */
  slugToCategoryId: Map<string, ID>;
}

/**
 * The main entry point. Returns the best suggestion, or null when nothing
 * matched — at which point the caller may fall back to an LLM or ask the user.
 */
export function categorise(
  input: CategoriseInput,
  deps: CategoriseDeps
): CategorySuggestion | null {
  const haystack = `${normaliseMerchant(input.merchant)} ${normaliseMerchant(
    input.rawDescription ?? ''
  )}`.trim();
  if (!haystack) return null;

  // 1. User rules — explicit intent, highest priority wins.
  const matching = deps.rules
    .filter((r) => matchesRule(r, haystack, input.amountMinor, input.accountId))
    .sort((a, b) => b.priority - a.priority);
  if (matching.length > 0) {
    return {
      categoryId: matching[0].categoryId,
      confidence: 'high',
      score: 1,
      reason: `Matches your rule "${matching[0].pattern}"`,
      source: 'user_rule',
    };
  }

  // 2. Learned history for this merchant.
  const key = merchantKey(input.rawDescription || input.merchant);
  const seen = deps.history.counts.get(key);
  if (seen && seen.size > 0) {
    let bestId: ID | null = null;
    let bestCount = 0;
    let total = 0;
    for (const [categoryId, count] of seen) {
      total += count;
      if (count > bestCount) {
        bestCount = count;
        bestId = categoryId;
      }
    }
    if (bestId) {
      // Agreement across past choices, not just raw count — 5 of 5 is a much
      // stronger signal than 5 of 12.
      const agreement = bestCount / total;
      const score = Math.min(0.99, agreement * (1 - 1 / (1 + bestCount)));
      const name = deps.categories.find((c) => c.id === bestId)?.name ?? 'that category';
      return {
        categoryId: bestId,
        confidence: score > 0.7 ? 'high' : score > 0.45 ? 'medium' : 'low',
        score,
        reason: `You filed this merchant as ${name} ${bestCount} time${bestCount === 1 ? '' : 's'}`,
        source: 'history',
      };
    }
  }

  // 3. Shipped keyword lexicon. Whole-word matching only.
  for (const entry of LEXICON_ENTRIES) {
    if (!containsWord(haystack, entry.keyword)) continue;
    const categoryId = deps.slugToCategoryId.get(entry.slug);
    if (!categoryId) continue;
    const category = deps.categories.find((c) => c.id === categoryId);
    // Don't file an inflow as an expense (or vice versa) just because a keyword
    // matched — a refund from Jumia is not shopping spend.
    if (category && input.isInflow && category.kind === 'expense') continue;
    if (category && !input.isInflow && category.kind === 'income') continue;

    return {
      categoryId,
      confidence: entry.weight >= 8 ? 'high' : 'medium',
      score: Math.min(0.9, 0.5 + entry.weight / 40),
      reason: `"${entry.keyword}" is a known ${category?.name ?? entry.slug} merchant`,
      source: 'keyword',
    };
  }

  return null;
}

/** Whole-word containment, so "uber" doesn't match "uberoi". */
function containsWord(haystack: string, needle: string): boolean {
  const idx = haystack.indexOf(needle);
  if (idx === -1) return false;
  const before = idx === 0 ? ' ' : haystack[idx - 1];
  const afterIdx = idx + needle.length;
  const after = afterIdx >= haystack.length ? ' ' : haystack[afterIdx];
  return !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after);
}

/**
 * Above this score the app files the transaction silently; below it, the
 * transaction lands in the review queue with the suggestion pre-selected.
 * Deliberately high — a wrong silent categorisation costs more trust than an
 * extra tap costs patience.
 */
export const AUTO_APPLY_THRESHOLD = 0.75;

export function shouldAutoApply(s: CategorySuggestion | null): boolean {
  return s != null && s.score >= AUTO_APPLY_THRESHOLD;
}

/**
 * Promote a correction into a rule.
 *
 * When the user recategorises the same merchant twice the same way, the app
 * offers to make it permanent — which is how the review queue shrinks toward
 * zero instead of staying a chore forever.
 */
export function suggestRuleFromCorrection(
  merchant: string,
  categoryId: ID,
  history: MerchantHistory
): Omit<CategoryRule, 'id'> | null {
  const key = merchantKey(merchant);
  const seen = history.counts.get(key);
  const count = seen?.get(categoryId) ?? 0;
  if (count < 2) return null;
  return {
    pattern: key,
    matchType: 'contains',
    categoryId,
    priority: 100,
    enabled: true,
  };
}

/** The prompt handed to the LLM fallback for descriptors nothing recognises.
 *  Kept here so the categorisation vocabulary lives in exactly one place. */
export function buildLLMPrompt(
  descriptors: string[],
  categories: Category[]
): string {
  const list = categories
    .filter((c) => !c.archived)
    .map((c) => `- ${c.id}: ${c.name} (${c.kind})`)
    .join('\n');
  return [
    'Classify each bank/receipt descriptor into exactly one category id.',
    'Return JSON: [{"descriptor": "...", "categoryId": "...", "confidence": 0.0-1.0}]',
    'If no category fits, use null for categoryId. Do not invent category ids.',
    '',
    'Categories:',
    list,
    '',
    'Descriptors:',
    ...descriptors.map((d, i) => `${i + 1}. ${d}`),
  ].join('\n');
}
