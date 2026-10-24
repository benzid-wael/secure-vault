// The vault's key file in Settings (New-54, step 3).
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import KeyFileSection from '../../components/KeyFileSection';

const win = /** @type {any} */ (window);
let saved;
let api;
let onRecoveryKey;
let onMessage;

beforeEach(() => {
  saved = win.electronAPI;
  api = {
    status: vi.fn().mockResolvedValue({ success: true, enabled: false }),
    enable: vi.fn().mockResolvedValue({ success: true, keyFile: 'team.svkey' }),
    change: vi.fn().mockResolvedValue({ success: true, keyFile: 'new.svkey' }),
    disable: vi
      .fn()
      .mockResolvedValue({ success: true, recoveryKey: 'NEW-RECOVERY-KEY' }),
  };
  win.electronAPI = { ...saved, keyFile: api };
  onRecoveryKey = vi.fn();
  onMessage = vi.fn();
});
afterEach(() => {
  win.electronAPI = saved;
});

const show = () =>
  render(
    <KeyFileSection
      vaultName="team"
      onRecoveryKey={onRecoveryKey}
      onMessage={onMessage}
    />
  );
const typePassword = (value = 'Vault-Pass-12!') =>
  fireEvent.change(screen.getByLabelText('Master Password'), {
    target: { value },
  });

describe('KeyFileSection', () => {
  it('turns a key file on, creating one by default', async () => {
    show();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Require a Key File…' })
    );
    expect(
      screen.getByRole('button', { name: 'Require Key File' })
    ).toBeDisabled();
    typePassword();
    api.status.mockResolvedValue({ success: true, enabled: true });
    fireEvent.click(screen.getByRole('button', { name: 'Require Key File' }));
    await waitFor(() =>
      expect(onMessage).toHaveBeenCalledWith(
        'team now needs its key file (team.svkey) as well as its password.',
        'success'
      )
    );
    expect(api.enable).toHaveBeenCalledWith('team', 'Vault-Pass-12!', {
      create: true,
    });
    expect(
      await screen.findByRole('button', { name: 'Change Key File…' })
    ).toBeInTheDocument();
    expect(onRecoveryKey).not.toHaveBeenCalled();
  });

  it('uses an existing key file, and shows a new recovery key and a warning', async () => {
    api.enable.mockResolvedValue({
      success: true,
      keyFile: 'shared.svkey',
      recoveryKey: 'ABCD-EFGH',
      warning: 'The key file is in the same folder as the vault.',
    });
    show();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Require a Key File…' })
    );
    typePassword();
    fireEvent.click(screen.getByLabelText('Use a key file I already have'));
    fireEvent.click(screen.getByRole('button', { name: 'Require Key File' }));
    await waitFor(() =>
      expect(onRecoveryKey).toHaveBeenCalledWith('ABCD-EFGH')
    );
    expect(api.enable).toHaveBeenCalledWith('team', 'Vault-Pass-12!', {
      create: false,
    });
    expect(onMessage).toHaveBeenCalledWith(
      'team now needs its key file (shared.svkey) as well as its password. The key file is in the same folder as the vault.',
      'warning'
    );
  });

  it('keeps the dialog open: quietly when canceled, with the reason when refused', async () => {
    api.enable.mockResolvedValueOnce({ success: false, canceled: true });
    api.enable.mockResolvedValueOnce({
      success: false,
      code: 'AUTH',
      error: 'Invalid master password',
    });
    api.enable.mockRejectedValueOnce(new Error('ipc'));
    show();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Require a Key File…' })
    );
    typePassword();
    const submit = () =>
      fireEvent.click(screen.getByRole('button', { name: 'Require Key File' }));
    submit();
    await waitFor(() => expect(api.enable).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
    submit();
    expect(
      await screen.findByText('Invalid master password')
    ).toBeInTheDocument();
    submit();
    expect(
      await screen.findByText('Something went wrong. Try again.')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByText('Require a key file')).toBeNull()
    );
    expect(onMessage).not.toHaveBeenCalled();
  });

  describe('with a key file on', () => {
    beforeEach(() => {
      api.status.mockResolvedValue({ success: true, enabled: true });
    });

    it('changes the key file', async () => {
      show();
      fireEvent.click(
        await screen.findByRole('button', { name: 'Change Key File…' })
      );
      expect(
        screen.getByText(/You’ll choose the current key file first/)
      ).toBeInTheDocument();
      typePassword();
      fireEvent.click(screen.getByRole('button', { name: 'Change Key File' }));
      await waitFor(() =>
        expect(onMessage).toHaveBeenCalledWith(
          'team now uses new.svkey; the old key file no longer opens it.',
          'success'
        )
      );
      expect(api.change).toHaveBeenCalledWith('team', 'Vault-Pass-12!', {
        create: true,
      });
    });

    it('stops requiring it, and shows the new recovery key', async () => {
      show();
      fireEvent.click(
        await screen.findByRole('button', {
          name: 'Stop Requiring a Key File…',
        })
      );
      expect(screen.queryByLabelText('Create a new key file')).toBeNull();
      typePassword();
      api.status.mockResolvedValue({ success: true, enabled: false });
      fireEvent.click(
        screen.getByRole('button', { name: 'Stop Requiring It' })
      );
      await waitFor(() =>
        expect(onRecoveryKey).toHaveBeenCalledWith('NEW-RECOVERY-KEY')
      );
      expect(api.disable).toHaveBeenCalledWith('team', 'Vault-Pass-12!');
      expect(onMessage).toHaveBeenCalledWith(
        'team no longer needs a key file.',
        'success'
      );
      expect(
        await screen.findByRole('button', { name: 'Require a Key File…' })
      ).toBeInTheDocument();
    });
  });

  it.each([
    ['a failed status', () => api.status.mockResolvedValue({ success: false })],
    ['a throwing status', () => api.status.mockRejectedValue(new Error('x'))],
    ['no bridge', () => delete win.electronAPI.keyFile],
  ])('shows nothing on %s', async (_, arrange) => {
    arrange();
    const { container } = show();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
