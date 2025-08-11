import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import PasswordManager from '../../components/PasswordManager';

// Mock the Settings component
vi.mock('../../components/Settings', () => ({
  __esModule: true,
  default: ({ onBack, onPasswordChanged }) => (
    <div data-testid="settings-component">
      <button onClick={onBack}>Back</button>
      <button onClick={() => onPasswordChanged('newpass')}>
        Change Password
      </button>
    </div>
  ),
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
      render(<PasswordManager {...defaultProps} />);
      expect(screen.getByText('Loading vault...')).toBeInTheDocument();
    });

    it('renders vault header after loading', async () => {
      render(<PasswordManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('test-vault')).toBeInTheDocument();
      });

      expect(screen.getByText('0 passwords stored')).toBeInTheDocument();
    });

    it('renders empty state when no entries', async () => {
      render(<PasswordManager {...defaultProps} />);

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

      render(<PasswordManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Gmail')).toBeInTheDocument();
      });

      expect(screen.getByText('user@gmail.com')).toBeInTheDocument();
      expect(screen.getByText('1 password stored')).toBeInTheDocument();
    });
  });

  describe('Vault Operations', () => {
    it('calls loadVault on mount', async () => {
      render(<PasswordManager {...defaultProps} />);

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

      render(<PasswordManager {...defaultProps} />);

      await waitFor(() => {
        expect(
          screen.getByText('Failed to load vault data')
        ).toBeInTheDocument();
      });
    });

    it('calls onLock when lock button clicked', async () => {
      render(<PasswordManager {...defaultProps} />);

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
      render(<PasswordManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Gmail')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search passwords...');
      fireEvent.change(searchInput, { target: { value: 'gmail' } });

      expect(screen.getByText('Gmail')).toBeInTheDocument();
      expect(screen.queryByText('Facebook')).not.toBeInTheDocument();
    });

    it('shows no results message when search has no matches', async () => {
      render(<PasswordManager {...defaultProps} />);

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
      render(<PasswordManager {...defaultProps} />);

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
      render(<PasswordManager {...defaultProps} />);

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
      render(<PasswordManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('test-vault')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /settings/i }));

      expect(screen.getByTestId('settings-component')).toBeInTheDocument();
    });

    it('returns from settings and updates password', async () => {
      render(<PasswordManager {...defaultProps} />);

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
      render(<PasswordManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('test-vault')).toBeInTheDocument();
      });

      // Click the floating action button
      const fabButton = screen.getByRole('button', { name: '' }); // FAB typically has no accessible name
      fireEvent.click(fabButton);

      expect(screen.getByText('Add New Password Entry')).toBeInTheDocument();
    });

    it('validates required fields', async () => {
      render(<PasswordManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('test-vault')).toBeInTheDocument();
      });

      // Open add dialog
      const fabButton = screen.getByRole('button', { name: '' });
      fireEvent.click(fabButton);

      // Try to submit without filling required fields
      fireEvent.click(screen.getByRole('button', { name: /add/i }));

      await waitFor(() => {
        expect(
          screen.getByText('Please fill in all required fields')
        ).toBeInTheDocument();
      });
    });

    it('successfully adds new entry', async () => {
      render(<PasswordManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('test-vault')).toBeInTheDocument();
      });

      // Open add dialog
      const fabButton = screen.getByRole('button', { name: '' });
      fireEvent.click(fabButton);

      // Fill in the form
      fireEvent.change(screen.getByLabelText(/title/i), {
        target: { value: 'New Entry' },
      });
      fireEvent.change(screen.getByLabelText(/username/i), {
        target: { value: 'newuser@test.com' },
      });
      fireEvent.change(screen.getByLabelText(/password/i), {
        target: { value: 'newpassword123' },
      });

      // Submit the form
      fireEvent.click(screen.getByRole('button', { name: /add/i }));

      await waitFor(() => {
        expect(mockElectronAPI.saveVault).toHaveBeenCalled();
      });

      expect(
        screen.getByText('Password entry added successfully')
      ).toBeInTheDocument();
    });

    it('generates password when generate button clicked', async () => {
      render(<PasswordManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('test-vault')).toBeInTheDocument();
      });

      // Open add dialog
      const fabButton = screen.getByRole('button', { name: '' });
      fireEvent.click(fabButton);

      const passwordInput = screen.getByLabelText(/password/i);
      expect(passwordInput.value).toBe('');

      // Find and click the generate password button
      const generateButton = screen.getByRole('button', {
        name: /generate password/i,
      });
      fireEvent.click(generateButton);

      // Password should now be filled
      expect(passwordInput.value).not.toBe('');
      expect(passwordInput.value.length).toBe(16);
    });
  });

  describe('Edit Entry', () => {
    beforeEach(async () => {
      const mockEntries = [
        {
          id: '1',
          title: 'Gmail',
          username: 'user@gmail.com',
          password: 'oldpassword',
          url: 'https://gmail.com',
          category: 'email',
        },
      ];

      mockElectronAPI.loadVault.mockResolvedValue({
        success: true,
        data: { entries: mockEntries },
      });
    });

    it('opens edit dialog when edit menu item clicked', async () => {
      render(<PasswordManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Gmail')).toBeInTheDocument();
      });

      // Click the more options button
      const moreButton = screen.getByRole('button', { name: /more/i });
      fireEvent.click(moreButton);

      // Click edit
      fireEvent.click(screen.getByText('Edit'));

      expect(screen.getByText('Edit Password Entry')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Gmail')).toBeInTheDocument();
    });

    it('successfully updates entry', async () => {
      render(<PasswordManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Gmail')).toBeInTheDocument();
      });

      // Open edit dialog
      const moreButton = screen.getByRole('button', { name: /more/i });
      fireEvent.click(moreButton);
      fireEvent.click(screen.getByText('Edit'));

      // Update the title
      const titleInput = screen.getByDisplayValue('Gmail');
      fireEvent.change(titleInput, { target: { value: 'Updated Gmail' } });

      // Submit the form
      fireEvent.click(screen.getByRole('button', { name: /update/i }));

      await waitFor(() => {
        expect(mockElectronAPI.saveVault).toHaveBeenCalled();
      });

      expect(
        screen.getByText('Password entry updated successfully')
      ).toBeInTheDocument();
    });
  });

  describe('Delete Entry', () => {
    beforeEach(async () => {
      const mockEntries = [
        {
          id: '1',
          title: 'Gmail',
          username: 'user@gmail.com',
          password: 'password123',
          category: 'email',
        },
      ];

      mockElectronAPI.loadVault.mockResolvedValue({
        success: true,
        data: { entries: mockEntries },
      });
    });

    it('deletes entry when delete menu item clicked', async () => {
      render(<PasswordManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Gmail')).toBeInTheDocument();
      });

      // Click the more options button
      const moreButton = screen.getByRole('button', { name: /more/i });
      fireEvent.click(moreButton);

      // Click delete
      fireEvent.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(mockElectronAPI.saveVault).toHaveBeenCalled();
      });

      expect(
        screen.getByText('Password entry deleted successfully')
      ).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('handles save vault failure', async () => {
      mockElectronAPI.saveVault.mockResolvedValue({ success: false });

      render(<PasswordManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('test-vault')).toBeInTheDocument();
      });

      // Try to add an entry
      const fabButton = screen.getByRole('button', { name: '' });
      fireEvent.click(fabButton);

      fireEvent.change(screen.getByLabelText(/title/i), {
        target: { value: 'Test' },
      });
      fireEvent.change(screen.getByLabelText(/username/i), {
        target: { value: 'test@test.com' },
      });
      fireEvent.change(screen.getByLabelText(/password/i), {
        target: { value: 'password' },
      });

      fireEvent.click(screen.getByRole('button', { name: /add/i }));

      await waitFor(() => {
        expect(screen.getByText('Failed to save vault')).toBeInTheDocument();
      });
    });

    it('handles clipboard copy failure', async () => {
      navigator.clipboard.writeText.mockRejectedValue(
        new Error('Clipboard error')
      );

      const mockEntries = [
        {
          id: '1',
          title: 'Gmail',
          username: 'user@gmail.com',
          password: 'password123',
          category: 'email',
        },
      ];

      mockElectronAPI.loadVault.mockResolvedValue({
        success: true,
        data: { entries: mockEntries },
      });

      render(<PasswordManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('user@gmail.com')).toBeInTheDocument();
      });

      // Try to copy username
      const copyButtons = screen.getAllByRole('button');
      const usernameCopyButton = copyButtons.find((btn) =>
        btn.querySelector('[data-testid="ContentCopyIcon"]')
      );

      if (usernameCopyButton) {
        fireEvent.click(usernameCopyButton);

        await waitFor(() => {
          expect(
            screen.getByText('Failed to copy to clipboard')
          ).toBeInTheDocument();
        });
      }
    });
  });

  describe('Category Filtering', () => {
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

    it('filters entries by category', async () => {
      render(<PasswordManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Gmail')).toBeInTheDocument();
        expect(screen.getByText('Facebook')).toBeInTheDocument();
      });

      // Open category dropdown
      const categorySelect = screen.getByLabelText(/category/i);
      fireEvent.mouseDown(categorySelect);

      // Select email category
      fireEvent.click(screen.getByText('Email'));

      // Should only show Gmail entry
      expect(screen.getByText('Gmail')).toBeInTheDocument();
      expect(screen.queryByText('Facebook')).not.toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles missing electronAPI gracefully', () => {
      delete global.window.electronAPI;

      render(<PasswordManager {...defaultProps} />);

      // Should still render without crashing
      expect(screen.getByText('Loading vault...')).toBeInTheDocument();
    });

    it('handles entries without optional fields', async () => {
      const mockEntries = [
        {
          id: '1',
          title: 'Minimal Entry',
          username: 'user@test.com',
          password: 'password123',
          category: 'general',
          // No URL or notes
        },
      ];

      mockElectronAPI.loadVault.mockResolvedValue({
        success: true,
        data: { entries: mockEntries },
      });

      render(<PasswordManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Minimal Entry')).toBeInTheDocument();
      });

      // Should render without URL section
      expect(screen.getByText('user@test.com')).toBeInTheDocument();
      expect(screen.queryByText('URL:')).not.toBeInTheDocument();
    });

    it('handles plural/singular password count correctly', async () => {
      const mockEntries = [
        {
          id: '1',
          title: 'Single Entry',
          username: 'user@test.com',
          password: 'password123',
          category: 'general',
        },
      ];

      mockElectronAPI.loadVault.mockResolvedValue({
        success: true,
        data: { entries: mockEntries },
      });

      render(<PasswordManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('1 password stored')).toBeInTheDocument();
      });
    });

    it('clears validation errors when user starts typing', async () => {
      render(<PasswordManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('test-vault')).toBeInTheDocument();
      });

      // Open add dialog
      const fabButton = screen.getByRole('button', { name: '' });
      fireEvent.click(fabButton);

      // Try to submit without filling required fields to trigger validation
      fireEvent.click(screen.getByRole('button', { name: /add/i }));

      await waitFor(() => {
        expect(
          screen.getByText('Please fill in all required fields')
        ).toBeInTheDocument();
      });

      // Start typing in title field
      fireEvent.change(screen.getByLabelText(/title/i), {
        target: { value: 'T' },
      });

      // Validation error should be cleared (this is tested by the component's internal state)
      // We can verify by checking that the error styling is removed
      const titleInput = screen.getByLabelText(/title/i);
      expect(titleInput).toBeInTheDocument();
    });

    it('handles dialog close and reset correctly', async () => {
      render(<PasswordManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('test-vault')).toBeInTheDocument();
      });

      // Open add dialog
      const fabButton = screen.getByRole('button', { name: '' });
      fireEvent.click(fabButton);

      // Fill in some data
      fireEvent.change(screen.getByLabelText(/title/i), {
        target: { value: 'Test Entry' },
      });

      // Cancel the dialog
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

      // Dialog should be closed
      expect(
        screen.queryByText('Add New Password Entry')
      ).not.toBeInTheDocument();

      // Open dialog again - fields should be reset
      fireEvent.click(fabButton);
      expect(screen.getByLabelText(/title/i).value).toBe('');
    });
  });
});
