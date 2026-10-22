// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
  spawnSync(process.execPath, [CLI, 'env', ...args], {
    encoding: 'utf8',
    env: { ...process.env, VAULT_ENV_PASSWORD: PASSWORD, NO_COLOR: '1' },
  });

const set = (...args) => cli(['set', ...args, '-e', 'dev', '-v', vaultPath]);
const show = () => cli(['show', 'dev', '-v', vaultPath]).stdout;

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-comment-'));
  vaultPath = path.join(workDir, 'test.env.vault');
  cli(['init', '-v', vaultPath]);
});

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('vault env set --comment', () => {
  it('stores a comment, shows it under the key, and keeps it on a later set', () => {
    expect(
      set('TOKEN', 'v1', '--comment', 'Rotate monthly\nOwner: ops').status
    ).toBe(0);
    expect(set('TOKEN', 'v2').status).toBe(0);
    expect(show()).toMatch(/TOKEN = .*\n\s+# Rotate monthly\n\s+# Owner: ops/);
  });

  it('removes the comment with an empty --comment', () => {
    expect(set('TOKEN', 'v3', '--comment', '').status).toBe(0);
    expect(show()).not.toContain('# Rotate monthly');
  });
});
