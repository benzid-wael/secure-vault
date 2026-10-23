import { LEGACY_DEFAULT_PASSWORD } from './VaultService.js';

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
 */
export function createPasswordVaultHandlers({
  vaultService,
  session,
  openSession,
  keychain = null,
}) {
  const pathOf = (vaultName) =>
    vaultService.fileService.getVaultPath(vaultName);

  const opened = async (vaultName, password, result) => {
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
      if (!result.success) return result;
      const unlocked = await opened(vaultName, password, result);
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
      if (result.success) return opened(vaultName, saved.password, result);
      if (result.code !== 'AUTH') return result;
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

  const general = {
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
