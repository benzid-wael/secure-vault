// @vitest-environment node
// Key files through main's handlers (New-54, step 3): native dialogs pick
// and create them, the page sends only the password, and the session ends
// up holding the data key. A real VaultService, VaultSession and keychain;
// the dialog plays the user.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { createPasswordVaultHandlers } from '../../../electron/services/PasswordVaultIpc.js';
import { VaultService } from '../../../electron/services/VaultService.js';
import { VaultSession } from '../../../electron/services/VaultSession.js';
import { VaultKeychain } from '../../../electron/services/VaultKeychain.js';
import { KeyFileLocations } from '../../../electron/services/KeyFileLocations.js';
import { createKeyFile } from '../../../electron/utils/passwordVaultEnvelope.js';
import { fakeSafeStorage } from '../../helpers/fakeSafeStorage.js';

const PW = 'Vault-Pass-12!';
const NEW_PW = 'Brand-New-Pass-42!';
const ev = {};

let dir;
let vs;
let session;
let keychain;
let opens; // what each open dialog picks, in order (null: canceled)
let saveTo; // what the save dialog picks (null: canceled)
let dialog;
let h;
let general;
let locations;

const at = (...parts) => path.join(dir, ...parts);
const vaultFile = () => fs.readJsonSync(at('vaults', 'team.vault'));
const writeKeyFile = async (name) => {
  await fs.outputJson(at('keys', name), createKeyFile());
  return at('keys', name);
};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-keyfile-ipc-'));
  vs = new VaultService(at('vaults'));
  await vs.createVault('team', PW);
  session = new VaultSession();
  keychain = new VaultKeychain({
    file: at('data', 'passwords.json'),
    safeStorage: fakeSafeStorage(),
  });
  opens = [];
  saveTo = at('keys', 'team.svkey');
  dialog = {
    showOpenDialog: vi.fn(async () => {
      const next = opens.shift();
      return next
        ? { canceled: false, filePaths: [next] }
        : { canceled: true, filePaths: [] };
    }),
    showSaveDialog: vi.fn(async () =>
      saveTo ? { canceled: false, filePath: saveTo } : { canceled: true }
    ),
  };
  locations = new KeyFileLocations({ file: at('data', 'locations.json') });
  ({ vault: h, general } = createPasswordVaultHandlers({
    vaultService: vs,
    session,
    openSession: async (name, credential) => session.open(name, credential),
    keychain,
    dialog,
    getWindow: () => null,
    keyFileLocations: locations,
  }));
  await h['unlock-vault'](ev, 'team', PW);
});
afterEach(async () => {
  session.close();
  await fs.remove(dir);
});

const enable = (create = true, password = PW) =>
  h['key-file:enable'](ev, 'team', password, { create });
const loadsInSession = async () =>
  (await session.withPassword('team', (c) => vs.loadVault('team', c))).success;

