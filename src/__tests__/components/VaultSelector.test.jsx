import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import VaultSelector from '../../components/VaultSelector';

describe('VaultSelector', () => {
  const vaults = ['default', 'work', 'personal'];
  const onVaultSelect = vi.fn();
  const onCreateNew = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders list of vaults', () => {
    render(
      <VaultSelector
        vaults={vaults}
        onVaultSelect={onVaultSelect}
        onCreateNew={onCreateNew}
      />
    );
    expect(screen.getByText('Secure Vault')).toBeInTheDocument();
    vaults.forEach((name) => {
      expect(screen.getAllByText(name)[0]).toBeInTheDocument();
    });
  });

  it('calls onVaultSelect when clicking a vault', () => {
    render(
      <VaultSelector
        vaults={vaults}
        onVaultSelect={onVaultSelect}
        onCreateNew={onCreateNew}
      />
    );
    fireEvent.click(screen.getAllByText('work')[0]);
    expect(onVaultSelect).toHaveBeenCalledWith('work');
  });

  it('calls onCreateNew when clicking Create New Vault', () => {
    render(
      <VaultSelector
        vaults={vaults}
        onVaultSelect={onVaultSelect}
        onCreateNew={onCreateNew}
      />
    );
    fireEvent.click(screen.getByText('Create New Vault'));
    expect(onCreateNew).toHaveBeenCalled();
  });
});
