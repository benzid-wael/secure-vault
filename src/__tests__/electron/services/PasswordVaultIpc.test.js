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
import { OpenedVaults } from '../../../electron/services/OpenedVaults.js';
import { VaultSettingsService } from '../../../electron/services/VaultSettingsService.js';
import { EnvironmentVaultService } from '../../../electron/services/EnvironmentVaultService.js';
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

  it('is not forgotten while the vault is locked', async () => {
    await h['unlock-vault'](ev, 'work', PW, { remember: true });
    session.close();
    expect(await h['forget-vault-password'](ev, 'work')).toEqual({
      success: false,
      error: 'Vault is locked',
      locked: true,
    });
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

describe('a vault opened from another folder (New-53)', () => {
  let elsewhere;
  let teamFile;
  let opened;
  let picked;
  let handlers;

  beforeEach(async () => {
    elsewhere = path.join(dir, 'team-share');
    // Made by another copy of the app, in a folder this one doesn't own.
    await new VaultService(elsewhere).createVault('team', PW);
    teamFile = path.join(elsewhere, 'team.vault');
    opened = new OpenedVaults({ file: path.join(dir, 'data', 'opened.json') });
    vaultService = new VaultService(path.join(dir, 'vaults'), {
      links: opened,
    });
    picked = teamFile;
    handlers = createPasswordVaultHandlers({
      vaultService,
      session,
      openSession,
      keychain,
      opened,
      dialog: {
        showOpenDialog: vi.fn(async () =>
          picked === null
            ? { canceled: true, filePaths: [] }
            : { canceled: false, filePaths: [picked] }
        ),
      },
      getWindow: () => 'window',
    });
  });

  const open = () => handlers.general['open-vault-file']();
  const list = () => handlers.general['get-vaults']();

  it('is listed after the app folder, with its file', async () => {
    expect(await open()).toEqual({ success: true, name: 'team' });
    expect(await list()).toEqual({
      success: true,
      data: ['work', 'team'],
      opened: [{ name: 'team', location: teamFile, exists: true }],
      keyFile: [],
      keyFileRemembered: [],
    });
  });

  it('is unlocked, edited and saved in place, with its backup beside it', async () => {
    await open();
    expect((await handlers.vault['unlock-vault'](ev, 'team', PW)).success).toBe(
      true
    );
    const loaded = await vaultService.loadVault('team', PW);
    expect(loaded.success).toBe(true);
    const before = fs.readFileSync(teamFile, 'utf8');
    expect(
      (await vaultService.saveVault('team', PW, loaded.data)).success
    ).toBe(true);
    expect(fs.readFileSync(teamFile, 'utf8')).not.toBe(before);
    expect(fs.existsSync(path.join(dir, 'vaults', 'team.vault'))).toBe(false);

    await vaultService.fileService.createBackup('team');
    expect(fs.existsSync(`${teamFile}.backup`)).toBe(true);
    expect(await vaultService.fileService.hasBackup('team')).toBe(true);
    // No temp file is left next to it.
    expect(fs.readdirSync(elsewhere).sort()).toEqual([
      'team.vault',
      'team.vault.backup',
    ]);
  });

  it('takes a password change and a new recovery key in its own file', async () => {
    await open();
    await handlers.vault['unlock-vault'](ev, 'team', PW, { remember: true });
    expect(
      (await handlers.vault['change-master-password'](ev, 'team', PW, NEW_PW))
        .success
    ).toBe(true);
    expect(
      (await new VaultService(elsewhere).verifyPassword('team', NEW_PW)).success
    ).toBe(true);
    // The saved password followed, keyed by the file where it really is.
    expect(await keychain.has(teamFile)).toBe(true);
    const key = await vaultService.generateRecoveryKey('team', NEW_PW);
    expect(key.success).toBe(true);
    expect(
      (
        await new VaultService(elsewhere).verifyRecoveryKey(
          'team',
          key.recoveryKey
        )
      ).success
    ).toBe(true);
  });

  it('reads and writes its settings in its own file', async () => {
    await open();
    const settings = new VaultSettingsService(path.join(dir, 'vaults'), {
      links: opened,
    });
    expect((await settings.getVaultSettings('team', PW)).success).toBe(true);
    expect(
      (await settings.updateVaultSettings('team', PW, { autoLockMinutes: 9 }))
        .success
    ).toBe(true);
    const inPlace = await new VaultSettingsService(elsewhere).getVaultSettings(
      'team',
      PW
    );
    expect(inPlace.settings.autoLockMinutes).toBe(9);
  });

  it('is removed from the list, not deleted; its saved password goes', async () => {
    await open();
    await handlers.vault['unlock-vault'](ev, 'team', PW, { remember: true });
    expect(await handlers.vault['delete-vault'](ev, 'team', PW)).toEqual({
      success: false,
      code: 'INVALID',
      error:
        'team was opened from another folder. Remove it from the list instead; its file stays.',
    });
    expect(await handlers.vault['remove-vault'](ev, 'team')).toEqual({
      success: false,
      code: 'INVALID',
      error: 'Lock the vault before removing it from the list',
    });
    session.close();
    expect(await handlers.vault['remove-vault'](ev, 'team')).toEqual({
      success: true,
      location: teamFile,
    });
    expect(fs.existsSync(teamFile)).toBe(true);
    expect(await keychain.has(teamFile)).toBe(false);
    expect((await list()).data).toEqual(['work']);
  });

  it("won't remove a vault of the app's folder", async () => {
    expect((await handlers.vault['remove-vault'](ev, 'work')).error).toContain(
      "is in the app's folder"
    );
  });

  it('says so when its file is gone', async () => {
    await open();
    await fs.remove(teamFile);
    expect((await list()).opened).toEqual([
      { name: 'team', location: teamFile, exists: false },
    ]);
    const result = await handlers.vault['unlock-vault'](ev, 'team', PW);
    expect(result).toMatchObject({ success: false, code: 'NOT_FOUND' });
    expect(result.error).toBe(
      `The file of team isn't there any more (${teamFile}).`
    );
  });

  it('keeps its name when opened again, and avoids an app-folder name', async () => {
    await open();
    expect(await open()).toEqual({ success: true, name: 'team' });
    await new VaultService(path.join(dir, 'other')).createVault('work', PW);
    picked = path.join(dir, 'other', 'work.vault');
    expect(await open()).toEqual({ success: true, name: 'work (2)' });
  });

  it("gives an app-folder vault's own name, listing nothing new", async () => {
    picked = path.join(dir, 'vaults', 'work.vault');
    expect(await open()).toEqual({ success: true, name: 'work' });
    expect(opened.list()).toEqual([]);
  });

  it('refuses an env vault, a non-vault and an unreadable file', async () => {
    picked = path.join(dir, 'proj', '.env.vault');
    await EnvironmentVaultService.createVault(picked, PW);
    expect((await open()).error).toBe(
      '.env.vault is an environment vault, not a password vault.'
    );
    picked = path.join(dir, 'notes.json');
    await fs.writeJson(picked, { hello: 'world' });
    expect((await open()).error).toBe("notes.json isn't a password vault.");
    picked = path.join(dir, 'garbage.vault');
    await fs.writeFile(picked, 'not json');
    expect((await open()).error).toBe("garbage.vault isn't a vault file.");
    expect(opened.list()).toEqual([]);
  });

  it('does nothing when the dialog is canceled', async () => {
    picked = null;
    expect(await open()).toEqual({ success: false, canceled: true });
  });

  it('is not offered without the list or a dialog', async () => {
    const plain = createPasswordVaultHandlers({
      vaultService,
      session,
      openSession,
    });
    expect((await plain.general['open-vault-file']()).code).toBe('INVALID');
    expect(await plain.general['get-vaults']()).toMatchObject({
      success: true,
      opened: [],
    });
  });

  it('reports a list that cannot be read', async () => {
    const broken = createPasswordVaultHandlers({
      vaultService: /** @type {any} */ ({
        fileService: vaultService.fileService,
        getAvailableVaults: async () => {
          throw new Error('disk gone');
        },
      }),
      session,
      openSession,
    });
    expect(await broken.general['get-vaults']()).toEqual({
      success: false,
      error: 'disk gone',
    });
  });
});
