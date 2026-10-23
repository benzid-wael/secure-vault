import fs from 'fs-extra';
import path from 'path';

import { LEGACY_DEFAULT_PASSWORD } from './VaultService.js';
import { isPasswordVaultFile } from './VaultFileService.js';

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
 *   open: (name: string, password: string) => void,
 *   withPassword: (name: string, fn: (password: string) => any) => any}}
 *   deps.session
 * @param {(name: string, password: string) => Promise<void>} deps.openSession
 *   Opens the session after a verified password (and upgrades the KDF).
 * @param {import('./VaultKeychain.js').VaultKeychain|null} [deps.keychain]
 * @param {import('./OpenedVaults.js').OpenedVaults|null} [deps.opened]
 *   Vaults opened from other folders (New-53); the same list `vaultService`
 *   was built with as `links`.
 * @param {{showOpenDialog: Function}|null} [deps.dialog]
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

  const entered = async (vaultName, password, result) => {
    await openSession(vaultName, password);
    // A vault created by an older version may still use its built-in
    // password; the UI asks for it to be changed.
    return {
      ...result,
      usesDefaultPassword: password === LEGACY_DEFAULT_PASSWORD,
    };
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

    'forget-vault-password': async (event, vaultName) => {
      await keychain?.forget(pathOf(vaultName));
      return { success: true };
    },

    // The current password is still re-entered and checked here: holding a
    // session must not be enough to take over the vault. A saved password
    // follows the change; one that wasn't saved isn't saved now.
    'change-master-password': (
      event,
      vaultName,
      currentPassword,
      newPassword
    ) =>
      session.withPassword(vaultName, async () => {
        const result = await vaultService.changePassword(
          vaultName,
          currentPassword,
          newPassword
        );
        if (!result.success) return result;
        session.open(vaultName, newPassword);
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
      const result = await vaultService.deleteVault(
        vaultName,
        confirmationPassword
      );
      if (!result.success) return result;
      if (session.isUnlocked(vaultName)) session.close();
      await keychain?.forget(vaultPath);
      return result;
    },
  };

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
        return { success: true, data: names, opened: openedVaults };
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
