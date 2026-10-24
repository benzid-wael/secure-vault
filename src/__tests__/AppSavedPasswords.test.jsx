import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import App from '../App';

// Password vault passwords kept on this computer (GUI-ENV-BREAKDOWN New-52):
// the real selector and login screen, a fake preload bridge.
vi.mock('../components/PasswordManager', () => ({
  __esModule: true,
  default: ({ vaultName, passwordSaved, onForgetPassword }) => (
    <div>
      manager {vaultName}
      {passwordSaved && (
        <button onClick={onForgetPassword}>Forget saved password</button>
      )}
    </div>
  ),
}));
vi.mock('../components/ConfigurationDialog', () => ({
  __esModule: true,
  default: () => null,
}));
vi.mock('../components/ImportExportDialog', () => ({
  __esModule: true,
  default: () => null,
}));

describe('App: saved passwords for password vaults', () => {
  let api;
  let saved;

  beforeEach(() => {
    saved = window.electronAPI;
    api = {
      getVaults: vi
        .fn()
        .mockResolvedValue({ success: true, data: ['work', 'home'] }),
      unlockVault: vi.fn().mockResolvedValue({ success: true }),
      unlockVaultSaved: vi.fn().mockResolvedValue({ success: true }),
      forgetVaultPassword: vi.fn().mockResolvedValue({ success: true }),
      savedPasswords: {
        info: vi.fn().mockResolvedValue({
          success: true,
          available: true,
          count: 1,
          vaults: ['work'],
        }),
      },
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

  const card = async (name) => {
    fireEvent.click(await screen.findByText(name));
  };

  it('opens a vault with its saved password, skipping the login screen', async () => {
    render(<App />);
    expect(await screen.findByText('Password saved')).toBeInTheDocument();
    await card('work');
    expect(await screen.findByText('manager work')).toBeInTheDocument();
    expect(api.unlockVaultSaved).toHaveBeenCalledWith('work');
    expect(api.unlockVault).not.toHaveBeenCalled();
  });

  it('asks for the password, quietly, when Touch ID is canceled', async () => {
    api.unlockVaultSaved.mockResolvedValue({
      success: false,
      code: 'CANCELED',
      error: 'Unlock canceled.',
    });
    render(<App />);
    await screen.findByText('Password saved');
    await card('work');
    expect(await screen.findByLabelText('Master Password')).toBeInTheDocument();
    expect(screen.queryByText('Unlock canceled.')).toBeNull();
    expect(screen.getByLabelText('Remember on this computer')).toBeChecked();
  });

  it('says why when the saved password no longer works', async () => {
    api.unlockVaultSaved.mockResolvedValue({
      success: false,
      code: 'AUTH',
      error: 'The saved password no longer opens work. Type the current one.',
    });
    render(<App />);
    await screen.findByText('Password saved');
    const before = api.savedPasswords.info.mock.calls.length;
    await card('work');
    expect(
      await screen.findByText(
        'The saved password no longer opens work. Type the current one.'
      )
    ).toBeInTheDocument();
    // The list is read again: the dropped password isn't offered next time.
    expect(api.savedPasswords.info.mock.calls.length).toBe(before + 1);
  });

  it('keeps a typed password when asked', async () => {
    render(<App />);
    await screen.findByText('Password saved');
    await card('home');
    expect(api.unlockVaultSaved).not.toHaveBeenCalled();
    const box = await screen.findByLabelText('Remember on this computer');
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    fireEvent.change(screen.getByLabelText('Master Password'), {
      target: { value: 'Vault-Pass-12!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock Vault' }));
    expect(await screen.findByText('manager home')).toBeInTheDocument();
    expect(api.unlockVault).toHaveBeenCalledWith('home', 'Vault-Pass-12!', {
      remember: true,
    });
  });

  it("warns when the keychain wouldn't keep it", async () => {
    api.unlockVault.mockResolvedValue({ success: true, remembered: false });
    render(<App />);
    await screen.findByText('Password saved');
    await card('home');
    fireEvent.click(await screen.findByLabelText('Remember on this computer'));
    fireEvent.change(screen.getByLabelText('Master Password'), {
      target: { value: 'x' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock Vault' }));
    expect(
      await screen.findByText(/the password couldn't be saved on this computer/)
    ).toBeInTheDocument();
  });

  it('offers no forget in the vault list, only in the unlocked vault', async () => {
    render(<App />);
    await screen.findByText('Password saved');
    expect(screen.queryByText(/Forget/)).toBeNull();
    await card('work');
    await screen.findByText('manager work');
    fireEvent.click(
      screen.getByRole('button', { name: 'Forget saved password' })
    );
    await waitFor(() =>
      expect(api.forgetVaultPassword).toHaveBeenCalledWith('work')
    );
    expect(
      await screen.findByText(
        "Forgot the saved password of work. You'll type it the next time you unlock."
      )
    ).toBeInTheDocument();
  });

  it("offers no forget in a vault whose password isn't saved", async () => {
    render(<App />);
    await screen.findByText('Password saved');
    await card('home');
    fireEvent.change(await screen.findByLabelText('Master Password'), {
      target: { value: 'x' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock Vault' }));
    await screen.findByText('manager home');
    expect(
      screen.queryByRole('button', { name: 'Forget saved password' })
    ).toBeNull();
  });

  it.each([
    [
      'a refusal',
      () => ({ success: false, error: 'Vault is locked', locked: true }),
    ],
    ['a failed call', () => Promise.reject(new Error('ipc'))],
  ])('says so when forgetting fails on %s', async (_, outcome) => {
    api.forgetVaultPassword.mockImplementation(async () => outcome());
    render(<App />);
    await screen.findByText('Password saved');
    await card('work');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Forget saved password' })
    );
    expect(
      await screen.findByText("The saved password couldn't be forgotten.")
    ).toBeInTheDocument();
  });

  it('falls back to the login screen when the bridge call throws', async () => {
    api.unlockVaultSaved.mockRejectedValue(new Error('ipc'));
    render(<App />);
    await screen.findByText('Password saved');
    await card('work');
    expect(
      await screen.findByText('Unlock failed. Type the password.')
    ).toBeInTheDocument();
  });

  it('offers nothing where this computer can keep no password', async () => {
    api.savedPasswords.info.mockResolvedValue({
      success: true,
      available: false,
      count: 0,
      vaults: [],
    });
    render(<App />);
    await card('home');
    await screen.findByLabelText('Master Password');
    expect(screen.queryByLabelText('Remember on this computer')).toBeNull();
    fireEvent.change(screen.getByLabelText('Master Password'), {
      target: { value: 'x' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock Vault' }));
    await screen.findByText('manager home');
    expect(api.unlockVault).toHaveBeenCalledWith('home', 'x');
  });
});
