import { Vault } from '../models/Vault.js';
import { CryptographyService } from './CryptographyService.js';
import { VaultFileService } from './VaultFileService.js';
import { validatePasswordStrength } from '../../utils/passwordValidation.js';
import { KeyRecoveryService } from './recovery/KeyRecoveryService.js';
import { PasswordRecoveryService } from './recovery/PasswordRecoveryService.js';
import { RecoveryData } from './recovery/IRecoveryMethod.js';
import { checkVaultFormat } from '../utils/vaultFormat.js';
import {
  PasswordEnvelopeError,
  checkKeyFile,
  isFormat2,
  keyFileIdOf,
  mainKekOf,
  newDataKey,
  newHeader,
  openPayload,
  recoveryKekOf,
  sealPayload,
  tampered,
  unwrapSlot,
  wrapSlot,
} from '../utils/passwordVaultEnvelope.js';
import {
  keyFileRequired,
  openVaultPayload,
  resealVaultPayload,
} from '../utils/passwordVaultPayload.js';

/** A request that doesn't fit the vault's state. */
const invalidState = (error) => ({ success: false, code: 'INVALID', error });

/**
 * An unexpected failure as a result: the envelope's and the format check's
 * refusals keep their code and message; a missing vault says so; anything
 * else (a file system error, with its paths) becomes `fallback`.
 */
const failure = (error, fallback) => {
  if (error instanceof PasswordEnvelopeError || error.code === 'NEWER_FORMAT') {
    return { success: false, code: error.code, error: error.message };
  }
  if (error.code === 'ENOENT') {
    return { success: false, code: 'NOT_FOUND', error: 'Vault not found' };
  }
  return { success: false, error: fallback };
};

/** A refusal from the format-2 envelope, as a result. */
const refused = (error) => ({
  success: false,
  code: error.code,
  error: error.message,
});

/**
 * The password earlier versions gave the `default` vault they created on
 * first launch. Nothing creates it any more; it is only recognised so a vault
 * still using it can be flagged on unlock.
 */
export const LEGACY_DEFAULT_PASSWORD = 'changeme123';

export class VaultService {
  /**
   * @param {string} vaultDirectory
   * @param {{deriveKey?: Function, links?: Object}} [options]
   *   `deriveKey(password, salt, iterations)`; the desktop main process
   *   passes its session's caching version so loads and saves don't re-run
   *   PBKDF2 each time. `links`: vaults opened from other folders, as
   *   VaultFileService takes them (New-53).
   */
  constructor(vaultDirectory, { deriveKey, links } = {}) {
    this.fileService = new VaultFileService(vaultDirectory, { links });
    this.deriveKey =
      deriveKey ??
      ((password, salt, iterations) =>
        CryptographyService.deriveKey(password, salt, iterations));
  }

