// Vitest setup for testing environment
import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock window.electronAPI globally
const mockElectronAPI = {
  // Every copy goes through main (New-3, Task 22).
  copyToClipboard: vi.fn(async (text, { sensitive } = {}) => ({
    success: true,
    clearsInMs: sensitive ? 30000 : null,
  })),
  // Vault management
  getVaults: vi.fn().mockResolvedValue([]),
  createVault: vi.fn().mockResolvedValue({ success: true }),
  loadVault: vi.fn().mockResolvedValue({ success: true, entries: [] }),
  saveVault: vi.fn().mockResolvedValue({ success: true }),
  deleteVault: vi.fn().mockResolvedValue({ success: true }),

  // Entry management
  addEntry: vi.fn().mockResolvedValue({ success: true }),
  updateEntry: vi.fn().mockResolvedValue({ success: true }),
  deleteEntry: vi.fn().mockResolvedValue({ success: true }),

  // Vault operations
  changeMasterPassword: vi.fn().mockResolvedValue({ success: true }),
  updateVaultSettings: vi.fn().mockResolvedValue({ success: true }),
  restoreVaultBackup: vi.fn().mockResolvedValue({ success: true }),
  hasVaultBackup: vi.fn().mockResolvedValue(false),

  // Menu event listeners
  onMenuNewVault: vi.fn(),
  onMenuOpenVault: vi.fn(),
  onMenuImportVault: vi.fn(),
  onMenuLockVault: vi.fn(),
  onMenuConfiguration: vi.fn(),
  onVaultLocked: vi.fn(),
  removeAllListeners: vi.fn(),

  // Saved passwords (New-52): none kept, none offered.
  unlockVaultSaved: vi.fn().mockResolvedValue({
    success: false,
    code: 'NONE',
    error: 'No saved password',
  }),
  forgetVaultPassword: vi.fn().mockResolvedValue({ success: true }),
  savedPasswords: {
    info: vi.fn().mockResolvedValue({
      success: true,
      available: false,
      count: 0,
      vaults: [],
    }),
    forgetAll: vi.fn().mockResolvedValue({ success: true, count: 0 }),
  },

  // Feature gates main decides (New-4); the Environments UI is off.
  getFeatures: vi.fn().mockResolvedValue({ success: true, envVaults: false }),

  // Import/Export
  importVault: vi.fn().mockResolvedValue({ success: true }),
  exportVault: vi.fn().mockResolvedValue({ success: true }),
  selectImportFile: vi
    .fn()
    .mockResolvedValue({ success: true, filePath: '/test/file.vault.json' }),

  // Recovery
  generateRecoveryKey: vi
    .fn()
    .mockResolvedValue({ success: true, recoveryKey: 'test-recovery-key' }),
  recoverVault: vi.fn().mockResolvedValue({ success: true }),

  // File operations
  selectFile: vi
    .fn()
    .mockResolvedValue({ success: true, filePath: '/test/path' }),
  selectDirectory: vi
    .fn()
    .mockResolvedValue({ success: true, directoryPath: '/test/dir' }),
};

// Set up global mocks
global.window = global.window || {};
global.window.electronAPI = mockElectronAPI;

// Mock navigator.clipboard
Object.defineProperty(global.navigator, 'clipboard', {
  value: {
    writeText: vi.fn().mockResolvedValue(),
  },
  writable: true,
  configurable: true,
});

// Mock window.confirm
global.window.confirm = vi.fn(() => true);

// Mock window.open
global.window.open = vi.fn();

// Global test utilities
global.mockElectronAPI = mockElectronAPI;
