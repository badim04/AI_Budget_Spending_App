/**
 * PDF text extraction, on device, offline.
 *
 * Bank statements arrive as PDFs far more often than as CSVs, so this has to
 * work without a server and without uploading somebody's statement anywhere.
 *
 * It is NOT a general PDF renderer — it only does what reading a statement
 * needs:
 *
 *   1. Find every content stream and inflate it (FlateDecode is essentially
 *      universal for generated PDFs).
 *   2. Read each font's `/ToUnicode` CMap. This is the part naive extractors
 *      skip and it is why they produce gibberish: statements embed *subset*
 *      fonts where the byte in the string is a glyph index, not a character.
 *      In the sample this repo was built against, every character was offset by
 *      29 — "Transfer" is stored as "7UDQVIHU". The CMap is what undoes that,
 *      and it is per-font, so hardcoding an offset would break on the next bank.
 *   3. Replay the text operators, tracking the position set by Td/TD/Tm/T*, and
 *      group runs into visual lines by their y coordinate.
 *
 * Encrypted PDFs are detected and reported rather than silently mangled — the
 * caller asks for the password and retries with `decryptRc4`-style handling
 * upstream, or tells the user plainly.
 *
 * Pure TypeScript over bytes: no React, no filesystem, fully testable in Node.
 */

import { inflate, inflateRaw } from 'pako';
import { decodeLatin1 } from '../bytes';

export interface TextItem {
  text: string;
  x: number;
  y: number;
  /** 1-based page number when it could be determined. */
  page: number;
}

export interface PdfExtraction {
  /** Visual lines, top-to-bottom, cells joined left-to-right. */
  lines: string[];
  items: TextItem[];
  pageCount: number;
  /** True when the file declares /Encrypt — nothing readable without a password. */
  encrypted: boolean;
  /** Human-readable reason when extraction produced nothing useful. */
  warning?: string;
}

// Latin-1 rather than `new TextDecoder('latin1')`: React Native has no
// TextDecoder, and Expo's polyfill decodes UTF-8 only — every other label
// throws. Built at module scope, that RangeError took the whole app down the
// moment this file was imported. See `src/ingest/bytes.ts`.

export function isPdf(bytes: Uint8Array): boolean {
  return (
    bytes.length > 5 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 // F
  );
}

export function isEncrypted(bytes: Uint8Array): boolean {
  return indexOfBytes(bytes, '/Encrypt') !== -1;
}

/**
 * Extract text.
 *
 * `yTolerance` decides when two runs belong to the same visual line. Statement
 * rows sit ~10-12pt apart and a row's cells rarely differ by more than a point,
 * so 2 is comfortably inside the gap.
 */
export function extractPdfText(
  bytes: Uint8Array,
  opts: { yTolerance?: number } = {}
): PdfExtraction {
  const yTolerance = opts.yTolerance ?? 2;

  if (!isPdf(bytes)) {
    return { lines: [], items: [], pageCount: 0, encrypted: false, warning: 'Not a PDF file.' };
  }
  if (isEncrypted(bytes)) {
    return {
      lines: [],
      items: [],
      pageCount: 0,
      encrypted: true,
      warning: 'This PDF is password protected. Enter the password to read it.',
    };
  }

  const raw = decodeLatin1(bytes);
  const objects = indexObjects(raw, bytes);
  const cmaps = buildCMaps(raw, bytes, objects);
  const fontsByResource = mapFontResources(raw, objects, cmaps);

  const items: TextItem[] = [];
  let page = 0;

  for (const obj of objects) {
    const data = inflateStream(bytes, obj);
    if (!data) continue;
    const content = decodeLatin1(data);
    if (!/(?:Tj|TJ)/.test(content)) continue;
    page += 1;
    readContentStream(content, cmaps, fontsByResource, page, items);
  }

  const lines = groupIntoLines(items, yTolerance);
  const warning =
    lines.length === 0
      ? 'No text found. This PDF is probably a scan — a photo of a page rather than text.'
      : undefined;

  return { lines, items, pageCount: page, encrypted: false, warning };
}

// ------------------------------------------------------------------- objects

interface PdfObject {
  num: number;
  /** Byte offsets of the raw stream payload, if this object has one. */
  streamStart: number;
  streamEnd: number;
  dict: string;
}

