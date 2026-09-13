/**
 * Receipt capture: camera or library → stored file → OCR → parsed draft.
 *
 * Downscaling before anything else is not an optimisation, it is the thing that
 * makes the feature usable. A modern phone photo is 4-8MB; OCR providers charge
 * and throttle by size, uploads over mobile data are slow, and the text on a
 * receipt is legible well below 1600px. Everything downstream gets the small one.
 *
 * The image is stored before OCR is attempted, so a failed or unconfigured OCR
 * still leaves the user with a filed, searchable receipt.
 */

import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { parseReceipt, type ParsedReceipt } from './parse';
import { tryRecognise } from './ocr';
import { nowISO, today } from '../../core/dates';
import type { CurrencyCode } from '../../core/money';
import type { Receipt } from '../../core/types';

/** Long edge in pixels after downscaling. Receipt text stays legible here. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.7;
const RECEIPT_DIR = `${FileSystem.documentDirectory ?? ''}receipts/`;

export type CaptureSource = 'camera' | 'library';

export interface CaptureOutcome {
  receipt: Receipt;
  parsed: ParsedReceipt | null;
  /** Present when OCR did not run or did not work — shown to the user verbatim. */
  ocrNote: string | null;
}

export class PermissionDeniedError extends Error {
  constructor(what: string) {
    super(`${what} permission was declined`);
    this.name = 'PermissionDeniedError';
  }
}

export class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}

// ------------------------------------------------------------------ picking

/**
 * Pick one or many images.
 *
 * `limit` above 1 turns on multi-select in the OS picker. The camera can only
 * produce one shot per launch, so a batch from the camera is the caller looping
 * — which is also the better interaction: shoot, confirm, shoot again.
 */
export async function pickImages(
  source: CaptureSource,
  limit: number
): Promise<ImagePicker.ImagePickerAsset[]> {
  if (source === 'camera' || limit <= 1) return [await pickImage(source)];

  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new PermissionDeniedError('Photo library');

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    exif: false,
    allowsMultipleSelection: true,
    selectionLimit: limit,
    orderedSelection: true,
  });
  if (result.canceled || !result.assets?.length) throw new CancelledError();
  return result.assets;
}

async function pickImage(source: CaptureSource): Promise<ImagePicker.ImagePickerAsset> {
  if (source === 'camera') {
    // Web has no camera through this API; the file picker is the correct
    // fallback and on a phone browser it still offers "Take Photo".
    if (Platform.OS === 'web') return pickImage('library');

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new PermissionDeniedError('Camera');

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 1,
      exif: false,
    });
    if (result.canceled || !result.assets?.[0]) throw new CancelledError();
    return result.assets[0];
  }

  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new PermissionDeniedError('Photo library');

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    exif: false,
    allowsMultipleSelection: false,
  });
  if (result.canceled || !result.assets?.[0]) throw new CancelledError();
  return result.assets[0];
}

// ------------------------------------------------------------------ storing

async function downscale(uri: string, maxEdge: number, quality: number) {
  return ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: maxEdge } }],
    { compress: quality, format: ImageManipulator.SaveFormat.JPEG, base64: Platform.OS === 'web' }
  );
}

/**
 * Persist the image and return a uri the app can read back later.
 *
 * Native: a real file under documentDirectory, which survives restarts and is
 * excluded from cloud backup only if the user's OS says so.
 *
 * Web: a data URL. The browser has no writable filesystem, and a blob: URL is
 * revoked when the tab closes — a receipt that vanishes on reload is worse than
 * a slightly heavy string.
 */
async function storeImage(
  uri: string,
  base64: string | undefined,
  id: string
): Promise<{ fileUri: string; byteSize: number }> {
  if (Platform.OS === 'web') {
    const dataUrl = base64 ? `data:image/jpeg;base64,${base64}` : uri;
    // base64 is 4 chars per 3 bytes.
    return { fileUri: dataUrl, byteSize: Math.round((base64?.length ?? 0) * 0.75) };
  }

  const dir = await FileSystem.getInfoAsync(RECEIPT_DIR);
  if (!dir.exists) {
    await FileSystem.makeDirectoryAsync(RECEIPT_DIR, { intermediates: true });
  }
  const target = `${RECEIPT_DIR}${id}.jpg`;
  await FileSystem.copyAsync({ from: uri, to: target });
  const info = await FileSystem.getInfoAsync(target);
  return { fileUri: target, byteSize: info.exists ? (info.size ?? 0) : 0 };
}

