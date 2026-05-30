// @vitest-environment node
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { EnvironmentVaultService } from '../../../electron/services/EnvironmentVaultService.js';

vi.mock('fs-extra');
vi.mock('os');

const fsMock = vi.mocked(fs);
const osMock = vi.mocked(os);

describe('EnvironmentVaultService Integration', () => {
  const testPassword = 'TestPass123!@#';
  const vaultPath = '/tmp/test-env-vault/test.env.vault';

  function writtenVault() {
    return fsMock.writeJSON.mock.calls.slice(-1)[0][1];
  }

  function mockReadVault() {
    fsMock.pathExists.mockResolvedValue(true);
    fsMock.readJSON.mockResolvedValue(writtenVault());
  }

  beforeEach(() => {
    vi.clearAllMocks();
    osMock.homedir.mockReturnValue('/Users/testuser');
    fsMock.pathExists.mockResolvedValue(false);
    fsMock.readFile.mockReset();
    fsMock.readJSON.mockReset();
    fsMock.writeJSON.mockReset();
    fsMock.ensureDir.mockResolvedValue(undefined);
    fsMock.existsSync.mockReturnValue(false);
  });

  describe('Full CRUD workflow', () => {
    it('should init, set, get, list, export, and delete environments', async () => {
      // --- INIT: create empty vault ---
      const initResult = await EnvironmentVaultService.init({
        name: 'test',
        password: testPassword,
      });
      expect(initResult.success).toBe(true);

      // mock it for subsequent reads
      mockReadVault();

      // --- SET: create env and set key via auto-create ---
      const setResult = await EnvironmentVaultService.setEnv(
        vaultPath,
        testPassword,
        'staging',
        'DB_HOST',
        'db.example.com'
      );
      expect(setResult.success).toBe(true);

      mockReadVault();

      // --- SET: add another key ---
      const set2Result = await EnvironmentVaultService.setEnv(
        vaultPath,
        testPassword,
        'staging',
        'DB_PORT',
        '5432',
        { isPublic: true }
      );
      expect(set2Result.success).toBe(true);

      mockReadVault();

      // --- SHOW: inspect staging ---
      const showResult = await EnvironmentVaultService.showEnv(
        vaultPath,
        testPassword,
        'staging'
      );
      expect(showResult.success).toBe(true);
      expect(showResult.data.keyCount).toBe(2);
      expect(showResult.data.keys).toEqual(
        expect.arrayContaining([
          { key: 'DB_HOST', value: 'db.example.com', sensitive: true },
          { key: 'DB_PORT', value: '5432', sensitive: false },
        ])
      );

      // --- GET: single key ---
      const getResult = await EnvironmentVaultService.getEnv(
        vaultPath,
        testPassword,
        'staging',
        'DB_HOST'
      );
      expect(getResult.success).toBe(true);
      expect(getResult.data).toEqual({
        key: 'DB_HOST',
        value: 'db.example.com',
      });

      // --- LIST: all envs ---
      const listResult = await EnvironmentVaultService.listEnvs(
        vaultPath,
        testPassword
      );
      expect(listResult.success).toBe(true);
      expect(listResult.data).toHaveLength(1);
      expect(listResult.data[0].name).toBe('staging');

      // --- EXPORT: dotenv ---
      const exportResult = await EnvironmentVaultService.exportEnv(
        vaultPath,
        testPassword,
        'staging'
      );
      expect(exportResult.success).toBe(true);
      expect(exportResult.data).toContain('DB_HOST=db.example.com');
      expect(exportResult.data).toContain('DB_PORT=5432');

      // --- EXPORT: json ---
      const jsonResult = await EnvironmentVaultService.exportEnv(
        vaultPath,
        testPassword,
        'staging',
        'json'
      );
      expect(jsonResult.success).toBe(true);
      expect(jsonResult.data).toEqual({
        DB_HOST: 'db.example.com',
        DB_PORT: '5432',
      });

      // --- HISTORY: 2 versions (2 sets) ---
      const historyResult = await EnvironmentVaultService.getHistory(
        vaultPath,
        testPassword,
        'staging'
      );
      expect(historyResult.success).toBe(true);
      expect(historyResult.data).toHaveLength(2);

      // --- RENAME: staging → production ---
      const renameResult = await EnvironmentVaultService.renameEnv(
        vaultPath,
        testPassword,
        'staging',
        'production'
      );
      expect(renameResult.success).toBe(true);

      mockReadVault();

      const renameCheck = await EnvironmentVaultService.listEnvs(
        vaultPath,
        testPassword
      );
      expect(renameCheck.data.map((e) => e.name)).toEqual(['production']);

      // --- DELETE: production ---
      const deleteResult = await EnvironmentVaultService.deleteEnv(
        vaultPath,
        testPassword,
        'production'
      );
      expect(deleteResult.success).toBe(true);

      mockReadVault();

      const deleteCheck = await EnvironmentVaultService.listEnvs(
        vaultPath,
        testPassword
      );
      expect(deleteCheck.data).toHaveLength(0);
    });
  });

  describe('Version management', () => {
    it('should track versions, squash, and rollback', async () => {
      await EnvironmentVaultService.createVault(vaultPath, testPassword);
      mockReadVault();

      // Add 4 versions
      await EnvironmentVaultService.setEnv(
        vaultPath,
        testPassword,
        'app',
        'VERSION',
        '1'
      );
      mockReadVault();

      await EnvironmentVaultService.setEnv(
        vaultPath,
        testPassword,
        'app',
        'VERSION',
        '2',
        { message: 'Bump to 2' }
      );
      mockReadVault();

      await EnvironmentVaultService.setEnv(
        vaultPath,
        testPassword,
        'app',
        'VERSION',
        '3',
        { message: 'Bump to 3' }
      );
      mockReadVault();

      await EnvironmentVaultService.setEnv(
        vaultPath,
        testPassword,
        'app',
        'VERSION',
        '4',
        { message: 'Bump to 4' }
      );

      // Verify active version is v4
      mockReadVault();
      const show4 = await EnvironmentVaultService.showEnv(
        vaultPath,
        testPassword,
        'app'
      );
      expect(show4.success).toBe(true);
      expect(show4.data.activeVersion).toBe(4);
      expect(show4.data.keys.find((k) => k.key === 'VERSION').value).toBe('4');

      // Rollback to v2
      mockReadVault();
      const rollbackResult = await EnvironmentVaultService.rollbackEnv(
        vaultPath,
        testPassword,
        'app',
        2
      );
      expect(rollbackResult.success).toBe(true);

      // Verify active version has v2's data (rollback creates a new version with v1 data)
      mockReadVault();
      const afterRollback = await EnvironmentVaultService.showEnv(
        vaultPath,
        testPassword,
        'app'
      );
      expect(
        afterRollback.data.keys.find((k) => k.key === 'VERSION').value
      ).toBe('2');
      expect(afterRollback.data.totalVersions).toBe(5);

      // Squash to keep 1 version
      mockReadVault();
      const squashResult = await EnvironmentVaultService.squashEnv(
        vaultPath,
        testPassword,
        'app',
        1
      );
      expect(squashResult.success).toBe(true);

      mockReadVault();
      const finalHistory = await EnvironmentVaultService.getHistory(
        vaultPath,
        testPassword,
        'app'
      );
      expect(finalHistory.data).toHaveLength(1);
    });
  });

  describe('Diff environments', () => {
    it('should diff two environments', async () => {
      await EnvironmentVaultService.createVault(vaultPath, testPassword);
      mockReadVault();

      await EnvironmentVaultService.setEnv(
        vaultPath,
        testPassword,
        'staging',
        'HOST',
        'staging.example.com'
      );
      mockReadVault();

      await EnvironmentVaultService.setEnv(
        vaultPath,
        testPassword,
        'staging',
        'PORT',
        '3000'
      );
      mockReadVault();

      await EnvironmentVaultService.setEnv(
        vaultPath,
        testPassword,
        'production',
        'HOST',
        'prod.example.com'
      );
      mockReadVault();

      await EnvironmentVaultService.setEnv(
        vaultPath,
        testPassword,
        'production',
        'PORT',
        '8080'
      );

      mockReadVault();

      // Add a unique key to each
      await EnvironmentVaultService.setEnv(
        vaultPath,
        testPassword,
        'staging',
        'DEBUG',
        'true'
      );
      mockReadVault();

      await EnvironmentVaultService.setEnv(
        vaultPath,
        testPassword,
        'production',
        'CACHE_SIZE',
        '2048'
      );

      mockReadVault();

      const diff = await EnvironmentVaultService.diffEnvs(
        vaultPath,
        testPassword,
        'staging',
        'production'
      );
      expect(diff.success).toBe(true);
      expect(diff.data.added).toContain('CACHE_SIZE');
      expect(diff.data.removed).toContain('DEBUG');
      expect(diff.data.changed).toContain('HOST');
      expect(diff.data.changed).toContain('PORT');
    });
  });

  describe('Template generation', () => {
    it('should generate template with required markers', async () => {
      await EnvironmentVaultService.createVault(vaultPath, testPassword);
      mockReadVault();

      await EnvironmentVaultService.setEnv(
        vaultPath,
        testPassword,
        'app',
        'DB_HOST',
        'localhost'
      );
      mockReadVault();

      // Manually set required via adding a version with required list
      const loadResult = await EnvironmentVaultService.loadVault(
        vaultPath,
        testPassword
      );
      const vault = loadResult.data;
      vault.addVersion(
        'app',
        { DB_HOST: 'localhost', DB_PASS: 'secret' },
        {
          required: ['DB_HOST'],
          nonSensitive: ['DB_HOST'],
          message: 'Add required marker',
        }
      );
      await EnvironmentVaultService.saveVault(vaultPath, testPassword, vault);

      mockReadVault();

      const templateResult = await EnvironmentVaultService.templateEnv(
        vaultPath,
        testPassword,
        'app'
      );
      expect(templateResult.success).toBe(true);
      expect(templateResult.data).toContain('DB_HOST=<required>');
      expect(templateResult.data).toContain('DB_PASS=');
    });
  });

  describe('Import from .env files', () => {
    it('should import .env file content into a new environment', async () => {
      await EnvironmentVaultService.createVault(vaultPath, testPassword);
      mockReadVault();
      fsMock.readFile.mockResolvedValue(
        'API_KEY=sk-123\nAPI_URL=https://api.example.com'
      );

      const importResult = await EnvironmentVaultService.importEnvFile(
        vaultPath,
        testPassword,
        'production',
        '/path/to/.env.prod'
      );

      expect(importResult.success).toBe(true);
      expect(fsMock.readFile).toHaveBeenCalledWith(
        '/path/to/.env.prod',
        'utf-8'
      );

      mockReadVault();

      const showResult = await EnvironmentVaultService.showEnv(
        vaultPath,
        testPassword,
        'production'
      );
      expect(showResult.success).toBe(true);
      expect(showResult.data.keyCount).toBe(2);
    });
  });

  describe('Password management', () => {
    const newPassword = 'NewStrongPass456!@#';

    it('should change password and still access data', async () => {
      await EnvironmentVaultService.createVault(vaultPath, testPassword);
      mockReadVault();

      await EnvironmentVaultService.setEnv(
        vaultPath,
        testPassword,
        'app',
        'KEY',
        'secret-value'
      );
      mockReadVault();

      // Change password
      const changeResult = await EnvironmentVaultService.changePassword(
        vaultPath,
        testPassword,
        newPassword
      );
      expect(changeResult.success).toBe(true);

      // Old password no longer works
      mockReadVault();
      const oldLoad = await EnvironmentVaultService.loadVault(
        vaultPath,
        testPassword
      );
      expect(oldLoad.success).toBe(false);

      // New password works
      const newLoad = await EnvironmentVaultService.loadVault(
        vaultPath,
        newPassword
      );
      expect(newLoad.success).toBe(true);
      expect(newLoad.data.getActiveVersion('app').vars.KEY).toBe(
        'secret-value'
      );
    });
  });

  describe('Error handling', () => {
    it('should handle wrong password for load', async () => {
      await EnvironmentVaultService.createVault(vaultPath, testPassword);
      const file = writtenVault();
      fsMock.pathExists.mockResolvedValue(true);
      fsMock.readJSON.mockResolvedValue(file);

      const result = await EnvironmentVaultService.loadVault(
        vaultPath,
        'WrongPass123!@#'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('wrong password');
    });

    it('should handle non-existent vault', async () => {
      fsMock.pathExists.mockResolvedValue(false);

      const result = await EnvironmentVaultService.loadVault(
        '/nonexistent.vault',
        testPassword
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should handle missing key in getEnv', async () => {
      await EnvironmentVaultService.createVault(vaultPath, testPassword);
      mockReadVault();

      await EnvironmentVaultService.setEnv(
        vaultPath,
        testPassword,
        'app',
        'EXISTS',
        'yes'
      );
      mockReadVault();

      const result = await EnvironmentVaultService.getEnv(
        vaultPath,
        testPassword,
        'app',
        'MISSING'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should reject weak password on create', async () => {
      const result = await EnvironmentVaultService.createVault(
        vaultPath,
        'weak'
      );
      expect(result.success).toBe(false);
    });

    it('should reject weak password on change', async () => {
      await EnvironmentVaultService.createVault(vaultPath, testPassword);
      const file = writtenVault();
      fsMock.pathExists.mockResolvedValue(true);
      fsMock.readJSON.mockResolvedValue(file);

      const result = await EnvironmentVaultService.changePassword(
        vaultPath,
        testPassword,
        'weak'
      );
      expect(result.success).toBe(false);
    });

    it('should handle delete of non-existent environment', async () => {
      await EnvironmentVaultService.createVault(vaultPath, testPassword);
      mockReadVault();

      const result = await EnvironmentVaultService.deleteEnv(
        vaultPath,
        testPassword,
        'nonexistent'
      );
      expect(result.success).toBe(false);
    });

    it('should handle rename of non-existent environment', async () => {
      await EnvironmentVaultService.createVault(vaultPath, testPassword);
      mockReadVault();

      const result = await EnvironmentVaultService.renameEnv(
        vaultPath,
        testPassword,
        'old',
        'new'
      );
      expect(result.success).toBe(false);
    });
  });
});
