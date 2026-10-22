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

describe('vault env set --public/--secret (New-27)', () => {
  it('keeps a public key public on a later set, until --secret', () => {
    expect(set('URL', 'https://a', '--public').status).toBe(0);
    expect(set('URL', 'https://b').status).toBe(0);
    expect(show()).toContain('URL = https://b');
    expect(set('URL', 'https://c', '--secret').status).toBe(0);
    expect(show()).not.toContain('URL = https://c');
  });

  it('refuses --public with --secret', () => {
    const r = set('URL', 'x', '--public', '--secret');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Use --public or --secret, not both.');
  });
});

describe('vault env import/export --comments (New-26)', () => {
  it('imports comments, warns about skipped lines, exports them back', () => {
    const file = path.join(workDir, 'in.env');
    fs.writeFileSync(file, '# Primary DB\nDB_URL="postgres://x"\noops\n');
    const r = cli(['import', 'dev', file, '--comments', '-v', vaultPath]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('in.env:3: Not KEY=value; skipped');
    const out = cli(['export', 'dev', '--comments', '-v', vaultPath]).stdout;
    expect(out).toContain('# Primary DB\nDB_URL=postgres://x');
    expect(cli(['export', 'dev', '-v', vaultPath]).stdout).not.toContain('#');
  });
});
