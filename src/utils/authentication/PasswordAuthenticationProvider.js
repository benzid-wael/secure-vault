import { IAuthenticationProvider } from './IAuthenticationProvider.js';

/**
 * Password-based authentication provider
 * Implements the existing password authentication system
 */
export class PasswordAuthenticationProvider extends IAuthenticationProvider {
  constructor() {
    super();
    this.methodId = 'password';
  }

  async isAvailable() {
    // Password authentication is always available
    return true;
  }

  getDisplayName() {
    return 'Master Password';
  }

  getMethodId() {
    return this.methodId;
  }

  getIcon() {
    return '🔐';
  }

  async initialize(vaultName, options = {}) {
    // Password authentication doesn't require initialization
    // The vault is created with a password during vault creation
    return {
      success: true,
      message: 'Password authentication is ready',
    };
  }

  async authenticate(vaultName, options = {}) {
    const { password } = options;

    if (!password) {
      return {
        success: false,
        error: 'Password is required',
      };
    }

    try {
      // Use the existing electron API for password verification
      const result = await window.electronAPI.verifyVaultPassword(
        vaultName,
        password
      );

      if (result.success) {
        return {
          success: true,
          method: this.methodId,
          data: { password },
          message: 'Password authentication successful',
        };
      } else {
        return {
          success: false,
          error: result.error || 'Invalid password',
        };
      }
    } catch (error) {
      return {
        success: false,
        error: 'Authentication failed',
      };
    }
  }

  async isConfigured(vaultName) {
    // Password authentication is always configured for existing vaults
    // We can't easily check this without trying to load the vault
    // For now, we'll assume it's configured if the vault exists
    try {
      // Try to check if the vault file exists by attempting to list vaults
      const vaults = await window.electronAPI.getVaults();
      return vaults.includes(vaultName);
    } catch (error) {
      console.warn('Error checking if password is configured:', error);
      return true; // Fallback to true
    }
  }

  async remove(vaultName) {
    // Cannot remove password authentication as it's the primary method
    return {
      success: false,
      error: 'Cannot remove password authentication',
    };
  }

  async getStatus(vaultName) {
    return {
      configured: true,
      method: this.methodId,
      displayName: this.getDisplayName(),
      icon: this.getIcon(),
      available: true,
    };
  }
}
