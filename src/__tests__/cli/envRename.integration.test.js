// @vitest-environment node
// `vault env rename` (New-44): envs extending the renamed one follow, and
// `{{env:OLD/KEY}}` references are updated unless --keep-references.
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
const get = (key, env) => cli(['get', key, '-e', env]);

// base: HOST; shop uses {{env:base/HOST}}; child extends base.
beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-rename-'));
  vaultPath = path.join(workDir, 'test.env.vault');
  ok(['init']);
  ok(['set', 'HOST', 'db.internal', '-e', 'base']);
  ok(['set', 'DB', 'postgres://{{env:base/HOST}}/shop', '-e', 'shop']);
  ok(['set', 'OWN', 'x', '-e', 'child']);
  ok(['extends', 'child', 'base']);
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('vault env rename', () => {
  it('moves extends and references with the env, and says so', () => {
    const renamed = ok(['rename', 'base', 'core']);
    expect(renamed.stdout + renamed.stderr).toContain(
      'Renamed "base" to "core". Updated 1 reference in shop.'
    );
    expect(get('DB', 'shop').stdout.trim()).toBe('postgres://db.internal/shop');
    // child still layers HOST from its parent, now core.
    expect(get('HOST', 'child').stdout.trim()).toBe('db.internal');
    expect(get('HOST', 'base').status).not.toBe(0);
  });

  it('leaves references with --keep-references; extends still follow', () => {
    const renamed = ok(['rename', 'base', 'core', '--keep-references']);
    expect(renamed.stdout + renamed.stderr).not.toContain('Updated');
    expect(get('DB', 'shop').status).not.toBe(0);
    expect(get('HOST', 'child').stdout.trim()).toBe('db.internal');
  });
});
