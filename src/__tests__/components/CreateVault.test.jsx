import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Mock Material-UI components used in CreateVault
vi.mock('@mui/material/Typography', () => ({
  __esModule: true,
  default: ({ children, ...props }) =>
    React.createElement('div', props, children),
}));

vi.mock('@mui/material/TextField', () => ({
  __esModule: true,
  default: ({ label, value, onChange, type, InputProps, ...props }) =>
    React.createElement(
      'div',
      {},
      React.createElement('label', {}, label),
      React.createElement('input', {
        type: type || 'text',
        value: value || '',
        onChange,
        'aria-label': label,
        ...props,
      }),
      InputProps?.endAdornment
    ),
}));

vi.mock('@mui/material/Button', () => ({
  __esModule: true,
  default: ({ children, onClick, disabled, ...props }) =>
    React.createElement('button', { onClick, disabled, ...props }, children),
}));

vi.mock('@mui/material/Box', () => ({
  __esModule: true,
  default: ({ children, ...props }) =>
    React.createElement('div', props, children),
}));

vi.mock('@mui/material/IconButton', () => ({
  __esModule: true,
  default: ({ children, onClick, ...props }) =>
    React.createElement('button', { onClick, ...props }, children),
}));

vi.mock('@mui/material/InputAdornment', () => ({
  __esModule: true,
  default: ({ children, ...props }) =>
    React.createElement('div', props, children),
}));

vi.mock('@mui/material/Alert', () => ({
  __esModule: true,
  default: ({ children, severity, ...props }) =>
    React.createElement(
      'div',
      { 'data-testid': 'alert', 'data-severity': severity, ...props },
      children
    ),
}));

vi.mock('@mui/material/CircularProgress', () => ({
  __esModule: true,
  default: (props) =>
    React.createElement('div', {
      'data-testid': 'circular-progress',
      ...props,
    }),
}));

vi.mock('@mui/material/LinearProgress', () => ({
  __esModule: true,
  default: (props) =>
    React.createElement('div', { 'data-testid': 'linear-progress', ...props }),
}));

// Mock Material-UI icons
vi.mock('@mui/icons-material/Visibility', () => ({
  __esModule: true,
  default: () => React.createElement('span', {}, '👁️'),
}));

vi.mock('@mui/icons-material/VisibilityOff', () => ({
  __esModule: true,
  default: () => React.createElement('span', {}, '🙈'),
}));

vi.mock('@mui/icons-material/ArrowBack', () => ({
  __esModule: true,
  default: () => React.createElement('span', {}, '←'),
}));

vi.mock('@mui/icons-material/Add', () => ({
  __esModule: true,
  default: () => React.createElement('span', {}, '+'),
}));

vi.mock('@mui/icons-material/Security', () => ({
  __esModule: true,
  default: () => React.createElement('span', {}, '🔒'),
}));

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
    // Use getByLabelText for more reliable field selection
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

    fireEvent.click(screen.getByRole('button', { name: /Create Vault/i }));
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
    fireEvent.click(screen.getByRole('button', { name: /Create Vault/i }));
    expect(
      await screen.findByText(/Please enter a master password/i)
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Master Password$/i), {
      target: { value: 'weak' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm Master Password/i), {
      target: { value: 'weak' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Create Vault/i }));
    expect(await screen.findByText(/weak/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Master Password$/i), {
      target: { value: 'StrongPass123!' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm Master Password/i), {
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
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
