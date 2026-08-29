/**
 * Every link goes somewhere real.
 *
 * An insight carried `action: { route: '/transaction/[id]' }`, which is how a
 * dynamic segment is *named on disk* and not how one is *navigated to*. Tapping
 * it sent the app to `finlo:///transaction/tx_mtdl6qki_vfbya9` and an
 * "Unmatched Route" page. Nothing threw, the typecheck was clean, and the
 * bundle built — a route string is just a string, and expo-router only finds
 * out at tap time.
 *
 * That is the whole class of bug this file exists to close: navigation targets
 * are checked against the files that actually exist in `app/`, by reading both.
 *
 * Deliberately a filesystem scan rather than a hand-maintained list. A list
 * would be a second place to update, and the failure mode of forgetting to
 * update it is exactly the failure it was meant to catch.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const APP_DIR = join(__dirname, '..', 'app');
const SRC_DIR = join(__dirname, '..', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * The routes expo-router will actually serve.
 *
 * Group segments — `(tabs)` — are layout-only and do not appear in the URL, so
 * `/(tabs)/budgets` is reachable as `/budgets`. `_layout` files are not routes.
 */
function declaredRoutes(): Set<string> {
  const routes = new Set<string>();

  for (const file of walk(APP_DIR)) {
    const rel = relative(APP_DIR, file).split(sep).join('/');
    if (rel.endsWith('_layout.tsx') || rel.startsWith('+')) continue;

    let route = `/${rel.replace(/\.tsx?$/, '')}`;
    route = route.replace(/\/\([^)]+\)/g, ''); // drop group segments
    route = route.replace(/\/index$/, '') || '/';
    routes.add(route === '' ? '/' : route);
  }

  return routes;
}

/** Every literal route string the app navigates to. */
function navigationTargets(): Array<{ target: string; file: string; line: number }> {
  const found: Array<{ target: string; file: string; line: number }> = [];

  const patterns = [
    /router\.(?:push|replace|navigate)\(\s*'([^']+)'/g,
    /pathname:\s*'([^']+)'/g,
    /route:\s*'([^']+)'/g,
    /href:\s*'([^']+)'/g,
  ];

  for (const file of [...walk(APP_DIR), ...walk(SRC_DIR)]) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');

    lines.forEach((line, i) => {
      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line)) != null) {
          const target = match[1];
          // Only in-app paths. mailto:, https:, and '/' from the nav are fine.
          if (!target.startsWith('/')) continue;
          found.push({
            target,
            file: relative(join(__dirname, '..'), file).split(sep).join('/'),
            line: i + 1,
          });
        }
      }
    });
  }

  return found;
}

describe('navigation', () => {
  it('finds the routes and the links, so this test cannot pass vacuously', () => {
    const routes = declaredRoutes();
    const targets = navigationTargets();

    // A scan that silently matched nothing would be a green test proving zero.
    expect(routes.size).toBeGreaterThan(10);
    expect(targets.length).toBeGreaterThan(20);
    expect(routes.has('/budgets')).toBe(true);
    expect(routes.has('/transaction/new')).toBe(true);
    expect(routes.has('/')).toBe(true);
  });

  /**
   * The one that would have caught the Unmatched Route.
   */
  it('every route it navigates to exists in app/', () => {
    const routes = declaredRoutes();
    const broken = navigationTargets()
      .filter(({ target }) => !routes.has(target))
      .map(({ target, file, line }) => `${target}  (${file}:${line})`);

    expect(broken, 'navigation targets with no matching file in app/').toEqual([]);
  });

  /**
   * A dynamic segment is navigated to with its value, never with its filename.
   *
   * `/transaction/[id]` looks plausible in a route string and is never right at
   * runtime — it is the on-disk name of the file, not a URL.
   */
  it('never navigates to a literal [param] segment', () => {
    const literal = navigationTargets()
      .filter(({ target }) => target.includes('[') || target.includes(']'))
      .map(({ target, file, line }) => `${target}  (${file}:${line})`);

    expect(literal, 'route strings containing a filename-style [param]').toEqual([]);
  });

  /** Group segments are layout-only; a URL containing one does not resolve. */
  it('never navigates to a (group) segment', () => {
    const grouped = navigationTargets()
      .filter(({ target }) => /\([^)]+\)/.test(target))
      .map(({ target, file, line }) => `${target}  (${file}:${line})`);

    expect(grouped, 'route strings containing a (group) segment').toEqual([]);
  });
});
