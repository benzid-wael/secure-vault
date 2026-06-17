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
    fs.mkdtempSync(path.join(os.tmpdir(), 'sv-shell-')),
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
    '--public',
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

// Run `vault env shell` with a non-interactive shell that executes one command
// and exits. This lets us inspect the environment without actually going interactive.
function shellRun(envName, shellCmd, extraArgs = [], extraEnv = {}) {
  return spawnSync(
    NODE,
    [CLI, 'env', 'shell', envName, '-v', vaultPath, ...extraArgs],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        VAULT_ENV_PASSWORD: PASSWORD,
        // Point SHELL at a wrapper that runs shellCmd then exits immediately.
        SHELL: `${process.execPath}`,
        ...extraEnv,
      },
      // Pipe stdin so the shell exits immediately when stdin closes.
      input: '',
    }
  );
}

describe('vault env shell (integration)', () => {
  it('injects vault vars into the shell environment', () => {
    // Use node as the "shell" so we can inspect process.env without interaction.
    const r = spawnSync(NODE, [CLI, 'env', 'shell', 'dev', '-v', vaultPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        VAULT_ENV_PASSWORD: PASSWORD,
        SHELL: NODE,
      },
      // Pass a node script via stdin — node reads from stdin when no file arg is given.
      input:
        'process.stdout.write(JSON.stringify(process.env)); process.exit(0);',
    });
    expect(r.status).toBe(0);
    const env = JSON.parse(r.stdout.replace(/^[^\{]*/, '')); // strip banner
    expect(env.API_URL).toBe('https://api.example.com');
    expect(env.TOKEN).toBe('sekret');
  });

  it('sets VAULT_SHELL=1 and VAULT_SHELL_ENV in the shell environment', () => {
    const r = spawnSync(NODE, [CLI, 'env', 'shell', 'dev', '-v', vaultPath], {
      encoding: 'utf8',
      env: { ...process.env, VAULT_ENV_PASSWORD: PASSWORD, SHELL: NODE },
      input:
        'process.stdout.write(JSON.stringify(process.env)); process.exit(0);',
    });
    expect(r.status).toBe(0);
    const env = JSON.parse(r.stdout.replace(/^[^\{]*/, ''));
    expect(env.VAULT_SHELL).toBe('1');
    expect(env.VAULT_SHELL_ENV).toBe('dev');
  });

  it('clean mode does not leak parent env vars beyond the allowlist', () => {
    const r = spawnSync(
      NODE,
      [CLI, 'env', 'shell', 'dev', '-v', vaultPath, '--inject', 'clean'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          VAULT_ENV_PASSWORD: PASSWORD,
          SHELL: NODE,
          SECRET_SHOULD_NOT_LEAK: 'leaked',
        },
        input:
          'process.stdout.write(JSON.stringify(process.env)); process.exit(0);',
      }
    );
    expect(r.status).toBe(0);
    const env = JSON.parse(r.stdout.replace(/^[^\{]*/, ''));
    expect(env.SECRET_SHOULD_NOT_LEAK).toBeUndefined();
    expect(env.API_URL).toBe('https://api.example.com');
  });

  it('merge mode inherits parent env vars', () => {
    const r = spawnSync(
      NODE,
      [CLI, 'env', 'shell', 'dev', '-v', vaultPath, '--inject', 'merge'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          VAULT_ENV_PASSWORD: PASSWORD,
          SHELL: NODE,
          MY_CUSTOM_VAR: 'hello',
        },
        input:
          'process.stdout.write(JSON.stringify(process.env)); process.exit(0);',
      }
    );
    expect(r.status).toBe(0);
    const env = JSON.parse(r.stdout.replace(/^[^\{]*/, ''));
    expect(env.MY_CUSTOM_VAR).toBe('hello');
    expect(env.API_URL).toBe('https://api.example.com');
  });

  it('rejects --inject file mode', () => {
    const r = spawnSync(
      NODE,
      [CLI, 'env', 'shell', 'dev', '-v', vaultPath, '--inject', 'file'],
      {
        encoding: 'utf8',
        env: { ...process.env, VAULT_ENV_PASSWORD: PASSWORD, SHELL: NODE },
        input: '',
      }
    );
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/clean\|merge/);
  });

  it('exits 1 when no envName and no VAULT_ENV', () => {
    const env = { ...process.env, VAULT_ENV_PASSWORD: PASSWORD };
    delete env.VAULT_ENV;
    const r = spawnSync(NODE, [CLI, 'env', 'shell', '-v', vaultPath], {
      encoding: 'utf8',
      env,
    });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/No environment specified/i);
  });
});
