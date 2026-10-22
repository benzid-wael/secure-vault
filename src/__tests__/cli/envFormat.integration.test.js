// @vitest-environment node
// The CLI against a vault from a newer SecureVault (New-29): reads warn,
// writes exit 15 and change nothing, a newer format stops everything.
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
  spawnSync(process.execPath, [CLI, 'env', ...args], {
    encoding: 'utf8',
    cwd: workDir,
    env: { ...process.env, VAULT_ENV_PASSWORD: PASSWORD, NO_COLOR: '1' },
  });

const patchEnvelope = (fields) =>
  fs.writeFileSync(
    vaultPath,
    JSON.stringify({
      ...JSON.parse(fs.readFileSync(vaultPath, 'utf8')),
      ...fields,
    })
  );

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-format-cli-'));
  vaultPath = path.join(workDir, 'test.env.vault');
  expect(cli(['init', '-v', vaultPath]).status).toBe(0);
  expect(cli(['set', 'API', 'x', '-e', 'dev', '-v', vaultPath]).status).toBe(0);
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('a vault using a feature this CLI does not know', () => {
  beforeEach(() => patchEnvelope({ features: ['expiry'] }));

  it('refuses a write with exit 15, the risk and the upgrade', () => {
    const before = fs.readFileSync(vaultPath);
    const r = cli(['set', 'NEW', 'y', '-e', 'dev', '-v', vaultPath]);
    expect(r.status).toBe(15);
    expect(r.stderr).toContain('[ENV_VAULT_NEWER_FORMAT]');
    expect(r.stderr).toContain("doesn't support (expiry)");
    expect(r.stderr).toContain(
      'npm install -g @benzid.wael/secure-vault@latest'
    );
    expect(fs.readFileSync(vaultPath)).toEqual(before);
    expect(cli(['rm', 'API', '-e', 'dev', '-v', vaultPath]).status).toBe(15);
  });

  it('still shows it, with a warning on stderr only', () => {
    const r = cli(['show', 'dev', '-v', vaultPath]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('API');
    expect(r.stdout).not.toContain('expiry');
    expect(r.stderr).toMatch(/^Warning: test\.env\.vault uses features/);
  });

  it('keeps the warning out of --quiet', () => {
    const r = cli(['--quiet', 'get', 'API', '-e', 'dev', '-v', vaultPath]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('is reported by doctor as a warning', () => {
    const r = cli(['doctor', '-v', vaultPath]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(
      /Vault uses features this version doesn't support: expiry/
    );
  });
});

describe('a vault in a newer format', () => {
  beforeEach(() => patchEnvelope({ version: 2 }));

  it('stops reads and writes with exit 15', () => {
    const show = cli(['show', 'dev', '-v', vaultPath]);
    expect(show.status).toBe(15);
    expect(show.stderr).toMatch(/uses vault format 2/);
    expect(cli(['set', 'B', '1', '-e', 'dev', '-v', vaultPath]).status).toBe(
      15
    );
  });

  it('makes doctor fail', () => {
    const r = cli(['doctor', '-v', vaultPath]);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/Vault format 2 is newer than this version reads/);
  });
});

describe('doctor on a current vault', () => {
  it('names the format and the features in use', () => {
    expect(cli(['doctor', '-v', vaultPath]).stdout).toMatch(
      /✔ Vault format 1\n/
    );
    cli(['set', 'API', 'x', '--comment', 'why', '-e', 'dev', '-v', vaultPath]);
    expect(cli(['doctor', '-v', vaultPath]).stdout).toContain(
      'Vault format 1 (uses key comments)'
    );
  });
});
