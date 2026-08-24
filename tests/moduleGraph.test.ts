/**
 * Guards against the platform-resolution self-import.
 *
 * Metro resolves `./foo` to `foo.native.ts` on Android and iOS when that file
 * exists. So inside `foo.native.ts`, an import of `./foo` resolves to ITSELF.
 * That alone is survivable, but re-exporting a symbol taken from that import
 * makes Metro emit a property getter that returns its own value — infinite
 * recursion the moment the module is touched.
 *
 * The failure mode is brutal: the bundler is happy, web is happy, tests are
 * happy, and the installed Android app dies with
 * `RangeError: Maximum call stack size exceeded` before any app code runs.
 * That cost a full debugging cycle and two 15-minute cloud builds, so it gets
 * a test.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

const SRC = join(__dirname, '..', 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** "repository.native.ts" -> "repository" */
function platformVariantBase(file: string): string | null {
  const name = basename(file, extname(file)); // repository.native
  const m = /^(.*)\.(native|android|ios|web)$/.exec(name);
  return m ? m[1] : null;
}

function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re = /(?:from|require\()\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) specs.push(m[1]);
  return specs;
}

describe('platform-specific modules', () => {
  const files = walk(SRC);
  const variants = files.filter((f) => platformVariantBase(f) !== null);

  it('finds the platform variants it is meant to be checking', () => {
    // If this ever hits zero the test below is silently vacuous.
    expect(variants.length).toBeGreaterThan(0);
  });

  it.each(variants)('%s does not import its own base module', (file) => {
    const base = platformVariantBase(file)!;
    const specs = importSpecifiers(readFileSync(file, 'utf8'));
    const selfImports = specs.filter(
      (s) => s === `./${base}` || s.endsWith(`/${base}`)
    );
    expect(
      selfImports,
      `${basename(file)} imports ${selfImports.join(', ')}, which Metro resolves ` +
        `back to ${basename(file)} on native. Move the shared symbols into a ` +
        `module with no platform variants (e.g. ${base}Shared.ts).`
    ).toEqual([]);
  });
});
