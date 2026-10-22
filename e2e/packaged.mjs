// Smoke check of the packaged desktop app (GUI-ENV-BREAKDOWN New-19): the
// installed binary, loading its renderer from inside app.asar, starts with
// the Content-Security-Policy and a sandboxed renderer, and unlocks a vault
// with no CSP violation. `npm run test:e2e` runs the built app from the repo,
// where `file://` and 'self' behave differently from inside an asar.
//
//   npm run package:<os> (or electron-builder --dir), then:
//   node e2e/packaged.mjs [path to the app's executable]
//
// It runs the binary with an empty home directory and drives it over the
// DevTools protocol, so it never sees (or touches) real vaults. On Linux it
// needs a display (xvfb-run on CI).
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const PAGE_HELPERS = require('./pageHelpers.cjs');
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json')));
const TIMEOUT_MS = 60_000;
const PASSWORD = 'Packaged-Smoke-7&q';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The unpacked app's executable electron-builder leaves in dist/. */
function defaultExecutable() {
  const dist = path.join(REPO, 'dist');
  const product = pkg.build.productName;
  const dirs = fs.existsSync(dist) ? fs.readdirSync(dist) : [];
  if (process.platform === 'darwin') {
    const dir = dirs.find((d) => /^mac/.test(d));
    return (
      dir && path.join(dist, dir, `${product}.app/Contents/MacOS/${product}`)
    );
  }
  if (process.platform === 'win32') {
    return path.join(dist, 'win-unpacked', `${product}.exe`);
  }
  return path.join(dist, 'linux-unpacked', pkg.build.linux.executableName);
}

/** A process's full command line. */
function commandLine(pid) {
  if (process.platform === 'win32') {
    return execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`,
      ],
      { encoding: 'utf8' }
    );
  }
  return execFileSync('ps', ['-ww', '-o', 'args=', '-p', String(pid)], {
    encoding: 'utf8',
  });
}

/** A minimal DevTools protocol client over one WebSocket. */
async function connect(url) {
  const WS = globalThis.WebSocket ?? (await import('ws')).default;
  const ws = new WS(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners) fn(msg);
    }
  });
  return {
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        id += 1;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      }),
    on: (fn) => listeners.push(fn),
    close: () => ws.close(),
  };
}

const executable = process.argv[2] ?? defaultExecutable();
if (!executable || !fs.existsSync(executable)) {
  console.error(
    `No packaged app at ${executable ?? 'dist/'}: run \`npm run package:<os>\` ` +
      'first, or pass the executable path.'
  );
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-packaged-'));
const home = path.join(tmp, 'home');
fs.mkdirSync(home);
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  APPDATA: path.join(home, 'AppData', 'Roaming'),
};
// What an installed app sees: no dev switches.
for (const name of ['NODE_ENV', 'ELECTRON_IS_DEV', 'ELECTRON_RUN_AS_NODE']) {
  delete env[name];
}

