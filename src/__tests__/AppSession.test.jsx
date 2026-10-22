import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import App from '../App';

// Child components are reduced to the props App hands them, so these tests
// pin down one thing: the master password never lives in renderer state.
const received = {};

vi.mock('../components/VaultSelector', () => ({
  __esModule: true,
  default: ({ onVaultSelect }) => (
    <button onClick={() => onVaultSelect('main')}>select</button>
  ),
}));

vi.mock('../components/VaultLogin', () => ({
  __esModule: true,
  default: ({ onLogin }) => (
    <button onClick={() => onLogin('master-pw')}>login</button>
  ),
}));

vi.mock('../components/PasswordManager', () => ({
  __esModule: true,
  default: (props) => {
    received.passwordManager = props;
    return (
      <div data-testid="password-manager">
        <button onClick={props.onLock}>lock</button>
      </div>
    );
  },
}));

vi.mock('../components/ConfigurationDialog', () => ({
  __esModule: true,
  default: (props) => {
    received.configurationDialog = props;
    return null;
  },
}));

vi.mock('../components/ImportExportDialog', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('../components/CreateVault', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('../components/VaultRecovery', () => ({
  __esModule: true,
  default: () => null,
}));

describe('App vault session', () => {
  let api;
  let vaultLockedCallback;

  beforeEach(() => {
    vaultLockedCallback = null;
    for (const key of Object.keys(received)) delete received[key];
    api = {
      getVaults: vi.fn().mockResolvedValue({ success: true, data: ['main'] }),
      unlockVault: vi.fn().mockResolvedValue({ success: true }),
      lockVault: vi.fn().mockResolvedValue({ success: true }),
      vaultActivity: vi.fn().mockResolvedValue({ success: true }),
      onVaultLocked: vi.fn((cb) => {
        vaultLockedCallback = cb;
      }),
      onMenuNewVault: vi.fn(),
      onMenuOpenVault: vi.fn(),
      onMenuLockVault: vi.fn(),
      onMenuConfiguration: vi.fn(),
      removeAllListeners: vi.fn(),
    };
    // @ts-ignore - test double for the preload bridge
    window.electronAPI = api;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-ignore
    delete window.electronAPI;
  });

  const unlock = async () => {
    render(<App />);
    fireEvent.click(screen.getByText('select'));
    fireEvent.click(screen.getByText('login'));
    await screen.findByTestId('password-manager');
  };

  it('unlocks through the main process and keeps no password in props', async () => {
    await unlock();

    expect(api.unlockVault).toHaveBeenCalledWith('main', 'master-pw');
    expect(received.passwordManager).not.toHaveProperty('vaultPassword');
    expect(received.configurationDialog).not.toHaveProperty('vaultPassword');
    expect(received.configurationDialog.vaultName).toBe('main');
    expect(JSON.stringify(received.passwordManager)).not.toContain('master-pw');
  });

  it('stays on the login view when the main process rejects the password', async () => {
    api.unlockVault.mockResolvedValueOnce({
      success: false,
      error: 'Invalid master password',
    });
    render(<App />);
    fireEvent.click(screen.getByText('select'));
    fireEvent.click(screen.getByText('login'));

    await waitFor(() => expect(api.unlockVault).toHaveBeenCalled());
    expect(screen.queryByTestId('password-manager')).not.toBeInTheDocument();
    expect(screen.getByText('login')).toBeInTheDocument();
  });

  it('closes the main-process session when the user locks', async () => {
    await unlock();
    fireEvent.click(screen.getByText('lock'));

    expect(api.lockVault).toHaveBeenCalled();
    expect(await screen.findByText('select')).toBeInTheDocument();
    expect(received.configurationDialog.vaultName).toBeNull();
  });

  it('returns to the selector when the main process auto-locks', async () => {
    await unlock();
    expect(vaultLockedCallback).toBeTypeOf('function');

    vaultLockedCallback();

    expect(await screen.findByText('select')).toBeInTheDocument();
    expect(screen.queryByTestId('password-manager')).not.toBeInTheDocument();
  });

  it('passes the built-in-password flag from unlock to the manager', async () => {
    api.unlockVault.mockResolvedValueOnce({
      success: true,
      usesDefaultPassword: true,
    });
    await unlock();
    expect(received.passwordManager.usesDefaultPassword).toBe(true);

    // Changing the password clears it.
    act(() => received.passwordManager.onPasswordChanged());
    expect(received.passwordManager.usesDefaultPassword).toBe(false);
  });

  it('does not flag a vault unlocked with its own password', async () => {
    await unlock();
    expect(received.passwordManager.usesDefaultPassword).toBe(false);
  });

  it('says so after an idle lock, until dismissed', async () => {
    await unlock();
    act(() => vaultLockedCallback({ reason: 'idle', minutes: 5 }));

    expect(await screen.findByText('select')).toBeInTheDocument();
    const message = screen.getByText(
      'Vault locked after 5 minutes without activity.'
    );
    // Not dismissed by a click elsewhere: the user was away.
    fireEvent.click(screen.getByText('select'));
    expect(message).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(
        screen.queryByText('Vault locked after 5 minutes without activity.')
      ).toBeNull()
    );
  });

  it('says nothing for other locks (sleep, screen lock)', async () => {
    await unlock();
    act(() => vaultLockedCallback({}));
    expect(await screen.findByText('select')).toBeInTheDocument();
    expect(screen.queryByText(/without activity/)).toBeNull();
  });

  it('reports input while unlocked, at most every 15 s', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    render(<App />);
    fireEvent.keyDown(window, { key: 'a' });
    expect(api.vaultActivity).not.toHaveBeenCalled(); // nothing unlocked yet

    fireEvent.click(screen.getByText('select'));
    fireEvent.click(screen.getByText('login'));
    await screen.findByTestId('password-manager');
    for (const send of [
      () => fireEvent.keyDown(window, { key: 'a' }),
      () => fireEvent.pointerDown(window),
      () => fireEvent.wheel(window),
      () => fireEvent.touchStart(window),
    ]) {
      api.vaultActivity.mockClear();
      now += 15_000;
      send();
      send(); // the same moment: not reported again
      expect(api.vaultActivity).toHaveBeenCalledOnce();
    }
    now += 14_999;
    fireEvent.keyDown(window, { key: 'a' });
    expect(api.vaultActivity).toHaveBeenCalledOnce();

    // Locked: input no longer reported.
    act(() => vaultLockedCallback({}));
    await screen.findByText('select');
    api.vaultActivity.mockClear();
    now += 60_000;
    fireEvent.keyDown(window, { key: 'a' });
    expect(api.vaultActivity).not.toHaveBeenCalled();
  });
});