function indexObjects(raw: string, bytes: Uint8Array): PdfObject[] {
  const out: PdfObject[] = [];
  const re = /(\d+)\s+\d+\s+obj/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(raw))) {
    const start = m.index;
    const endObj = raw.indexOf('endobj', start);
    const body = raw.slice(start, endObj === -1 ? start + 4096 : endObj);

    const sIdx = body.indexOf('stream');
    let streamStart = -1;
    let streamEnd = -1;

    if (sIdx !== -1) {
      // The payload begins after the EOL that follows the `stream` keyword.
      let p = start + sIdx + 'stream'.length;
      if (bytes[p] === 0x0d) p++;
      if (bytes[p] === 0x0a) p++;
      const e = raw.indexOf('endstream', p);
      if (e !== -1) {
        streamStart = p;
        streamEnd = e;
      }
    }

    out.push({
      num: Number(m[1]),
      streamStart,
      streamEnd,
      dict: sIdx === -1 ? body : body.slice(0, sIdx),
    });
  }
  return out;
}

function inflateStream(bytes: Uint8Array, obj: PdfObject): Uint8Array | null {
  if (obj.streamStart < 0) return null;
  const slice = bytes.subarray(obj.streamStart, obj.streamEnd);
  try {
    return inflate(slice);
  } catch {
    try {
      // Some writers omit the zlib header.
      return inflateRaw(slice);
    } catch {
      return null;
    }
  }
}

// -------------------------------------------------------------------- CMaps

/** code -> unicode string, per font object number. */
type CMap = Map<number, string>;

function buildCMaps(raw: string, bytes: Uint8Array, objects: PdfObject[]): Map<number, CMap> {
  const byObject = new Map<number, CMap>();

  for (const obj of objects) {
    const data = inflateStream(bytes, obj);
    if (!data) continue;
    const text = decodeLatin1(data);
    if (!text.includes('begincmap')) continue;
    byObject.set(obj.num, parseCMap(text));
  }
  return byObject;
}

/**
 * Parse the two forms a ToUnicode CMap uses.
 *
 * `bfchar`  maps single codes:  <0041> <0061>
 * `bfrange` maps spans:         <0005> <0010> <0020>
 *           or explicit arrays: <0005> <0007> [<0041> <0042> <0043>]
 */
export function parseCMap(text: string): CMap {
  const map: CMap = new Map();

  for (const block of matchAll(text, /beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of matchAll(block, /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g, 2)) {
      map.set(parseInt(pair[0], 16), hexToString(pair[1]));
    }
  }

  for (const block of matchAll(text, /beginbfrange([\s\S]*?)endbfrange/g)) {
    // Explicit array form first — its entries also match the simpler pattern.
    const arrayRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([\s\S]*?)\]/g;
    const consumed: Array<[number, number]> = [];
    let m: RegExpExecArray | null;
    while ((m = arrayRe.exec(block))) {
      const lo = parseInt(m[1], 16);
      // matchAll returns plain strings in single-group mode, so `v` IS the hex
      // digits — indexing it would take the first character.
      const values = (matchAll(m[3], /<([0-9a-fA-F]+)>/g, 1) as string[]).map((v) =>
        hexToString(v)
      );
      values.forEach((v, i) => map.set(lo + i, v));
      consumed.push([m.index, m.index + m[0].length]);
    }

    const rangeRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    while ((m = rangeRe.exec(block))) {
      if (consumed.some(([s, e]) => m!.index >= s && m!.index < e)) continue;
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      const dstHex = m[3];
      const dst = parseInt(dstHex, 16);
      // Guard against a malformed range claiming millions of codes.
      const span = Math.min(hi - lo, 0xffff);
      for (let i = 0; i <= span; i++) {
        map.set(lo + i, codePointToString(dst + i, dstHex.length));
      }
    }
  }
  return map;
}

/**
 * Resource name (e.g. "F1") -> CMap, taken from every /Font resource dictionary.
 *
 * Two fonts in one document can use the same resource name on different pages,
 * so later definitions win only when the earlier one has no mapping for a code;
 * in practice statements use one or two subset fonts and this is stable.
 */
