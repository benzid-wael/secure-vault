import fs from 'fs-extra';
import path from 'path';

import { LEGACY_DEFAULT_PASSWORD } from './VaultService.js';
import { isPasswordVaultFile } from './VaultFileService.js';
import {
  PasswordEnvelopeError,
  createKeyFile,
  parseKeyFile,
} from '../utils/passwordVaultEnvelope.js';
import { writePrivateJson } from '../utils/privateJsonFile.js';

/** What a key file is saved as (New-54). */
export const KEY_FILE_EXTENSION = 'svkey';
const KEY_FILE_FILTER = {
  name: 'SecureVault key file',
  extensions: [KEY_FILE_EXTENSION],
};

/**
 * Password vault handlers that touch the saved-password store
 * (GUI-ENV-BREAKDOWN New-52): unlocking, with or without a saved password,
 * changing the master password and deleting a vault. Main registers the
 * first group through its name-validating `handleVault`, so `vaultName` is
 * already safe to turn into a path here; the second group takes no vault.
 *
 * A saved password never leaves main: no handler returns one.
 *
 * @param {Object} deps
 * @param {import('./VaultService.js').VaultService} deps.vaultService
 * @param {{close: () => void, isUnlocked: (name: string) => boolean,
 *   open: (name: string, credential: string | {dek: Buffer}) => void,
 *   withPassword: (name: string,
 *     fn: (credential: string | {dek: Buffer}) => any) => any}} deps.session
 *   Holds the password, or a format-2 vault's data key (New-54).
 * @param {(name: string, credential: string | {dek: Buffer}) =>
 *   Promise<void>} deps.openSession Opens the session after a verified
 *   password or key file (and upgrades a format-1 vault's KDF).
 * @param {import('./VaultKeychain.js').VaultKeychain|null} [deps.keychain]
 * @param {import('./OpenedVaults.js').OpenedVaults|null} [deps.opened]
 *   Vaults opened from other folders (New-53); the same list `vaultService`
 *   was built with as `links`.
 * @param {{showOpenDialog: Function, showSaveDialog?: Function}|null}
 *   [deps.dialog]
 * @param {() => any} [deps.getWindow]
 */
