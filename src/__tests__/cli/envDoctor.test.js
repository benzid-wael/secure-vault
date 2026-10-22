// @vitest-environment node
import { describe, it, expect } from 'vitest';

import {
  checkStructure,
  checkResolution,
  checkLock,
  hasErrors,
} from '../../../bin/commands/envDoctor.js';

const RC = {
  env: 'dev',
  deliver: [
    { path: '.env', format: 'dotenv', keys: ['API_URL'] },
    {
      path: 'ios/GoogleService-Info.plist',
      from: 'GOOGLE_PLIST',
      decode: 'base64',
    },
    { template: 'ios/Secrets.xcconfig.vtpl' },
  ],
};

const GITIGNORE = [
  '.env',
  'ios/GoogleService-Info.plist',
  'ios/Secrets.xcconfig',
].join('\n');

describe('checkStructure', () => {
  it('passes a well-formed, fully-ignored manifest with present templates', () => {
    const { results, manifest } = checkStructure({
      config: RC,
      baseDir: '/proj',
      gitignore: GITIGNORE,
      fileExists: () => true,
    });
    expect(manifest.entries).toHaveLength(3);
    expect(hasErrors(results)).toBe(false);
    expect(results.some((r) => r.level === 'ok')).toBe(true);
  });

  it('errors on an invalid manifest', () => {
    const { results, manifest } = checkStructure({
      config: { deliver: [{ path: 'x' }] },
      baseDir: '/proj',
      gitignore: '',
      fileExists: () => true,
    });
    expect(manifest).toBeNull();
    expect(hasErrors(results)).toBe(true);
    expect(results[0].detail).toMatch(/deliver\[0\]/);
  });

  it('errors when a template file is missing', () => {
    const { results } = checkStructure({
      config: RC,
      baseDir: '/proj',
      gitignore: GITIGNORE,
      fileExists: (p) => !p.endsWith('.vtpl'),
    });
    expect(hasErrors(results)).toBe(true);
    expect(results.some((r) => /Template not found/.test(r.title))).toBe(true);
  });

  it('warns (does not error) when an artifact is not git-ignored', () => {
    const { results } = checkStructure({
      config: RC,
      baseDir: '/proj',
      gitignore: '.env', // only .env ignored
      fileExists: () => true,
    });
    expect(hasErrors(results)).toBe(false);
    const warns = results.filter((r) => r.level === 'warn');
    expect(warns.some((r) => /GoogleService-Info.plist/.test(r.title))).toBe(
      true
    );
    expect(warns.some((r) => /Secrets.xcconfig/.test(r.title))).toBe(true);
  });

  it('reports info (no error) when there is no deliver array', () => {
    const { results, manifest } = checkStructure({
      config: { env: 'dev' },
      baseDir: '/proj',
      gitignore: '',
    });
    expect(manifest.entries).toHaveLength(0);
    expect(results[0].level).toBe('info');
    expect(hasErrors(results)).toBe(false);
  });
});

describe('checkResolution', () => {
  const manifest = {
    entries: [
      { kind: 'format', path: '.env', keys: ['API_URL'] },
      { kind: 'from', path: 'g', from: 'GOOGLE_PLIST' },
      { kind: 'template', template: 't.vtpl', path: 't' },
    ],
  };
  const readTemplate = () => 'url={{API_URL}} dsn={{SENTRY_DSN}}';

  it('passes when every referenced variable exists', () => {
    const vars = { API_URL: '1', GOOGLE_PLIST: '2', SENTRY_DSN: '3' };
    const results = checkResolution(manifest, vars, readTemplate);
    expect(hasErrors(results)).toBe(false);
    expect(results[0].title).toMatch(/All manifest variables resolve/);
  });

  it('collects every undefined variable across all entry kinds', () => {
    const vars = { API_URL: '1' }; // missing GOOGLE_PLIST and SENTRY_DSN
    const results = checkResolution(manifest, vars, readTemplate);
    expect(hasErrors(results)).toBe(true);
    expect(results[0].title).toContain('GOOGLE_PLIST');
    expect(results[0].title).toContain('SENTRY_DSN');
    expect(results[0].title).not.toContain('API_URL');
  });

  it('skips a template it cannot read (already reported by checkStructure)', () => {
    const throwing = () => {
      throw new Error('nope');
    };
    const results = checkResolution(
      manifest,
      { API_URL: '1', GOOGLE_PLIST: '2' },
      throwing
    );
    expect(hasErrors(results)).toBe(false);
  });
});

describe('checkLock (Task 8)', () => {
  const LOCK = '/p/.env.vault.lock';
  const holder = {
    tool: 'cli',
    pid: 4242,
    host: 'box',
    acquiredAt: '2026-10-22T10:00:00.000Z',
  };

  it('is ok with no lock', () => {
    expect(
      checkLock({ state: 'none', path: LOCK, holder: null, asides: [] })
    ).toEqual([{ level: 'ok', title: 'No write lock on the vault' }]);
  });

  it('names a live holder and the same remedy as the busy error', () => {
    const [r] = checkLock({ state: 'held', path: LOCK, holder, asides: [] });
    expect(r.level).toBe('info');
    expect(r.title).toBe(
      'Vault is being written: locked by cli pid 4242 on box since 2026-10-22T10:00:00.000Z'
    );
    expect(r.fix).toContain(`If no vault command is running, remove ${LOCK}.`);
  });

  it('warns about a stale lock, which stays a warning, not an error', () => {
    const results = checkLock({
      state: 'stale',
      path: LOCK,
      holder: null,
      asides: [],
    });
    expect(results[0]).toMatchObject({
      level: 'warn',
      title: 'Stale write lock left by an unknown process',
    });
    expect(results[0].fix).toContain(`remove ${LOCK}`);
    expect(hasErrors(results)).toBe(false);
  });

  it('lists each leftover takeover file', () => {
    const results = checkLock({
      state: 'none',
      path: LOCK,
      holder: null,
      asides: [`${LOCK}.stale.aa`, `${LOCK}.stale.bb`],
    });
    expect(results.slice(1).map((r) => r.detail)).toEqual([
      `${LOCK}.stale.aa`,
      `${LOCK}.stale.bb`,
    ]);
    expect(results[1].fix).toBe(
      `Remove ${LOCK}.stale.aa; no vault command reads it.`
    );
  });

  it('describes a holder with only a pid', () => {
    const [r] = checkLock({
      state: 'held',
      path: LOCK,
      holder: { pid: 7 },
      asides: [],
    });
    expect(r.title).toBe(
      'Vault is being written: locked by a vault process pid 7'
    );
  });
});
