// The app settings in the Configuration dialog (GUI-ENV-BREAKDOWN Tasks 13,
// 23).
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import AppSettingsSection from '../../components/AppSettingsSection';
import ConfigurationDialog from '../../components/ConfigurationDialog';

const win = /** @type {any} */ (window);
let saved;
let api;
let keptApi;

beforeEach(() => {
  saved = win.electronAPI;
  let current = {
    idleMinutes: 5,
    rememberRecents: true,
    envVaultExtensions: ['vault'],
  };
  api = {
    get: vi.fn(async () => ({ success: true, settings: current, warning: '' })),
    update: vi.fn(async (patch) => {
      current = { ...current, ...patch };
      return { success: true, settings: current };
    }),
  };
  keptApi = {
    info: vi.fn(async () => ({
      success: true,
      available: true,
      count: 2,
      vaults: ['work'],
    })),
    forgetAll: vi.fn(async () => ({ success: true, count: 2 })),
  };
  win.electronAPI = {
    ...saved,
    appSettings: api,
    savedPasswords: keptApi,
    getVaultDirectory: vi.fn(async () => ({ success: true, path: '/v' })),
  };
});
afterEach(() => {
  win.electronAPI = saved;
});

const pickIdle = async (label) => {
  fireEvent.mouseDown(await screen.findByRole('combobox'));
  fireEvent.click(within(screen.getByRole('listbox')).getByText(label));
};