  /** The key for an existing vault file, at the iterations it records. */
  #keyFor(password, record) {
    return this.deriveKey(
      password,
      Buffer.from(record.salt, 'hex'),
      CryptographyService.iterationsOf(record)
    );
  }

  /** A fresh salt and key at the current iterations, plus its header. */
  #freshKey(password) {
    const salt = CryptographyService.generateSalt();
    return {
      key: this.deriveKey(password, salt, CryptographyService.ITERATIONS),
      header: {
        salt: salt.toString('hex'),
        kdf: CryptographyService.kdfHeader(),
      },
    };
  }

  async getAvailableVaults() {
    return this.fileService.listVaults();
  }

  async verifyVaultPassword(vaultName, password) {
    try {
      // Try to load the vault with the provided password
      const result = await this.loadVault(vaultName, password);
      return {
        success: result.success,
        valid: result.success && !!result.data,
        error: result.error,
      };
    } catch (error) {
      console.error(`Error verifying password for vault ${vaultName}:`, error);
      return {
        success: false,
        valid: false,
        error: error.message,
      };
    }
  }

  async createVault(vaultName, masterPassword) {
    if (await this.fileService.vaultExists(vaultName)) {
      throw new Error('Vault already exists');
    }

    const vault = new Vault({ name: vaultName });
    const { key, header } = this.#freshKey(masterPassword);

    // Generate recovery key
    const keyRecoveryService = new KeyRecoveryService();
    const recoveryKey = await keyRecoveryService.generate();
    const recoveryKeyMetadata = keyRecoveryService.createMetadata(
      vaultName,
      masterPassword,
      recoveryKey
    );

    const encryptedData = CryptographyService.encrypt(vault.toJSON(), key);
    let recoveryMetadata = {};
    recoveryMetadata[keyRecoveryService.getRecoveryMethodId()] =
      recoveryKeyMetadata;
    const vaultFile = {
      ...encryptedData,
      ...header,
      recoveryMetadata,
    };

    await this.fileService.writeVaultFile(vaultName, vaultFile);

    return {
      success: true,
      recoveryKey,
      recoveryKeyCreatedAt: recoveryMetadata.recoveryKey.createdAt,
    };
  }

  async verifyPassword(vaultName, password, vaultPath = null) {
    if (!vaultPath) {
      vaultPath = this.fileService.getVaultPath(vaultName);
    }
    try {
      const vaultFile = await this.fileService.readVaultPath(vaultPath);
      // Before the password: a wrong-password message would mislead (New-29).
      const format = checkVaultFormat(vaultFile, 'password', vaultName);
      if (!format.readable) {
        return { success: false, code: 'NEWER_FORMAT', error: format.message };
      }
      // A password alone can't open a format-2 vault: `openWithKeyFile`.
      if (isFormat2(vaultFile)) return refused(keyFileRequired());
      const key = this.#keyFor(password, vaultFile);

      const encryptedData = {
        encrypted: vaultFile.encrypted,
        authTag: vaultFile.authTag,
        iv: vaultFile.iv,
      };

      CryptographyService.decrypt(encryptedData, key);
      return format.writable
        ? { success: true }
        : { success: true, readOnly: true, formatMessage: format.message };
    } catch (error) {
      // AUTH only for a password that doesn't decrypt the file: callers
      // holding a saved password drop it on AUTH, not on a missing file.
      return {
        success: false,
        code: error.code === 'ENOENT' ? 'NOT_FOUND' : 'AUTH',
        error: 'Invalid master password',
      };
    }
  }

  /**
   * @param {string} vaultName
   * @param {string | {dek: Buffer}} credential The password (format 1), or
   *   the data key of a format-2 vault (New-54).
   */
  async loadVault(vaultName, credential) {
    try {
      const vaultFile = await this.fileService.readVaultFile(vaultName);
      const format = checkVaultFormat(vaultFile, 'password', vaultName);
      if (!format.readable) {
        return { success: false, code: 'NEWER_FORMAT', error: format.message };
      }
      const vaultData = openVaultPayload(vaultFile, credential, this.deriveKey);

      const vault = Vault.fromJSON(vaultData, vaultName);
      const vaultJson = vault.toJSON();
      // Saves are refused by the file service; the page says why up front.
      return format.writable
        ? { success: true, data: vaultJson }
        : {
            success: true,
            data: vaultJson,
            readOnly: true,
            formatMessage: format.message,
          };
    } catch (error) {
      return error.code
        ? refused(error)
        : { success: false, error: error.message };
    }
  }

  /**
   * A format-2 vault (New-54): the password and the key file's key open its
   * `main` slot. Resolves to the credential a session holds, `{dek}`, never
   * the password.
   * @param {string} vaultName
   * @param {string} password
   * @param {Buffer} keyFileKey From `parseKeyFile`.
   * @returns {Promise<{success: boolean, credential?: {dek: Buffer},
   *   readOnly?: boolean, formatMessage?: string, code?: string,
   *   error?: string}>}
   */
  async openWithKeyFile(vaultName, password, keyFileKey) {
    let vaultFile;
    try {
      vaultFile = await this.fileService.readVaultFile(vaultName);
    } catch (error) {
      return {
        success: false,
        code: error.code === 'ENOENT' ? 'NOT_FOUND' : 'ERROR',
        error: error.code === 'ENOENT' ? 'Vault not found' : error.message,
      };
    }
    const format = checkVaultFormat(vaultFile, 'password', vaultName);
    if (!format.readable) {
      return { success: false, code: 'NEWER_FORMAT', error: format.message };
    }
    if (!isFormat2(vaultFile)) {
      return {
        success: false,
        code: 'NO_KEY_FILE',
        error:
          "This vault doesn't use a key file: its password alone opens it.",
      };
    }
    try {
      // The key file first: a wrong one isn't reported as a wrong password.
      checkKeyFile(vaultFile, keyFileKey);
      const passwordKey = this.#keyFor(password, vaultFile);
      const kek = mainKekOf(passwordKey, keyFileKey, vaultFile.salt);
      const dek = unwrapSlot(vaultFile, 'main', kek);
      kek.fill(0);
      openPayload(vaultFile, dek); // the payload too, before calling it open
      return format.writable
        ? { success: true, credential: { dek } }
        : {
            success: true,
            credential: { dek },
            readOnly: true,
            formatMessage: format.message,
          };
    } catch (error) {
      return refused(error);
    }
  }

  /** Whether `vaultName` is in format 2 and so needs its key file. */
  async usesKeyFile(vaultName) {
    try {
      return isFormat2(await this.fileService.readVaultFile(vaultName));
    } catch {
      return false;
    }
  }

  /**
   * Turn a key file on (New-54 step 3): rewrite a format-1 vault as
   * format 2, the payload under a new data key wrapped by the password +
   * key file and by the recovery key. The vault's recovery key is kept when
   * the password can read it; otherwise a new one is made and returned, for
   * the user to save. The format-1 backup goes: it would open with the
   * password alone.
   * @returns {Promise<{success: boolean, credential?: {dek: Buffer},
   *   recoveryKey?: string, code?: string, error?: string}>}
   */
  async enableKeyFile(vaultName, password, keyFileKey) {
    try {
      const vaultFile = await this.fileService.readVaultFile(vaultName);
      if (isFormat2(vaultFile)) {
        return invalidState('This vault already uses a key file.');
      }
      let payload;
      try {
        payload = openVaultPayload(vaultFile, password, this.deriveKey);
      } catch {
        return {
          success: false,
          code: 'AUTH',
          error: 'Invalid master password',
        };
      }

      const keyRecovery = new KeyRecoveryService();
      const kept = keyRecovery.recoveryKeyOf(
        vaultFile.recoveryMetadata?.[keyRecovery.getRecoveryMethodId()],
        password
      );
      const recoveryKey =
        kept ?? (await keyRecovery.generate(vaultName)).data.key;

      const dek = newDataKey();
      const kdf = CryptographyService.kdfHeader();
      const salt = CryptographyService.generateSalt().toString('hex');
      const recovery = {
        salt: CryptographyService.generateSalt().toString('hex'),
        kdf,
      };
      const mainKek = mainKekOf(
        this.deriveKey(password, Buffer.from(salt, 'hex'), kdf.iterations),
        keyFileKey,
        salt
      );
      const recoveryKek = await recoveryKekOf(recoveryKey, recovery);
      let file = newHeader({
        salt,
        kdf,
        keyFileId: keyFileIdOf(keyFileKey),
        recovery,
      });
      file = wrapSlot(file, 'main', dek, mainKek);
      file = wrapSlot(file, 'recovery', dek, recoveryKek);
      file = sealPayload(file, payload, dek);
      // Opened again through both slots before it replaces the vault.
      openPayload(file, unwrapSlot(file, 'main', mainKek));
      openPayload(file, unwrapSlot(file, 'recovery', recoveryKek));
      mainKek.fill(0);
      recoveryKek.fill(0);

      await this.fileService.atomicWriteVaultFile(vaultName, file);
      await this.fileService.removeBackup(vaultName);
      return {
        success: true,
        credential: { dek },
        ...(kept ? {} : { recoveryKey }),
      };
    } catch (error) {
      return failure(error, 'Failed to turn the key file on');
    }
  }

  /**
   * Turn the key file off (New-54 step 3, Q2): rewrite a format-2 vault as
   * format 1 under the password alone, which older versions open again,
   * with a new recovery key (format 1's recovery keeps a copy of the
   * password, which format 2 doesn't have). Returns the new key.
   */
  async disableKeyFile(vaultName, password, keyFileKey) {
    try {
      const opened = await this.openWithKeyFile(
        vaultName,
        password,
        keyFileKey
      );
      if (!opened.success) return opened;
      const vaultFile = await this.fileService.readVaultFile(vaultName);
      const payload = openPayload(vaultFile, opened.credential.dek);
      opened.credential.dek.fill(0);

      const { file, ...recovery } = await this.#passwordOnlyFile(
        vaultName,
        payload,
        password
      );
      await this.fileService.atomicWriteVaultFile(vaultName, file);
      return { success: true, ...recovery };
    } catch (error) {
      return failure(error, 'Failed to turn the key file off');
    }
  }

  /**
   * A format-1 file holding `payload` under `password` alone, with a new
   * recovery key (format 1's recovery keeps a copy of the password).
   */
  async #passwordOnlyFile(vaultName, payload, password) {
    const keyRecovery = new KeyRecoveryService();
    const recoveryData = await keyRecovery.generate(vaultName);
    const metadata = keyRecovery.createMetadata(
      vaultName,
      password,
      recoveryData
    );
    const { key, header } = this.#freshKey(password);
    return {
      file: {
        ...CryptographyService.encrypt(payload, key),
        ...header,
        recoveryMetadata: { [keyRecovery.getRecoveryMethodId()]: metadata },
      },
      recoveryKey: recoveryData.data.key,
      recoveryKeyCreatedAt: metadata.createdAt,
    };
  }

  /**
   * A format-2 vault opened with its recovery key alone (New-54 step 5,
   * D2): the `recovery` slot, then the payload. Resolves to `{dek}`; the
   * caller sets a new password (`resetWithRecoveryKey`) before going on.
   * @returns {Promise<{success: boolean, credential?: {dek: Buffer},
   *   code?: string, error?: string}>}
   */
  async openWithRecoveryKey(vaultName, recoveryKey) {
    try {
      const vaultFile = await this.fileService.readVaultFile(vaultName);
      const format = checkVaultFormat(vaultFile, 'password', vaultName);
      if (!format.readable) {
        return { success: false, code: 'NEWER_FORMAT', error: format.message };
      }
      if (!isFormat2(vaultFile)) {
        return {
          success: false,
          code: 'NO_KEY_FILE',
          error: "This vault doesn't use a key file.",
        };
      }
      if (typeof recoveryKey !== 'string' || !recoveryKey.trim()) {
        return { success: false, code: 'AUTH', error: 'Invalid recovery key' };
      }
      const slot = vaultFile.slots?.recovery;
      // No slot to derive against: a changed file, not a wrong key.
      if (!slot?.salt || !slot.wrapped) throw tampered();
      const kek = await recoveryKekOf(recoveryKey.trim(), slot);
      let dek;
      try {
        dek = unwrapSlot(vaultFile, 'recovery', kek);
      } finally {
        kek.fill(0);
      }
      openPayload(vaultFile, dek);
      return { success: true, credential: { dek } };
    } catch (error) {
      return failure(error, 'Failed to open the vault with the recovery key');
    }
  }

  /**
   * Recover a format-2 vault (New-54 step 5): the recovery key opens it and
   * `newPassword` replaces the forgotten one, with `newKeyFileKey` as its
   * key file. The recovery slot stays, so the same recovery key still
   * works. Without a key file it's rewritten as format 1 under the new
   * password, with a new recovery key (as turning the key file off does).
   * @param {string} vaultName
   * @param {string} recoveryKey
   * @param {string} newPassword
   * @param {Buffer|null} [newKeyFileKey]
   * @returns {Promise<{success: boolean, credential?: {dek: Buffer},
   *   recoveryKey?: string, recoveryKeyCreatedAt?: string, code?: string,
   *   error?: string}>}
   */
  async resetWithRecoveryKey(
    vaultName,
    recoveryKey,
    newPassword,
    newKeyFileKey = null
  ) {
    const weak = validatePasswordStrength(newPassword);
    if (weak.length > 0) return invalidState(weak[0]);
    try {
      const opened = await this.openWithRecoveryKey(vaultName, recoveryKey);
      if (!opened.success) return opened;
      const { dek } = opened.credential;
      const vaultFile = await this.fileService.readVaultFile(vaultName);
      const payload = openPayload(vaultFile, dek);

      if (!newKeyFileKey) {
        dek.fill(0);
        const { file, ...recovery } = await this.#passwordOnlyFile(
          vaultName,
          payload,
          newPassword
        );
        await this.fileService.atomicWriteVaultFile(vaultName, file);
        return { success: true, ...recovery };
      }

      const { key, header } = this.#freshKey(newPassword);
      let file = {
        ...vaultFile,
        ...header,
        keyFile: { id: keyFileIdOf(newKeyFileKey) },
      };
      const kek = mainKekOf(key, newKeyFileKey, header.salt);
      key.fill(0);
      file = wrapSlot(file, 'main', dek, kek);
      file = sealPayload(file, payload, dek);
      // Opened again with the new password and key file before it's kept.
      const check = unwrapSlot(file, 'main', kek);
      kek.fill(0);
      openPayload(file, check);
      check.fill(0);
      await this.fileService.atomicWriteVaultFile(vaultName, file);
      return { success: true, credential: { dek } };
    } catch (error) {
      return failure(error, 'Failed to recover the vault');
    }
  }

  /**
   * Replace a format-2 vault's key file (New-54 step 3): the current one
   * and the password open it, the new one re-wraps the main slot. The
   * recovery slot, which doesn't cover the key file, stays.
   */
  async changeKeyFile(vaultName, password, currentKeyFileKey, newKeyFileKey) {
    try {
      if (keyFileIdOf(currentKeyFileKey) === keyFileIdOf(newKeyFileKey)) {
        return invalidState('That is the key file this vault already uses.');
      }
      const opened = await this.openWithKeyFile(
        vaultName,
        password,
        currentKeyFileKey
      );
      if (!opened.success) return opened;
      const { dek } = opened.credential;
      const vaultFile = await this.fileService.readVaultFile(vaultName);
      const payload = openPayload(vaultFile, dek);
      let file = { ...vaultFile, keyFile: { id: keyFileIdOf(newKeyFileKey) } };
      const kek = mainKekOf(
        this.#keyFor(password, vaultFile),
        newKeyFileKey,
        vaultFile.salt
      );
      file = wrapSlot(file, 'main', dek, kek);
      kek.fill(0);
      file = sealPayload(file, payload, dek);
      await this.fileService.atomicWriteVaultFile(vaultName, file);
      dek.fill(0);
      return { success: true };
    } catch (error) {
      return failure(error, 'Failed to change the key file');
    }
  }

  async saveVault(vaultName, password, vaultData) {
    try {
      // Load existing recovery metadata
      let existingFile = null;
      let existingRecoveryMetadata = {};
      if (await this.fileService.vaultExists(vaultName)) {
        try {
          existingFile = await this.fileService.readVaultFile(vaultName);
          existingRecoveryMetadata = existingFile.recoveryMetadata || {};
        } catch (error) {
          console.warn('Could not load existing recovery metadata');
        }
      }

      const vault = Vault.fromJSON(vaultData, vaultName);
      // Format 2 (New-54): the same header and slots, the payload re-sealed
      // under the data key.
      if (existingFile && isFormat2(existingFile)) {
        await this.fileService.writeVaultFile(
          vaultName,
          resealVaultPayload(
            existingFile,
            vault.toJSON(),
            password,
            this.deriveKey
          )
        );
        return { success: true };
      }
      if (typeof password !== 'string') {
        throw new Error('A format-1 vault is saved with its password');
      }
      // A vault already at the current work factor keeps its salt (each
      // encryption still gets a fresh random IV), so the session's cached key
      // is reused instead of paying for PBKDF2 on every save.
      let key;
      let header;
      if (existingFile && !CryptographyService.needsKdfUpgrade(existingFile)) {
        key = this.#keyFor(password, existingFile);
        header = CryptographyService.keyHeaderOf(existingFile);
      } else {
        ({ key, header } = this.#freshKey(password));
      }

      const encryptedData = CryptographyService.encrypt(vault.toJSON(), key);
      const vaultFile = {
        ...encryptedData,
        ...header,
        recoveryMetadata: existingRecoveryMetadata,
      };

      await this.fileService.writeVaultFile(vaultName, vaultFile);
      return { success: true };
    } catch (error) {
      return { success: false, code: error.code, error: error.message };
    }
  }

  /**
   * @param {string} vaultName
   * @param {string} currentPassword
   * @param {string} newPassword
   * @param {{keyFileKey?: Buffer}} [options] A format-2 vault's key file:
   *   with the current password it opens the vault, and the new password
   *   re-wraps its main slot under a new salt (New-54 step 3).
   */
  async changePassword(
    vaultName,
    currentPassword,
    newPassword,
    { keyFileKey = null } = {}
  ) {
    try {
      // Validate new password
      const passwordErrors = validatePasswordStrength(newPassword);
      if (passwordErrors.length > 0) {
        return { success: false, error: passwordErrors[0] };
      }

      if (!(await this.fileService.vaultExists(vaultName))) {
        return { success: false, error: 'Vault not found' };
      }
      if (isFormat2(await this.fileService.readVaultFile(vaultName))) {
        return await this.#changeFormat2Password(
          vaultName,
          currentPassword,
          newPassword,
          keyFileKey
        );
      }

      // Create backup
      await this.fileService.createBackup(vaultName);

      try {
        // Load and verify current password
        const vaultFile = await this.fileService.readVaultFile(vaultName);
        const currentKey = this.#keyFor(currentPassword, vaultFile);

        const encryptedData = {
          encrypted: vaultFile.encrypted,
          authTag: vaultFile.authTag,
          iv: vaultFile.iv,
        };

        const vaultData = CryptographyService.decrypt(
          encryptedData,
          currentKey
        );
        const vault = Vault.fromJSON(vaultData, vaultName);

        // Check password reuse
        const newPasswordHash = CryptographyService.hashPassword(newPassword);
        if (newPassword === currentPassword) {
          return {
            success: false,
            error: 'New password must be different from current password',
          };
        }

        if (vault.checkPasswordReuse(newPasswordHash)) {
          return {
            success: false,
            error:
              'This password has been used before. Please choose a different password.',
          };
        }

        // Update vault with password history
        const currentPasswordHash =
          CryptographyService.hashPassword(currentPassword);
        vault.addPasswordToHistory(currentPasswordHash);
        vault.updateLastPasswordChange();

        // Update recovery metadata
        const updatedRecoveryMetadata =
          await this.#updateRecoveryMetadataForPasswordChange(
            vaultName,
            vaultFile.recoveryMetadata || {},
            currentPassword,
            newPassword
          );

        // Re-encrypt with new password
        const { key: newKey, header } = this.#freshKey(newPassword);
        const newEncryptedData = CryptographyService.encrypt(
          vault.toJSON(),
          newKey
        );

        const finalVaultFile = {
          ...newEncryptedData,
          ...header,
          recoveryMetadata: updatedRecoveryMetadata,
        };

        // Test decryption before saving
        const testKey = newKey;
        const testEncryptedData = {
          encrypted: finalVaultFile.encrypted,
          authTag: finalVaultFile.authTag,
          iv: finalVaultFile.iv,
        };
        CryptographyService.decrypt(testEncryptedData, testKey);

        // Atomically write the new vault file
        await this.fileService.atomicWriteVaultFile(vaultName, finalVaultFile);

        // The backup exists only to roll back a failed change. Kept after a
        // successful one, it would still open with the retired password, and
        // "restore backup" would silently undo the change.
        await this.fileService.removeBackup(vaultName);

        return { success: true };
      } catch (error) {
        // Restore from backup on error
        await this.fileService.restoreFromBackup(vaultName);
        throw error;
      }
    } catch (error) {
      console.error('Error changing password:', error);
      if (error.code === 'NEWER_FORMAT') {
        return { success: false, code: error.code, error: error.message };
      }
      return { success: false, error: 'Failed to change master password' };
    }
  }

  async #changeFormat2Password(vaultName, current, next, keyFileKey) {
    if (!Buffer.isBuffer(keyFileKey)) return refused(keyFileRequired());
    if (next === current) {
      return {
        success: false,
        error: 'New password must be different from current password',
      };
    }
    const opened = await this.openWithKeyFile(vaultName, current, keyFileKey);
    if (!opened.success) return opened;
    const { dek } = opened.credential;
    const vaultFile = await this.fileService.readVaultFile(vaultName);
    const vault = Vault.fromJSON(openPayload(vaultFile, dek), vaultName);
    if (vault.checkPasswordReuse(CryptographyService.hashPassword(next))) {
      return {
        success: false,
        error:
          'This password has been used before. Please choose a different password.',
      };
    }
    vault.addPasswordToHistory(CryptographyService.hashPassword(current));
    vault.updateLastPasswordChange();

    const salt = CryptographyService.generateSalt().toString('hex');
    const kdf = CryptographyService.kdfHeader();
    let file = { ...vaultFile, salt, kdf };
    const kek = mainKekOf(
      this.deriveKey(next, Buffer.from(salt, 'hex'), kdf.iterations),
      keyFileKey,
      salt
    );
    file = wrapSlot(file, 'main', dek, kek);
    kek.fill(0);
    file = sealPayload(file, vault.toJSON(), dek);
    await this.fileService.atomicWriteVaultFile(vaultName, file);
    dek.fill(0);
    return { success: true };
  }

  /**
   * Re-key a vault written with fewer than the current PBKDF2 iterations
   * (M2). Call after a successful unlock, with the master password.
   *
   * - The vault is re-encrypted under a fresh salt at the current count.
   * - Recovery-key metadata is rebuilt around the *same* recovery key, so the
   *   key the user saved keeps working.
   * - Legacy previous-password metadata is dropped: it wraps the current
   *   master password under the previous password, which we don't have, so
   *   it can't be re-keyed and would stay a cheaper path to the master
   *   password. It is recreated (at the current count) on the next password
   *   change; the recovery key still works meanwhile.
   *
   * Copies left by earlier deletes (`*.vault.deleted.*`) are not touched.
   *
   * @returns {Promise<{success: boolean, upgraded?: boolean, error?: string}>}
   */
  async upgradeKdf(vaultName, password) {
    try {
      // A format-2 vault is written at the current work factor, and only
      // the password + key file could re-key its main slot.
      if (typeof password !== 'string') {
        return { success: true, upgraded: false };
      }
      const vaultFile = await this.fileService.readVaultFile(vaultName);
      if (isFormat2(vaultFile)) return { success: true, upgraded: false };
      const keyRecovery = new KeyRecoveryService();
      const passwordRecovery = new PasswordRecoveryService();
      const keyId = keyRecovery.getRecoveryMethodId();
      const passwordId = passwordRecovery.getRecoveryMethodId();
      const metadata = { ...(vaultFile.recoveryMetadata || {}) };

      const legacy = (record) =>
        !!record && CryptographyService.needsKdfUpgrade(record);
      if (
        !legacy(vaultFile) &&
        !legacy(metadata[keyId]) &&
        !legacy(metadata[passwordId])
      ) {
        return { success: true, upgraded: false };
      }

      const vaultData = CryptographyService.decrypt(
        {
          encrypted: vaultFile.encrypted,
          authTag: vaultFile.authTag,
          iv: vaultFile.iv,
        },
        this.#keyFor(password, vaultFile)
      );

      if (legacy(metadata[keyId])) {
        const rekeyed = keyRecovery.onPasswordChange(
          vaultName,
          metadata[keyId],
          password,
          password
        );
        if (rekeyed.success) metadata[keyId] = rekeyed.metadata;
      }
      if (legacy(metadata[passwordId])) delete metadata[passwordId];

      const { key, header } = this.#freshKey(password);
      const upgradedFile = {
        ...CryptographyService.encrypt(vaultData, key),
        ...header,
        recoveryMetadata: metadata,
      };

      // No backup copy: the write is atomic, and a backup would keep the
      // weaker legacy file on disk. An existing legacy backup goes for the
      // same reason.
      await this.fileService.atomicWriteVaultFile(vaultName, upgradedFile);
      await this.fileService.removeLegacyBackup(vaultName);
      return { success: true, upgraded: true };
    } catch (error) {
      console.error('Failed to upgrade vault key derivation:', error.message);
      return { success: false, error: 'Failed to upgrade vault encryption' };
    }
  }

  /**
   * @param {string} vaultName
   * @param {string|null} confirmationPassword
   * @param {Buffer|null} [keyFileKey] A format-2 vault's key file: it and
   *   the password confirm the delete (New-54 step 3).
   */
  async deleteVault(vaultName, confirmationPassword = null, keyFileKey = null) {
    try {
      if (!(await this.fileService.vaultExists(vaultName))) {
        return { success: false, error: 'Vault not found' };
      }

      // Every vault needs its password to be deleted.
      if (!confirmationPassword) {
        return {
          success: false,
          error: 'Enter the vault password to delete it',
        };
      }
      const verification = await this.verifyPassword(
        vaultName,
        confirmationPassword
      );
      if (verification.code === 'KEY_FILE_REQUIRED') {
        if (!Buffer.isBuffer(keyFileKey)) return verification;
        const opened = await this.openWithKeyFile(
          vaultName,
          confirmationPassword,
          keyFileKey
        );
        if (!opened.success) {
          return {
            ...opened,
            error: `${opened.error} Vault not deleted.`,
          };
        }
        opened.credential.dek.fill(0);
        const backupFile = await this.fileService.deleteVault(vaultName);
        return {
          success: true,
          message: `Vault "${vaultName}" has been deleted. A backup was created.`,
          backupFile,
        };
      }
      if (!verification.success) {
        return {
          success: false,
          error: 'Invalid password. Vault not deleted.',
        };
      }

      const backupFile = await this.fileService.deleteVault(vaultName);

      return {
        success: true,
        message: `Vault "${vaultName}" has been deleted. A backup was created.`,
        backupFile,
      };
    } catch (error) {
      return { success: false, error: 'Failed to delete vault' };
    }
  }

  // Recovery methods
  /**
   * A new recovery key. `credential` is the session's: the password
   * (format 1), or the data key, which re-wraps only the recovery slot
   * (format 2, New-54).
   */
  async generateRecoveryKey(vaultName, masterPassword) {
    try {
      if (!(await this.fileService.vaultExists(vaultName))) {
        return { success: false, error: 'Vault not found' };
      }
      const current = await this.fileService.readVaultFile(vaultName);
      if (isFormat2(current)) {
        return await this.#newRecoverySlot(vaultName, current, masterPassword);
      }

      // Verify password
      const verification = await this.verifyPassword(vaultName, masterPassword);
      if (!verification.success) {
        return { success: false, error: 'Invalid master password' };
      }

      const vaultFile = await this.fileService.readVaultFile(vaultName);

      const keyRecoveryService = new KeyRecoveryService();
      const recoveryKey = await keyRecoveryService.generate();
      const recoveryMetadata = keyRecoveryService.createMetadata(
        vaultName,
        masterPassword,
        recoveryKey
      );
      let newRecoveryMetadata = vaultFile.recoveryMetadata;
      newRecoveryMetadata[keyRecoveryService.getRecoveryMethodId()] =
        recoveryMetadata;

      // Update vault file
      const updatedVaultFile = {
        ...vaultFile,
        recoveryMetadata: newRecoveryMetadata,
      };

      await this.fileService.writeVaultFile(vaultName, updatedVaultFile);

      return {
        success: true,
        recoveryKey: recoveryKey.data.key,
        createdAt: recoveryMetadata.createdAt,
      };
    } catch (error) {
      console.error('Failed to generate recovery key: ', error);
      if (error.code === 'NEWER_FORMAT') {
        return { success: false, code: error.code, error: error.message };
      }
      return { success: false, error: 'Failed to generate recovery key' };
    }
  }

  async #newRecoverySlot(vaultName, vaultFile, credential) {
    const dek = credential?.dek;
    if (!Buffer.isBuffer(dek)) return refused(keyFileRequired());
    let payload;
    try {
      payload = openPayload(vaultFile, dek);
    } catch (error) {
      return refused(error);
    }
    const recoveryKey = (await new KeyRecoveryService().generate(vaultName))
      .data.key;
    const slot = {
      salt: CryptographyService.generateSalt().toString('hex'),
      kdf: CryptographyService.kdfHeader(),
    };
    const kek = await recoveryKekOf(recoveryKey, slot);
    let updated = wrapSlot(
      { ...vaultFile, slots: { ...vaultFile.slots, recovery: slot } },
      'recovery',
      dek,
      kek
    );
    kek.fill(0);
    updated = sealPayload(updated, payload, dek);
    await this.fileService.writeVaultFile(vaultName, updated);
    return {
      success: true,
      recoveryKey,
      createdAt: new Date().toISOString(),
    };
  }

  async verifyRecoveryKey(vaultName, recoveryKey) {
    try {
      if (!(await this.fileService.vaultExists(vaultName))) {
        return { success: false, error: 'Vault not found' };
      }

      const keyRecoveryService = new KeyRecoveryService();
      const methodId = keyRecoveryService.getRecoveryMethodId();
      const vaultFile = await this.fileService.readVaultFile(vaultName);
      // The recovery slot (New-54 step 5); `keyFile` tells the page a new
      // password comes next (`resetWithRecoveryKey`).
      if (isFormat2(vaultFile)) {
        const opened = await this.openWithRecoveryKey(vaultName, recoveryKey);
        if (!opened.success) return opened;
        opened.credential.dek.fill(0);
        return { success: true, keyFile: true };
      }

      if (
        !vaultFile.recoveryMetadata ||
        !vaultFile.recoveryMetadata[methodId]
      ) {
        return {
          success: false,
          error: 'No recovery key found for this vault',
        };
      }

      const recoveryData = new RecoveryData({ data: { key: recoveryKey } });
      return await keyRecoveryService.verify(
        vaultName,
        vaultFile.recoveryMetadata[methodId],
        recoveryData
      );
    } catch (error) {
      console.error(`Failed to verify recovery key: ${error}`);
      return { success: false, error: 'Failed to verify recovery key' };
    }
  }

  async loadVaultWithPassword(vaultName, oldPassword) {
    try {
      if (!(await this.fileService.vaultExists(vaultName))) {
        return { success: false, error: 'Vault not found' };
      }

      const vaultFile = await this.fileService.readVaultFile(vaultName);
      // Format 2 keeps no copy of earlier passwords (New-54).
      if (isFormat2(vaultFile)) {
        return {
          success: false,
          code: 'UNSUPPORTED',
          error:
            'A vault that uses a key file can be recovered only with its recovery key.',
        };
      }

      // First, try if the old password is actually the current password
      try {
        const loadResult = await this.loadVault(vaultName, oldPassword);

        if (loadResult.success) {
          loadResult.password = oldPassword;
          return loadResult;
        }
      } catch (error) {
        // Not the current password, try recovery
      }

      const passwordRecoveryService = new PasswordRecoveryService();
      const methodId = passwordRecoveryService.getRecoveryMethodId();
      // Check if we have previous password recovery data
      if (
        !vaultFile.recoveryMetadata ||
        !vaultFile.recoveryMetadata[methodId]
      ) {
        return {
          success: false,
          error:
            'No recovery data available for this vault. You need to change your password at least once to enable previous password recovery.',
        };
      }

      try {
        const recoveryData = new RecoveryData({
          data: { password: oldPassword },
        });
        const result = await passwordRecoveryService.recoverMasterPassword(
          vaultName,
          vaultFile.recoveryMetadata[methodId],
          recoveryData
        );
        if (!result.success) {
          return result;
        }

        const masterPassword = result.masterPassword;
        const loadResult = await this.loadVault(vaultName, masterPassword);

        if (loadResult.success) {
          loadResult.password = masterPassword;
        }

        return loadResult;
      } catch (error) {
        const message =
          'Failed to recover vault using recovered master password';
        console.error(`${message}: ${error}`);
        return { success: false, error: message };
      }
    } catch (error) {
      const message = 'Failed to recover vault with old password';
      console.error(message, ': ', error);
      return { success: false, error: message };
    }
  }

  async loadVaultWithRecoveryKey(vaultName, recoveryKey) {
    try {
      if (!(await this.fileService.vaultExists(vaultName))) {
        return { success: false, error: 'Vault not found' };
      }

      const keyRecoveryService = new KeyRecoveryService();
      const methodId = keyRecoveryService.getRecoveryMethodId();
      const vaultFile = await this.fileService.readVaultFile(vaultName);
      // Its session holds no password: it gets a new one when recovered.
      if (isFormat2(vaultFile)) {
        return {
          success: false,
          code: 'NEW_PASSWORD_REQUIRED',
          error:
            'Recovering a vault that uses a key file sets a new password: check the recovery key, then choose one.',
        };
      }

      if (
        !vaultFile.recoveryMetadata ||
        !vaultFile.recoveryMetadata[methodId]
      ) {
        return {
          success: false,
          error: 'No recovery key found for this vault',
        };
      }

      const recoveryData = new RecoveryData({ data: { key: recoveryKey } });
      const result = await keyRecoveryService.recoverMasterPassword(
        vaultName,
        vaultFile.recoveryMetadata[methodId],
        recoveryData
      );

      if (!result.success) {
        return result;
      }

      const masterPassword = result.masterPassword;
      const loadResult = await this.loadVault(vaultName, masterPassword);

      if (loadResult.success) {
        loadResult.password = masterPassword;
      }

      return loadResult;
    } catch (error) {
      console.error(`Failed to load vault with recovery key: ${error}`);
      return {
        success: false,
        error: 'Failed to load vault with recovery key',
      };
    }
  }

  async #updateRecoveryMetadataForPasswordChange(
    vaultName,
    existingMetadata,
    currentPassword,
    newPassword
  ) {
    const keyRecoveryService = new KeyRecoveryService();
    const passwordRecoveryService = new PasswordRecoveryService();

    const metadata = [keyRecoveryService, passwordRecoveryService]
      .flatMap((recoveryMethod) => {
        const methodId = recoveryMethod.getRecoveryMethodId();
        const recoveryMetadata = existingMetadata[methodId] || {};
        const result = recoveryMethod.onPasswordChange(
          vaultName,
          recoveryMetadata,
          currentPassword,
          newPassword
        );
        // By default let's return old data, so that we could recover it later if possible
        return {
          methodId,
          data: result.success ? result.metadata : recoveryMetadata,
        };
      })
      .reduce((obj, item) => {
        obj[item.methodId] = item.data;
        return obj;
      }, {});

    return metadata;
  }
}
