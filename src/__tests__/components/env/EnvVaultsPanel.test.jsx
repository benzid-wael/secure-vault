import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import EnvVaultsPanel from '../../../components/env/EnvVaultsPanel';

/** The preload API isn't typed; tests mock it on `window`. */
const win = /** @type {any} */ (window);

const APP = {
  id: 'id-app',
  label: 'app',
  location: '/envs/app.env.vault',
  source: 'appdata',
  exists: true,
  unlocked: false,
};
const GONE = {
  id: 'id-gone',
  label: 'proj/.env.vault',
  location: '/proj/.env.vault',
  source: 'opened',
  exists: false,
  unlocked: false,
};

let api;
let lockedListener;

beforeEach(() => {
  lockedListener = null;
  api = {
    list: vi.fn().mockResolvedValue({ success: true, vaults: [APP, GONE] }),
    open: vi.fn().mockResolvedValue({ success: false, canceled: true }),
    create: vi.fn().mockResolvedValue({ success: true, id: 'id-new' }),
    unlock: vi.fn().mockResolvedValue({ success: true, revision: 'r1' }),
    lock: vi.fn().mockResolvedValue({ success: true }),
    listEnvs: vi.fn().mockResolvedValue({
      success: true,
      revision: 'r1',
      envs: [
        { name: 'dev', varCount: 2 },
        { name: 'prod', varCount: 1 },
      ],
    }),
    createEnv: vi.fn().mockResolvedValue({ success: true, revision: 'r2' }),
    view: vi.fn().mockResolvedValue({
      success: true,
      viewId: 'v1',
      revision: 'r1',
      vars: [],
    }),
    refresh: vi.fn(),
    reveal: vi.fn(),
    closeView: vi.fn().mockResolvedValue({ success: true }),
    commit: vi.fn(),
    activity: vi.fn().mockResolvedValue({ success: true }),
    onLocked: vi.fn((cb) => {
      lockedListener = cb;
      return () => {};
    }),
  };
  win.electronAPI.envVaults = api;
});

afterEach(() => vi.restoreAllMocks());

const unlockApp = async () => {
  render(<EnvVaultsPanel />);
  fireEvent.click(await screen.findByText('app'));
  fireEvent.change(await screen.findByLabelText('Vault Password'), {
    target: { value: 'pw' },
  });
  api.list.mockResolvedValue({
    success: true,
    vaults: [{ ...APP, unlocked: true }, GONE],
  });
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
  await screen.findByText('New environment');
};

