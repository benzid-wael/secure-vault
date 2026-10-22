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

// App's view routing for the password-vault flows (create, recovery, delete,
// menus, import). Children are reduced to buttons that call the props App
// hands them.
const received = {};

vi.mock('../components/VaultSelector', () => ({
  __esModule: true,
  default: ({ onVaultSelect, onCreateNew, onVaultDeleted }) => (
    <div>
      <span>selector</span>
      <button onClick={() => onVaultSelect('main')}>select</button>
      <button onClick={onCreateNew}>new</button>
      <button onClick={() => onVaultDeleted('main', 'Vault deleted')}>
        deleted
      </button>
    </div>
  ),
}));

vi.mock('../components/VaultLogin', () => ({
  __esModule: true,
  default: ({ onLogin, onBack, onRecovery }) => (
    <div>
      <span>login view</span>
      <button
        onClick={async () => {
          received.login = await onLogin('pw');
        }}
      >
        login
      </button>
      <button onClick={onBack}>back</button>
      <button onClick={onRecovery}>recover</button>
    </div>
  ),
}));

vi.mock('../components/CreateVault', () => ({
  __esModule: true,
  default: ({ onCreateVault, onBack }) => (
    <div>
      <span>create view</span>
      <button
        onClick={async () => {
          received.create = await onCreateVault('fresh', 'pw');
        }}
      >
        create
      </button>
      <button onClick={onBack}>back</button>
    </div>
  ),
}));

vi.mock('../components/VaultRecovery', () => ({
  __esModule: true,
  default: ({ onRecover, onBack }) => (
    <div>
      <span>recovery view</span>
      <button onClick={() => onRecover({}, 'recovery-key')}>recovered</button>
      <button onClick={onBack}>back</button>
    </div>
  ),
}));

vi.mock('../components/PasswordManager', () => ({
  __esModule: true,
  default: ({ vaultName }) => <div>manager {vaultName}</div>,
}));

vi.mock('../components/ConfigurationDialog', () => ({
  __esModule: true,
  default: ({ open, onClose }) =>
    open ? <button onClick={onClose}>config open</button> : null,
}));

vi.mock('../components/ImportExportDialog', () => ({
  __esModule: true,
  default: ({ open, onImportSuccess }) =>
    open ? <button onClick={onImportSuccess}>import open</button> : null,
}));

describe('App flows', () => {
  let api;
  const menu = {};

  beforeEach(() => {
    for (const key of Object.keys(received)) delete received[key];
    const on = (name) => vi.fn((cb) => (menu[name] = cb));
    api = {
      getVaults: vi.fn().mockResolvedValue({ success: true, data: ['main'] }),
      unlockVault: vi.fn().mockResolvedValue({ success: true }),
      createVault: vi
        .fn()
        .mockResolvedValue({ success: true, recoveryKey: 'RK' }),
      lockVault: vi.fn().mockResolvedValue({ success: true }),
      onVaultLocked: vi.fn(),
      onMenuNewVault: on('new'),
      onMenuOpenVault: on('open'),
      onMenuImportVault: on('import'),
      onMenuLockVault: on('lock'),
      onMenuConfiguration: on('config'),
      removeAllListeners: vi.fn(),
    };
    // @ts-ignore - test double for the preload bridge
    window.electronAPI = api;
  });

  afterEach(() => {
    // @ts-ignore
    delete window.electronAPI;
  });

  it('creates a vault and opens the manager', async () => {
    render(<App />);
    fireEvent.click(screen.getByText('new'));
    fireEvent.click(await screen.findByText('create'));
    expect(await screen.findByText('manager fresh')).toBeInTheDocument();
    expect(api.createVault).toHaveBeenCalledWith('fresh', 'pw');
    expect(received.create).toMatchObject({ success: true, recoveryKey: 'RK' });
  });

  it('reports a failed create', async () => {
    api.createVault.mockResolvedValue({ success: false, error: 'taken' });
    render(<App />);
    fireEvent.click(screen.getByText('new'));
    fireEvent.click(await screen.findByText('create'));
    await waitFor(() =>
      expect(received.create).toEqual({ success: false, error: 'taken' })
    );
  });

  it('reports a create that throws', async () => {
    api.createVault.mockRejectedValue(new Error('ipc'));
    render(<App />);
    fireEvent.click(screen.getByText('new'));
    fireEvent.click(await screen.findByText('create'));
    await waitFor(() =>
      expect(received.create).toEqual({
        success: false,
        error: 'Failed to create vault',
      })
    );
  });

  it('reports an unlock that throws', async () => {
    api.unlockVault.mockRejectedValue(new Error('ipc'));
    render(<App />);
    fireEvent.click(screen.getByText('select'));
    fireEvent.click(await screen.findByText('login'));
    await waitFor(() =>
      expect(received.login).toEqual({
        success: false,
        error: 'Authentication failed',
      })
    );
  });

  it('goes back from login and create to the selector', async () => {
    render(<App />);
    fireEvent.click(screen.getByText('select'));
    fireEvent.click(await screen.findByText('back'));
    expect(await screen.findByText('selector')).toBeInTheDocument();
    fireEvent.click(screen.getByText('new'));
    fireEvent.click(await screen.findByText('back'));
    expect(await screen.findByText('selector')).toBeInTheDocument();
  });

  it('recovers a vault into the manager', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    render(<App />);
    fireEvent.click(screen.getByText('select'));
    fireEvent.click(await screen.findByText('recover'));
    fireEvent.click(await screen.findByText('recovered'));
    expect(await screen.findByText('manager main')).toBeInTheDocument();
  });

  it('refreshes the list and shows a message after a delete', async () => {
    render(<App />);
    await waitFor(() => expect(api.getVaults).toHaveBeenCalled());
    const calls = api.getVaults.mock.calls.length;
    fireEvent.click(screen.getByText('deleted'));
    expect(await screen.findByText('Vault deleted')).toBeInTheDocument();
    expect(api.getVaults.mock.calls.length).toBeGreaterThan(calls);
  });

  it('opens views and dialogs from the menu', async () => {
    render(<App />);
    await act(async () => menu.new());
    expect(await screen.findByText('create view')).toBeInTheDocument();

    await act(async () => menu.config());
    fireEvent.click(await screen.findByText('config open'));
    await waitFor(() => expect(screen.queryByText('config open')).toBeNull());

    await act(async () => menu.import());
    fireEvent.click(await screen.findByText('import open'));
    expect(
      await screen.findByText('Vault imported successfully')
    ).toBeInTheDocument();

    await act(async () => menu.open());
    expect(await screen.findByText('selector')).toBeInTheDocument();
    expect(api.lockVault).toHaveBeenCalled();

    await act(async () => menu.lock());
    expect(api.lockVault).toHaveBeenCalledTimes(2);
  });

  it('opens the configuration dialog on Ctrl+S', async () => {
    render(<App />);
    fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    expect(await screen.findByText('config open')).toBeInTheDocument();
  });

  it('shows no vaults when listing fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    api.getVaults.mockResolvedValue({ success: false, error: 'scan' });
    render(<App />);
    await waitFor(() => expect(console.error).toHaveBeenCalled());
    api.getVaults.mockRejectedValue(new Error('ipc'));
    await act(async () => menu.open());
    await waitFor(() => expect(api.getVaults).toHaveBeenCalledTimes(2));
  });
});
