import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import EnvView from '../../../components/env/EnvView';

/** The preload API isn't typed; tests mock it on `window`. */
const win = /** @type {any} */ (window);

const SECRET = 'sk-very-secret';

const viewResult = (overrides = {}) => ({
  success: true,
  viewId: 'view-1',
  revision: 'sha256:a',
  vars: [
    { key: 'API_KEY', sensitive: true, required: false, inheritedFrom: null },
    {
      key: 'LOG_LEVEL',
      value: 'debug',
      sensitive: false,
      required: false,
      inheritedFrom: 'base',
    },
  ],
  ...overrides,
});

let api;

beforeEach(() => {
  api = {
    view: vi.fn().mockResolvedValue(viewResult()),
    refresh: vi.fn().mockResolvedValue(viewResult({ revision: 'sha256:b' })),
    reveal: vi.fn().mockResolvedValue({ success: true, value: SECRET }),
    closeView: vi.fn().mockResolvedValue({ success: true }),
    commit: vi.fn().mockResolvedValue({ success: true, revision: 'sha256:b' }),
  };
  win.electronAPI.envVaults = api;
});

const renderView = (props = {}) =>
  render(
    <EnvView vaultId="vault-1" env="prod" onLocked={vi.fn()} {...props} />
  );

const shown = async () => {
  await screen.findByText('API_KEY');
};

