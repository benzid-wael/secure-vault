// The env vault UI against the real main-process handlers and a real vault
// file, rendered in StrictMode as dev does: double-mounted effects must not
// lose the view (a reveal or edit then failed with "Unknown view").
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
  within,
} from '@testing-library/react';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import EnvVaultsPanel from '../../../components/env/EnvVaultsPanel';
import { EnvironmentVaultService } from '../../../electron/services/EnvironmentVaultService.js';
import { EnvironmentVault } from '../../../electron/models/EnvironmentVault.js';
import { EnvVaultRegistry } from '../../../electron/services/EnvVaultRegistry.js';
import { EnvVaultSession } from '../../../electron/services/EnvVaultSession.js';
import { createEnvVaultHandlers } from '../../../electron/services/EnvVaultIpc.js';
import { ClipboardService } from '../../../electron/services/ClipboardService.js';
import { VaultKeychain } from '../../../electron/services/VaultKeychain.js';
import { fakeSafeStorage } from '../../helpers/fakeSafeStorage.js';

// jsdom resolves `path` to the npm browser polyfill; the main-process code
// under test needs Node's.
vi.mock('path', async () => {
  const real = await import('node:path');
  return { ...real, default: real };
});

/** The preload API isn't typed; tests mock it on `window`. */
const win = /** @type {any} */ (window);
const PW = 'Env-Pass-7&x';

let dir;
let session;
let saved;
let clipboardText;
/** Whether the fake Touch ID check passes. */
let present;
/** The fake safeStorage behind the keychain, to make it refuse. */
let safeStore;
/** What the fake open dialog returns, when a test sets it. */
let picked;
/** Listeners of `onChanged`, as main's watcher would call them. */
let changeListeners = [];
/** Handler calls not settled yet; teardown waits for them. */
const inFlight = new Set();
const emitChange = (payload) =>
  act(async () => {
    for (const listener of changeListeners) listener(payload);
  });
const LONG = `MIIK${'A'.repeat(3000)}EA==`;

/** `window.electronAPI.envVaults` wired straight to the real handlers. */
function wire(handlers) {
  // Real IPC runs calls concurrently; on a big vault an earlier `env:view`
  // can finish after a later one. Make every other view call the slow one.
  let views = 0;
  const call =
    (channel) =>
    (...args) => {
      const pending = (async () => {
        if (channel === 'env:view' && views++ % 2 === 0) {
          await new Promise((r) => setTimeout(r, 30));
        }
        return handlers[channel]({}, ...args);
      })();
      inFlight.add(pending);
      pending.then(
        () => inFlight.delete(pending),
        () => inFlight.delete(pending)
      );
      return pending;
    };
  return {
    list: call('env-vaults:list'),
    open: call('env-vaults:open'),
    openFolder: call('env-vaults:open-folder'),
    forget: call('env-vaults:forget'),
    create: call('env-vaults:create'),
    unlock: call('env-vault:unlock'),
    unlockSaved: call('env-vault:unlock-saved'),
    forgetPassword: call('env-vault:forget-password'),
    lock: call('env-vault:lock'),
    listEnvs: call('env:list'),
    createEnv: call('env:create'),
    view: call('env:view'),
    refresh: call('env:refresh'),
    reveal: call('env:reveal'),
    closeView: call('env:view-close'),
    commit: call('env:commit'),
    copy: call('env:copy'),
    transfer: call('env:transfer'),
    exportEnv: call('env:export'),
    manageEnv: call('env:manage'),
    references: call('env:references'),
    editText: call('env:edit-text'),
    templateEnv: call('env:template'),
    diff: call('env:diff'),
    validate: call('env:validate'),
    importPick: call('env:import-pick'),
    importApply: call('env:import-apply'),
    importCancel: call('env:import-cancel'),
    changePassword: call('env-vault:change-password'),
    history: call('env:history'),
    rollback: call('env:rollback'),
    squash: call('env:squash'),
    onChanged: (listener) => {
      changeListeners.push(listener);
      return () => {
        changeListeners = changeListeners.filter((l) => l !== listener);
      };
    },
    onLocked: () => () => {},
  };
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-envui-'));
  const vault = new EnvironmentVault();
  for (const env of ['ci-dev', 'ci-prod']) {
    vault.addEnvironment(env);
    vault.addVersion(env, {
      APPLE_API_ISSUER_ID: `${env}-issuer`,
      MATCH_PASSWORD: `${env}-match`,
      ...(env === 'ci-dev' && { ANDROID_KEYSTORE_B64: LONG }),
    });
  }
  await EnvironmentVaultService.createVault(
    path.join(dir, 'app.env.vault'),
    PW,
    vault.toJSON()
  );
  session = new EnvVaultSession();
  present = true;
  picked = undefined;
  const dialog = {
    showOpenDialog: async () => ({
      canceled: false,
      filePaths: [picked ?? path.join(dir, 'in.env')],
    }),
    // Saves under the name the app suggests.
    showSaveDialog: async (win, options) => ({
      canceled: false,
      filePath: path.join(dir, options.defaultPath),
    }),
  };
  safeStore = fakeSafeStorage();
  saved = win.electronAPI;
  win.electronAPI = {
    ...saved,
    envVaults: wire(
      createEnvVaultHandlers({
        registry: new EnvVaultRegistry({ envsDir: dir, dialog }),
        session,
        keychain: new VaultKeychain({
          file: path.join(dir, 'kept', 'passwords.json'),
          safeStorage: safeStore,
          confirmPresence: async () => present,
        }),
        clipboard: new ClipboardService({
          clipboard: {
            writeText: (text) => {
              clipboardText = text;
            },
            readText: () => clipboardText,
          },
        }),
        dialog,
      })
    ),
  };
});