export function createPasswordVaultHandlers({
  vaultService,
  session,
  openSession,
  keychain = null,
  opened = null,
  dialog = null,
  getWindow = () => null,
}) {
  const fileService = vaultService.fileService;
  const pathOf = (vaultName) => fileService.getVaultPath(vaultName);
  const invalid = (error) => ({ success: false, code: 'INVALID', error });

  // A vault whose file is gone says so, not "Invalid master password".
  const explain = (vaultName, result) =>
    result.code === 'NOT_FOUND'
      ? {
          ...result,
          error: `The file of ${vaultName} isn't there any more (${pathOf(vaultName)}).`,
        }
      : result;

  /**
   * Open the session with `credential` (the password, or a format-2
   * vault's `{dek}`) and answer the page, without the credential.
   */
  const entered = async (
    vaultName,
    password,
    result,
    credential = password
  ) => {
    await openSession(vaultName, credential);
    // A vault created by an older version may still use its built-in
    // password; the UI asks for it to be changed.
    const answer = { ...result };
    delete answer.credential; // the data key never reaches the page
    return {
      ...answer,
      usesDefaultPassword: password === LEGACY_DEFAULT_PASSWORD,
    };
  };

  // Key files (New-54) are created and picked here, in native dialogs: the
  // page never sees a key file's path or content.
  /**
   * @typedef {{success: boolean, key?: Buffer, path?: string,
   *   created?: boolean, warning?: string, canceled?: boolean,
   *   code?: string, error?: string}} KeyFileChoice
   */

  /** @returns {Promise<KeyFileChoice>} */
  const pickKeyFile = async (title) => {
    if (!dialog) return invalid('Choosing a key file is not available here');
    const picked = await dialog.showOpenDialog(getWindow(), {
      title,
      properties: ['openFile', 'showHiddenFiles'],
      filters: [KEY_FILE_FILTER, { name: 'All files', extensions: ['*'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) {
      return { success: false, canceled: true };
    }
    const filePath = path.resolve(picked.filePaths[0]);
    try {
      return {
        success: true,
        key: parseKeyFile(await fs.readFile(filePath)),
        path: filePath,
      };
    } catch (error) {
      return error instanceof PasswordEnvelopeError
        ? { success: false, code: error.code, error: error.message }
        : invalid(`${path.basename(filePath)} can't be read.`);
    }
  };

  /**
   * A new key file, saved where the user says; never over another file.
   * @returns {Promise<KeyFileChoice>}
   */
  const createKeyFileFor = async (vaultName) => {
    if (!dialog) return invalid('Creating a key file is not available here');
    const picked = await dialog.showSaveDialog(getWindow(), {
      title: `Save the new key file for ${vaultName}`,
      defaultPath: `${vaultName}.${KEY_FILE_EXTENSION}`,
      filters: [KEY_FILE_FILTER],
    });
    if (picked.canceled || !picked.filePath) {
      return { success: false, canceled: true };
    }
    const filePath = path.resolve(
      picked.filePath.endsWith(`.${KEY_FILE_EXTENSION}`)
        ? picked.filePath
        : `${picked.filePath}.${KEY_FILE_EXTENSION}`
    );
    // It may be another vault's key file: replacing it would lock that
    // vault out.
    if (await fs.pathExists(filePath)) {
      return invalid(
        `${path.basename(filePath)} already exists. Choose another name: it may be another vault's key file.`
      );
    }
    const content = createKeyFile();
    await writePrivateJson(filePath, content);
    return {
      success: true,
      created: true,
      key: parseKeyFile(JSON.stringify(content)),
      path: filePath,
      ...(path.dirname(filePath) === path.dirname(pathOf(vaultName)) && {
        warning:
          'The key file is in the same folder as the vault: anyone who copies the folder gets both. Move it somewhere else, such as a USB stick, and keep a copy.',
      }),
    };
  };

  /**
   * A key file to use: a new one, or one the user already has.
   * @returns {Promise<KeyFileChoice>}
   */
  const keyFileFor = (vaultName, create) =>
    create
      ? createKeyFileFor(vaultName)
      : pickKeyFile(`Choose the key file for ${vaultName}`);

  /** Drop a key file this call created, when what it was for failed. */
  const discard = async (keyFile) => {
    if (keyFile?.created) await fs.remove(keyFile.path).catch(() => {});
  };

  const vault = {
    /**
     * Unlock with a typed password. `options.remember` true keeps it on this
     * computer, false forgets a kept one, absent leaves it as it is.
     */
    'unlock-vault': async (event, vaultName, password, options = {}) => {
      const result = await vaultService.verifyPassword(vaultName, password);
      if (!result.success) return explain(vaultName, result);
      const unlocked = await entered(vaultName, password, result);
      if (keychain && options?.remember === true) {
        return {
          ...unlocked,
          remembered: await keychain.remember(pathOf(vaultName), password),
        };
      }
      if (keychain && options?.remember === false) {
        await keychain.forget(pathOf(vaultName));
      }
      return unlocked;
    },

    /**
     * Unlock with the password kept on this computer, after the presence
     * check. One that no longer opens the vault is forgotten, so the next
     * attempt asks for the password.
     */
    'unlock-vault-saved': async (event, vaultName) => {
      if (!keychain) {
        return { success: false, code: 'NONE', error: 'No saved password' };
      }
      const saved = await keychain.get(
        pathOf(vaultName),
        `unlock ${vaultName}`
      );
      if (!saved.success) {
        return {
          success: false,
          code: saved.code,
          error: {
            NONE: `No saved password for ${vaultName}. Type it instead.`,
            UNAVAILABLE: `This computer can't read the saved password for ${vaultName} right now. Type it instead.`,
            CANCELED: 'Unlock canceled.',
          }[saved.code],
        };
      }
      const result = await vaultService.verifyPassword(
        vaultName,
        saved.password
      );
      if (result.success) return entered(vaultName, saved.password, result);
      if (result.code !== 'AUTH') return explain(vaultName, result);
      await keychain.forget(pathOf(vaultName));
      return {
        success: false,
        code: 'AUTH',
        remembered: false,
        error: `The saved password no longer opens ${vaultName}. Type the current one.`,
      };
    },

    // Only from the unlocked vault, as for env vaults: someone who can't
    // open it can't change how it opens either.
    'forget-vault-password': (event, vaultName) =>
      session.withPassword(vaultName, async () => {
        await keychain?.forget(pathOf(vaultName));
        return { success: true };
      }),

    // The current password is still re-entered and checked here: holding a
    // session must not be enough to take over the vault. A saved password
    // follows the change; one that wasn't saved isn't saved now.
    'change-master-password': (
      event,
      vaultName,
      currentPassword,
      newPassword
    ) =>
      session.withPassword(vaultName, async (credential) => {
        // A vault with a key file (New-54): it and the current password
        // open the vault; the session keeps its data key.
        const withKeyFile = typeof credential !== 'string';
        let keyFileKey = null;
        if (withKeyFile) {
          const keyFile = await pickKeyFile(
            `Choose the key file of ${vaultName}`
          );
          if (!keyFile.success) return keyFile;
          keyFileKey = keyFile.key;
        }
        const result = await vaultService.changePassword(
          vaultName,
          currentPassword,
          newPassword,
          { keyFileKey }
        );
        if (!result.success) return result;
        if (!withKeyFile) session.open(vaultName, newPassword);
        if (keychain && (await keychain.has(pathOf(vaultName)))) {
          await keychain.remember(pathOf(vaultName), newPassword);
        }
        return result;
      }),

    'delete-vault': async (event, vaultName, confirmationPassword) => {
      // Decided for New-53: an opened vault's file isn't deleted.
      if (fileService.isOpened(vaultName)) {
        return invalid(
          `${vaultName} was opened from another folder. Remove it from the list instead; its file stays.`
        );
      }
      const vaultPath = pathOf(vaultName);
      let keyFileKey = null;
      if (await vaultService.usesKeyFile(vaultName)) {
        const keyFile = await pickKeyFile(
          `Choose the key file of ${vaultName} to delete it`
        );
        if (!keyFile.success) return keyFile;
        keyFileKey = keyFile.key;
      }
      const result = await vaultService.deleteVault(
        vaultName,
        confirmationPassword,
        keyFileKey
      );
      if (!result.success) return result;
      if (session.isUnlocked(vaultName)) session.close();
      await keychain?.forget(vaultPath);
      return result;
    },
  };

  // Key files (New-54 step 3).

  /** Unlock a vault that uses a key file: the password, then the file. */
  vault['unlock-vault-key-file'] = async (
    event,
    vaultName,
    password,
    options = {}
  ) => {
    const keyFile = await pickKeyFile(`Choose the key file of ${vaultName}`);
    if (!keyFile.success) return keyFile;
    const result = await vaultService.openWithKeyFile(
      vaultName,
      password,
      keyFile.key
    );
    if (!result.success) return explain(vaultName, result);
    const unlocked = await entered(
      vaultName,
      password,
      result,
      result.credential
    );
    result.credential.dek.fill(0);
    // Only the password is kept (D3): the key file is asked for each time.
    if (keychain && options?.remember === true) {
      return {
        ...unlocked,
        remembered: await keychain.remember(pathOf(vaultName), password),
      };
    }
    if (keychain && options?.remember === false) {
      await keychain.forget(pathOf(vaultName));
    }
    return unlocked;
  };

  vault['key-file:status'] = async (event, vaultName) => ({
    success: true,
    enabled: await vaultService.usesKeyFile(vaultName),
  });

  /**
   * Turn a key file on for the unlocked vault: the password is checked
   * first, then a key file is created (`create`) or picked. Answers the new
   * recovery key when the vault had none the password could read.
   */
  vault['key-file:enable'] = (event, vaultName, password, options = {}) =>
    session.withPassword(vaultName, async (credential) => {
      if (typeof credential !== 'string') {
        return invalid('This vault already uses a key file.');
      }
      const check = await vaultService.verifyPassword(vaultName, password);
      if (!check.success) return check;
      const keyFile = await keyFileFor(vaultName, options?.create === true);
      if (!keyFile.success) return keyFile;
      const result = await vaultService.enableKeyFile(
        vaultName,
        password,
        keyFile.key
      );
      if (!result.success) {
        await discard(keyFile);
        return result;
      }
      session.open(vaultName, result.credential);
      result.credential.dek.fill(0);
      return {
        success: true,
        keyFile: path.basename(keyFile.path),
        ...(result.recoveryKey && { recoveryKey: result.recoveryKey }),
        ...(keyFile.warning && { warning: keyFile.warning }),
      };
    });

  /** Back to the password alone; answers the new recovery key. */
  vault['key-file:disable'] = (event, vaultName, password) =>
    session.withPassword(vaultName, async (credential) => {
      if (typeof credential === 'string') {
        return invalid("This vault doesn't use a key file.");
      }
      const keyFile = await pickKeyFile(`Choose the key file of ${vaultName}`);
      if (!keyFile.success) return keyFile;
      const result = await vaultService.disableKeyFile(
        vaultName,
        password,
        keyFile.key
      );
      if (!result.success) return result;
      session.open(vaultName, password);
      return result;
    });

  /**
   * Replace the key file: the current one and the password are checked
   * first, then the new one is created or picked.
   */
  vault['key-file:change'] = (event, vaultName, password, options = {}) =>
    session.withPassword(vaultName, async (credential) => {
      if (typeof credential === 'string') {
        return invalid("This vault doesn't use a key file.");
      }
      const current = await pickKeyFile(
        `Choose the current key file of ${vaultName}`
      );
      if (!current.success) return current;
      const check = await vaultService.openWithKeyFile(
        vaultName,
        password,
        current.key
      );
      if (!check.success) return check;
      check.credential.dek.fill(0);
      const next = await keyFileFor(vaultName, options?.create === true);
      if (!next.success) return next;
      const result = await vaultService.changeKeyFile(
        vaultName,
        password,
        current.key,
        next.key
      );
      if (!result.success) {
        await discard(next);
        return result;
      }
      return {
        success: true,
        keyFile: path.basename(next.path),
        ...(next.warning && { warning: next.warning }),
      };
    });

  // Vaults opened from other folders (New-53).
  vault['remove-vault'] = async (event, vaultName) => {
    if (!opened?.pathOf(vaultName)) {
      return invalid(
        `${vaultName} is in the app's folder: only a vault opened from another folder can be removed from the list.`
      );
    }
    if (session.isUnlocked(vaultName)) {
      return invalid('Lock the vault before removing it from the list');
    }
    const location = pathOf(vaultName);
    // Nothing would offer its saved password again.
    await keychain?.forget(location);
    await opened.remove(vaultName);
    return { success: true, location };
  };

  const general = {
    /**
     * Every listed vault's name, the app folder's first; `opened` gives the
     * file and whether it's there for those opened from other folders.
     */
    'get-vaults': async () => {
      try {
        const names = await vaultService.getAvailableVaults();
        const openedVaults = await Promise.all(
          (opened?.list() ?? []).map(async (e) => ({
            name: e.name,
            location: e.path,
            exists: await fs.pathExists(e.path),
          }))
        );
        const keyFile = (
          await Promise.all(
            names.map(async (name) =>
              (await vaultService.usesKeyFile(name)) ? name : null
            )
          )
        ).filter(Boolean);
        return {
          success: true,
          data: names,
          opened: openedVaults,
          keyFile,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },

    /**
     * Pick a password vault file anywhere and list it. One in the app's
     * folder is listed already; one opened before keeps its name.
     */
    'open-vault-file': async () => {
      if (!opened || !dialog) {
        return invalid('Opening a vault file is not available here');
      }
      const picked = await dialog.showOpenDialog(getWindow(), {
        title: 'Open Password Vault',
        properties: ['openFile', 'showHiddenFiles'],
        filters: [
          { name: 'Password vault', extensions: ['vault'] },
          { name: 'All files', extensions: ['*'] },
        ],
      });
      if (picked.canceled || picked.filePaths.length === 0) {
        return { success: false, canceled: true };
      }
      const filePath = path.resolve(picked.filePaths[0]);
      const file = path.basename(filePath);
      if (
        path.dirname(filePath) === fileService.vaultDirectory &&
        file.endsWith('.vault')
      ) {
        return { success: true, name: file.slice(0, -'.vault'.length) };
      }
      let data;
      try {
        data = await fs.readJson(filePath);
      } catch {
        return invalid(`${file} isn't a vault file.`);
      }
      if (data?.type === 'environment-vault') {
        return invalid(
          `${file} is an environment vault, not a password vault.`
        );
      }
      if (!isPasswordVaultFile(data)) {
        return invalid(`${file} isn't a password vault.`);
      }
      const name = await opened.add(
        filePath,
        await fileService.listOwnVaults()
      );
      return { success: true, name };
    },

    /**
     * What the selector and Settings show: whether "Remember on this
     * computer" can be offered, how many passwords are kept (every vault
     * kind), and which password vaults have one.
     */
    'saved-passwords:info': async () => {
      if (!keychain) {
        return { success: true, available: false, count: 0, vaults: [] };
      }
      // Passwords of vault files deleted or moved don't linger (New-36).
      await keychain.prune();
      const names = await vaultService.getAvailableVaults();
      const kept = await Promise.all(
        names.map(async (name) =>
          (await keychain.has(pathOf(name))) ? name : null
        )
      );
      return {
        success: true,
        available: keychain.available(),
        count: await keychain.count(),
        vaults: kept.filter(Boolean),
      };
    },

    // "Forget all saved passwords" in Settings: every vault kind.
    'saved-passwords:forget-all': async () => ({
      success: true,
      count: keychain ? await keychain.forgetAll() : 0,
    }),
  };

  return { vault, general };
}
