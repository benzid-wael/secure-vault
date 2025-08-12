/**
 * Interface for vault storage operations
 * Defines the contract for vault file system operations
 */
export class IVaultStorage {
  /**
   * Get list of available vaults
   * @returns {Promise<string[]>} Array of vault names
   */
  async getVaults() {
    throw new Error('Method must be implemented');
  }

  /**
   * Check if vault exists
   * @param {string} vaultName - Name of the vault
   * @returns {Promise<boolean>} True if vault exists
   */
  async vaultExists(vaultName) {
    throw new Error('Method must be implemented');
  }

  /**
   * Read vault file
   * @param {string} vaultName - Name of the vault
   * @returns {Promise<Object>} Vault file data
   */
  async readVault(vaultName) {
    throw new Error('Method must be implemented');
  }

  /**
   * Write vault file
   * @param {string} vaultName - Name of the vault
   * @param {Object} data - Vault data to write
   * @returns {Promise<void>}
   */
  async writeVault(vaultName, data) {
    throw new Error('Method must be implemented');
  }

  /**
   * Delete vault file
   * @param {string} vaultName - Name of the vault
   * @returns {Promise<void>}
   */
  async deleteVault(vaultName) {
    throw new Error('Method must be implemented');
  }

  /**
   * Create backup of vault
   * @param {string} vaultName - Name of the vault
   * @returns {Promise<string>} Backup file path
   */
  async createBackup(vaultName) {
    throw new Error('Method must be implemented');
  }

  /**
   * Restore vault from backup
   * @param {string} vaultName - Name of the vault
   * @returns {Promise<void>}
   */
  async restoreBackup(vaultName) {
    throw new Error('Method must be implemented');
  }

  /**
   * Check if backup exists
   * @param {string} vaultName - Name of the vault
   * @returns {Promise<boolean>} True if backup exists
   */
  async hasBackup(vaultName) {
    throw new Error('Method must be implemented');
  }

  /**
   * Get vault storage directory path
   * @returns {string} Directory path
   */
  getStorageDirectory() {
    throw new Error('Method must be implemented');
  }

  /**
   * Ensure storage directory exists
   * @returns {Promise<void>}
   */
  async ensureStorageDirectory() {
    throw new Error('Method must be implemented');
  }
}
