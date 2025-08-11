import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

vi.mock('../../utils/passwordValidation', () => ({
  getPasswordStrength: vi.fn(() => ({
    strength: 'good',
    color: '#2196f3',
    width: '75%',
  })),
  validatePasswordStrength: vi.fn((pwd) => (pwd === 'weak' ? ['weak'] : [])),
}));

import CreateVault from '../../components/CreateVault';

describe('CreateVault', () => {
  const onCreateVault = vi.fn();
  const onBack = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const fillCommon = (
    name = 'my_vault',
    pwd = 'StrongPass123!',
    confirm = 'StrongPass123!'
  ) => {
    fireEvent.change(screen.getByLabelText(/vault name/i), {
      target: { value: name },
    });
    fireEvent.change(screen.getByLabelText(/^master password$/i), {
      target: { value: pwd },
    });
    fireEvent.change(screen.getByLabelText(/confirm master password/i), {
      target: { value: confirm },
    });
  };

  it('validates required fields and name format', async () => {
    render(
      <CreateVault
        onCreateVault={onCreateVault}
        onBack={onBack}
        existingVaults={['existing']}
      />
    );

    // Submit form directly since button is disabled when fields are empty
    const form = screen
      .getByRole('button', { name: /Create Vault/i })
      .closest('form');
    fireEvent.submit(form);
    expect(
      await screen.findByText(/Please enter a vault name/i)
    ).toBeInTheDocument();

    fillCommon('existing', 'StrongPass123!', 'StrongPass123!');
    fireEvent.click(screen.getByRole('button', { name: /Create Vault/i }));
    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Vault Name/i), {
      target: { value: 'bad name' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Create Vault/i }));
    expect(await screen.findByText(/can only contain/i)).toBeInTheDocument();
  });

  it('validates password rules and mismatch', async () => {
    render(
      <CreateVault
        onCreateVault={onCreateVault}
        onBack={onBack}
        existingVaults={[]}
      />
    );

    fillCommon('ok_name', '', '');
    // Submit form directly since button is disabled when fields are empty
    const form = screen
      .getByRole('button', { name: /Create Vault/i })
      .closest('form');
    fireEvent.submit(form);
    expect(
      await screen.findByText(/Please enter a master password/i)
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^master password$/i), {
      target: { value: 'weak' },
    });
    fireEvent.change(screen.getByLabelText(/confirm master password/i), {
      target: { value: 'weak' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Create Vault/i }));
    expect(await screen.findByText(/weak/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^master password$/i), {
      target: { value: 'StrongPass123!' },
    });
    fireEvent.change(screen.getByLabelText(/confirm master password/i), {
      target: { value: 'mismatch' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Create Vault/i }));
    expect(
      await screen.findByText(/Passwords do not match/i)
    ).toBeInTheDocument();
  });

  it('calls onCreateVault and handles failure', async () => {
    onCreateVault.mockResolvedValueOnce({ success: false, error: 'Failed' });
    render(
      <CreateVault
        onCreateVault={onCreateVault}
        onBack={onBack}
        existingVaults={[]}
      />
    );

    fillCommon();
    fireEvent.click(screen.getByRole('button', { name: /Create Vault/i }));

    await waitFor(() =>
      expect(onCreateVault).toHaveBeenCalledWith('my_vault', 'StrongPass123!')
    );
    expect(await screen.findByText(/Failed/i)).toBeInTheDocument();
  });

  it('success path does not show error', async () => {
    onCreateVault.mockResolvedValueOnce({ success: true });
    render(
      <CreateVault
        onCreateVault={onCreateVault}
        onBack={onBack}
        existingVaults={[]}
      />
    );

    fillCommon();
    fireEvent.click(screen.getByRole('button', { name: /Create Vault/i }));

    await waitFor(() => expect(onCreateVault).toHaveBeenCalled());
    // Should not show error alert, but warning alert is always present
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
  });
});
