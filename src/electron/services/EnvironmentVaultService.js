import fs from 'fs-extra';
import path from 'path';

import { CryptographyService } from './CryptographyService.js';
import { EnvironmentVault } from '../models/EnvironmentVault.js';
import { validatePasswordStrength } from '../utils/passwordValidation.js';
import { getAppDataPath, getEnvsDir } from '../utils/appPaths.js';

function resolvePath(...segments) {
  return process.platform === 'win32'
    ? path.win32.join(...segments)
    : path.posix.join(...segments);
}

export class EnvironmentVaultService {
  static getAppDataPath() {
    return getAppDataPath();
  }

  static getEnvsDir() {
    return getEnvsDir();
  }

  static getEnvVaultPath(name) {
    return resolvePath(this.getEnvsDir(), `${name}.env.vault`);
  }

  static getBackupPath(name) {
    return resolvePath(this.getEnvsDir(), `${name}.env.vault.bak`);
  }

  static resolveVaultPath({ vault, name } = {}) {
    if (vault) {
      return path.resolve(vault);
    }

    if (name) {
      return this.getEnvVaultPath(name);
    }

    const cwdName = path
      .basename(process.cwd())
      .replace(/[^a-z0-9_-]/gi, '_')
      .toLowerCase();

    const localVault = path.resolve('.env.vault');
    if (fs.existsSync(localVault)) {
      return localVault;
    }

    const configVault = path.resolve('config', '.env.vault');
    if (fs.existsSync(configVault)) {
      return configVault;
    }

    const appDataVault = this.getEnvVaultPath(cwdName);
    if (fs.existsSync(appDataVault)) {
      return appDataVault;
    }

    return null;
  }

  static defaultVaultPath() {
    const cwdName = path
      .basename(process.cwd())
      .replace(/[^a-z0-9_-]/gi, '_')
      .toLowerCase();
    return this.getEnvVaultPath(cwdName);
  }

  static async vaultExists(path) {
    try {
      return await fs.pathExists(path);
    } catch {
      return false;
    }
  }

