import fs from 'fs-extra';
import path from 'path';

import chalk from 'chalk';

import { VaultFileService } from './VaultFileService.js';
import { VaultService } from './VaultService.js';
import { PasswordRecoveryService } from './recovery/PasswordRecoveryService.js';
import { KeyRecoveryService } from './recovery/KeyRecoveryService.js';
import { CryptographyService } from './CryptographyService.js';
import { Vault } from '../models/Vault.js';

export class VaultRecoveryService {
  constructor(vaultDir) {
    this.vaultDir = vaultDir;
  }

  async recover(vaultName, masterPassword) {
    const vfs = new VaultFileService(this.vaultDir);
    if (!(await vfs.vaultExists(vaultName))) {
      console.error(chalk.red('Vault not found!'));
      return false;
    }

    const vs = new VaultService(this.vaultDir);
    const is_valid = await vs.verifyPassword(vaultName, masterPassword);
    if (!is_valid.success) {
      console.error(chalk.red(is_valid.error));
      return false;
    }

    const vaultFile = await vfs.readVaultFile(vaultName);

    const key = CryptographyService.deriveKeyFor(masterPassword, vaultFile);
    // checking data
    const encryptedData = {
      encrypted: vaultFile.encrypted,
      authTag: vaultFile.authTag,
      iv: vaultFile.iv,
    };

    let vaultData = CryptographyService.decrypt(encryptedData, key);
    let vault = Vault.fromJSON(vaultData, vaultName);
    vaultData = null;
    let serializedVault = vault.toJSON();
    vault = null;
    serializedVault = null;

    const existingMetadata = vaultFile.recoveryMetadata || {};
    let recoveryMetadataFlatten = [];

    await Promise.all(
      [
        new PasswordRecoveryService(this.vaultDir),
        new KeyRecoveryService(this.vaultDir),
      ].flatMap(async (recovery) => {
        const methodId = recovery.getRecoveryMethodId();
        const metadata = existingMetadata[methodId] || {};
        if (!recovery.isValid(vaultName, metadata)) {
          console.error(
            chalk.red('❤️‍🩹 Invalid recovery data found, method: ', methodId)
          );
          console.log('🛟 Fixing recovery data');

          const recoveryData = await recovery.generate();
          const newMetadata = recovery.createMetadata(
            vaultName,
            masterPassword,
            recoveryData
          );
          recoveryMetadataFlatten.push({
            name: methodId,
            metadata: newMetadata,
          });
          return;
        }

        chalk.green('✅ Valid recovery data for method: ', methodId);
        recoveryMetadataFlatten.push({
          name: methodId,
          metadata: metadata,
        });
      })
    );

    const recoveryMetadata = recoveryMetadataFlatten.reduce((obj, item) => {
      obj[item.name] = item.metadata;
      return obj;
    }, {});

    console.log(chalk.green('✅ Successfully recovered vault!'));
    const newVaultData = {
      ...encryptedData,
      ...CryptographyService.keyHeaderOf(vaultFile),
      recoveryMetadata,
    };

    // create in temp file
    // Atomically write the new vault file
    const tempPath = vfs.getTempPath(vaultName);
    await vfs.writeVaultPath(tempPath, newVaultData);
    // check
    const is_temp_vault_valid = await vs.verifyPassword(
      vaultName,
      masterPassword,
      tempPath
    );
    if (!is_temp_vault_valid.success) {
      console.error(chalk.red(is_temp_vault_valid.error));
      return false;
    }

    console.log(chalk.green('✅ Temporary vault is working as expected!'));
    const fileName = `${await this.#recoveredName(vaultName)}.vault`;
    // Move temp file to final location (atomic operation)
    await fs.move(tempPath, path.join(this.vaultDir, fileName), {
      overwrite: true,
    });
    console.log(
      chalk.green('✅ Vault recovered successfully, new Vault: ', fileName)
    );
    return true;
  }

  /**
   * A vault that uses a key file, recovered with its recovery key alone
   * (New-54 step 5, D2): a copy, `<name>-recovered.vault`, opens with
   * `newPassword` alone and has a new recovery key. The vault itself is
   * left as it is, as `recover` leaves it.
   * @returns {Promise<{success: boolean, fileName?: string,
   *   recoveryKey?: string, code?: string, error?: string}>}
   */
  async recoverWithRecoveryKey(vaultName, recoveryKey, newPassword) {
    const vs = new VaultService(this.vaultDir);
    const copy = await this.#recoveredName(vaultName);
    const copyPath = vs.fileService.getVaultPath(copy);
    try {
      await fs.copy(vs.fileService.getVaultPath(vaultName), copyPath, {
        overwrite: false,
        errorOnExist: true,
      });
    } catch (error) {
      return error.code === 'ENOENT'
        ? { success: false, code: 'NOT_FOUND', error: 'Vault not found' }
        : { success: false, error: 'Failed to copy the vault' };
    }
    const result = await vs.resetWithRecoveryKey(
      copy,
      recoveryKey,
      newPassword
    );
    if (!result.success) {
      await fs.remove(copyPath);
      return result;
    }
    return {
      success: true,
      fileName: path.basename(copyPath),
      recoveryKey: result.recoveryKey,
    };
  }

  /** `<name>-recovered`, or `-recovered-<n>`: never an existing vault. */
  async #recoveredName(vaultName) {
    let idx = 0;
    let name = `${vaultName}-recovered`;
    while (await fs.pathExists(path.join(this.vaultDir, `${name}.vault`))) {
      idx++;
      name = `${vaultName}-recovered-${idx}`;
    }
    return name;
  }
}