export async function deleteReceiptFile(fileUri: string): Promise<void> {
  if (Platform.OS === 'web' || !fileUri.startsWith('file://')) return;
  try {
    await FileSystem.deleteAsync(fileUri, { idempotent: true });
  } catch {
    // A missing file is the desired end state anyway.
  }
}

// ------------------------------------------------------------------- flow

export async function captureReceipt(
  source: CaptureSource,
  opts: { defaultCurrency: CurrencyCode; id: string }
): Promise<CaptureOutcome> {
  const asset = await pickImage(source);
  return processAsset(asset, opts);
}

/**
 * Store, read and parse one already-picked image.
 *
 * Split out so a batch does not re-open the picker per receipt, and so a single
 * failure inside a batch is contained to that one receipt.
 */
export async function processAsset(
  asset: { uri: string },
  opts: { defaultCurrency: CurrencyCode; id: string }
): Promise<CaptureOutcome> {
  const small = await downscale(asset.uri, MAX_EDGE, JPEG_QUALITY);
  const { fileUri, byteSize } = await storeImage(small.uri, small.base64, opts.id);
  const stamp = nowISO();

  const receipt: Receipt = {
    id: opts.id,
    fileUri,
    mimeType: 'image/jpeg',
    byteSize,
    status: 'ocr_pending',
    capturedAt: stamp,
    createdAt: stamp,
    updatedAt: stamp,
  };

  return ocrAndParse(receipt, opts.defaultCurrency);
}

/**
 * Read a stored receipt (image or PDF) and turn it into a draft.
 *
 * Split out from `processAsset` so the image path and the PDF path share one
 * copy of "OCR, then parse, and if OCR is off or fails keep the file anyway".
 * That fallback is the whole reason capture is worth having without a key: a
 * receipt with no reading is still filed and searchable, and the user types one
 * number instead of five.
 */
async function ocrAndParse(receipt: Receipt, defaultCurrency: CurrencyCode): Promise<CaptureOutcome> {
  const ocr = await tryRecognise(receipt.fileUri, receipt.mimeType);

  if (!ocr.ok) {
    return {
      receipt: {
        ...receipt,
        status: 'uploaded',
        error: ocr.reason === 'no_provider' ? undefined : ocr.reason,
      },
      parsed: null,
      ocrNote:
        ocr.reason === 'no_provider'
          ? 'Receipt saved. Add an OCR key in Settings to read it automatically — for now, enter the amount.'
          : `Receipt saved, but reading it failed: ${ocr.reason}`,
    };
  }

  const parsed = parseReceipt(ocr.result.text, {
    defaultCurrency,
    today: today(),
  });

  return {
    receipt: {
      ...receipt,
      status: parsed.total ? 'parsed' : 'ocr_done',
      ocrText: ocr.result.text,
      ocrConfidence: ocr.result.confidence,
      merchant: parsed.merchant ?? undefined,
      date: parsed.date ?? undefined,
      totalMinor: parsed.total?.minor,
      taxMinor: parsed.tax?.minor,
      tipMinor: parsed.tip?.minor,
      currency: parsed.currency,
      lineItems: parsed.lineItems.length ? parsed.lineItems : undefined,
      updatedAt: nowISO(),
    },
    parsed,
    ocrNote: parsed.warnings.length ? parsed.warnings.join(' · ') : null,
  };
}

// --------------------------------------------------------------- PDF receipts

/** A picked PDF: uri plus what the OS told us about it. */
export interface PickedDocument {
  uri: string;
  name?: string;
  mimeType?: string;
}

/**
 * Pick one or many PDFs.
 *
 * Reuses `expo-document-picker` — already in the app for statement import, so
 * this ships over the air with no new native module. Restricted to PDFs: an
 * emailed invoice or a fintech receipt is a PDF, and letting images in here
 * would just duplicate the photo path with worse ergonomics.
 */
export async function pickDocuments(limit: number): Promise<PickedDocument[]> {
  const res = await DocumentPicker.getDocumentAsync({
    type: 'application/pdf',
    multiple: limit > 1,
    copyToCacheDirectory: true,
  });
  if (res.canceled || !res.assets?.length) throw new CancelledError();
  return res.assets.slice(0, limit).map((a) => ({
    uri: a.uri,
    name: a.name,
    mimeType: a.mimeType ?? 'application/pdf',
  }));
}

/**
 * Persist a picked PDF as-is (no downscale — it is not an image).
 *
 * Native: a real file under the receipts directory. Web: a data URL, so it
 * survives a reload the way the image path's data URL does; a blob: URL would
 * be revoked when the tab closes.
 */
