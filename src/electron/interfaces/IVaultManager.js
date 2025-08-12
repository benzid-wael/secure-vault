/**
 * Interface for high-level vault management operations
 * Defines the contract for vault business logic
 */
export class IVaultManager {
  /**
   * Get list of available vaults
   * @returns {Promise<string[]>} Array of vault names
   */
  async getVaults() {
    throw new Error('Method must be implemented');
  }

  /**
   * Create a new vault
   * @param {string} vaultName - Name of the vault
   * @param {string} masterPassword - Master password
   * @returns {Promise<Object>} Creation result with recovery key
   */
  async createVault(vaultName, masterPassword) {
    throw new Error('Method must be implemented');
  }

  /**
   * Verify vault password
   * @param {string} vaultName - Name of the vault
   * @param {string} password - Password to verify
   * @returns {Promise<boolean>} True if password is correct
   */
  async verifyVaultPassword(vaultName, password) {
    throw new Error('Method must be implemented');
  }

  /**
   * Load vault data
   * @param {string} vaultName - Name of the vault
   * @param {string} password - Vault password
   * @returns {Promise<Object>} Decrypted vault data
   */
  async loadVault(vaultName, password) {
    throw new Error('Method must be implemented');
  }

  /**
   * Save vault data
   * @param {string} vaultName - Name of the vault
   * @param {string} password - Vault password
   * @param {Object} data - Data to save
   * @returns {Promise<void>}
   */
  async saveVault(vaultName, password, data) {
    throw new Error('Method must be implemented');
  }

  /**
   * Delete vault
   * @param {string} vaultName - Name of the vault
   * @param {string} confirmationPassword - Password for confirmation
   * @returns {Promise<Object>} Deletion result
   */
  async deleteVault(vaultName, confirmationPassword) {
    throw new Error('Method must be implemented');
  }

  /**
   * Change master password
   * @param {string} vaultName - Name of the vault
   * @param {string} currentPassword - Current password
   * @param {string} newPassword - New password
   * @returns {Promise<Object>} Change result
   */
  async changeMasterPassword(vaultName, currentPassword, newPassword) {
    throw new Error('Method must be implemented');
  }

  /**
   * Update vault settings
   * @param {string} vaultName - Name of the vault
   * @param {string} password - Vault password
   * @param {Object} settings - New settings
   * @returns {Promise<Object>} Update result
   */
  async updateVaultSettings(vaultName, password, settings) {
    throw new Error('Method must be implemented');
  }

  /**
   * Generate recovery key for vault
   * @param {string} vaultName - Name of the vault
   * @param {string} masterPassword - Master password
   * @returns {Promise<Object>} Recovery key generation result
   */
  async generateRecoveryKey(vaultName, masterPassword) {
    throw new Error('Method must be implemented');
  }

  /**
   * Verify recovery key
   * @param {string} vaultName - Name of the vault
   * @param {string} recoveryKey - Recovery key to verify
   * @returns {Promise<boolean>} True if recovery key is valid
   */
  async verifyRecoveryKey(vaultName, recoveryKey) {
    throw new Error('Method must be implemented');
  }

  /**
   * Load vault with recovery key
   * @param {string} vaultName - Name of the vault
   * @param {string} recoveryKey - Recovery key
   * @returns {Promise<Object>} Vault data and recovered password
   */
  async loadVaultWithRecoveryKey(vaultName, recoveryKey) {
    throw new Error('Method must be implemented');
  }

  /**
   * Recover vault with old password
   * @param {string} vaultName - Name of the vault
   * @param {string} oldPassword - Old password
   * @returns {Promise<Object>} Recovery result with current password
   */
  async recoverVaultWithOldPassword(vaultName, oldPassword) {
    throw new Error('Method must be implemented');
  }

  /**
   * Export vault to file
   * @param {string} vaultName - Name of the vault
   * @param {string} password - Vault password
   * @param {string} exportPath - Export file path
   * @returns {Promise<Object>} Export result
   */
  async exportVault(vaultName, password, exportPath) {
    throw new Error('Method must be implemented');
  }

  /**
   * Import vault from file
   * @param {string} importPath - Import file path
   * @param {string} newVaultName - New vault name
   * @param {string} password - Password for imported vault
   * @returns {Promise<Object>} Import result
   */
  async importVault(importPath, newVaultName, password) {
    throw new Error('Method must be implemented');
  }

  /**
   * Restore vault from backup
   * @param {string} vaultName - Name of the vault
   * @returns {Promise<Object>} Restore result
   */
  async restoreVaultBackup(vaultName) {
    throw new Error('Method must be implemented');
  }

  /**
   * Check if vault has backup
   * @param {string} vaultName - Name of the vault
   * @returns {Promise<boolean>} True if backup exists
   */
  async hasVaultBackup(vaultName) {
    throw new Error('Method must be implemented');
  }

  /**
   * Get vault storage directory
   * @returns {string} Storage directory path
   */
  getVaultDirectory() {
    throw new Error('Method must be implemented');
  }
}