describe('EnvVaultsPanel', () => {
  it('reports input on the vault screen only, with its id (New-42)', async () => {
    render(<EnvVaultsPanel />);
    await screen.findByText('app');
    fireEvent.keyDown(window, { key: 'a' });
    expect(api.activity).not.toHaveBeenCalled(); // the list: no vault

    fireEvent.click(screen.getByText('app'));
    fireEvent.change(await screen.findByLabelText('Vault Password'), {
      target: { value: 'pw' },
    });
    api.list.mockResolvedValue({
      success: true,
      vaults: [{ ...APP, unlocked: true }, GONE],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await screen.findByText('New environment');
    fireEvent.pointerDown(window);
    expect(api.activity).toHaveBeenCalledExactlyOnceWith('id-app');

    act(() => lockedListener({ id: 'id-app' }));
    await screen.findByText('/envs/app.env.vault');
    api.activity.mockClear();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
    fireEvent.keyDown(window, { key: 'a' });
    expect(api.activity).not.toHaveBeenCalled();
  });

  it('asks for the password when a vault listed unlocked was locked meanwhile', async () => {
    // The list on screen is older than the click: main locked it since.
    api.list
      .mockResolvedValueOnce({
        success: true,
        vaults: [{ ...APP, unlocked: true }, GONE],
      })
      .mockResolvedValue({ success: true, vaults: [APP, GONE] });
    render(<EnvVaultsPanel />);
    expect(await screen.findByText('Unlocked')).toBeInTheDocument();
    fireEvent.click(screen.getByText('app'));
    expect(await screen.findByLabelText('Vault Password')).toBeInTheDocument();
    expect(screen.queryByText('New environment')).toBeNull();
  });

  it('lists vaults with their location and state', async () => {
    api.list.mockResolvedValue({
      success: true,
      vaults: [{ ...APP, unlocked: true }, GONE],
    });
    render(<EnvVaultsPanel header={<div>SWITCH</div>} />);
    expect(await screen.findByText('app')).toBeInTheDocument();
    expect(screen.getByText('/envs/app.env.vault')).toBeInTheDocument();
    expect(screen.getByText('Unlocked')).toBeInTheDocument();
    expect(screen.getByText('Missing')).toBeInTheDocument();
    expect(screen.getByText('SWITCH')).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    api.list.mockResolvedValue({ success: true, vaults: [] });
    render(<EnvVaultsPanel />);
    expect(
      await screen.findByText(/No environment vaults in the app folder/)
    ).toBeInTheDocument();
  });

  it('shows a list error', async () => {
    api.list.mockResolvedValue({ success: false, error: 'scan failed' });
    render(<EnvVaultsPanel />);
    expect(await screen.findByText('scan failed')).toBeInTheDocument();
  });

  it('does nothing when a missing vault is clicked', async () => {
    render(<EnvVaultsPanel />);
    fireEvent.click(await screen.findByText('proj/.env.vault'));
    expect(screen.queryByLabelText('Vault Password')).toBeNull();
  });

  it('unlocks a vault and shows its environments', async () => {
    await unlockApp();
    expect(api.unlock).toHaveBeenCalledWith('id-app', 'pw');
    expect(api.listEnvs).toHaveBeenCalledWith('id-app');
    expect(await screen.findByText('prod')).toBeInTheDocument();
    // The first env is opened in the view.
    await waitFor(() => expect(api.view).toHaveBeenCalledWith('id-app', 'dev'));
    fireEvent.click(screen.getByText('prod'));
    await waitFor(() =>
      expect(api.view).toHaveBeenCalledWith('id-app', 'prod')
    );
  });

  it('enters an already unlocked vault without a password', async () => {
    api.list.mockResolvedValue({
      success: true,
      vaults: [{ ...APP, unlocked: true }],
    });
    render(<EnvVaultsPanel />);
    fireEvent.click(await screen.findByText('app'));
    expect(await screen.findByText('New environment')).toBeInTheDocument();
    expect(api.unlock).not.toHaveBeenCalled();
  });

  it('shows a wrong-password error and stays on the dialog', async () => {
    api.unlock.mockResolvedValue({
      success: false,
      code: 'AUTH',
      error: 'wrong password',
    });
    render(<EnvVaultsPanel />);
    fireEvent.click(await screen.findByText('app'));
    fireEvent.change(await screen.findByLabelText('Vault Password'), {
      target: { value: 'bad' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('wrong password')).toBeInTheDocument();
    expect(screen.queryByText('New environment')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByLabelText('Vault Password')).toBeNull()
    );
  });

  it('refuses mismatched passwords on create without calling main', async () => {
    render(<EnvVaultsPanel />);
    fireEvent.click(await screen.findByText('New…'));
    fireEvent.change(await screen.findByLabelText('Vault Name'), {
      target: { value: 'fresh' },
    });
    fireEvent.change(screen.getByLabelText('Vault Password'), {
      target: { value: 'a' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'b' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(
      await screen.findByText('The passwords do not match')
    ).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();
  });

  it('creates a vault in the app folder and opens it', async () => {
    render(<EnvVaultsPanel />);
    fireEvent.click(await screen.findByText('New…'));
    fireEvent.change(await screen.findByLabelText('Vault Name'), {
      target: { value: 'fresh' },
    });
    fireEvent.change(screen.getByLabelText('Vault Password'), {
      target: { value: 'Pw-1234567!' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'Pw-1234567!' },
    });
    api.list.mockResolvedValue({
      success: true,
      vaults: [{ ...APP, id: 'id-new', label: 'fresh', unlocked: true }],
    });
    api.listEnvs.mockResolvedValue({ success: true, revision: 'r', envs: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith(
        { mode: 'appdata', name: 'fresh' },
        'Pw-1234567!'
      )
    );
    expect(
      await screen.findByText(/This vault has no environments yet/)
    ).toBeInTheDocument();
  });

  it('does nothing when Open… is canceled', async () => {
    render(<EnvVaultsPanel />);
    fireEvent.click(await screen.findByText('Open…'));
    await waitFor(() => expect(api.open).toHaveBeenCalled());
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Vault Password')).toBeNull();
  });

  it('shows an Open… error', async () => {
    api.open.mockResolvedValue({
      success: false,
      code: 'INVALID',
      error: 'not an environment vault',
    });
    render(<EnvVaultsPanel />);
    fireEvent.click(await screen.findByText('Open…'));
    expect(
      await screen.findByText('not an environment vault')
    ).toBeInTheDocument();
  });

  it('asks for the password of a vault picked in Open…', async () => {
    api.open.mockResolvedValue({ success: true, id: 'id-app' });
    render(<EnvVaultsPanel />);
    fireEvent.click(await screen.findByText('Open…'));
    expect(await screen.findByLabelText('Vault Password')).toBeInTheDocument();
    expect(screen.getByText('Unlock app')).toBeInTheDocument();
  });

  it('locks the open vault and returns to the list', async () => {
    await unlockApp();
    fireEvent.click(screen.getByRole('button', { name: 'Lock' }));
    await waitFor(() => expect(api.lock).toHaveBeenCalledWith('id-app'));
    expect(await screen.findByText('Environment Vaults')).toBeInTheDocument();
  });

  it('goes back to the list without locking', async () => {
    await unlockApp();
    fireEvent.click(screen.getByRole('button', { name: 'Vaults' }));
    expect(await screen.findByText('Environment Vaults')).toBeInTheDocument();
    expect(api.lock).not.toHaveBeenCalled();
  });

  it('returns to the list when main locks the open vault', async () => {
    await unlockApp();
    await act(async () => lockedListener({ id: 'id-app' }));
    expect(
      await screen.findByText('The vault was locked.')
    ).toBeInTheDocument();
    expect(screen.queryByText('New environment')).toBeNull();
  });

  it('only refreshes the list when another vault is locked', async () => {
    await unlockApp();
    const calls = api.list.mock.calls.length;
    await act(async () => lockedListener({ id: 'id-other' }));
    expect(screen.getByText('New environment')).toBeInTheDocument();
    expect(api.list.mock.calls.length).toBe(calls + 1);
  });

  it('returns to the list when listEnvs reports LOCKED', async () => {
    api.listEnvs.mockResolvedValue({ success: false, code: 'LOCKED' });
    await unlockApp().catch(() => {});
    expect(
      await screen.findByText('The vault was locked.')
    ).toBeInTheDocument();
  });

  it('shows a listEnvs error', async () => {
    api.listEnvs.mockResolvedValue({ success: false, error: 'read failed' });
    api.list.mockResolvedValue({
      success: true,
      vaults: [{ ...APP, unlocked: true }],
    });
    render(<EnvVaultsPanel />);
    fireEvent.click(await screen.findByText('app'));
    expect(await screen.findByText('read failed')).toBeInTheDocument();
  });

  it('creates an environment against the listed revision', async () => {
    await unlockApp();
    fireEvent.click(screen.getByText('New environment'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Environment Name'), {
      target: { value: ' staging ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(api.createEnv).toHaveBeenCalledWith('id-app', 'staging', 'r1')
    );
    await waitFor(() =>
      expect(api.view).toHaveBeenCalledWith('id-app', 'staging')
    );
  });

  it('reloads the list when creating an environment is STALE', async () => {
    api.createEnv.mockResolvedValue({ success: false, code: 'STALE' });
    await unlockApp();
    const loads = api.listEnvs.mock.calls.length;
    fireEvent.click(screen.getByText('New environment'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Environment Name'), {
      target: { value: 'staging' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(
      await screen.findByText(/changed elsewhere; the list is reloaded/)
    ).toBeInTheDocument();
    expect(api.listEnvs.mock.calls.length).toBe(loads + 1);
  });

  it('returns to the list when creating an environment reports LOCKED', async () => {
    api.createEnv.mockResolvedValue({ success: false, code: 'LOCKED' });
    await unlockApp();
    fireEvent.click(screen.getByText('New environment'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Environment Name'), {
      target: { value: 'staging' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(
      await screen.findByText('The vault was locked.')
    ).toBeInTheDocument();
  });

  it('cancels the new environment dialog', async () => {
    await unlockApp();
    fireEvent.click(screen.getByText('New environment'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.createEnv).not.toHaveBeenCalled();
  });
});
