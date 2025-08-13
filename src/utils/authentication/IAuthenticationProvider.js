/**
 * Abstract interface for authentication providers
 * Follows the Strategy pattern and SOLID principles
 */
export class IAuthenticationProvider {
  /**
   * Check if this authentication method is available on the current platform
   * @returns {Promise<boolean>} True if available, false otherwise
   */
  async isAvailable() {
    throw new Error('isAvailable() must be implemented by subclass');
  }

  /**
   * Get the display name for this authentication method
   * @returns {string} Human-readable name
   */
  getDisplayName() {
    throw new Error('getDisplayName() must be implemented by subclass');
  }

  /**
   * Get the unique identifier for this authentication method
   * @returns {string} Unique identifier
   */
  getMethodId() {
    throw new Error('getMethodId() must be implemented by subclass');
  }

  /**
   * Get the icon/emoji for this authentication method
   * @returns {string} Icon or emoji representation
   */
  getIcon() {
    throw new Error('getIcon() must be implemented by subclass');
  }

  /**
   * Initialize the authentication method for a vault
   * @param {string} vaultName - Name of the vault
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Initialization result
   */
  async initialize(vaultName, options = {}) {
    throw new Error('initialize() must be implemented by subclass');
  }

  /**
   * Authenticate using this method
   * @param {string} vaultName - Name of the vault
   * @param {Object} options - Authentication options
   * @returns {Promise<Object>} Authentication result with success status and data
   */
  async authenticate(vaultName, options = {}) {
    throw new Error('authenticate() must be implemented by subclass');
  }

  /**
   * Check if authentication is configured for a vault
   * @param {string} vaultName - Name of the vault
   * @returns {Promise<boolean>} True if configured, false otherwise
   */
  async isConfigured(vaultName) {
    throw new Error('isConfigured() must be implemented by subclass');
  }

  /**
   * Remove authentication configuration for a vault
   * @param {string} vaultName - Name of the vault
   * @returns {Promise<Object>} Removal result
   */
  async remove(vaultName) {
    throw new Error('remove() must be implemented by subclass');
  }

  /**
   * Get authentication status and metadata
   * @param {string} vaultName - Name of the vault
   * @returns {Promise<Object>} Status information
   */
  async getStatus(vaultName) {
    throw new Error('getStatus() must be implemented by subclass');
  }
}
