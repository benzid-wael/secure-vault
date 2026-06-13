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
  return spawnSync(NODE, [CLI, 'env', ...args], {
    encoding: 'utf8',
    env: { ...process.env, VAULT_ENV_PASSWORD: PASSWORD, ...extraEnv },
  });
}

beforeAll(() => {
  vaultPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'sv-run-')),
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
  cli(['set', 'TOKEN', 'sekret', '-e', 'dev', '-v', vaultPath]);
});

afterAll(() => {
  try {
    fs.rmSync(path.dirname(vaultPath), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// Print the child's environment as JSON so the test can inspect it.
const PRINT_ENV = [
  NODE,
  '-e',
  'process.stdout.write(JSON.stringify(process.env))',
];

describe('vault env run (integration)', () => {
  it('clean mode injects vault vars and isolates parent env', () => {
    const r = cli(['run', 'dev', '-v', vaultPath, '--', ...PRINT_ENV]);
    expect(r.status).toBe(0);
    const env = JSON.parse(r.stdout);
    expect(env.API_URL).toBe('https://api.example.com');
    expect(env.TOKEN).toBe('sekret');
    expect(env.PATH).toBeTruthy(); // allowlisted system var
    // The parent's password env var must NOT leak into the clean child.
    expect(env.VAULT_ENV_PASSWORD).toBeUndefined();
  });

  it('merge mode inherits the parent env plus vault vars', () => {
    const r = cli([
      'run',
      'dev',
      '--inject',
      'merge',
      '-v',
      vaultPath,
      '--',
      ...PRINT_ENV,
    ]);
    expect(r.status).toBe(0);
    const env = JSON.parse(r.stdout);
    expect(env.API_URL).toBe('https://api.example.com');
    expect(env.VAULT_ENV_PASSWORD).toBe(PASSWORD); // inherited in merge mode
  });

  it('propagates the child exit code', () => {
    const r = cli([
      'run',
      'dev',
      '-v',
      vaultPath,
      '--',
      NODE,
      '-e',
      'process.exit(7)',
    ]);
    expect(r.status).toBe(7);
  });

  it('file mode writes the env file, the child can read it, and it is deleted after', () => {
    const envFile = path.join(path.dirname(vaultPath), 'out.env');
    const r = cli(
      [
        'run',
        'dev',
        '--inject',
        'file',
        '--out-file',
        envFile,
        '-v',
        vaultPath,
        '--',
        NODE,
        '-e',
        // file mode inherits the parent env, so read the path from an env var
        // (avoids ambiguity of passing it as a node script argument).
        `process.stdout.write(require('fs').readFileSync(process.env.EF_PATH,'utf8'))`,
      ],
      { EF_PATH: envFile }
    );
    expect(r.status).toBe(0);
    // The child saw the decrypted vars via the file...
    expect(r.stdout).toContain('API_URL=https://api.example.com');
    // ...and the file is securely deleted once the child exits.
    expect(fs.existsSync(envFile)).toBe(false);
  });

  it('exits 127 when the command is not found', () => {
    const r = cli(['run', 'dev', '-v', vaultPath, '--', 'no-such-cmd-xyz-123']);
    expect(r.status).toBe(127);
  });

  it('rejects --inject file without --out-file', () => {
    const r = cli([
      'run',
      'dev',
      '--inject',
      'file',
      '-v',
      vaultPath,
      '--',
      NODE,
      '-e',
      '0',
    ]);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/--out-file/);
  });

  it('errors when no command is given', () => {
    const r = cli(['run', 'dev', '-v', vaultPath]);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/No command/i);
  });
});