describe('EnvView', () => {
  it('masks sensitive values and keeps the secret out of the DOM', async () => {
    renderView();
    await shown();
    expect(api.view).toHaveBeenCalledWith('vault-1', 'prod');
    expect(screen.getByTestId('value-API_KEY')).toHaveTextContent('••••••••');
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it('shows non-sensitive values and marks inherited keys', async () => {
    renderView();
    await shown();
    expect(screen.getByTestId('value-LOG_LEVEL')).toHaveTextContent('debug');
    expect(screen.getByText('from base')).toBeInTheDocument();
    expect(screen.queryByLabelText('Delete LOG_LEVEL')).toBeNull();
    expect(screen.getByLabelText('Delete API_KEY')).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    api.view.mockResolvedValue(viewResult({ vars: [] }));
    renderView();
    expect(await screen.findByText('No variables yet.')).toBeInTheDocument();
  });

  it('shows an error when the view fails', async () => {
    api.view.mockResolvedValue({
      success: false,
      code: 'ERROR',
      error: 'boom',
    });
    renderView();
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });

  it('reveals and hides one value', async () => {
    renderView();
    await shown();
    fireEvent.click(screen.getByLabelText('Reveal API_KEY'));
    await waitFor(() =>
      expect(screen.getByTestId('value-API_KEY')).toHaveTextContent(SECRET)
    );
    expect(api.reveal).toHaveBeenCalledWith('vault-1', 'view-1', 'API_KEY');
    fireEvent.click(screen.getByLabelText('Hide API_KEY'));
    expect(screen.getByTestId('value-API_KEY')).toHaveTextContent('••••••••');
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it('reveals a masked value before editing it and saves the edit', async () => {
    renderView();
    await shown();
    fireEvent.click(screen.getByLabelText('Edit API_KEY'));
    const value = await screen.findByLabelText('Value');
    expect(api.reveal).toHaveBeenCalledWith('vault-1', 'view-1', 'API_KEY');
    expect(value).toHaveValue(SECRET);
    fireEvent.change(value, { target: { value: 'new-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.commit).toHaveBeenCalledWith('vault-1', {
        viewId: 'view-1',
        ops: [
          {
            op: 'set',
            key: 'API_KEY',
            value: 'new-secret',
            sensitive: true,
            comment: '',
          },
        ],
      })
    );
    await waitFor(() =>
      expect(api.refresh).toHaveBeenCalledWith('vault-1', 'view-1')
    );
    await waitFor(() => expect(screen.queryByLabelText('Value')).toBeNull());
  });

  it('edits a visible value without revealing', async () => {
    renderView();
    await shown();
    fireEvent.click(screen.getByLabelText('Edit LOG_LEVEL'));
    expect(await screen.findByLabelText('Value')).toHaveValue('debug');
    expect(api.reveal).not.toHaveBeenCalled();
  });

  it('adds a new variable as a secret by default', async () => {
    renderView();
    await shown();
    fireEvent.click(screen.getByText('Add variable'));
    fireEvent.change(await screen.findByLabelText('Key'), {
      target: { value: ' NEW_KEY ' },
    });
    fireEvent.change(screen.getByLabelText('Value'), {
      target: { value: 'v' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.commit).toHaveBeenCalledWith('vault-1', {
        viewId: 'view-1',
        ops: [
          {
            op: 'set',
            key: 'NEW_KEY',
            value: 'v',
            sensitive: true,
            comment: '',
          },
        ],
      })
    );
  });

  it('can add a non-secret variable', async () => {
    renderView();
    await shown();
    fireEvent.click(screen.getByText('Add variable'));
    fireEvent.change(await screen.findByLabelText('Key'), {
      target: { value: 'PUBLIC' },
    });
    fireEvent.click(screen.getByLabelText('Secret (masked)'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.commit.mock.calls[0][1].ops[0].sensitive).toBe(false)
    );
  });

  it('cancels editing', async () => {
    renderView();
    await shown();
    fireEvent.click(screen.getByText('Add variable'));
    await screen.findByLabelText('Key');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByLabelText('Key')).toBeNull());
    expect(api.commit).not.toHaveBeenCalled();
  });

  it('deletes a key after confirmation', async () => {
    renderView();
    await shown();
    fireEvent.click(screen.getByLabelText('Delete API_KEY'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete API_KEY?')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(api.commit).toHaveBeenCalledWith('vault-1', {
        viewId: 'view-1',
        ops: [{ op: 'rm', key: 'API_KEY' }],
      })
    );
  });

  it('cancels a delete', async () => {
    renderView();
    await shown();
    fireEvent.click(screen.getByLabelText('Delete API_KEY'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.commit).not.toHaveBeenCalled();
  });

  it('keeps the dialog and draft on STALE, and Reload refreshes', async () => {
    api.commit.mockResolvedValue({
      success: false,
      code: 'STALE',
      error: 'changed',
    });
    renderView();
    await shown();
    fireEvent.click(screen.getByLabelText('Edit LOG_LEVEL'));
    const value = await screen.findByLabelText('Value');
    fireEvent.change(value, { target: { value: 'draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getAllByText(/changed elsewhere/).length).toBeGreaterThan(0)
    );
    expect(screen.getByLabelText('Value')).toHaveValue('draft');
    expect(api.refresh).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reload' }));
    await waitFor(() =>
      expect(api.refresh).toHaveBeenCalledWith('vault-1', 'view-1')
    );
    await waitFor(() =>
      expect(screen.queryByText(/changed elsewhere/)).toBeNull()
    );
    expect(screen.getByLabelText('Value')).toHaveValue('draft');
  });

  it('shows the warning when a reveal is STALE', async () => {
    api.reveal.mockResolvedValue({ success: false, code: 'STALE' });
    renderView();
    await shown();
    fireEvent.click(screen.getByLabelText('Reveal API_KEY'));
    expect(await screen.findByText(/changed elsewhere/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(api.refresh).toHaveBeenCalled());
  });

  it('calls onLocked when main reports LOCKED', async () => {
    const onLocked = vi.fn();
    api.reveal.mockResolvedValue({ success: false, code: 'LOCKED' });
    renderView({ onLocked });
    await shown();
    fireEvent.click(screen.getByLabelText('Reveal API_KEY'));
    await waitFor(() => expect(onLocked).toHaveBeenCalled());
  });

  it('shows other commit errors', async () => {
    api.commit.mockResolvedValue({
      success: false,
      code: 'LIMIT',
      error: 'too many versions',
    });
    renderView();
    await shown();
    fireEvent.click(screen.getByLabelText('Delete API_KEY'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('too many versions')).toBeInTheDocument();
  });

  it('closes the view on unmount and drops revealed values', async () => {
    const { unmount } = renderView();
    await shown();
    fireEvent.click(screen.getByLabelText('Reveal API_KEY'));
    await screen.findByText(SECRET);
    unmount();
    expect(api.closeView).toHaveBeenCalledWith('vault-1', 'view-1');
    expect(document.body.textContent).not.toContain(SECRET);

    renderView();
    await shown();
    expect(screen.getByTestId('value-API_KEY')).toHaveTextContent('••••••••');
  });
});
