import { useState, useEffect, useCallback } from 'react';
import { AuthenticationManager } from '../utils/authentication/AuthenticationManager.js';

/**
 * Custom hook for managing authentication state and operations
 * Provides a clean interface for authentication across the application
 */
export const useAuthentication = (vaultName) => {
  const [authManager] = useState(() => new AuthenticationManager());
  const [availableMethods, setAvailableMethods] = useState([]);
  const [configuredMethods, setConfiguredMethods] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load authentication methods when vault name changes
  useEffect(() => {
    if (vaultName) {
      loadAuthenticationMethods();
    }
  }, [vaultName]);

  const loadAuthenticationMethods = useCallback(async () => {
    if (!vaultName) return;

    setLoading(true);
    setError(null);

    try {
      const suggestions = await authManager.getAuthenticationSuggestions(vaultName);
      console.log('Authentication suggestions:', suggestions);
      const available = suggestions.filter(s => s.provider.isAvailable());
      console.log('available Authentication suggestions:', available);
      const configured = suggestions.filter(s => s.configured);
      
      setAvailableMethods(available);
      setConfiguredMethods(configured);
    } catch (err) {
      setError('Failed to load authentication methods');
      console.error('Error loading authentication methods:', err);
    } finally {
      setLoading(false);
    }
  }, [vaultName, authManager]);

  const authenticate = useCallback(async (methodId, options = {}) => {
    if (!vaultName) {
      throw new Error('No vault selected');
    }

    setLoading(true);
    setError(null);

    try {
      const result = await authManager.authenticate(vaultName, methodId, options);
      
      if (!result.success) {
        setError(result.error);
        return result;
      }

      return result;
    } catch (err) {
      const errorMessage = 'Authentication failed';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  }, [vaultName, authManager]);

  const initializeMethod = useCallback(async (methodId, options = {}) => {
    if (!vaultName) {
      throw new Error('No vault selected');
    }

    setLoading(true);
    setError(null);

    try {
      const result = await authManager.initializeMethod(vaultName, methodId, options);
      
      if (result.success) {
        // Refresh the authentication methods list
        await loadAuthenticationMethods();
      } else {
        setError(result.error);
      }

      return result;
    } catch (err) {
      const errorMessage = 'Failed to initialize authentication method';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  }, [vaultName, authManager, loadAuthenticationMethods]);

  const removeMethod = useCallback(async (methodId) => {
    if (!vaultName) {
      throw new Error('No vault selected');
    }

    setLoading(true);
    setError(null);

    try {
      const result = await authManager.removeMethod(vaultName, methodId);
      
      if (result.success) {
        // Refresh the authentication methods list
        await loadAuthenticationMethods();
      } else {
        setError(result.error);
      }

      return result;
    } catch (err) {
      const errorMessage = 'Failed to remove authentication method';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  }, [vaultName, authManager, loadAuthenticationMethods]);

  const getBestProvider = useCallback(async () => {
    if (!vaultName) return null;

    try {
      return await authManager.getBestProvider(vaultName);
    } catch (err) {
      console.error('Error getting best provider:', err);
      return null;
    }
  }, [vaultName, authManager]);

  const hasAnyConfiguredMethod = useCallback(async () => {
    if (!vaultName) return false;

    try {
      return await authManager.hasAnyConfiguredMethod(vaultName);
    } catch (err) {
      console.error('Error checking configured methods:', err);
      return false;
    }
  }, [vaultName, authManager]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    // State
    availableMethods,
    configuredMethods,
    loading,
    error,
    
    // Actions
    authenticate,
    initializeMethod,
    removeMethod,
    getBestProvider,
    hasAnyConfiguredMethod,
    loadAuthenticationMethods,
    clearError,
    
    // Utilities
    authManager
  };
};
