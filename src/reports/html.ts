/**
 * Report → HTML, which `expo-print` turns into a PDF.
 *
 * Pure string building, no React and no filesystem, so the layout is testable
 * in plain Node. Everything is inline CSS and self-contained: the print engine
 * fetches nothing, so an external stylesheet or webfont would simply be missing
 * from the PDF.
 *
 * Printed on white regardless of the app theme — a dark-background PDF is
 * unreadable on paper and burns a cartridge.
 */

import { formatMoney } from '../core/money';
import { formatDate } from '../core/dates';
import type { Report } from './build';

const INK = '#0b0b0b';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';
const ACCENT = '#2f5fe0';
const GOOD = '#0f8f5a';
const BAD = '#c8383f';

/** Chart colours, printable on white. */
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#8a8880'];

export function reportToHtml(r: Report): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  @page { margin: 18mm 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: ${INK}; font-size: 11px; line-height: 1.45; margin: 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  h1 { font-size: 22px; margin: 0 0 2px; letter-spacing: -0.4px; }
  h2 { font-size: 13px; margin: 26px 0 8px; letter-spacing: -0.2px; }
  .sub { color: ${MUTED}; font-size: 11px; margin: 0; }
  .rule { height: 2px; background: ${ACCENT}; width: 42px; margin: 10px 0 0; border-radius: 2px; }

  .kpis { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
  .kpi { border: 1px solid ${LINE}; border-radius: 8px; padding: 9px 11px; min-width: 118px; flex: 1; }
  .kpi .l { color: ${MUTED}; font-size: 9px; text-transform: uppercase; letter-spacing: .5px; }
  .kpi .v { font-size: 16px; font-weight: 700; margin-top: 2px; letter-spacing: -0.3px; }
  .kpi .h { color: ${MUTED}; font-size: 9px; margin-top: 2px; }

  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; color: ${MUTED}; font-size: 9px; text-transform: uppercase;
       letter-spacing: .5px; border-bottom: 1px solid ${LINE}; padding: 6px 4px; font-weight: 600; }
  td { padding: 6px 4px; border-bottom: 1px solid #f3f4f6; vertical-align: middle; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .pos { color: ${GOOD}; } .neg { color: ${BAD}; }
  .muted { color: ${MUTED}; }

  .bar { height: 6px; background: #f0f1f4; border-radius: 3px; overflow: hidden; min-width: 60px; }
  .bar > i { display: block; height: 100%; border-radius: 3px; }

  /* Tables must not split a row across pages. */
  tr { page-break-inside: avoid; }
  .section { page-break-inside: avoid; }
  .pagebreak { page-break-before: always; }
  .foot { margin-top: 22px; padding-top: 8px; border-top: 1px solid ${LINE};
          color: ${MUTED}; font-size: 9px; }
</style></head><body>

<h1>${esc(r.title)}</h1>
<p class="sub">${esc(r.subtitle)} · ${esc(formatDate(r.range.start, 'medium'))} – ${esc(
    formatDate(r.range.end, 'medium')
  )} · ${esc(r.currency)}</p>
<div class="rule"></div>

<div class="kpis">
  ${r.kpis
    .map(
      (k) => `<div class="kpi">
        <div class="l">${esc(k.label)}</div>
        <div class="v">${esc(k.value)}</div>
        ${k.hint ? `<div class="h">${esc(k.hint)}</div>` : ''}
      </div>`
    )
    .join('')}
</div>

${monthlySection(r)}
${categorySection(r)}
${budgetSection(r)}
${merchantSection(r)}
${forecastSection(r)}
${transactionSection(r)}

<div class="foot">
  Generated ${esc(new Date(r.generatedAt).toUTCString())} by Finlo.
  Figures are converted into ${esc(r.currency)} using the exchange rates stored on the device.
</div>
</body></html>`;
}

// ------------------------------------------------------------------ sections

function monthlySection(r: Report): string {
  if (r.monthly.length === 0) return '';
  const peak = Math.max(...r.monthly.map((m) => Math.max(m.spend.minor, m.income.minor)), 1);

  return `<div class="section"><h2>Month by month</h2>
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
        )}%;background:${SERIES[1]}"></i></div>
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

  return `<div class="section"><h2>Where it went</h2>
  <table>
    <tr><th>Category</th><th class="num">Amount</th><th class="num">Share</th><th class="num">vs previous</th><th style="width:26%"></th></tr>
    ${top
      .map(
        (row, i) => `<tr>
      <td>${esc(row.categoryName)}</td>
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

  return `<div class="section"><h2>Budgets</h2>
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
        <td style="color:${colour}">${esc(label[b.state] ?? b.state)}</td>
        <td><div class="bar"><i style="width:${Math.round(used * 100)}%;background:${colour}"></i></div></td>
      </tr>`;
      })
      .join('')}
  </table></div>`;
}

function merchantSection(r: Report): string {
  if (r.merchants.length === 0) return '';
  return `<div class="section"><h2>Top merchants</h2>
  <table>
    <tr><th>Merchant</th><th class="num">Visits</th><th class="num">Average</th><th class="num">Total</th></tr>
    ${r.merchants
      .map(
        (m) => `<tr>
      <td>${esc(m.merchant)}</td>
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
  return `<div class="section"><h2>What comes next</h2>
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
  <p class="sub" style="margin-top:6px">${esc(r.forecastNote)}</p></div>`;
}

function transactionSection(r: Report): string {
  if (r.transactions.length === 0) return '';
  // Cap the printed ledger. Beyond a couple of hundred rows a PDF stops being a
  // report and becomes a data dump — the CSV and Excel exports carry the lot.
  const CAP = 200;
  const rows = r.transactions.slice(0, CAP);

  return `<div class="pagebreak"><h2>Transactions</h2>
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
      ? `<p class="sub" style="margin-top:6px">Showing the ${CAP} most recent of ${r.transactions.length}. Export to CSV or Excel for the full ledger.</p>`
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
