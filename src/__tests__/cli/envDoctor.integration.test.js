// @vitest-environment node
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from 'vitest';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { seedVault, removeSeed } from '../helpers/seedVault.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '../../../bin/cli.js');
const NODE = process.execPath;
const PASSWORD = 'TestVault123!@#';

let projectDir;
let seedPath;

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

// Built once; each test gets a copy (see helpers/seedVault.js).
beforeAll(() => {
  seedPath = seedVault(PASSWORD, [
    ['init', '-v', '{vault}'],
    ['set', 'API_URL', 'https://api.example.com', '-e', 'dev', '-v', '{vault}'],
  ]);
});
afterAll(() => removeSeed(seedPath));

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-doctor-'));
  fs.mkdirSync(path.join(projectDir, '.git')); // stop .vaultrc walk-up here
  // A vault with the app key set, but NOT the Firebase blob.
  fs.copyFileSync(seedPath, path.join(projectDir, '.env.vault'));
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

  // Task 8: the lock is reported, never removed.
  // The CLI runs in the real path (/private/var/… on macOS).
  const lockFile = () =>
    path.join(fs.realpathSync(projectDir), '.env.vault.lock');
  const writeLock = (pid) =>
    fs.writeFileSync(
      lockFile(),
      JSON.stringify({
        v: 1,
        pid,
        host: os.hostname(),
        tool: 'cli',
        nonce: 'n',
        boot: new Date(Date.now() - os.uptime() * 1000).toISOString(),
        acquiredAt: new Date().toISOString(),
      })
    );

  it('reports no lock with -v and no .vaultrc', () => {
    const r = cli(['doctor', '-v', '.env.vault']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/No write lock on the vault/);
  });

  it('warns about a lock whose process is dead, and leaves it', () => {
    const dead = spawnSync(NODE, ['-e', '']).pid; // has exited
    writeLock(dead);
    const r = cli(['doctor', '-v', '.env.vault']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(
      new RegExp(`Stale write lock left by cli pid ${dead}`)
    );
    expect(r.stdout).toContain(lockFile());
    expect(fs.existsSync(lockFile())).toBe(true);
  });

  it("reports a live holder with the busy error's remedy", () => {
    writeLock(process.pid); // this test runner: alive
    writeManifest([{ path: '.env', format: 'dotenv', keys: ['API_URL'] }]);
    fs.writeFileSync(path.join(projectDir, '.gitignore'), '.env\n');
    const r = cli(['doctor']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(
      new RegExp(`Vault is being written: locked by cli pid ${process.pid}`)
    );
    expect(r.stdout).toContain(
      `If no vault command is running, remove ${lockFile()}.`
    );
    expect(fs.existsSync(lockFile())).toBe(true);
  });

  it('lists a leftover takeover file', () => {
    const aside = `${lockFile()}.stale.0a1b`;
    fs.writeFileSync(aside, '{}');
    const r = cli(['doctor', '-v', '.env.vault']);
    expect(r.stdout).toMatch(/Leftover lock file from an interrupted takeover/);
    expect(r.stdout).toContain(aside);
    expect(fs.existsSync(aside)).toBe(true);
  });
});
