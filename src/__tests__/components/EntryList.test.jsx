import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import EntryList from '../../components/EntryList';

// Simplify MUI Menu to avoid portal/popover complexity
vi.mock('@mui/material', async () => {
  const real = await vi.importActual('@mui/material');
  return {
    ...real,
    Menu: ({ open, children }) =>
      open ? <div role="menu">{children}</div> : null,
  };
});

describe('EntryList Component', () => {
  const mockOnEdit = vi.fn();
  const mockOnDelete = vi.fn();
  const mockOnCopyPassword = vi.fn();

  const entries = [
    {
      id: '1',
      title: 'Test Entry 1',
      username: 'user1',
      password: 'p@ssw0rd',
      category: 'work',
      url: 'https://example.com',
    },
    {
      id: '2',
      title: 'Test Entry 2',
      username: 'user2',
      password: 'secret',
      category: 'email',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a list of entries', () => {
    render(
      <EntryList
        entries={entries}
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
        onCopyPassword={mockOnCopyPassword}
      />
    );

    expect(screen.getByText('Test Entry 1')).toBeInTheDocument();
    expect(screen.getByText('Test Entry 2')).toBeInTheDocument();
    expect(screen.getByText('user1')).toBeInTheDocument();
  });

  it('calls onEdit when Edit is selected from the menu', () => {
    render(
      <EntryList
        entries={entries}
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
        onCopyPassword={mockOnCopyPassword}
      />
    );

    // Open menu of first card
    const openMenuButtons = screen.getAllByLabelText('Open menu');
    fireEvent.click(openMenuButtons[0]);
    fireEvent.click(screen.getByText('Edit'));
    expect(mockOnEdit).toHaveBeenCalledWith(entries[0]);
  });

  it('calls onDelete when Delete is selected from the menu', () => {
    render(
      <EntryList
        entries={entries}
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
        onCopyPassword={mockOnCopyPassword}
      />
    );

    const openMenuButtons = screen.getAllByLabelText('Open menu');
    fireEvent.click(openMenuButtons[0]);
    fireEvent.click(screen.getByText('Delete'));
    expect(mockOnDelete).toHaveBeenCalledWith(entries[0].id);
  });

  it('displays a message when no entries are provided', () => {
    render(
      <EntryList
        entries={[]}
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
        onCopyPassword={mockOnCopyPassword}
      />
    );

    expect(screen.getByText('No password entries found')).toBeInTheDocument();
  });

  it('calls onCopyPassword when copy icon is clicked', () => {
    render(
      <EntryList
        entries={entries}
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
        onCopyPassword={mockOnCopyPassword}
      />
    );

    const copyButtons = screen.getAllByLabelText('Copy Password');
    fireEvent.click(copyButtons[0]);
    expect(mockOnCopyPassword).toHaveBeenCalledWith(entries[0].password);
  });
});
