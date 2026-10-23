import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import VaultSelector from '../../components/VaultSelector';

describe('VaultSelector', () => {
  const vaults = ['main', 'work', 'personal'];
  const onVaultSelect = vi.fn();
  const onCreateNew = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders list of vaults', () => {
    render(
      <VaultSelector
        vaults={vaults}
        onVaultSelect={onVaultSelect}
        onCreateNew={onCreateNew}
      />
    );
    expect(screen.getByText('Secure Vault')).toBeInTheDocument();
    vaults.forEach((name) => {
      expect(screen.getAllByText(name)[0]).toBeInTheDocument();
    });
  });

  it('calls onVaultSelect when clicking a vault', () => {
    render(
      <VaultSelector
        vaults={vaults}
        onVaultSelect={onVaultSelect}
        onCreateNew={onCreateNew}
      />
    );
    fireEvent.click(screen.getAllByText('work')[0]);
    expect(onVaultSelect).toHaveBeenCalledWith('work');
  });

  it('calls onCreateNew when clicking Create New Vault', () => {
    render(
      <VaultSelector
        vaults={vaults}
        onVaultSelect={onVaultSelect}
        onCreateNew={onCreateNew}
      />
    );
    fireEvent.click(screen.getByText('Create New Vault'));
    expect(onCreateNew).toHaveBeenCalled();
  });

  it('with no vaults, invites creating the first one', () => {
    render(
      <VaultSelector
        vaults={[]}
        onVaultSelect={onVaultSelect}
        onCreateNew={onCreateNew}
      />
    );
    expect(screen.queryByText('Available Vaults')).not.toBeInTheDocument();
    expect(
      screen.getByText('Create your first vault to get started')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText('Create Your First Vault'));
    expect(onCreateNew).toHaveBeenCalled();
  });

  describe('saved passwords (New-52)', () => {
    it('labels a vault with a saved password, offering no forget while locked', () => {
      render(
        <VaultSelector
          vaults={vaults}
          onVaultSelect={onVaultSelect}
          onCreateNew={onCreateNew}
          remembered={['work']}
        />
      );
      expect(screen.getAllByText('Password saved')).toHaveLength(1);
      // Forgetting happens from the unlocked vault, as for env vaults.
      expect(screen.queryByText(/Forget/)).toBeNull();
    });
  });

  describe('deleting a vault', () => {
    const win = /** @type {any} */ (window);
    let original;
    beforeEach(() => {
      original = win.electronAPI.deleteVault;
    });
    afterEach(() => {
      win.electronAPI.deleteVault = original;
    });

    const openDelete = (onVaultDeleted = vi.fn()) => {
      render(
        <VaultSelector
          vaults={vaults}
          onVaultSelect={onVaultSelect}
          onCreateNew={onCreateNew}
          onVaultDeleted={onVaultDeleted}
        />
      );
      fireEvent.click(screen.getAllByTestId('DeleteIcon')[1].closest('button'));
      return onVaultDeleted;
    };
    const typePassword = (value) =>
      fireEvent.change(
        screen.getByLabelText('Enter vault password to confirm deletion'),
        { target: { value } }
      );
    const confirm = () =>
      fireEvent.click(screen.getByRole('button', { name: 'Delete Vault' }));

    it('asks for the password, without opening the vault', () => {
      openDelete();
      expect(screen.getByText('Delete Vault "work"')).toBeInTheDocument();
      expect(onVaultSelect).not.toHaveBeenCalled();
      expect(
        screen.getByRole('button', { name: 'Delete Vault' })
      ).toBeDisabled();
    });

    it('deletes with the password and reports it', async () => {
      win.electronAPI.deleteVault = vi.fn().mockResolvedValue({
        success: true,
        message: 'Vault "work" has been deleted.',
      });
      const onVaultDeleted = openDelete();
      typePassword('pw');
      confirm();
      await waitFor(() =>
        expect(onVaultDeleted).toHaveBeenCalledWith(
          'work',
          'Vault "work" has been deleted.'
        )
      );
      expect(win.electronAPI.deleteVault).toHaveBeenCalledWith('work', 'pw');
      await waitFor(() =>
        expect(screen.queryByText('Delete Vault "work"')).toBeNull()
      );
    });

    it('shows a refusal and keeps the dialog', async () => {
      win.electronAPI.deleteVault = vi.fn().mockResolvedValue({
        success: false,
        error: 'Invalid password. Vault not deleted.',
      });
      const onVaultDeleted = openDelete();
      typePassword('wrong');
      confirm();
      expect(
        await screen.findByText('Invalid password. Vault not deleted.')
      ).toBeInTheDocument();
      expect(onVaultDeleted).not.toHaveBeenCalled();
    });

    it('says so when the call fails', async () => {
      win.electronAPI.deleteVault = vi.fn().mockRejectedValue(new Error('ipc'));
      openDelete();
      typePassword('pw');
      confirm();
      expect(
        await screen.findByText('Failed to delete vault. Please try again.')
      ).toBeInTheDocument();
    });

    it('cancels', async () => {
      win.electronAPI.deleteVault = vi.fn();
      openDelete();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() =>
        expect(screen.queryByText('Delete Vault "work"')).toBeNull()
      );
      expect(win.electronAPI.deleteVault).not.toHaveBeenCalled();
    });
  });
});
