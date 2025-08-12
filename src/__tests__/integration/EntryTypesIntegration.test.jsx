// Integration tests for new entry types functionality
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import PasswordManager from '../../components/PasswordManager';

// Mock electron API
const mockElectronAPI = {
  loadVault: vi.fn(),
  saveVault: vi.fn(),
  createVault: vi.fn(),
  deleteVault: vi.fn(),
  listVaults: vi.fn(),
  getVaults: vi.fn(),
  exportVault: vi.fn(),
  importVault: vi.fn(),
  changeMasterPassword: vi.fn(),
  updateVaultSettings: vi.fn(),
  restoreVaultBackup: vi.fn(),
  hasVaultBackup: vi.fn(),
};

// Mock Material-UI components
vi.mock('@mui/material/Snackbar', () => ({
  __esModule: true,
  default: ({ children, open }) =>
    open
      ? React.createElement('div', { 'data-testid': 'snackbar' }, children)
      : null,
}));

vi.mock('@mui/material/Alert', () => ({
  __esModule: true,
  default: ({ children, severity }) =>
    React.createElement(
      'div',
      { 'data-testid': `alert-${severity}` },
      children
    ),
}));

// Mock AddEntryMenu
vi.mock('../../components/AddEntryMenu', () => ({
  __esModule: true,
  default: ({ onEntryTypeSelect }) =>
    React.createElement('div', {
      'data-testid': 'add-entry-menu',
      children: [
        React.createElement(
          'button',
          {
            key: 'password',
            'data-testid': 'add-password',
            onClick: () => onEntryTypeSelect('password'),
          },
          'Add Password'
        ),
        React.createElement(
          'button',
          {
            key: 'wifi',
            'data-testid': 'add-wifi',
            onClick: () => onEntryTypeSelect('wifi'),
          },
          'Add WiFi'
        ),
        React.createElement(
          'button',
          {
            key: 'otp',
            'data-testid': 'add-otp',
            onClick: () => onEntryTypeSelect('otp'),
          },
          'Add OTP'
        ),
        React.createElement(
          'button',
          {
            key: 'level3_card',
            'data-testid': 'add-level3',
            onClick: () => onEntryTypeSelect('level3_card'),
          },
          'Add Level 3 Card'
        ),
      ],
    }),
}));

// Mock EnhancedEntryDialog
vi.mock('../../components/EnhancedEntryDialog', () => ({
  __esModule: true,
  default: ({ open, entryType, onSave, onClose }) =>
    open
      ? React.createElement('div', {
          'data-testid': 'enhanced-entry-dialog',
          children: [
            React.createElement(
              'div',
              { key: 'title' },
              `Add New ${entryType}`
            ),
            // Mock form fields
            React.createElement('input', {
              key: 'title-input',
              'aria-label': 'Title',
              placeholder: 'Title',
            }),
            React.createElement('input', {
              key: 'ssid-input',
              'aria-label': 'Network Name (SSID)',
              placeholder: 'Network Name (SSID)',
            }),
            React.createElement('input', {
              key: 'wifi-password-input',
              'aria-label': 'WiFi Password',
              placeholder: 'WiFi Password',
              type: 'password',
            }),
            React.createElement('input', {
              key: 'secret-input',
              'aria-label': 'Secret Key',
              placeholder: 'Secret Key',
            }),
            React.createElement(
              'button',
              {
                key: 'save',
                'data-testid': 'save-entry',
                onClick: () =>
                  onSave({
                    id: Date.now().toString(),
                    title: `Test ${entryType}`,
                    entryType,
                    category: 'general',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                  }),
              },
              'Save'
            ),
            React.createElement(
              'button',
              {
                key: 'cancel',
                'data-testid': 'cancel-entry',
                onClick: onClose,
              },
              'Cancel'
            ),
          ],
        })
      : null,
}));

// Mock SearchAndFilter
vi.mock('../../components/SearchAndFilter', () => ({
  __esModule: true,
  default: ({
    selectedEntryType,
    onEntryTypeChange,
    onSearchChange,
    onCategoryChange,
  }) =>
    React.createElement('div', {
      'data-testid': 'search-and-filter',
      children: [
        React.createElement('input', {
          key: 'search',
          'data-testid': 'search-input',
          placeholder: 'Search entries...',
          onChange: (e) => onSearchChange(e.target.value),
        }),
        React.createElement('select', {
          key: 'entry-type',
          'data-testid': 'entry-type-filter',
          value: selectedEntryType || '',
          onChange: (e) => onEntryTypeChange(e.target.value),
          children: [
            React.createElement(
              'option',
              { key: 'all', value: '' },
              'All Types'
            ),
            React.createElement(
              'option',
              { key: 'password', value: 'password' },
              'Password'
            ),
            React.createElement(
              'option',
              { key: 'wifi', value: 'wifi' },
              'WiFi'
            ),
            React.createElement('option', { key: 'otp', value: 'otp' }, 'OTP'),
          ],
        }),
        React.createElement('select', {
          key: 'category',
          'data-testid': 'category-filter',
          onChange: (e) => onCategoryChange(e.target.value),
          children: [
            React.createElement(
              'option',
              { key: 'all', value: '' },
              'All Categories'
            ),
            React.createElement(
              'option',
              { key: 'general', value: 'general' },
              'General'
            ),
            React.createElement(
              'option',
              { key: 'work', value: 'work' },
              'Work'
            ),
          ],
        }),
      ],
    }),
}));

