/**
 * Guards against a missing transitive dependency.
 *
 * Removing five unused packages made npm prune eight, and two of the extras
 * were needed: `@babel/runtime` (broke the bundler, caught immediately) and
 * `expo-web-browser` (a dependency of expo-auth-session, which broke nothing
 * until you opened Settings or Add on a real phone — those screens import
 * gmail.ts, which imports expo-auth-session).
 *
 * That second one was invisible to the bundler, to the web build, and to every
 * other test, because Metro only resolves a module when something imports it
 * and nothing imports expo-web-browser directly.
 *
 * So: walk what we declare, and assert everything it needs is actually on disk.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

function readPkg(dir: string): Record<string, any> | null {
  const p = join(dir, 'package.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

function installed(name: string): boolean {
  return existsSync(join(ROOT, 'node_modules', name));
}

const root = readPkg(ROOT)!;
const declared = Object.keys(root.dependencies ?? {});

describe('dependencies', () => {
  it('declares a non-trivial dependency list', () => {
    expect(declared.length).toBeGreaterThan(5);
  });

  it.each(declared)('%s is installed', (name) => {
    expect(installed(name), `${name} is in package.json but not in node_modules`).toBe(true);
  });

  it('every declared package has its own dependencies present', () => {
    const missing: string[] = [];

    for (const name of declared) {
      const pkg = readPkg(join(ROOT, 'node_modules', name));
      if (!pkg) continue;
      for (const dep of Object.keys(pkg.dependencies ?? {})) {
        // Nested installs are legal, so only flag a dep that is nowhere.
        const hoisted = installed(dep);
        const nested = existsSync(join(ROOT, 'node_modules', name, 'node_modules', dep));
        if (!hoisted && !nested) missing.push(`${dep} (needed by ${name})`);
      }
    }

    expect(
      [...new Set(missing)],
      'A dependency was pruned. Reinstall it with `npx expo install <name>` — a ' +
        'missing native module here crashes whichever screen imports it, and ' +
        'nothing else in the build will notice.'
    ).toEqual([]);
  });
});
