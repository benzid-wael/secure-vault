import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import App from '../App';

// Unlocking a vault that uses a key file (New-54, step 3): the real login
// screen, a fake preload bridge. Main asks for the key file in a dialog.
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

describe('App: a vault with a key file', () => {
  let api;
  let saved;

  beforeEach(() => {
    saved = window.electronAPI;
    api = {
      getVaults: vi.fn().mockResolvedValue({
        success: true,
        data: ['team', 'home'],
        opened: [],
        keyFile: ['team'],
      }),
      unlockVault: vi.fn().mockResolvedValue({ success: true }),
      unlockVaultWithKeyFile: vi.fn().mockResolvedValue({ success: true }),
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

  const login = async (name, password = 'pw') => {
    fireEvent.click(await screen.findByText(name));
    fireEvent.change(await screen.findByLabelText('Master Password'), {
      target: { value: password },
    });
  };

  it('asks for the key file after the password', async () => {
    render(<App />);
    await login('team');
    expect(
      screen.getByText(/This vault also needs its key file/)
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose Key File and Unlock' })
    );
    expect(await screen.findByText('manager team')).toBeInTheDocument();
    expect(api.unlockVaultWithKeyFile).toHaveBeenCalledWith('team', 'pw', {});
    expect(api.unlockVault).not.toHaveBeenCalled();
  });

  it('stays quiet when the key file dialog is canceled', async () => {
    api.unlockVaultWithKeyFile.mockResolvedValue({
      success: false,
      canceled: true,
    });
    render(<App />);
    await login('team');
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose Key File and Unlock' })
    );
    await waitFor(() => expect(api.unlockVaultWithKeyFile).toHaveBeenCalled());
    expect(screen.getByLabelText('Master Password')).toBeInTheDocument();
    expect(screen.queryByText(/Invalid/)).toBeNull();
  });

  it('says why a key file is refused', async () => {
    api.unlockVaultWithKeyFile.mockResolvedValue({
      success: false,
      code: 'KEY_FILE',
      error: "This key file isn't the one this vault uses.",
    });
    render(<App />);
    await login('team');
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose Key File and Unlock' })
    );
    expect(
      await screen.findByText("This key file isn't the one this vault uses.")
    ).toBeInTheDocument();
  });

  it('switches to the key file when main says the vault needs one', async () => {
    api.unlockVault.mockResolvedValue({
      success: false,
      code: 'KEY_FILE_REQUIRED',
      error: 'This vault needs its key file as well as its password.',
    });
    render(<App />);
    await login('home');
    expect(
      screen.getByRole('button', { name: 'Unlock Vault' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unlock Vault' }));
    expect(
      await screen.findByRole('button', { name: 'Choose Key File and Unlock' })
    ).toBeInTheDocument();
    expect(screen.queryByText(/needs its key file as well/)).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose Key File and Unlock' })
    );
    expect(await screen.findByText('manager home')).toBeInTheDocument();
    expect(api.unlockVaultWithKeyFile).toHaveBeenCalledWith('home', 'pw', {});
  });
});
