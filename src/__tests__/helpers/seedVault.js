// Build a test vault once per file, then copy it into each test's directory.
// An env vault file doesn't record its own path, so a copy is equivalent to
// re-running `init` + `set` through the CLI before every test — minus the
// process spawns.
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '../../../bin/cli.js');

/**
 * Create a vault by running `vault env <args>` for each step, against
 * `<tmp>/seed.env.vault`. Returns the seed file's path.
 *
 * @param {string} password
 * @param {string[][]} steps argument lists, `{vault}` replaced by the path
 */
export function seedVault(password, steps) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-seed-'));
  const vaultPath = path.join(dir, 'seed.env.vault');
  for (const step of steps) {
    const args = step.map((a) => (a === '{vault}' ? vaultPath : a));
    const r = spawnSync(process.execPath, [CLI, 'env', ...args], {
      encoding: 'utf8',
      cwd: dir,
      env: { ...process.env, VAULT_ENV_PASSWORD: password },
    });
    if (r.status !== 0) {
      throw new Error(`seed step failed: ${args.join(' ')}\n${r.stderr}`);
    }
  }
  return vaultPath;
}

/** Remove the directory a seed vault lives in. */
export function removeSeed(seedPath) {
  fs.rmSync(path.dirname(seedPath), { recursive: true, force: true });
}