const child = spawn(
  executable,
  [
    '--enable-logging=stderr',
    '--remote-debugging-port=0',
    // Chromium's profile; on macOS it ignores HOME.
    `--user-data-dir=${path.join(tmp, 'user-data')}`,
  ],
  { env, stdio: ['ignore', 'pipe', 'pipe'] }
);
let log = '';
const devtools = new Promise((resolve) => {
  const onData = (chunk) => {
    log += chunk;
    if (process.env.E2E_VERBOSE) process.stdout.write(chunk);
    const m = /DevTools listening on (ws:\/\/[^\s]+)/.exec(log);
    if (m) resolve(m[1]);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
});

const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`
  );
};

async function run() {
  const browserUrl = await Promise.race([
    devtools,
    sleep(TIMEOUT_MS).then(() => {
      throw new Error('the app never opened its DevTools port');
    }),
  ]);
  const port = new URL(browserUrl).port;

  let page;
  for (let i = 0; i < 100 && !page; i += 1) {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`)
      .then((r) => r.json())
      .catch(() => []);
    page = targets.find((t) => t.type === 'page' && t.url.startsWith('file:'));
    if (!page) await sleep(200);
  }
  if (!page) throw new Error('the app opened no window');

  const cdp = await connect(page.webSocketDebuggerUrl);
  const cspMessages = [];
  const loadWaiters = [];
  cdp.on(({ method, params }) => {
    if (method === 'Page.loadEventFired') {
      loadWaiters.splice(0).forEach((resolve) => resolve());
    } else if (method === 'Runtime.consoleAPICalled') {
      const text = params.args.map((a) => a.value ?? a.description).join(' ');
      if (/Content Security Policy/i.test(text)) cspMessages.push(text);
    } else if (method === 'Log.entryAdded') {
      if (/Content Security Policy/i.test(params.entry.text)) {
        cspMessages.push(params.entry.text);
      }
    }
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  // Record violations from the first byte: reload with a listener in place.
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source:
      'window.__csp = []; document.addEventListener(' +
      "'securitypolicyviolation', (e) => window.__csp.push(" +
      "e.violatedDirective + ' ' + e.blockedURI));",
  });

  const js = async (expression, contextId) => {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      ...(contextId ? { contextId } : {}),
    });
    if (exceptionDetails) {
      throw new Error(
        exceptionDetails.exception?.description ?? 'evaluate failed'
      );
    }
    return result.value;
  };
  const reload = async () => {
    const loaded = new Promise((resolve) => loadWaiters.push(resolve));
    await cdp.send('Page.reload');
    await loaded;
    await js(PAGE_HELPERS);
  };
  const waitText = async (text, ms = 15000) => {
    for (let i = 0; i < ms / 100; i += 1) {
      if (await js(`__e2e.hasText(${JSON.stringify(text)})`)) return true;
      await sleep(100);
    }
    return false;
  };

  // Reloading while the app's own first load runs would abort it.
  for (let i = 0; i < 100; i += 1) {
    if ((await js('document.readyState').catch(() => '')) === 'complete') break;
    await sleep(100);
  }
  await reload();

  check(
    'the renderer loads from inside app.asar',
    /\/app\.asar\/build\/index\.html$/.test(await js('location.pathname')),
    await js('location.href')
  );
  const csp = await js(
    `document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? ''`
  );
  check(
    'the page carries the CSP',
    csp.includes("script-src 'self'") && csp.includes("object-src 'none'"),
    csp
  );
  check(
    'the page has no Node.js',
    (await js('typeof require + typeof process')) === 'undefinedundefined'
  );

  // Electron starts a sandboxed renderer with --enable-sandbox and an
  // unsandboxed one with --no-sandbox: read the real process's flags.
  const browser = await connect(browserUrl);
  const { processInfo } = await browser.send('SystemInfo.getProcessInfo');
  browser.close();
  const renderers = processInfo.filter((p) => p.type === 'renderer');
  const flags = renderers.map((p) => commandLine(p.id));
  check(
    'the renderer is sandboxed',
    flags.length > 0 &&
      flags.every(
        (f) => f.includes('--enable-sandbox') && !f.includes('--no-sandbox')
      ),
    flags.length === 0 ? 'no renderer found' : ''
  );

  const created = await js(
    `window.electronAPI.createVault('smoke', ${JSON.stringify(PASSWORD)})`
  );
  check('a vault is created', created?.success === true, created?.error);
  await reload();
  check('the vault is listed', await waitText('smoke'));
  await js(`__e2e.clickText('smoke')`);
  check('login opens', await waitText('Master Password'));
  await js(`__e2e.fill('Master Password', ${JSON.stringify(PASSWORD)})`);
  await js('__e2e.submit()');
  check('the vault unlocks', await waitText('Lock Vault', 20000));

  const violations = [...cspMessages, ...(await js('window.__csp'))];
  check(
    'no CSP violation in the page',
    violations.length === 0,
    violations.join(' | ')
  );
  cdp.close();
}

const killTimer = setTimeout(() => {
  console.log(`TIMEOUT after ${TIMEOUT_MS / 1000}s`);
  child.kill('SIGKILL');
}, TIMEOUT_MS * 2);

let exitCode = 0;
try {
  await run();
} catch (error) {
  console.log('SMOKE ERROR', error.stack);
  exitCode = 2;
} finally {
  clearTimeout(killTimer);
  child.kill();
  await new Promise((r) =>
    child.exitCode !== null ? r() : child.once('exit', r)
  );
}
const logged = log
  .split('\n')
  .filter((l) => /Content Security Policy/i.test(l));
check('no CSP line in the app log', logged.length === 0, logged.join(' | '));
if (exitCode !== 0 || results.some((ok) => !ok)) {
  if (!process.env.E2E_VERBOSE) console.log(`\n--- app log ---\n${log}`);
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (process.env.E2E_KEEP) console.log(`kept ${tmp}`);
else fs.rmSync(tmp, { recursive: true, force: true });
process.exit(exitCode || (failed ? 1 : 0));
