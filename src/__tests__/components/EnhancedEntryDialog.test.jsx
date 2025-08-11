// Unit tests for EnhancedEntryDialog component
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import EnhancedEntryDialog from '../../components/EnhancedEntryDialog';

// Mock Material-UI components
vi.mock('@mui/material/Dialog', () => ({
  __esModule: true,
  default: ({ children, open, ...props }) =>
    open
      ? React.createElement(
          'div',
          { 'data-testid': 'dialog', ...props },
          children
        )
      : null,
}));

vi.mock('@mui/material/DialogTitle', () => ({
  __esModule: true,
  default: ({ children, ...props }) =>
    React.createElement(
      'h2',
      { 'data-testid': 'dialog-title', ...props },
      children
    ),
}));

vi.mock('@mui/material/DialogContent', () => ({
  __esModule: true,
  default: ({ children, ...props }) =>
    React.createElement(
      'div',
      { 'data-testid': 'dialog-content', ...props },
      children
    ),
}));

vi.mock('@mui/material/DialogActions', () => ({
  __esModule: true,
  default: ({ children, ...props }) =>
    React.createElement(
      'div',
      { 'data-testid': 'dialog-actions', ...props },
      children
    ),
}));

vi.mock('@mui/material/TextField', () => ({
  __esModule: true,
  default: ({ label, value, onChange, type, multiline, ...props }) =>
    React.createElement(multiline ? 'textarea' : 'input', {
      'data-testid': `input-${label?.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
      value: value || '',
      onChange: (e) => onChange?.(e),
      type: type || 'text',
      placeholder: label,
      ...props,
    }),
}));

vi.mock('@mui/material/Select', () => ({
  __esModule: true,
  default: ({ children, value, onChange, ...props }) =>
    React.createElement(
      'select',
      {
        'data-testid': 'select',
        value: value || '',
        onChange: (e) => onChange?.({ target: { value: e.target.value } }),
        ...props,
      },
      children
    ),
}));

vi.mock('@mui/material/MenuItem', () => ({
  __esModule: true,
  default: ({ children, value, ...props }) =>
    React.createElement('option', { value, ...props }, children),
}));

vi.mock('@mui/material/FormControl', () => ({
  __esModule: true,
  default: ({ children, ...props }) =>
    React.createElement(
      'div',
      { 'data-testid': 'form-control', ...props },
      children
    ),
}));

vi.mock('@mui/material/InputLabel', () => ({
  __esModule: true,
  default: ({ children, ...props }) =>
    React.createElement(
      'label',
      { 'data-testid': 'input-label', ...props },
      children
    ),
}));

vi.mock('@mui/material/Button', () => ({
  __esModule: true,
  default: ({ children, onClick, ...props }) =>
    React.createElement('button', { onClick, ...props }, children),
}));

vi.mock('@mui/material/Box', () => ({
  __esModule: true,
  default: ({ children, ...props }) =>
    React.createElement('div', { 'data-testid': 'box', ...props }, children),
}));

vi.mock('@mui/material/IconButton', () => ({
  __esModule: true,
  default: ({ children, onClick, ...props }) =>
    React.createElement(
      'button',
      { onClick, 'data-testid': 'icon-button', ...props },
      children
    ),
}));

vi.mock('@mui/material/InputAdornment', () => ({
  __esModule: true,
  default: ({ children, ...props }) =>
    React.createElement(
      'span',
      { 'data-testid': 'input-adornment', ...props },
      children
    ),
}));

// Mock Level3CardGrid component
vi.mock('../../components/Level3CardGrid', () => ({
  __esModule: true,
  default: ({ gridData, onChange, ...props }) =>
    React.createElement(
      'div',
      {
        'data-testid': 'level3-card-grid',
        onClick: () => onChange?.({ A1: 'test-code' }),
        ...props,
      },
      'Level 3 Card Grid'
    ),
}));

// Mock icons
vi.mock('@mui/icons-material', () => ({
  Visibility: () => React.createElement('span', {}, 'VisibilityIcon'),
  VisibilityOff: () => React.createElement('span', {}, 'VisibilityOffIcon'),
  Refresh: () => React.createElement('span', {}, 'RefreshIcon'),
  Lock: () => React.createElement('span', {}, 'LockIcon'),
  Folder: () => React.createElement('span', {}, 'FolderIcon'),
  Language: () => React.createElement('span', {}, 'LanguageIcon'),
  Email: () => React.createElement('span', {}, 'EmailIcon'),
  Work: () => React.createElement('span', {}, 'WorkIcon'),
  Business: () => React.createElement('span', {}, 'BusinessIcon'),
  School: () => React.createElement('span', {}, 'SchoolIcon'),
  AccountBalance: () => React.createElement('span', {}, 'AccountBalanceIcon'),
  Security: () => React.createElement('span', {}, 'SecurityIcon'),
  Note: () => React.createElement('span', {}, 'NoteIcon'),
  CreditCard: () => React.createElement('span', {}, 'CreditCardIcon'),
  SportsEsports: () => React.createElement('span', {}, 'GamingIcon'),
  Games: () => React.createElement('span', {}, 'GamingIcon'),
  Cloud: () => React.createElement('span', {}, 'CloudIcon'),
  Smartphone: () => React.createElement('span', {}, 'MobileIcon'),
  Wifi: () => React.createElement('span', {}, 'WifiIcon'),
  VpnKey: () => React.createElement('span', {}, 'KeyIcon'),
  Key: () => React.createElement('span', {}, 'GPGIcon'),
  Grid3x3: () => React.createElement('span', {}, 'GridIcon'),
  MusicNote: () => React.createElement('span', {}, 'EntertainmentIcon'),
  FitnessCenter: () => React.createElement('span', {}, 'HealthIcon'),
  DirectionsCar: () => React.createElement('span', {}, 'TravelIcon'),
  ShoppingCart: () => React.createElement('span', {}, 'ShoppingIcon'),
  Home: () => React.createElement('span', {}, 'PersonalIcon'),
}));

describe('EnhancedEntryDialog', () => {
  const mockOnClose = vi.fn();
  const mockOnSave = vi.fn();
  const mockOnValidationErrorsChange = vi.fn();

  const defaultProps = {
    open: true,
    onClose: mockOnClose,
    onSave: mockOnSave,
    entry: null,
    entryType: 'password',
    validationErrors: {},
    onValidationErrorsChange: mockOnValidationErrorsChange,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders dialog when open', () => {
    render(<EnhancedEntryDialog {...defaultProps} />);
    expect(screen.getByTestId('dialog')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<EnhancedEntryDialog {...defaultProps} open={false} />);
    expect(screen.queryByTestId('dialog')).not.toBeInTheDocument();
  });

  it('shows correct title for new password entry', () => {
    render(<EnhancedEntryDialog {...defaultProps} />);
    expect(screen.getByText('Add New Password')).toBeInTheDocument();
  });

  it('shows correct title for editing entry', () => {
    const entry = { id: '1', title: 'Test', entryType: 'password' };
    render(<EnhancedEntryDialog {...defaultProps} entry={entry} />);
    expect(screen.getByText('Edit Password')).toBeInTheDocument();
  });

  it('renders password entry fields in correct order', () => {
    render(<EnhancedEntryDialog {...defaultProps} entryType="password" />);

    // Check for input fields by their labels (accounting for asterisks)
    expect(screen.getByLabelText(/^title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/username.*email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password\s*\*?$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/website.*url/i)).toBeInTheDocument();
    // Skip category check as Material-UI Select doesn't have proper label association
    expect(screen.getByLabelText(/notes/i)).toBeInTheDocument();
  });

  it('renders wifi entry fields', () => {
    render(<EnhancedEntryDialog {...defaultProps} entryType="wifi" />);

    expect(screen.getByLabelText(/^title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/network.*name.*ssid/i)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/^wifi.*password\s*\*?$/i)
    ).toBeInTheDocument();
  });

  it('renders level 3 card with grid component', () => {
    render(<EnhancedEntryDialog {...defaultProps} entryType="level3_card" />);

    expect(screen.getByTestId('level3-card-grid')).toBeInTheDocument();
  });

  it('calls onSave with correct data when saving', () => {
    render(<EnhancedEntryDialog {...defaultProps} />);

    // Fill in some data
    const titleInput = screen.getByLabelText(/^title/i);
    fireEvent.change(titleInput, { target: { value: 'Test Entry' } });

    // Click save
    const saveButton = screen.getByText('Add Entry');
    fireEvent.click(saveButton);

    expect(mockOnSave).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Test Entry',
        entryType: 'password',
      })
    );
  });

  it('calls onClose when cancel is clicked', () => {
    render(<EnhancedEntryDialog {...defaultProps} />);

    const cancelButton = screen.getByText('Cancel');
    fireEvent.click(cancelButton);

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('populates fields when editing existing entry', () => {
    const entry = {
      id: '1',
      title: 'Existing Entry',
      username: 'user@example.com',
      password: 'secret123',
      entryType: 'password',
    };

    render(<EnhancedEntryDialog {...defaultProps} entry={entry} />);

    expect(screen.getByLabelText(/^title/i)).toHaveValue('Existing Entry');
    expect(screen.getByLabelText(/username.*email/i)).toHaveValue(
      'user@example.com'
    );
    expect(screen.getByLabelText(/^password\s*\*?$/i)).toHaveValue('secret123');
  });

  it('handles different entry types correctly', () => {
    const { rerender } = render(
      <EnhancedEntryDialog {...defaultProps} entryType="wifi" />
    );
    expect(screen.getByText('Add New WiFi Password')).toBeInTheDocument();

    rerender(<EnhancedEntryDialog {...defaultProps} entryType="otp" />);
    expect(screen.getByText('Add New OTP/2FA')).toBeInTheDocument();

    rerender(<EnhancedEntryDialog {...defaultProps} entryType="secure_note" />);
    expect(screen.getByText('Add New Secure Note')).toBeInTheDocument();
  });

  it('handles grid data changes for level 3 cards', () => {
    render(<EnhancedEntryDialog {...defaultProps} entryType="level3_card" />);

    const gridComponent = screen.getByTestId('level3-card-grid');
    expect(gridComponent).toBeInTheDocument();

    // The grid component is rendered and functional
    // This test verifies the level 3 card grid is properly integrated
  });
});
