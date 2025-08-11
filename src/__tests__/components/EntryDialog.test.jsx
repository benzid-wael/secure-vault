import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Mock MUI components used in EntryDialog
vi.mock('@mui/material/MenuItem', () => ({
  __esModule: true,
  default: ({ children, ...props }) =>
    React.createElement(
      'option',
      { 'data-testid': 'menu-item', ...props },
      children
    ),
}));

vi.mock('@mui/material/Select', () => ({
  __esModule: true,
  default: ({ children, value, onChange, ...props }) =>
    React.createElement(
      'select',
      {
        'data-testid': 'select',
        value,
        onChange: (e) => onChange({ target: { value: e.target.value } }),
        ...props,
      },
      children
    ),
}));

vi.mock('@mui/material/FormControl', () => ({
  __esModule: true,
  default: ({ children, ...props }) =>
    React.createElement('div', { 'data-testid': 'form-control', ...props }, children),
}));

vi.mock('@mui/material/InputLabel', () => ({
  __esModule: true,
  default: (props) => React.createElement('label', { 'data-testid': 'input-label', ...props }),
}));

vi.mock('@mui/material/Box', () => ({
  __esModule: true,
  default: (props) => React.createElement('div', { 'data-testid': 'box', ...props }),
}));

vi.mock('@mui/material/TextField', () => ({
  __esModule: true,
  default: ({ label, type, value, onChange, InputProps, ...props }) =>
    React.createElement('div', {},
      React.createElement('label', {
        'data-testid': `text-field-${label.toLowerCase().replace(/\s+/g, '-')}`
      },
        label,
        React.createElement('input', {
          type: type || 'text',
          value: value || '',
          onChange,
          'data-testid': `input-${label.toLowerCase().replace(/\s+/g, '-')}`,
          ...props
        }),
        InputProps?.endAdornment
      )
    ),
}));

vi.mock('@mui/material/IconButton', () => ({
  __esModule: true,
  default: ({ children, onClick, ...props }) =>
    React.createElement('button', { onClick, 'data-testid': 'icon-button', ...props }, children),
}));

vi.mock('@mui/material/Dialog', () => ({
  __esModule: true,
  default: ({ children, open }) =>
    open ? React.createElement('div', { 'data-testid': 'dialog' }, children) : null,
}));

vi.mock('@mui/material/DialogTitle', () => ({
  __esModule: true,
  default: ({ children }) => React.createElement('h2', { 'data-testid': 'dialog-title' }, children),
}));

vi.mock('@mui/material/DialogContent', () => ({
  __esModule: true,
  default: ({ children }) => React.createElement('div', { 'data-testid': 'dialog-content' }, children),
}));

vi.mock('@mui/material/DialogActions', () => ({
  __esModule: true,
  default: ({ children }) => React.createElement('div', { 'data-testid': 'dialog-actions' }, children),
}));

// Mock password generator to deterministic value
vi.mock('../../utils/passwordGenerator', () => ({
  generatePassword: vi.fn(() => 'GenPass!2345'),
}));

// Mock category manager to simple categories with stub icons
vi.mock('../../utils/categoryManager', () => ({
  CATEGORIES: [
    {
      id: 'general',
      name: 'General',
      icon: () => React.createElement('span', {}, 'Icon'),
      color: '#000',
    },
    { id: 'work', name: 'Work', icon: () => React.createElement('span', {}, 'Icon'), color: '#000' },
  ],
  getCategoryById: (id) => ({
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    icon: () => React.createElement('span', {}, 'Icon'),
    color: '#000',
  }),
}));

import EntryDialog from '../../components/EntryDialog';

describe('EntryDialog', () => {
  const onClose = vi.fn();
  const onSave = vi.fn();
  const onValidationErrorsChange = vi.fn();

  const renderDialog = (props = {}) => {
    const defaultProps = {
      open: true,
      onClose,
      onSave,
      onValidationErrorsChange,
      validationErrors: {},
      ...props,
    };
    return render(React.createElement(EntryDialog, defaultProps));
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders dialog with form fields', () => {
    renderDialog();

    expect(screen.getByTestId('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('dialog-title')).toHaveTextContent(
      'Add New Password Entry'
    );

    // Check all form fields are rendered
    expect(screen.getByTestId('input-title')).toBeInTheDocument();
    expect(screen.getByTestId('input-username')).toBeInTheDocument();
    expect(screen.getByTestId('input-password')).toBeInTheDocument();
    expect(screen.getByTestId('input-url')).toBeInTheDocument();
    expect(screen.getByTestId('input-notes')).toBeInTheDocument();

    // Check buttons
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /add entry/i })
    ).toBeInTheDocument();
  });

  it('initializes empty form for create and saves with input data', () => {
    renderDialog();

    // Fill in the form
    fireEvent.change(screen.getByTestId('input-title'), {
      target: { value: 'My Title' },
    });
    fireEvent.change(screen.getByTestId('input-username'), {
      target: { value: 'user' },
    });
    fireEvent.change(screen.getByTestId('input-password'), {
      target: { value: 'Secret123!' },
    });
    fireEvent.change(screen.getByTestId('input-url'), {
      target: { value: 'https://example.com' },
    });
    fireEvent.change(screen.getByTestId('input-notes'), {
      target: { value: 'note' },
    });

    // Change category
    fireEvent.change(screen.getByTestId('select'), {
      target: { value: 'work' },
    });

    // Submit the form
    fireEvent.click(screen.getByRole('button', { name: /add entry/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'My Title',
        username: 'user',
        password: 'Secret123!',
        url: 'https://example.com',
        notes: 'note',
        category: 'work',
      })
    );
  });

  it('toggles password visibility and generates password', () => {
    renderDialog();

    // Get all icon buttons (toggle and generate)
    const iconButtons = screen.getAllByTestId('icon-button');
    // The generate button is the second one
    const generateButton = iconButtons[1];

    // Click generate password
    fireEvent.click(generateButton);

    // Check if password was generated
    expect(screen.getByTestId('input-password')).toHaveValue('GenPass!2345');
  });

  it('populates fields when editing', () => {
    const entry = {
      id: '1',
      title: 'Test Entry',
      username: 'testuser',
      password: 'testpass',
      url: 'http://test.com',
      notes: 'test note',
      category: 'work',
    };

    renderDialog({ entry, editMode: true });

    // Check if fields are populated with entry data
    expect(screen.getByTestId('input-title')).toHaveValue('Test Entry');
    expect(screen.getByTestId('input-username')).toHaveValue('testuser');
    expect(screen.getByTestId('input-password')).toHaveValue('testpass');
    expect(screen.getByTestId('input-url')).toHaveValue('http://test.com');
    expect(screen.getByTestId('input-notes')).toHaveValue('test note');
    expect(screen.getByTestId('select')).toHaveValue('work');

    // Check if title changed to Edit Password Entry
    expect(screen.getByTestId('dialog-title')).toHaveTextContent('Edit Password Entry');
    // Check if button text changed to Update Entry
    expect(
      screen.getByRole('button', { name: /update entry/i })
    ).toBeInTheDocument();
  });

  it('resets and calls onClose when cancel', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows validation errors', () => {
    const validationErrors = {
      title: 'Title is required',
      password: 'Password is required',
    };

    renderDialog({ validationErrors });

    // Check if validation errors are displayed
    expect(screen.getByText('Title is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
  });
});
