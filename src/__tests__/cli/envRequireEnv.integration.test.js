// @vitest-environment node
//
// There is no implicit "default" environment: every command must be told which
// environment to act on, via a positional arg / -e flag, or VAULT_ENV. These
// tests lock in that contract for a representative command of each shape.
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

// Run the CLI with VAULT_ENV explicitly removed unless provided, so the parent
// shell's VAULT_ENV can never mask a missing-env assertion.
function cli(args, extraEnv = {}) {
  const env = { ...process.env, VAULT_ENV_PASSWORD: PASSWORD };
  delete env.VAULT_ENV;
  return spawnSync(NODE, [CLI, 'env', ...args], {
    encoding: 'utf8',
    env: { ...env, ...extraEnv },
  });
}

beforeAll(() => {
  vaultPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'sv-reqenv-')),
    'test.env.vault'
  );
  cli(['init', '-v', vaultPath]);
  cli([
    'set',
    'API_URL',
    'https://api.example.com',
    '-e',
    'dev',
    '-v',
    vaultPath,
  ]);
});

afterAll(() => {
  try {
    fs.rmSync(path.dirname(vaultPath), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('explicit environment is required (no implicit "default")', () => {
  it('show errors when neither a positional env nor VAULT_ENV is given', () => {
    const r = cli(['show', '-v', vaultPath]);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/no environment/i);
    // It must not silently fall back to a "default" environment.
    expect(r.stdout + r.stderr).not.toMatch(/'default'/i);
  });

  it('set errors (and creates nothing) when no -e and no VAULT_ENV', () => {
    const r = cli(['set', 'SHOULD_NOT_PERSIST', 'x', '-v', vaultPath]);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/no environment/i);
    // No 'default' env should have been auto-created by the failed write.
    const list = cli(['list', '-v', vaultPath, '--json']);
    expect(list.stdout).not.toMatch(/"default"/);
  });

  it('get honors an explicit -e flag', () => {
    const r = cli(['get', 'API_URL', '-e', 'dev', '-v', vaultPath]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('https://api.example.com');
  });

  it('show honors VAULT_ENV when no positional env is given', () => {
    const r = cli(['show', '-v', vaultPath], { VAULT_ENV: 'dev' });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/API_URL/);
  });

  it('an explicit env overrides VAULT_ENV', () => {
    // VAULT_ENV points at a nonexistent env; the positional 'dev' must win and
    // succeed, proving the explicit value takes precedence.
    const r = cli(['show', 'dev', '-v', vaultPath], { VAULT_ENV: 'nope' });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/API_URL/);
  });
});
