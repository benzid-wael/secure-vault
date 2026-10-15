// End-to-end checks for the desktop app: `npm run test:e2e` builds it, then
// this runs every scenario in e2e/scenarios against the built app, each with
// its own empty home directory so it never sees (or touches) real vaults.
//
//   node e2e/run.mjs [scenario ...]   run some scenarios (by file name)
//   E2E_KEEP=1                        keep the temp dirs for inspection
//   E2E_VERBOSE=1                     print the app's log, not just checks
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import electronBinary from 'electron';

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(E2E_DIR);
const SCENARIOS_DIR = path.join(E2E_DIR, 'scenarios');
const TIMEOUT_MS = 180_000;

for (const built of ['build/index.html', 'build/electron/main.cjs']) {
  if (!fs.existsSync(path.join(REPO, built))) {
    console.error(
      `Missing ${built}: run \`npm run test:e2e\` (it builds first).`
    );
    process.exit(1);
  }
}

const wanted = process.argv.slice(2).map((n) => n.replace(/\.cjs$/, ''));
const scenarios = fs
  .readdirSync(SCENARIOS_DIR)
  .filter((f) => f.endsWith('.cjs'))
  .map((f) => f.replace(/\.cjs$/, ''))
  .filter((name) => wanted.length === 0 || wanted.includes(name))
  .sort();
if (scenarios.length === 0) {
  console.error(`No scenario matches: ${wanted.join(', ')}`);
  process.exit(1);
}

/** Where the app keeps vaults for a given home (mirrors appPaths.js). */
function vaultsDirFor(home) {
  const name = 'secure-password-manager';
  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', name, 'vaults');
    case 'win32':
      return path.join(home, 'AppData', 'Roaming', name, 'vaults');
    default:
      return path.join(home, `.${name}`, 'vaults');
  }
}

function runScenario(name) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `sv-e2e-${name}-`));
  const home = path.join(tmp, 'home');
  const out = path.join(tmp, 'out');
  fs.mkdirSync(home);
  fs.mkdirSync(out);
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    NODE_ENV: 'production',
    E2E_REPO: REPO,
    E2E_OUT: out,
    E2E_VAULTS_DIR: vaultsDirFor(home),
  };
  delete env.ELECTRON_IS_DEV;
  delete env.ELECTRON_RUN_AS_NODE;

  const seed = path.join(SCENARIOS_DIR, `${name}.seed.mjs`);
  if (fs.existsSync(seed)) {
    fs.mkdirSync(env.E2E_VAULTS_DIR, { recursive: true });
    const r = spawnSync(process.execPath, [seed], { env, encoding: 'utf8' });
    if (r.status !== 0) {
      console.log(`✗ ${name}: seeding failed\n${r.stdout}${r.stderr}`);
      return Promise.resolve({ name, ok: false, tmp });
    }
  }

  return new Promise((resolve) => {
    const child = spawn(
      electronBinary,
      [path.join(SCENARIOS_DIR, `${name}.cjs`)],
      {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    let log = '';
    const onData = (chunk) => {
      log += chunk;
      if (process.env.E2E_VERBOSE) process.stdout.write(chunk);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => {
      log += `\nTIMEOUT after ${TIMEOUT_MS / 1000}s`;
      child.kill('SIGKILL');
    }, TIMEOUT_MS);
    child.on('exit', (code) => {
      clearTimeout(timer);
      const ok = code === 0;
      console.log(`${ok ? '✓' : '✗'} ${name}`);
      const lines = log.split('\n');
      const shown = ok
        ? lines.filter((l) => /^(PASS|FAIL)\b|\d+\/\d+ passed/.test(l))
        : lines; // a failure shows the whole log
      if (!process.env.E2E_VERBOSE) {
        for (const line of shown) if (line.trim()) console.log(`    ${line}`);
      }
      resolve({ name, ok, tmp });
    });
  });
}

let failed = 0;
for (const name of scenarios) {
  const { ok, tmp } = await runScenario(name);
  if (!ok) failed += 1;
  if (process.env.E2E_KEEP) console.log(`    kept ${tmp}`);
  else fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(
  `\n${scenarios.length - failed}/${scenarios.length} scenarios passed`
);
process.exit(failed ? 1 : 0);