  static async createVault(vaultPath, password, data = null) {
    const passwordErrors = validatePasswordStrength(password);
    if (passwordErrors.length > 0) {
      return { success: false, error: passwordErrors[0] };
    }

    try {
      if (await this.vaultExists(vaultPath)) {
        return {
          success: false,
          error: `Vault already exists at ${vaultPath}`,
        };
      }

      const payload = data || new EnvironmentVault().toJSON();
      const salt = CryptographyService.generateSalt();
      const key = CryptographyService.deriveKey(password, salt);
      const encrypted = CryptographyService.encrypt(payload, key);

      const vaultFile = {
        type: 'environment-vault',
        version: 1,
        salt: salt.toString('hex'),
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        encrypted: encrypted.encrypted,
      };

      await fs.ensureDir(path.dirname(vaultPath));
      await fs.writeJSON(vaultPath, vaultFile, { spaces: 2 });

      return { success: true, path: vaultPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  static async loadVault(vaultPath, password) {
    try {
      if (!(await this.vaultExists(vaultPath))) {
        return {
          success: false,
          error: `Environment vault not found at ${vaultPath}`,
        };
      }

      const vaultFile = await fs.readJSON(vaultPath);

      if (vaultFile.type !== 'environment-vault') {
        return { success: false, error: 'Invalid environment vault file' };
      }

      const salt = Buffer.from(vaultFile.salt, 'hex');
      const key = CryptographyService.deriveKey(password, salt);
      const encryptedData = {
        encrypted: vaultFile.encrypted,
        authTag: vaultFile.authTag,
        iv: vaultFile.iv,
      };

      const payload = CryptographyService.decrypt(encryptedData, key);
      const vault = EnvironmentVault.fromJSON(payload);

      return { success: true, data: vault };
    } catch (error) {
      return {
        success: false,
        error: 'Failed to decrypt: wrong password or corrupted file',
      };
    }
  }

  static async saveVault(vaultPath, password, vault) {
    try {
      const payload = vault.toJSON();
      const salt = CryptographyService.generateSalt();
      const key = CryptographyService.deriveKey(password, salt);
      const encrypted = CryptographyService.encrypt(payload, key);

      const vaultFile = {
        type: 'environment-vault',
        version: 1,
        salt: salt.toString('hex'),
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        encrypted: encrypted.encrypted,
      };

      await fs.ensureDir(path.dirname(vaultPath));
      await fs.writeJSON(vaultPath, vaultFile, { spaces: 2 });

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  static async changePassword(vaultPath, currentPassword, newPassword) {
    const passwordErrors = validatePasswordStrength(newPassword);
    if (passwordErrors.length > 0) {
      return { success: false, error: passwordErrors[0] };
    }

    const loadResult = await this.loadVault(vaultPath, currentPassword);
    if (!loadResult.success) {
      return loadResult;
    }

    return this.saveVault(vaultPath, newPassword, loadResult.data);
  }

  static async init({ name, vault, password, environments = {} }) {
    const vaultPath = vault
      ? path.resolve(vault)
      : name
        ? this.getEnvVaultPath(name)
        : this.defaultVaultPath();

    if (!password) {
      return { success: false, error: 'Password is required' };
    }

    const vaultModel = new EnvironmentVault();

    for (const [envName, envFile] of Object.entries(environments)) {
      try {
        const content = await fs.readFile(envFile, 'utf-8');
        vaultModel.importFromEnvFile(envName, content, {
          message: 'Initial import',
        });
      } catch (error) {
        return {
          success: false,
          error: `Failed to import ${envName} from ${envFile}: ${error.message}`,
        };
      }
    }

    return this.createVault(vaultPath, password, vaultModel.toJSON());
  }

  static async setEnv(
    vaultPath,
    password,
    envName,
    key,
    value,
    { isPublic = false, message = null } = {}
  ) {
    const loadResult = await this.loadVault(vaultPath, password);
    if (!loadResult.success) return loadResult;

    const vault = loadResult.data;

    if (!vault.listEnvironmentNames().includes(envName)) {
      vault.addEnvironment(envName);
    }

    const activeVersion = vault.getActiveVersion(envName);

    const nonSensitive = activeVersion ? [...activeVersion.nonSensitive] : [];
    const required = activeVersion ? [...activeVersion.required] : [];

    if (isPublic && !nonSensitive.includes(key)) {
      nonSensitive.push(key);
    } else if (!isPublic) {
      const idx = nonSensitive.indexOf(key);
      if (idx !== -1) nonSensitive.splice(idx, 1);
    }

    const currentVars = activeVersion ? { ...activeVersion.vars } : {};
    currentVars[key] = value;

    vault.addVersion(envName, currentVars, { nonSensitive, required, message });

    return this.saveVault(vaultPath, password, vault);
  }

  static async getEnv(vaultPath, password, envName, key) {
    const loadResult = await this.loadVault(vaultPath, password);
    if (!loadResult.success) return loadResult;

    try {
      const vault = loadResult.data;
      const activeVersion = vault.getActiveVersion(envName);

      if (!activeVersion) {
        return {
          success: false,
          error: `Environment '${envName}' has no versions`,
        };
      }

      if (!(key in activeVersion.vars)) {
        return {
          success: false,
          error: `Key '${key}' not found in environment '${envName}'`,
        };
      }

      return { success: true, data: { key, value: activeVersion.vars[key] } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  static async showEnv(vaultPath, password, envName) {
    const loadResult = await this.loadVault(vaultPath, password);
    if (!loadResult.success) return loadResult;

    try {
      const vault = loadResult.data;
      const activeVersion = vault.getActiveVersion(envName);

      if (!activeVersion) {
        return {
          success: false,
          error: `Environment '${envName}' has no versions`,
        };
      }

      const keys = Object.entries(activeVersion.vars).map(([key, value]) => ({
        key,
        value,
        sensitive: !activeVersion.nonSensitive.includes(key),
      }));

      return {
        success: true,
        data: {
          name: envName,
          activeVersion: activeVersion.n,
          totalVersions: vault.getHistory(envName).length,
          keyCount: keys.length,
          keys,
        },
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  static async listEnvs(vaultPath, password) {
    const loadResult = await this.loadVault(vaultPath, password);
    if (!loadResult.success) return loadResult;

    const vault = loadResult.data;
    const names = vault.listEnvironmentNames();

    const envs = names.map((name) => {
      const history = vault.getHistory(name);
      const activeVersion = vault.getActiveVersion(name);
      return {
        name,
        versionCount: history.length,
        activeVersion: activeVersion ? activeVersion.n : null,
        keyCount: activeVersion ? Object.keys(activeVersion.vars).length : 0,
      };
    });

    return { success: true, data: envs };
  }

  static async removeKey(vaultPath, password, envName, key) {
    const loadResult = await this.loadVault(vaultPath, password);
    if (!loadResult.success) return loadResult;

    try {
      const vault = loadResult.data;
      const activeVersion = vault.getActiveVersion(envName);

      if (!activeVersion) {
        return {
          success: false,
          error: `Environment '${envName}' has no versions`,
        };
      }

      if (!(key in activeVersion.vars)) {
        return {
          success: false,
          error: `Key '${key}' not found in environment '${envName}'`,
        };
      }

      const newVars = { ...activeVersion.vars };
      delete newVars[key];

      const nonSensitive = activeVersion.nonSensitive.filter((k) => k !== key);
      const required = activeVersion.required.filter((k) => k !== key);

      vault.addVersion(envName, newVars, {
        nonSensitive,
        required,
        message: `Remove ${key}`,
      });

      return this.saveVault(vaultPath, password, vault);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  static async deleteEnv(vaultPath, password, envName) {
    const loadResult = await this.loadVault(vaultPath, password);
    if (!loadResult.success) return loadResult;

    try {
      const vault = loadResult.data;
      vault.removeEnvironment(envName);
      return this.saveVault(vaultPath, password, vault);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  static async renameEnv(vaultPath, password, oldName, newName) {
    const loadResult = await this.loadVault(vaultPath, password);
    if (!loadResult.success) return loadResult;

    try {
      const vault = loadResult.data;
      vault.renameEnvironment(oldName, newName);
      return this.saveVault(vaultPath, password, vault);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  static async exportEnv(vaultPath, password, envName, format = 'dotenv') {
    const loadResult = await this.loadVault(vaultPath, password);
    if (!loadResult.success) return loadResult;

    try {
      const vault = loadResult.data;
      const activeVersion = vault.getActiveVersion(envName);

      if (!activeVersion) {
        return {
          success: false,
          error: `Environment '${envName}' has no versions`,
        };
      }

      if (format === 'json') {
        return { success: true, data: activeVersion.vars };
      }

      const lines = Object.entries(activeVersion.vars).map(
        ([key, value]) => `${key}=${value}`
      );

      return { success: true, data: lines.join('\n') + '\n' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  static async templateEnv(vaultPath, password, envName) {
    const loadResult = await this.loadVault(vaultPath, password);
    if (!loadResult.success) return loadResult;

    try {
      const vault = loadResult.data;
      const activeVersion = vault.getActiveVersion(envName);

      if (!activeVersion) {
        return {
          success: false,
          error: `Environment '${envName}' has no versions`,
        };
      }

      const lines = Object.keys(activeVersion.vars).map((key) => {
        if (activeVersion.required.includes(key)) {
          return `${key}=<required>`;
        }
        return `${key}=`;
      });

      return { success: true, data: lines.join('\n') + '\n' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  static async importEnvFile(vaultPath, password, envName, filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const loadResult = await this.loadVault(vaultPath, password);
      if (!loadResult.success) return loadResult;

      const vault = loadResult.data;
      vault.importFromEnvFile(envName, content, {
        message: `Imported from ${path.basename(filePath)}`,
      });

      return this.saveVault(vaultPath, password, vault);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  static async squashEnv(vaultPath, password, envName, keep = 1) {
    const loadResult = await this.loadVault(vaultPath, password);
    if (!loadResult.success) return loadResult;

    try {
      const vault = loadResult.data;
      vault.squash(envName, { keep: Math.max(1, keep) });
      return this.saveVault(vaultPath, password, vault);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  static async rollbackEnv(vaultPath, password, envName, versionN) {
    const loadResult = await this.loadVault(vaultPath, password);
    if (!loadResult.success) return loadResult;

    try {
      const vault = loadResult.data;
      vault.rollback(envName, versionN);
      return this.saveVault(vaultPath, password, vault);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  static async getHistory(vaultPath, password, envName) {
    const loadResult = await this.loadVault(vaultPath, password);
    if (!loadResult.success) return loadResult;

    try {
      const vault = loadResult.data;
      const history = vault.getHistory(envName);
      return { success: true, data: history };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  static async diffEnvs(vaultPath, password, envA, envB) {
    const loadResult = await this.loadVault(vaultPath, password);
    if (!loadResult.success) return loadResult;

    try {
      const vault = loadResult.data;
      const versionA = vault.getActiveVersion(envA);
      const versionB = vault.getActiveVersion(envB);

      if (!versionA) {
        return {
          success: false,
          error: `Environment '${envA}' has no versions`,
        };
      }
      if (!versionB) {
        return {
          success: false,
          error: `Environment '${envB}' has no versions`,
        };
      }

      const keysA = new Set(Object.keys(versionA.vars));
      const keysB = new Set(Object.keys(versionB.vars));

      const added = [...keysB].filter((k) => !keysA.has(k));
      const removed = [...keysA].filter((k) => !keysB.has(k));
      const changed = [...keysA].filter(
        (k) => keysB.has(k) && versionA.vars[k] !== versionB.vars[k]
      );
      const unchanged = [...keysA].filter(
        (k) => keysB.has(k) && versionA.vars[k] === versionB.vars[k]
      );

      return {
        success: true,
        data: { added, removed, changed, unchanged },
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}