function mapFontResources(
  raw: string,
  objects: PdfObject[],
  cmaps: Map<number, CMap>
): Map<string, CMap> {
  const fontToCMap = new Map<number, CMap>();

  for (const obj of objects) {
    const m = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(obj.dict);
    if (!m) continue;
    const cmap = cmaps.get(Number(m[1]));
    if (cmap) fontToCMap.set(obj.num, cmap);
  }

  const byResource = new Map<string, CMap>();
  for (const block of matchAll(raw, /\/Font\s*<<([\s\S]{0,2000}?)>>/g)) {
    for (const entry of matchAll(block, /\/([A-Za-z0-9_.+\-]+)\s+(\d+)\s+0\s+R/g, 2)) {
      const cmap = fontToCMap.get(Number(entry[1]));
      if (cmap && !byResource.has(entry[0])) byResource.set(entry[0], cmap);
    }
  }

  // Fallback for documents whose resource dictionary we could not read: a single
  // merged map is far better than emitting raw glyph indices.
  if (byResource.size === 0 && cmaps.size > 0) {
    const merged: CMap = new Map();
    for (const cmap of cmaps.values()) {
      for (const [k, v] of cmap) if (!merged.has(k)) merged.set(k, v);
    }
    byResource.set('*', merged);
  }
  return byResource;
}

// ----------------------------------------------------------- content streams

const STRING = String.raw`\((?:\\.|[^()\\])*\)`;
const HEXSTR = String.raw`<[0-9a-fA-F\s]*>`;

const OPERATOR = new RegExp(
  [
    String.raw`\/([A-Za-z0-9_.+\-]+)\s+[-\d.]+\s+Tf`, // 1: font
    String.raw`([-\d.]+)\s+([-\d.]+)\s+(?:Td|TD)`, // 2,3: move
    String.raw`([-\d.]+)\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)\s+Tm`, // 4,5,6
    String.raw`(T\*)`, // 7: next line
    String.raw`(BT)`, // 8
    String.raw`(${STRING}|${HEXSTR})\s*Tj`, // 9: show
    String.raw`\[((?:${STRING}|${HEXSTR}|[-\d.\s])*)\]\s*TJ`, // 10: show array
    String.raw`([-\d.]+)\s+TL`, // 11: leading
  ].join('|'),
  'g'
);

function readContentStream(
  content: string,
  cmaps: Map<number, CMap>,
  fonts: Map<string, CMap>,
  page: number,
  out: TextItem[]
): void {
  let x = 0;
  let y = 0;
  let leading = 12;
  let cmap: CMap | undefined = fonts.get('*');

  for (const m of matchAllRaw(content, OPERATOR)) {
    if (m[1]) {
      cmap = fonts.get(m[1]) ?? fonts.get('*') ?? cmap;
    } else if (m[2] !== undefined) {
      // Td/TD are relative to the current line start.
      x += Number(m[2]);
      y += Number(m[3]);
    } else if (m[4] !== undefined) {
      x = Number(m[5]);
      y = Number(m[6]);
    } else if (m[7]) {
      y -= leading;
    } else if (m[8]) {
      x = 0;
      y = 0;
    } else if (m[9]) {
      pushText(decodeString(m[9], cmap), x, y, page, out);
    } else if (m[10] !== undefined) {
      const parts = matchAll(m[10], new RegExp(`${STRING}|${HEXSTR}`, 'g')) as string[];
      pushText(parts.map((part) => decodeString(part, cmap)).join(''), x, y, page, out);
    } else if (m[11] !== undefined) {
      leading = Number(m[11]);
    }
  }
}

function pushText(text: string, x: number, y: number, page: number, out: TextItem[]): void {
  if (text.trim() === '') return;
  out.push({ text, x, y, page });
}

/** Decode a PDF string through the active font's CMap. */
function decodeString(token: string, cmap: CMap | undefined): string {
  const bytes = token.startsWith('<') ? hexBytes(token) : literalBytes(token);
  if (bytes.length === 0) return '';

  if (cmap && cmap.size > 0) {
    // Identity encodings use two bytes per glyph. Decide by testing which width
    // the CMap actually resolves — guessing wrong turns text into mojibake.
    const two = decodeWith(bytes, cmap, 2);
    const one = decodeWith(bytes, cmap, 1);
    if (two.hits >= one.hits) return two.text;
    return one.text;
  }
  return decodeLatin1(Uint8Array.from(bytes));
}

