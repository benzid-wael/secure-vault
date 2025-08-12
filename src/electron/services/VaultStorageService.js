import fs from 'fs-extra';
import path from 'path';
import { app } from 'electron';
import { IVaultStorage } from '../interfaces/IVaultStorage.js';

/**
 * Concrete implementation of vault storage service
 * Follows Single Responsibility Principle - only handles file system operations
 */
export class VaultStorageService extends IVaultStorage {
  constructor() {
    super();
    this.vaultDir = path.join(app.getPath('userData'), 'vaults');
    this.vaultExtension = '.vault';
    this.backupExtension = '.vault.backup';
    this.tempExtension = '.vault.tmp';
  }

  /**
   * Initialize storage service
   * @returns {Promise<void>}
   */
  async initialize() {
    await this.ensureStorageDirectory();
  }

  /**
   * Get list of available vaults
   * @returns {Promise<string[]>} Array of vault names
   */
  async getVaults() {
    try {
      await this.ensureStorageDirectory();
      const files = await fs.readdir(this.vaultDir);
      const vaults = files
        .filter((file) => file.endsWith(this.vaultExtension))
        .map((file) => file.replace(this.vaultExtension, ''));

      return vaults;
    } catch (error) {
      throw new Error(`Failed to get vaults: ${error.message}`);
    }
  }

  /**
   * Check if vault exists
   * @param {string} vaultName - Name of the vault
   * @returns {Promise<boolean>} True if vault exists
   */
  async vaultExists(vaultName) {
    try {
      const vaultPath = this.getVaultPath(vaultName);
      return await fs.pathExists(vaultPath);
    } catch (error) {
      throw new Error(`Failed to check vault existence: ${error.message}`);
    }
  }

  /**
   * Read vault file
   * @param {string} vaultName - Name of the vault
   * @returns {Promise<Object>} Vault file data
   */
  async readVault(vaultName) {
    try {
      const vaultPath = this.getVaultPath(vaultName);

      if (!(await fs.pathExists(vaultPath))) {
        throw new Error(`Vault '${vaultName}' not found`);
      }

      return await fs.readJson(vaultPath);
    } catch (error) {
      if (error.message.includes('not found')) {
        throw error;
      }
      throw new Error(`Failed to read vault '${vaultName}': ${error.message}`);
    }
  }

  /**
   * Write vault file
   * @param {string} vaultName - Name of the vault
   * @param {Object} data - Vault data to write
   * @returns {Promise<void>}
   */
  async writeVault(vaultName, data) {
    try {
      await this.ensureStorageDirectory();
      const vaultPath = this.getVaultPath(vaultName);
      const tempPath = this.getTempPath(vaultName);

      // Write to temp file first for atomic operation
      await fs.writeJson(tempPath, data, { spaces: 2 });

      // Verify temp file can be read
      await fs.readJson(tempPath);

      // Move temp file to final location (atomic on most filesystems)
      await fs.move(tempPath, vaultPath, { overwrite: true });
    } catch (error) {
      // Clean up temp file if it exists
      const tempPath = this.getTempPath(vaultName);
      if (await fs.pathExists(tempPath)) {
        await fs.remove(tempPath);
      }
      throw new Error(`Failed to write vault '${vaultName}': ${error.message}`);
    }
  }

  /**
   * Delete vault file
   * @param {string} vaultName - Name of the vault
   * @returns {Promise<void>}
   */
  async deleteVault(vaultName) {
    try {
      const vaultPath = this.getVaultPath(vaultName);

      if (!(await fs.pathExists(vaultPath))) {
        throw new Error(`Vault '${vaultName}' not found`);
      }

      // Create a backup before deletion
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const deletedBackupPath = path.join(
        this.vaultDir,
        `${vaultName}.vault.deleted.${timestamp}`
      );
      await fs.copy(vaultPath, deletedBackupPath);

      // Delete the main vault file
      await fs.remove(vaultPath);

      // Clean up related files
      const relatedFiles = [
        this.getBackupPath(vaultName),
        this.getTempPath(vaultName),
      ];

      for (const filePath of relatedFiles) {
        if (await fs.pathExists(filePath)) {
          await fs.remove(filePath);
        }
      }

      return deletedBackupPath;
    } catch (error) {
      if (error.message.includes('not found')) {
        throw error;
      }
      throw new Error(
        `Failed to delete vault '${vaultName}': ${error.message}`
      );
    }
  }