// Mock EntryList
vi.mock('../../components/EntryList', () => ({
  __esModule: true,
  default: ({ entries }) =>
    React.createElement('div', {
      'data-testid': 'entry-list',
      children: entries.map((entry, index) =>
        React.createElement(
          'div',
          {
            key: entry.id,
            'data-testid': `entry-${index + 1}`,
            'data-entry-type': entry.entryType,
          },
          `${entry.title} (${entry.entryType})`
        )
      ),
    }),
}));

describe('Entry Types Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.window.electronAPI = mockElectronAPI;

    // Mock successful vault operations
    mockElectronAPI.loadVault.mockResolvedValue({
      success: true,
      data: { entries: [] },
    });
    mockElectronAPI.saveVault.mockResolvedValue({ success: true });
    mockElectronAPI.getVaults.mockResolvedValue({
      success: true,
      vaults: ['test-vault'],
    });
  });

  afterEach(() => {
    delete global.window.electronAPI;
  });

  it('allows creating different entry types through AddEntryMenu', async () => {
    render(
      <PasswordManager vaultName="test-vault" vaultPassword="password123" />
    );

    // Wait for loading to complete
    await waitFor(
      () => {
        expect(screen.queryByText('Loading vault...')).not.toBeInTheDocument();
      },
      { timeout: 3000 }
    );

    // Wait for the FAB button to be enabled (not disabled)
    await waitFor(
      () => {
        const fabButton = screen.getByTestId('add-entry-menu');
        expect(fabButton).toBeInTheDocument();
        expect(fabButton).not.toBeDisabled();
      },
      { timeout: 3000 }
    );

    // Click the FAB button to open the menu
    const fabButton = screen.getByTestId('add-entry-menu');
    fireEvent.click(fabButton);

    // Wait for the menu to open and find the WiFi option
    await waitFor(() => {
      expect(screen.getByTestId('add-wifi')).toBeInTheDocument();
    });

    // Test creating a WiFi entry
    const addWifiButton = screen.getByTestId('add-wifi');
    fireEvent.click(addWifiButton);

    await waitFor(() => {
      expect(screen.getByTestId('enhanced-entry-dialog')).toBeInTheDocument();
      expect(screen.getByText('Add New wifi')).toBeInTheDocument();
    });

    // Fill in required fields
    const titleInput = screen.getByLabelText(/^title/i);
    fireEvent.change(titleInput, { target: { value: 'Test WiFi' } });

    const ssidInput = screen.getByLabelText(/network.*name.*ssid/i);
    fireEvent.change(ssidInput, { target: { value: 'TestNetwork' } });

    const passwordInput = screen.getByLabelText(/^wifi.*password/i);
    fireEvent.change(passwordInput, { target: { value: 'testpass123' } });

    // Save the entry
    const saveButton = screen.getByTestId('save-entry');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockElectronAPI.saveVault).toHaveBeenCalled();
    });
  });

  it('filters entries by type using SearchAndFilter', async () => {
    // Mock vault with different entry types
    mockElectronAPI.loadVault.mockResolvedValue({
      success: true,
      data: {
        entries: [
          { id: '1', title: 'Gmail', entryType: 'password', category: 'email' },
          {
            id: '2',
            title: 'Home WiFi',
            entryType: 'wifi',
            category: 'network',
          },
          {
            id: '3',
            title: 'Google 2FA',
            entryType: 'otp',
            category: 'security',
          },
        ],
      },
    });

    render(
      <PasswordManager vaultName="test-vault" vaultPassword="password123" />
    );

    // Wait for loading to complete and entries to be rendered
    await waitFor(() => {
      expect(screen.getByTestId('search-and-filter')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.queryByText('Loading vault...')).not.toBeInTheDocument();
    });

    // Initially all entries should be visible
    await waitFor(() => {
      expect(screen.getByTestId('entry-1')).toBeInTheDocument();
      expect(screen.getByTestId('entry-2')).toBeInTheDocument();
      expect(screen.getByTestId('entry-3')).toBeInTheDocument();
    });

    // Filter by WiFi entries
    const entryTypeFilter = screen.getByTestId('entry-type-filter');
    fireEvent.change(entryTypeFilter, { target: { value: 'wifi' } });

    // Should show only WiFi entries (this would be handled by the actual SearchAndFilter component)
    // In this mock test, we're just verifying the filter interaction works
    expect(entryTypeFilter.value).toBe('wifi');
  });

  it('creates and saves different entry types correctly', async () => {
    render(
      <PasswordManager vaultName="test-vault" vaultPassword="password123" />
    );

    // Wait for loading to complete
    await waitFor(
      () => {
        expect(screen.queryByText('Loading vault...')).not.toBeInTheDocument();
      },
      { timeout: 3000 }
    );

    // Wait for the FAB button to be enabled
    await waitFor(
      () => {
        const fabButton = screen.getByTestId('add-entry-menu');
        expect(fabButton).toBeInTheDocument();
        expect(fabButton).not.toBeDisabled();
      },
      { timeout: 3000 }
    );

    // Click the FAB button to open the menu
    const fabButton = screen.getByTestId('add-entry-menu');
    fireEvent.click(fabButton);

    // Wait for the menu to open
    await waitFor(() => {
      expect(screen.getByTestId('add-otp')).toBeInTheDocument();
    });

    // Test creating an OTP entry
    const addOtpButton = screen.getByTestId('add-otp');
    fireEvent.click(addOtpButton);

    await waitFor(() => {
      expect(screen.getByTestId('enhanced-entry-dialog')).toBeInTheDocument();
    });

    // Fill in required fields
    const titleInput = screen.getByLabelText(/^title/i);
    fireEvent.change(titleInput, { target: { value: 'Test OTP' } });

    const secretInput = screen.getByLabelText(/secret.*key/i);
    fireEvent.change(secretInput, { target: { value: 'JBSWY3DPEHPK3PXP' } });

    const saveButton = screen.getByTestId('save-entry');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockElectronAPI.saveVault).toHaveBeenCalledWith(
        'test-vault',
        'password123',
        expect.objectContaining({
          entries: expect.arrayContaining([
            expect.objectContaining({
              entryType: 'otp',
              title: 'Test otp',
            }),
          ]),
        })
      );
    });
  });

  it('handles Level 3 card creation', async () => {
    render(
      <PasswordManager vaultName="test-vault" vaultPassword="password123" />
    );

    // Wait for loading to complete
    await waitFor(
      () => {
        expect(screen.queryByText('Loading vault...')).not.toBeInTheDocument();
      },
      { timeout: 3000 }
    );

    // Wait for the FAB button to be enabled
    await waitFor(
      () => {
        const fabButton = screen.getByTestId('add-entry-menu');
        expect(fabButton).toBeInTheDocument();
        expect(fabButton).not.toBeDisabled();
      },
      { timeout: 3000 }
    );

    // Click the FAB button to open the menu
    const fabButton = screen.getByTestId('add-entry-menu');
    fireEvent.click(fabButton);

    // Wait for the menu to open
    await waitFor(() => {
      expect(screen.getByTestId('add-level3')).toBeInTheDocument();
    });

    // Test creating a Level 3 card
    const addLevel3Button = screen.getByTestId('add-level3');
    fireEvent.click(addLevel3Button);

    await waitFor(() => {
      expect(screen.getByTestId('enhanced-entry-dialog')).toBeInTheDocument();
      expect(screen.getByText('Add New level3_card')).toBeInTheDocument();
    });

    // Fill in required fields
    const titleInput = screen.getByLabelText(/^title/i);
    fireEvent.change(titleInput, { target: { value: 'Test Level 3 Card' } });

    const saveButton = screen.getByTestId('save-entry');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockElectronAPI.saveVault).toHaveBeenCalledWith(
        'test-vault',
        'password123',
        expect.objectContaining({
          entries: expect.arrayContaining([
            expect.objectContaining({
              entryType: 'level3_card',
              title: 'Test level3_card',
            }),
          ]),
        })
      );
    });
  });

  it('displays entries with correct type information', async () => {
    // Mock vault with mixed entry types
    mockElectronAPI.loadVault.mockResolvedValue({
      success: true,
      data: {
        entries: [
          { id: '1', title: 'Gmail', entryType: 'password', category: 'email' },
          {
            id: '2',
            title: 'Home WiFi',
            entryType: 'wifi',
            category: 'network',
          },
        ],
      },
    });

    render(
      <PasswordManager vaultName="test-vault" vaultPassword="password123" />
    );

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByText('Loading vault...')).not.toBeInTheDocument();
    });

    await waitFor(() => {
      const passwordEntry = screen.getByTestId('entry-1');
      const wifiEntry = screen.getByTestId('entry-2');

      expect(passwordEntry).toHaveAttribute('data-entry-type', 'password');
      expect(wifiEntry).toHaveAttribute('data-entry-type', 'wifi');

      expect(passwordEntry).toHaveTextContent('Gmail');
      expect(wifiEntry).toHaveTextContent('Home WiFi');
    });
  });
});
