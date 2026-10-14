// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '../../../bin/cli.js');
const NODE = process.execPath;
const PASSWORD = 'TestVault123!@#';

let workDir;
let vaultPath;

/**
 * @param {string[]} args
 * @param {{input?: string, env?: Record<string, string>}} [options]
 */
function cli(args, { input, env = {} } = {}) {
  return spawnSync(NODE, [CLI, 'env', ...args], {
    encoding: 'utf8',
    input,
    env: { ...process.env, VAULT_ENV_PASSWORD: PASSWORD, ...env },
  });
}

const get = (key) => cli(['get', key, '-e', 'dev', '-v', vaultPath]);

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-value-stdin-'));
  vaultPath = path.join(workDir, 'test.env.vault');
  cli(['init', '-v', vaultPath]);
});

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('vault env set --value-stdin', () => {
  it('stores the value read from stdin, dropping one trailing newline', () => {
    const r = cli(
      ['set', 'TOKEN', '--value-stdin', '-e', 'dev', '-v', vaultPath],
      { input: 's3cr3t-value\n' }
    );
    expect(r.status).toBe(0);
    expect(get('TOKEN').stdout.trim()).toBe('s3cr3t-value');
  });

  it('keeps interior newlines (multi-line values)', () => {
    const r = cli(
      ['set', 'PEM', '--value-stdin', '-e', 'dev', '-v', vaultPath],
      { input: 'line1\nline2\n' }
    );
    expect(r.status).toBe(0);
    expect(get('PEM').stdout).toContain('line1\nline2');
  });

  it('composes with --encode', () => {
    const r = cli(
      [
        'set',
        'B64',
        '--value-stdin',
        '--encode',
        'base64',
        '-e',
        'dev',
        '-v',
        vaultPath,
      ],
      { input: 'raw' }
    );
    expect(r.status).toBe(0);
    expect(get('B64').stdout.trim()).toBe(
      Buffer.from('raw').toString('base64')
    );
  });

  it('refuses a value argument together with --value-stdin', () => {
    const r = cli(
      ['set', 'X', 'inline', '--value-stdin', '-e', 'dev', '-v', vaultPath],
      { input: 'piped' }
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/only one of/i);
  });

  it('refuses --password-stdin together with --value-stdin', () => {
    const r = cli(
      [
        'set',
        'X',
        '--value-stdin',
        '--password-stdin',
        '-e',
        'dev',
        '-v',
        vaultPath,
      ],
      { input: 'piped' }
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/both read stdin/i);
  });

  it('requires a non-interactive password source', () => {
    const env = { ...process.env };
    delete env.VAULT_ENV_PASSWORD;
    const r = spawnSync(
      NODE,
      [CLI, 'env', 'set', 'X', '--value-stdin', '-e', 'dev', '-v', vaultPath],
      { encoding: 'utf8', input: 'piped', env }
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/--password-file or VAULT_ENV_PASSWORD/);
  });

  it('refuses an empty stdin without changing anything', () => {
    const r = cli(
      ['set', 'EMPTY', '--value-stdin', '-e', 'dev', '-v', vaultPath],
      { input: '' }
    );
    expect(r.status).toBe(1);
    expect(get('EMPTY').status).not.toBe(0);
  });
});
