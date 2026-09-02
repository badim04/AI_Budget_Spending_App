/**
 * Guards against APIs that exist in Node and browsers but not on device.
 *
 * The bug this was written for: `new TextDecoder('latin1')` at module scope in
 * the PDF reader. Node has a complete TextDecoder, so all 347 tests passed.
 * Chrome has one, so `npm run web` was fine. Metro bundles it without comment,
 * so the build was green. But React Native has no TextDecoder at all, and the
 * polyfill Expo installs supports UTF-8 and nothing else — any other label
 * throws `RangeError: Unknown encoding`.
 *
 * Thrown at module scope, that killed the process the moment expo-router
 * required the import screen: tapping "Import a bank statement" closed the app
 * with no error, no red screen, nothing. Only `adb logcat` showed it.
 *
 * Every check here is a real failure that shipped, not a hypothetical.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  decodeLatin1,
  encodeLatin1,
  decodeText,
  decodeUtf8,
  decodeUtf16,
} from '../src/ingest/bytes';

const ROOT = join(__dirname, '..');

/** Comments talk *about* these APIs; only real code matters. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const SHIPPED = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'app'))];

describe('APIs the device does not have', () => {
  it('finds the files it is meant to be checking', () => {
    expect(SHIPPED.length).toBeGreaterThan(20);
  });

  it('never constructs a TextDecoder', () => {
    const offenders = SHIPPED.filter((f) => /new TextDecoder\s*\(/.test(stripComments(readFileSync(f, 'utf8'))))
      .map((f) => relative(ROOT, f));

    expect(
      offenders,
      `${offenders.join(', ')} constructs a TextDecoder. React Native does not ` +
        `have one, and Expo's polyfill decodes UTF-8 only. Use the decoders in ` +
        `src/ingest/bytes.ts instead.`
    ).toEqual([]);
  });

  it('never uses Buffer or Node globals in shipped code', () => {
    const offenders = SHIPPED.filter((f) => /\bnew Buffer\b|\bBuffer\.from\b/.test(stripComments(readFileSync(f, 'utf8'))))
      .map((f) => relative(ROOT, f));

    expect(offenders, `${offenders.join(', ')} uses Buffer, which Hermes does not have.`).toEqual([]);
  });
});

describe('decodeLatin1', () => {
  it('maps every byte to the code point of the same value', () => {
    const all = new Uint8Array(256).map((_, i) => i);
    const text = decodeLatin1(all);
    expect(text.length).toBe(256);
    for (let i = 0; i < 256; i++) expect(text.charCodeAt(i)).toBe(i);
  });

  it('round-trips through encodeLatin1', () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff, 0x00, 0x80]);
    expect(Array.from(encodeLatin1(decodeLatin1(bytes)))).toEqual(Array.from(bytes));
  });

  it('handles a payload larger than the chunk size without overflowing the stack', () => {
    // A real PDF content stream is comfortably past this.
    const big = new Uint8Array(500_000).map((_, i) => i % 256);
    expect(decodeLatin1(big).length).toBe(500_000);
  });

  it('agrees with Node on a PDF header', () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    expect(decodeLatin1(bytes)).toBe('%PDF-1.4');
  });
});

describe('decodeUtf8', () => {
  const cases = ['', 'plain ascii', 'Naira ₦1,500.00', 'café — dash', '🎉 emoji 🎉', 'ẹ̀kọ́'];

  it.each(cases)('matches Node TextDecoder for %j', (text) => {
    const bytes = new TextEncoder().encode(text);
    expect(decodeUtf8(bytes)).toBe(text);
  });

  it('replaces a malformed byte instead of throwing', () => {
    // One bad byte in the middle of an otherwise fine statement line.
    const bytes = new Uint8Array([0x41, 0xff, 0x42]);
    expect(decodeUtf8(bytes)).toBe('A�B');
  });

  it('replaces a truncated multi-byte sequence at end of file', () => {
    const bytes = new Uint8Array([0x41, 0xe2, 0x82]); // ₦ cut short
    expect(decodeUtf8(bytes)).toBe('A�');
  });
});

describe('decodeUtf16', () => {
  it('reads little-endian, as Windows exports it', () => {
    const bytes = new Uint8Array([0x41, 0x00, 0x42, 0x00, 0xa6, 0x20]); // AB₦
    expect(decodeUtf16(bytes, true)).toBe('AB₦');
  });

  it('reads big-endian', () => {
    const bytes = new Uint8Array([0x00, 0x41, 0x00, 0x42, 0x20, 0xa6]);
    expect(decodeUtf16(bytes, false)).toBe('AB₦');
  });
});

describe('decodeText', () => {
  it('strips a UTF-8 BOM so the first header cell is still recognised', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Date,Amount')]);
    expect(decodeText(bytes)).toBe('Date,Amount');
  });

  it('detects UTF-16LE from its BOM and strips it', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x44, 0x00, 0x61, 0x00, 0x74, 0x00, 0x65, 0x00]);
    expect(decodeText(bytes)).toBe('Date');
  });

  it('detects UTF-16BE from its BOM and strips it', () => {
    const bytes = new Uint8Array([0xfe, 0xff, 0x00, 0x44, 0x00, 0x61, 0x00, 0x74, 0x00, 0x65]);
    expect(decodeText(bytes)).toBe('Date');
  });

  it('assumes UTF-8 when there is no BOM', () => {
    expect(decodeText(new TextEncoder().encode('Date,₦'))).toBe('Date,₦');
  });
});

/**
 * The real test: run the statement reader in an environment shaped like the
 * phone's, where TextDecoder exists but only speaks UTF-8.
 *
 * A static scan can only catch the spelling it knows. This catches the whole
 * class — anything on the import path that reaches for an encoding React
 * Native cannot provide fails here, in two seconds, instead of on a device
 * after a fifteen-minute build.
 */
