// @vitest-environment node
// `vault env import` (New-32): keys still in the file keep their public and
// required flags; new keys are secret, dropped keys take their flags along.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '../../../bin/cli.js');
const PASSWORD = 'TestVault123!@#';

let workDir;
let vaultPath;

/** @param {string[]} args */
const cli = (args) =>
  spawnSync(process.execPath, [CLI, 'env', ...args, '-v', vaultPath], {
    encoding: 'utf8',
    env: { ...process.env, VAULT_ENV_PASSWORD: PASSWORD, NO_COLOR: '1' },
  });
const ok = (args) => {
  const result = cli(args);
  expect(result.status, result.stderr + result.stdout).toBe(0);
  return result;
};
/** @returns {Record<string, boolean>} key → sensitive */
const sensitivity = () =>
  Object.fromEntries(
    JSON.parse(ok(['show', 'dev', '--json']).stdout).keys.map((k) => [
      k.key,
      k.sensitive,
    ])
  );
const requiredCount = () =>
  JSON.parse(ok(['validate', 'dev', '--json']).stdout).requiredCount;

// dev: URL public, TOKEN required, OLD public.
beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-import-'));
  vaultPath = path.join(workDir, 'test.env.vault');
  ok(['init']);
  ok(['set', 'URL', 'http://a', '--public', '-e', 'dev']);
  ok(['set', 'TOKEN', 't1', '--required', '-e', 'dev']);
  ok(['set', 'OLD', 'o', '--public', '-e', 'dev']);
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('vault env import', () => {
  it('keeps the flags of the keys it replaces', () => {
    const file = path.join(workDir, '.env');
    fs.writeFileSync(file, 'URL=http://b\nTOKEN=t2\nNEW=n\n');
    ok(['import', 'dev', file]);

    expect(sensitivity()).toEqual({ URL: false, TOKEN: true, NEW: true });
    expect(requiredCount()).toBe(1);
  });

  it('drops the flags of a key the file leaves out', () => {
    const file = path.join(workDir, '.env');
    fs.writeFileSync(file, 'URL=http://b\n');
    ok(['import', 'dev', file]);
    expect(requiredCount()).toBe(0);

    // OLD comes back as a new key: secret.
    fs.writeFileSync(file, 'URL=http://b\nOLD=o\n');
    ok(['import', 'dev', file]);
    expect(sensitivity()).toEqual({ URL: false, OLD: true });
  });
});
