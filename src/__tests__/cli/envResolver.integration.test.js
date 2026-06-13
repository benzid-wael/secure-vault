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

let vaultPath;

function cli(args, extraEnv = {}) {
  // Insert `-v <vaultPath>` before any `--` so `run` never swallows it into
  // the child command.
  const sep = args.indexOf('--');
  const withVault =
    sep === -1
      ? [...args, '-v', vaultPath]
      : [...args.slice(0, sep), '-v', vaultPath, ...args.slice(sep)];
  return spawnSync(NODE, [CLI, 'env', ...withVault], {
    encoding: 'utf8',
    env: { ...process.env, VAULT_ENV_PASSWORD: PASSWORD, ...extraEnv },
  });
}

beforeAll(() => {
  vaultPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'sv-resolver-')),
    'test.env.vault'
  );

  // base → staging → dev, with a template ref from dev into staging.
  cli(['init']);
  cli(['set', 'PORT', '3000', '-e', 'base', '--public', '--required']);
  cli([
    'set',
    'API_URL',
    'https://staging.example.com',
    '-e',
    'staging',
    '--public',
  ]);
  cli(['extends', 'staging', 'base']);
  cli([
    'set',
    'DB_URL',
    '{{env:staging/API_URL}}',
    '-e',
    'dev',
    '--extends',
    'staging',
  ]);
});

afterAll(() => {
  try {
    fs.rmSync(path.dirname(vaultPath), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('vault env resolution (layering + templates)', () => {
  it('export resolves inherited and templated vars', () => {
    const r = cli(['export', 'dev', '--format', 'json']);
    expect(r.status).toBe(0);
    const vars = JSON.parse(r.stdout);
    expect(vars.PORT).toBe('3000'); // inherited from base
    expect(vars.API_URL).toBe('https://staging.example.com'); // from staging
    expect(vars.DB_URL).toBe('https://staging.example.com'); // template resolved
  });

  it('run injects the resolved environment', () => {
    const r = cli([
      'run',
      'dev',
      '--',
      NODE,
      '-e',
      'process.stdout.write(JSON.stringify({DB:process.env.DB_URL,PORT:process.env.PORT}))',
    ]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      DB: 'https://staging.example.com',
      PORT: '3000',
    });
  });

  it('validate passes with the aggregated required key satisfied', () => {
    const r = cli(['validate', 'dev']);
    expect(r.status).toBe(0); // PORT (required in base) is present after layering
    expect(r.stdout).toContain('required');
  });

  it('validate flags an unresolved reference as an error', () => {
    const broken = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'sv-broken-')),
      'b.env.vault'
    );
    const run = (args) =>
      spawnSync(NODE, [CLI, 'env', ...args, '-v', broken], {
        encoding: 'utf8',
        env: { ...process.env, VAULT_ENV_PASSWORD: PASSWORD },
      });
    run(['init']);
    run(['set', 'X', '{{env:ghost/Y}}', '-e', 'dev']);

    const r = run(['validate', 'dev']);
    expect(r.status).toBe(1); // errors → exit 1
    expect(r.stdout).toMatch(/not found/i);

    fs.rmSync(path.dirname(broken), { recursive: true, force: true });
  });

  it('writes a .bak after a mutating write', () => {
    expect(fs.existsSync(`${vaultPath}.bak`)).toBe(true);
  });
});
