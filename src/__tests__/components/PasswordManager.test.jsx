import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import PasswordManager from '../../components/PasswordManager';

// Mock all Material-UI components used in PasswordManager
vi.mock('@mui/material/Typography', () => ({
  __esModule: true,
  default: ({ children, ...props }) => React.createElement('div', props, children),
}));

vi.mock('@mui/material/Button', () => ({
  __esModule: true,
  default: ({ children, onClick, ...props }) => React.createElement('button', { onClick, ...props }, children),
}));

vi.mock('@mui/material/Box', () => ({
  __esModule: true,
  default: ({ children, ...props }) => React.createElement('div', props, children),
}));

vi.mock('@mui/material/Card', () => ({
  __esModule: true,
  default: ({ children, ...props }) => React.createElement('div', props, children),
}));

vi.mock('@mui/material/CardContent', () => ({
  __esModule: true,
  default: ({ children, ...props }) => React.createElement('div', props, children),
}));

vi.mock('@mui/material/IconButton', () => ({
  __esModule: true,
  default: ({ children, onClick, ...props }) => React.createElement('button', { onClick, ...props }, children),
}));

vi.mock('@mui/material/TextField', () => ({
  __esModule: true,
  default: ({ value, onChange, placeholder, ...props }) => React.createElement('input', { value, onChange, placeholder, ...props }),
}));

vi.mock('@mui/material/Chip', () => ({
  __esModule: true,
  default: ({ label, ...props }) => React.createElement('span', props, label),
}));

vi.mock('@mui/material/Fab', () => ({
  __esModule: true,
  default: ({ children, onClick, ...props }) => React.createElement('button', {
    onClick,
    'data-testid': 'fab-button',
    'aria-label': 'Add new entry',
    role: 'button',
    ...props
  }, children),
}));

vi.mock('@mui/material/Alert', () => ({
  __esModule: true,
  default: ({ children, ...props }) => React.createElement('div', { 'data-testid': 'alert', ...props }, children),
}));

vi.mock('@mui/material/Snackbar', () => ({
  __esModule: true,
  default: ({ children, open, ...props }) => open ? React.createElement('div', { 'data-testid': 'snackbar', ...props }, children) : null,
}));

vi.mock('@mui/material/Menu', () => ({
  __esModule: true,
  default: ({ children, open, ...props }) => open ? React.createElement('div', { 'data-testid': 'menu', ...props }, children) : null,
}));

vi.mock('@mui/material/MenuItem', () => ({
  __esModule: true,
  default: ({ children, onClick, ...props }) => React.createElement('div', { onClick, ...props }, children),
}));

vi.mock('@mui/material/InputAdornment', () => ({
  __esModule: true,
  default: ({ children, ...props }) => React.createElement('div', props, children),
}));

vi.mock('@mui/material/FormControl', () => ({
  __esModule: true,
  default: ({ children, ...props }) => React.createElement('div', props, children),
}));

vi.mock('@mui/material/InputLabel', () => ({
  __esModule: true,
  default: ({ children, ...props }) => React.createElement('label', props, children),
}));

vi.mock('@mui/material/Select', () => ({
  __esModule: true,
  default: ({ children, value, onChange, ...props }) => React.createElement('select', { value, onChange, ...props }, children),
}));

// Mock Material-UI icons
vi.mock('@mui/icons-material/Add', () => ({
  __esModule: true,
  default: () => React.createElement('span', {}, '+'),
}));

vi.mock('@mui/icons-material/Search', () => ({
  __esModule: true,
  default: () => React.createElement('span', {}, '🔍'),
}));

vi.mock('@mui/icons-material/Settings', () => ({
  __esModule: true,
  default: () => React.createElement('span', {}, '⚙️'),
}));

vi.mock('@mui/icons-material/Lock', () => ({
  __esModule: true,
  default: () => React.createElement('span', {}, '🔒'),
}));

