import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import ImportExportDialog from '../../components/ImportExportDialog';

describe('ImportExportDialog', () => {
  let api;

  beforeEach(() => {
    api = {
      exportVault: vi.fn(),
      importVault: vi.fn(),
      selectImportFile: vi.fn(),
    };
    // @ts-ignore - test double for the preload bridge
    window.electronAPI = api;
  });

  afterEach(() => {
    // @ts-ignore
    delete window.electronAPI;
  });

  const renderDialog = (props = {}) =>
    render(
      <ImportExportDialog
        open
        onClose={vi.fn()}
        vaultName="main"
        availableVaults={['main']}
        {...props}
      />
    );

  describe('export', () => {
    it('passes only the vault name; the main process picks the file', async () => {
      api.exportVault.mockResolvedValue({
        success: true,
        exportPath: '/home/me/main.vault.json',
      });
      renderDialog();

      expect(screen.queryByLabelText(/export file path/i)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /export vault/i }));

      await waitFor(() => expect(api.exportVault).toHaveBeenCalledWith('main'));
      expect(api.exportVault.mock.calls[0]).toHaveLength(1);
      expect(
        await screen.findByText(/exported to \/home\/me\/main\.vault\.json/i)
      ).toBeInTheDocument();
    });

    it('says nothing when the save dialog is cancelled', async () => {
      api.exportVault.mockResolvedValue({ success: false, canceled: true });
      renderDialog();
      fireEvent.click(screen.getByRole('button', { name: /export vault/i }));

      await waitFor(() => expect(api.exportVault).toHaveBeenCalled());
      expect(screen.queryByText(/failed/i)).toBeNull();
    });
  });

  describe('import', () => {
    const fillAndImport = () => {
      fireEvent.change(screen.getByLabelText(/new vault name/i), {
        target: { value: 'restored' },
      });
      fireEvent.change(screen.getByLabelText(/import password/i), {
        target: { value: 'pw' },
      });
      fireEvent.click(screen.getByRole('button', { name: /import vault/i }));
    };

    it('requires a file chosen with Browse… and the path field is read-only', () => {
      renderDialog({ importOnly: true });
      expect(screen.getByLabelText(/import file/i)).toHaveAttribute('readonly');

      fillAndImport();

      expect(api.importVault).not.toHaveBeenCalled();
      expect(
        screen.getByText(/choose a vault export file/i)
      ).toBeInTheDocument();
    });

    it('imports the browsed file without sending its path', async () => {
      api.selectImportFile.mockResolvedValue({
        success: true,
        filePath: '/tmp/backup.vault.json',
      });
      api.importVault.mockResolvedValue({
        success: true,
        metadata: { entryCount: 3 },
      });
      const onImportSuccess = vi.fn();
      renderDialog({ importOnly: true, onImportSuccess });

      fireEvent.click(screen.getByRole('button', { name: /browse/i }));
      await waitFor(() =>
        expect(screen.getByLabelText(/import file/i)).toHaveValue(
          '/tmp/backup.vault.json'
        )
      );
      fillAndImport();

      await waitFor(() =>
        expect(api.importVault).toHaveBeenCalledWith('restored', 'pw')
      );
      expect(onImportSuccess).toHaveBeenCalledWith('restored');
    });
  });
});
