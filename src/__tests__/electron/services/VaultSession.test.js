// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

import { VaultSession } from '../../../electron/services/VaultSession.js';

describe('VaultSession', () => {
  it('starts locked', () => {
    const session = new VaultSession();
    expect(session.vaultName).toBeNull();
    expect(session.isUnlocked('main')).toBe(false);
    expect(session.passwordFor('main')).toBeNull();
  });

  it('serves the password only for the unlocked vault', () => {
    const session = new VaultSession();
    session.open('main', 'pw');
    expect(session.isUnlocked('main')).toBe(true);
    expect(session.passwordFor('main')).toBe('pw');
    expect(session.isUnlocked('other')).toBe(false);
    expect(session.passwordFor('other')).toBeNull();
  });

  it('opening another vault replaces the session', () => {
    const session = new VaultSession();
    session.open('main', 'pw');
    session.open('other', 'pw2');
    expect(session.passwordFor('main')).toBeNull();
    expect(session.passwordFor('other')).toBe('pw2');
  });

  it('close() locks it again', () => {
    const session = new VaultSession();
    session.open('main', 'pw');
    session.close();
    expect(session.vaultName).toBeNull();
    expect(session.passwordFor('main')).toBeNull();
  });

  it('accepts an empty-string password but rejects a missing one', () => {
    const session = new VaultSession();
    expect(() => session.open('main', undefined)).toThrow();
    expect(() => session.open('', 'pw')).toThrow();
    session.open('main', '');
    expect(session.passwordFor('main')).toBe('');
  });

  it('withPassword runs fn with the password when unlocked', async () => {
    const session = new VaultSession();
    session.open('main', 'pw');
    const fn = vi.fn().mockResolvedValue({ success: true });
    await expect(session.withPassword('main', fn)).resolves.toEqual({
      success: true,
    });
    expect(fn).toHaveBeenCalledWith('pw');
  });

  it('withPassword refuses without calling fn when locked or for another vault', async () => {
    const session = new VaultSession();
    const fn = vi.fn();
    await expect(session.withPassword('main', fn)).resolves.toMatchObject({
      success: false,
      locked: true,
    });
    session.open('other', 'pw');
    await expect(session.withPassword('main', fn)).resolves.toMatchObject({
      locked: true,
    });
    expect(fn).not.toHaveBeenCalled();
  });
});
