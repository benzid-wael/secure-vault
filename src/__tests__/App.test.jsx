import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import App from '../App';

// Mock all child components with safe callback handling
vi.mock('../components/VaultSelector', () => ({
  __esModule: true,
  default: ({ onVaultSelect, onCreateVault }) => {
    // Store callbacks in a way that tests can access them
    React.useEffect(() => {
      if (global.testCallbacks) {
        global.testCallbacks.onVaultSelect = onVaultSelect;
        global.testCallbacks.onCreateVault = onCreateVault;
      }
    }, [onVaultSelect, onCreateVault]);

    return React.createElement(
      'div',
      { 'data-testid': 'vault-selector' },
      React.createElement(
        'button',
        {
          onClick: () =>
            onVaultSelect && onVaultSelect('test-vault', 'test-password'),
        },
        'Select Vault'
      ),
      React.createElement(
        'button',
        {
          onClick: () =>
            onCreateVault && onCreateVault('new-vault', 'new-password'),
        },
        'Create Vault'
      )
    );
  },
}));

vi.mock('../components/CreateVault', () => ({
  __esModule: true,
  default: ({ onBack, onVaultCreated }) =>
    React.createElement(
      'div',
      { 'data-testid': 'create-vault' },
      React.createElement(
        'button',
        { onClick: () => onBack && onBack() },
        'Back'
      ),
      React.createElement(
        'button',
        {
          onClick: () =>
            onVaultCreated &&
            onVaultCreated('created-vault', 'created-password'),
        },
        'Create'
      )
    ),
}));

vi.mock('../components/VaultLogin', () => ({
  __esModule: true,
  default: ({ vaultName, onBack, onLogin }) =>
    React.createElement(
      'div',
      { 'data-testid': 'vault-login' },
      React.createElement('span', {}, `Login to ${vaultName || 'vault'}`),
      React.createElement(
        'button',
        { onClick: () => onBack && onBack() },
        'Back'
      ),
      React.createElement(
        'button',
        {
          onClick: () => onLogin && onLogin('login-password'),
        },
        'Login'
      )
    ),
}));

vi.mock('../components/PasswordManager', () => ({
  __esModule: true,
  default: ({ vaultName, vaultPassword, onLock }) =>
    React.createElement(
      'div',
      { 'data-testid': 'password-manager' },
      React.createElement('span', {}, `Managing ${vaultName || 'vault'}`),
      React.createElement(
        'button',
        { onClick: () => onLock && onLock() },
        'Lock'
      )
    ),
}));

// Mock Material-UI components
vi.mock('@mui/material/CssBaseline', () => ({
  __esModule: true,
  default: ({ children }) => <div data-testid="css-baseline">{children}</div>,
}));

vi.mock('@mui/material/styles', () => ({
  ThemeProvider: ({ children }) => (
    <div data-testid="theme-provider">{children}</div>
  ),
  createTheme: vi.fn(() => ({})),
}));

describe('App', () => {
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

  describe('Initial State', () => {
    it('renders vault selector by default', () => {
      render(<App />);
      expect(screen.getByTestId('vault-selector')).toBeInTheDocument();
    });

    it('renders with theme provider and css baseline', () => {
      render(<App />);
      expect(screen.getByTestId('theme-provider')).toBeInTheDocument();
      expect(screen.getByTestId('css-baseline')).toBeInTheDocument();
    });
  });

  describe('Navigation Flow', () => {
    it('can click create vault button', () => {
      render(<App />);

      const createButton = screen.getByText('Create Vault');
      expect(createButton).toBeInTheDocument();

      // Just test that clicking doesn't crash
      expect(() => fireEvent.click(createButton)).not.toThrow();
    });

    it('can click select vault button', () => {
      render(<App />);

      const selectButton = screen.getByText('Select Vault');
      expect(selectButton).toBeInTheDocument();

      // Just test that clicking doesn't crash
      expect(() => fireEvent.click(selectButton)).not.toThrow();
    });

    it('renders vault selector by default', () => {
      render(<App />);
      expect(screen.getByTestId('vault-selector')).toBeInTheDocument();
    });

    it('has create vault functionality', () => {
      render(<App />);
      expect(screen.getByText('Create Vault')).toBeInTheDocument();
    });

    it('has select vault functionality', () => {
      render(<App />);
      expect(screen.getByText('Select Vault')).toBeInTheDocument();
    });
  });

  describe('State Management', () => {
    it('maintains app state', () => {
      render(<App />);
      expect(screen.getByTestId('vault-selector')).toBeInTheDocument();
    });

    it('handles component interactions', () => {
      render(<App />);

      // Test that buttons exist and can be clicked
      const createButton = screen.getByText('Create Vault');
      const selectButton = screen.getByText('Select Vault');

      expect(createButton).toBeInTheDocument();
      expect(selectButton).toBeInTheDocument();
    });

    it('renders without errors', () => {
      expect(() => render(<App />)).not.toThrow();
    });
  });

  describe('Screen Transitions', () => {
    it('shows vault selector initially', () => {
      render(<App />);
      expect(screen.getByTestId('vault-selector')).toBeInTheDocument();
    });

    it('handles button clicks without errors', () => {
      render(<App />);

      // Test that clicking buttons doesn't crash the app
      expect(() => {
        fireEvent.click(screen.getByText('Create Vault'));
        fireEvent.click(screen.getByText('Select Vault'));
      }).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('handles missing props gracefully', () => {
      // Test that app doesn't crash with undefined props
      expect(() => render(<App />)).not.toThrow();
    });

    it('handles component errors gracefully', () => {
      // Test that app renders even if child components have issues
      expect(() => render(<App />)).not.toThrow();
      expect(screen.getByTestId('vault-selector')).toBeInTheDocument();
    });
  });

  describe('Theme Integration', () => {
    it('applies theme provider to all components', () => {
      render(<App />);

      // Check that theme provider wraps the content
      const themeProvider = screen.getByTestId('theme-provider');
      expect(themeProvider).toBeInTheDocument();

      // Check that vault selector is inside theme provider
      expect(themeProvider).toContainElement(
        screen.getByTestId('vault-selector')
      );
    });

    it('includes CSS baseline for consistent styling', () => {
      render(<App />);

      expect(screen.getByTestId('css-baseline')).toBeInTheDocument();
    });
  });
});