async function storePdf(uri: string, id: string): Promise<{ fileUri: string; byteSize: number }> {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    return { fileUri: dataUrl, byteSize: blob.size };
  }

  const dir = await FileSystem.getInfoAsync(RECEIPT_DIR);
  if (!dir.exists) {
    await FileSystem.makeDirectoryAsync(RECEIPT_DIR, { intermediates: true });
  }
  const target = `${RECEIPT_DIR}${id}.pdf`;
  await FileSystem.copyAsync({ from: uri, to: target });
  const info = await FileSystem.getInfoAsync(target);
  return { fileUri: target, byteSize: info.exists ? (info.size ?? 0) : 0 };
}

/** Store and read one already-picked PDF. */
export async function processDocument(
  doc: PickedDocument,
  opts: { defaultCurrency: CurrencyCode; id: string }
): Promise<CaptureOutcome> {
  const { fileUri, byteSize } = await storePdf(doc.uri, opts.id);
  const stamp = nowISO();

  const receipt: Receipt = {
    id: opts.id,
    fileUri,
    mimeType: 'application/pdf',
    byteSize,
    status: 'ocr_pending',
    capturedAt: stamp,
    createdAt: stamp,
    updatedAt: stamp,
  };

  return ocrAndParse(receipt, opts.defaultCurrency);
}

/**
 * Pick and process up to `limit` PDF receipts in one go.
 *
 * Same shape and the same one-at-a-time discipline as `captureReceipts`: OCR
 * providers rate-limit, and a failure on one PDF must not lose the others.
 */
export async function captureDocuments(opts: {
  defaultCurrency: CurrencyCode;
  limit?: number;
  idFor: (index: number) => string;
  onProgress?: (p: BatchProgress) => void;
}): Promise<BatchResult> {
  const docs = await pickDocuments(opts.limit ?? 10);
  const outcomes: CaptureOutcome[] = [];
  const failures: Array<{ index: number; reason: string }> = [];

  opts.onProgress?.({ done: 0, total: docs.length, last: null });

  for (let i = 0; i < docs.length; i++) {
    try {
      const outcome = await processDocument(docs[i], {
        defaultCurrency: opts.defaultCurrency,
        id: opts.idFor(i),
      });
      outcomes.push(outcome);
      opts.onProgress?.({ done: i + 1, total: docs.length, last: outcome });
    } catch (e) {
      failures.push({ index: i, reason: e instanceof Error ? e.message : String(e) });
      opts.onProgress?.({ done: i + 1, total: docs.length, last: null });
    }
  }

  return { outcomes, failures };
}


// ------------------------------------------------------------------- batch

export interface BatchProgress {
  done: number;
  total: number;
  /** The receipt just finished, or null while the first one is still running. */
  last: CaptureOutcome | null;
}

export interface BatchResult {
  outcomes: CaptureOutcome[];
  /** One entry per image that could not be processed at all. */
  failures: Array<{ index: number; reason: string }>;
}

/**
 * Capture several receipts in one go.
 *
 * Processed strictly one at a time rather than with Promise.all: each image is
 * downscaled and then sent to an OCR service, and firing twenty of those
 * concurrently is how you hit a rate limit and lose the whole batch. Sequential
 * is slower and finishes.
 *
 * A failure never aborts the run — the other receipts are still worth having,
 * and the failures come back for the caller to report.
 */
export async function captureReceipts(
  source: CaptureSource,
  opts: {
    defaultCurrency: CurrencyCode;
    limit?: number;
    idFor: (index: number) => string;
    onProgress?: (p: BatchProgress) => void;
  }
): Promise<BatchResult> {
  const assets = await pickImages(source, opts.limit ?? 20);
  const outcomes: CaptureOutcome[] = [];
  const failures: Array<{ index: number; reason: string }> = [];

  opts.onProgress?.({ done: 0, total: assets.length, last: null });

  for (let i = 0; i < assets.length; i++) {
    try {
      const outcome = await processAsset(assets[i], {
        defaultCurrency: opts.defaultCurrency,
        id: opts.idFor(i),
      });
      outcomes.push(outcome);
      opts.onProgress?.({ done: i + 1, total: assets.length, last: outcome });
    } catch (e) {
      failures.push({ index: i, reason: e instanceof Error ? e.message : String(e) });
      opts.onProgress?.({ done: i + 1, total: assets.length, last: null });
    }
  }

  return { outcomes, failures };
}
