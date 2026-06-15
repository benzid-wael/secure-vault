// @vitest-environment node
//
// Errors must be written to stderr (fd 2), not stdout (fd 1). Stdout is
// reserved for command data (exported dotenv, `get` values, JSON output) so
// that shell pipelines like `vault env export prod > .env` capture only data
// and never get a diagnostic spliced into the file on failure.
//
// These tests spawn the real CLI and assert each error path keeps stdout
// clean while surfacing the diagnostic on stderr.
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
let emptyDir;

// Run `vault env …`. By default no password is supplied in the environment, so
// callers pass one explicitly via stdin (`--password-stdin`) where needed.
function cli(args, { input, env, cwd } = {}) {
  return spawnSync(NODE, [CLI, 'env', ...args], {
    encoding: 'utf8',
    input,
    cwd,
    env: { ...process.env, ...env },
  });
}

beforeAll(() => {
  vaultPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'sv-errstream-')),
    'test.env.vault'
  );
  emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-errstream-empty-'));

  // A known-good vault encrypted with PASSWORD, holding one env with one var.
  cli(['init', '-v', vaultPath], { env: { VAULT_ENV_PASSWORD: PASSWORD } });
  cli(['set', 'TOKEN', 'sekret', '-e', 'dev', '-v', vaultPath], {
    env: { VAULT_ENV_PASSWORD: PASSWORD },
  });
});

afterAll(() => {
  for (const dir of [vaultPath && path.dirname(vaultPath), emptyDir]) {
    try {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe('CLI error output goes to stderr, not stdout', () => {
  it('env list with the wrong password writes the error to stderr only', () => {
    const r = cli(['list', '-v', vaultPath, '--password-stdin'], {
      input: 'wrong-password',
    });
    expect(r.status).toBe(6); // ENV_VAULT_DECRYPT_FAILED
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/decrypt|wrong password/i);
  });

  it('env list with no vault file writes the error to stderr only', () => {
    // Run from a directory with no .env.vault and no -v/-n override so vault
    // resolution fails. A password is supplied via stdin because loadVault()
    // resolves the password before the vault path; without one the command
    // would block on the interactive prompt.
    const r = cli(['list', '--password-stdin'], {
      cwd: emptyDir,
      input: PASSWORD,
    });
    expect(r.status).toBe(5); // ENV_VAULT_NOT_FOUND
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/No vault found/i);
  });

  it('env export with the wrong password keeps stdout clean (does not pollute a redirected file)', () => {
    const r = cli(
      [
        'export',
        'dev',
        '-v',
        vaultPath,
        '--password-stdin',
        '--format',
        'dotenv',
      ],
      { input: 'wrong-password' }
    );
    expect(r.status).toBe(6); // ENV_VAULT_DECRYPT_FAILED
    // Critical: stdout would have been redirected into the .env file.
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/decrypt|wrong password/i);
  });

  it('env export with the correct password still writes data to stdout', () => {
    const r = cli(
      [
        'export',
        'dev',
        '-v',
        vaultPath,
        '--password-stdin',
        '--format',
        'dotenv',
      ],
      { input: PASSWORD }
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('TOKEN=');
    expect(r.stderr).toBe('');
  });

  it('env get on a missing key writes the error to stderr only', () => {
    const r = cli(
      ['get', 'NOPE', '-e', 'dev', '-v', vaultPath, '--password-stdin'],
      {
        input: PASSWORD,
      }
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).not.toBe('');
  });

  it('env run with no command writes the usage error to stderr only', () => {
    const r = cli(['run', 'dev', '-v', vaultPath, '--password-stdin'], {
      input: PASSWORD,
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/No command/i);
  });
});