function decodeWith(
  bytes: number[],
  cmap: CMap,
  width: 1 | 2
): { text: string; hits: number } {
  let text = '';
  let hits = 0;
  for (let i = 0; i + width <= bytes.length; i += width) {
    const code = width === 2 ? (bytes[i] << 8) | bytes[i + 1] : bytes[i];
    const mapped = cmap.get(code);
    if (mapped !== undefined) {
      text += mapped;
      hits++;
    } else {
      text += String.fromCharCode(code);
    }
  }
  return { text, hits };
}

function literalBytes(token: string): number[] {
  const body = token.slice(1, -1);
  const out: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== '\\') {
      out.push(body.charCodeAt(i));
      continue;
    }
    const next = body[++i];
    if (next === undefined) break;
    const simple: Record<string, number> = {
      n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92,
    };
    if (next in simple) {
      out.push(simple[next]);
    } else if (next >= '0' && next <= '7') {
      // Octal escape, up to three digits.
      let oct = next;
      while (oct.length < 3 && body[i + 1] >= '0' && body[i + 1] <= '7') oct += body[++i];
      out.push(parseInt(oct, 8));
    } else {
      out.push(next.charCodeAt(0));
    }
  }
  return out;
}

function hexBytes(token: string): number[] {
  const hex = token.slice(1, -1).replace(/\s+/g, '');
  const padded = hex.length % 2 === 1 ? `${hex}0` : hex;
  const out: number[] = [];
  for (let i = 0; i < padded.length; i += 2) out.push(parseInt(padded.slice(i, i + 2), 16));
  return out;
}

// --------------------------------------------------------------------- lines

/**
 * Group runs into visual lines.
 *
 * A statement row is one line; its columns are separate text runs at different
 * x positions. Sorting by x and joining with a tab preserves the column order
 * so the row parser can split on it.
 */
export function groupIntoLines(items: TextItem[], yTolerance: number): string[] {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const lines: string[] = [];
  let bucket: TextItem[] = [];

  const flush = () => {
    if (bucket.length === 0) return;
    const text = bucket
      .sort((a, b) => a.x - b.x)
      .map((i) => i.text.trim())
      .filter(Boolean)
      .join('\t')
      .replace(/[ \t]+/g, (s) => (s.includes('\t') ? '\t' : ' '))
      .trim();
    if (text) lines.push(text);
    bucket = [];
  };

  for (const item of sorted) {
    const last = bucket[bucket.length - 1];
    if (last && (last.page !== item.page || Math.abs(last.y - item.y) > yTolerance)) flush();
    bucket.push(item);
  }
  flush();
  return lines;
}

// ------------------------------------------------------------------- helpers

function matchAll(text: string, re: RegExp, groups = 1): string[][] | any {
  const out: any[] = [];
  let m: RegExpExecArray | null;
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  while ((m = r.exec(text))) {
    if (groups === 1) out.push(m[1] ?? m[0]);
    else out.push(m.slice(1, 1 + groups));
    if (m.index === r.lastIndex) r.lastIndex++;
  }
  return out;
}

function* matchAllRaw(text: string, re: RegExp): Generator<RegExpExecArray> {
  const r = new RegExp(re.source, re.flags);
  r.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = r.exec(text))) {
    yield m;
    if (m.index === r.lastIndex) r.lastIndex++;
  }
}

function hexToString(hex: string): string {
  let out = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  }
  if (out === '' && hex.length >= 2) out = String.fromCharCode(parseInt(hex.slice(0, 2), 16));
  return out;
}

function codePointToString(code: number, hexLength: number): string {
  // A 4-digit destination is a single UTF-16 unit; longer values are surrogate
  // pairs already encoded, which statements do not use.
  if (hexLength <= 4) return String.fromCharCode(code);
  return String.fromCodePoint(code);
}

function indexOfBytes(bytes: Uint8Array, needle: string): number {
  const target = [...needle].map((c) => c.charCodeAt(0));
  outer: for (let i = 0; i <= bytes.length - target.length; i++) {
    for (let j = 0; j < target.length; j++) {
      if (bytes[i + j] !== target[j]) continue outer;
    }
    return i;
  }
  return -1;
}
