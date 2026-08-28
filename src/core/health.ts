/**
 * A financial health score, and the honest version of that idea.
 *
 * Every app in the reference set has one: a number out of a hundred with a ring
 * around it and five bars underneath. They are also, mostly, theatre — a
 * weighted average of whatever the app happens to have, presented with two
 * significant figures of confidence it has not earned.
 *
 * The number is worth having anyway, because it answers a question a list of
 * transactions cannot: *am I doing all right?* But it is only worth having if it
 * obeys four rules, and those rules are most of this file.
 *
 * **1. A component you cannot measure is absent, not zero.**
 * Finlo does not know about your insurance or your pension. Scoring those as
 * zero would tell someone with excellent finances that they are failing, which
 * is both wrong and the fastest way to make them stop trusting every other
 * number in the app. Unmeasurable components return `null`, are shown as "not
 * tracked", and are left out of the average entirely.
 *
 * **2. Every component says what would move it.**
 * A score with no lever is a judgement. Each one carries a sentence naming the
 * single thing that would raise it, drawn from the user's own figures.
 *
 * **3. Thin evidence caps confidence, it does not fake it.**
 * One month of history cannot support a claim about spending stability. The
 * result carries `confidence` and the number of months behind it, so the screen
 * can say "based on 2 months" instead of implying a verdict.
 *
 * **4. The bands are stated, not implied.**
 * 80+ is strong, 60+ is fine, 40+ is worth attention, below that is fragile.
 * Written down here so the label and the colour cannot drift apart in the UI.
 *
 * Pure: no React, no I/O, no clock of its own.
 */

import type { BudgetStatus } from './types';
import {
  cashflowSeries,
  runwayMonths,
  savingsRate,
  type AnalyticsContext,
} from './analytics';
import { median } from './forecast';
import { monthOf, previousMonth } from './periods';
import { addMonths } from './dates';

export type HealthKey = 'saving' | 'spending' | 'budgets' | 'runway' | 'consistency';

export interface HealthComponent {
  key: HealthKey;
  label: string;
  /** 0-100, or null when there is not enough evidence to say anything. */
  score: number | null;
  /** Why it is what it is, in the user's own figures. */
  detail: string;
  /** The one thing that would raise it. Absent when the component is maxed. */
  lever?: string;
}

export interface HealthScore {
  /** 0-100 across the components that could be measured. Null if none could. */
  score: number | null;
  band: 'strong' | 'fine' | 'attention' | 'fragile' | 'unknown';
  label: string;
  components: HealthComponent[];
  /** Components skipped for want of data, so the UI can say so out loud. */
  untracked: HealthKey[];
  /** Whole months of history the score is based on. */
  monthsOfHistory: number;
  confidence: 'low' | 'medium' | 'high';
}

/** Stated once so the badge, the colour and the sentence cannot disagree. */
export const HEALTH_BANDS: Array<{ min: number; band: HealthScore['band']; label: string }> = [
  { min: 80, band: 'strong', label: 'Strong' },
  { min: 60, band: 'fine', label: 'Doing fine' },
  { min: 40, band: 'attention', label: 'Worth attention' },
  { min: 0, band: 'fragile', label: 'Fragile' },
];

export function bandFor(score: number | null): { band: HealthScore['band']; label: string } {
  if (score == null) return { band: 'unknown', label: 'Not enough history yet' };
  const hit = HEALTH_BANDS.find((b) => score >= b.min) ?? HEALTH_BANDS[HEALTH_BANDS.length - 1];
  return { band: hit.band, label: hit.label };
}

/** Map a value onto 0-100 between a floor and a ceiling, clamped. */
function ramp(value: number, floor: number, ceiling: number): number {
  if (ceiling === floor) return 50;
  const t = (value - floor) / (ceiling - floor);
  return Math.round(Math.max(0, Math.min(1, t)) * 100);
}

