// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import fsExtra from 'fs-extra';
import os from 'os';
import path from 'path';

// Mock the interactive prompt so resolvePassword's fallback is observable
// without a TTY. The mock returns a sentinel we can assert on.
vi.mock('@inquirer/password', () => ({
  default: vi.fn(async () => 'PROMPTED'),
}));

import password from '@inquirer/password';
import {
  stripTrailingNewline,
  readPasswordFile,
  readPasswordStdin,
  hasNonInteractivePassword,
  resolvePassword,
} from '../../../bin/commands/env.js';

describe('stripTrailingNewline', () => {
  it('strips a single LF', () => {
    expect(stripTrailingNewline('pw\n')).toBe('pw');
  });

  it('strips a single CRLF', () => {
    expect(stripTrailingNewline('pw\r\n')).toBe('pw');
  });

  it('leaves a string without a trailing newline untouched', () => {
    expect(stripTrailingNewline('pw')).toBe('pw');
  });

  it('preserves interior and edge spaces, stripping only the newline', () => {
    expect(stripTrailingNewline('  pw  \n')).toBe('  pw  ');
  });

  it('strips only ONE trailing newline', () => {
    expect(stripTrailingNewline('pw\n\n')).toBe('pw\n');
  });

  it('handles the empty string', () => {
    expect(stripTrailingNewline('')).toBe('');
  });

  it('reduces a lone newline to empty', () => {
    expect(stripTrailingNewline('\n')).toBe('');
  });
});

describe('readPasswordFile', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-pw-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns the file contents with a trailing newline stripped', () => {
    const file = path.join(dir, 'pw.txt');
    fs.writeFileSync(file, 'super-secret\n');
    expect(readPasswordFile(file)).toBe('super-secret');
  });

  it('preserves leading/trailing spaces in the file body', () => {
    const file = path.join(dir, 'pw.txt');
    fs.writeFileSync(file, '  spaced pw  \n');
    expect(readPasswordFile(file)).toBe('  spaced pw  ');
  });

  it('throws when the file does not exist', () => {
    const missing = path.join(dir, 'nope.txt');
    expect(() => readPasswordFile(missing)).toThrow();
  });
});

describe('hasNonInteractivePassword', () => {
  const ORIGINAL = process.env.VAULT_ENV_PASSWORD;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.VAULT_ENV_PASSWORD;
    else process.env.VAULT_ENV_PASSWORD = ORIGINAL;
  });

  it('is true when --password is set', () => {
    delete process.env.VAULT_ENV_PASSWORD;
    expect(hasNonInteractivePassword({ password: 'x' })).toBe(true);
  });

  it('is true when --password-file is set', () => {
    delete process.env.VAULT_ENV_PASSWORD;
    expect(hasNonInteractivePassword({ passwordFile: '/tmp/x' })).toBe(true);
  });

  it('is true when --password-stdin is set', () => {
    delete process.env.VAULT_ENV_PASSWORD;
    expect(hasNonInteractivePassword({ passwordStdin: true })).toBe(true);
  });

  it('is true when VAULT_ENV_PASSWORD is set', () => {
    process.env.VAULT_ENV_PASSWORD = 'envpw';
    expect(hasNonInteractivePassword({})).toBe(true);
  });

  it('is false with no sources', () => {
    delete process.env.VAULT_ENV_PASSWORD;
    expect(hasNonInteractivePassword({})).toBe(false);
  });
});

