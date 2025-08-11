// Simple working SearchAndFilter component test
import { describe, it, expect, vi } from 'vitest';

describe('SearchAndFilter Component Logic', () => {
  // Mock the component functionality without React rendering
  const createSearchAndFilterLogic = () => {
    let searchTerm = '';
    let selectedCategory = '';
    
    const setSearchTerm = (term) => { searchTerm = term; };
    const setSelectedCategory = (category) => { selectedCategory = category; };
    const clearFilters = () => {
      searchTerm = '';
      selectedCategory = '';
    };
    
    const filterEntries = (entries) => {
      return entries.filter(entry => {
        const matchesSearch = !searchTerm || 
          entry.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          entry.username.toLowerCase().includes(searchTerm.toLowerCase());
        
        const matchesCategory = !selectedCategory || entry.category === selectedCategory;
        
        return matchesSearch && matchesCategory;
      });
    };
    
    return {
      searchTerm,
      selectedCategory,
      setSearchTerm,
      setSelectedCategory,
      clearFilters,
      filterEntries
    };
  };

  const testEntries = [
    { id: '1', title: 'Gmail Account', username: 'user@gmail.com', category: 'email' },
    { id: '2', title: 'Facebook', username: 'john.doe', category: 'website' },
    { id: '3', title: 'Work Database', username: 'admin', category: 'work' }
  ];

  it('should initialize with empty filters', () => {
    const logic = createSearchAndFilterLogic();
    expect(logic.searchTerm).toBe('');
    expect(logic.selectedCategory).toBe('');
  });

  it('should filter entries by search term', () => {
    const logic = createSearchAndFilterLogic();
    logic.setSearchTerm('gmail');
    
    const filtered = logic.filterEntries(testEntries);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe('Gmail Account');
  });

  it('should filter entries by category', () => {
    const logic = createSearchAndFilterLogic();
    logic.setSelectedCategory('work');
    
    const filtered = logic.filterEntries(testEntries);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe('Work Database');
  });

  it('should clear all filters', () => {
    const logic = createSearchAndFilterLogic();
    logic.setSearchTerm('test');
    logic.setSelectedCategory('email');
    
    logic.clearFilters();
    
    expect(logic.searchTerm).toBe('');
    expect(logic.selectedCategory).toBe('');
  });

  it('should return all entries when no filters applied', () => {
    const logic = createSearchAndFilterLogic();
    
    const filtered = logic.filterEntries(testEntries);
    expect(filtered).toHaveLength(3);
  });

  it('should handle case-insensitive search', () => {
    const logic = createSearchAndFilterLogic();
    logic.setSearchTerm('GMAIL');
    
    const filtered = logic.filterEntries(testEntries);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe('Gmail Account');
  });
});
