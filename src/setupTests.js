// Vitest setup for testing environment
import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock window.electronAPI globally
const mockElectronAPI = {
  loadVault: vi.fn(),
  addEntry: vi.fn(),
  updateEntry: vi.fn(),
  deleteEntry: vi.fn(),
  changeMasterPassword: vi.fn(),
  updateVaultSettings: vi.fn(),
  restoreVaultBackup: vi.fn(),
  hasVaultBackup: vi.fn()
};

// Set up global mocks
global.window = global.window || {};
global.window.electronAPI = mockElectronAPI;

// Mock navigator.clipboard
Object.defineProperty(global.navigator, 'clipboard', {
  value: {
    writeText: vi.fn().mockResolvedValue()
  },
  writable: true,
  configurable: true
});

// Mock window.confirm
global.window.confirm = vi.fn(() => true);

// Mock window.open
global.window.open = vi.fn();

// Global test utilities
global.mockElectronAPI = mockElectronAPI;
