import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import VaultLogin from '../../components/VaultLogin';

// Mock MUI components
vi.mock('@mui/material', async () => {
  const actual = await vi.importActual('@mui/material');
  return {
    ...actual,
    TextField: ({
      label,
      value,
      onChange,
      type,
      InputProps,
      fullWidth,
      error,
      helperText,
      required,
      sx,
      ...props
    }) => (
      <div>
        <label>
          {label}
          <input
            type={type || 'text'}
            value={value}
            onChange={onChange}
            data-testid={`input-${label.toLowerCase().replace(/\s+/g, '-')}`}
            {...props}
          />
          {InputProps?.endAdornment}
        </label>
      </div>
    ),
    IconButton: ({ children, onClick, ...props }) => (
      <button onClick={onClick} data-testid="icon-button" {...props}>
        {children}
      </button>
    ),
  };
});

// Mock MUI icons
vi.mock('@mui/icons-material/Visibility', () => ({
  __esModule: true,
  default: () => <span data-testid="visibility-icon">visibility</span>,
}));

vi.mock('@mui/icons-material/VisibilityOff', () => ({
  __esModule: true,
  default: () => <span data-testid="visibility-off-icon">visibility_off</span>,
}));

vi.mock('@mui/icons-material/ArrowBack', () => ({
  __esModule: true,
  default: () => <span data-testid="arrow-back-icon">arrow_back</span>,
}));

vi.mock('@mui/icons-material/Lock', () => ({
  __esModule: true,
  default: () => <span data-testid="lock-icon">lock</span>,
}));

describe('VaultLogin', () => {
  const onLogin = vi.fn();
  const onBack = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly with vault name', () => {
    render(<VaultLogin vaultName="work" onLogin={onLogin} onBack={onBack} />);

    // Check if vault name is displayed
    expect(screen.getByText('work')).toBeInTheDocument();
    expect(
      screen.getByText('Enter your master password to unlock this vault')
    ).toBeInTheDocument();
    expect(screen.getByTestId('input-master-password')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /unlock vault/i })
    ).toBeInTheDocument();
  });

  it('disables unlock button when password is empty', () => {
    render(<VaultLogin vaultName="work" onLogin={onLogin} onBack={onBack} />);
    const unlockButton = screen.getByRole('button', { name: /unlock vault/i });
    expect(unlockButton).toBeDisabled();

    // Test that button enables when password is entered
    const passwordInput = screen.getByTestId('input-master-password');
    fireEvent.change(passwordInput, { target: { value: 'test' } });
    expect(unlockButton).not.toBeDisabled();
  });

  it('toggles password visibility', () => {
    render(<VaultLogin vaultName="work" onLogin={onLogin} onBack={onBack} />);

    // Initially password should be hidden
    const passwordInput = screen.getByTestId('input-master-password');
    expect(passwordInput).toHaveAttribute('type', 'password');

    // Toggle visibility (second icon button is the visibility toggle)
    const toggleButton = screen.getAllByTestId('icon-button')[1];
    fireEvent.click(toggleButton);

    // Password should be visible
    expect(passwordInput).toHaveAttribute('type', 'text');
  });

  it('handles login success', async () => {
    onLogin.mockResolvedValueOnce({ success: true });
    render(<VaultLogin vaultName="work" onLogin={onLogin} onBack={onBack} />);

    const passwordInput = screen.getByTestId('input-master-password');
    const unlockButton = screen.getByRole('button', { name: /unlock vault/i });

    fireEvent.change(passwordInput, { target: { value: 'correctpass' } });
    fireEvent.click(unlockButton);

    expect(onLogin).toHaveBeenCalledWith('correctpass');
    await waitFor(() => {
      expect(screen.queryByText(/invalid password/i)).not.toBeInTheDocument();
    });
  });

  it('shows error on login failure', async () => {
    onLogin.mockResolvedValueOnce({
      success: false,
      error: 'Invalid password',
    });
    render(<VaultLogin vaultName="work" onLogin={onLogin} onBack={onBack} />);

    const passwordInput = screen.getByTestId('input-master-password');
    const unlockButton = screen.getByRole('button', { name: /unlock vault/i });

    fireEvent.change(passwordInput, { target: { value: 'wrongpass' } });
    fireEvent.click(unlockButton);

    expect(await screen.findByText(/invalid password/i)).toBeInTheDocument();
  });

  it('shows loading state during login', async () => {
    let resolveLogin;
    onLogin.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLogin = () => resolve({ success: true });
        })
    );

    render(<VaultLogin vaultName="work" onLogin={onLogin} onBack={onBack} />);

    const passwordInput = screen.getByTestId('input-master-password');
    const unlockButton = screen.getByRole('button', { name: /unlock vault/i });

    fireEvent.change(passwordInput, { target: { value: 'testpass' } });
    fireEvent.click(unlockButton);

    // Button should be disabled during login
    expect(unlockButton).toBeDisabled();

    // Resolve the login promise
    resolveLogin();
    await waitFor(() => {
      expect(unlockButton).not.toBeDisabled();
    });
  });

  it('calls onBack when back button is clicked', () => {
    render(<VaultLogin vaultName="work" onLogin={onLogin} onBack={onBack} />);
    const backButton = screen.getAllByTestId('icon-button')[0]; // First icon button is the back button
    fireEvent.click(backButton);
    expect(onBack).toHaveBeenCalled();
  });

  it('shows error when submitting empty password', async () => {
    render(<VaultLogin vaultName="work" onLogin={onLogin} onBack={onBack} />);

    // Try to submit with empty password by triggering form submit
    const passwordInput = screen.getByTestId('input-master-password');
    fireEvent.change(passwordInput, { target: { value: '' } });

    const form = passwordInput.closest('form');
    fireEvent.submit(form);

    expect(
      await screen.findByText(/please enter your vault password/i)
    ).toBeInTheDocument();
    expect(onLogin).not.toHaveBeenCalled();
  });
});
