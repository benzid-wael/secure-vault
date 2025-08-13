import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthenticationManager } from '../../../utils/authentication/AuthenticationManager.js';
import { PasswordAuthenticationProvider } from '../../../utils/authentication/PasswordAuthenticationProvider.js';
import { PasskeyAuthenticationProvider } from '../../../utils/authentication/PasskeyAuthenticationProvider.js';

// Mock the electron API
global.window = {
  electronAPI: {
    verifyVaultPassword: vi.fn(),
    storePasskeyData: vi.fn(),
    getPasskeyData: vi.fn(),
    verifyPasskeyAssertion: vi.fn(),
    removePasskeyData: vi.fn(),
  },
  PublicKeyCredential: {
    isUserVerifyingPlatformAuthenticatorAvailable: vi.fn(),
  },
  navigator: {
    credentials: {
      create: vi.fn(),
      get: vi.fn(),
    },
  },
  crypto: {
    getRandomValues: vi.fn(),
  },
};

describe('AuthenticationManager', () => {
  let authManager;

  beforeEach(() => {
    authManager = new AuthenticationManager();
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with password provider', () => {
      const providers = authManager.getAvailableProviders();
      const passwordProvider = providers.find(p => p.getMethodId() === 'password');
      
      expect(passwordProvider).toBeDefined();
      expect(passwordProvider).toBeInstanceOf(PasswordAuthenticationProvider);
    });

    it('should initialize passkey provider if available', async () => {
      // Mock passkey availability
      window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable.mockResolvedValue(true);
      
      // Create new instance to trigger availability check
      const newAuthManager = new AuthenticationManager();
      await new Promise(resolve => setTimeout(resolve, 0)); // Wait for async initialization
      
      const providers = newAuthManager.getAvailableProviders();
      const passkeyProvider = providers.find(p => p.getMethodId() === 'passkey');
      
      expect(passkeyProvider).toBeDefined();
      expect(passkeyProvider).toBeInstanceOf(PasskeyAuthenticationProvider);
    });
  });

  describe('provider management', () => {
    it('should get provider by method ID', () => {
      const passwordProvider = authManager.getProvider('password');
      expect(passwordProvider).toBeInstanceOf(PasswordAuthenticationProvider);
    });

    it('should return null for non-existent provider', () => {
      const provider = authManager.getProvider('nonexistent');
      expect(provider).toBeNull();
    });

    it('should get all available providers', () => {
      const providers = authManager.getAvailableProviders();
      expect(providers.length).toBeGreaterThan(0);
      expect(providers[0]).toBeInstanceOf(PasswordAuthenticationProvider);
    });
  });

  describe('authentication', () => {
    it('should authenticate with password provider', async () => {
      const mockResult = { success: true };
      window.electronAPI.verifyVaultPassword.mockResolvedValue(mockResult);

      const result = await authManager.authenticate('test-vault', 'password', { password: 'testpass' });

      expect(result.success).toBe(true);
      expect(window.electronAPI.verifyVaultPassword).toHaveBeenCalledWith('test-vault', 'testpass');
    });

    it('should return error for non-existent method', async () => {
      const result = await authManager.authenticate('test-vault', 'nonexistent', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error for unavailable method', async () => {
      // Mock passkey as unavailable
      window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable.mockResolvedValue(false);
      
      const result = await authManager.authenticate('test-vault', 'passkey', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('not available');
    });
  });

  describe('method initialization', () => {
    it('should initialize password method', async () => {
      const result = await authManager.initializeMethod('test-vault', 'password', {});

      expect(result.success).toBe(true);
      expect(result.message).toContain('ready');
    });

    it('should return error for non-existent method during initialization', async () => {
      const result = await authManager.initializeMethod('test-vault', 'nonexistent', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('method removal', () => {
    it('should remove passkey method', async () => {
      window.electronAPI.removePasskeyData.mockResolvedValue({ success: true });

      const result = await authManager.removeMethod('test-vault', 'passkey');

      expect(result.success).toBe(true);
      expect(window.electronAPI.removePasskeyData).toHaveBeenCalledWith('test-vault');
    });

    it('should return error for non-existent method during removal', async () => {
      const result = await authManager.removeMethod('test-vault', 'nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('provider status', () => {
    it('should get provider statuses', async () => {
      const statuses = await authManager.getProviderStatuses('test-vault');

      expect(Array.isArray(statuses)).toBe(true);
      expect(statuses.length).toBeGreaterThan(0);
      
      const passwordStatus = statuses.find(s => s.method === 'password');
      expect(passwordStatus).toBeDefined();
      expect(passwordStatus.configured).toBe(true);
      expect(passwordStatus.available).toBe(true);
    });
  });

  describe('best provider selection', () => {
    it('should return best available provider', async () => {
      const provider = await authManager.getBestProvider('test-vault');

      expect(provider).toBeInstanceOf(PasswordAuthenticationProvider);
    });

    it('should return null when no providers are configured', async () => {
      // Mock no configured providers
      vi.spyOn(authManager, 'getConfiguredProviders').mockResolvedValue([]);

      const provider = await authManager.getBestProvider('test-vault');

      expect(provider).toBeNull();
    });
  });

  describe('authentication suggestions', () => {
    it('should get authentication suggestions', async () => {
      const suggestions = await authManager.getAuthenticationSuggestions('test-vault');

      expect(Array.isArray(suggestions)).toBe(true);
      expect(suggestions.length).toBeGreaterThan(0);
      
      const passwordSuggestion = suggestions.find(s => s.provider.getMethodId() === 'password');
      expect(passwordSuggestion).toBeDefined();
      expect(passwordSuggestion.configured).toBe(true);
      expect(passwordSuggestion.priority).toBe('high');
    });
  });
});

describe('PasswordAuthenticationProvider', () => {
  let provider;

  beforeEach(() => {
    provider = new PasswordAuthenticationProvider();
    vi.clearAllMocks();
  });

  describe('availability', () => {
    it('should always be available', async () => {
      const available = await provider.isAvailable();
      expect(available).toBe(true);
    });
  });

  describe('authentication', () => {
    it('should authenticate with valid password', async () => {
      const mockResult = { success: true };
      window.electronAPI.verifyVaultPassword.mockResolvedValue(mockResult);

      const result = await provider.authenticate('test-vault', { password: 'testpass' });

      expect(result.success).toBe(true);
      expect(result.method).toBe('password');
      expect(result.data.password).toBe('testpass');
    });

    it('should fail with invalid password', async () => {
      const mockResult = { success: false, error: 'Invalid password' };
      window.electronAPI.verifyVaultPassword.mockResolvedValue(mockResult);

      const result = await provider.authenticate('test-vault', { password: 'wrongpass' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid password');
    });

    it('should fail without password', async () => {
      const result = await provider.authenticate('test-vault', {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Password is required');
    });
  });

  describe('configuration', () => {
    it('should always be configured', async () => {
      const configured = await provider.isConfigured('test-vault');
      expect(configured).toBe(true);
    });

    it('should return status information', async () => {
      const status = await provider.getStatus('test-vault');

      expect(status.configured).toBe(true);
      expect(status.method).toBe('password');
      expect(status.displayName).toBe('Master Password');
      expect(status.icon).toBe('🔐');
      expect(status.available).toBe(true);
    });
  });
});

describe('PasskeyAuthenticationProvider', () => {
  let provider;

  beforeEach(() => {
    provider = new PasskeyAuthenticationProvider();
    vi.clearAllMocks();
  });

  describe('availability', () => {
    it('should be available when WebAuthn is supported', async () => {
      window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable.mockResolvedValue(true);

      const available = await provider.isAvailable();
      expect(available).toBe(true);
    });

    it('should not be available when WebAuthn is not supported', async () => {
      window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable.mockResolvedValue(false);

      const available = await provider.isAvailable();
      expect(available).toBe(false);
    });

    it('should not be available when PublicKeyCredential is not defined', async () => {
      const originalPublicKeyCredential = window.PublicKeyCredential;
      delete window.PublicKeyCredential;

      const available = await provider.isAvailable();
      expect(available).toBe(false);

      window.PublicKeyCredential = originalPublicKeyCredential;
    });
  });

  describe('initialization', () => {
    it('should initialize passkey with valid password', async () => {
      // Mock dependencies
      window.electronAPI.verifyVaultPassword.mockResolvedValue({ success: true });
      window.electronAPI.storePasskeyData.mockResolvedValue({ success: true });
      window.navigator.credentials.create.mockResolvedValue({
        id: 'test-credential-id',
        type: 'public-key',
        rawId: new ArrayBuffer(8),
        response: {
          clientDataJSON: new ArrayBuffer(8),
          attestationObject: new ArrayBuffer(8),
        },
      });
      window.crypto.getRandomValues.mockImplementation((array) => {
        for (let i = 0; i < array.length; i++) {
          array[i] = Math.floor(Math.random() * 256);
        }
      });

      const result = await provider.initialize('test-vault', { password: 'testpass' });

      expect(result.success).toBe(true);
      expect(result.message).toContain('initialized successfully');
    });

    it('should fail initialization without password', async () => {
      const result = await provider.initialize('test-vault', {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Password is required to initialize passkey');
    });

    it('should fail initialization with invalid password', async () => {
      window.electronAPI.verifyVaultPassword.mockResolvedValue({ success: false, error: 'Invalid password' });

      const result = await provider.initialize('test-vault', { password: 'wrongpass' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid password');
    });
  });

  describe('authentication', () => {
    it('should authenticate with valid passkey', async () => {
      // Mock dependencies
      window.electronAPI.getPasskeyData.mockResolvedValue({
        success: true,
        data: {
          rawId: 'test-raw-id',
        },
      });
      window.electronAPI.verifyPasskeyAssertion.mockResolvedValue({
        success: true,
        password: 'recovered-password',
      });
      window.navigator.credentials.get.mockResolvedValue({
        id: 'test-credential-id',
        type: 'public-key',
        rawId: new ArrayBuffer(8),
        response: {
          clientDataJSON: new ArrayBuffer(8),
          authenticatorData: new ArrayBuffer(8),
          signature: new ArrayBuffer(8),
        },
      });
      window.crypto.getRandomValues.mockImplementation((array) => {
        for (let i = 0; i < array.length; i++) {
          array[i] = Math.floor(Math.random() * 256);
        }
      });

      const result = await provider.authenticate('test-vault');

      expect(result.success).toBe(true);
      expect(result.method).toBe('passkey');
      expect(result.data.password).toBe('recovered-password');
    });

    it('should fail authentication when no passkey is configured', async () => {
      window.electronAPI.getPasskeyData.mockResolvedValue({ success: true, data: null });

      const result = await provider.authenticate('test-vault');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No passkey configured for this vault');
    });
  });

  describe('configuration', () => {
    it('should check if passkey is configured', async () => {
      window.electronAPI.getPasskeyData.mockResolvedValue({ success: true, data: { configured: true } });

      const configured = await provider.isConfigured('test-vault');
      expect(configured).toBe(true);
    });

    it('should return not configured when no passkey data exists', async () => {
      window.electronAPI.getPasskeyData.mockResolvedValue({ success: true, data: null });

      const configured = await provider.isConfigured('test-vault');
      expect(configured).toBe(false);
    });
  });

  describe('removal', () => {
    it('should remove passkey configuration', async () => {
      window.electronAPI.removePasskeyData.mockResolvedValue({ success: true });

      const result = await provider.remove('test-vault');

      expect(result.success).toBe(true);
      expect(window.electronAPI.removePasskeyData).toHaveBeenCalledWith('test-vault');
    });
  });

  describe('status', () => {
    it('should return status information', async () => {
      window.electronAPI.getPasskeyData.mockResolvedValue({ success: true, data: { configured: true } });
      window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable.mockResolvedValue(true);

      const status = await provider.getStatus('test-vault');

      expect(status.configured).toBe(true);
      expect(status.method).toBe('passkey');
      expect(status.displayName).toBe('Passkey');
      expect(status.icon).toBe('🔑');
      expect(status.available).toBe(true);
    });
  });
});
