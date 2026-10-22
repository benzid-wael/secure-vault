// @vitest-environment node
// Env vault passwords kept on this computer (GUI-ENV-BREAKDOWN New-24).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { EnvVaultKeychain } from '../../../electron/services/EnvVaultKeychain.js';
import { fakeSafeStorage } from '../../helpers/fakeSafeStorage.js';

let dir;
let file;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-keychain-'));
  file = path.join(dir, 'data', 'env-vault-passwords.json');
});
afterEach(() => fs.remove(dir));

const VAULT = '/projects/app/.env.vault';

describe('EnvVaultKeychain', () => {
  it('keeps a password encrypted, 0600, and gives it back', async () => {
    const keychain = new EnvVaultKeychain({
      file,
      safeStorage: fakeSafeStorage(),
    });
    expect(await keychain.has(VAULT)).toBe(false);
    expect(await keychain.remember(VAULT, 'Secret-Pass-1')).toBe(true);
    expect(await keychain.has(VAULT)).toBe(true);

    const raw = await fs.readFile(file, 'utf8');
    expect(raw).not.toContain('Secret-Pass-1');
    if (process.platform !== 'win32') {
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    }

    // A new instance (the next app run) reads it from the file.
    const later = new EnvVaultKeychain({
      file,
      safeStorage: fakeSafeStorage(),
    });
    expect(await later.get(VAULT, 'unlock')).toEqual({
      success: true,
      password: 'Secret-Pass-1',
    });
    expect(await later.has('/projects/app/../app/.env.vault')).toBe(true);
  });

  it('forgets a password', async () => {
    const keychain = new EnvVaultKeychain({
      file,
      safeStorage: fakeSafeStorage(),
    });
    await keychain.remember(VAULT, 'pw');
    await keychain.forget(VAULT);
    await keychain.forget(VAULT); // nothing left: no error
    expect(await keychain.has(VAULT)).toBe(false);
    expect((await keychain.get(VAULT)).code).toBe('NONE');
    expect(await fs.readFile(file, 'utf8')).not.toContain('enc:');
  });

  it('asks for presence before giving a password back', async () => {
    const confirmPresence = vi.fn(async () => false);
    const keychain = new EnvVaultKeychain({
      file,
      safeStorage: fakeSafeStorage(),
      confirmPresence,
    });
    await keychain.remember(VAULT, 'pw');
    expect(await keychain.get(VAULT, 'unlock app.env.vault')).toEqual({
      success: false,
      code: 'CANCELED',
    });
    expect(confirmPresence).toHaveBeenCalledWith('unlock app.env.vault');
    expect(await keychain.has(VAULT)).toBe(true);
  });

  it.each([
    ['the Linux plain-text fallback', { backend: 'basic_text' }],
    ['an unknown Linux backend', { backend: 'unknown' }],
    ['no Linux encryption', { available: false }],
  ])('offers nothing and stores nothing with %s', async (_, options) => {
    const keychain = new EnvVaultKeychain({
      file,
      safeStorage: fakeSafeStorage(options),
      platform: 'linux',
    });
    expect(keychain.available()).toBe(false);
    expect(await keychain.remember(VAULT, 'pw')).toBe(false);
    expect(await fs.pathExists(file)).toBe(false);
  });

  it('on macOS, asks the keychain only once the user opts in', async () => {
    const store = fakeSafeStorage({ available: false });
    const asked = vi.spyOn(store, 'isEncryptionAvailable');
    const keychain = new EnvVaultKeychain({
      file,
      safeStorage: store,
      platform: 'darwin',
    });
    // Listing vaults must not block on (or prompt for) the keychain.
    expect(keychain.available()).toBe(true);
    expect(await keychain.has(VAULT)).toBe(false);
    expect(asked).not.toHaveBeenCalled();
    // Ticking "Remember" asks; without encryption nothing is stored.
    expect(await keychain.remember(VAULT, 'pw')).toBe(false);
    expect(asked).toHaveBeenCalledOnce();
    expect(await fs.pathExists(file)).toBe(false);
  });

  it('accepts a Linux keyring, and ignores the backend elsewhere', () => {
    const linux = new EnvVaultKeychain({
      file,
      safeStorage: fakeSafeStorage({ backend: 'gnome_libsecret' }),
      platform: 'linux',
    });
    expect(linux.available()).toBe(true);
    const mac = new EnvVaultKeychain({
      file,
      safeStorage: fakeSafeStorage({ backend: 'unknown' }),
      platform: 'darwin',
    });
    expect(mac.available()).toBe(true);
    expect(new EnvVaultKeychain({ file }).available()).toBe(false);
  });

  it('stores nothing when the keychain refuses to encrypt', async () => {
    const store = fakeSafeStorage();
    store.encryptString = () => {
      throw new Error('User denied keychain access');
    };
    const keychain = new EnvVaultKeychain({ file, safeStorage: store });
    expect(await keychain.remember(VAULT, 'pw')).toBe(false);
    expect(await keychain.has(VAULT)).toBe(false);
  });

  it('says UNAVAILABLE when encryption went away after saving', async () => {
    const store = fakeSafeStorage();
    const keychain = new EnvVaultKeychain({ file, safeStorage: store });
    await keychain.remember(VAULT, 'pw');
    store.isEncryptionAvailable = () => false;
    expect((await keychain.get(VAULT)).code).toBe('UNAVAILABLE');
  });

  it('drops an entry it can no longer decrypt', async () => {
    await fs.outputJson(file, {
      format: 1,
      entries: { [VAULT]: Buffer.from('garbage').toString('base64') },
    });
    const keychain = new EnvVaultKeychain({
      file,
      safeStorage: fakeSafeStorage(),
    });
    expect((await keychain.get(VAULT)).code).toBe('NONE');
    expect(await keychain.has(VAULT)).toBe(false);
  });

  it.each([
    ['damaged', 'not json'],
    [
      'another format',
      JSON.stringify({ format: 2, entries: { [VAULT]: 'x' } }),
    ],
  ])('starts empty from a %s file', async (_, content) => {
    await fs.outputFile(file, content);
    const keychain = new EnvVaultKeychain({
      file,
      safeStorage: fakeSafeStorage(),
    });
    expect(await keychain.has(VAULT)).toBe(false);
    expect(await keychain.remember(VAULT, 'pw')).toBe(true);
    expect((await keychain.get(VAULT)).password).toBe('pw');
  });

  it('keeps every entry when saves overlap', async () => {
    const keychain = new EnvVaultKeychain({
      file,
      safeStorage: fakeSafeStorage(),
    });
    await Promise.all(
      ['a', 'b', 'c', 'd'].map((n) => keychain.remember(`/v/${n}`, n))
    );
    const later = new EnvVaultKeychain({
      file,
      safeStorage: fakeSafeStorage(),
    });
    for (const n of ['a', 'b', 'c', 'd']) {
      expect((await later.get(`/v/${n}`)).password).toBe(n);
    }
  });
});
