import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import App from '../App';

/** The preload API isn't typed; tests mock it on `window`. */
const win = /** @type {any} */ (window);

// The Environments UI is behind a gate main decides (GUI-ENV-BREAKDOWN New-4).
describe('App: Environments gate', () => {
  const original = { ...win.electronAPI };

  beforeEach(() => {
    // The real preload has these; the shared test mock doesn't.
    win.electronAPI.removeAllListeners = vi.fn();
    win.electronAPI.onVaultLocked = vi.fn();
    win.electronAPI.getVaults = vi
      .fn()
      .mockResolvedValue({ success: true, data: ['personal'] });
    win.electronAPI.envVaults = {
      list: vi.fn().mockResolvedValue({
        success: true,
        vaults: [
          {
            id: 'id-app',
            label: 'app',
            location: '/envs/app.env.vault',
            source: 'appdata',
            exists: true,
            unlocked: false,
          },
        ],
      }),
      onLocked: vi.fn(() => () => {}),
    };
  });

  afterEach(() => {
    cleanup(); // unmount while the mocks App's cleanup calls still exist
    Object.keys(win.electronAPI).forEach((k) => {
      if (!(k in original)) delete win.electronAPI[k];
    });
    Object.assign(win.electronAPI, original);
  });

  it('shows nothing env-related when the gate is off', async () => {
    win.electronAPI.getFeatures = vi
      .fn()
      .mockResolvedValue({ success: true, envVaults: false });
    render(<App />);
    expect(await screen.findByText('personal')).toBeInTheDocument();
    await waitFor(() => expect(win.electronAPI.getFeatures).toHaveBeenCalled());
    expect(screen.queryByText('Environments')).toBeNull();
    expect(screen.queryByText('Passwords')).toBeNull();
    expect(win.electronAPI.envVaults.list).not.toHaveBeenCalled();
  });

  it('shows nothing env-related when main has no getFeatures', async () => {
    delete win.electronAPI.getFeatures;
    render(<App />);
    expect(await screen.findByText('personal')).toBeInTheDocument();
    expect(screen.queryByText('Environments')).toBeNull();
  });

  it('shows nothing env-related when getFeatures fails', async () => {
    win.electronAPI.getFeatures = vi.fn().mockRejectedValue(new Error('x'));
    render(<App />);
    expect(await screen.findByText('personal')).toBeInTheDocument();
    expect(screen.queryByText('Environments')).toBeNull();
  });

  it('with the gate on, switches between Passwords and Environments', async () => {
    win.electronAPI.getFeatures = vi
      .fn()
      .mockResolvedValue({ success: true, envVaults: true });
    render(<App />);
    fireEvent.click(await screen.findByText('Environments'));
    expect(await screen.findByText('Environment Vaults')).toBeInTheDocument();
    expect(await screen.findByText('app')).toBeInTheDocument();
    expect(win.electronAPI.envVaults.list).toHaveBeenCalled();

    fireEvent.click(screen.getByText('Passwords'));
    expect(await screen.findByText('personal')).toBeInTheDocument();
    expect(screen.queryByText('Environment Vaults')).toBeNull();
  });
});