function money(minor: number, currency: string): string {
  // Deliberately plain: `formatMoney` lives in core/money and takes a Money, and
  // this module only ever needs a rough figure inside a sentence.
  const whole = Math.round(Math.abs(minor) / 100).toLocaleString('en-NG');
  return `${currency === 'NGN' ? '₦' : ''}${whole}`;
}

export function financialHealth(
  ctx: AnalyticsContext,
  budgetStatuses: BudgetStatus[]
): HealthScore {
  const currency = ctx.displayCurrency;
  const thisMonth = monthOf(ctx.asOf);

  /**
   * Complete months, and only ones that actually happened.
   *
   * Two filters, and both were found by a test rather than by reasoning.
   *
   * A partial month has less spending in it by definition, so including the
   * current one would hand out a rising score every time the calendar rolled
   * over. Same reasoning as the forecast, which fits on complete months only.
   *
   * The second filter matters more. `cashflowSeries` returns a bucket per month
   * in the window whether or not anything happened in it, so a brand-new user
   * with no transactions got twelve empty months — and "0 of 12 months finished
   * ahead" scored their consistency at zero. That is a verdict delivered on the
   * strength of no evidence at all, which is the one thing this file is meant
   * not to do. An empty month is an absence of history, not a bad month.
   */
  const flow = cashflowSeries(
    addMonths(thisMonth.start, -12),
    thisMonth.start,
    'monthly',
    ctx
  ).filter(
    (p) => p.date < thisMonth.start && (p.inflow.minor !== 0 || p.outflow.minor !== 0)
  );
  const monthsOfHistory = flow.length;

  const components: HealthComponent[] = [];

  // --- saving: what share of income survives the month ----------------------
  const rate = savingsRate(previousMonth(thisMonth), ctx);
  if (rate == null) {
    components.push({
      key: 'saving',
      label: 'Saving',
      score: null,
      detail: 'No income recorded last month, so there is nothing to take a share of.',
      lever: 'Record your income and this starts working.',
    });
  } else {
    // 20% is the commonly cited target and the point this hits 100; 0 is the
    // floor. Spending more than you earned scores zero rather than negative.
    const score = ramp(rate, 0, 0.2);
    components.push({
      key: 'saving',
      label: 'Saving',
      score,
      detail:
        rate < 0
          ? 'You spent more than you earned last month.'
          : `You kept ${Math.round(rate * 100)}% of what you earned last month.`,
      lever: score >= 100 ? undefined : 'Keeping a fifth of your income is the usual target.',
    });
  }

  // --- spending: is it going up or down -------------------------------------
  if (monthsOfHistory < 2) {
    components.push({
      key: 'spending',
      label: 'Spending trend',
      score: null,
      detail: 'Needs two complete months to compare.',
    });
  } else {
    const latest = flow[flow.length - 1];
    const earlier = flow.slice(0, -1).map((p) => p.outflow.minor);
    const typical = median(earlier);
    /**
     * Spending exactly your usual is good, not average.
     *
     * The first version ramped symmetrically about zero, which scored a
     * perfectly stable month 50 and then printed "last month tracked your
     * usual" beside it — the sentence said fine and the number said mediocre.
     * Steady spending is most of what financial health looks like, so flat
     * lands at 70; 15% under is a full 100, and the curve falls faster than it
     * rises because overspending is the thing worth flagging early.
     */
    const delta = typical > 0 ? (latest.outflow.minor - typical) / typical : 0;
    const score = ramp(-delta, -0.35, 0.15);
    components.push({
      key: 'spending',
      label: 'Spending trend',
      score,
      detail:
        Math.abs(delta) < 0.05
          ? `Last month tracked your usual ${money(typical, currency)}.`
          : delta > 0
            ? `Last month ran ${Math.round(delta * 100)}% above your usual ${money(typical, currency)}.`
            : `Last month ran ${Math.round(-delta * 100)}% below your usual ${money(typical, currency)}.`,
      lever: score >= 100 ? undefined : 'Bringing a month back under your median lifts this.',
    });
  }

  // --- budgets: are the envelopes holding -----------------------------------
  const live = budgetStatuses.filter((b) => b.budget.amountMinor > 0);
  if (live.length === 0) {
    components.push({
      key: 'budgets',
      label: 'Budgets',
      score: null,
      detail: 'No envelopes set, so there is nothing to keep to.',
      lever: 'Set one envelope and this starts counting.',
    });
  } else {
    const over = live.filter((b) => b.state === 'over').length;
    const warning = live.filter((b) => b.state === 'warning').length;
    // An overspent envelope costs a full share; one running ahead of pace costs
    // half, because it is a warning and not yet a failure.
    const score = Math.round(
      Math.max(0, 1 - (over + warning * 0.5) / live.length) * 100
    );
    components.push({
      key: 'budgets',
      label: 'Budgets',
      score,
      detail:
        over === 0 && warning === 0
          ? `All ${live.length} envelope${live.length === 1 ? '' : 's'} inside their limit.`
          : `${over} over, ${warning} ahead of pace, out of ${live.length}.`,
      lever: over > 0 ? 'Bringing an overspent envelope back inside lifts this most.' : undefined,
    });
  }

  // --- runway: how long the money lasts -------------------------------------
  const runway = runwayMonths(ctx);
  if (runway == null) {
    components.push({
      key: 'runway',
      label: 'Safety net',
      score: null,
      detail: 'Needs an account balance and a month of spending to work from.',
    });
  } else {
    // Three months of expenses is the standard emergency-fund target.
    const score = ramp(runway, 0, 3);
    components.push({
      key: 'runway',
      label: 'Safety net',
      score,
      detail: `Your balance covers ${runway.toFixed(1)} month${runway < 1.05 && runway > 0.95 ? '' : 's'} at your usual spend.`,
      lever: score >= 100 ? undefined : 'Three months of expenses is the usual emergency-fund target.',
    });
  }

  // --- consistency: does income cover spending, month after month -----------
  if (monthsOfHistory < 3) {
    components.push({
      key: 'consistency',
      label: 'Consistency',
      score: null,
      detail: 'Needs three complete months.',
    });
  } else {
    const positive = flow.filter((p) => p.inflow.minor > p.outflow.minor).length;
    const score = Math.round((positive / flow.length) * 100);
    components.push({
      key: 'consistency',
      label: 'Consistency',
      score,
      detail: `${positive} of the last ${flow.length} months finished ahead.`,
      lever: score >= 100 ? undefined : 'Finishing more months in the black lifts this.',
    });
  }

  const measured = components.filter((x) => x.score != null);
  const score =
    measured.length === 0
      ? null
      : Math.round(measured.reduce((sum, x) => sum + (x.score ?? 0), 0) / measured.length);

  return {
    score,
    ...bandFor(score),
    components,
    untracked: components.filter((x) => x.score == null).map((x) => x.key),
    monthsOfHistory,
    /**
     * Confidence follows evidence, not the score.
     *
     * Three components measured over six months is a claim worth making; one
     * component over one month is a guess, and saying so is the difference
     * between a useful number and a made-up one.
     */
    confidence:
      measured.length >= 4 && monthsOfHistory >= 6
        ? 'high'
        : measured.length >= 3 && monthsOfHistory >= 3
          ? 'medium'
          : 'low',
  };
}

/**
 * One sentence about the score, for the ring to sit under.
 *
 * Names the weakest measured component rather than praising the total: the
 * useful half of a score is where it is losing points.
 */
export function describeHealth(health: HealthScore): string {
  if (health.score == null) {
    return 'Add a month of transactions and Finlo can score your finances.';
  }

  const measured = health.components.filter(
    (x): x is HealthComponent & { score: number } => x.score != null
  );
  const weakest = [...measured].sort((a, b) => a.score - b.score)[0];

  if (weakest.score >= 80) {
    return `Every part of this is holding up. ${weakest.label} is the lowest at ${weakest.score}.`;
  }
  return weakest.lever
    ? `${weakest.label} is the weakest at ${weakest.score}. ${weakest.lever}`
    : `${weakest.label} is the weakest at ${weakest.score}.`;
}
