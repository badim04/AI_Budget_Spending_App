/**
 * `npm run push -- "message"` — publish an OTA update, on a bad connection.
 *
 * The plain `eas update` kept dying like this:
 *
 *   request to https://api.expo.dev/graphql failed,
 *   reason: getaddrinfo EAI_AGAIN api.expo.dev
 *
 * `EAI_AGAIN` is the DNS resolver giving up — not a broken build, not a bad
 * credential, nothing wrong with the update itself.
 *
 * The first version of this script retried three times with identical
 * settings, which is not a retry: it is the same failure three times over. So:
 *
 *  1. **Check DNS before spending an upload on it.** If the system resolver
 *     cannot find the host but a public one can, the fault is this network's
 *     DNS server and no amount of retrying will fix it. Say that, name the
 *     fix, and stop.
 *  2. **Vary the DNS order between attempts.** Whether IPv4-first or
 *     IPv6-first works depends on the network. Node only reads
 *     `--dns-result-order` at startup, so it goes into the child's
 *     NODE_OPTIONS rather than being set from inside this process.
 *  3. **Only retry things worth retrying.** A real build error, a bad
 *     credential or a rejected update fails immediately — looping on those
 *     just burns the bandwidth this is trying to save.
 */

import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { lookup, Resolver } from 'node:dns/promises';

/**
 * Find eas-cli's entry script.
 *
 * Deliberately not `eas` or `npx eas-cli`: the first is a `.cmd` shim that
 * needs a shell, and the second re-downloads the CLI over the connection that
 * is already the problem. Running the JS with the current Node also guarantees
 * NODE_OPTIONS actually applies.
 */
function findEasCli() {
  const candidates = [join(process.cwd(), 'node_modules', 'eas-cli', 'bin', 'run')];

  try {
    // A fixed literal command with no interpolation, so the shell is safe here.
    // `execFile` is not an option: npm is a .cmd on Windows and recent Node
    // refuses to run those without a shell.
    const globalRoot = execSync('npm root -g', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (globalRoot) candidates.push(join(globalRoot, 'eas-cli', 'bin', 'run'));
  } catch {
    // No npm on PATH is survivable; the local path may still work.
  }

  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    console.error(
      ['Could not find eas-cli. Install it with:', '  npm install -g eas-cli', '', 'Looked in:']
        .concat(candidates.map((c) => '  ' + c))
        .join('\n')
    );
    process.exit(1);
  }
  return found;
}

const EAS_CLI = findEasCli();

/** Tried in order, one per attempt. `verbatim` is Node's default. */
const DNS_ORDERS = ['ipv4first', 'verbatim', 'ipv6first'];
const BACKOFF_MS = [0, 5_000, 15_000];

/** Lookup failures, resets and timeouts — the retryable set. */
const TRANSIENT =
  /EAI_AGAIN|ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE|socket hang up|network|Failed to upload/i;

const HOSTS = ['api.expo.dev', 'update-assets-upload-production.storage.googleapis.com'];

/**
 * Can this machine resolve the hosts at all?
 *
 * Worth knowing before spending three uploads finding out. Asking a public
 * resolver directly separates "your DNS server is failing", which is fixable
 * and nameable, from "you have no connection", which is not.
 */
async function checkDns() {
  const system = [];
  for (const host of HOSTS) {
    try {
      await lookup(host);
      system.push({ host, ok: true });
    } catch (e) {
      system.push({ host, ok: false, code: e.code ?? String(e) });
    }
  }

  if (system.every((r) => r.ok)) return { ok: true, system };

  const resolver = new Resolver();
  resolver.setServers(['1.1.1.1', '8.8.8.8']);

  let publicWorks = false;
  for (const method of ['resolve4', 'resolve6']) {
    try {
      await resolver[method](HOSTS[0]);
      publicWorks = true;
      break;
    } catch {
      // Try the other record type before concluding anything.
    }
  }

  return { ok: false, system, publicWorks };
}

