import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import Settings from '../../components/Settings';

// window.electronAPI is mocked globally in setupTests via vi.fn()

describe('Settings', () => {
  const baseProps = {
    vaultName: 'myvault',
    vaultPassword: 'currentPass',
    onBack: vi.fn(),
    onPasswordChanged: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.mockElectronAPI.loadVault.mockResolvedValue({
      success: true,
      data: { created: new Date().toISOString(), entries: [], settings: {} },
    });
    global.mockElectronAPI.hasVaultBackup.mockResolvedValue({
      success: true,
      hasBackup: true,
    });
    global.mockElectronAPI.restoreVaultBackup.mockResolvedValue({
      success: true,
    });
    global.mockElectronAPI.changeMasterPassword.mockResolvedValue({
      success: true,
    });
    global.mockElectronAPI.updateVaultSettings.mockResolvedValue({
      success: true,
    });
  });

  it('loads vault info and shows restore backup option', async () => {
    render(<Settings {...baseProps} />);

    // Wait for loading to finish and for restore info to appear
    expect(await screen.findByText(/Security Settings/i)).toBeInTheDocument();
    expect(screen.getByText(/Restore from Backup/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Restore from Backup/i));
    await waitFor(() =>
      expect(global.mockElectronAPI.restoreVaultBackup).toHaveBeenCalledWith(
        'myvault'
      )
    );
  });

  it('opens change password dialog and validates client-side', async () => {
    render(<Settings {...baseProps} />);
    await screen.findByText(/Security Settings/i);

    // Open the dialog
    fireEvent.click(
      screen.getByRole('button', { name: /Change Master Password/i })
    );

    // Wait for dialog to be in the document and get the dialog element
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();

    // Get all password inputs within the dialog
    const passwordInputs = within(dialog).getAllByLabelText(/password/i, {
      selector: 'input',
    });
    const [currentPasswordInput, newPasswordInput, confirmPasswordInput] =
      passwordInputs;

    // Find submit button by role and name
    const submitButton = within(dialog).getByRole('button', {
      name: /change password/i,
    });

    // Test empty submission
    fireEvent.click(submitButton);
    expect(
      await screen.findByText(/Current password is required/i)
    ).toBeInTheDocument();

    // Test mismatched passwords
    fireEvent.change(currentPasswordInput, {
      target: { value: 'currentPass' },
    });
    fireEvent.change(newPasswordInput, { target: { value: 'NewStrong123!' } });
    fireEvent.change(confirmPasswordInput, { target: { value: 'Mismatch' } });
    fireEvent.click(submitButton);
    expect(
      await screen.findByText(/Passwords do not match/i)
    ).toBeInTheDocument();

    // Test successful submission
    global.mockElectronAPI.changeMasterPassword.mockResolvedValueOnce({
      success: true,
    });
    fireEvent.change(confirmPasswordInput, {
      target: { value: 'NewStrong123!' },
    });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(global.mockElectronAPI.changeMasterPassword).toHaveBeenCalledWith(
        'myvault',
        'currentPass',
        'NewStrong123!'
      );
    });
  });

  it('updates settings toggles and numeric inputs', async () => {
    render(<Settings {...baseProps} />);
    await screen.findByText(/Security Settings/i);

    // Toggle switches
    const toggles = screen.getAllByRole('checkbox');
    fireEvent.click(toggles[0]);
    fireEvent.click(toggles[1]);

    // Change numbers
    const numberInputs = screen.getAllByRole('spinbutton');
    fireEvent.change(numberInputs[0], { target: { value: '45' } });
    fireEvent.change(numberInputs[1], { target: { value: '5' } });

    await waitFor(() =>
      expect(global.mockElectronAPI.updateVaultSettings).toHaveBeenCalled()
    );
  });
});