describe('key-file:enable', () => {
  it('creates a key file elsewhere and moves the vault to format 2', async () => {
    const result = await enable();
    expect(result).toEqual({ success: true, keyFile: 'team.svkey' });
    expect(fs.readJsonSync(saveTo)).toMatchObject({
      type: 'secure-vault-key-file',
      version: 1,
    });
    if (process.platform !== 'win32') {
      expect(fs.statSync(saveTo).mode & 0o777).toBe(0o600);
    }
    expect(vaultFile().version).toBe(2);
    // The session now holds the data key and keeps working.
    expect(typeof session.passwordFor('team')).toBe('object');
    expect(await loadsInSession()).toBe(true);
    expect((await h['key-file:status'](ev, 'team')).enabled).toBe(true);
    expect((await general['get-vaults']()).keyFile).toEqual(['team']);
  });

  it('adds .svkey to a name without it', async () => {
    saveTo = at('keys', 'mine');
    expect((await enable()).keyFile).toBe('mine.svkey');
    expect(fs.existsSync(at('keys', 'mine.svkey'))).toBe(true);
  });

  it('warns when the key file sits in the vault folder', async () => {
    saveTo = at('vaults', 'team.svkey');
    expect((await enable()).warning).toMatch(/same folder as the vault/);
  });

  it('never overwrites a file, which may be another vault’s key file', async () => {
    await fs.outputFile(saveTo, 'precious');
    expect(await enable()).toEqual({
      success: false,
      code: 'INVALID',
      error:
        "team.svkey already exists. Choose another name: it may be another vault's key file.",
    });
    expect(fs.readFileSync(saveTo, 'utf8')).toBe('precious');
    expect(vaultFile().version).toBeUndefined();
  });

  it('uses a key file the user already has', async () => {
    opens = [await writeKeyFile('shared.svkey')];
    expect(await enable(false)).toEqual({
      success: true,
      keyFile: 'shared.svkey',
    });
    expect(dialog.showSaveDialog).not.toHaveBeenCalled();
  });

  it('checks the password before opening any dialog', async () => {
    expect(await enable(true, 'nope')).toMatchObject({
      success: false,
      code: 'AUTH',
    });
    expect(dialog.showSaveDialog).not.toHaveBeenCalled();
    expect(fs.existsSync(saveTo)).toBe(false);
  });

  it('changes nothing when canceled, or given a file that isn’t a key file', async () => {
    saveTo = null;
    expect(await enable()).toEqual({ success: false, canceled: true });
    await fs.outputFile(at('keys', 'notes.txt'), 'hello');
    opens = [at('keys', 'notes.txt')];
    expect(await enable(false)).toEqual({
      success: false,
      code: 'INVALID_KEY_FILE',
      error: "This isn't a SecureVault key file.",
    });
    opens = [at('keys', 'missing.svkey')];
    expect((await enable(false)).error).toBe("missing.svkey can't be read.");
    expect(vaultFile().version).toBeUndefined();
  });

  it('removes the key file it created when turning it on fails', async () => {
    vi.spyOn(vs, 'enableKeyFile').mockResolvedValueOnce({
      success: false,
      error: 'disk full',
    });
    expect(await enable()).toEqual({ success: false, error: 'disk full' });
    expect(fs.existsSync(saveTo)).toBe(false);
  });

  it('is refused while locked, or when already on', async () => {
    await enable();
    expect(await enable()).toMatchObject({
      code: 'INVALID',
      error: 'This vault already uses a key file.',
    });
    session.close();
    expect(await enable()).toMatchObject({ locked: true });
  });

  it('answers a new recovery key when the vault had none it could read', async () => {
    const file = fs.readJsonSync(at('vaults', 'team.vault'));
    await fs.writeJson(at('vaults', 'team.vault'), {
      ...file,
      recoveryMetadata: {},
    });
    expect((await enable()).recoveryKey).toMatch(/^[A-Z0-9-]+$/);
  });

  it('is not available without a dialog', async () => {
    const plain = createPasswordVaultHandlers({
      vaultService: vs,
      session,
      openSession: async () => {},
    });
    expect(
      (await plain.vault['key-file:enable'](ev, 'team', PW, { create: true }))
        .error
    ).toBe('Creating a key file is not available here');
    expect(
      (await plain.vault['unlock-vault-key-file'](ev, 'team', PW)).error
    ).toBe('Choosing a key file is not available here');
  });
});