// `--branch x` anywhere in the args; everything else is the message. Env vars
// would be simpler but `VAR=x cmd` is not a thing in cmd.exe, which is what npm
// runs scripts through on Windows.
const args = process.argv.slice(2);
const flag = args.indexOf('--branch');
const branch = flag === -1 ? 'preview' : args[flag + 1];
const message = (flag === -1 ? args : [...args.slice(0, flag), ...args.slice(flag + 2)])
  .join(' ')
  .trim();

/** `npm run push:check` — test the network without publishing anything. */
const checkOnly = args.includes('--check');

if (!message && !checkOnly) {
  console.error('Usage: npm run push -- "what changed"');
  process.exit(1);
}

function attempt(n) {
  const order = DNS_ORDERS[n] ?? DNS_ORDERS[DNS_ORDERS.length - 1];
  console.log('');
  console.log(`[push] attempt ${n + 1} of ${DNS_ORDERS.length}, DNS order: ${order}`);
  console.log('');

  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [EAS_CLI, 'update', '--branch', branch, '--message', message],
      {
        stdio: ['inherit', 'pipe', 'pipe'],
        env: {
          ...process.env,
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --dns-result-order=${order}`.trim(),
        },
      }
    );

    let tail = '';
    const watch = (stream, sink) => {
      stream.on('data', (chunk) => {
        const text = chunk.toString();
        // Keep only the last stretch — enough to classify the failure.
        tail = (tail + text).slice(-4000);
        sink.write(text);
      });
    };

    watch(child.stdout, process.stdout);
    watch(child.stderr, process.stderr);

    child.on('error', (e) => resolve({ code: 1, tail: tail + '\n' + e.message }));
    child.on('close', (code) => resolve({ code: code ?? 1, tail }));
  });
}

const dns = await checkDns();

if (checkOnly) {
  for (const r of dns.system) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.host}${r.ok ? '' : `  (${r.code})`}`);
  }
  if (dns.ok) {
    console.log('');
    console.log('All hosts resolve. `npm run push` should work.');
    process.exit(0);
  }
}

if (!dns.ok) {
  const failed = dns.system.filter((r) => !r.ok).map((r) => `${r.host} (${r.code})`);
  console.error('');
  console.error('DNS cannot resolve: ' + failed.join(', '));

  console.error(
    (dns.publicWorks
      ? [
          '',
          'A public resolver (1.1.1.1) finds it fine, so the name exists and your',
          "internet works — it is this network's DNS server that is failing.",
          'Retrying will not help. Any one of these will:',
          '',
          '  * Point Windows at a public resolver:',
          '      Settings > Network & Internet > (your connection) > Edit DNS server',
          '      assignment > Manual > IPv4 on > Preferred 1.1.1.1, Alternate 8.8.8.8',
          '  * Or tether to your phone and run this again.',
          '  * Or, in an admin PowerShell:  ipconfig /flushdns',
          '',
        ]
      : [
          '',
          'A public resolver could not reach it either, so this looks like the',
          'connection rather than DNS settings. Nothing is broken in the app — the',
          'update simply has not been uploaded. Try again on a steadier connection,',
          'or tether to your phone.',
          '',
        ]
    ).join('\n')
  );
  process.exit(1);
}

for (let n = 0; n < DNS_ORDERS.length; n++) {
  if (BACKOFF_MS[n] > 0) {
    console.log(`\nRetrying in ${BACKOFF_MS[n] / 1000}s...`);
    await new Promise((r) => setTimeout(r, BACKOFF_MS[n]));
  }

  const { code, tail } = await attempt(n);

  if (code === 0) {
    console.log('\nUpdate published. Force-close Finlo on the phone and open it twice.');
    process.exit(0);
  }

  if (!TRANSIENT.test(tail)) {
    console.error('\nThis is not a network problem, so retrying would not help.');
    process.exit(code);
  }

  if (n === DNS_ORDERS.length - 1) {
    console.error(
      [
        '',
        `Gave up after ${DNS_ORDERS.length} attempts, one per DNS order.`,
        'Nothing is broken — the update simply has not been uploaded.',
        '',
        'If it kept failing on the same host, that host is not resolving from this',
        'network: switch DNS to 1.1.1.1, or tether to your phone, and try again.',
      ].join('\n')
    );
    process.exit(code);
  }
}
