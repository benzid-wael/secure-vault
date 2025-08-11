import { vi } from 'vitest';

// Mock the electron API for recovery functionality
const mockElectronAPI = {
  createVault: vi.fn(),
  changeMasterPassword: vi.fn(),
  recoverVaultWithOldPassword: vi.fn(),
  loadVault: vi.fn(),
  generateRecoveryKey: vi.fn(),
  verifyVaultRecoveryKey: vi.fn(),
  loadVaultWithRecoveryKey: vi.fn()
};

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true
});

describe('Vault Recovery Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Password Recovery Flow', () => {
    it('should allow recovery with previous password after password change', async () => {
      const vaultName = 'test-vault';
      const originalPassword = 'original123';
      const newPassword = 'newpassword456';

      // Step 1: Create vault with original password
      mockElectronAPI.createVault.mockResolvedValueOnce({
        success: true,
        recoveryKey: 'ABCD-EFGH-1234-5678'
      });

      const createResult = await window.electronAPI.createVault(vaultName, originalPassword);
      expect(createResult.success).toBe(true);

      // Step 2: Change password (this should store recovery data)
      mockElectronAPI.changeMasterPassword.mockResolvedValueOnce({
        success: true
      });

      const changeResult = await window.electronAPI.changeMasterPassword(
        vaultName, 
        originalPassword, 
        newPassword
      );
      expect(changeResult.success).toBe(true);

      // Step 3: Try to recover with original password
      mockElectronAPI.recoverVaultWithOldPassword.mockResolvedValueOnce({
        success: true,
        message: 'Vault recovered with previous password',
        currentPassword: newPassword
      });

      const recoveryResult = await window.electronAPI.recoverVaultWithOldPassword(
        vaultName, 
        originalPassword
      );

      expect(recoveryResult.success).toBe(true);
      expect(recoveryResult.currentPassword).toBe(newPassword);

      // Step 4: Load vault with recovered password
      mockElectronAPI.loadVault.mockResolvedValueOnce({
        success: true,
        data: { entries: [], version: '1.0' }
      });

      const loadResult = await window.electronAPI.loadVault(vaultName, newPassword);
      expect(loadResult.success).toBe(true);
    });

    it('should fail recovery with wrong previous password', async () => {
      const vaultName = 'test-vault';
      const wrongPassword = 'wrongpassword';

      mockElectronAPI.recoverVaultWithOldPassword.mockResolvedValueOnce({
        success: false,
        error: 'This password is not in the recovery history'
      });

      const recoveryResult = await window.electronAPI.recoverVaultWithOldPassword(
        vaultName, 
        wrongPassword
      );

      expect(recoveryResult.success).toBe(false);
      expect(recoveryResult.error).toContain('not in the recovery history');
    });

    it('should fail recovery when no recovery data exists', async () => {
      const vaultName = 'new-vault';
      const somePassword = 'somepassword';

      mockElectronAPI.recoverVaultWithOldPassword.mockResolvedValueOnce({
        success: false,
        error: 'No recovery data available for this vault'
      });

      const recoveryResult = await window.electronAPI.recoverVaultWithOldPassword(
        vaultName, 
        somePassword
      );

      expect(recoveryResult.success).toBe(false);
      expect(recoveryResult.error).toContain('No recovery data available');
    });
  });

  describe('Recovery Key Flow', () => {
    it('should allow recovery with recovery key', async () => {
      const vaultName = 'test-vault';
      const masterPassword = 'masterpass123';
      const recoveryKey = 'ABCD-EFGH-1234-5678-IJKL-MNOP-QRST-UVWX';

      // Generate recovery key
      mockElectronAPI.generateRecoveryKey.mockResolvedValueOnce({
        success: true,
        recoveryKey: recoveryKey,
        createdAt: new Date().toISOString()
      });

      const generateResult = await window.electronAPI.generateRecoveryKey(
        vaultName, 
        masterPassword
      );
      expect(generateResult.success).toBe(true);

      // Verify recovery key
      mockElectronAPI.verifyVaultRecoveryKey.mockResolvedValueOnce({
        success: true
      });

      const verifyResult = await window.electronAPI.verifyVaultRecoveryKey(
        vaultName, 
        recoveryKey
      );
      expect(verifyResult.success).toBe(true);

      // Load vault with recovery key
      mockElectronAPI.loadVaultWithRecoveryKey.mockResolvedValueOnce({
        success: true,
        data: { entries: [], version: '1.0' }
      });

      const loadResult = await window.electronAPI.loadVaultWithRecoveryKey(
        vaultName, 
        recoveryKey
      );
      expect(loadResult.success).toBe(true);
    });

    it('should fail recovery with invalid recovery key', async () => {
      const vaultName = 'test-vault';
      const invalidKey = 'INVALID-KEY-FORMAT';

      mockElectronAPI.verifyVaultRecoveryKey.mockResolvedValueOnce({
        success: false,
        error: 'Invalid recovery key format'
      });

      const verifyResult = await window.electronAPI.verifyVaultRecoveryKey(
        vaultName, 
        invalidKey
      );

      expect(verifyResult.success).toBe(false);
      expect(verifyResult.error).toContain('Invalid recovery key');
    });
  });

  describe('Recovery Scenarios', () => {
    it('should handle multiple password changes correctly', async () => {
      const vaultName = 'test-vault';
      const password1 = 'first123';
      const password2 = 'second456';
      const password3 = 'third789';

      // Create vault with password1
      mockElectronAPI.createVault.mockResolvedValueOnce({ success: true });
      await window.electronAPI.createVault(vaultName, password1);

      // Change to password2
      mockElectronAPI.changeMasterPassword.mockResolvedValueOnce({ success: true });
      await window.electronAPI.changeMasterPassword(vaultName, password1, password2);

      // Change to password3
      mockElectronAPI.changeMasterPassword.mockResolvedValueOnce({ success: true });
      await window.electronAPI.changeMasterPassword(vaultName, password2, password3);

      // Try to recover with password1 (should fail - only previous password supported)
      mockElectronAPI.recoverVaultWithOldPassword.mockResolvedValueOnce({
        success: false,
        error: 'This password is not in the recovery history'
      });

      const recovery1Result = await window.electronAPI.recoverVaultWithOldPassword(
        vaultName,
        password1
      );
      expect(recovery1Result.success).toBe(false);

      // Try to recover with password2 (should succeed - this is the previous password)
      mockElectronAPI.recoverVaultWithOldPassword.mockResolvedValueOnce({
        success: true,
        currentPassword: password3
      });

      const recovery2Result = await window.electronAPI.recoverVaultWithOldPassword(
        vaultName,
        password2
      );
      expect(recovery2Result.success).toBe(true);
      expect(recovery2Result.currentPassword).toBe(password3);
    });

    it('should prevent password reuse with multiple password history', async () => {
      const vaultName = 'test-vault';
      const password1 = 'first123';
      const password2 = 'second456';
      const password3 = 'third789';

      // Create vault with password1
      mockElectronAPI.createVault.mockResolvedValueOnce({ success: true });
      await window.electronAPI.createVault(vaultName, password1);

      // Change to password2
      mockElectronAPI.changeMasterPassword.mockResolvedValueOnce({ success: true });
      await window.electronAPI.changeMasterPassword(vaultName, password1, password2);

      // Change to password3
      mockElectronAPI.changeMasterPassword.mockResolvedValueOnce({ success: true });
      await window.electronAPI.changeMasterPassword(vaultName, password2, password3);

      // Try to change back to password1 (should fail - in history)
      mockElectronAPI.changeMasterPassword.mockResolvedValueOnce({
        success: false,
        error: 'This password has been used before. Please choose a different password.'
      });

      const changeResult1 = await window.electronAPI.changeMasterPassword(
        vaultName,
        password3,
        password1
      );
      expect(changeResult1.success).toBe(false);
      expect(changeResult1.error).toContain('used before');

      // Try to change back to password2 (should fail - in history)
      mockElectronAPI.changeMasterPassword.mockResolvedValueOnce({
        success: false,
        error: 'This password has been used before. Please choose a different password.'
      });

      const changeResult2 = await window.electronAPI.changeMasterPassword(
        vaultName,
        password3,
        password2
      );
      expect(changeResult2.success).toBe(false);
      expect(changeResult2.error).toContain('used before');

      // Try to change to same password (should fail)
      mockElectronAPI.changeMasterPassword.mockResolvedValueOnce({
        success: false,
        error: 'New password must be different from current password'
      });

      const changeResult3 = await window.electronAPI.changeMasterPassword(
        vaultName,
        password3,
        password3
      );
      expect(changeResult3.success).toBe(false);
      expect(changeResult3.error).toContain('different from current');
    });

    it('should detect when provided password is actually current password', async () => {
      const vaultName = 'test-vault';
      const currentPassword = 'current123';

      mockElectronAPI.recoverVaultWithOldPassword.mockResolvedValueOnce({
        success: true,
        message: 'This is actually the current password'
      });

      const recoveryResult = await window.electronAPI.recoverVaultWithOldPassword(
        vaultName, 
        currentPassword
      );

      expect(recoveryResult.success).toBe(true);
      expect(recoveryResult.message).toContain('current password');
    });
  });
});