  /**
   * Create backup of vault
   * @param {string} vaultName - Name of the vault
   * @returns {Promise<string>} Backup file path
   */
  async createBackup(vaultName) {
    try {
      const vaultPath = this.getVaultPath(vaultName);
      const backupPath = this.getBackupPath(vaultName);

      if (!(await fs.pathExists(vaultPath))) {
        throw new Error(`Vault '${vaultName}' not found`);
      }

      await fs.copy(vaultPath, backupPath);
      return backupPath;
    } catch (error) {
      if (error.message.includes('not found')) {
        throw error;
      }
      throw new Error(
        `Failed to create backup for vault '${vaultName}': ${error.message}`
      );
    }
  }

  /**
   * Restore vault from backup
   * @param {string} vaultName - Name of the vault
   * @returns {Promise<void>}
   */
  async restoreBackup(vaultName) {
    try {
      const vaultPath = this.getVaultPath(vaultName);
      const backupPath = this.getBackupPath(vaultName);

      if (!(await fs.pathExists(backupPath))) {
        throw new Error(`No backup found for vault '${vaultName}'`);
      }

      // Verify backup can be read
      await fs.readJson(backupPath);

      // Restore backup
      await fs.copy(backupPath, vaultPath);
      await fs.remove(backupPath);
    } catch (error) {
      if (error.message.includes('No backup found')) {
        throw error;
      }
      throw new Error(
        `Failed to restore backup for vault '${vaultName}': ${error.message}`
      );
    }
  }

  /**
   * Check if backup exists
   * @param {string} vaultName - Name of the vault
   * @returns {Promise<boolean>} True if backup exists
   */
  async hasBackup(vaultName) {
    try {
      const backupPath = this.getBackupPath(vaultName);
      return await fs.pathExists(backupPath);
    } catch (error) {
      throw new Error(
        `Failed to check backup for vault '${vaultName}': ${error.message}`
      );
    }
  }

  /**
   * Get vault storage directory path
   * @returns {string} Directory path
   */
  getStorageDirectory() {
    return this.vaultDir;
  }

  /**
   * Ensure storage directory exists
   * @returns {Promise<void>}
   */
  async ensureStorageDirectory() {
    try {
      await fs.ensureDir(this.vaultDir);
    } catch (error) {
      throw new Error(`Failed to create storage directory: ${error.message}`);
    }
  }

  /**
   * Get vault file path
   * @param {string} vaultName - Name of the vault
   * @returns {string} Vault file path
   */
  getVaultPath(vaultName) {
    this.validateVaultName(vaultName);
    return path.join(this.vaultDir, `${vaultName}${this.vaultExtension}`);
  }

  /**
   * Get backup file path
   * @param {string} vaultName - Name of the vault
   * @returns {string} Backup file path
   */
  getBackupPath(vaultName) {
    this.validateVaultName(vaultName);
    return path.join(this.vaultDir, `${vaultName}${this.backupExtension}`);
  }

  /**
   * Get temp file path
   * @param {string} vaultName - Name of the vault
   * @returns {string} Temp file path
   */
  getTempPath(vaultName) {
    this.validateVaultName(vaultName);
    return path.join(this.vaultDir, `${vaultName}${this.tempExtension}`);
  }

  /**
   * Validate vault name
   * @param {string} vaultName - Name to validate
   * @throws {Error} If name is invalid
   */
  validateVaultName(vaultName) {
    if (!vaultName || typeof vaultName !== 'string') {
      throw new Error('Vault name must be a non-empty string');
    }

    // Check for invalid characters
    const invalidChars = /[<>:"/\\|?*]/;
    if (invalidChars.test(vaultName)) {
      throw new Error('Vault name contains invalid characters');
    }

    if (vaultName.length > 255) {
      throw new Error('Vault name is too long');
    }
  }
}
