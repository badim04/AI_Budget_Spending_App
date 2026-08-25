/**
 * Writing a report to a file and handing it to the user.
 *
 * This is the only file in `src/reports` that touches the device. The rest is
 * pure, which is why the numbers can be tested without an emulator.
 *
 * On native the file is written into the app's cache directory and then passed
 * to the system share sheet, which is how a user gets it into WhatsApp, Drive,
 * email or Files. On web it becomes a download.
 */

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';
import { reportToHtml } from './html';
import { reportFilename, reportToCsv, reportToSheets } from './tabular';
import type { Report } from './build';

export type ExportFormat = 'pdf' | 'csv' | 'xlsx';

export interface ExportResult {
  uri: string;
  filename: string;
  format: ExportFormat;
  /** False when the file was written but the OS had nowhere to send it. */
  shared: boolean;
}

export const FORMAT_LABEL: Record<ExportFormat, string> = {
  pdf: 'PDF',
  csv: 'CSV',
  xlsx: 'Excel',
};

export const FORMAT_HINT: Record<ExportFormat, string> = {
  pdf: 'Formatted report with charts and tables — best for sharing or printing',
  csv: 'Every transaction as plain text — opens anywhere',
  xlsx: 'Seven sheets: transactions, summary, categories, monthly, budgets, merchants, forecast',
};

const MIME: Record<ExportFormat, string> = {
  pdf: 'application/pdf',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * Build the file and offer it to the user.
 *
 * Throws with a readable message on failure — the caller shows it. Silently
 * returning nothing would leave someone tapping Export and wondering.
 */
export async function exportReport(
  report: Report,
  format: ExportFormat
): Promise<ExportResult> {
  const filename = reportFilename(report, format);

  if (Platform.OS === 'web') {
    return exportOnWeb(report, format, filename);
  }

  const uri =
    format === 'pdf'
      ? await writePdf(report, filename)
      : format === 'csv'
        ? await writeText(reportToCsv(report, true), filename)
        : await writeXlsx(report, filename);

  const shared = await share(uri, format, report);
  return { uri, filename, format, shared };
}

// ------------------------------------------------------------------- native

async function writePdf(report: Report, filename: string): Promise<string> {
  const { uri } = await Print.printToFileAsync({
    html: reportToHtml(report),
    base64: false,
  });

  // printToFileAsync names the file with a random UUID, which is meaningless in
  // a share sheet or a Downloads folder. Rename it to something a human can
  // recognise six months later.
  const target = `${cacheDir()}${filename}`;
  try {
    await FileSystem.moveAsync({ from: uri, to: target });
    return target;
  } catch {
    // A failed rename is cosmetic; the PDF itself is fine.
    return uri;
  }
}

async function writeText(contents: string, filename: string): Promise<string> {
  const uri = `${cacheDir()}${filename}`;
  // A BOM makes Excel open UTF-8 CSV with the right encoding instead of
  // mangling every ₦ and accented merchant name.
  await FileSystem.writeAsStringAsync(uri, `﻿${contents}`, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  return uri;
}

async function writeXlsx(report: Report, filename: string): Promise<string> {
  const book = buildWorkbook(report);
  const base64 = XLSX.write(book, { type: 'base64', bookType: 'xlsx' });
  const uri = `${cacheDir()}${filename}`;
  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return uri;
}

/** Shared by native and web so both produce an identical workbook. */
export function buildWorkbook(report: Report): XLSX.WorkBook {
  const book = XLSX.utils.book_new();
  for (const sheet of reportToSheets(report)) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
    // Excel caps sheet names at 31 characters and rejects several symbols.
    XLSX.utils.book_append_sheet(book, ws, sheet.name.slice(0, 31));
  }
  return book;
}

async function share(uri: string, format: ExportFormat, report: Report): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(uri, {
    mimeType: MIME[format],
    dialogTitle: `${report.title} — ${report.subtitle}`,
    UTI: format === 'pdf' ? 'com.adobe.pdf' : undefined,
  });
  return true;
}

function cacheDir(): string {
  const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
  return dir.endsWith('/') ? dir : `${dir}/`;
}

// ---------------------------------------------------------------------- web

/**
 * Browser download.
 *
 * PDF goes through the print dialog because `expo-print`'s file output is a
 * native capability; on web the browser's own "Save as PDF" is the equivalent
 * and is what users expect from a web app anyway.
 */
async function exportOnWeb(
  report: Report,
  format: ExportFormat,
  filename: string
): Promise<ExportResult> {
  if (format === 'pdf') {
    await Print.printAsync({ html: reportToHtml(report) });
    return { uri: '', filename, format, shared: true };
  }

  const blob =
    format === 'csv'
      ? new Blob([`﻿${reportToCsv(report, true)}`], { type: MIME.csv })
      : new Blob([XLSX.write(buildWorkbook(report), { type: 'array', bookType: 'xlsx' })], {
          type: MIME.xlsx,
        });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);

  return { uri: url, filename, format, shared: true };
}
