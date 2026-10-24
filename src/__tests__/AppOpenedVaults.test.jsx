import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import App from '../App';

// Password vaults opened from another folder (GUI-ENV-BREAKDOWN New-53):
// the real selector and login screen, a fake preload bridge.
vi.mock('../components/PasswordManager', () => ({
  __esModule: true,
  default: ({ vaultName }) => <div>manager {vaultName}</div>,
}));
vi.mock('../components/ConfigurationDialog', () => ({
  __esModule: true,
  default: () => null,
}));
vi.mock('../components/ImportExportDialog', () => ({
  __esModule: true,
  default: () => null,
}));

const TEAM = { name: 'team', location: '/shared/team.vault', exists: true };

describe('App: password vaults opened from another folder', () => {
  let api;
  let saved;
  let listed;

  beforeEach(() => {
    saved = window.electronAPI;
    listed = { success: true, data: ['work', 'team'], opened: [TEAM] };
    api = {
      getVaults: vi.fn(async () => listed),
      openVaultFile: vi.fn().mockResolvedValue({ success: true, name: 'team' }),
      removeVault: vi
        .fn()
        .mockResolvedValue({ success: true, location: TEAM.location }),
      unlockVault: vi.fn().mockResolvedValue({ success: true }),
      lockVault: vi.fn().mockResolvedValue({ success: true }),
      onVaultLocked: vi.fn(),
      onMenuNewVault: vi.fn(),
      onMenuOpenVault: vi.fn(),
      onMenuImportVault: vi.fn(),
      onMenuLockVault: vi.fn(),
      onMenuConfiguration: vi.fn(),
      removeAllListeners: vi.fn(),
    };
    window.electronAPI = api;
  });

  afterEach(() => {
    window.electronAPI = saved;
  });

  it('shows where an opened vault lives, and offers removal instead of delete', async () => {
    render(<App />);
    expect(await screen.findByText('/shared/team.vault')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove team from the list' })
    ).toBeInTheDocument();
    // Only the app-folder vault keeps its delete button.
    expect(screen.getAllByTestId('DeleteIcon')).toHaveLength(1);
  });

  it('opens a file, then asks for its password', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open…' }));
    expect(await screen.findByLabelText('Master Password')).toBeInTheDocument();
    expect(screen.getByText('team')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Master Password'), {
      target: { value: 'pw' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock Vault' }));
    expect(await screen.findByText('manager team')).toBeInTheDocument();
    expect(api.unlockVault).toHaveBeenCalledWith('team', 'pw');
  });

  it('does nothing when the dialog is canceled', async () => {
    api.openVaultFile.mockResolvedValue({ success: false, canceled: true });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open…' }));
    await waitFor(() => expect(api.openVaultFile).toHaveBeenCalled());
    expect(screen.getByText('Available Vaults')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    [
      'a refusal',
      () =>
        api.openVaultFile.mockResolvedValue({
          success: false,
          code: 'INVALID',
          error: '.env.vault is an environment vault, not a password vault.',
        }),
      '.env.vault is an environment vault, not a password vault.',
    ],
    [
      'a failed call',
      () => api.openVaultFile.mockRejectedValue(new Error('ipc')),
      "The vault file couldn't be opened.",
    ],
  ])('says why on %s', async (_, arrange, message) => {
    arrange();
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open…' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('removes an opened vault from the list, saying where its file stays', async () => {
    render(<App />);
    listed = { success: true, data: ['work'], opened: [] };
    fireEvent.click(
      await screen.findByRole('button', { name: 'Remove team from the list' })
    );
    expect(
      await screen.findByText(
        'Removed team from the list. Its file stays at /shared/team.vault.'
      )
    ).toBeInTheDocument();
    expect(api.removeVault).toHaveBeenCalledWith('team');
    await waitFor(() => expect(screen.queryByText('team')).toBeNull());
  });

  it.each([
    [
      'a refusal',
      () =>
        api.removeVault.mockResolvedValue({
          success: false,
          error: 'Lock the vault before removing it from the list',
        }),
      'Lock the vault before removing it from the list',
    ],
    [
      'a failed call',
      () => api.removeVault.mockRejectedValue(new Error('ipc')),
      "The vault couldn't be removed from the list.",
    ],
  ])('says why a removal failed on %s', async (_, arrange, message) => {
    arrange();
    render(<App />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Remove team from the list' })
    );
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it("marks a vault whose file is gone, and doesn't open it", async () => {
    listed = {
      success: true,
      data: ['work', 'team'],
      opened: [{ ...TEAM, exists: false }],
    };
    render(<App />);
    expect(await screen.findByText('Missing')).toBeInTheDocument();
    fireEvent.click(screen.getByText('team'));
    expect(screen.queryByLabelText('Master Password')).toBeNull();
  });

  it('offers no Open… without the bridge method', async () => {
    delete api.openVaultFile;
    render(<App />);
    await screen.findByText('/shared/team.vault');
    expect(screen.queryByRole('button', { name: 'Open…' })).toBeNull();
  });
});
