import { IAuthenticationProvider } from './IAuthenticationProvider.js';

/**
 * Passkey authentication provider using WebAuthn
 * Provides cross-platform passkey support
 */
export class PasskeyAuthenticationProvider extends IAuthenticationProvider {
  constructor() {
    super();
    this.methodId = 'passkey';
    this.relyingPartyId = 'localhost'; // For development, should be your domain in production
  }

  async isAvailable() {
    return true;

    // try {
    //   // Check if WebAuthn is supported
    //   if (!window.PublicKeyCredential) {
    //     console.log('PublicKeyCredential not available');
    //     return false;
    //   }

    //   console.log('PublicKeyCredential is available');

    //   // Check if the platform supports passkeys
    //   if (PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
    //     const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    //     console.log('Platform authenticator available:', available);
    //     return available;
    //   } else {
    //     console.log('isUserVerifyingPlatformAuthenticatorAvailable not available');
    //     // Fallback: check if we're in a secure context and have basic WebAuthn support
    //     return window.isSecureContext && !!window.PublicKeyCredential;
    //   }
    // } catch (error) {
    //   console.warn('Passkey availability check failed:', error);
    //   // For testing, return true
    //   return true;
    // }
  }

  getDisplayName() {
    return 'Passkey';
  }

  getMethodId() {
    return this.methodId;
  }

  getIcon() {
    return '🔑';
  }

  async initialize(vaultName, options = {}) {
    try {
      const { password } = options;

      if (!password) {
        return {
          success: false,
          error: 'Password is required to initialize passkey',
        };
      }

      // Verify the password first
      const passwordResult = await window.electronAPI.verifyVaultPassword(
        vaultName,
        password
      );
      if (!passwordResult.success) {
        return {
          success: false,
          error: 'Invalid password',
        };
      }

      // Generate challenge for registration
      const challenge = this.generateChallenge();
      console.log('[initialize] Challenge:', challenge);

      // Create public key credential options
      const publicKeyOptions = {
        challenge: challenge,
        rp: {
          name: 'Secure Password Manager',
          id: this.relyingPartyId,
        },
        user: {
          id: this.stringToArrayBuffer(vaultName),
          name: vaultName,
          displayName: `Vault: ${vaultName}`,
        },
        pubKeyCredParams: [
          {
            type: 'public-key',
            alg: -7, // ES256
          },
          {
            type: 'public-key',
            alg: -257, // RS256
          },
        ],
        timeout: 6000,
        // Don't prompt users for additional information about the authenticator
        // (Recommended for smoother UX)
        attestationType: 'none', // See "Guiding use of authenticators via authenticatorSelection" below
        authenticatorSelection: {
          // Defaults
          residentKey: 'preferred',
          userVerification: 'preferred',
          // Optional
          authenticatorAttachment: 'platform',
        },
      };

      // Create the credential
      const credential = await navigator.credentials.create({
        publicKey: publicKeyOptions,
      });

      console.log('[initialize] Credential:', credential);
      if (!credential) {
        return {
          success: false,
          error: 'Failed to create passkey',
        };
      }

      console.log('[initialize] Creating credential...');
      // Store the credential data in the vault
      const credentialData = {
        id: credential.id,
        type: credential.type,
        rawId: this.arrayBufferToBase64(credential.rawId),
        response: {
          clientDataJSON: this.arrayBufferToBase64(
            credential.response.clientDataJSON
          ),
          attestationObject: this.arrayBufferToBase64(
            credential.response.attestationObject
          ),
        },
      };

      // Store passkey data in the vault using electron API
      const storeResult = await window.electronAPI.storePasskeyData(
        vaultName,
        password,
        credentialData
      );
      console.log('[initialize] Store result:', storeResult);

      if (storeResult.success) {
        return {
          success: true,
          message: 'Passkey initialized successfully',
          data: {
            credentialId: credential.id,
          },
        };
      } else {
        return {
          success: false,
          error: storeResult.error || 'Failed to store passkey data',
        };
      }
    } catch (error) {
      console.error('Passkey initialization error:', error);
      return {
        success: false,
        error: this.getUserFriendlyError(error),
      };
    }
  }

