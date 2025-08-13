import { PasswordAuthenticationProvider } from './PasswordAuthenticationProvider.js';
import { PasskeyAuthenticationProvider } from './PasskeyAuthenticationProvider.js';

/**
 * Authentication Manager
 * Orchestrates multiple authentication providers
 * Follows Factory pattern and SOLID principles
 */
export class AuthenticationManager {
  constructor() {
    this.providers = new Map();
    // Initialize providers asynchronously
    this.initializeOtherProviders();
  }

  /**
   * Initialize other authentication providers (async)
   */
  async initializeOtherProviders() {
    const passwordProvider = new PasswordAuthenticationProvider();
    this.providers.set(passwordProvider.getMethodId(), passwordProvider);

    // Register passkey provider (check availability)
    const passkeyProvider = new PasskeyAuthenticationProvider();
    const isPasskeyAvailable = await passkeyProvider.isAvailable();
    console.log('Passkey available:', isPasskeyAvailable);

    if (isPasskeyAvailable) {
      this.providers.set(passkeyProvider.getMethodId(), passkeyProvider);
    }

    console.log('Current providers:', Array.from(this.providers.keys()));

    // Future: Add more providers here
    // const biometricProvider = new BiometricAuthenticationProvider();
    // if (await biometricProvider.isAvailable()) {
    //   this.providers.set(biometricProvider.getMethodId(), biometricProvider);
    // }
  }

  /**
   * Get all available authentication providers
   * @returns {Array} Array of available providers
   */
  getAvailableProviders() {
    return Array.from(this.providers.values());
  }

  /**
   * Force refresh providers (useful after async initialization)
   */
  async refreshProviders() {
    await this.initializeOtherProviders();
  }

  /**
   * Get a specific authentication provider
   * @param {string} methodId - The method identifier
   * @returns {IAuthenticationProvider|null} The provider or null if not found
   */
  getProvider(methodId) {
    return this.providers.get(methodId) || null;
  }

  /**
   * Get configured authentication methods for a vault
   * @param {string} vaultName - Name of the vault
   * @returns {Promise<Array>} Array of configured providers
   */
  async getConfiguredProviders(vaultName) {
    const configured = [];

    for (const provider of this.providers.values()) {
      if (await provider.isConfigured(vaultName)) {
        configured.push(provider);
      }
    }

    return configured;
  }

  /**
   * Get authentication status for all providers for a vault
   * @param {string} vaultName - Name of the vault
   * @returns {Promise<Array>} Array of provider statuses
   */
  async getProviderStatuses(vaultName) {
    const statuses = [];

    for (const provider of this.providers.values()) {
      const status = await provider.getStatus(vaultName);
      statuses.push(status);
    }

    return statuses;
  }

  /**
   * Authenticate using a specific method
   * @param {string} vaultName - Name of the vault
   * @param {string} methodId - Authentication method identifier
   * @param {Object} options - Authentication options
   * @returns {Promise<Object>} Authentication result
   */
  async authenticate(vaultName, methodId, options = {}) {
    const provider = this.getProvider(methodId);

    if (!provider) {
      return {
        success: false,
        error: `Authentication method '${methodId}' not found`,
      };
    }

    if (!(await provider.isAvailable())) {
      return {
        success: false,
        error: `Authentication method '${methodId}' is not available`,
      };
    }

    if (!(await provider.isConfigured(vaultName))) {
      return {
        success: false,
        error: `Authentication method '${methodId}' is not configured for this vault`,
      };
    }

    return await provider.authenticate(vaultName, options);
  }

  /**
   * Initialize an authentication method for a vault
   * @param {string} vaultName - Name of the vault
   * @param {string} methodId - Authentication method identifier
   * @param {Object} options - Initialization options
   * @returns {Promise<Object>} Initialization result
   */
  async initializeMethod(vaultName, methodId, options = {}) {
    const provider = this.getProvider(methodId);

    if (!provider) {
      return {
        success: false,
        error: `Authentication method '${methodId}' not found`,
      };
    }

    if (!(await provider.isAvailable())) {
      return {
        success: false,
        error: `Authentication method '${methodId}' is not available`,
      };
    }

    return await provider.initialize(vaultName, options);
  }

  /**
   * Remove an authentication method from a vault
   * @param {string} vaultName - Name of the vault
   * @param {string} methodId - Authentication method identifier
   * @returns {Promise<Object>} Removal result
   */
  async removeMethod(vaultName, methodId) {
    const provider = this.getProvider(methodId);

    if (!provider) {
      return {
        success: false,
        error: `Authentication method '${methodId}' not found`,
      };
    }

    return await provider.remove(vaultName);
  }

  /**
   * Get the best available authentication method for a vault
   * @param {string} vaultName - Name of the vault
   * @returns {Promise<IAuthenticationProvider|null>} The best provider or null
   */
  async getBestProvider(vaultName) {
    const configured = await this.getConfiguredProviders(vaultName);

    if (configured.length === 0) {
      return null;
    }

    // Priority order: passkey > password
    const priorityOrder = ['passkey', 'password'];

    for (const methodId of priorityOrder) {
      const provider = configured.find((p) => p.getMethodId() === methodId);
      if (provider) {
        return provider;
      }
    }

    // Fallback to first configured provider
    return configured[0];
  }

  /**
   * Check if a vault has any authentication methods configured
   * @param {string} vaultName - Name of the vault
   * @returns {Promise<boolean>} True if any method is configured
   */
  async hasAnyConfiguredMethod(vaultName) {
    const configured = await this.getConfiguredProviders(vaultName);
    return configured.length > 0;
  }

  /**
   * Get authentication suggestions for a vault
   * @param {string} vaultName - Name of the vault
   * @returns {Promise<Array>} Array of suggested authentication methods
   */
  async getAuthenticationSuggestions(vaultName) {
    console.log('Getting authentication suggestions for vault:', vaultName);
    console.log('Available providers:', Array.from(this.providers.keys()));

    const suggestions = [];
    const configured = await this.getConfiguredProviders(vaultName);
    console.log(
      'Configured providers:',
      configured.map((p) => p.getMethodId())
    );

    // Add configured methods first
    for (const provider of configured) {
      suggestions.push({
        provider,
        configured: true,
        available: true,
        priority: 'high',
      });
    }

    // Add available but not configured methods
    for (const provider of this.providers.values()) {
      console.log('Checking provider:', provider.getMethodId());
      if (!configured.find((p) => p.getMethodId() === provider.getMethodId())) {
        console.log('Provider not configured, checking availability...');
        const isAvailable = await provider.isAvailable();
        console.log('Provider available:', isAvailable);
        if (isAvailable) {
          suggestions.push({
            provider,
            configured: false,
            available: true,
            priority: 'medium',
          });
        }
      }
    }

    console.log(
      'Final suggestions:',
      suggestions.map((s) => ({
        methodId: s.provider.getMethodId(),
        configured: s.configured,
      }))
    );
    return suggestions;
  }
}
