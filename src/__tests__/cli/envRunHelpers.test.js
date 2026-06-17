// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import {
  CLEAN_ALLOWLIST,
  DEFAULT_ALLOWLIST_FILE,
  buildChildEnv,
  toDotenv,
  parseAllowlist,
  readAllowlistFile,
} from '../../../bin/commands/envRunHelpers.js';

describe('buildChildEnv', () => {
  const parentEnv = {
    PATH: '/usr/bin',
    HOME: '/home/me',
    SECRET_FROM_PARENT: 'leak',
    LANG: 'en_US',
  };
  const vars = { API_URL: 'https://x', TOKEN: 'abc' };

  it('clean mode includes only vault vars + allowlisted system vars', () => {
    const env = buildChildEnv({ mode: 'clean', vars, parentEnv });

    expect(env.API_URL).toBe('https://x');
    expect(env.TOKEN).toBe('abc');
    expect(env.PATH).toBe('/usr/bin'); // allowlisted
    expect(env.HOME).toBe('/home/me'); // allowlisted
    expect(env.SECRET_FROM_PARENT).toBeUndefined(); // not leaked
    expect(env.LANG).toBeUndefined();
  });

  it('clean mode honors an extra allowlist', () => {
    const env = buildChildEnv({
      mode: 'clean',
      vars,
      parentEnv,
      allowlist: ['LANG'],
    });
    expect(env.LANG).toBe('en_US');
    expect(env.SECRET_FROM_PARENT).toBeUndefined();
  });

  it('merge mode layers vault vars over the full parent env', () => {
    const env = buildChildEnv({ mode: 'merge', vars, parentEnv });
    expect(env.SECRET_FROM_PARENT).toBe('leak'); // inherited
    expect(env.API_URL).toBe('https://x'); // injected
  });

  it('vault vars win over a clashing system var in clean mode', () => {
    const env = buildChildEnv({
      mode: 'clean',
      vars: { PATH: '/vault/path' },
      parentEnv,
    });
    expect(env.PATH).toBe('/vault/path');
  });

  it('file mode injects no vault vars (they go to the file)', () => {
    const env = buildChildEnv({ mode: 'file', vars, parentEnv });
    expect(env.API_URL).toBeUndefined();
    expect(env.TOKEN).toBeUndefined();
    expect(env.SECRET_FROM_PARENT).toBe('leak'); // still inherits parent
  });

  it('CLEAN_ALLOWLIST covers the documented system vars', () => {
    expect(CLEAN_ALLOWLIST).toEqual(
      expect.arrayContaining(['PATH', 'HOME', 'SHELL', 'USER', 'TMPDIR'])
    );
  });
});

describe('toDotenv', () => {
  it('serializes key/value pairs with a trailing newline', () => {
    expect(toDotenv({ A: '1', B: 'two' })).toBe('A=1\nB=two\n');
  });

  it('handles an empty map', () => {
    expect(toDotenv({})).toBe('\n');
  });
});

describe('parseAllowlist', () => {
  it('splits, trims, and drops empties', () => {
    expect(parseAllowlist(' LANG , NODE_PATH ,, ')).toEqual([
      'LANG',
      'NODE_PATH',
    ]);
  });

  it('returns [] for undefined/empty', () => {
    expect(parseAllowlist(undefined)).toEqual([]);
    expect(parseAllowlist('')).toEqual([]);
  });
});

describe('DEFAULT_ALLOWLIST_FILE', () => {
  it('is .vault-allowlist', () => {
    expect(DEFAULT_ALLOWLIST_FILE).toBe('.vault-allowlist');
  });
});

describe('readAllowlistFile', () => {
  let tmpDir;
  let tmpFile;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-test-'));
    tmpFile = path.join(tmpDir, 'allowlist.txt');
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('parses one var per line', async () => {
    await fs.writeFile(tmpFile, 'LANG\nTERM\nNODE_PATH\n');
    expect(readAllowlistFile(tmpFile)).toEqual(['LANG', 'TERM', 'NODE_PATH']);
  });

  it('strips # comments and blank lines', async () => {
    await fs.writeFile(
      tmpFile,
      '# this is a comment\nLANG\n\n# another\nTERM\n'
    );
    expect(readAllowlistFile(tmpFile)).toEqual(['LANG', 'TERM']);
  });

  it('strips inline comments', async () => {
    await fs.writeFile(tmpFile, 'LANG # locale\nTERM\n');
    expect(readAllowlistFile(tmpFile)).toEqual(['LANG', 'TERM']);
  });

  it('returns [] for a falsy path', () => {
    expect(readAllowlistFile(null)).toEqual([]);
    expect(readAllowlistFile('')).toEqual([]);
    expect(readAllowlistFile(undefined)).toEqual([]);
  });

  it('returns [] when file is absent and mustExist is false', () => {
    expect(readAllowlistFile('/nonexistent/path/.vault-allowlist')).toEqual([]);
  });

  it('throws when file is absent and mustExist is true', () => {
    expect(() =>
      readAllowlistFile('/nonexistent/path/.vault-allowlist', {
        mustExist: true,
      })
    ).toThrow(/Cannot read allowlist file/);
  });
});
