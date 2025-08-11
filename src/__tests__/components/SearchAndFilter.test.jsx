import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import SearchAndFilter from '../../components/SearchAndFilter';

// Mock MUI to simplify Select behavior in tests
vi.mock('@mui/material', async () => {
  const real = await vi.importActual('@mui/material');
  return {
    ...real,
    // simple passthrough FormControl
    FormControl: (props) => <div {...props} />,
    // connect label to select via htmlFor/aria-labelledby
    InputLabel: (props) => (
      <label id={props.id} htmlFor="category-select">
        {props.children}
      </label>
    ),
    // make Select a native select for easy change events
    Select: (props) => {
      const { children, value, onChange, id, labelId, ...rest } = props;
      // Transform children into plain <option> elements with string labels
      const options = [];
      React.Children.forEach(children, (child) => {
        if (!child) return;
        const cprops = child.props || {};
        const optValue = cprops.value;
        let labelText = '';
        // Try to extract a string label from various child shapes
        const childContent = cprops.children;
        if (typeof childContent === 'string') {
          labelText = childContent;
        } else if (Array.isArray(childContent)) {
          // pick the last string in the array, typical when text follows an icon/box
          const strings = childContent.filter((n) => typeof n === 'string');
          labelText = strings[strings.length - 1] || String(optValue ?? '');
        } else if (
          childContent &&
          typeof childContent === 'object' &&
          childContent.props
        ) {
          // handle a wrapper element like <Box>{Icon}{name}</Box>
          const inner = childContent.props.children;
          if (typeof inner === 'string') {
            labelText = inner;
          } else if (Array.isArray(inner)) {
            const strings = inner.filter((n) => typeof n === 'string');
            labelText = strings[strings.length - 1] || String(optValue ?? '');
          } else {
            labelText = String(optValue ?? '');
          }
        } else {
          labelText = String(optValue ?? '');
        }
        options.push(
          <option key={String(optValue)} value={optValue}>
            {labelText}
          </option>
        );
      });
      return (
        <select
          id={id}
          aria-labelledby={labelId}
          value={value}
          onChange={(e) => onChange({ target: { value: e.target.value } })}
          {...rest}
        >
          {options}
        </select>
      );
    },
  };
});

describe('SearchAndFilter Component', () => {
  const mockOnSearch = vi.fn();
  const mockOnFilter = vi.fn();
  const mockOnReset = vi.fn();

  const categories = [
    { id: '1', name: 'Social', icon: 'people' },
    { id: '2', name: 'Work', icon: 'work' },
    { id: '3', name: 'Personal', icon: 'person' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders search input and filter dropdown', () => {
    render(
      <SearchAndFilter
        searchTerm=""
        onSearchChange={mockOnSearch}
        selectedCategory=""
        onCategoryChange={mockOnFilter}
        onClearFilters={mockOnReset}
        entriesCount={10}
        filteredCount={10}
      />
    );

    expect(
      screen.getByPlaceholderText('Search entries...')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Category')).toBeInTheDocument();
  });

  it('calls onSearchChange when typing in search input', () => {
    render(
      <SearchAndFilter
        searchTerm=""
        onSearchChange={mockOnSearch}
        selectedCategory=""
        onCategoryChange={mockOnFilter}
        onClearFilters={mockOnReset}
        entriesCount={10}
        filteredCount={10}
      />
    );

    const searchInput = screen.getByPlaceholderText('Search entries...');
    fireEvent.change(searchInput, { target: { value: 'test' } });
    expect(mockOnSearch).toHaveBeenCalledWith('test');
  });

  it('calls onCategoryChange when selecting a category', () => {
    render(
      <SearchAndFilter
        searchTerm=""
        onSearchChange={mockOnSearch}
        selectedCategory=""
        onCategoryChange={mockOnFilter}
        onClearFilters={mockOnReset}
        entriesCount={10}
        filteredCount={10}
      />
    );

    // ensure no previous calls interfere
    mockOnFilter.mockClear();
    const categorySelect = screen.getByLabelText('Category', {
      selector: 'select',
    });
    fireEvent.change(categorySelect, { target: { value: 'work' } });
    expect(mockOnFilter).toHaveBeenLastCalledWith('work');
  });

  it('calls onClearFilters when clear button is clicked', () => {
    render(
      <SearchAndFilter
        searchTerm="hello"
        onSearchChange={mockOnSearch}
        selectedCategory="1"
        onCategoryChange={mockOnFilter}
        onClearFilters={mockOnReset}
        entriesCount={10}
        filteredCount={5}
      />
    );

    // Clear all filters button has title "Clear all filters"
    const clearBtn = screen.getByTitle('Clear all filters');
    fireEvent.click(clearBtn);
    expect(mockOnReset).toHaveBeenCalled();
  });

  it('allows selecting All Categories option', () => {
    render(
      <SearchAndFilter
        searchTerm=""
        onSearchChange={mockOnSearch}
        selectedCategory=""
        onCategoryChange={mockOnFilter}
        onClearFilters={mockOnReset}
        entriesCount={10}
        filteredCount={10}
      />
    );

    mockOnFilter.mockClear();
    const categorySelect = screen.getByLabelText('Category', {
      selector: 'select',
    });
    fireEvent.change(categorySelect, { target: { value: '' } });
    expect(mockOnFilter).toHaveBeenLastCalledWith('');
  });
});
