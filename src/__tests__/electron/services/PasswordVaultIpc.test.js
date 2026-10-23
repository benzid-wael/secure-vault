// @vitest-environment node
// Password vault passwords kept on this computer (GUI-ENV-BREAKDOWN New-52),
// on a real VaultService, VaultSession and VaultKeychain.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { createPasswordVaultHandlers } from '../../../electron/services/PasswordVaultIpc.js';
import {
  VaultService,
  LEGACY_DEFAULT_PASSWORD,
} from '../../../electron/services/VaultService.js';
import { VaultSession } from '../../../electron/services/VaultSession.js';
import { VaultKeychain } from '../../../electron/services/VaultKeychain.js';
import { fakeSafeStorage } from '../../helpers/fakeSafeStorage.js';

const PW = 'Vault-Pass-12!';
const NEW_PW = 'Brand-New-Pass-42!';
const ev = {};

let dir;
let vaultService;
let session;
let keychain;
let present;
let openSession;
let h;
let general;

const vaultPath = (name = 'work') =>
  vaultService.fileService.getVaultPath(name);

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-pw-ipc-'));
  vaultService = new VaultService(path.join(dir, 'vaults'));
  await vaultService.createVault('work', PW);
  session = new VaultSession();
  present = true;
  keychain = new VaultKeychain({
    file: path.join(dir, 'kept', 'passwords.json'),
    safeStorage: fakeSafeStorage(),
    confirmPresence: async () => present,
  });
  openSession = vi.fn(async (name, password) => session.open(name, password));
  ({ vault: h, general } = createPasswordVaultHandlers({
    vaultService,
    session,
    openSession,
    keychain,
  }));
});
afterEach(async () => {
  session.close();
  await fs.remove(dir);
});

const info = () => general['saved-passwords:info']();

describe('unlock-vault', () => {
  it('opens the session; keeps the password only when asked', async () => {
    const plain = await h['unlock-vault'](ev, 'work', PW);
    expect(plain).toMatchObject({ success: true, usesDefaultPassword: false });
    expect(plain).not.toHaveProperty('remembered');
    expect(openSession).toHaveBeenCalledWith('work', PW);
    expect((await info()).vaults).toEqual([]);

    const kept = await h['unlock-vault'](ev, 'work', PW, { remember: true });
    expect(kept.remembered).toBe(true);
    expect(await info()).toMatchObject({
      available: true,
      count: 1,
      vaults: ['work'],
    });
  });

  it('forgets a kept password when unlocked with remember off', async () => {
    await h['unlock-vault'](ev, 'work', PW, { remember: true });
    await h['unlock-vault'](ev, 'work', PW, { remember: false });
    expect((await info()).vaults).toEqual([]);
  });

  it('keeps nothing for a wrong password', async () => {
    const result = await h['unlock-vault'](ev, 'work', 'wrong', {
      remember: true,
    });
    expect(result).toMatchObject({ success: false, code: 'AUTH' });
    expect(openSession).not.toHaveBeenCalled();
    expect(await keychain.count()).toBe(0);
  });

  it('flags the legacy built-in password', async () => {
    await vaultService.createVault('old', LEGACY_DEFAULT_PASSWORD);
    expect(
      (await h['unlock-vault'](ev, 'old', LEGACY_DEFAULT_PASSWORD))
        .usesDefaultPassword
    ).toBe(true);
  });

  it('says when this computer cannot keep it', async () => {
    const store = fakeSafeStorage();
    store.isEncryptionAvailable = () => false;
    const { vault } = createPasswordVaultHandlers({
      vaultService,
      session,
      openSession,
      keychain: new VaultKeychain({
        file: path.join(dir, 'other.json'),
        safeStorage: store,
      }),
    });
    const result = await vault['unlock-vault'](ev, 'work', PW, {
      remember: true,
    });
    expect(result).toMatchObject({ success: true, remembered: false });
  });
});

