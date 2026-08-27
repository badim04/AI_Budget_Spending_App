/**
 * Bytes -> text, without TextDecoder.
 *
 * Node and browsers ship a complete TextDecoder. React Native does not, and
 * the polyfill Expo installs in its place supports UTF-8 and nothing else:
 * every other label throws `RangeError: Unknown encoding`. A module-scope
 * `new TextDecoder('latin1')` therefore killed the app the instant the import
 * screen was touched, while web, the bundler and every Node test stayed green.
 * `tests/runtimeCompat.test.ts` guards against it coming back.
 *
 * So decode by hand. It is a few dozen lines, it behaves identically on every
 * platform, and it is actually faster than Expo's polyfill, which copies and
 * reverses the entire byte array before reading a single character.
 *
 * Pure functions over bytes: no React, no platform, fully testable in Node.
 */

/** Spreading more than this many arguments risks a stack overflow. */
const CHUNK = 8192;

function fromCodeUnits(units: number[]): string {
  if (units.length <= CHUNK) return String.fromCharCode(...units);
  let out = '';
  for (let i = 0; i < units.length; i += CHUNK) {
    out += String.fromCharCode(...units.slice(i, i + CHUNK));
  }
  return out;
}

/**
 * Latin-1 / ISO-8859-1: one byte, one code point, no exceptions.
 *
 * This is what the PDF reader wants — it treats a content stream as opaque
 * bytes and needs each one to survive the round trip to a string and back.
 */
export function decodeLatin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

/** The inverse of {@link decodeLatin1}: low byte of each code unit. */
export function encodeLatin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/**
 * UTF-8, lenient.
 *
 * Malformed sequences become U+FFFD rather than throwing — a statement that is
 * 99% readable with one bad byte should still import.
 */
export function decodeUtf8(bytes: Uint8Array): string {
  const units: number[] = [];
  const n = bytes.length;
  let i = 0;

  while (i < n) {
    const b0 = bytes[i++];
    let cp = 0xfffd;

    if (b0 < 0x80) {
      cp = b0;
    } else {
      const needed =
        b0 >= 0xc2 && b0 <= 0xdf ? 1 : b0 >= 0xe0 && b0 <= 0xef ? 2 : b0 >= 0xf0 && b0 <= 0xf4 ? 3 : 0;

      if (needed > 0) {
        let acc = b0 & (needed === 1 ? 0x1f : needed === 2 ? 0x0f : 0x07);
        let seen = 0;
        while (seen < needed && i < n && (bytes[i] & 0xc0) === 0x80) {
          acc = (acc << 6) | (bytes[i++] & 0x3f);
          seen += 1;
        }
        // A sequence cut short — by the end of the file or by a byte that is
        // not a continuation — is one error, not one per byte. That is what
        // the encoding spec says, and what Node produces.
        cp = seen === needed ? acc : 0xfffd;
      }
    }

    if (cp > 0xffff) {
      const surrogate = cp - 0x10000;
      units.push(0xd800 + (surrogate >> 10), 0xdc00 + (surrogate & 0x3ff));
    } else {
      units.push(cp);
    }
  }

  return fromCodeUnits(units);
}

/**
 * UTF-16. Windows "export to text" produces this far more often than anyone
 * expects — including PowerShell redirects, which is how it first showed up.
 */
export function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  const units: number[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    units.push(
      littleEndian ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1]
    );
  }
  return fromCodeUnits(units);
}

/**
 * Decode a text file, picking the encoding from its byte-order mark.
 *
 * No BOM means UTF-8, which is also right for plain ASCII. A leading U+FEFF is
 * stripped either way — left in place it becomes part of the first header cell
 * and column detection stops recognising it.
 */
export function decodeText(bytes: Uint8Array): string {
  let text: string;

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = decodeUtf16(bytes, true);
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    text = decodeUtf16(bytes, false);
  } else {
    text = decodeUtf8(bytes);
  }

  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
