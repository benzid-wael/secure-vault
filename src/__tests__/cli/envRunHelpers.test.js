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
  extractRunCommand,
  getRunCommand,
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

  it('treats the legacy "file" mode as clean: vault vars injected, parent env not leaked', () => {
    // file is no longer a population mode (writing a file is orthogonal).
    // Any non-merge mode must inject vault vars and keep clean isolation —
    // the old behavior (no vault vars + full parent passthrough) was the bug.
    const env = buildChildEnv({ mode: 'file', vars, parentEnv });
    expect(env.API_URL).toBe('https://x'); // now injected
    expect(env.TOKEN).toBe('abc');
    expect(env.SECRET_FROM_PARENT).toBeUndefined(); // not leaked
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

describe('extractRunCommand', () => {
  const BASE = ['node', 'cli'];

  it('strips the command after -- and captures it for getRunCommand', () => {
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
    expect(extractRunCommand(argv)).toEqual([
      'node',
      'cli',
      'env',
      'run',
      '-v',
      '/vault',
    ]);
    expect(getRunCommand()).toEqual(['node', 'server.js']);
  });

  it('keeps an envName positional that appears before --', () => {
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
    expect(extractRunCommand(argv)).toEqual([
      'node',
      'cli',
      'env',
      'run',
      '-v',
      '/vault',
      'dev',
    ]);
    expect(getRunCommand()).toEqual(['node', 's.js']);
  });

  it('never consumes a command token as envName (the run -- bug)', () => {
    // `vault env run -- vault env list` must NOT treat the first post-`--`
    // token ("vault") as the environment name.
    const argv = [...BASE, 'env', 'run', '--', 'vault', 'env', 'list'];
    expect(extractRunCommand(argv)).toEqual(['node', 'cli', 'env', 'run']);
    expect(getRunCommand()).toEqual(['vault', 'env', 'list']);
  });

  it('preserves a nested -- inside the command for recursive run', () => {
    const argv = [
      ...BASE,
      'env',
      'run',
      'prod',
      '--',
      'vault',
      'env',
      'run',
      'dev',
      '--',
      'echo',
      'hi',
    ];
    expect(extractRunCommand(argv)).toEqual([
      'node',
      'cli',
      'env',
      'run',
      'prod',
    ]);
    expect(getRunCommand()).toEqual([
      'vault',
      'env',
      'run',
      'dev',
      '--',
      'echo',
      'hi',
    ]);
  });

  it('returns argv unchanged with no command when there is no -- separator', () => {
    const argv = [...BASE, 'env', 'run', '-v', '/vault'];
    expect(extractRunCommand(argv)).toBe(argv);
    expect(getRunCommand()).toBeNull();
  });

  it('returns argv unchanged when env run is not in argv', () => {
    const argv = [...BASE, 'env', 'show', '--', 'extra'];
    expect(extractRunCommand(argv)).toBe(argv);
    expect(getRunCommand()).toBeNull();
  });

  it('captures an empty command for a trailing -- with nothing after', () => {
    const argv = [...BASE, 'env', 'run', 'dev', '--'];
    expect(extractRunCommand(argv)).toEqual([
      'node',
      'cli',
      'env',
      'run',
      'dev',
    ]);
    expect(getRunCommand()).toEqual([]);
  });
});
