// Unit tests for useEntryManagement hook
import { renderHook, act, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { useEntryManagement } from '../../hooks/useEntryManagement';

// Simple test data instead of complex fixtures
const mockVaultEntries = [
  {
    id: '1',
    title: 'Gmail Account',
    username: 'user@gmail.com',
    password: 'SecurePass123!',
    category: 'email'
  },
  {
    id: '2',
    title: 'Facebook',
    username: 'john.doe',
    password: 'MyFacebookPass456@',
    category: 'website'
  }
];

const createMockVaultResult = (success = true, data = { entries: mockVaultEntries }, error = null) => ({
  success,
  data,
  error
});

const createMockEntry = (overrides = {}) => ({
  id: '1',
  title: 'Test Entry',
  username: 'testuser',
  password: 'TestPass123!',
  category: 'general',
  ...overrides
});

describe('useEntryManagement', () => {
  const mockVaultName = 'test-vault';
  const mockPassword = 'test-password';

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
    
    // Set up global electronAPI mock
    global.window.electronAPI = {
      loadVault: vi.fn(),
      addEntry: vi.fn(),
      updateEntry: vi.fn(),
      deleteEntry: vi.fn()
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with default values', () => {
    const { result } = renderHook(() => 
      useEntryManagement(mockVaultName, mockPassword)
    );

    expect(result.current.entries).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(null);
    expect(typeof result.current.loadEntries).toBe('function');
    expect(typeof result.current.addEntry).toBe('function');
    expect(typeof result.current.updateEntry).toBe('function');
    expect(typeof result.current.deleteEntry).toBe('function');
  });

  describe('loadEntries', () => {
    it('should load entries successfully', async () => {
      const mockResult = createMockVaultResult(true, { entries: mockVaultEntries });
      global.window.electronAPI.loadVault.mockResolvedValue(mockResult);

      const { result } = renderHook(() => 
        useEntryManagement(mockVaultName, mockPassword)
      );

      await act(async () => {
        await result.current.loadEntries();
      });

      expect(result.current.entries).toEqual(mockVaultEntries);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe(null);
      expect(global.window.electronAPI.loadVault).toHaveBeenCalledWith(mockVaultName, mockPassword);
    });

    it('should handle loading error', async () => {
      const mockResult = createMockVaultResult(false, null, 'Failed to load vault');
      global.window.electronAPI.loadVault.mockResolvedValue(mockResult);

      const { result } = renderHook(() => 
        useEntryManagement(mockVaultName, mockPassword)
      );

      await act(async () => {
        await result.current.loadEntries();
      });

      expect(result.current.entries).toEqual([]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe('Failed to load vault');
    });

    it('should handle API exception', async () => {
      global.window.electronAPI.loadVault.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => 
        useEntryManagement(mockVaultName, mockPassword)
      );

      await act(async () => {
        await result.current.loadEntries();
      });

      expect(result.current.entries).toEqual([]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe('Error loading entries');
    });

    it('should set loading state during operation', async () => {
      const mockResult = createMockVaultResult(true, { entries: mockVaultEntries });
      global.window.electronAPI.loadVault.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve(mockResult), 100))
      );

      const { result } = renderHook(() => 
        useEntryManagement(mockVaultName, mockPassword)
      );

      act(() => {
        result.current.loadEntries();
      });

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it('should not load when required params are missing', async () => {
      const { result } = renderHook(() => 
        useEntryManagement('', '')
      );

      await act(async () => {
        await result.current.loadEntries();
      });

      expect(global.window.electronAPI.loadVault).not.toHaveBeenCalled();
      expect(result.current.entries).toEqual([]);
    });
  });

  describe('addEntry', () => {
    it('should add entry successfully', async () => {
      const newEntry = createMockEntry({ title: 'New Entry' });
      const mockAddResult = createMockVaultResult(true);
      const mockLoadResult = createMockVaultResult(true, { entries: [...mockVaultEntries, newEntry] });
      
      global.window.electronAPI.addEntry.mockResolvedValue(mockAddResult);
      global.window.electronAPI.loadVault.mockResolvedValue(mockLoadResult);

      const { result } = renderHook(() => 
        useEntryManagement(mockVaultName, mockPassword)
      );

      let addResult;
      await act(async () => {
        addResult = await result.current.addEntry(newEntry);
      });

      expect(addResult.success).toBe(true);
      expect(global.window.electronAPI.addEntry).toHaveBeenCalledWith(mockVaultName, mockPassword, newEntry);
      expect(global.window.electronAPI.loadVault).toHaveBeenCalled();
    });

    it('should handle add entry failure', async () => {
      const newEntry = createMockEntry();
      const mockResult = createMockVaultResult(false, null, 'Failed to add entry');
      global.window.electronAPI.addEntry.mockResolvedValue(mockResult);

      const { result } = renderHook(() => 
        useEntryManagement(mockVaultName, mockPassword)
      );

      let addResult;
      await act(async () => {
        addResult = await result.current.addEntry(newEntry);
      });

      expect(addResult.success).toBe(false);
      expect(addResult.error).toBe('Failed to add entry');
      expect(global.window.electronAPI.loadVault).not.toHaveBeenCalled();
    });

    it('should handle API not available', async () => {
      window.electronAPI = undefined;
      const newEntry = createMockEntry();

      const { result } = renderHook(() => 
        useEntryManagement(mockVaultName, mockPassword)
      );

      let addResult;
      await act(async () => {
        addResult = await result.current.addEntry(newEntry);
      });

      expect(addResult.success).toBe(false);
      expect(addResult.error).toBe('API not available');
    });
  });

  describe('updateEntry', () => {
    it('should update entry successfully', async () => {
      const entryId = '1';
      const updatedEntry = createMockEntry({ id: entryId, title: 'Updated Entry' });
      const mockUpdateResult = createMockVaultResult(true);
      const mockLoadResult = createMockVaultResult(true, { entries: [updatedEntry] });
      
      global.window.electronAPI.updateEntry.mockResolvedValue(mockUpdateResult);
      global.window.electronAPI.loadVault.mockResolvedValue(mockLoadResult);

      const { result } = renderHook(() => 
        useEntryManagement(mockVaultName, mockPassword)
      );

      let updateResult;
      await act(async () => {
        updateResult = await result.current.updateEntry(entryId, updatedEntry);
      });

      expect(updateResult.success).toBe(true);
      expect(global.window.electronAPI.updateEntry).toHaveBeenCalledWith(
        mockVaultName, 
        mockPassword, 
        entryId, 
        updatedEntry
      );
      expect(global.window.electronAPI.loadVault).toHaveBeenCalled();
    });

    it('should handle update entry failure', async () => {
      const entryId = '1';
      const updatedEntry = createMockEntry({ id: entryId });
      const mockResult = createMockVaultResult(false, null, 'Failed to update entry');
      global.window.electronAPI.updateEntry.mockResolvedValue(mockResult);

      const { result } = renderHook(() => 
        useEntryManagement(mockVaultName, mockPassword)
      );

      let updateResult;
      await act(async () => {
        updateResult = await result.current.updateEntry(entryId, updatedEntry);
      });

      expect(updateResult.success).toBe(false);
      expect(updateResult.error).toBe('Failed to update entry');
    });
  });

  describe('deleteEntry', () => {
    it('should delete entry successfully', async () => {
      const entryId = '1';
      const mockDeleteResult = createMockVaultResult(true);
      const mockLoadResult = createMockVaultResult(true, { entries: [] });
      
      global.window.electronAPI.deleteEntry.mockResolvedValue(mockDeleteResult);
      global.window.electronAPI.loadVault.mockResolvedValue(mockLoadResult);

      const { result } = renderHook(() => 
        useEntryManagement(mockVaultName, mockPassword)
      );

      let deleteResult;
      await act(async () => {
        deleteResult = await result.current.deleteEntry(entryId);
      });

      expect(deleteResult.success).toBe(true);
      expect(global.window.electronAPI.deleteEntry).toHaveBeenCalledWith(
        mockVaultName, 
        mockPassword, 
        entryId
      );
      expect(global.window.electronAPI.loadVault).toHaveBeenCalled();
    });

    it('should handle delete entry failure', async () => {
      const entryId = '1';
      const mockResult = createMockVaultResult(false, null, 'Failed to delete entry');
      global.window.electronAPI.deleteEntry.mockResolvedValue(mockResult);

      const { result } = renderHook(() => 
        useEntryManagement(mockVaultName, mockPassword)
      );

      let deleteResult;
      await act(async () => {
        deleteResult = await result.current.deleteEntry(entryId);
      });

      expect(deleteResult.success).toBe(false);
      expect(deleteResult.error).toBe('Failed to delete entry');
    });
  });

  describe('parameter changes', () => {
    it('should update when vault name changes', () => {
      const { result, rerender } = renderHook(
        ({ vaultName, password }) => useEntryManagement(vaultName, password),
        { initialProps: { vaultName: 'vault1', password: 'pass1' } }
      );

      const loadEntries1 = result.current.loadEntries;

      rerender({ vaultName: 'vault2', password: 'pass1' });

      const loadEntries2 = result.current.loadEntries;
      expect(loadEntries1).not.toBe(loadEntries2);
    });

    it('should update when password changes', () => {
      const { result, rerender } = renderHook(
        ({ vaultName, password }) => useEntryManagement(vaultName, password),
        { initialProps: { vaultName: 'vault1', password: 'pass1' } }
      );

      const loadEntries1 = result.current.loadEntries;

      rerender({ vaultName: 'vault1', password: 'pass2' });

      const loadEntries2 = result.current.loadEntries;
      expect(loadEntries1).not.toBe(loadEntries2);
    });
  });
});
