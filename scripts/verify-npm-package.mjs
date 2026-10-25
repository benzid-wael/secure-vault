#!/usr/bin/env node
/**
 * Check the npm package as users get it: pack the repo, install the tarball
 * into an empty folder, and run its CLI. A source file the CLI imports but
 * `files` in package.json leaves out (as `src/agent/` was in 0.2.0-rc.1 and
 * rc.2) makes every command crash at startup, which the unit tests, run from
 * the repo, can't see.
 *
 *   node scripts/verify-npm-package.mjs
 *
 * Exits non-zero if the installed CLI fails.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PASSWORD = 'Package-Check-5$k';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-package-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** Run a command; throw with its output if it fails. Returns trimmed stdout. */
function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32' && cmd === npm,
    env: { ...process.env, HOME: tmp, USERPROFILE: tmp, NO_COLOR: '1' },
  });
  if (r.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(' ')} exited ${r.status}\n${r.stdout}${r.stderr}`
    );
  }
  return r.stdout.trim();
}

function expectEqual(actual, expected) {
  if (actual !== expected) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${actual}`);
  }
}

try {
  const out = JSON.parse(
    run(npm, ['pack', '--json', '--pack-destination', tmp], REPO)
  );
  // npm 11 prints an array, npm 12 an object keyed by package name.
  const packed = Array.isArray(out) ? out[0] : Object.values(out)[0];
  const tarball = path.join(tmp, packed.filename);

  const app = path.join(tmp, 'app');
  fs.mkdirSync(app);
  run(npm, ['install', '--omit=dev', '--no-audit', '--no-fund', tarball], app);

  const cli = path.join(app, 'node_modules', packed.name, 'bin', 'cli.js');
  const vault = (...args) => run(process.execPath, [cli, ...args], tmp);
  const file = path.join(tmp, 'check.env.vault');
  const env = (...args) =>
    vault('env', ...args, '-v', file, '--password', PASSWORD);

  expectEqual(vault('--version'), packed.version);
  env('init');
  env('set', 'FROM', 'package', '-e', 'dev');
  expectEqual(env('get', 'FROM', '-e', 'dev'), 'package');

  console.log(
    `${packed.name}@${packed.version}: the installed CLI works ` +
      `(${packed.files.length} files).`
  );
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
