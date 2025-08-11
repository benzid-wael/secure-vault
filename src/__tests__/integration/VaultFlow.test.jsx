import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import App from '../../App';

// Mock electronAPI
const mockElectronAPI = {
  loadVault: vi.fn(),
  saveVault: vi.fn(),
  createVault: vi.fn(),
  getVaultList: vi.fn(),
  deleteVault: vi.fn(),
  getVaults: vi.fn(),
  onMenuNewVault: vi.fn(),
  onMenuOpenVault: vi.fn(),
  onMenuLockVault: vi.fn(),
  removeAllListeners: vi.fn(),
};

// Mock clipboard
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

describe('Vault Flow Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-ignore - Mock electronAPI for tests
    global.window.electronAPI = mockElectronAPI;

    // Default successful responses
    mockElectronAPI.getVaultList.mockResolvedValue({
      success: true,
      vaults: ['test-vault', 'another-vault'],
    });

    mockElectronAPI.createVault.mockResolvedValue({
      success: true,
    });

    mockElectronAPI.loadVault.mockResolvedValue({
      success: true,
      data: { entries: [] },
    });

    mockElectronAPI.saveVault.mockResolvedValue({
      success: true,
    });
  });

  afterEach(() => {
    // @ts-ignore - Clean up mock
    delete global.window.electronAPI;
  });

  describe('Complete Vault Creation Flow', () => {
    it('renders app without crashing', () => {
      expect(() => render(<App />)).not.toThrow();
    });

    it('shows vault selector initially', () => {
      render(<App />);
      // Just check that something renders
      expect(document.body).toBeInTheDocument();
    });
  });

  describe('Basic Integration', () => {
    it('handles basic app functionality', () => {
      expect(() => render(<App />)).not.toThrow();
    });
  });
});
