/**
 * OCR.
 *
 * There is no free on-device OCR in Expo Go — ML Kit and Vision both need a
 * development build. Rather than pretend otherwise, this module is a provider
 * interface with a deliberate ordering:
 *
 *   1. a configured cloud provider, if the user supplied a key
 *   2. nothing — and the capture flow still completes
 *
 * Case 2 is the important one. A receipt with no OCR is still worth capturing:
 * the image is stored, indexed and attached to the transaction, and the user
 * types one number instead of five fields. Treating "no OCR" as a failure would
 * make the whole feature unavailable to anyone without an API key.
 */

import { Platform } from 'react-native';

export interface OcrResult {
  text: string;
  /** 0..1, provider-reported where available. */
  confidence: number;
  provider: string;
}

export interface OcrProvider {
  readonly name: string;
  readonly available: boolean;
  /** Why it is unavailable, shown in Settings. */
  readonly reason?: string;
  recognise(imageUri: string, mimeType: string): Promise<OcrResult>;
}

const OCR_API_KEY = process.env.EXPO_PUBLIC_OCR_API_KEY ?? '';
const OCR_API_URL = process.env.EXPO_PUBLIC_OCR_API_URL ?? 'https://api.ocr.space/parse/image';

/**
 * OCR.space — chosen because it has a genuine free tier, accepts a plain
 * multipart POST (no SDK, no signing), and works identically from the browser
 * and from a phone.
 *
 * `isOverlayRequired=false` keeps the response small; `OCREngine=2` handles
 * receipt fonts noticeably better than the default engine.
 */
class CloudOcrProvider implements OcrProvider {
  readonly name = 'OCR.space';
  get available() {
    return OCR_API_KEY.length > 0;
  }
  get reason() {
    return this.available ? undefined : 'No EXPO_PUBLIC_OCR_API_KEY set in .env';
  }

  async recognise(imageUri: string, mimeType: string): Promise<OcrResult> {
    if (!this.available) throw new Error('OCR provider is not configured');

    const form = new FormData();
    form.append('apikey', OCR_API_KEY);
    form.append('isOverlayRequired', 'false');
    form.append('OCREngine', '2');
    form.append('scale', 'true');

    if (Platform.OS === 'web') {
      // On web the uri is a blob: or data: URL, which fetch can turn into a Blob.
      const blob = await (await fetch(imageUri)).blob();
      form.append('file', blob, 'receipt.jpg');
    } else {
      // React Native's FormData takes this shape for a local file uri.
      form.append('file', {
        uri: imageUri,
        name: 'receipt.jpg',
        type: mimeType || 'image/jpeg',
      } as unknown as Blob);
    }

    const response = await fetch(OCR_API_URL, { method: 'POST', body: form });
    if (!response.ok) {
      throw new Error(`OCR request failed (${response.status})`);
    }
    const body = await response.json();
    if (body.IsErroredOnProcessing) {
      const message = Array.isArray(body.ErrorMessage)
        ? body.ErrorMessage.join('; ')
        : String(body.ErrorMessage ?? 'Unknown OCR error');
      throw new Error(message);
    }

    const parsed = body.ParsedResults?.[0];
    const text: string = parsed?.ParsedText ?? '';
    if (!text.trim()) throw new Error('OCR returned no text — try a sharper photo');

    return {
      text,
      // The API reports an exit code rather than a score; 1 means clean.
      confidence: parsed?.FileParseExitCode === 1 ? 0.85 : 0.5,
      provider: this.name,
    };
  }
}

/** The always-available no-op. Signals "capture succeeded, extraction didn't". */
class NoOcrProvider implements OcrProvider {
  readonly name = 'none';
  readonly available = true;
  readonly reason = 'No OCR configured — receipts are stored, amounts are typed';
  async recognise(): Promise<OcrResult> {
    throw new OcrUnavailableError();
  }
}

export class OcrUnavailableError extends Error {
  constructor() {
    super('No OCR provider configured');
    this.name = 'OcrUnavailableError';
  }
}

const cloud = new CloudOcrProvider();
const none = new NoOcrProvider();

export function activeOcrProvider(): OcrProvider {
  return cloud.available ? cloud : none;
}

export function ocrStatus(): { configured: boolean; name: string; reason?: string } {
  const p = activeOcrProvider();
  return { configured: cloud.available, name: p.name, reason: p.reason };
}

/**
 * Run OCR, never throwing.
 *
 * Callers are always in the middle of a capture flow the user started, so a
 * provider error must degrade to manual entry rather than unwind the screen.
 */
export async function tryRecognise(
  imageUri: string,
  mimeType = 'image/jpeg'
): Promise<{ ok: true; result: OcrResult } | { ok: false; reason: string }> {
  const provider = activeOcrProvider();
  try {
    const result = await provider.recognise(imageUri, mimeType);
    return { ok: true, result };
  } catch (e) {
    if (e instanceof OcrUnavailableError) {
      return { ok: false, reason: 'no_provider' };
    }
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
