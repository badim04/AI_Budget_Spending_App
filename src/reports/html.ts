/**
 * Report → HTML, which `expo-print` turns into a PDF.
 *
 * Pure string building, no React and no filesystem, so the layout is testable
 * in plain Node. Everything is inline CSS and self-contained: the print engine
 * fetches nothing, so an external stylesheet or webfont would simply be missing
 * from the PDF.
 *
 * Printed on white regardless of the app theme — a dark-background PDF is
 * unreadable on paper and burns a cartridge. The *colour* is deliberate and
 * everywhere, though: a brand-gradient hero, tinted KPI tiles and a colour per
 * section. `print-color-adjust: exact` is set so the backgrounds survive the
 * trip to PDF instead of being stripped to save ink.
 */

import { formatMoney } from '../core/money';
import { formatDate } from '../core/dates';
import type { Report } from './build';

const INK = '#0f1222';
const MUTED = '#6b7280';
const LINE = '#e7e8ee';
const GOOD = '#0f8f5a';
const BAD = '#c8383f';

/** The brand, and the second colour its gradient runs to. */
const BRAND = '#7c4dff';
const BRAND2 = '#4d7cff';

/** Chart colours, printable on white. */
const SERIES = ['#7c4dff', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#2a78d6', '#12b3a6', '#8a8880'];

/**
 * Soft tint + matching ink, one pair per KPI tile.
 *
 * Each tile is a quiet wash of colour rather than a grey box, and the ink is
 * dark enough on its own tint to pass a comfortable contrast on paper.
 */
const TINTS: Array<{ bg: string; ink: string; tag: string }> = [
  { bg: '#f1edff', ink: '#4b2ec7', tag: '#7c4dff' }, // violet
  { bg: '#e9fbf3', ink: '#0a6b45', tag: '#12b37e' }, // emerald
  { bg: '#fff2e8', ink: '#9a3d12', tag: '#f97316' }, // orange
  { bg: '#eaf2ff', ink: '#1e46b0', tag: '#3b74e8' }, // blue
  { bg: '#fdecf3', ink: '#a11a5b', tag: '#e0498f' }, // pink
  { bg: '#e8faff', ink: '#0e5f75', tag: '#0fb0cf' }, // cyan
];

/** Each section gets its own accent, so the eye can find "Budgets" by colour. */
const SECTION = {
  monthly: '#12b37e',
  category: '#f97316',
  budget: '#7c4dff',
  merchant: '#3b74e8',
  forecast: '#eda100',
  transactions: '#12b3a6',
};

export function reportToHtml(r: Report): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  @page { margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: ${INK}; background: #ffffff; font-size: 11px; line-height: 1.45; margin: 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  /* Hero band -------------------------------------------------------------- */
  .hero {
    background: linear-gradient(135deg, ${BRAND} 0%, ${BRAND2} 100%);
    color: #fff; border-radius: 16px; padding: 20px 22px; margin-bottom: 16px;
  }
  .hero h1 { font-size: 24px; margin: 0; letter-spacing: -0.5px; font-weight: 800; }
  .hero .sub { color: rgba(255,255,255,.85); font-size: 11px; margin: 6px 0 0; }
  .hero .chips { margin-top: 14px; }
  .hero .chip {
    display: inline-block; background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.28);
    border-radius: 999px; padding: 4px 11px; margin: 0 6px 6px 0; font-size: 10px; font-weight: 600;
  }

  h2 {
    font-size: 13px; margin: 24px 0 9px; letter-spacing: -0.2px;
    padding-left: 10px; border-left: 4px solid ${BRAND}; line-height: 1.1;
  }

  /* KPI tiles -------------------------------------------------------------- */
  .kpis { display: flex; flex-wrap: wrap; gap: 8px; }
  .kpi { border-radius: 12px; padding: 11px 13px; min-width: 120px; flex: 1; }
  .kpi .l { font-size: 9px; text-transform: uppercase; letter-spacing: .6px; font-weight: 700; opacity: .8; }
  .kpi .v { font-size: 18px; font-weight: 800; margin-top: 3px; letter-spacing: -0.4px; }
  .kpi .h { font-size: 9px; margin-top: 3px; opacity: .72; }

  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; color: ${MUTED}; font-size: 9px; text-transform: uppercase;
       letter-spacing: .5px; border-bottom: 1.5px solid ${LINE}; padding: 7px 5px; font-weight: 700; }
  td { padding: 7px 5px; border-bottom: 1px solid #f3f4f6; vertical-align: middle; }
  tr:nth-child(even) td { background: #fbfbfe; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .pos { color: ${GOOD}; font-weight: 600; } .neg { color: ${BAD}; font-weight: 600; }
  .muted { color: ${MUTED}; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 7px; vertical-align: middle; }
  .name { vertical-align: middle; }

  .bar { height: 7px; background: #f0f1f4; border-radius: 4px; overflow: hidden; min-width: 60px; }
  .bar > i { display: block; height: 100%; border-radius: 4px; }
  .pill { display: inline-block; border-radius: 999px; padding: 2px 9px; font-size: 9px; font-weight: 700; }

  /* Tables must not split a row across pages. */
  tr { page-break-inside: avoid; }
  .section { page-break-inside: avoid; }
  .pagebreak { page-break-before: always; }
  .foot { margin-top: 24px; padding-top: 9px; border-top: 2px solid ${LINE};
          color: ${MUTED}; font-size: 9px; }
  .foot b { color: ${BRAND}; }
</style></head><body>

<div class="hero">
  <h1>${esc(r.title)}</h1>
  <p class="sub">${esc(r.subtitle)} · ${esc(formatDate(r.range.start, 'medium'))} – ${esc(
    formatDate(r.range.end, 'medium')
  )}</p>
  <div class="chips">
    <span class="chip">${esc(r.currency)}</span>
    ${r.kpis
      .slice(0, 3)
      .map((k) => `<span class="chip">${esc(k.label)}: ${esc(k.value)}</span>`)
      .join('')}
  </div>
</div>

<div class="kpis">
  ${r.kpis
    .map((k, i) => {
      const tint = TINTS[i % TINTS.length];
      return `<div class="kpi" style="background:${tint.bg};color:${tint.ink}">
        <div class="l" style="color:${tint.tag}">${esc(k.label)}</div>
        <div class="v">${esc(k.value)}</div>
        ${k.hint ? `<div class="h">${esc(k.hint)}</div>` : ''}
      </div>`;
    })
    .join('')}
</div>

${monthlySection(r)}
${categorySection(r)}
${budgetSection(r)}
${merchantSection(r)}
${forecastSection(r)}
${transactionSection(r)}

<div class="foot">
  Generated ${esc(new Date(r.generatedAt).toUTCString())} by <b>Finlo</b>.
  Figures are converted into ${esc(r.currency)} using the exchange rates stored on the device.
</div>
</body></html>`;
}

// ------------------------------------------------------------------ sections

/** A heading whose accent bar is coloured for this section. */
function heading(title: string, colour: string): string {
  return `<h2 style="border-left-color:${colour}">${esc(title)}</h2>`;
}

function monthlySection(r: Report): string {
  if (r.monthly.length === 0) return '';
  const peak = Math.max(...r.monthly.map((m) => Math.max(m.spend.minor, m.income.minor)), 1);

  return `<div class="section">${heading('Month by month', SECTION.monthly)}
  <table>
    <tr><th>Month</th><th class="num">Income</th><th class="num">Spend</th><th class="num">Net</th><th style="width:32%">Spend vs income</th></tr>
    ${r.monthly
      .map(
        (m) => `<tr>
      <td>${esc(m.label)}</td>
      <td class="num">${esc(formatMoney(m.income, { compactDecimals: true }))}</td>
      <td class="num">${esc(formatMoney(m.spend, { compactDecimals: true }))}</td>
      <td class="num ${m.net.minor >= 0 ? 'pos' : 'neg'}">${esc(
          formatMoney(m.net, { compactDecimals: true, signed: true })
        )}</td>
      <td>
        <div class="bar"><i style="width:${pct(m.income.minor, peak)}%;background:${GOOD}"></i></div>
        <div class="bar" style="margin-top:3px"><i style="width:${pct(
          m.spend.minor,
          peak
        )}%;background:${SECTION.category}"></i></div>
      </td>
    </tr>`
      )
      .join('')}
  </table></div>`;
}

function categorySection(r: Report): string {
  if (r.categories.length === 0) return '';
  const top = r.categories.slice(0, 12);
  const largest = top[0]?.total.minor ?? 1;

  return `<div class="section">${heading('Where it went', SECTION.category)}
  <table>
    <tr><th>Category</th><th class="num">Amount</th><th class="num">Share</th><th class="num">vs previous</th><th style="width:26%"></th></tr>
    ${top
      .map(
        (row, i) => `<tr>
      <td><span class="dot" style="background:${SERIES[i % SERIES.length]}"></span><span class="name">${esc(
          row.categoryName
        )}</span></td>
      <td class="num">${esc(formatMoney(row.total, { compactDecimals: true }))}</td>
      <td class="num muted">${Math.round(row.share * 100)}%</td>
      <td class="num ${
        row.changeVsPrevious == null ? 'muted' : row.changeVsPrevious > 0 ? 'neg' : 'pos'
      }">${
          row.changeVsPrevious == null
            ? '—'
            : `${row.changeVsPrevious > 0 ? '+' : ''}${Math.round(row.changeVsPrevious * 100)}%`
        }</td>
      <td><div class="bar"><i style="width:${pct(row.total.minor, largest)}%;background:${
          SERIES[i % SERIES.length]
        }"></i></div></td>
    </tr>`
      )
      .join('')}
  </table></div>`;
}

function budgetSection(r: Report): string {
  if (r.budgets.length === 0) return '';
  const label: Record<string, string> = {
    on_track: 'On track',
    warning: 'Ahead of pace',
    over: 'Over budget',
    ended_under: 'Finished under',
    ended_over: 'Finished over',
  };
  const tint: Record<string, string> = {
    on_track: '#e9fbf3',
    warning: '#fff6e6',
    over: '#fdecec',
    ended_under: '#e9fbf3',
    ended_over: '#fdecec',
  };

  return `<div class="section">${heading('Budgets', SECTION.budget)}
  <table>
    <tr><th>Budget</th><th class="num">Spent</th><th class="num">Allocated</th><th class="num">Left</th><th>Status</th><th style="width:20%"></th></tr>
    ${r.budgets
      .map((b) => {
        const used = Math.min(1, b.utilisation ?? 0);
        const colour = b.state === 'over' || b.state === 'ended_over' ? BAD : b.state === 'warning' ? '#a8730a' : GOOD;
        return `<tr>
        <td>${esc(b.budget.name)}</td>
        <td class="num">${esc(formatMoney(b.spent, { compactDecimals: true }))}</td>
        <td class="num muted">${esc(formatMoney(b.effectiveAllocated, { compactDecimals: true }))}</td>
        <td class="num ${b.remaining.minor < 0 ? 'neg' : ''}">${esc(
          formatMoney(b.remaining, { compactDecimals: true })
        )}</td>
        <td><span class="pill" style="background:${tint[b.state] ?? '#f1f1f5'};color:${colour}">${esc(
          label[b.state] ?? b.state
        )}</span></td>
        <td><div class="bar"><i style="width:${Math.round(used * 100)}%;background:${colour}"></i></div></td>
      </tr>`;
      })
      .join('')}
  </table></div>`;
}

function merchantSection(r: Report): string {
  if (r.merchants.length === 0) return '';
  return `<div class="section">${heading('Top merchants', SECTION.merchant)}
  <table>
    <tr><th>Merchant</th><th class="num">Visits</th><th class="num">Average</th><th class="num">Total</th></tr>
    ${r.merchants
      .map(
        (m, i) => `<tr>
      <td><span class="dot" style="background:${SERIES[i % SERIES.length]}"></span><span class="name">${esc(
          m.merchant
        )}</span></td>
      <td class="num muted">${m.count}</td>
      <td class="num muted">${esc(
          formatMoney(
            { minor: Math.round(m.total.minor / Math.max(1, m.count)), currency: m.total.currency },
            { compactDecimals: true }
          )
        )}</td>
      <td class="num">${esc(formatMoney(m.total, { compactDecimals: true }))}</td>
    </tr>`
      )
      .join('')}
  </table></div>`;
}

function forecastSection(r: Report): string {
  if (r.forecast.length === 0) return '';
  return `<div class="section">${heading('What comes next', SECTION.forecast)}
  <table>
    <tr><th>Month</th><th class="num">Projected spend</th><th class="num">Range</th></tr>
    ${r.forecast
      .map(
        (p) => `<tr>
      <td>${esc(formatDate(p.date, 'medium'))}</td>
      <td class="num">${esc(formatMoney(p.value, { compactDecimals: true }))}</td>
      <td class="num muted">${esc(formatMoney(p.lower, { compactDecimals: true }))} – ${esc(
          formatMoney(p.upper, { compactDecimals: true })
        )}</td>
    </tr>`
      )
      .join('')}
  </table>
  <p class="muted" style="margin-top:6px">${esc(r.forecastNote)}</p></div>`;
}

function transactionSection(r: Report): string {
  if (r.transactions.length === 0) return '';
  // Cap the printed ledger. Beyond a couple of hundred rows a PDF stops being a
  // report and becomes a data dump — the CSV and Excel exports carry the lot.
  const CAP = 200;
  const rows = r.transactions.slice(0, CAP);

  return `<div class="pagebreak">${heading('Transactions', SECTION.transactions)}
  <table>
    <tr><th>Date</th><th>Merchant</th><th>Category</th><th class="num">Amount</th></tr>
    ${rows
      .map(
        (t) => `<tr>
      <td class="muted">${esc(formatDate(t.date, 'short'))}</td>
      <td>${esc(t.merchant)}</td>
      <td class="muted">${esc(t.categoryName ?? '—')}</td>
      <td class="num ${t.amountMinor >= 0 ? 'pos' : ''}">${esc(
          formatMoney({ minor: t.amountMinor, currency: t.currency }, { signed: t.amountMinor > 0 })
        )}</td>
    </tr>`
      )
      .join('')}
  </table>
  ${
    r.transactions.length > CAP
      ? `<p class="muted" style="margin-top:6px">Showing the ${CAP} most recent of ${r.transactions.length}. Export to CSV or Excel for the full ledger.</p>`
      : ''
  }</div>`;
}

// ------------------------------------------------------------------- helpers

function pct(value: number, of: number): number {
  if (of <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / of) * 100)));
}

/** Merchant names come from bank descriptors and receipts — untrusted text that
 *  must never be able to inject markup into the printed document. */
function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
