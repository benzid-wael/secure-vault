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
let vaultPath;

// Run the CLI with cwd set to the project dir so .vaultrc discovery + relative
// artifact paths behave like a real invocation.
function cli(args, { cwd = projectDir } = {}) {
  return spawnSync(NODE, [CLI, 'env', ...args], {
    encoding: 'utf8',
    cwd,
    env: { ...process.env, VAULT_ENV_PASSWORD: PASSWORD },
  });
}

const PLIST = Buffer.from('<plist>gs\x00info</plist>', 'utf-8');

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-apply-'));
  // Mark the project root so .vaultrc walk-up stops here.
  fs.mkdirSync(path.join(projectDir, '.git'));
  vaultPath = path.join(projectDir, 'test.env.vault');

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
  cli([
    'set',
    'SENTRY_DSN',
    'https://sentry.example',
    '-e',
    'dev',
    '-v',
    vaultPath,
  ]);
  cli([
    'set',
    'GOOGLE_PLIST',
    PLIST.toString('base64'),
    '-e',
    'dev',
    '-v',
    vaultPath,
  ]);

  fs.mkdirSync(path.join(projectDir, 'ios'), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, 'ios/Secrets.xcconfig.vtpl'),
    'API_URL = {{API_URL}}\nSENTRY_DSN = {{SENTRY_DSN}}\n'
  );

  const manifest = {
    env: 'dev',
    vault: vaultPath,
    deliver: [
      {
        path: '.env.development',
        format: 'dotenv',
        keys: ['API_URL', 'SENTRY_DSN'],
      },
      {
        path: 'ios/GoogleService-Info.plist',
        from: 'GOOGLE_PLIST',
        decode: 'base64',
      },
      { template: 'ios/Secrets.xcconfig.vtpl' },
    ],
  };
  fs.writeFileSync(
    path.join(projectDir, '.vaultrc'),
    JSON.stringify(manifest, null, 2)
  );
});

afterEach(() => {
  try {
    fs.rmSync(projectDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('vault env apply / clean (integration)', () => {
  it('fans out every artifact from the manifest with correct content and perms', () => {
    const r = cli(['apply']);
    expect(r.status).toBe(0);

    const dotenv = fs.readFileSync(
      path.join(projectDir, '.env.development'),
      'utf-8'
    );
    expect(dotenv).toBe(
      'API_URL=https://api.example.com\nSENTRY_DSN=https://sentry.example\n'
    );

    const plist = fs.readFileSync(
      path.join(projectDir, 'ios/GoogleService-Info.plist')
    );
    expect(plist.equals(PLIST)).toBe(true);

    const xcconfig = fs.readFileSync(
      path.join(projectDir, 'ios/Secrets.xcconfig'),
      'utf-8'
    );
    expect(xcconfig).toBe(
      'API_URL = https://api.example.com\nSENTRY_DSN = https://sentry.example\n'
    );

    // eslint-disable-next-line no-bitwise
    const mode =
      fs.statSync(path.join(projectDir, '.env.development')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('resolves the same manifest from a subdirectory', () => {
    const sub = path.join(projectDir, 'ios');
    const r = cli(['apply'], { cwd: sub });
    expect(r.status).toBe(0);
    // path is relative to .vaultrc (project root), not cwd
    expect(fs.existsSync(path.join(projectDir, '.env.development'))).toBe(true);
  });

  it('--dry-run writes nothing but still validates', () => {
    const r = cli(['apply', '--dry-run']);
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(projectDir, '.env.development'))).toBe(
      false
    );
    expect(r.stdout).toMatch(/would write .env.development/);
  });

  it('clean removes exactly the manifest artifacts', () => {
    cli(['apply']);
    expect(fs.existsSync(path.join(projectDir, '.env.development'))).toBe(true);

    const r = cli(['clean']);
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(projectDir, '.env.development'))).toBe(
      false
    );
    expect(
      fs.existsSync(path.join(projectDir, 'ios/GoogleService-Info.plist'))
    ).toBe(false);
    expect(fs.existsSync(path.join(projectDir, 'ios/Secrets.xcconfig'))).toBe(
      false
    );
    // the template source is NOT an artifact and must survive
    expect(
      fs.existsSync(path.join(projectDir, 'ios/Secrets.xcconfig.vtpl'))
    ).toBe(true);
  });

  it('fails when a template references an undefined variable', () => {
    fs.writeFileSync(
      path.join(projectDir, 'ios/Secrets.xcconfig.vtpl'),
      'X = {{DOES_NOT_EXIST}}\n'
    );
    const r = cli(['apply']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/undefined variable "DOES_NOT_EXIST"/);
  });

  it('fails clearly when a template file is missing', () => {
    fs.rmSync(path.join(projectDir, 'ios/Secrets.xcconfig.vtpl'));
    const r = cli(['apply']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(
      /Cannot read template "ios\/Secrets.xcconfig.vtpl"/
    );
  });

  it('fails clearly on an invalid manifest', () => {
    fs.writeFileSync(
      path.join(projectDir, '.vaultrc'),
      JSON.stringify({ env: 'dev', vault: vaultPath, deliver: [{ path: 'x' }] })
    );
    const r = cli(['apply']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/deliver\[0\]: exactly one of/);
  });
});
