// The rename dialog's offer to update references (New-30), states the
// real-IPC tests don't reach.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import EnvManageDialog from '../../../components/env/EnvManageDialog';

const renderRename = (loadReferences) => {
  const onSubmit = vi.fn().mockResolvedValue({ success: true });
  render(
    <EnvManageDialog
      request={{ op: 'rename', env: 'base' }}
      envNames={['base', 'shop']}
      onSubmit={onSubmit}
      onClose={() => {}}
      loadReferences={loadReferences}
    />
  );
  fireEvent.change(screen.getByLabelText('New name'), {
    target: { value: 'core' },
  });
  return onSubmit;
};

describe('EnvManageDialog rename references', () => {
  it('waits for the references before Save', async () => {
    /** @type {(value: any) => void} */
    let resolve = () => {};
    renderRename(() => new Promise((r) => (resolve = r)));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    resolve({ success: true, references: [] });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    );
  });

  it('counts across envs, and sends the choice', async () => {
    const onSubmit = renderRename(async () => ({
      success: true,
      references: [
        { env: 'shop', count: 2 },
        { env: 'web', count: 1 },
      ],
    }));
    expect(
      await screen.findByLabelText('Update 3 references to base in shop, web')
    ).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'core', updateReferences: true })
      )
    );
  });

  it('with no references, offers nothing and asks for nothing', async () => {
    const onSubmit = renderRename(async () => ({
      success: true,
      references: [],
    }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ updateReferences: false })
      )
    );
  });

  it('says so when the references cannot be checked', async () => {
    renderRename(async () => ({ success: false, error: 'Vault is locked' }));
    expect(
      await screen.findByText(/couldn't be checked and won't be updated/)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});
