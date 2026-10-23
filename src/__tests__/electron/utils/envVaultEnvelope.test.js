// @vitest-environment node
// An env vault's envelope, format 1 and the bound format 2 (New-37).
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

import {
  BOUND_FORMAT,
  WRITE_BOUND,
  isBound,
  keyCheckOf,
  openEnvVault,
  sealEnvVault,
} from '../../../electron/utils/envVaultEnvelope.js';

const key = crypto.randomBytes(32);
const otherKey = crypto.randomBytes(32);
const head = {
  salt: 'ab'.repeat(32),
  kdf: { name: 'pbkdf2', iterations: 600000 },
};
const payload = { environments: { dev: { a: 1 } } };
const code = (fn) => {
  try {
    fn();
  } catch (error) {
    return [error.code, error.message];
  }
  return null;
};

describe('format 1', () => {
  it('is what is written for now, and opens as before', () => {
    expect(WRITE_BOUND).toBe(false);
    const file = sealEnvVault(payload, key, head);
    expect(file).toMatchObject({ type: 'environment-vault', version: 1 });
    expect(file).not.toHaveProperty('keyCheck');
    expect(isBound(file)).toBe(false);
    expect(openEnvVault(file, key)).toEqual(payload);
  });

  it('keeps features only when used', () => {
    expect(sealEnvVault(payload, key, head)).not.toHaveProperty('features');
    expect(
      sealEnvVault(payload, key, head, { features: ['comments'] }).features
    ).toEqual(['comments']);
  });

  it('a wrong key is AUTH; its header is trusted', () => {
    const file = sealEnvVault(payload, key, head);
    expect(code(() => openEnvVault(file, otherKey))?.[0]).toBe('AUTH');
    // An edit of format 1's header goes unnoticed: what format 2 fixes.
    expect(openEnvVault({ ...file, features: ['comments'] }, key)).toEqual(
      payload
    );
  });
});

describe('format 2: the header is bound', () => {
  const bound = (features = []) =>
    sealEnvVault(payload, key, head, { bound: true, features });

  it('round-trips, with a key check', () => {
    const file = bound(['comments']);
    expect(file.version).toBe(BOUND_FORMAT);
    expect(file.keyCheck).toBe(keyCheckOf(key));
    expect(file.keyCheck).toMatch(/^[0-9a-f]{32}$/);
    expect(openEnvVault(file, key)).toEqual(payload);
  });

  it('a wrong password says so', () => {
    expect(code(() => openEnvVault(bound(), otherKey))).toEqual([
      'AUTH',
      'Failed to decrypt: wrong password or corrupted file',
    ]);
  });

  it.each([
    ['features added', (f) => ({ ...f, features: ['comments'] })],
    ['features removed', ({ features: _f, ...f }) => f, ['comments']],
    ['the key check edited', (f) => ({ ...f, keyCheck: '0'.repeat(32) })],
    ['the key check removed', ({ keyCheck: _k, ...f }) => f],
  ])(
    'a header with %s is TAMPERED, with the right password',
    (_, edit, features = []) => {
      const [c, message] = code(() =>
        openEnvVault(edit(bound(features)), key, '/p/app.env.vault')
      );
      expect(c).toBe('TAMPERED');
      expect(message).toBe(
        "app.env.vault's header was changed after it was written, or the " +
          "file is damaged, so it can't be trusted. Restore it from " +
          'app.env.vault.bak or another copy.'
      );
    }
  );

  it('a changed ciphertext is TAMPERED too; a name without a path gets no .bak hint', () => {
    const file = bound();
    const flipped = { ...file, authTag: '00'.repeat(16) };
    const [c, message] = code(() => openEnvVault(flipped, key, 'shop'));
    expect(c).toBe('TAMPERED');
    expect(message).toMatch(/Restore it from a backup\.$/);
  });

  it('relabelled as format 1, it fails as a wrong password (undetectable)', () => {
    const file = { ...bound(), version: 1 };
    delete file.keyCheck;
    expect(code(() => openEnvVault(file, key))?.[0]).toBe('AUTH');
  });
});
