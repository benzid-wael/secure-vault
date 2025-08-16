import { VaultFileService } from './VaultFileService.js';
import { CryptographyService } from './CryptographyService.js';

export class RecoveryPasswordService {
  constructor(vaultDirectory) {
    this.fileService = new VaultFileService(vaultDirectory);
  }

  async recoverWithOldPassword(vaultName, oldPassword) {
    try {
      if (!(await this.fileService.vaultExists(vaultName))) {
        return { success: false, error: 'Vault not found' };
      }

      const vaultFile = await this.fileService.readVaultFile(vaultName);
      const currentSalt = Buffer.from(vaultFile.salt, 'hex');
      const currentKey = CryptographyService.deriveKey(
        oldPassword,
        currentSalt
      );

      // First, try if the old password is actually the current password
      try {
        const encryptedData = {
          encrypted: vaultFile.encrypted,
          authTag: vaultFile.authTag,
          iv: vaultFile.iv,
        };
        CryptographyService.decrypt(encryptedData, currentKey);
        return {
          success: true,
          message: 'This is actually the current password',
        };
      } catch (error) {
        // Not the current password, try recovery
      }

      // Check if we have previous password recovery data
      if (!vaultFile.recoveryMetadata?.previousPassword) {
        return {
          success: false,
          error:
            'No recovery data available for this vault. You need to change your password at least once to enable previous password recovery.',
        };
      }

      const previousPasswordData = vaultFile.recoveryMetadata.previousPassword;

      // Verify the old password matches the stored hash
      const oldPasswordHash = CryptographyService.hashPassword(oldPassword);
      if (previousPasswordData.passwordHash !== oldPasswordHash) {
        return {
          success: false,
          error:
            'This password is not in the recovery history. Only the previous password can be used for recovery.',
        };
      }

      // Decrypt the current password using the old password
      try {
        const recoverySalt = previousPasswordData.salt
          ? Buffer.from(previousPasswordData.salt, 'hex')
          : currentSalt;

        const oldKey = CryptographyService.deriveKey(oldPassword, recoverySalt);
        const decryptedData = CryptographyService.decrypt(
          previousPasswordData.encryptedNewPassword,
          oldKey
        );
        const currentPassword = decryptedData.newPassword;

        // Verify the recovered password works with the current vault
        const currentVaultKey = CryptographyService.deriveKey(
          currentPassword,
          currentSalt
        );
        const verifyEncryptedData = {
          encrypted: vaultFile.encrypted,
          authTag: vaultFile.authTag,
          iv: vaultFile.iv,
        };
        CryptographyService.decrypt(verifyEncryptedData, currentVaultKey);

        return {
          success: true,
          message: 'Vault recovered with previous password',
          currentPassword: currentPassword,
        };
      } catch (error) {
        return {
          success: false,
          error: 'Failed to recover current password from old password',
        };
      }
    } catch (error) {
      console.error('Error recovering vault with old password:', error);
      return { success: false, error: 'Failed to recover vault' };
    }
  }
}
