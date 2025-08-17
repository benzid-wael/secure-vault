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
    if (!vfs.vaultExists(vaultName)) {
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

    const salt = Buffer.from(vaultFile.salt, 'hex');
    const key = CryptographyService.deriveKey(masterPassword, salt);
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

    console.log(vaultFile);
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
          console.log(newMetadata);
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

    console.log(recoveryMetadataFlatten);
    const recoveryMetadata = recoveryMetadataFlatten.reduce((obj, item) => {
      obj[item.name] = item.metadata;
      return obj;
    }, {});

    console.log(chalk.green('✅ Successfully recovered vault!'));
    const newVaultData = {
      ...encryptedData,
      salt: vaultFile.salt,
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
    console.log(is_temp_vault_valid);
    if (!is_temp_vault_valid.success) {
      console.error(chalk.red(is_valid.error));
      return false;
    }

    console.log(chalk.green('✅ Temporary vault is working as expected!'));
    let idx = 0;
    let fileName = `${vaultName}-recovered.vault`;
    while (await fs.pathExists(path.join(this.vaultDir, finalName))) {
      idx++;
      fileName = `${vaultName}-recovered-${idx}.vault`;
    }
    // Move temp file to final location (atomic operation)
    await fs.move(tempPath, path.join(this.vaultDir, finalName), {
      overwrite: true,
    });
    console.log(
      chalk.green('✅ Vault recovered successfully, new Vault: ', fileName)
    );
    return true;
  }
}
