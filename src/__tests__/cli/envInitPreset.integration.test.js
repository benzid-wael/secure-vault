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

function cli(args, { cwd = projectDir } = {}) {
  return spawnSync(NODE, [CLI, 'env', ...args], {
    encoding: 'utf8',
    cwd,
    env: { ...process.env, VAULT_ENV_PASSWORD: PASSWORD },
  });
}

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-init-preset-'));
});

afterEach(() => {
  try {
    fs.rmSync(projectDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('vault env init --preset react-native (integration)', () => {
  it('creates the vault and scaffolds a working project', () => {
    const r = cli(['init', '-v', '.env.vault', '--preset', 'react-native']);
    expect(r.status).toBe(0);

    // vault + scaffolded files exist
    expect(fs.existsSync(path.join(projectDir, '.env.vault'))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, '.vaultrc'))).toBe(true);
    expect(
      fs.existsSync(path.join(projectDir, 'ios/Config/Secrets.xcconfig.vtpl'))
    ).toBe(true);
    expect(fs.existsSync(path.join(projectDir, 'SECURE_VAULT_SETUP.md'))).toBe(
      true
    );

    // .gitignore covers the delivered artifacts
    const gi = fs.readFileSync(path.join(projectDir, '.gitignore'), 'utf-8');
    expect(gi).toMatch(/^\.env$/m);
    expect(gi).toContain('ios/GoogleService-Info.plist');

    // the scaffolded .vaultrc is valid and immediately usable by apply
    const rc = JSON.parse(
      fs.readFileSync(path.join(projectDir, '.vaultrc'), 'utf-8')
    );
    expect(rc.deliver.length).toBeGreaterThan(0);
  });

  it('scaffolded manifest drives apply end to end', () => {
    cli(['init', '-v', '.env.vault', '--preset', 'react-native']);
    // seed every var the starter manifest references (app keys + Firebase blobs)
    const b64 = Buffer.from('{}').toString('base64');
    const set = (k, v) => cli(['set', k, v, '-e', 'dev', '-v', '.env.vault']);
    set('API_URL', 'https://api.example.com');
    set('SENTRY_DSN', 'https://sentry.example');
    set('GOOGLE_SERVICE_INFO_PLIST', b64);
    set('GOOGLE_SERVICES_JSON', b64);

    const r = cli(['apply', '-v', '.env.vault']);
    expect(r.status).toBe(0);
    const dotenv = fs.readFileSync(path.join(projectDir, '.env'), 'utf-8');
    expect(dotenv).toContain('API_URL=https://api.example.com');
    const xcconfig = fs.readFileSync(
      path.join(projectDir, 'ios/Config/Secrets.xcconfig'),
      'utf-8'
    );
    expect(xcconfig).toContain('API_URL = https://api.example.com');
  });

  it('is non-destructive: existing files are skipped, not clobbered', () => {
    fs.writeFileSync(path.join(projectDir, '.vaultrc'), '{"custom":true}');
    const r = cli(['init', '-v', '.env.vault', '--preset', 'react-native']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/skipped .vaultrc/);
    expect(fs.readFileSync(path.join(projectDir, '.vaultrc'), 'utf-8')).toBe(
      '{"custom":true}'
    );
  });

  it('fails fast on an unknown preset without creating a vault', () => {
    const r = cli(['init', '-v', '.env.vault', '--preset', 'flutter']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Unknown preset "flutter"/);
    expect(fs.existsSync(path.join(projectDir, '.env.vault'))).toBe(false);
  });
});