/**
 * These three each call `vi.resetModules()` and then cold-import the whole
 * ingest chain — which pulls in SheetJS — so the module graph is transformed
 * from scratch every time. That is the point: module-scope code has to run
 * under the restricted decoder, and a cached module would not re-run it.
 *
 * It also makes them the slowest tests in the suite, and the 5s default was
 * marginal enough to fail whenever the machine was busy with a build. The
 * timeout is stated explicitly rather than left to chance: what is being
 * checked is that the module *works* under Expo's decoder, never that it loads
 * quickly, so a slow machine failing this test tells nobody anything true.
 */
const COLD_IMPORT_TIMEOUT = 20_000;

describe("with Expo's UTF-8-only TextDecoder", () => {
  const real = globalThis.TextDecoder;

  /** Behaves exactly like `expo/src/winter/TextDecoder`. */
  class Utf8OnlyTextDecoder {
    constructor(label: string = 'utf-8') {
      const normalised = String(label).trim().toLowerCase();
      if (!['utf-8', 'utf8', 'unicode-1-1-utf-8'].includes(normalised)) {
        throw new RangeError(`Unknown encoding: ${label} (normalized: ${normalised})`);
      }
    }
    decode(input?: ArrayBuffer | ArrayBufferView): string {
      return new real(
        'utf-8'
      ).decode(input as ArrayBuffer);
    }
  }

  afterEach(() => {
    globalThis.TextDecoder = real;
    vi.resetModules();
  });

  it('loads the import path and reads a CSV', async () => {
    globalThis.TextDecoder = Utf8OnlyTextDecoder as unknown as typeof TextDecoder;
    vi.resetModules();

    // A fresh import, so module-scope code runs under the restricted decoder.
    const { readStatement } = await import('../src/ingest/statement/sources');
    const csv = ['Date,Description,Amount', '2026-06-30,OPay transfer,-5000.00', ''].join('\n');
    const source = readStatement(new TextEncoder().encode(csv), 'statement.csv');

    expect(source.format).toBe('csv');
    expect(source.rows.length).toBe(2);
  }, COLD_IMPORT_TIMEOUT);

  it('loads the PDF reader, which is where the crash was', async () => {
    globalThis.TextDecoder = Utf8OnlyTextDecoder as unknown as typeof TextDecoder;
    vi.resetModules();

    const { extractPdfText, isPdf } = await import('../src/ingest/pdf/extract');

    expect(isPdf(new TextEncoder().encode('%PDF-1.4'))).toBe(true);
    // Not a real PDF; the point is that it reports a problem instead of dying.
    const result = extractPdfText(new TextEncoder().encode('%PDF-1.4\nnot really\n'));
    expect(result.lines).toEqual([]);
    expect(result.warning).toBeTruthy();
  }, COLD_IMPORT_TIMEOUT);

  it('reads a UTF-16 statement, which TextDecoder could not have', async () => {
    globalThis.TextDecoder = Utf8OnlyTextDecoder as unknown as typeof TextDecoder;
    vi.resetModules();

    const { readStatement } = await import('../src/ingest/statement/sources');
    const csv = ['Date,Amount', '2026-06-30,-5000.00', ''].join('\n');
    const utf16 = new Uint8Array(2 + csv.length * 2);
    utf16[0] = 0xff;
    utf16[1] = 0xfe;
    for (let i = 0; i < csv.length; i++) {
      utf16[2 + i * 2] = csv.charCodeAt(i) & 0xff;
      utf16[3 + i * 2] = csv.charCodeAt(i) >> 8;
    }

    const source = readStatement(utf16, 'statement.csv');
    expect(source.rows[0]).toEqual(['Date', 'Amount']);
  }, COLD_IMPORT_TIMEOUT);
});
