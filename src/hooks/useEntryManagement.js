// Custom hook for managing password entries
import { useState, useCallback } from 'react';

export const useEntryManagement = (vaultName, vaultPassword) => {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadEntries = useCallback(async () => {
    if (!window.electronAPI || !vaultName || !vaultPassword) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const result = await window.electronAPI.loadVault(vaultName, vaultPassword);
      if (result.success) {
        setEntries(result.data.entries || []);
      } else {
        setError(result.error || 'Failed to load entries');
      }
    } catch (err) {
      setError('Error loading entries');
    } finally {
      setLoading(false);
    }
  }, [vaultName, vaultPassword]);

  const addEntry = useCallback(async (entry) => {
    if (!window.electronAPI) return { success: false, error: 'API not available' };
    
    try {
      const result = await window.electronAPI.addEntry(vaultName, vaultPassword, entry);
      if (result.success) {
        await loadEntries(); // Reload entries
      }
      return result;
    } catch (err) {
      return { success: false, error: 'Failed to add entry' };
    }
  }, [vaultName, vaultPassword, loadEntries]);

  const updateEntry = useCallback(async (entryId, updatedEntry) => {
    if (!window.electronAPI) return { success: false, error: 'API not available' };
    
    try {
      const result = await window.electronAPI.updateEntry(vaultName, vaultPassword, entryId, updatedEntry);
      if (result.success) {
        await loadEntries(); // Reload entries
      }
      return result;
    } catch (err) {
      return { success: false, error: 'Failed to update entry' };
    }
  }, [vaultName, vaultPassword, loadEntries]);

  const deleteEntry = useCallback(async (entryId) => {
    if (!window.electronAPI) return { success: false, error: 'API not available' };
    
    try {
      const result = await window.electronAPI.deleteEntry(vaultName, vaultPassword, entryId);
      if (result.success) {
        await loadEntries(); // Reload entries
      }
      return result;
    } catch (err) {
      return { success: false, error: 'Failed to delete entry' };
    }
  }, [vaultName, vaultPassword, loadEntries]);

  return {
    entries,
    loading,
    error,
    loadEntries,
    addEntry,
    updateEntry,
    deleteEntry
  };
};
