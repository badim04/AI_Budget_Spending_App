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

  const ocr = await tryRecognise(fileUri, 'image/jpeg');

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
    defaultCurrency: opts.defaultCurrency,
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
