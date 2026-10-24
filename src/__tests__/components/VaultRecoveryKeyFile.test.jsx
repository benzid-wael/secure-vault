// Recovering a vault that uses a key file (New-54, step 5): the recovery
// key, then a new password and what the vault does about its key file.
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import VaultRecovery from '../../components/VaultRecovery';

const win = /** @type {any} */ (window);
const KEY = 'ABCD-EFGH-IJKL-MNOP';
const NEW_PW = 'Fresh-Pass-34!';
let saved;
let api;
let onRecover;

beforeEach(() => {
  saved = win.electronAPI;
  api = {
    verifyVaultRecoveryKey: vi
      .fn()
      .mockResolvedValue({ success: true, keyFile: true }),
    loadVaultWithRecoveryKey: vi.fn(),
    recoverVaultWithKeyFile: vi
      .fn()
      .mockResolvedValue({ success: true, keyFile: 'fresh.svkey' }),
  };
  win.electronAPI = api;
  onRecover = vi.fn();
});
afterEach(() => {
  win.electronAPI = saved;
});

const show = (needsKeyFile = true) =>
  render(
    <VaultRecovery
      vaultName="team"
      needsKeyFile={needsKeyFile}
      onRecover={onRecover}
      onBack={() => {}}
    />
  );

const enterKey = async () => {
  fireEvent.change(screen.getByLabelText('Recovery Key'), {
    target: { value: KEY },
  });
  fireEvent.click(screen.getByText('Recover with Recovery Key'));
  await screen.findByLabelText('New Master Password');
};

const typePasswords = (password = NEW_PW, confirm = password) => {
  fireEvent.change(screen.getByLabelText('New Master Password'), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText('Confirm New Password'), {
    target: { value: confirm },
  });
};
const submit = () =>
  fireEvent.click(
    screen.getByRole('button', { name: 'Set Password and Open' })
  );

describe('VaultRecovery for a vault with a key file', () => {
  it('offers the recovery key only', () => {
    show();
    expect(
      screen.queryByRole('tab', { name: /previous password/i })
    ).toBeNull();
  });

  it('asks for a new password once the recovery key is right, then a new key file', async () => {
    show();
    await enterKey();
    expect(api.loadVaultWithRecoveryKey).not.toHaveBeenCalled();
    expect(screen.getByText(/The recovery key is right/)).toBeInTheDocument();
    typePasswords();
    submit();
    await waitFor(() => expect(onRecover).toHaveBeenCalled());
    expect(api.recoverVaultWithKeyFile).toHaveBeenCalledWith(
      'team',
      KEY,
      NEW_PW,
      { keyFile: 'create' }
    );
    expect(onRecover).toHaveBeenCalledWith(null, 'recovery-key', {
      message:
        'team has a new password and key file (fresh.svkey); the old ones no longer open it.',
      severity: 'success',
    });
  });

  it('moves on even when the page didn’t know the vault had a key file', async () => {
    show(false);
    await enterKey();
    expect(screen.getByLabelText('New Master Password')).toBeInTheDocument();
  });

  it('uses an existing key file, passing on a warning', async () => {
    api.recoverVaultWithKeyFile.mockResolvedValue({
      success: true,
      keyFile: 'spare.svkey',
      warning: 'The key file is in the same folder as the vault.',
    });
    show();
    await enterKey();
    typePasswords();
    fireEvent.click(screen.getByLabelText('Use a key file I already have'));
    submit();
    await waitFor(() =>
      expect(onRecover).toHaveBeenCalledWith(null, 'recovery-key', {
        message:
          'team has a new password and uses spare.svkey; the old ones no longer open it. The key file is in the same folder as the vault.',
        severity: 'warning',
      })
    );
    expect(api.recoverVaultWithKeyFile.mock.calls[0][3]).toEqual({
      keyFile: 'existing',
    });
  });

  it('shows the new recovery key before going on, without a key file', async () => {
    api.recoverVaultWithKeyFile.mockResolvedValue({
      success: true,
      recoveryKey: 'NEWK-EYNE-WKEY',
    });
    show();
    await enterKey();
    typePasswords();
    fireEvent.click(screen.getByLabelText('Stop requiring a key file'));
    expect(screen.getByText(/a new recovery key is made/)).toBeInTheDocument();
    submit();
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    expect(onRecover).toHaveBeenCalledWith(null, 'recovery-key', {
      message: 'team has a new password and no longer needs a key file.',
      severity: 'success',
    });
  });

  it.each([
    [
      'a weak password',
      ['short'],
      'Password must be at least 8 characters long',
    ],
    [
      'passwords that differ',
      [NEW_PW, 'Other-Pass-56!'],
      'The passwords don’t match',
    ],
  ])('refuses %s before asking main', async (_, passwords, message) => {
    show();
    await enterKey();
    typePasswords(...passwords);
    submit();
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(api.recoverVaultWithKeyFile).not.toHaveBeenCalled();
  });

  it('stays quiet on a canceled dialog and says why main refused', async () => {
    api.recoverVaultWithKeyFile
      .mockResolvedValueOnce({ success: false, canceled: true })
      .mockResolvedValueOnce({ success: false, error: 'Invalid recovery key' })
      .mockRejectedValueOnce(new Error('ipc'));
    show();
    await enterKey();
    typePasswords();
    submit();
    await waitFor(() =>
      expect(api.recoverVaultWithKeyFile).toHaveBeenCalledTimes(1)
    );
    expect(screen.queryByRole('alert', { name: /error/i })).toBeNull();
    submit();
    expect(await screen.findByText('Invalid recovery key')).toBeInTheDocument();
    submit();
    expect(
      await screen.findByText('Recovery failed. Try again.')
    ).toBeInTheDocument();
    expect(onRecover).not.toHaveBeenCalled();
  });
});
