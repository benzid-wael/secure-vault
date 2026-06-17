// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import {
  CLEAN_ALLOWLIST,
  DEFAULT_ALLOWLIST_FILE,
  VAULTRC_FILENAME,
  buildChildEnv,
  toDotenv,
  parseAllowlist,
  readAllowlistFile,
  loadProjectConfig,
  applyProjectConfig,
  injectVaultEnvArg,
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

describe('VAULTRC_FILENAME', () => {
  it('is .vaultrc', () => {
    expect(VAULTRC_FILENAME).toBe('.vaultrc');
  });
});

describe('loadProjectConfig', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-rc-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('returns {} when no .vaultrc exists', () => {
    expect(loadProjectConfig(tmpDir)).toEqual({});
  });

  it('parses a valid .vaultrc in the start dir', async () => {
    await fs.writeJson(path.join(tmpDir, '.vaultrc'), {
      inject: 'merge',
      env: 'staging',
    });
    expect(loadProjectConfig(tmpDir)).toEqual({
      inject: 'merge',
      env: 'staging',
    });
  });

  it('walks up to find .vaultrc in a parent dir', async () => {
    await fs.writeJson(path.join(tmpDir, '.vaultrc'), { inject: 'merge' });
    const child = path.join(tmpDir, 'sub', 'dir');
    await fs.mkdirp(child);
    expect(loadProjectConfig(child)).toEqual({ inject: 'merge' });
  });

  it('stops walking at a .git boundary', async () => {
    // .vaultrc lives above the git root — should NOT be found.
    await fs.writeJson(path.join(tmpDir, '.vaultrc'), { inject: 'merge' });
    const gitRoot = path.join(tmpDir, 'project');
    await fs.mkdirp(path.join(gitRoot, '.git'));
    expect(loadProjectConfig(gitRoot)).toEqual({});
  });

  it('throws on invalid JSON', async () => {
    await fs.writeFile(path.join(tmpDir, '.vaultrc'), '{ bad json }');
    expect(() => loadProjectConfig(tmpDir)).toThrow(/Invalid JSON/);
  });
});

describe('applyProjectConfig', () => {
  function makeCmd(defaults = {}) {
    // Minimal Commander-like stub with option value source tracking.
    const sources = {};
    const values = { inject: 'clean', ...defaults };
    for (const k of Object.keys(values)) sources[k] = 'default';
    return {
      getOptionValueSource: (k) => sources[k] ?? 'default',
      setOptionValueWithSource: (k, v, src) => {
        values[k] = v;
        sources[k] = src;
      },
      opts: () => values,
    };
  }

  it('sets a default option from config', () => {
    const cmd = makeCmd();
    applyProjectConfig(cmd, { inject: 'merge' });
    expect(cmd.opts().inject).toBe('merge');
  });

  it('does not override a CLI-set option', () => {
    const cmd = makeCmd();
    cmd.setOptionValueWithSource('inject', 'file', 'cli');
    applyProjectConfig(cmd, { inject: 'merge' });
    expect(cmd.opts().inject).toBe('file');
  });

  it('overrides an env-var-set option (.vaultrc beats VAULT_* env vars)', () => {
    const cmd = makeCmd();
    cmd.setOptionValueWithSource('inject', 'merge', 'env');
    applyProjectConfig(cmd, { inject: 'file' });
    expect(cmd.opts().inject).toBe('file');
  });

  it('ignores unknown keys in config', () => {
    const cmd = makeCmd();
    expect(() => applyProjectConfig(cmd, { unknown: 'value' })).not.toThrow();
  });
});

describe('injectVaultEnvArg', () => {
  const BASE = ['node', 'cli'];

  it('injects VAULT_ENV before -- when no envName is present', () => {
    const argv = [
      ...BASE,
      'env',
      'run',
      '-v',
      '/vault',
      '--',
      'node',
      'server.js',
    ];
    expect(injectVaultEnvArg(argv, 'staging')).toEqual([
      'node',
      'cli',
      'env',
      'run',
      '-v',
      '/vault',
      'staging',
      '--',
      'node',
      'server.js',
    ]);
  });

  it('does not inject when envName is already provided before --', () => {
    const argv = [
      ...BASE,
      'env',
      'run',
      '-v',
      '/vault',
      'dev',
      '--',
      'node',
      's.js',
    ];
    expect(injectVaultEnvArg(argv, 'staging')).toBe(argv);
  });

  it('does not inject when vaultEnv is falsy', () => {
    const argv = [...BASE, 'env', 'run', '--', 'node', 's.js'];
    expect(injectVaultEnvArg(argv, undefined)).toBe(argv);
    expect(injectVaultEnvArg(argv, '')).toBe(argv);
  });

  it('does not inject when there is no -- separator', () => {
    const argv = [...BASE, 'env', 'run', '-v', '/vault'];
    expect(injectVaultEnvArg(argv, 'staging')).toBe(argv);
  });

  it('does not inject when env run is not in argv', () => {
    const argv = [...BASE, 'env', 'show', '--', 'extra'];
    expect(injectVaultEnvArg(argv, 'staging')).toBe(argv);
  });

  it('correctly skips boolean flags before --', () => {
    const argv = [
      ...BASE,
      'env',
      'run',
      '--password-stdin',
      '--',
      'node',
      's.js',
    ];
    expect(injectVaultEnvArg(argv, 'dev')).toEqual([
      'node',
      'cli',
      'env',
      'run',
      '--password-stdin',
      'dev',
      '--',
      'node',
      's.js',
    ]);
  });

  it('correctly skips flags-with-value pairs before --', () => {
    const argv = [
      ...BASE,
      'env',
      'run',
      '--inject',
      'merge',
      '-v',
      '/v',
      '--',
      'cmd',
    ];
    expect(injectVaultEnvArg(argv, 'prod')).toEqual([
      'node',
      'cli',
      'env',
      'run',
      '--inject',
      'merge',
      '-v',
      '/v',
      'prod',
      '--',
      'cmd',
    ]);
  });
});
