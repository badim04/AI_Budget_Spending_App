/**
 * Where the real bank statements live.
 *
 * Two of these tests are the strongest in the repo: the same OPay account and
 * period, exported as both a PDF and an XLSX, must produce the same
 * transactions to the kobo and match the totals the bank printed in the file.
 *
 * They were pointed at one hardcoded path in Downloads. The files then moved
 * into a WhatsApp folder, `existsSync` went false, `describe.skipIf` did its
 * job, and the suite went green while the checks that actually prove the PDF
 * reader works were not running at all. A test that disappears quietly is
 * worse than no test, because it still reads as a pass.
 *
 * So: search the known locations, and give callers a way to say out loud that
 * the fixture is missing rather than skipping in silence.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DOWNLOADS = 'C:/Users/user/Downloads';

/** Search Downloads and one level of its subfolders. */
function findByName(filename: string): string | null {
  const direct = join(DOWNLOADS, filename);
  if (existsSync(direct)) return direct;

  let entries: string[];
  try {
    entries = readdirSync(DOWNLOADS);
  } catch {
    return null;
  }

  for (const entry of entries) {
    const folder = join(DOWNLOADS, entry);
    try {
      if (!statSync(folder).isDirectory()) continue;
    } catch {
      continue;
    }
    const candidate = join(folder, filename);
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

const PDF_NAME = 'ABDULAKEEM OLADIMEJI ADEBAYO_8102579422_20260825195637.pdf';
const XLSX_NAME = 'ABDULAKEEM OLADIMEJI ADEBAYO_8102579422_20260825200613.xlsx';

export const STATEMENT_PDF = findByName(PDF_NAME);
export const STATEMENT_XLSX = findByName(XLSX_NAME);

/** True when both real exports are available to compare against each other. */
export const HAS_STATEMENTS = STATEMENT_PDF != null && STATEMENT_XLSX != null;

/** Printed once when they are missing, so a skip is never silent. */
export function describeMissingFixtures(): string {
  return [
    'Real statement fixtures not found. The cross-format checks did NOT run.',
    `  looked for: ${PDF_NAME}`,
    `              ${XLSX_NAME}`,
    `  under:      ${DOWNLOADS} and its immediate subfolders`,
  ].join('\n');
}