  async authenticate(vaultName, options = {}) {
    try {
      // Get stored passkey data
      const passkeyData = await window.electronAPI.getPasskeyData(vaultName);

      if (!passkeyData.success || !passkeyData.data) {
        return {
          success: false,
          error: 'No passkey configured for this vault',
        };
      }

      const storedCredential = passkeyData.data;

      // Generate challenge for authentication
      const challenge = this.generateChallenge();

      // Create assertion options
      const assertionOptions = {
        challenge: challenge,
        rpId: this.relyingPartyId,
        allowCredentials: [
          {
            type: 'public-key',
            id: this.base64ToArrayBuffer(storedCredential.rawId),
            transports: ['internal'],
          },
        ],
        userVerification: 'required',
        timeout: 60000,
      };

      // Get the credential
      const assertion = await navigator.credentials.get({
        publicKey: assertionOptions,
      });

      if (!assertion) {
        return {
          success: false,
          error: 'Passkey authentication cancelled or failed',
        };
      }

      // Verify the assertion
      const verificationResult =
        await window.electronAPI.verifyPasskeyAssertion(vaultName, {
          id: assertion.id,
          type: assertion.type,
          rawId: this.arrayBufferToBase64(assertion.rawId),
          response: {
            clientDataJSON: this.arrayBufferToBase64(
              assertion.response.clientDataJSON
            ),
            authenticatorData: this.arrayBufferToBase64(
              assertion.response.authenticatorData
            ),
            signature: this.arrayBufferToBase64(assertion.response.signature),
            userHandle: assertion.response.userHandle
              ? this.arrayBufferToBase64(assertion.response.userHandle)
              : null,
          },
        });

      if (verificationResult.success) {
        return {
          success: true,
          method: this.methodId,
          data: {
            password: verificationResult.password, // Recovered password from passkey
          },
          message: 'Passkey authentication successful',
        };
      } else {
        return {
          success: false,
          error: verificationResult.error || 'Passkey verification failed',
        };
      }
    } catch (error) {
      console.error('Passkey authentication error:', error);
      return {
        success: false,
        error: this.getUserFriendlyError(error),
      };
    }
  }

  async isConfigured(vaultName) {
    try {
      const result = await window.electronAPI.getPasskeyData(vaultName);
      return result.success && result.data && result.data.hasPasskey;
    } catch (error) {
      console.warn('Error checking if passkey is configured:', error);
      return false;
    }
  }

  async remove(vaultName) {
    try {
      const result = await window.electronAPI.removePasskeyData(vaultName);
      return result;
    } catch (error) {
      return {
        success: false,
        error: 'Failed to remove passkey',
      };
    }
  }

  async getStatus(vaultName) {
    const available = await this.isAvailable();
    const configured = await this.isConfigured(vaultName);

    return {
      configured,
      method: this.methodId,
      displayName: this.getDisplayName(),
      icon: this.getIcon(),
      available,
    };
  }

  // Helper methods
  generateChallenge() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return array;
  }

  stringToArrayBuffer(string) {
    const encoder = new TextEncoder();
    return encoder.encode(string);
  }

  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  getUserFriendlyError(error) {
    if (error.name === 'NotAllowedError') {
      return 'Passkey authentication was cancelled';
    } else if (error.name === 'SecurityError') {
      return 'Security error occurred during passkey authentication';
    } else if (error.name === 'InvalidStateError') {
      return 'Passkey is not available or not configured';
    } else if (error.name === 'NotSupportedError') {
      return 'Passkey is not supported on this device';
    } else {
      return 'Passkey authentication failed';
    }
  }
}
