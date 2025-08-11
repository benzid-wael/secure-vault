import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import RecoveryKeyDisplay from '../../components/RecoveryKeyDisplay';

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn(),
  },
});

describe('RecoveryKeyDisplay', () => {
  const mockOnClose = vi.fn();
  const mockOnRegenerateKey = vi.fn();
  const defaultProps = {
    open: true,
    onClose: mockOnClose,
    recoveryKey: 'ABCD-EFGH-1234-5678-IJKL-MNOP-QRST-UVWX',
    vaultName: 'test-vault',
    vaultPassword: 'password123',
    onRegenerateKey: mockOnRegenerateKey,
    isNewVault: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly when open', () => {
    render(<RecoveryKeyDisplay {...defaultProps} />);

    expect(screen.getByText('Vault Recovery Key')).toBeInTheDocument();
    expect(
      screen.getByText('Recovery Key for "test-vault"')
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Important: Save this recovery key/)
    ).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<RecoveryKeyDisplay {...defaultProps} open={false} />);

    expect(screen.queryByText('Vault Recovery Key')).not.toBeInTheDocument();
  });

  it('shows different title for new vault', () => {
    render(<RecoveryKeyDisplay {...defaultProps} isNewVault={true} />);

    expect(
      screen.getByText('Vault Recovery Key Generated')
    ).toBeInTheDocument();
    expect(
      screen.getByText('I have saved my recovery key')
    ).toBeInTheDocument();
  });

  it('hides recovery key by default', () => {
    render(<RecoveryKeyDisplay {...defaultProps} />);

    // Look for the specific hidden key pattern (all characters replaced with bullets)
    const expectedHiddenKey = defaultProps.recoveryKey.replace(/./g, '•');
    const keyDisplay = screen.getByText(expectedHiddenKey);
    expect(keyDisplay).toBeInTheDocument();
    expect(
      screen.queryByText(defaultProps.recoveryKey)
    ).not.toBeInTheDocument();
  });

  it('shows recovery key when visibility is toggled', () => {
    render(<RecoveryKeyDisplay {...defaultProps} />);

    const showButton = screen.getByRole('button', { name: /show key/i });
    fireEvent.click(showButton);

    expect(screen.getByText(defaultProps.recoveryKey)).toBeInTheDocument();
  });

  it('copies recovery key to clipboard', async () => {
    navigator.clipboard.writeText.mockResolvedValueOnce();

    render(<RecoveryKeyDisplay {...defaultProps} />);

    const copyButton = screen.getByRole('button', {
      name: /copy to clipboard/i,
    });
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        defaultProps.recoveryKey
      );
    });

    expect(screen.getByText('Copied to clipboard!')).toBeInTheDocument();
  });

  it('handles copy failure gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    navigator.clipboard.writeText.mockRejectedValueOnce(
      new Error('Copy failed')
    );

    render(<RecoveryKeyDisplay {...defaultProps} />);

    const copyButton = screen.getByRole('button', {
      name: /copy to clipboard/i,
    });
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to copy recovery key:',
        expect.any(Error)
      );
    });

    consoleSpy.mockRestore();
  });

  it('calls onRegenerateKey when regenerate button is clicked', async () => {
    mockOnRegenerateKey.mockResolvedValueOnce();

    render(<RecoveryKeyDisplay {...defaultProps} />);

    const regenerateButton = screen.getByRole('button', {
      name: /generate new recovery key/i,
    });
    fireEvent.click(regenerateButton);

    await waitFor(() => {
      expect(mockOnRegenerateKey).toHaveBeenCalled();
    });
  });

  it('shows loading state during regeneration', async () => {
    let resolveRegenerate;
    const regeneratePromise = new Promise((resolve) => {
      resolveRegenerate = resolve;
    });
    mockOnRegenerateKey.mockReturnValueOnce(regeneratePromise);

    render(<RecoveryKeyDisplay {...defaultProps} />);

    const regenerateButton = screen.getByRole('button', {
      name: /generate new recovery key/i,
    });
    fireEvent.click(regenerateButton);

    expect(regenerateButton).toBeDisabled();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();

    resolveRegenerate();
    await waitFor(() => {
      expect(regenerateButton).not.toBeDisabled();
    });
  });

  it('does not show regenerate button when onRegenerateKey is not provided', () => {
    render(
      <RecoveryKeyDisplay {...defaultProps} onRegenerateKey={undefined} />
    );

    expect(
      screen.queryByRole('button', { name: /generate new recovery key/i })
    ).not.toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    render(<RecoveryKeyDisplay {...defaultProps} />);

    const closeButton = screen.getByText('Close');
    fireEvent.click(closeButton);

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('displays recovery key guidelines', () => {
    render(<RecoveryKeyDisplay {...defaultProps} />);

    expect(screen.getByText('Recovery Key Guidelines:')).toBeInTheDocument();
    expect(screen.getByText(/Write it down on paper/)).toBeInTheDocument();
    expect(
      screen.getByText(/Consider storing a copy in a secure password manager/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Do not store it on the same device/)
    ).toBeInTheDocument();
  });

  it('handles empty recovery key gracefully', () => {
    render(<RecoveryKeyDisplay {...defaultProps} recoveryKey="" />);

    const copyButton = screen.getByRole('button', {
      name: /copy to clipboard/i,
    });
    fireEvent.click(copyButton);

    // Should not crash and should not call clipboard API
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('formats recovery key display correctly when hidden', () => {
    const longKey = 'ABCD-EFGH-1234-5678-IJKL-MNOP-QRST-UVWX-YZAB-CDEF';
    render(<RecoveryKeyDisplay {...defaultProps} recoveryKey={longKey} />);

    // Should show dots for each character
    const hiddenKey = screen.getByText(new RegExp('•'.repeat(longKey.length)));
    expect(hiddenKey).toBeInTheDocument();
  });
});
