// Vitest setup for testing environment
import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock window.electronAPI globally
const mockElectronAPI = {
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