afterEach(async () => {
  cleanup(); // unmount while the wired API is still in place
  // Calls the page started may still be writing into `dir` (New-41).
  while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
  session.lockAll();
  win.electronAPI = saved;
  await fs.remove(dir);
});

/** Let every in-flight call land, as it has by the time a user clicks. */
const settle = () => new Promise((r) => setTimeout(r, 100));

async function openVault() {
  render(
    <React.StrictMode>
      <EnvVaultsPanel />
    </React.StrictMode>
  );
  fireEvent.click(await screen.findByText('app'));
  fireEvent.change(await screen.findByLabelText('Vault Password'), {
    target: { value: PW },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
  await screen.findByText('New environment');
}

describe('env vault UI on the real handlers (StrictMode)', () => {
  it.each(['ci-dev', 'ci-prod'])('reveals a key in %s', async (env) => {
    await openVault();
    fireEvent.click(await screen.findByText(env));
    await screen.findByLabelText('Reveal APPLE_API_ISSUER_ID');
    await settle();
    fireEvent.click(screen.getByLabelText('Reveal APPLE_API_ISSUER_ID'));
    expect(await screen.findByText(`${env}-issuer`)).toBeInTheDocument();
    expect(screen.queryByText(/Unknown view/)).not.toBeInTheDocument();
  });

  it('reveals after switching envs back and forth', async () => {
    await openVault();
    fireEvent.click(await screen.findByText('ci-prod'));
    await screen.findByLabelText('Reveal MATCH_PASSWORD');
    fireEvent.click(screen.getByText('ci-dev'));
    await screen.findByLabelText('Reveal MATCH_PASSWORD');
    fireEvent.click(screen.getByText('ci-prod'));
    await screen.findByLabelText('Reveal MATCH_PASSWORD');
    await settle();
    fireEvent.click(screen.getByLabelText('Reveal MATCH_PASSWORD'));
    await waitFor(() =>
      expect(screen.getByText('ci-prod-match')).toBeInTheDocument()
    );
    expect(screen.queryByText(/Unknown view/)).not.toBeInTheDocument();
  });

  const openEnv = async (env) => {
    await openVault();
    fireEvent.click(await screen.findByText(env));
    await screen.findByLabelText('Copy MATCH_PASSWORD');
    await settle();
  };
  const activeVars = async (env) =>
    (
      await EnvironmentVaultService.read(path.join(dir, 'app.env.vault'), PW)
    ).vault.getActiveVersion(env).vars;

  it('copies a value through main and says when it is cleared', async () => {
    await openEnv('ci-prod');
    fireEvent.click(screen.getByLabelText('Copy MATCH_PASSWORD'));
    expect(
      await screen.findByText(/Copied MATCH_PASSWORD\. It is cleared/)
    ).toBeInTheDocument();
    expect(clipboardText).toBe('ci-prod-match');
    expect(screen.queryByText('ci-prod-match')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('More actions for MATCH_PASSWORD'));
    fireEvent.click(await screen.findByText('Copy KEY=value'));
    await waitFor(() =>
      expect(clipboardText).toBe('MATCH_PASSWORD=ci-prod-match')
    );
    fireEvent.click(screen.getByLabelText('More actions for MATCH_PASSWORD'));
    fireEvent.click(await screen.findByText('Copy key name'));
    await waitFor(() => expect(clipboardText).toBe('MATCH_PASSWORD'));
  });

  it('shortens a long revealed value and shows it whole in a dialog', async () => {
    await openEnv('ci-dev');
    fireEvent.click(screen.getByLabelText('Reveal ANDROID_KEYSTORE_B64'));
    const cell = await screen.findByTestId('value-ANDROID_KEYSTORE_B64');
    await waitFor(() => expect(cell.textContent).toMatch(/^MIIKA+…Show$/));
    expect(cell.textContent.length).toBeLessThan(100);
    fireEvent.click(screen.getByLabelText('Show all of ANDROID_KEYSTORE_B64'));
    expect((await screen.findByTestId('full-value')).textContent).toBe(LONG);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(clipboardText).toBe(LONG));
  });

  it('edits a value', async () => {
    await openEnv('ci-prod');
    fireEvent.click(screen.getByLabelText('Edit MATCH_PASSWORD'));
    const field = await screen.findByLabelText('Value');
    expect(field).toHaveValue('ci-prod-match');
    fireEvent.change(field, { target: { value: 'edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () =>
      expect((await activeVars('ci-prod')).MATCH_PASSWORD).toBe('edited')
    );
  });

  it('adds a comment to a key and shows it under the key', async () => {
    await openEnv('ci-prod');
    fireEvent.click(screen.getByLabelText('Edit MATCH_PASSWORD'));
    fireEvent.change(await screen.findByLabelText('Comment (optional)'), {
      target: { value: 'fastlane match repo' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByTestId('comment-MATCH_PASSWORD')
    ).toHaveTextContent('fastlane match repo');
    expect(
      (
        await EnvironmentVaultService.read(path.join(dir, 'app.env.vault'), PW)
      ).vault.getActiveVersion('ci-prod').comments
    ).toEqual({ MATCH_PASSWORD: 'fastlane match repo' });
  });

  it('moves a key to another env, asking before it overwrites', async () => {
    await openEnv('ci-prod');
    fireEvent.click(screen.getByLabelText('More actions for MATCH_PASSWORD'));
    fireEvent.click(await screen.findByText('Move to environment…'));
    fireEvent.click(await screen.findByRole('button', { name: 'Move' }));
    expect(
      await screen.findByText(/ci-dev already has MATCH_PASSWORD/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }));
    expect(
      await screen.findByText('Moved MATCH_PASSWORD to ci-dev.')
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByLabelText('Copy MATCH_PASSWORD')
      ).not.toBeInTheDocument()
    );
    expect((await activeVars('ci-dev')).MATCH_PASSWORD).toBe('ci-prod-match');
    expect(await activeVars('ci-prod')).not.toHaveProperty('MATCH_PASSWORD');
  });

  it('duplicates selected keys into another env', async () => {
    await openVault();
    fireEvent.click(screen.getByText('New environment'));
    fireEvent.change(await screen.findByLabelText('Environment Name'), {
      target: { value: 'staging' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByText('No variables yet.');
    fireEvent.click(screen.getByText('ci-prod'));
    await screen.findByLabelText('Select MATCH_PASSWORD');
    await settle();
    fireEvent.click(screen.getByLabelText('Select MATCH_PASSWORD'));
    fireEvent.click(screen.getByLabelText('Select APPLE_API_ISSUER_ID'));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Copy to…'));
    fireEvent.mouseDown(await screen.findByLabelText('To environment'));
    fireEvent.click(await screen.findByRole('option', { name: 'staging' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(
      await screen.findByText('Copied 2 keys to staging.')
    ).toBeInTheDocument();
    expect(await activeVars('staging')).toEqual({
      APPLE_API_ISSUER_ID: 'ci-prod-issuer',
      MATCH_PASSWORD: 'ci-prod-match',
    });
    expect(Object.keys(await activeVars('ci-prod'))).toHaveLength(2);
  });

  it('exports the env to the file chosen in the dialog', async () => {
    await openEnv('ci-dev');
    fireEvent.click(screen.getByRole('button', { name: 'Export .env' }));
    const out = path.join(dir, 'ci-dev.env');
    expect(
      await screen.findByText(`Exported ci-dev to ${out}`)
    ).toBeInTheDocument();
    expect(await fs.readFile(out, 'utf8')).toContain(
      'MATCH_PASSWORD=ci-dev-match'
    );
  });

  it('exports the env as JSON from the menu (New-35)', async () => {
    await openEnv('ci-dev');
    fireEvent.click(screen.getByLabelText('More environment actions'));
    fireEvent.click(await screen.findByText('Export as JSON…'));
    const out = path.join(dir, 'ci-dev.json');
    expect(
      await screen.findByText(`Exported ci-dev to ${out}`)
    ).toBeInTheDocument();
    expect(JSON.parse(await fs.readFile(out, 'utf8'))).toMatchObject({
      MATCH_PASSWORD: 'ci-dev-match',
    });
  });

  const vaultId = async () =>
    (await win.electronAPI.envVaults.list()).vaults[0].id;

  it('renames an env from its menu and keeps working in it', async () => {
    await openEnv('ci-prod');
    fireEvent.click(screen.getByLabelText('Manage ci-prod'));
    fireEvent.click(await screen.findByText('Rename…'));
    fireEvent.change(await screen.findByLabelText('New name'), {
      target: { value: 'prod' },
    });
    // Enabled once the references are checked; there are none to offer.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Renamed ci-prod to prod.')
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'prod' })
    ).toBeInTheDocument();
    await screen.findByLabelText('Reveal MATCH_PASSWORD');
    await settle();
    fireEvent.click(screen.getByLabelText('Reveal MATCH_PASSWORD'));
    expect(await screen.findByText('ci-prod-match')).toBeInTheDocument();
  });

  const referToProd = () =>
    EnvironmentVaultService.setEnv(
      path.join(dir, 'app.env.vault'),
      PW,
      'ci-dev',
      'PROD_ISSUER',
      '{{env:ci-prod/APPLE_API_ISSUER_ID}}'
    );
  const renameProd = async () => {
    await openEnv('ci-prod');
    fireEvent.click(screen.getByLabelText('Manage ci-prod'));
    fireEvent.click(await screen.findByText('Rename…'));
    fireEvent.change(await screen.findByLabelText('New name'), {
      target: { value: 'prod' },
    });
  };

  it('renames an env and the references to it (New-30)', async () => {
    await referToProd();
    await renameProd();
    const offer = await screen.findByLabelText(
      'Update 1 reference to ci-prod in ci-dev'
    );
    expect(offer).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText(
        'Renamed ci-prod to prod. Updated 1 reference in ci-dev.'
      )
    ).toBeInTheDocument();
    expect((await activeVars('ci-dev')).PROD_ISSUER).toBe(
      '{{env:prod/APPLE_API_ISSUER_ID}}'
    );
  });

  it('warns, and leaves references alone, when the offer is declined', async () => {
    await referToProd();
    await renameProd();
    fireEvent.click(
      await screen.findByLabelText('Update 1 reference to ci-prod in ci-dev')
    );
    expect(
      screen.getByText(/point to an environment that no longer exists/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Renamed ci-prod to prod.')
    ).toBeInTheDocument();
    expect((await activeVars('ci-dev')).PROD_ISSUER).toBe(
      '{{env:ci-prod/APPLE_API_ISSUER_ID}}'
    );
  });

  it('deletes an env after a confirm', async () => {
    await openEnv('ci-prod');
    fireEvent.click(screen.getByLabelText('Manage ci-prod'));
    fireEvent.click(await screen.findByText('Delete…'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('.deleted.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(
      await screen.findByText('Deleted ci-prod. A copy of the vault was kept.')
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByLabelText('Manage ci-prod')).not.toBeInTheDocument()
    );
  });

  it('rolls back from the history', async () => {
    await openEnv('ci-prod');
    fireEvent.click(screen.getByLabelText('Edit MATCH_PASSWORD'));
    fireEvent.change(await screen.findByLabelText('Value'), {
      target: { value: 'edited' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () =>
      expect((await activeVars('ci-prod')).MATCH_PASSWORD).toBe('edited')
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    fireEvent.click(await screen.findByLabelText('Roll back to v1'));
    fireEvent.click(screen.getByRole('button', { name: 'Roll back' }));
    expect(
      await screen.findByText(/ci-prod is back to version 1/)
    ).toBeInTheDocument();
    expect((await activeVars('ci-prod')).MATCH_PASSWORD).toBe('ci-prod-match');
  });

  it('squashes the history after a confirm that mentions the snapshot', async () => {
    await EnvironmentVaultService.setEnv(
      path.join(dir, 'app.env.vault'),
      PW,
      'ci-prod',
      'EXTRA',
      '1'
    );
    await openEnv('ci-prod');
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Squash…' }));
    expect(await screen.findByText(/\.squashed\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Squash' }));
    expect(
      await screen.findByText(/Squashed ci-prod's history/)
    ).toBeInTheDocument();
    const vault = (
      await EnvironmentVaultService.read(path.join(dir, 'app.env.vault'), PW)
    ).vault;
    expect(vault.getHistory('ci-prod')).toHaveLength(1);
  });

  it('reloads when the vault changes outside the app', async () => {
    await openEnv('ci-prod');
    await EnvironmentVaultService.setEnv(
      path.join(dir, 'app.env.vault'),
      PW,
      'ci-prod',
      'FROM_CLI',
      'x'
    );
    await emitChange({ id: await vaultId(), missing: false });
    expect(await screen.findByLabelText('Copy FROM_CLI')).toBeInTheDocument();
    expect(
      screen.getByText('Updated with a change made outside the app.')
    ).toBeInTheDocument();
  });

  it('keeps an open edit and warns when the vault changes outside the app', async () => {
    await openEnv('ci-prod');
    fireEvent.click(screen.getByLabelText('Edit MATCH_PASSWORD'));
    await screen.findByLabelText('Value');
    await EnvironmentVaultService.setEnv(
      path.join(dir, 'app.env.vault'),
      PW,
      'ci-prod',
      'FROM_CLI',
      'x'
    );
    await emitChange({ id: await vaultId(), missing: false });
    expect(
      await screen.findAllByText(/changed elsewhere since you opened it/)
    ).not.toHaveLength(0);
    expect(screen.getByLabelText('Value')).toHaveValue('ci-prod-match');
  });

  it('says so when the vault file disappears', async () => {
    await openEnv('ci-prod');
    await emitChange({ id: await vaultId(), missing: true });
    expect(
      await screen.findByText(
        'The vault file was moved or deleted outside the app.'
      )
    ).toBeInTheDocument();
  });

  it('bulk edits as .env text, writing only what changed', async () => {
    await openEnv('ci-prod');
    fireEvent.click(screen.getByRole('button', { name: 'Edit as .env' }));
    const field = /** @type {HTMLTextAreaElement} */ (
      await screen.findByLabelText('.env')
    );
    await waitFor(() =>
      expect(field.value).toContain('MATCH_PASSWORD=ci-prod-match')
    );
    fireEvent.change(field, {
      target: {
        value:
          'APPLE_API_ISSUER_ID=ci-prod-issuer\n# fastlane\nMATCH_PASSWORD=bulk\nNEW_ONE=1\n',
      },
    });
    expect(screen.getByText('2 to set, 0 to remove')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved 2 changes.')).toBeInTheDocument();
    const vault = (
      await EnvironmentVaultService.read(path.join(dir, 'app.env.vault'), PW)
    ).vault;
    const active = vault.getActiveVersion('ci-prod');
    expect(active.vars).toEqual({
      APPLE_API_ISSUER_ID: 'ci-prod-issuer',
      MATCH_PASSWORD: 'bulk',
      NEW_ONE: '1',
    });
    expect(active.comments).toEqual({ MATCH_PASSWORD: 'fastlane' });
    expect(vault.getHistory('ci-prod')).toHaveLength(2); // one version
  });

  it('blocks a bulk save while lines would be skipped', async () => {
    await openEnv('ci-prod');
    fireEvent.click(screen.getByRole('button', { name: 'Edit as .env' }));
    const field = /** @type {HTMLTextAreaElement} */ (
      await screen.findByLabelText('.env')
    );
    await waitFor(() => expect(field).not.toHaveValue(''));
    fireEvent.change(field, { target: { value: 'not a line\nA=1\n' } });
    expect(
      screen.getByText('Line 1: Not KEY=value; skipped')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('lists conflicting keys in bulk edit and can overwrite them', async () => {
    await openEnv('ci-prod');
    fireEvent.click(screen.getByRole('button', { name: 'Edit as .env' }));
    const field = /** @type {HTMLTextAreaElement} */ (
      await screen.findByLabelText('.env')
    );
    await waitFor(() => expect(field).not.toHaveValue(''));
    await EnvironmentVaultService.setEnv(
      path.join(dir, 'app.env.vault'),
      PW,
      'ci-prod',
      'MATCH_PASSWORD',
      'from-cli'
    );
    fireEvent.change(field, {
      target: {
        value: field.value.replace(
          'MATCH_PASSWORD=ci-prod-match',
          'MATCH_PASSWORD=mine'
        ),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByTestId('conflict-MATCH_PASSWORD')
    ).toHaveTextContent('changed');
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }));
    expect(await screen.findByText('Saved 1 change.')).toBeInTheDocument();
    expect((await activeVars('ci-prod')).MATCH_PASSWORD).toBe('mine');
  });

  it('merges a one-key edit with a change made elsewhere', async () => {
    await openEnv('ci-prod');
    fireEvent.click(screen.getByLabelText('Edit MATCH_PASSWORD'));
    const value = await screen.findByLabelText('Value');
    await EnvironmentVaultService.setEnv(
      path.join(dir, 'app.env.vault'),
      PW,
      'ci-prod',
      'FROM_CLI',
      'x'
    );
    fireEvent.change(value, { target: { value: 'edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Saved, merged with a change made elsewhere.')
    ).toBeInTheDocument();
    expect(await activeVars('ci-prod')).toMatchObject({
      MATCH_PASSWORD: 'edited',
      FROM_CLI: 'x',
    });
  });

  it('offers to overwrite when the same key changed elsewhere', async () => {
    await openEnv('ci-prod');
    fireEvent.click(screen.getByLabelText('Edit MATCH_PASSWORD'));
    const value = await screen.findByLabelText('Value');
    await EnvironmentVaultService.setEnv(
      path.join(dir, 'app.env.vault'),
      PW,
      'ci-prod',
      'MATCH_PASSWORD',
      'from-cli'
    );
    fireEvent.change(value, { target: { value: 'mine' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText(/Changed elsewhere meanwhile: MATCH_PASSWORD/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }));
    await waitFor(async () =>
      expect((await activeVars('ci-prod')).MATCH_PASSWORD).toBe('mine')
    );
  });

  const openMore = async (item) => {
    fireEvent.click(screen.getByLabelText('More environment actions'));
    fireEvent.click(await screen.findByText(item));
  };

  it('imports a .env after a preview of key names', async () => {
    await fs.writeFile(
      path.join(dir, 'in.env'),
      '# rotated yearly\nMATCH_PASSWORD=from-file\nNEW_KEY=n\n'
    );
    await openEnv('ci-prod');
    await openMore('Import .env…');
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Import in.env into ci-prod');
    expect(dialog).not.toHaveTextContent('from-file');
    expect(within(dialog).getByText('rotated yearly')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    expect(
      await screen.findByText('Imported 2 keys from in.env.')
    ).toBeInTheDocument();
    const vars = await activeVars('ci-prod');
    expect(vars).toMatchObject({
      MATCH_PASSWORD: 'from-file',
      NEW_KEY: 'n',
      APPLE_API_ISSUER_ID: 'ci-prod-issuer',
    });
  });

  it('compares two envs, values hidden until asked', async () => {
    await openEnv('ci-prod');
    await openMore('Compare with…');
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText('MATCH_PASSWORD')
    ).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent('ci-dev-match');
    fireEvent.click(within(dialog).getByLabelText('Show values'));
    expect(await within(dialog).findByText('ci-dev-match')).toBeInTheDocument();
  });

  it('validates an env', async () => {
    await openEnv('ci-prod');
    await openMore('Validate');
    expect(await screen.findByText(/No problems found/)).toBeInTheDocument();
  });

  it('changes the vault password and keeps working', async () => {
    await openEnv('ci-prod');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    fireEvent.change(await screen.findByLabelText('Current password'), {
      target: { value: PW },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'Next-Pass-77&y' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'Next-Pass-77&y' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(await screen.findByText(/Password changed\./)).toBeInTheDocument();
    const vaultFile = path.join(dir, 'app.env.vault');
    expect((await EnvironmentVaultService.read(vaultFile, PW)).success).toBe(
      false
    );
    expect(
      (await EnvironmentVaultService.read(vaultFile, 'Next-Pass-77&y')).success
    ).toBe(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByLabelText('Reveal MATCH_PASSWORD'));
    expect(await screen.findByText('ci-prod-match')).toBeInTheDocument();
  });

  it('keeps revealing after changing the env on screen', async () => {
    await openEnv('ci-prod');
    fireEvent.click(screen.getByLabelText('Manage ci-prod'));
    fireEvent.click(await screen.findByText('Description…'));
    fireEvent.change(await screen.findByLabelText('Description'), {
      target: { value: 'Production CI' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Updated the description of ci-prod.')
    ).toBeInTheDocument();
    expect(await screen.findByText(/Production CI/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await settle();
    fireEvent.click(screen.getByLabelText('Reveal MATCH_PASSWORD'));
    expect(await screen.findByText('ci-prod-match')).toBeInTheDocument();
  });
  /** Unlock `app` by typing the password, ticking "Remember" or not. */
  const typeUnlock = async ({ remember }) => {
    fireEvent.change(await screen.findByLabelText('Vault Password'), {
      target: { value: PW },
    });
    const box = /** @type {HTMLInputElement} */ (
      screen.getByLabelText('Remember on this computer')
    );
    if (box.checked !== remember) fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await screen.findByText('New environment');
  };

  const backToList = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Lock' }));
    await screen.findByText('Environment Vaults');
  };

  // New-22: a project folder opens the vault the CLI would use there.
  it('opens the vault of a project folder and shows its path before unlocking', async () => {
    const project = path.join(dir, 'Superxpense');
    await fs.copy(
      path.join(dir, 'app.env.vault'),
      path.join(project, '.env.vault')
    );
    picked = project;
    render(<EnvVaultsPanel />);
    fireEvent.click(await screen.findByText('Open folder…'));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(path.join(project, '.env.vault'))
    ).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Vault Password'), {
      target: { value: PW },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('New environment')).toBeInTheDocument();
  });

  it('removes an opened vault from the list', async () => {
    const project = path.join(dir, 'proj');
    await fs.copy(
      path.join(dir, 'app.env.vault'),
      path.join(project, '.env.vault')
    );
    picked = project;
    render(<EnvVaultsPanel />);
    fireEvent.click(await screen.findByText('Open folder…'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(
      await screen.findByLabelText('Remove proj/.env.vault from the list')
    );
    await waitFor(() =>
      expect(screen.queryByText('proj/.env.vault')).toBeNull()
    );
    // App-folder vaults have no such action.
    expect(screen.getByText('app')).toBeInTheDocument();
    expect(screen.queryByText('Remove from list')).toBeNull();
    expect(await fs.pathExists(path.join(project, '.env.vault'))).toBe(true);
  });

  it('says where it looked when a folder has no vault', async () => {
    picked = path.join(dir, 'nothing-here');
    await fs.mkdirp(picked);
    render(<EnvVaultsPanel />);
    fireEvent.click(await screen.findByText('Open folder…'));
    expect(
      await screen.findByText(/No environment vault found for .*nothing-here/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('remembers the password when asked and unlocks with it next time', async () => {
    render(<EnvVaultsPanel />);
    fireEvent.click(await screen.findByText('app'));
    await typeUnlock({ remember: true });
    await backToList();
    expect(await screen.findByText('Password saved')).toBeInTheDocument();

    fireEvent.click(screen.getByText('app'));
    expect(await screen.findByText('New environment')).toBeInTheDocument();
    expect(screen.queryByLabelText('Vault Password')).toBeNull();
  });

  it('asks for the password when the presence check is declined', async () => {
    render(<EnvVaultsPanel />);
    fireEvent.click(await screen.findByText('app'));
    await typeUnlock({ remember: true });
    await backToList();
    present = false;
    fireEvent.click(await screen.findByText('app'));
    expect(await screen.findByLabelText('Vault Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Remember on this computer')).toBeChecked();
    present = true;
    fireEvent.click(screen.getByRole('button', { name: 'Use saved password' }));
    expect(await screen.findByText('New environment')).toBeInTheDocument();
  });

  it('says so when the saved password no longer works', async () => {
    render(<EnvVaultsPanel />);
    fireEvent.click(await screen.findByText('app'));
    await typeUnlock({ remember: true });
    await backToList();
    await EnvironmentVaultService.changePassword(
      path.join(dir, 'app.env.vault'),
      PW,
      'Other-Pass-9!'
    );
    fireEvent.click(await screen.findByText('app'));
    expect(
      await screen.findByText(/saved password no longer opens app\.env\.vault/)
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Remember on this computer')
    ).not.toBeChecked();
    expect(
      screen.queryByRole('button', { name: 'Use saved password' })
    ).toBeNull();
  });

  it('unlocks but says so when the keychain refuses the password', async () => {
    safeStore.isEncryptionAvailable = () => false;
    render(<EnvVaultsPanel />);
    fireEvent.click(await screen.findByText('app'));
    await typeUnlock({ remember: true });
    expect(
      await screen.findByText(/password couldn't be saved on this computer/)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Forget saved password' })
    ).toBeNull();
  });

  it('forgets the saved password from the vault screen', async () => {
    render(<EnvVaultsPanel />);
    fireEvent.click(await screen.findByText('app'));
    await typeUnlock({ remember: true });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Forget saved password' })
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Forget saved password' })
      ).toBeNull()
    );
    await backToList();
    expect(screen.queryByText('Password saved')).toBeNull();
    fireEvent.click(screen.getByText('app'));
    expect(await screen.findByLabelText('Vault Password')).toBeInTheDocument();
  });
  it('opens a vault from a newer version read-only, with the reason', async () => {
    const file = path.join(dir, 'app.env.vault');
    // A second version, so history would offer rollback and squash.
    await EnvironmentVaultService.setEnv(file, PW, 'ci-prod', 'EXTRA', '1');
    await fs.writeJSON(file, {
      ...(await fs.readJSON(file)),
      features: ['expiry'],
    });
    await openEnv('ci-prod');
    expect(await screen.findByText(/Read-only\./)).toBeInTheDocument();
    expect(screen.getByText(/doesn't support \(expiry\)/)).toBeInTheDocument();
    // Reading still works; nothing that writes is offered.
    await settle();
    fireEvent.click(screen.getByLabelText('Reveal MATCH_PASSWORD'));
    expect(await screen.findByText('ci-prod-match')).toBeInTheDocument();
    for (const name of [
      'Add variable',
      'Edit as .env',
      'New environment',
      'Change password',
    ]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByLabelText('Edit MATCH_PASSWORD')).toBeNull();
    expect(screen.queryByLabelText('Delete MATCH_PASSWORD')).toBeNull();
    expect(screen.queryByLabelText('Manage ci-prod')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    await screen.findByRole('table', { name: 'Versions' });
    expect(screen.queryByRole('button', { name: /Roll back/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Squash…' })).toBeNull();
  });
});
