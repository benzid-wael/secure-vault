import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import VaultRecovery from '../../components/VaultRecovery';

// Mock the electron API
const mockElectronAPI = {
  verifyVaultRecoveryKey: vi.fn(),
  loadVaultWithRecoveryKey: vi.fn(),
  recoverVaultWithOldPassword: vi.fn(),
  loadVault: vi.fn(),
};

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

describe('VaultRecovery', () => {
  const mockOnRecover = vi.fn();
  const mockOnBack = vi.fn();
  const vaultName = 'test-vault';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly with vault name', () => {
    render(
      <VaultRecovery
        vaultName={vaultName}
        onRecover={mockOnRecover}
        onBack={mockOnBack}
      />
    );

    expect(screen.getByText('Recover Vault')).toBeInTheDocument();
    expect(screen.getByText(vaultName)).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: /recovery key/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: /previous password/i })
    ).toBeInTheDocument();
  });

  it('handles recovery key tab correctly', async () => {
    render(
      <VaultRecovery
        vaultName={vaultName}
        onRecover={mockOnRecover}
        onBack={mockOnBack}
      />
    );

    const recoveryKeyInput = screen.getByLabelText('Recovery Key');
    const submitButton = screen.getByText('Recover with Recovery Key');

    // Test input formatting
    fireEvent.change(recoveryKeyInput, {
      target: { value: 'abcd1234efgh5678' },
    });
    expect(recoveryKeyInput.value).toBe('ABCD-1234-EFGH-5678');

    // Test successful recovery
    mockElectronAPI.verifyVaultRecoveryKey.mockResolvedValueOnce({
      success: true,
    });
    mockElectronAPI.loadVaultWithRecoveryKey.mockResolvedValueOnce({
      success: true,
      data: { entries: [] },
    });

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockElectronAPI.verifyVaultRecoveryKey).toHaveBeenCalledWith(
        vaultName,
        'ABCD-1234-EFGH-5678'
      );
      expect(mockOnRecover).toHaveBeenCalledWith(
        { entries: [] },
        'recovery-key',
        undefined
      );
    });
  });

  it('handles previous password tab correctly', async () => {
    render(
      <VaultRecovery
        vaultName={vaultName}
        onRecover={mockOnRecover}
        onBack={mockOnBack}
      />
    );

    // Switch to previous password tab
    const previousPasswordTab = screen.getByText('Previous Password');
    fireEvent.click(previousPasswordTab);

    const passwordInput = screen.getByLabelText('Previous Master Password');
    const submitButton = screen.getByText('Recover with Previous Password');

    fireEvent.change(passwordInput, { target: { value: 'oldpassword123' } });

    // Test successful recovery with old password
    mockElectronAPI.recoverVaultWithOldPassword.mockResolvedValueOnce({
      success: true,
    });
    mockElectronAPI.loadVault.mockResolvedValueOnce({
      success: true,
      data: { entries: [] },
    });

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockElectronAPI.recoverVaultWithOldPassword).toHaveBeenCalledWith(
        vaultName,
        'oldpassword123'
      );
      expect(mockOnRecover).toHaveBeenCalledWith(
        { entries: [] },
        'old-password',
        'oldpassword123'
      );
    });
  });

  it('handles recovery key validation errors', async () => {
    render(
      <VaultRecovery
        vaultName={vaultName}
        onRecover={mockOnRecover}
        onBack={mockOnBack}
      />
    );

    const recoveryKeyInput = screen.getByLabelText('Recovery Key');
    const submitButton = screen.getByText('Recover with Recovery Key');

    fireEvent.change(recoveryKeyInput, { target: { value: 'invalid-key' } });

    mockElectronAPI.verifyVaultRecoveryKey.mockResolvedValueOnce({
      success: false,
      error: 'Invalid recovery key',
    });

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Invalid recovery key')).toBeInTheDocument();
    });
  });

  it('handles old password validation errors', async () => {
    render(
      <VaultRecovery
        vaultName={vaultName}
        onRecover={mockOnRecover}
        onBack={mockOnBack}
      />
    );

    // Switch to previous password tab
    const previousPasswordTab = screen.getByText('Previous Password');
    fireEvent.click(previousPasswordTab);

    const passwordInput = screen.getByLabelText('Previous Master Password');
    const submitButton = screen.getByText('Recover with Previous Password');

    fireEvent.change(passwordInput, { target: { value: 'wrongpassword' } });

    mockElectronAPI.recoverVaultWithOldPassword.mockResolvedValueOnce({
      success: false,
      error: 'Unable to recover vault with this password',
    });

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(
        screen.getByText('Unable to recover vault with this password')
      ).toBeInTheDocument();
    });
  });

  it('handles back button correctly', () => {
    render(
      <VaultRecovery
        vaultName={vaultName}
        onRecover={mockOnRecover}
        onBack={mockOnBack}
      />
    );

    const backButton = screen.getByRole('button', { name: /go back/i });
    fireEvent.click(backButton);

    expect(mockOnBack).toHaveBeenCalled();
  });

  it('shows loading state during recovery', async () => {
    render(
      <VaultRecovery
        vaultName={vaultName}
        onRecover={mockOnRecover}
        onBack={mockOnBack}
      />
    );

    const recoveryKeyInput = screen.getByLabelText('Recovery Key');
    const submitButton = screen.getByText('Recover with Recovery Key');

    fireEvent.change(recoveryKeyInput, {
      target: { value: 'ABCD-1234-EFGH-5678' },
    });

    // Mock a delayed response
    let resolvePromise;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    mockElectronAPI.verifyVaultRecoveryKey.mockReturnValueOnce(promise);

    fireEvent.click(submitButton);

    // Check loading state
    expect(submitButton).toBeDisabled();

    // Resolve the promise
    resolvePromise({ success: false, error: 'Test error' });

    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });
  });

  it('toggles password visibility', () => {
    render(
      <VaultRecovery
        vaultName={vaultName}
        onRecover={mockOnRecover}
        onBack={mockOnBack}
      />
    );

    // Switch to previous password tab
    const previousPasswordTab = screen.getByText('Previous Password');
    fireEvent.click(previousPasswordTab);

    const passwordInput = screen.getByLabelText('Previous Master Password');
    const toggleButton = screen.getByRole('button', {
      name: /toggle password visibility/i,
    });

    expect(passwordInput.type).toBe('password');

    fireEvent.click(toggleButton);
    expect(passwordInput.type).toBe('text');

    fireEvent.click(toggleButton);
    expect(passwordInput.type).toBe('password');
  });
});
