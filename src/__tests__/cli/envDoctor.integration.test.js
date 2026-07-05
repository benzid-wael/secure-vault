// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '../../../bin/cli.js');
const NODE = process.execPath;
const PASSWORD = 'TestVault123!@#';

let projectDir;

function cli(args, { cwd = projectDir, withPassword = false } = {}) {
  const env = { ...process.env };
  if (withPassword) env.VAULT_ENV_PASSWORD = PASSWORD;
  else delete env.VAULT_ENV_PASSWORD;
  return spawnSync(NODE, [CLI, 'env', ...args], { encoding: 'utf8', cwd, env });
}

function writeManifest(deliver) {
  fs.writeFileSync(
    path.join(projectDir, '.vaultrc'),
    JSON.stringify({ env: 'dev', vault: '.env.vault', deliver }, null, 2)
  );
}

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-doctor-'));
  fs.mkdirSync(path.join(projectDir, '.git')); // stop .vaultrc walk-up here
  // A vault with the app key set, but NOT the Firebase blob.
  cli(['init', '-v', '.env.vault'], { withPassword: true });
  cli(
    [
      'set',
      'API_URL',
      'https://api.example.com',
      '-e',
      'dev',
      '-v',
      '.env.vault',
    ],
    {
      withPassword: true,
    }
  );
  fs.writeFileSync(
    path.join(projectDir, 'Secrets.xcconfig.vtpl'),
    'API_URL = {{API_URL}}\n'
  );
});

afterEach(() => {
  try {
    fs.rmSync(projectDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('vault env doctor (integration)', () => {
  it('exits 0 with a friendly note when there is no .vaultrc', () => {
    fs.rmSync(path.join(projectDir, 'Secrets.xcconfig.vtpl'));
    const r = cli(['doctor']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/No .vaultrc found/);
  });

  it('passes structural checks without a password and skips resolution', () => {
    writeManifest([{ path: '.env', format: 'dotenv', keys: ['API_URL'] }]);
    fs.writeFileSync(path.join(projectDir, '.gitignore'), '.env\n');
    const r = cli(['doctor']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Manifest valid/);
    expect(r.stdout).toMatch(/Variable resolution skipped/);
  });

  it('warns when a delivered artifact is not git-ignored', () => {
    writeManifest([{ path: '.env', format: 'dotenv', keys: ['API_URL'] }]);
    // no .gitignore at all
    const r = cli(['doctor']);
    expect(r.status).toBe(0); // warning, not error
    expect(r.stdout).toMatch(/not in .gitignore: .env/);
  });

  it('errors (exit 1) when a template file is missing', () => {
    writeManifest([{ template: 'missing/Nope.xcconfig.vtpl' }]);
    const r = cli(['doctor']);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/Template not found: missing\/Nope.xcconfig.vtpl/);
  });

  it('errors (exit 1) on an invalid manifest', () => {
    writeManifest([{ path: 'x' }]);
    const r = cli(['doctor']);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/Delivery manifest is invalid/);
  });

  it('with a password, flags a manifest variable that is not set', () => {
    // GOOGLE_PLIST is referenced but never set → resolution error
    writeManifest([
      { path: '.env', format: 'dotenv', keys: ['API_URL'] },
      { path: 'g.plist', from: 'GOOGLE_PLIST', decode: 'base64' },
    ]);
    fs.writeFileSync(path.join(projectDir, '.gitignore'), '.env\ng.plist\n');
    const r = cli(['doctor'], { withPassword: true });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/undefined variables: GOOGLE_PLIST/);
  });

  it('with a password and everything set, reports all green', () => {
    writeManifest([
      { path: '.env', format: 'dotenv', keys: ['API_URL'] },
      { template: 'Secrets.xcconfig.vtpl' },
    ]);
    fs.writeFileSync(
      path.join(projectDir, '.gitignore'),
      '.env\nSecrets.xcconfig\n'
    );
    const r = cli(['doctor'], { withPassword: true });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/All manifest variables resolve/);
  });
});