describe('resolvePassword precedence', () => {
  const ORIGINAL = process.env.VAULT_ENV_PASSWORD;
  let exitSpy;
  let logSpy;
  let dir;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.VAULT_ENV_PASSWORD;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-pw-'));
    // Throw on exit so the precedence/conflict tests don't kill the runner and
    // the call site short-circuits exactly where process.exit would.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit:${code}`);
    });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    logSpy.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
    if (ORIGINAL === undefined) delete process.env.VAULT_ENV_PASSWORD;
    else process.env.VAULT_ENV_PASSWORD = ORIGINAL;
  });

  it('1. --password wins over everything', async () => {
    process.env.VAULT_ENV_PASSWORD = 'envpw';
    const file = path.join(dir, 'pw.txt');
    fs.writeFileSync(file, 'filepw\n');
    const out = await resolvePassword(
      { password: 'flagpw' },
      'Enter password:'
    );
    expect(out).toBe('flagpw');
    expect(password).not.toHaveBeenCalled();
  });

  it('accepts an empty-string --password as "provided"', async () => {
    process.env.VAULT_ENV_PASSWORD = 'envpw';
    const out = await resolvePassword({ password: '' }, 'Enter password:');
    expect(out).toBe('');
    expect(password).not.toHaveBeenCalled();
  });

  it('2. --password-file wins over env and prompt', async () => {
    process.env.VAULT_ENV_PASSWORD = 'envpw';
    const file = path.join(dir, 'pw.txt');
    fs.writeFileSync(file, 'filepw\n');
    const out = await resolvePassword(
      { passwordFile: file },
      'Enter password:'
    );
    expect(out).toBe('filepw');
    expect(password).not.toHaveBeenCalled();
  });

  it('4. falls back to VAULT_ENV_PASSWORD when no explicit source', async () => {
    process.env.VAULT_ENV_PASSWORD = 'envpw';
    const out = await resolvePassword({}, 'Enter password:');
    expect(out).toBe('envpw');
    expect(password).not.toHaveBeenCalled();
  });

  it('5. falls back to the interactive prompt when nothing else is set', async () => {
    const out = await resolvePassword({}, 'Enter password:');
    expect(out).toBe('PROMPTED');
    expect(password).toHaveBeenCalledOnce();
  });

  it('errors and exits when a password file is missing', async () => {
    const missing = path.join(dir, 'nope.txt');
    await expect(
      resolvePassword({ passwordFile: missing }, 'Enter password:')
    ).rejects.toThrow('process.exit:1');
    expect(logSpy.mock.calls.flat().join('\n')).toMatch(
      /cannot read password file/i
    );
  });

  it('errors and exits when more than one explicit source is given', async () => {
    const file = path.join(dir, 'pw.txt');
    fs.writeFileSync(file, 'filepw\n');
    await expect(
      resolvePassword(
        { password: 'flagpw', passwordFile: file },
        'Enter password:'
      )
    ).rejects.toThrow('process.exit:1');
    expect(logSpy.mock.calls.flat().join('\n')).toMatch(
      /choose only one of --password, --password-file, --password-stdin/
    );
    expect(password).not.toHaveBeenCalled();
  });

  it('errors on three explicit sources at once', async () => {
    const file = path.join(dir, 'pw.txt');
    fs.writeFileSync(file, 'filepw\n');
    await expect(
      resolvePassword(
        { password: 'flagpw', passwordFile: file, passwordStdin: true },
        'Enter password:'
      )
    ).rejects.toThrow('process.exit:1');
  });
});

describe('readPasswordStdin', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-pw-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads fd 0 and strips a single trailing newline', () => {
    // Stub fd-0 reads to deterministic content; readPasswordStdin reads stdin
    // via fs.readFileSync(0, 'utf8').
    const spy = vi
      .spyOn(fsExtra, 'readFileSync')
      .mockImplementation((target) => {
        if (target === 0) return 'stdinpw\n';
        throw new Error(`unexpected readFileSync target: ${target}`);
      });
    try {
      expect(readPasswordStdin()).toBe('stdinpw');
      expect(spy).toHaveBeenCalledWith(0, 'utf8');
    } finally {
      spy.mockRestore();
    }
  });

  it('treats empty stdin as an empty string', () => {
    const spy = vi
      .spyOn(fsExtra, 'readFileSync')
      .mockImplementation((target) => {
        if (target === 0) return '';
        throw new Error(`unexpected readFileSync target: ${target}`);
      });
    try {
      expect(readPasswordStdin()).toBe('');
    } finally {
      spy.mockRestore();
    }
  });
});
