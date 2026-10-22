#!/usr/bin/env node
/**
 * Check a standalone `vault` binary (Bun `--compile`, see build-cli.js)
 * against the Node CLI (GUI-ENV-BREAKDOWN New-5): env vaults derive their
 * keys with async PBKDF2, which the binary runs on Bun's `node:crypto`. A
 * vault written by either must open in the other, at today's iteration count
 * and at the legacy one (a vault with no `kdf` header).
 *
 *   node scripts/verify-cli-binary.mjs dist-cli/vault-macos-arm64
 *
 * The binary must run on this machine. Exits non-zero on any mismatch.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { CryptographyService } from '../src/electron/services/CryptographyService.js';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const binary = process.argv[2] && path.resolve(process.argv[2]);
if (!binary || !fs.existsSync(binary)) {
  console.error(
    'Usage: node scripts/verify-cli-binary.mjs <path to a vault binary>'
  );
  process.exit(1);
}

const PASSWORD = 'Binary-Check-5$k';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-binary-'));
const CLIS = {
  node: [process.execPath, path.join(REPO, 'bin/cli.js')],
  binary: [binary],
};

/** Run one CLI's `vault env …` against `vault`; returns trimmed stdout. */
function vault(cli, vaultPath, ...args) {
  const [cmd, ...pre] = CLIS[cli];
  const r = spawnSync(
    cmd,
    [...pre, 'env', ...args, '-v', vaultPath, '--password', PASSWORD],
    {
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, HOME: tmp, USERPROFILE: tmp, NO_COLOR: '1' },
    }
  );
  if (r.status !== 0) {
    throw new Error(
      `${cli} env ${args.join(' ')} exited ${r.status}\n${r.stdout}${r.stderr}`
    );
  }
  return r.stdout.trim();
}

/** Re-key a vault at the legacy iteration count, with no `kdf` header. */
function makeLegacy(vaultPath) {
  const file = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
  const salt = Buffer.from(file.salt, 'hex');
  const payload = CryptographyService.decrypt(
    file,
    CryptographyService.deriveKey(
      PASSWORD,
      salt,
      CryptographyService.ITERATIONS
    )
  );
  const legacyKey = CryptographyService.deriveKey(
    PASSWORD,
    salt,
    CryptographyService.LEGACY_ITERATIONS
  );
  const rest = { ...file };
  delete rest.kdf;
  fs.writeFileSync(
    vaultPath,
    JSON.stringify({
      ...rest,
      ...CryptographyService.encrypt(payload, legacyKey),
    })
  );
}

const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push(true);
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`FAIL  ${name}\n${error.message}`);
  }
};
const expectEqual = (actual, expected) => {
  if (actual !== expected) {
    throw new Error(
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
};

const crossCheck = (writer, reader) => {
  const file = path.join(tmp, `${writer}.env.vault`);
  check(`${writer} creates a vault, ${reader} reads it`, () => {
    vault(writer, file, 'init');
    vault(writer, file, 'set', 'FROM', writer, '-e', 'dev');
    expectEqual(vault(reader, file, 'get', 'FROM', '-e', 'dev'), writer);
  });
  check(`${reader} writes it, ${writer} reads that back`, () => {
    vault(reader, file, 'set', 'BACK', reader, '-e', 'dev');
    expectEqual(vault(writer, file, 'get', 'BACK', '-e', 'dev'), reader);
  });
};

const version = spawnSync(binary, ['--version'], { encoding: 'utf8' });
console.log(`Binary: ${binary} (${version.stdout.trim()})`);

crossCheck('node', 'binary');
crossCheck('binary', 'node');

check('the binary reads and writes a legacy vault (no kdf header)', () => {
  const file = path.join(tmp, 'legacy.env.vault');
  vault('node', file, 'init');
  vault('node', file, 'set', 'OLD', 'yes', '-e', 'dev');
  makeLegacy(file);
  if (JSON.parse(fs.readFileSync(file, 'utf8')).kdf) {
    throw new Error('the vault still has a kdf header');
  }
  expectEqual(vault('binary', file, 'get', 'OLD', '-e', 'dev'), 'yes');
  vault('binary', file, 'set', 'NEW', 'too', '-e', 'dev');
  expectEqual(vault('node', file, 'get', 'NEW', '-e', 'dev'), 'too');
});

check('a wrong password fails in the binary', () => {
  const file = path.join(tmp, 'node.env.vault');
  const r = spawnSync(
    binary,
    ['env', 'get', 'FROM', '-e', 'dev', '-v', file, '--password', 'wrong'],
    { cwd: tmp, encoding: 'utf8', env: { ...process.env, HOME: tmp } }
  );
  if (r.status === 0) throw new Error('it exited 0');
});

fs.rmSync(tmp, { recursive: true, force: true });
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
