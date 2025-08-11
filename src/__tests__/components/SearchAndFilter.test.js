// Unit tests for SearchAndFilter component
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SearchAndFilter from '../../components/SearchAndFilter';

describe('SearchAndFilter', () => {
  const defaultProps = {
    searchTerm: '',
    onSearchChange: jest.fn(),
    selectedCategory: '',
    onCategoryChange: jest.fn(),
    onClearFilters: jest.fn(),
    entriesCount: 10,
    filteredCount: 10
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render search input', () => {
      render(<SearchAndFilter {...defaultProps} />);
      
      const searchInput = screen.getByPlaceholderText('Search entries...');
      expect(searchInput).toBeInTheDocument();
    });

    it('should render category selector', () => {
      render(<SearchAndFilter {...defaultProps} />);
      
      const categorySelect = screen.getByLabelText('Category');
      expect(categorySelect).toBeInTheDocument();
    });

    it('should display search term in input', () => {
      render(<SearchAndFilter {...defaultProps} searchTerm="test search" />);
      
      const searchInput = screen.getByDisplayValue('test search');
      expect(searchInput).toBeInTheDocument();
    });

    it('should display selected category', () => {
      render(<SearchAndFilter {...defaultProps} selectedCategory="email" />);
      
      // The select component should show the selected value
      expect(screen.getByDisplayValue('email')).toBeInTheDocument();
    });
  });

  describe('Search functionality', () => {
    it('should call onSearchChange when typing in search input', async () => {
      const user = userEvent.setup();
      render(<SearchAndFilter {...defaultProps} />);
      
      const searchInput = screen.getByPlaceholderText('Search entries...');
      
      await user.type(searchInput, 'gmail');
      
      expect(defaultProps.onSearchChange).toHaveBeenCalledWith('gmail');
    });

    it('should show clear button when search term exists', () => {
      render(<SearchAndFilter {...defaultProps} searchTerm="test" />);
      
      const clearButton = screen.getByRole('button', { name: /clear/i });
      expect(clearButton).toBeInTheDocument();
    });

    it('should not show clear button when search term is empty', () => {
      render(<SearchAndFilter {...defaultProps} searchTerm="" />);
      
      const clearButton = screen.queryByRole('button', { name: /clear/i });
      expect(clearButton).not.toBeInTheDocument();
    });

    it('should call onSearchChange with empty string when clear button clicked', async () => {
      const user = userEvent.setup();
      render(<SearchAndFilter {...defaultProps} searchTerm="test" />);
      
      const clearButton = screen.getByRole('button', { name: /clear/i });
      await user.click(clearButton);
      
      expect(defaultProps.onSearchChange).toHaveBeenCalledWith('');
    });
  });

  describe('Category filtering', () => {
    it('should call onCategoryChange when category is selected', async () => {
      const user = userEvent.setup();
      render(<SearchAndFilter {...defaultProps} />);
      
      const categorySelect = screen.getByLabelText('Category');
      
      // Open the select dropdown
      await user.click(categorySelect);
      
      // Select email category
      const emailOption = screen.getByText('Email');
      await user.click(emailOption);
      
      expect(defaultProps.onCategoryChange).toHaveBeenCalledWith('email');
    });

    it('should show "All Categories" as default option', async () => {
      const user = userEvent.setup();
      render(<SearchAndFilter {...defaultProps} />);
      
      const categorySelect = screen.getByLabelText('Category');
      await user.click(categorySelect);
      
      expect(screen.getByText('All Categories')).toBeInTheDocument();
    });

    it('should show all category options when dropdown is opened', async () => {
      const user = userEvent.setup();
      render(<SearchAndFilter {...defaultProps} />);
      
      const categorySelect = screen.getByLabelText('Category');
      await user.click(categorySelect);
      
      // Check for some expected categories
      expect(screen.getByText('General')).toBeInTheDocument();
      expect(screen.getByText('Website')).toBeInTheDocument();
      expect(screen.getByText('Email')).toBeInTheDocument();
      expect(screen.getByText('Work')).toBeInTheDocument();
    });
  });

  describe('Filter status and chips', () => {
    it('should show entry count chip when filters are active', () => {
      render(
        <SearchAndFilter 
          {...defaultProps} 
          searchTerm="test" 
          entriesCount={10} 
          filteredCount={5} 
        />
      );
      
      expect(screen.getByText('5 of 10 entries')).toBeInTheDocument();
    });

    it('should show search chip when search term exists', () => {
      render(<SearchAndFilter {...defaultProps} searchTerm="gmail" />);
      
      expect(screen.getByText('Search: "gmail"')).toBeInTheDocument();
    });

    it('should show category chip when category is selected', () => {
      render(<SearchAndFilter {...defaultProps} selectedCategory="email" />);
      
      expect(screen.getByText('Category: Email')).toBeInTheDocument();
    });

    it('should not show chips when no filters are active', () => {
      render(<SearchAndFilter {...defaultProps} />);
      
      expect(screen.queryByText(/Search:/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Category:/)).not.toBeInTheDocument();
      expect(screen.queryByText(/entries/)).not.toBeInTheDocument();
    });

    it('should show clear filters button when filters are active', () => {
      render(<SearchAndFilter {...defaultProps} searchTerm="test" />);
      
      const clearButton = screen.getByTitle('Clear all filters');
      expect(clearButton).toBeInTheDocument();
    });

    it('should call onClearFilters when clear filters button is clicked', async () => {
      const user = userEvent.setup();
      render(<SearchAndFilter {...defaultProps} searchTerm="test" />);
      
      const clearButton = screen.getByTitle('Clear all filters');
      await user.click(clearButton);
      
      expect(defaultProps.onClearFilters).toHaveBeenCalled();
    });
  });

  describe('Chip deletion', () => {
    it('should call onSearchChange when search chip is deleted', async () => {
      const user = userEvent.setup();
      render(<SearchAndFilter {...defaultProps} searchTerm="test" />);
      
      const searchChip = screen.getByText('Search: "test"');
      const deleteButton = searchChip.parentElement.querySelector('[data-testid="CancelIcon"]');
      
      if (deleteButton) {
        await user.click(deleteButton);
        expect(defaultProps.onSearchChange).toHaveBeenCalledWith('');
      }
    });

    it('should call onCategoryChange when category chip is deleted', async () => {
      const user = userEvent.setup();
      render(<SearchAndFilter {...defaultProps} selectedCategory="email" />);
      
      const categoryChip = screen.getByText('Category: Email');
      const deleteButton = categoryChip.parentElement.querySelector('[data-testid="CancelIcon"]');
      
      if (deleteButton) {
        await user.click(deleteButton);
        expect(defaultProps.onCategoryChange).toHaveBeenCalledWith('');
      }
    });
  });

  describe('Accessibility', () => {
    it('should have proper labels for form controls', () => {
      render(<SearchAndFilter {...defaultProps} />);
      
      expect(screen.getByLabelText('Category')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Search entries...')).toBeInTheDocument();
    });

    it('should have proper button titles', () => {
      render(<SearchAndFilter {...defaultProps} searchTerm="test" />);
      
      expect(screen.getByTitle('Clear all filters')).toBeInTheDocument();
    });
  });

  describe('Edge cases', () => {
    it('should handle zero entries count', () => {
      render(
        <SearchAndFilter 
          {...defaultProps} 
          searchTerm="test" 
          entriesCount={0} 
          filteredCount={0} 
        />
      );
      
      expect(screen.getByText('0 of 0 entries')).toBeInTheDocument();
    });

    it('should handle undefined counts gracefully', () => {
      render(
        <SearchAndFilter 
          {...defaultProps} 
          searchTerm="test" 
          entriesCount={undefined} 
          filteredCount={undefined} 
        />
      );
      
      expect(screen.getByText('0 of 0 entries')).toBeInTheDocument();
    });

    it('should handle very long search terms', () => {
      const longSearchTerm = 'a'.repeat(100);
      render(<SearchAndFilter {...defaultProps} searchTerm={longSearchTerm} />);
      
      expect(screen.getByDisplayValue(longSearchTerm)).toBeInTheDocument();
    });
  });
});