describe('with a key file on', () => {
  beforeEach(async () => {
    await enable();
    session.close();
    // These cover the dialog path; the remembered location has its own.
    await locations.forget(at('vaults', 'team.vault'));
  });

  const unlock = (password = PW, options) =>
    h['unlock-vault-key-file'](ev, 'team', password, options);

  it('a typed password alone says the key file is needed', async () => {
    expect(await h['unlock-vault'](ev, 'team', PW)).toMatchObject({
      success: false,
      code: 'KEY_FILE_REQUIRED',
    });
  });

  it('unlocks with the password and the key file, keeping the password only', async () => {
    opens = [saveTo];
    const result = await unlock(PW, { remember: true });
    expect(result).toEqual({
      success: true,
      usesDefaultPassword: false,
      remembered: true,
    });
    expect(await loadsInSession()).toBe(true);
    expect(await keychain.has(at('vaults', 'team.vault'))).toBe(true);
    session.close();
    opens = [saveTo];
    await unlock(PW, { remember: false });
    expect(await keychain.has(at('vaults', 'team.vault'))).toBe(false);
  });

  it('refuses a wrong key file or password, and a canceled pick', async () => {
    opens = [await writeKeyFile('other.svkey')];
    expect(await unlock()).toMatchObject({ code: 'KEY_FILE' });
    opens = [saveTo];
    expect(await unlock('nope')).toMatchObject({ code: 'AUTH' });
    expect(await unlock()).toEqual({ success: false, canceled: true });
    expect(session.isUnlocked('team')).toBe(false);
  });

  it('says so when the vault file is gone', async () => {
    opens = [saveTo];
    await fs.remove(at('vaults', 'team.vault'));
    expect((await unlock()).error).toMatch(/isn't there any more/);
  });

  describe('once unlocked', () => {
    beforeEach(async () => {
      opens = [saveTo];
      await unlock(PW, { remember: true });
    });

    it('changes the password with the key file, keeping the session', async () => {
      opens = [saveTo];
      expect(await h['change-master-password'](ev, 'team', PW, NEW_PW)).toEqual(
        { success: true }
      );
      expect(typeof session.passwordFor('team')).toBe('object');
      expect(await loadsInSession()).toBe(true);
      expect(
        (await vs.openWithKeyFile('team', NEW_PW, await readKey(saveTo)))
          .success
      ).toBe(true);
      // The saved password followed.
      session.close();
      const saved = await keychain.get(at('vaults', 'team.vault'), 'test');
      expect(saved.password).toBe(NEW_PW);
    });

    it('needs the key file to change the password', async () => {
      expect(await h['change-master-password'](ev, 'team', PW, NEW_PW)).toEqual(
        { success: false, canceled: true }
      );
    });

    it('turns the key file off, back to the password alone', async () => {
      opens = [saveTo];
      const result = await h['key-file:disable'](ev, 'team', PW);
      expect(result.success).toBe(true);
      expect(result.recoveryKey).toMatch(/^[A-Z0-9-]+$/);
      expect(session.passwordFor('team')).toBe(PW);
      expect(await loadsInSession()).toBe(true);
      expect(vaultFile().version).toBeUndefined();
      expect(await h['key-file:disable'](ev, 'team', PW)).toMatchObject({
        error: "This vault doesn't use a key file.",
      });
      expect(await h['key-file:change'](ev, 'team', PW)).toMatchObject({
        error: "This vault doesn't use a key file.",
      });
    });

    it('needs the key file to turn it off', async () => {
      expect(await h['key-file:disable'](ev, 'team', PW)).toEqual({
        success: false,
        canceled: true,
      });
      opens = [saveTo];
      expect(await h['key-file:disable'](ev, 'team', 'nope')).toMatchObject({
        code: 'AUTH',
      });
    });

    it('changes the key file: the current one first, then a new one', async () => {
      const next = at('keys', 'new.svkey');
      opens = [saveTo];
      saveTo = next;
      expect(
        await h['key-file:change'](ev, 'team', PW, { create: true })
      ).toEqual({ success: true, keyFile: 'new.svkey' });
      expect(
        (await vs.openWithKeyFile('team', PW, await readKey(next))).success
      ).toBe(true);
      expect(await loadsInSession()).toBe(true);
    });

    it('checks the current key file before creating a new one', async () => {
      opens = [await writeKeyFile('other.svkey')];
      expect(
        await h['key-file:change'](ev, 'team', PW, { create: true })
      ).toMatchObject({ code: 'KEY_FILE' });
      expect(dialog.showSaveDialog).toHaveBeenCalledTimes(1); // enable only
      expect(await h['key-file:change'](ev, 'team', PW)).toEqual({
        success: false,
        canceled: true,
      });
    });

    it('removes a new key file when the change fails', async () => {
      opens = [saveTo, saveTo]; // current, then the same file as "new"
      expect(await h['key-file:change'](ev, 'team', PW)).toMatchObject({
        code: 'INVALID',
        error: 'That is the key file this vault already uses.',
      });
      expect(fs.existsSync(saveTo)).toBe(true); // picked, not created
      saveTo = at('keys', 'fresh.svkey');
      vi.spyOn(vs, 'changeKeyFile').mockResolvedValueOnce({
        success: false,
        error: 'disk full',
      });
      opens = [at('keys', 'team.svkey')];
      expect(
        await h['key-file:change'](ev, 'team', PW, { create: true })
      ).toEqual({ success: false, error: 'disk full' });
      expect(fs.existsSync(saveTo)).toBe(false);
    });

    it('deletes the vault with the password and the key file', async () => {
      session.close();
      opens = [saveTo];
      const result = await h['delete-vault'](ev, 'team', PW);
      expect(result.success).toBe(true);
      expect(fs.existsSync(at('vaults', 'team.vault'))).toBe(false);
      expect(await keychain.count()).toBe(0);
    });

    it('needs the key file to delete it', async () => {
      session.close();
      expect(await h['delete-vault'](ev, 'team', PW)).toEqual({
        success: false,
        canceled: true,
      });
      expect(fs.existsSync(at('vaults', 'team.vault'))).toBe(true);
    });
  });
});

describe('the remembered key file location (step 4)', () => {
  const VAULT = () => at('vaults', 'team.vault');
  const unlock = (options = {}) =>
    h['unlock-vault-key-file'](ev, 'team', PW, options);

  beforeEach(async () => {
    await enable();
    session.close();
    dialog.showOpenDialog.mockClear();
  });

  it('is set when the key file is turned on, and listed', async () => {
    expect(locations.get(VAULT())).toBe(saveTo);
    expect((await general['get-vaults']()).keyFileRemembered).toEqual(['team']);
  });

  it('unlocks without a dialog while the key file is there', async () => {
    expect(await unlock()).toEqual({
      success: true,
      usesDefaultPassword: false,
    });
    expect(dialog.showOpenDialog).not.toHaveBeenCalled();
  });

  it('asks when the user chooses another key file, and remembers that one', async () => {
    const copy = at('usb', 'copy.svkey');
    await fs.copy(saveTo, copy);
    opens = [copy];
    expect((await unlock({ chooseAnother: true })).success).toBe(true);
    expect(dialog.showOpenDialog).toHaveBeenCalledTimes(1);
    expect(locations.get(VAULT())).toBe(copy);
  });

  it('says which key file it expected when its drive is gone', async () => {
    const moved = at('usb', 'team.svkey');
    await fs.move(saveTo, moved);
    opens = [moved];
    expect((await unlock()).success).toBe(true);
    expect(dialog.showOpenDialog.mock.calls[0][1].title).toBe(
      "team.svkey isn't there: connect its drive, or choose the key file of team"
    );
    expect(locations.get(VAULT())).toBe(moved);
  });

  it('forgets a remembered file that is no longer this vault’s key file', async () => {
    await fs.writeJson(saveTo, createKeyFile());
    const result = await unlock();
    expect(result).toMatchObject({ success: false, code: 'KEY_FILE' });
    expect(result.error).toBe(
      `The key file at ${saveTo} isn't this vault's any more. Choose its key file.`
    );
    expect(locations.get(VAULT())).toBeNull();
    expect(await unlock()).toEqual({ success: false, canceled: true });
    expect(dialog.showOpenDialog).toHaveBeenCalledTimes(1);
  });

  it('forgets a remembered file that is no longer a key file, and asks', async () => {
    await fs.writeFile(saveTo, 'not a key file');
    expect(await unlock()).toEqual({ success: false, canceled: true });
    expect(dialog.showOpenDialog).toHaveBeenCalledTimes(1);
    expect(locations.get(VAULT())).toBeNull();
  });

  describe('with a saved password', () => {
    beforeEach(async () => {
      await unlock({ remember: true });
      session.close();
    });
    const saved = () => h['unlock-vault-saved'](ev, 'team');

    it('opens with one click: the saved password and the remembered key file', async () => {
      expect(await saved()).toEqual({
        success: true,
        usesDefaultPassword: false,
      });
      expect(dialog.showOpenDialog).not.toHaveBeenCalled();
      expect(await loadsInSession()).toBe(true);
    });

    it('asks for the key file when it isn’t there, quietly on cancel', async () => {
      await fs.move(saveTo, at('usb', 'team.svkey'));
      expect(await saved()).toEqual({
        success: false,
        code: 'CANCELED',
        error: 'Unlock canceled.',
      });
      expect(dialog.showOpenDialog).toHaveBeenCalledTimes(1);
    });

    it('forgets a saved password that no longer opens the vault', async () => {
      await vs.changePassword('team', PW, NEW_PW, {
        keyFileKey: await readKey(saveTo),
      });
      const result = await saved();
      expect(result).toMatchObject({
        success: false,
        code: 'AUTH',
        remembered: false,
      });
      expect(await keychain.count()).toBe(0);
    });

    it('reports a wrong remembered key file as such', async () => {
      await fs.writeJson(saveTo, createKeyFile());
      expect(await saved()).toMatchObject({ success: false, code: 'KEY_FILE' });
      expect(await keychain.count()).toBe(1);
    });
  });

  it('follows a key file change, and goes when it is turned off or the vault deleted', async () => {
    await unlock();
    const next = at('keys', 'next.svkey');
    opens = [saveTo];
    saveTo = next;
    await h['key-file:change'](ev, 'team', PW, { create: true });
    expect(locations.get(VAULT())).toBe(next);
    opens = [next];
    await h['key-file:disable'](ev, 'team', PW);
    expect(locations.get(VAULT())).toBeNull();

    await enable();
    session.close();
    opens = [saveTo];
    await h['delete-vault'](ev, 'team', PW);
    expect(locations.get(VAULT())).toBeNull();
  });
});

async function readKey(file) {
  const { parseKeyFile } = await import(
    '../../../electron/utils/passwordVaultEnvelope.js'
  );
  return parseKeyFile(await fs.readFile(file));
}