describe('AppSettingsSection', () => {
  it('shows the saved settings', async () => {
    render(<AppSettingsSection envVaults />);
    expect(await screen.findByText('App settings')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveTextContent(
      '5 minutes without activity'
    );
    expect(
      screen.getByLabelText('Remember environment vaults I open')
    ).toBeChecked();
  });

  it('saves a new idle time at once and says what it does', async () => {
    render(<AppSettingsSection />);
    await pickIdle('30 minutes without activity');
    expect(api.update).toHaveBeenCalledWith({ idleMinutes: 30 });
    expect(
      await screen.findByText(
        'Unlocked vaults now lock after 30 minutes without activity.'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveTextContent('30 minutes');
  });

  it('turning remembering off says the list was cleared', async () => {
    render(<AppSettingsSection envVaults />);
    fireEvent.click(
      await screen.findByLabelText('Remember environment vaults I open')
    );
    expect(api.update).toHaveBeenCalledWith({ rememberRecents: false });
    expect(
      await screen.findByText(/list of opened environment vaults was cleared/)
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Remember environment vaults I open')
    ).not.toBeChecked();
    fireEvent.click(
      screen.getByLabelText('Remember environment vaults I open')
    );
    expect(
      await screen.findByText(/will be listed after a restart/)
    ).toBeInTheDocument();
  });

  it('shows only the idle time with env vaults off', async () => {
    render(<AppSettingsSection />);
    expect(await screen.findByLabelText('Lock vaults after')).toHaveTextContent(
      '5 minutes without activity'
    );
    expect(
      screen.queryByLabelText('Remember environment vaults I open')
    ).toBeNull();
    expect(screen.getByText(/count as activity/)).not.toHaveTextContent(
      'environment vault'
    );
  });

  it('says what keeps an env vault unlocked when env vaults are on', async () => {
    render(<AppSettingsSection envVaults />);
    expect(
      await screen.findByText(/stays unlocked only while you work on its own/)
    ).toBeInTheDocument();
  });

  it('lists an idle time outside the usual choices', async () => {
    api.get.mockResolvedValueOnce({
      success: true,
      settings: { idleMinutes: 7, rememberRecents: true },
    });
    render(<AppSettingsSection />);
    expect(await screen.findByRole('combobox')).toHaveTextContent('7 minutes');
  });

  it('shows the warning about a damaged settings file', async () => {
    api.get.mockResolvedValueOnce({
      success: true,
      settings: { idleMinutes: 5, rememberRecents: true },
      warning:
        "The settings file couldn't be read; using the default settings.",
    });
    render(<AppSettingsSection />);
    expect(
      await screen.findByText(/settings file couldn't be read/)
    ).toBeInTheDocument();
  });

  it('shows a refused change and keeps the old value', async () => {
    api.update.mockResolvedValueOnce({
      success: false,
      error: "Couldn't save the settings: disk full",
    });
    render(<AppSettingsSection />);
    await pickIdle('10 minutes without activity');
    expect(
      await screen.findByText("Couldn't save the settings: disk full")
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveTextContent('5 minutes');
  });

  it('says so when the settings cannot be loaded or saved', async () => {
    api.get.mockRejectedValueOnce(new Error('no handler'));
    const { unmount } = render(<AppSettingsSection />);
    expect(
      await screen.findByText("The settings couldn't be loaded.")
    ).toBeInTheDocument();
    unmount();

    api.update.mockRejectedValueOnce(new Error('no handler'));
    render(<AppSettingsSection />);
    await pickIdle('1 minute without activity');
    expect(
      await screen.findByText("The settings couldn't be saved.")
    ).toBeInTheDocument();
  });

  it('shows the error main returns when reading fails', async () => {
    api.get.mockResolvedValueOnce({ success: false, error: 'Boom' });
    render(<AppSettingsSection />);
    expect(await screen.findByText('Boom')).toBeInTheDocument();
  });
});

describe('ConfigurationDialog', () => {
  it('always shows the app settings; env ones only with env vaults on', async () => {
    const { unmount } = render(
      <ConfigurationDialog open onClose={() => {}} vaultName={null} envVaults />
    );
    expect(await screen.findByText('App settings')).toBeInTheDocument();
    expect(
      await screen.findByLabelText('Remember environment vaults I open')
    ).toBeInTheDocument();
    unmount();

    render(<ConfigurationDialog open onClose={() => {}} vaultName={null} />);
    expect(await screen.findByText('App settings')).toBeInTheDocument();
    expect(await screen.findByLabelText('Lock vaults after')).toBeVisible();
    expect(
      screen.queryByLabelText('Remember environment vaults I open')
    ).toBeNull();
  });
});

describe('ConfigurationDialog (what it already showed)', () => {
  it('shows the storage folder', async () => {
    render(<ConfigurationDialog open onClose={() => {}} vaultName={null} />);
    expect(await screen.findByText('/v')).toBeInTheDocument();
    expect(screen.queryByText(/Current Vault/)).toBeNull();
  });

  it('describes the unlocked vault and its security settings', async () => {
    const days = (n) => new Date(Date.now() - n * 86400000).toISOString();
    win.electronAPI.loadVault = vi.fn(async () => ({
      success: true,
      data: {
        created: days(30),
        lastPasswordChange: days(12),
        entries: [{}, {}, {}],
        passwordHistory: [{}],
        settings: {
          enforcePasswordChange: true,
          passwordChangeWarningDays: 60,
          preventPasswordReuse: false,
          maxPasswordHistory: 3,
        },
      },
    }));
    render(<ConfigurationDialog open onClose={() => {}} vaultName="work" />);
    expect(await screen.findByText('Current Vault: work')).toBeInTheDocument();
    expect(win.electronAPI.loadVault).toHaveBeenCalledWith('work');
    expect(screen.getByText(/12 days ago/)).toBeInTheDocument();
    expect(screen.getByText(/3 entries/)).toBeInTheDocument();
    expect(
      screen.getByText(/1\s+previous\s+passwords stored/)
    ).toBeInTheDocument();
    expect(
      screen.getByText('Password Change Enforcement: Enabled')
    ).toBeInTheDocument();
    expect(screen.getByText('Warning Days: 60')).toBeInTheDocument();
    expect(
      screen.getByText('Password Reuse Prevention: Disabled')
    ).toBeInTheDocument();
  });

  it('says so when the vault or the folder cannot be loaded', async () => {
    win.electronAPI.loadVault = vi.fn(async () => ({ success: false }));
    const { unmount } = render(
      <ConfigurationDialog open onClose={() => {}} vaultName="work" />
    );
    expect(
      await screen.findByText('Failed to load vault information')
    ).toBeInTheDocument();
    unmount();

    vi.spyOn(console, 'error').mockImplementation(() => {});
    win.electronAPI.getVaultDirectory = vi.fn(async () => {
      throw new Error('gone');
    });
    render(<ConfigurationDialog open onClose={() => {}} vaultName={null} />);
    expect(
      await screen.findByText('Error loading configuration')
    ).toBeInTheDocument();
  });

  it('closes', async () => {
    const onClose = vi.fn();
    render(<ConfigurationDialog open onClose={onClose} vaultName={null} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('AppSettingsSection: saved passwords, every vault kind (New-36, New-52)', () => {
  it('forgets them all and says how many', async () => {
    render(<AppSettingsSection />);
    expect(
      await screen.findByText(
        '2 saved passwords on this computer. Forgetting them doesn’t change the vaults.'
      )
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Forget all saved passwords' })
    );
    expect(keptApi.forgetAll).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(
        "Forgot 2 saved passwords. You'll type each password the next time you unlock."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Forget all saved passwords' })
    ).toBeDisabled();
    expect(
      screen.getByText('No vault password is saved on this computer.')
    ).toBeInTheDocument();
  });

  it('says so when forgetting fails', async () => {
    keptApi.forgetAll.mockRejectedValueOnce(new Error('ipc'));
    render(<AppSettingsSection />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Forget all saved passwords' })
    );
    expect(
      await screen.findByText("The saved passwords couldn't be forgotten.")
    ).toBeInTheDocument();
  });

  it('is not offered where this computer can keep none and keeps none', async () => {
    keptApi.info.mockResolvedValueOnce({
      success: true,
      available: false,
      count: 0,
      vaults: [],
    });
    render(<AppSettingsSection />);
    await screen.findByText('App settings');
    expect(keptApi.info).toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: 'Forget all saved passwords' })
    ).not.toBeInTheDocument();
  });
});

describe('AppSettingsSection: env vault file extensions (New-48)', () => {
  const field = () =>
    screen.findByLabelText('Environment vault file extensions');

  it('saves the list typed, on leaving the field', async () => {
    render(<AppSettingsSection envVaults />);
    const input = await field();
    expect(input).toHaveValue('.vault');
    fireEvent.change(input, { target: { value: '.vault, envvault  env' } });
    fireEvent.blur(input);
    expect(api.update).toHaveBeenCalledWith({
      envVaultExtensions: ['vault', 'envvault', 'env'],
    });
    expect(
      await screen.findByText(
        'Open… now offers .vault, .envvault, .env files first.'
      )
    ).toBeInTheDocument();
    expect(input).toHaveValue('.vault, .envvault, .env');
  });

  it('saves on Enter, and not at all when nothing changed', async () => {
    render(<AppSettingsSection envVaults />);
    const input = await field();
    fireEvent.change(input, { target: { value: 'vault' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(api.update).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'env' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(api.update).toHaveBeenCalledWith({ envVaultExtensions: ['env'] });
  });

  it('shows the refusal for a bad list', async () => {
    api.update.mockResolvedValueOnce({
      success: false,
      error: 'List 1 to 10 file extensions',
    });
    render(<AppSettingsSection envVaults />);
    const input = await field();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(
      await screen.findByText('List 1 to 10 file extensions')
    ).toBeInTheDocument();
    expect(input).toHaveValue('.vault');
  });

  it('is not shown without env vaults', async () => {
    render(<AppSettingsSection />);
    await screen.findByText('App settings');
    expect(
      screen.queryByLabelText('Environment vault file extensions')
    ).not.toBeInTheDocument();
  });
});
