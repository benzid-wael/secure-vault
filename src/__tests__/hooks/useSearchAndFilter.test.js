// Unit tests for useSearchAndFilter hook
import { renderHook, act } from '@testing-library/react';
import { useSearchAndFilter } from '../../hooks/useSearchAndFilter';

// Simple test data instead of importing fixtures
const testEntries = [
  {
    id: '1',
    title: 'Gmail Account',
    username: 'user@gmail.com',
    password: 'SecurePass123!',
    url: 'https://gmail.com',
    category: 'email',
  },
  {
    id: '2',
    title: 'Facebook',
    username: 'john.doe',
    password: 'MyFacebookPass456@',
    url: 'https://facebook.com',
    category: 'website',
  },
  {
    id: '3',
    title: 'Work Database',
    username: 'admin',
    password: 'WorkDB789#',
    url: 'https://company-db.com',
    category: 'work',
  },
  {
    id: '4',
    title: 'Banking App',
    username: 'customer123',
    password: 'BankSecure999$',
    url: 'https://mybank.com',
    category: 'finance',
  },
];

describe('useSearchAndFilter', () => {
  it('should initialize with default values', () => {
    const { result } = renderHook(() => useSearchAndFilter(testEntries));

    expect(result.current.searchTerm).toBe('');
    expect(result.current.selectedCategory).toBe('');
    expect(result.current.filteredEntries).toEqual(testEntries);
  });

  it('should filter entries by search term', () => {
    const { result } = renderHook(() => useSearchAndFilter(testEntries));

    act(() => {
      result.current.setSearchTerm('gmail');
    });

    expect(result.current.searchTerm).toBe('gmail');
    expect(result.current.filteredEntries).toHaveLength(1);
    expect(result.current.filteredEntries[0].title).toBe('Gmail Account');
  });

  it('should filter entries by search term case-insensitively', () => {
    const { result } = renderHook(() => useSearchAndFilter(testEntries));

    act(() => {
      result.current.setSearchTerm('GMAIL');
    });

    expect(result.current.filteredEntries).toHaveLength(1);
    expect(result.current.filteredEntries[0].title).toBe('Gmail Account');
  });

  it('should filter entries by username', () => {
    const { result } = renderHook(() => useSearchAndFilter(testEntries));

    act(() => {
      result.current.setSearchTerm('john.doe');
    });

    expect(result.current.filteredEntries).toHaveLength(1);
    expect(result.current.filteredEntries[0].title).toBe('Facebook');
  });

  it('should filter entries by URL', () => {
    const { result } = renderHook(() => useSearchAndFilter(testEntries));

    act(() => {
      result.current.setSearchTerm('facebook.com');
    });

    expect(result.current.filteredEntries).toHaveLength(1);
    expect(result.current.filteredEntries[0].title).toBe('Facebook');
  });

  it('should filter entries by category', () => {
    const { result } = renderHook(() => useSearchAndFilter(testEntries));

    act(() => {
      result.current.setSelectedCategory('email');
    });

    expect(result.current.selectedCategory).toBe('email');
    expect(result.current.filteredEntries).toHaveLength(1);
    expect(result.current.filteredEntries[0].title).toBe('Gmail Account');
  });

  it('should filter entries by both search term and category', () => {
    const { result } = renderHook(() => useSearchAndFilter(testEntries));

    act(() => {
      result.current.setSearchTerm('work');
      result.current.setSelectedCategory('work');
    });

    expect(result.current.filteredEntries).toHaveLength(1);
    expect(result.current.filteredEntries[0].title).toBe('Work Database');
  });

  it('should return empty array when search term and category do not match', () => {
    const { result } = renderHook(() => useSearchAndFilter(testEntries));

    act(() => {
      result.current.setSearchTerm('gmail');
      result.current.setSelectedCategory('work');
    });

    expect(result.current.filteredEntries).toHaveLength(0);
  });

  it('should return all entries when search term is empty and no category selected', () => {
    const { result } = renderHook(() => useSearchAndFilter(testEntries));

    act(() => {
      result.current.setSearchTerm('gmail');
      result.current.setSelectedCategory('work');
    });

    expect(result.current.filteredEntries).toHaveLength(0);

    act(() => {
      result.current.clearFilters();
    });

    expect(result.current.searchTerm).toBe('');
    expect(result.current.selectedCategory).toBe('');
    expect(result.current.filteredEntries).toEqual(testEntries);
  });

  it('should handle empty entries array', () => {
    const { result } = renderHook(() => useSearchAndFilter([]));

    expect(result.current.filteredEntries).toEqual([]);

    act(() => {
      result.current.setSearchTerm('test');
    });

    expect(result.current.filteredEntries).toEqual([]);
  });

  it('should handle null entries', () => {
    const { result } = renderHook(() => useSearchAndFilter(null));

    expect(result.current.filteredEntries).toEqual([]);
  });

  it('should handle undefined entries', () => {
    const { result } = renderHook(() => useSearchAndFilter(undefined));

    expect(result.current.filteredEntries).toEqual([]);
  });

  it('should update filtered entries when entries prop changes', () => {
    const { result, rerender } = renderHook(
      ({ entries }) => useSearchAndFilter(entries),
      { initialProps: { entries: testEntries } }
    );

    expect(result.current.filteredEntries).toHaveLength(4);

    const newEntries = testEntries.slice(0, 2);
    rerender({ entries: newEntries });

    expect(result.current.filteredEntries).toHaveLength(2);
  });

  it('should maintain filters when entries prop changes', () => {
    const { result, rerender } = renderHook(
      ({ entries }) => useSearchAndFilter(entries),
      { initialProps: { entries: testEntries } }
    );

    act(() => {
      result.current.setSearchTerm('gmail');
    });

    expect(result.current.filteredEntries).toHaveLength(1);

    const newEntries = [
      ...testEntries,
      {
        id: '5',
        title: 'Gmail Work',
        username: 'work@gmail.com',
        password: 'WorkPass123!',
        category: 'work',
      },
    ];

    rerender({ entries: newEntries });

    expect(result.current.searchTerm).toBe('gmail');
    expect(result.current.filteredEntries).toHaveLength(2);
  });

  it('should clear filters correctly', () => {
    const { result } = renderHook(() => useSearchAndFilter(testEntries));

    act(() => {
      result.current.setSearchTerm('test search');
      result.current.setSelectedCategory('email');
    });

    expect(result.current.searchTerm).toBe('test search');
    expect(result.current.selectedCategory).toBe('email');

    act(() => {
      result.current.clearFilters();
    });

    expect(result.current.searchTerm).toBe('');
    expect(result.current.selectedCategory).toBe('');
    expect(result.current.filteredEntries).toEqual(testEntries);
  });
});
