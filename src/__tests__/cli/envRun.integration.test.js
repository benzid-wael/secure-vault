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
    const r = cli([
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
      // File mode is now clean-isolated (vault vars are injected, but the
      // parent env is NOT passed through), so the child cannot rely on an
      // inherited env var to locate the file — read the literal path instead.
      `process.stdout.write(require('fs').readFileSync(${JSON.stringify(envFile)},'utf8'))`,
    ]);
    expect(r.status).toBe(0);
    // The child saw the decrypted vars via the file...
    expect(r.stdout).toContain('API_URL=https://api.example.com');
    // ...and the file is securely deleted once the child exits.
    expect(fs.existsSync(envFile)).toBe(false);
  });

  it('file mode does not leak the parent env to the child (clean isolation)', () => {
    const envFile = path.join(path.dirname(vaultPath), 'out2.env');
    const r = cli([
      'run',
      'dev',
      '--inject',
      'file',
      '--out-file',
      envFile,
      '-v',
      vaultPath,
      '--',
      ...PRINT_ENV,
    ]);
    expect(r.status).toBe(0);
    const env = JSON.parse(r.stdout);
    // Vault vars are injected into the process env...
    expect(env.API_URL).toBe('https://api.example.com');
    // ...but the parent's password must NOT leak (was the file-mode bug).
    expect(env.VAULT_ENV_PASSWORD).toBeUndefined();
    expect(fs.existsSync(envFile)).toBe(false);
  });

  it('--export writes the file, sets ENV_FILE_PATH, injects clean vars, and deletes after', () => {
    const envFile = path.join(path.dirname(vaultPath), 'exp.env');
    const r = cli([
      'run',
      'dev',
      '--export',
      envFile,
      '-v',
      vaultPath,
      '--',
      NODE,
      '-e',
      // The child finds the file via ENV_FILE_PATH (no hardcoded path).
      `const fs=require('fs');` +
        `process.stdout.write('FILE:'+fs.readFileSync(process.env.ENV_FILE_PATH,'utf8'));` +
        `process.stdout.write('ENVVAR:'+process.env.API_URL)`,
    ]);
    expect(r.status).toBe(0);
    // File contains the resolved vars...
    expect(r.stdout).toContain('FILE:');
    expect(r.stdout).toContain('API_URL=https://api.example.com');
    // ...and the vars are ALSO injected into the (clean) process env.
    expect(r.stdout).toContain('ENVVAR:https://api.example.com');
    // ENV_FILE_PATH points at the export path.
    // File is securely deleted once the child exits.
    expect(fs.existsSync(envFile)).toBe(false);
  });

  it('--export composes with --inject merge (file written + parent env inherited)', () => {
    const envFile = path.join(path.dirname(vaultPath), 'exp-merge.env');
    const r = cli([
      'run',
      'dev',
      '--inject',
      'merge',
      '--export',
      envFile,
      '-v',
      vaultPath,
      '--',
      ...PRINT_ENV,
    ]);
    expect(r.status).toBe(0);
    const env = JSON.parse(r.stdout);
    expect(env.API_URL).toBe('https://api.example.com'); // vault var
    expect(env.VAULT_ENV_PASSWORD).toBe(PASSWORD); // inherited (merge)
    expect(env.ENV_FILE_PATH).toBe(envFile); // pointer set
    expect(fs.existsSync(envFile)).toBe(false); // deleted after exit
  });

  it('--export securely deletes the file even when the child fails', () => {
    const envFile = path.join(path.dirname(vaultPath), 'exp-fail.env');
    const r = cli([
      'run',
      'dev',
      '--export',
      envFile,
      '-v',
      vaultPath,
      '--',
      NODE,
      '-e',
      'process.exit(3)',
    ]);
    expect(r.status).toBe(3);
    expect(fs.existsSync(envFile)).toBe(false);
  });

  it('--export refuses to overwrite an existing file without --force, leaving it intact', () => {
    const envFile = path.join(path.dirname(vaultPath), 'existing.env');
    fs.writeFileSync(envFile, 'PRECIOUS=keepme\n');
    const r = cli([
      'run',
      'dev',
      '--export',
      envFile,
      '-v',
      vaultPath,
      '--',
      NODE,
      '-e',
      '0',
    ]);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/Refusing to overwrite/i);
    // The pre-existing file must NOT be touched or deleted.
    expect(fs.existsSync(envFile)).toBe(true);
    expect(fs.readFileSync(envFile, 'utf8')).toBe('PRECIOUS=keepme\n');
    fs.rmSync(envFile);
  });

  it('--export --force overwrites an existing file and securely deletes it after', () => {
    const envFile = path.join(path.dirname(vaultPath), 'existing2.env');
    fs.writeFileSync(envFile, 'OLD=stuff\n');
    const r = cli([
      'run',
      'dev',
      '--export',
      envFile,
      '--force',
      '-v',
      vaultPath,
      '--',
      NODE,
      '-e',
      '0',
    ]);
    expect(r.status).toBe(0);
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

  it('.vaultrc inject default is applied when no --inject flag is passed', () => {
    const rcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-rc-'));
    const rcPath = path.join(rcDir, '.vaultrc');
    fs.writeFileSync(rcPath, JSON.stringify({ inject: 'merge' }));
    try {
      const r = spawnSync(
        NODE,
        [CLI, 'env', 'run', 'dev', '-v', vaultPath, '--', ...PRINT_ENV],
        {
          encoding: 'utf8',
          cwd: rcDir,
          env: { ...process.env, VAULT_ENV_PASSWORD: PASSWORD },
        }
      );
      expect(r.status).toBe(0);
      const env = JSON.parse(r.stdout);
      // merge mode: VAULT_ENV_PASSWORD should be inherited from parent
      expect(env.VAULT_ENV_PASSWORD).toBe(PASSWORD);
    } finally {
      fs.rmSync(rcDir, { recursive: true, force: true });
    }
  });

  it('.vaultrc is ignored when CLI flag explicitly overrides it', () => {
    const rcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-rc-'));
    const rcPath = path.join(rcDir, '.vaultrc');
    fs.writeFileSync(rcPath, JSON.stringify({ inject: 'merge' }));
    try {
      const r = spawnSync(
        NODE,
        [
          CLI,
          'env',
          'run',
          'dev',
          '--inject',
          'clean',
          '-v',
          vaultPath,
          '--',
          ...PRINT_ENV,
        ],
        {
          encoding: 'utf8',
          cwd: rcDir,
          env: { ...process.env, VAULT_ENV_PASSWORD: PASSWORD },
        }
      );
      expect(r.status).toBe(0);
      const env = JSON.parse(r.stdout);
      // clean mode wins: VAULT_ENV_PASSWORD must not leak
      expect(env.VAULT_ENV_PASSWORD).toBeUndefined();
    } finally {
      fs.rmSync(rcDir, { recursive: true, force: true });
    }
  });

  it('exits 1 with a clear message on invalid .vaultrc JSON', () => {
    const rcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-rc-'));
    fs.writeFileSync(path.join(rcDir, '.vaultrc'), '{ bad json }');
    try {
      const r = spawnSync(
        NODE,
        [CLI, 'env', 'run', 'dev', '-v', vaultPath, '--', NODE, '-e', '0'],
        {
          encoding: 'utf8',
          cwd: rcDir,
          env: { ...process.env, VAULT_ENV_PASSWORD: PASSWORD },
        }
      );
      expect(r.status).toBe(1);
      expect(r.stdout + r.stderr).toMatch(/Invalid JSON/i);
    } finally {
      fs.rmSync(rcDir, { recursive: true, force: true });
    }
  });

  it('VAULT_ENV is used when no envName argument is passed', () => {
    const r = cli(['run', '-v', vaultPath, '--', ...PRINT_ENV], {
      VAULT_ENV: 'dev',
    });
    expect(r.status).toBe(0);
    const env = JSON.parse(r.stdout);
    expect(env.API_URL).toBe('https://api.example.com');
  });

  it('positional envName overrides VAULT_ENV', () => {
    // 'dev' has API_URL; there is no 'other' env so it should error — proving
    // the positional arg was used instead of falling back to VAULT_ENV=dev.
    const r = cli(['run', 'nonexistent', '-v', vaultPath, '--', ...PRINT_ENV], {
      VAULT_ENV: 'dev',
    });
    expect(r.status).not.toBe(0);
  });

  it('errors with "no environment" when neither envName arg nor VAULT_ENV is set', () => {
    // The `--` is a hard wall: the command after it is never consulted for the
    // env name. With no positional env and no VAULT_ENV, this must fail with a
    // clear "no environment" message — not silently treat a command token as
    // the env name.
    const env = { ...process.env, VAULT_ENV_PASSWORD: PASSWORD };
    delete env.VAULT_ENV;
    const r = spawnSync(
      NODE,
      [CLI, 'env', 'run', '-v', vaultPath, '--', ...PRINT_ENV],
      {
        encoding: 'utf8',
        env,
      }
    );
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/no environment/i);
  });

  it('does not consume a post-`--` token as the env name (run -- vault env list)', () => {
    // Regression: `vault env run -- vault env list` used to resolve env="vault"
    // and report "Environment 'vault' not found". It must report a missing
    // environment instead, never interpreting the command as the env name.
    const env = { ...process.env, VAULT_ENV_PASSWORD: PASSWORD };
    delete env.VAULT_ENV;
    const r = spawnSync(
      NODE,
      [CLI, 'env', 'run', '-v', vaultPath, '--', 'vault', 'env', 'list'],
      { encoding: 'utf8', env }
    );
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/no environment/i);
    expect(r.stdout + r.stderr).not.toMatch(/'vault' not found/i);
  });

  it('VAULT_INJECT sets the injection mode', () => {
    const r = cli(['run', 'dev', '-v', vaultPath, '--', ...PRINT_ENV], {
      VAULT_INJECT: 'merge',
    });
    expect(r.status).toBe(0);
    const env = JSON.parse(r.stdout);
    expect(env.VAULT_ENV_PASSWORD).toBe(PASSWORD);
  });

  it('--inject flag overrides VAULT_INJECT', () => {
    const r = cli(
      ['run', 'dev', '--inject', 'clean', '-v', vaultPath, '--', ...PRINT_ENV],
      { VAULT_INJECT: 'merge' }
    );
    expect(r.status).toBe(0);
    const env = JSON.parse(r.stdout);
    expect(env.VAULT_ENV_PASSWORD).toBeUndefined();
  });

  it('--dry-run prints vault vars without spawning the command', () => {
    const r = cli(['run', 'dev', '--dry-run', '-v', vaultPath]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/API_URL/);
    // Sensitive vars must be masked
    expect(r.stdout).not.toMatch(/sekret/);
    expect(r.stdout).toMatch(/\*\*\*\*/);
  });

  it('--dry-run does not require a command argument', () => {
    const r = cli(['run', 'dev', '--dry-run', '-v', vaultPath]);
    expect(r.status).toBe(0);
  });

  it('--dry-run shows public vars in full', () => {
    // Mark API_URL as public first
    cli([
      'set',
      'API_URL',
      'https://api.example.com',
      '-e',
      'dev',
      '-v',
      vaultPath,
      '--public',
    ]);
    const r = cli(['run', 'dev', '--dry-run', '-v', vaultPath]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/API_URL=https:\/\/api\.example\.com/);
  });

  it('--dry-run shows mode in header', () => {
    const r = cli([
      'run',
      'dev',
      '--dry-run',
      '--inject',
      'merge',
      '-v',
      vaultPath,
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/merge/i);
  });
});
