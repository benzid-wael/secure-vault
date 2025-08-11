// Jest setup for testing environment
import '@testing-library/jest-dom';

// Mock window.electronAPI globally
const mockElectronAPI = {
  loadVault: jest.fn(),
  addEntry: jest.fn(),
  updateEntry: jest.fn(),
  deleteEntry: jest.fn(),
  changeMasterPassword: jest.fn(),
  updateVaultSettings: jest.fn(),
  restoreVaultBackup: jest.fn(),
  hasVaultBackup: jest.fn()
};

// Set up global mocks
global.window = global.window || {};
global.window.electronAPI = mockElectronAPI;

// Mock navigator.clipboard
Object.defineProperty(global.navigator, 'clipboard', {
  value: {
    writeText: jest.fn().mockResolvedValue()
  },
  writable: true,
  configurable: true
});

// Mock window.confirm
global.window.confirm = jest.fn(() => true);

// Mock window.open
global.window.open = jest.fn();

// Global test utilities
global.mockElectronAPI = mockElectronAPI;
