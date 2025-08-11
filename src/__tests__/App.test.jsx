import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import App from '../App';

// Mock Material-UI theme components
vi.mock('@mui/material/styles', () => ({
  ThemeProvider: ({ children }) => React.createElement('div', { 'data-testid': 'theme-provider' }, children),
  createTheme: () => ({}),
}));

vi.mock('@mui/material/CssBaseline', () => ({
  __esModule: true,
  default: () => React.createElement('div', { 'data-testid': 'css-baseline' }),
}));

// Mock React Router
vi.mock('react-router-dom', () => ({
  BrowserRouter: ({ children }) => React.createElement('div', { 'data-testid': 'router' }, children),
  Routes: ({ children }) => React.createElement('div', { 'data-testid': 'routes' }, children),
  Route: ({ element }) => React.createElement('div', { 'data-testid': 'route' }, element),
  Navigate: () => React.createElement('div', { 'data-testid': 'navigate' }),
}));

// Simple mock components that just render without complex interactions
vi.mock('../components/VaultSelector', () => ({
  __esModule: true,
  default: () =>
    React.createElement(
      'div',
      { 'data-testid': 'vault-selector' },
      'Vault Selector'
    ),
}));

vi.mock('../components/CreateVault', () => ({
  __esModule: true,
  default: () =>
    React.createElement(
      'div',
      { 'data-testid': 'create-vault' },
      'Create Vault'
    ),
}));

vi.mock('../components/VaultLogin', () => ({
  __esModule: true,
  default: () =>
    React.createElement('div', { 'data-testid': 'vault-login' }, 'Vault Login'),
}));

vi.mock('../components/PasswordManager', () => ({
  __esModule: true,
  default: () =>
    React.createElement(
      'div',
      { 'data-testid': 'password-manager' },
      'Password Manager'
    ),
}));

// Mock Material-UI components
vi.mock('@mui/material/ThemeProvider', () => ({
  __esModule: true,
  default: ({ children }) =>
    React.createElement('div', { 'data-testid': 'theme-provider' }, children),
}));

vi.mock('@mui/material/CssBaseline', () => ({
  __esModule: true,
  default: () => React.createElement('div', { 'data-testid': 'css-baseline' }),
}));

describe('App - Simple Tests', () => {
  const mockElectronAPI = {
    getVaults: vi.fn(),
    onMenuNewVault: vi.fn(),
    onMenuOpenVault: vi.fn(),
    onMenuLockVault: vi.fn(),
    removeAllListeners: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock electronAPI
    // @ts-ignore - Mock electronAPI for tests
    global.window.electronAPI = mockElectronAPI;

    // Default successful responses
    mockElectronAPI.getVaults.mockResolvedValue({
      success: true,
      vaults: ['test-vault', 'another-vault'],
    });
  });

  afterEach(() => {
    // @ts-ignore - Clean up mock
    delete global.window.electronAPI;
  });

  describe('Basic Rendering', () => {
    it('renders without crashing', () => {
      expect(() => render(React.createElement(App))).not.toThrow();
    });

    it('renders vault selector by default', () => {
      render(React.createElement(App));
      expect(screen.getByTestId('vault-selector')).toBeInTheDocument();
    });

    it('renders with css baseline', () => {
      render(React.createElement(App));
      expect(screen.getByTestId('css-baseline')).toBeInTheDocument();
    });

    it('has the App class', () => {
      render(React.createElement(App));
      expect(document.querySelector('.App')).toBeInTheDocument();
    });
  });

  describe('Component Structure', () => {
    it('contains the main app structure', () => {
      render(<App />);

      // Check that the main components are present
      expect(screen.getByTestId('css-baseline')).toBeInTheDocument();
      expect(screen.getByTestId('vault-selector')).toBeInTheDocument();
    });
  });

  describe('ElectronAPI Integration', () => {
    it('calls electronAPI.getVaults on mount', () => {
      render(<App />);
      expect(mockElectronAPI.getVaults).toHaveBeenCalled();
    });

    it('sets up menu listeners', () => {
      render(<App />);
      expect(mockElectronAPI.onMenuNewVault).toHaveBeenCalled();
      expect(mockElectronAPI.onMenuOpenVault).toHaveBeenCalled();
      expect(mockElectronAPI.onMenuLockVault).toHaveBeenCalled();
    });
  });
});