describe('unlock-vault-saved', () => {
  it('unlocks with the kept password after the presence check', async () => {
    await h['unlock-vault'](ev, 'work', PW, { remember: true });
    session.close();
    openSession.mockClear();
    const result = await h['unlock-vault-saved'](ev, 'work');
    expect(result).toMatchObject({ success: true, usesDefaultPassword: false });
    expect(result).not.toHaveProperty('password');
    expect(openSession).toHaveBeenCalledWith('work', PW);
  });

  it.each([
    ['NONE', 'No saved password for work. Type it instead.'],
    ['CANCELED', 'Unlock canceled.'],
  ])('refuses with %s, opening nothing', async (code, error) => {
    if (code === 'CANCELED') {
      await h['unlock-vault'](ev, 'work', PW, { remember: true });
      session.close();
      openSession.mockClear();
      present = false;
    }
    expect(await h['unlock-vault-saved'](ev, 'work')).toEqual({
      success: false,
      code,
      error,
    });
    expect(openSession).not.toHaveBeenCalled();
  });

  it('forgets a kept password that no longer opens the vault', async () => {
    await h['unlock-vault'](ev, 'work', PW, { remember: true });
    // Changed elsewhere: the kept password is now the old one.
    await vaultService.changePassword('work', PW, NEW_PW);
    session.close();
    const result = await h['unlock-vault-saved'](ev, 'work');
    expect(result).toMatchObject({
      success: false,
      code: 'AUTH',
      remembered: false,
    });
    expect(result.error).toContain('no longer opens work');
    expect(await keychain.count()).toBe(0);
  });

  it('keeps it when the vault file is missing, not wrong', async () => {
    await h['unlock-vault'](ev, 'work', PW, { remember: true });
    await fs.move(vaultPath(), `${vaultPath()}.moved`);
    const result = await h['unlock-vault-saved'](ev, 'work');
    expect(result).toMatchObject({ success: false, code: 'NOT_FOUND' });
    expect(await keychain.has(vaultPath())).toBe(true);
  });

  it('works without a keychain: nothing kept, nothing offered', async () => {
    const plain = createPasswordVaultHandlers({
      vaultService,
      session,
      openSession,
    });
    expect(
      (await plain.vault['unlock-vault'](ev, 'work', PW, { remember: true }))
        .remembered
    ).toBeUndefined();
    expect((await plain.vault['unlock-vault-saved'](ev, 'work')).code).toBe(
      'NONE'
    );
    expect(await plain.general['saved-passwords:info']()).toEqual({
      success: true,
      available: false,
      count: 0,
      vaults: [],
    });
    expect(await plain.general['saved-passwords:forget-all']()).toEqual({
      success: true,
      count: 0,
    });
    expect(await plain.vault['forget-vault-password'](ev, 'work')).toEqual({
      success: true,
    });
  });
});

describe('the kept password follows the vault', () => {
  it('is replaced by a password change made in the app', async () => {
    await h['unlock-vault'](ev, 'work', PW, { remember: true });
    const changed = await h['change-master-password'](ev, 'work', PW, NEW_PW);
    expect(changed.success).toBe(true);
    session.close();
    expect((await h['unlock-vault-saved'](ev, 'work')).success).toBe(true);
    expect(openSession).toHaveBeenLastCalledWith('work', NEW_PW);
  });

  it('is not created by a password change when none was kept', async () => {
    await h['unlock-vault'](ev, 'work', PW);
    await h['change-master-password'](ev, 'work', PW, NEW_PW);
    expect(await keychain.count()).toBe(0);
  });

  it('is left alone by a refused password change', async () => {
    await h['unlock-vault'](ev, 'work', PW, { remember: true });
    const refused = await h['change-master-password'](
      ev,
      'work',
      'wrong',
      NEW_PW
    );
    expect(refused.success).toBe(false);
    session.close();
    expect((await h['unlock-vault-saved'](ev, 'work')).success).toBe(true);
    expect(openSession).toHaveBeenLastCalledWith('work', PW);
  });

  it('goes with the vault on delete, which also locks it', async () => {
    await h['unlock-vault'](ev, 'work', PW, { remember: true });
    const deleted = await h['delete-vault'](ev, 'work', PW);
    expect(deleted.success).toBe(true);
    expect(session.isUnlocked('work')).toBe(false);
    expect(await keychain.count()).toBe(0);
  });

  it('stays when a delete is refused', async () => {
    await h['unlock-vault'](ev, 'work', PW, { remember: true });
    expect((await h['delete-vault'](ev, 'work', 'wrong')).success).toBe(false);
    expect(session.isUnlocked('work')).toBe(true);
    expect(await keychain.count()).toBe(1);
  });

  it('is forgotten on request', async () => {
    await h['unlock-vault'](ev, 'work', PW, { remember: true });
    expect(await h['forget-vault-password'](ev, 'work')).toEqual({
      success: true,
    });
    expect((await info()).vaults).toEqual([]);
  });
});

describe('saved passwords, every vault kind', () => {
  it('forgets them all, env vault ones included', async () => {
    await h['unlock-vault'](ev, 'work', PW, { remember: true });
    await keychain.remember(path.join(dir, 'proj', '.env.vault'), 'x');
    await fs.ensureDir(path.join(dir, 'proj'));
    await fs.writeFile(path.join(dir, 'proj', '.env.vault'), '{}');
    expect((await info()).count).toBe(2);
    expect(await general['saved-passwords:forget-all']()).toEqual({
      success: true,
      count: 2,
    });
    expect(await info()).toMatchObject({ count: 0, vaults: [] });
  });

  it('drops the password of a vault file that is gone', async () => {
    await h['unlock-vault'](ev, 'work', PW, { remember: true });
    await fs.remove(vaultPath());
    expect(await info()).toMatchObject({ count: 0, vaults: [] });
  });
});
