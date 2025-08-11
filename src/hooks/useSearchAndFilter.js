// Custom hook for search and filter functionality
import { useState, useMemo } from 'react';

export const useSearchAndFilter = (entries) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');

  const filteredEntries = useMemo(() => {
    if (!entries) return [];

    return entries.filter(entry => {
      const matchesSearch = !searchTerm || 
        entry.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        entry.username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        entry.url?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesCategory = !selectedCategory || 
        entry.category === selectedCategory;

      return matchesSearch && matchesCategory;
    });
  }, [entries, searchTerm, selectedCategory]);

  const clearFilters = () => {
    setSearchTerm('');
    setSelectedCategory('');
  };

  return {
    searchTerm,
    setSearchTerm,
    selectedCategory,
    setSelectedCategory,
    filteredEntries,
    clearFilters
  };
};
