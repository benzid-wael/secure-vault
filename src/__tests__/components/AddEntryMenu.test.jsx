// Unit tests for AddEntryMenu component
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import AddEntryMenu from '../../components/AddEntryMenu';

// Mock Material-UI components
vi.mock('@mui/material/Fab', () => ({
  __esModule: true,
  default: ({ children, onClick, disabled, ...props }) =>
    React.createElement(
      'button',
      {
        onClick,
        disabled,
        'data-testid': 'fab-button',
        'aria-label': props['aria-label'] || 'add entry',
        ...props,
      },
      children
    ),
}));

vi.mock('@mui/material/Menu', () => ({
  __esModule: true,
  default: ({ children, open, onClose, ...props }) =>
    open
      ? React.createElement(
          'div',
          {
            'data-testid': 'menu',
            onClick: onClose,
            ...props,
          },
          children
        )
      : null,
}));

vi.mock('@mui/material/MenuItem', () => ({
  __esModule: true,
  default: ({ children, onClick, ...props }) =>
    React.createElement(
      'div',
      {
        'data-testid': 'menu-item',
        onClick,
        role: 'menuitem',
        ...props,
      },
      children
    ),
}));

vi.mock('@mui/material/ListItemIcon', () => ({
  __esModule: true,
  default: ({ children, ...props }) =>
    React.createElement(
      'span',
      { 'data-testid': 'list-item-icon', ...props },
      children
    ),
}));

vi.mock('@mui/material/ListItemText', () => ({
  __esModule: true,
  default: ({ primary, secondary, ...props }) =>
    React.createElement(
      'div',
      { 'data-testid': 'list-item-text', ...props },
      React.createElement('div', {}, primary),
      React.createElement('div', {}, secondary)
    ),
}));

vi.mock('@mui/material/Typography', () => ({
  __esModule: true,
  default: ({ children, ...props }) =>
    React.createElement(
      'span',
      { 'data-testid': 'typography', ...props },
      children
    ),
}));

vi.mock('@mui/material/Box', () => ({
  __esModule: true,
  default: ({ children, ...props }) =>
    React.createElement('div', { 'data-testid': 'box', ...props }, children),
}));

vi.mock('@mui/material/Divider', () => ({
  __esModule: true,
  default: (props) =>
    React.createElement('hr', { 'data-testid': 'divider', ...props }),
}));

// Mock icons
vi.mock('@mui/icons-material', () => ({
  Add: () => React.createElement('span', {}, 'AddIcon'),
  KeyboardArrowUp: () => React.createElement('span', {}, 'ArrowUpIcon'),
  Lock: () => React.createElement('span', {}, 'PasswordIcon'),
  Wifi: () => React.createElement('span', {}, 'WifiIcon'),
  Security: () => React.createElement('span', {}, 'OTPIcon'),
  VpnKey: () => React.createElement('span', {}, 'SSHIcon'),
  Key: () => React.createElement('span', {}, 'GPGIcon'),
  Note: () => React.createElement('span', {}, 'NoteIcon'),
  AccountBalance: () => React.createElement('span', {}, 'BankIcon'),
  CreditCard: () => React.createElement('span', {}, 'CreditCardIcon'),
  Grid3x3: () => React.createElement('span', {}, 'Level3CardIcon'),
}));

describe('AddEntryMenu', () => {
  const mockOnEntryTypeSelect = vi.fn();

  const defaultProps = {
    onEntryTypeSelect: mockOnEntryTypeSelect,
    disabled: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders FAB button', () => {
    render(<AddEntryMenu {...defaultProps} />);
    expect(screen.getByLabelText('add entry')).toBeInTheDocument();
  });

  it('opens menu when FAB is clicked', () => {
    render(<AddEntryMenu {...defaultProps} />);

    const fabButton = screen.getByLabelText('add entry');
    fireEvent.click(fabButton);

    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('shows entry type options in menu', () => {
    render(<AddEntryMenu {...defaultProps} />);

    const fabButton = screen.getByLabelText('add entry');
    fireEvent.click(fabButton);

    // Check for some entry types
    expect(screen.getByText('Password')).toBeInTheDocument();
    expect(screen.getByText('WiFi Password')).toBeInTheDocument();
    expect(screen.getByText('OTP/2FA')).toBeInTheDocument();
  });

  it('calls onEntryTypeSelect when entry type is clicked', () => {
    render(<AddEntryMenu {...defaultProps} />);

    const fabButton = screen.getByLabelText('add entry');
    fireEvent.click(fabButton);

    // Find and click a menu item
    const menuItems = screen.getAllByRole('menuitem');
    fireEvent.click(menuItems[0]);

    expect(mockOnEntryTypeSelect).toHaveBeenCalled();
  });

  it('disables FAB when disabled prop is true', () => {
    render(<AddEntryMenu {...defaultProps} disabled={true} />);

    const fabButton = screen.getByLabelText('add entry');
    expect(fabButton).toBeDisabled();
  });

  it('closes menu when clicked outside', () => {
    render(<AddEntryMenu {...defaultProps} />);

    const fabButton = screen.getByLabelText('add entry');
    fireEvent.click(fabButton);

    expect(screen.getByRole('menu')).toBeInTheDocument();

    // Click on backdrop to close menu
    const backdrop = screen
      .getByRole('presentation')
      .querySelector('.MuiBackdrop-root');
    fireEvent.click(backdrop);

    // Menu should close (not be in document anymore)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('shows grouped entry types', () => {
    render(<AddEntryMenu {...defaultProps} />);

    const fabButton = screen.getByLabelText('add entry');
    fireEvent.click(fabButton);

    // Check for group headers (case sensitive)
    expect(screen.getByText('Authentication & Security')).toBeInTheDocument();
    expect(screen.getByText('Network & Keys')).toBeInTheDocument();
    expect(screen.getByText('Financial')).toBeInTheDocument();
    expect(screen.getByText('Personal')).toBeInTheDocument();
  });

  it('shows entry descriptions', () => {
    render(<AddEntryMenu {...defaultProps} />);

    const fabButton = screen.getByLabelText('add entry');
    fireEvent.click(fabButton);

    // Check for some descriptions
    expect(screen.getByText('Store login credentials')).toBeInTheDocument();
    expect(
      screen.getByText('Store WiFi network credentials')
    ).toBeInTheDocument();
  });
});