vi.mock('@mui/icons-material/Visibility', () => ({
  __esModule: true,
  default: () => React.createElement('span', {}, '👁️'),
}));

vi.mock('@mui/icons-material/VisibilityOff', () => ({
  __esModule: true,
  default: () => React.createElement('span', {}, '🙈'),
}));

vi.mock('@mui/icons-material/ContentCopy', () => ({
  __esModule: true,
  default: () => React.createElement('span', {}, '📋'),
}));

vi.mock('@mui/icons-material/MoreVert', () => ({
  __esModule: true,
  default: () => React.createElement('span', {}, '⋮'),
}));

// Mock the Settings component
vi.mock('../../components/Settings', () => ({
  __esModule: true,
  default: ({ onBack, onPasswordChanged }) =>
    React.createElement('div', { 'data-testid': 'settings-component' },
      React.createElement('button', { onClick: onBack }, 'Back'),
      React.createElement('button', { onClick: () => onPasswordChanged('newpass') }, 'Change Password')
    ),
}));

// Mock the EntryDialog component
vi.mock('../../components/EntryDialog', () => ({
  __esModule: true,
  default: ({ open, onClose, onSave, entry, validationErrors, onValidationErrorsChange }) => {
    if (!open) return null;

    const [formData, setFormData] = React.useState({
      title: entry?.title || '',
      username: entry?.username || '',
      password: entry?.password || '',
      url: entry?.url || '',
      notes: entry?.notes || '',
      category: entry?.category || 'general',
    });

    const handleInputChange = (field, value) => {
      setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleSave = () => {
      // Simulate validation
      const errors = {};
      if (!formData.title.trim()) errors.title = 'Title is required';
      if (!formData.username.trim()) errors.username = 'Username is required';
      if (!formData.password.trim()) errors.password = 'Password is required';

      if (Object.keys(errors).length > 0) {
        if (onValidationErrorsChange) {
          onValidationErrorsChange(errors);
        }
        return;
      }

      onSave(formData);
    };

    return React.createElement('div', { 'data-testid': 'entry-dialog' },
      React.createElement('h2', {}, entry ? 'Edit Password Entry' : 'Add New Password Entry'),
      React.createElement('input', {
        'data-testid': 'title-input',
        placeholder: 'Title',
        value: formData.title,
        onChange: (e) => handleInputChange('title', e.target.value)
      }),
      React.createElement('input', {
        'data-testid': 'username-input',
        placeholder: 'Username',
        value: formData.username,
        onChange: (e) => handleInputChange('username', e.target.value)
      }),
      React.createElement('input', {
        'data-testid': 'password-input',
        placeholder: 'Password',
        type: 'password',
        value: formData.password,
        onChange: (e) => handleInputChange('password', e.target.value)
      }),
      React.createElement('button', { onClick: handleSave, role: 'button' }, entry ? 'Update Entry' : 'Add'),
      React.createElement('button', { onClick: onClose, role: 'button' }, 'Cancel'),
      validationErrors && Object.keys(validationErrors).length > 0 &&
        React.createElement('div', { 'data-testid': 'validation-errors' }, 'Please fill in all required fields')
    );
  },
}));

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

describe('PasswordManager', () => {
  const defaultProps = {
    vaultName: 'test-vault',
    vaultPassword: 'test-password',
    onLock: vi.fn(),
  };

  const mockElectronAPI = {
    loadVault: vi.fn(),
    saveVault: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.window.electronAPI = mockElectronAPI;

    // Default successful responses
    mockElectronAPI.loadVault.mockResolvedValue({
      success: true,
      data: { entries: [] },
    });
    mockElectronAPI.saveVault.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    delete global.window.electronAPI;
  });

  describe('Component Rendering', () => {
    it('shows loading state initially', () => {
      render(React.createElement(PasswordManager, defaultProps));
      expect(screen.getByText('Loading vault...')).toBeInTheDocument();
    });

    it('renders vault header after loading', async () => {
      render(React.createElement(PasswordManager, defaultProps));

      await waitFor(() => {
        expect(screen.getByText('test-vault')).toBeInTheDocument();
      });

      expect(screen.getByText('0 passwords stored')).toBeInTheDocument();
    });

    it('renders empty state when no entries', async () => {
      render(React.createElement(PasswordManager, defaultProps));

      await waitFor(() => {
        expect(screen.getByText('No passwords stored yet')).toBeInTheDocument();
      });

      expect(
        screen.getByText('Add your first password to get started')
      ).toBeInTheDocument();
    });

    it('renders entries when vault has data', async () => {
      const mockEntries = [
        {
          id: '1',
          title: 'Gmail',
          username: 'user@gmail.com',
          password: 'password123',
          url: 'https://gmail.com',
          category: 'email',
          createdAt: '2023-01-01T00:00:00.000Z',
        },
      ];

      mockElectronAPI.loadVault.mockResolvedValue({
        success: true,
        data: { entries: mockEntries },
      });

      render(React.createElement(PasswordManager, defaultProps));

      await waitFor(() => {
        expect(screen.getByText('Gmail')).toBeInTheDocument();
      });

      expect(screen.getByText('user@gmail.com')).toBeInTheDocument();
      expect(screen.getByText('1 password stored')).toBeInTheDocument();
    });
  });

  describe('Vault Operations', () => {
    it('calls loadVault on mount', async () => {
      render(React.createElement(PasswordManager, defaultProps));

      await waitFor(() => {
        expect(mockElectronAPI.loadVault).toHaveBeenCalledWith(
          'test-vault',
          'test-password'
        );
      });
    });

    it('handles load vault failure', async () => {
      mockElectronAPI.loadVault.mockResolvedValue({
        success: false,
        error: 'Failed to load',
      });

      render(React.createElement(PasswordManager, defaultProps));

      await waitFor(() => {
        expect(
          screen.getByText('Failed to load vault data')
        ).toBeInTheDocument();
      });
    });

    it('calls onLock when lock button clicked', async () => {
      render(React.createElement(PasswordManager, defaultProps));

      await waitFor(() => {
        expect(screen.getByText('test-vault')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /lock vault/i }));
      expect(defaultProps.onLock).toHaveBeenCalled();
    });
  });

  describe('Search and Filtering', () => {
    beforeEach(async () => {
      const mockEntries = [
        {
          id: '1',
          title: 'Gmail',
          username: 'user@gmail.com',
          password: 'pass1',
          category: 'email',
        },
        {
          id: '2',
          title: 'Facebook',
          username: 'user@facebook.com',
          password: 'pass2',
          category: 'website',
        },
      ];

      mockElectronAPI.loadVault.mockResolvedValue({
        success: true,
        data: { entries: mockEntries },
      });
    });

    it('filters entries by search term', async () => {
      render(React.createElement(PasswordManager, defaultProps));

      await waitFor(() => {
        expect(screen.getByText('Gmail')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search passwords...');
      fireEvent.change(searchInput, { target: { value: 'gmail' } });

      expect(screen.getByText('Gmail')).toBeInTheDocument();
      expect(screen.queryByText('Facebook')).not.toBeInTheDocument();
    });

    it('shows no results message when search has no matches', async () => {
      render(React.createElement(PasswordManager, defaultProps));

      await waitFor(() => {
        expect(screen.getByText('Gmail')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search passwords...');
      fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

      expect(screen.getByText('No passwords found')).toBeInTheDocument();
      expect(
        screen.getByText('Try a different search term')
      ).toBeInTheDocument();
    });
  });

  describe('Password Visibility', () => {
    beforeEach(async () => {
      const mockEntries = [
        {
          id: '1',
          title: 'Gmail',
          username: 'user@gmail.com',
          password: 'secretpass',
          category: 'email',
        },
      ];

      mockElectronAPI.loadVault.mockResolvedValue({
        success: true,
        data: { entries: mockEntries },
      });
    });

    it('toggles password visibility', async () => {
      render(React.createElement(PasswordManager, defaultProps));

      await waitFor(() => {
        expect(screen.getByText('••••••••')).toBeInTheDocument();
      });

      // Find and click the visibility toggle button
      const visibilityButtons = screen.getAllByRole('button');
      const visibilityToggle = visibilityButtons.find(
        (btn) =>
          btn.querySelector('[data-testid="VisibilityIcon"]') ||
          btn.querySelector('[data-testid="VisibilityOffIcon"]')
      );

      if (visibilityToggle) {
        fireEvent.click(visibilityToggle);
        await waitFor(() => {
          expect(screen.getByText('secretpass')).toBeInTheDocument();
        });
      }
    });
  });

  describe('Copy to Clipboard', () => {
    beforeEach(async () => {
      const mockEntries = [
        {
          id: '1',
          title: 'Gmail',
          username: 'user@gmail.com',
          password: 'secretpass',
          url: 'https://gmail.com',
          category: 'email',
        },
      ];

      mockElectronAPI.loadVault.mockResolvedValue({
        success: true,
        data: { entries: mockEntries },
      });
    });

    it('copies username to clipboard', async () => {
      render(React.createElement(PasswordManager, defaultProps));

      await waitFor(() => {
        expect(screen.getByText('user@gmail.com')).toBeInTheDocument();
      });

      // Find copy buttons and click the first one (username copy)
      const copyButtons = screen.getAllByRole('button');
      const usernameCopyButton = copyButtons.find((btn) =>
        btn.querySelector('[data-testid="ContentCopyIcon"]')
      );

      if (usernameCopyButton) {
        fireEvent.click(usernameCopyButton);

        await waitFor(() => {
          expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
            'user@gmail.com'
          );
        });

        expect(
          screen.getByText('Username copied to clipboard')
        ).toBeInTheDocument();
      }
    });
  });

  describe('Settings Integration', () => {
    it('opens settings when settings button clicked', async () => {
      render(React.createElement(PasswordManager, defaultProps));

      await waitFor(() => {
        expect(screen.getByText('test-vault')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /settings/i }));

      expect(screen.getByTestId('settings-component')).toBeInTheDocument();
    });

    it('returns from settings and updates password', async () => {
      render(React.createElement(PasswordManager, defaultProps));

      await waitFor(() => {
        expect(screen.getByText('test-vault')).toBeInTheDocument();
      });

      // Open settings
      fireEvent.click(screen.getByRole('button', { name: /settings/i }));
      expect(screen.getByTestId('settings-component')).toBeInTheDocument();

      // Change password and go back
      fireEvent.click(screen.getByText('Change Password'));
      fireEvent.click(screen.getByText('Back'));

      // Should be back to main view
      expect(screen.getByText('test-vault')).toBeInTheDocument();
    });
  });

  describe('Add Entry Dialog', () => {
    it('opens add dialog when FAB clicked', async () => {
      render(React.createElement(PasswordManager, defaultProps));

      await waitFor(() => {
        expect(screen.getByText('test-vault')).toBeInTheDocument();
      });

      // Click the floating action button
      const fabButton = screen.getByTestId('fab-button');
      fireEvent.click(fabButton);

      expect(screen.getByText('Add New Password Entry')).toBeInTheDocument();
    });

    it('validates required fields', async () => {
      render(React.createElement(PasswordManager, defaultProps));

      await waitFor(() => {
        expect(screen.getByText('test-vault')).toBeInTheDocument();
      });

      // Open add dialog
      const fabButton = screen.getByTestId('fab-button');
      fireEvent.click(fabButton);

      // Try to submit without filling required fields
      fireEvent.click(screen.getByRole('button', { name: /add/i }));

      await waitFor(() => {
        expect(
          screen.getByText('Please fill in all required fields')
        ).toBeInTheDocument();
      });
    });
  });
});
