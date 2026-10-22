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
const LONG = `MIIK${'A'.repeat(3000)}EA==`;

/** `window.electronAPI.envVaults` wired straight to the real handlers. */
function wire(handlers) {
  // Real IPC runs calls concurrently; on a big vault an earlier `env:view`
  // can finish after a later one. Make every other view call the slow one.
  let views = 0;
  const call =
    (channel) =>
    async (...args) => {
      if (channel === 'env:view' && views++ % 2 === 0) {
        await new Promise((r) => setTimeout(r, 30));
      }
      return handlers[channel]({}, ...args);
    };
  return {
    list: call('env-vaults:list'),
    open: call('env-vaults:open'),
    create: call('env-vaults:create'),
    unlock: call('env-vault:unlock'),
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
  saved = win.electronAPI;
  win.electronAPI = {
    ...saved,
    envVaults: wire(
      createEnvVaultHandlers({
        registry: new EnvVaultRegistry({ envsDir: dir }),
        session,
        clipboard: new ClipboardService({
          clipboard: {
            writeText: (text) => {
              clipboardText = text;
            },
            readText: () => clipboardText,
          },
        }),
        dialog: {
          showSaveDialog: async () => ({
            canceled: false,
            filePath: path.join(dir, 'ci-dev.env'),
          }),
        },
      })
    ),
  };
});

afterEach(async () => {
  cleanup(); // unmount while the wired API is still in place
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
});
