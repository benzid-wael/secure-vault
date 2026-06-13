import fs from 'fs-extra';
import path from 'path';

import { CryptographyService } from './CryptographyService.js';
import { EnvironmentResolver } from './EnvironmentResolver.js';
import { EnvironmentVault } from '../models/EnvironmentVault.js';

/**
 * Heuristic patterns for values that look like secrets accidentally left in a
 * non-required (and likely non-sensitive) variable (SPEC §10.1). Warning-only.
 */
const SUSPICIOUS_VALUE_RE =
  /-----BEGIN |sk_live_|AKIA[0-9A-Z]{16}|[0-9a-f]{64,}/;
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

  static getBackupPath(vaultPath) {
    return `${vaultPath}.bak`;
  }

  static findGitRoot(startDir) {
    let dir = startDir;
    while (true) {
      if (fs.existsSync(path.join(dir, '.git'))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        return null;
      }
      dir = parent;
    }
  }

  static findVaultUpward(startDir, stopDir) {
    let dir = startDir;
    while (true) {
      const candidate = path.join(dir, '.env.vault');
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      // Stop once we have processed the boundary directory.
      if (dir === stopDir) {
        return null;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        return null;
      }
      dir = parent;
    }
  }

  static resolveVaultPath({ vault, name } = {}) {
    if (vault) {
      return path.resolve(vault);
    }

    if (name) {
      return this.getEnvVaultPath(name);
    }

    const cwd = process.cwd();
    const cwdName = path
      .basename(cwd)
      .replace(/[^a-z0-9_-]/gi, '_')
      .toLowerCase();

    // Walk up from cwd toward ancestors looking for `.env.vault`, bounded by
    // the git root. If no git root is found, only cwd itself is checked.
    const gitRoot = this.findGitRoot(cwd);
    const stopDir = gitRoot || cwd;
    const upwardVault = this.findVaultUpward(cwd, stopDir);
    if (upwardVault) {
      return path.resolve(upwardVault);
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

      // Preserve the previous good state, then write atomically: the new
      // content lands in a temp file and is renamed over the target only once
      // fully written, so a crash mid-write can never corrupt the vault, and
      // `<path>.bak` always holds the last good copy for manual recovery.
      if (await fs.pathExists(vaultPath)) {
        await fs.copy(vaultPath, this.getBackupPath(vaultPath), {
          overwrite: true,
        });
      }

      const tmpPath = `${vaultPath}.tmp`;
      await fs.writeJSON(tmpPath, vaultFile, { spaces: 2 });
      await fs.move(tmpPath, vaultPath, { overwrite: true });

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
    { isPublic = false, isRequired = false, message = null } = {}
  ) {
    const loadResult = await this.loadVault(vaultPath, password);
    if (!loadResult.success) return loadResult;

    try {
      const vault = loadResult.data;

      if (!vault.listEnvironmentNames().includes(envName)) {
        vault.addEnvironment(envName); // throws on a reserved name
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

      // --required is additive: marking a key required persists it, and updating
      // the value later (without the flag) does not silently un-require it.
      if (isRequired && !required.includes(key)) {
        required.push(key);
      }

      const currentVars = activeVersion ? { ...activeVersion.vars } : {};
      currentVars[key] = value;

      vault.addVersion(envName, currentVars, {
        nonSensitive,
        required,
        message,
      });

      return this.saveVault(vaultPath, password, vault);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  static async getEnv(vaultPath, password, envName, key) {
    const loadResult = await this.loadVault(vaultPath, password);
    if (!loadResult.success) return loadResult;

    try {
      const vault = loadResult.data;
      const resolver = new EnvironmentResolver(vault);
      // Resolves layering + template refs; throws if the key is absent (after
      // inheritance) or a reference cannot be resolved.
      const value = resolver.resolveValue(envName, key);

      return { success: true, data: { key, value } };
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
      vault.removeEnvironment(envName); // throws if the environment is missing

      // Deleting an environment discards its entire version history, so keep a
      // timestamped snapshot of the pre-delete vault alongside the rolling .bak.
      if (await fs.pathExists(vaultPath)) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        await fs.copy(vaultPath, `${vaultPath}.deleted.${stamp}`, {
          overwrite: true,
        });
      }

      return this.saveVault(vaultPath, password, vault);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  static async setExtends(vaultPath, password, envName, parent) {
    const loadResult = await this.loadVault(vaultPath, password);
    if (!loadResult.success) return loadResult;

    try {
      const vault = loadResult.data;
      vault.setExtends(envName, parent);
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

  static async copyEnv(vaultPath, password, sourceName, destName) {
    const loadResult = await this.loadVault(vaultPath, password);
    if (!loadResult.success) return loadResult;

    try {
      const vault = loadResult.data;
      // Reading the source first validates it exists before we mutate anything.
      const activeVersion = vault.getActiveVersion(sourceName);
      vault.addEnvironment(destName);

      if (activeVersion) {
        vault.addVersion(
          destName,
          { ...activeVersion.vars },
          {
            required: [...activeVersion.required],
            nonSensitive: [...activeVersion.nonSensitive],
            message: `Copied from '${sourceName}'`,
          }
        );
      }

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
      const resolver = new EnvironmentResolver(vault);
      // Resolve layering + template refs; a broken reference throws and is
      // surfaced as an error below (also covers `run`, which calls this).
      const vars = resolver.resolveEnvironment(envName);

      if (!activeVersion && Object.keys(vars).length === 0) {
        return {
          success: false,
          error: `Environment '${envName}' has no versions`,
        };
      }

      if (format === 'json') {
        return { success: true, data: vars };
      }

      const lines = Object.entries(vars).map(
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

      // Compare the resolved (layered + template-resolved) views (SPEC §6.3).
      const resolver = new EnvironmentResolver(vault);
      const varsA = resolver.resolveEnvironment(envA);
      const varsB = resolver.resolveEnvironment(envB);

      const keysA = new Set(Object.keys(varsA));
      const keysB = new Set(Object.keys(varsB));

      const added = [...keysB].filter((k) => !keysA.has(k));
      const removed = [...keysA].filter((k) => !keysB.has(k));
      const changed = [...keysA].filter(
        (k) => keysB.has(k) && varsA[k] !== varsB[k]
      );
      const unchanged = [...keysA].filter(
        (k) => keysB.has(k) && varsA[k] === varsB[k]
      );

      return {
        success: true,
        data: { added, removed, changed, unchanged },
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  static async validateEnv(vaultPath, password, envName) {
    const loadResult = await this.loadVault(vaultPath, password);
    if (!loadResult.success) return loadResult;

    try {
      const vault = loadResult.data;
      // Throws if the environment does not exist.
      const activeVersion = vault.getActiveVersion(envName);

      const errors = [];
      const warnings = [];

      // Resolve layering + template refs first. Any resolution failure
      // (missing ref, cycle, depth overflow, broken extends) is recorded as a
      // validation error instead of crashing the command.
      const resolver = new EnvironmentResolver(vault);
      let vars = activeVersion ? activeVersion.vars : {};
      let required = [];
      let resolved = false;
      try {
        vars = resolver.resolveEnvironment(envName);
        required = resolver.aggregateRequired(envName);
        resolved = true;
      } catch (err) {
        errors.push(err.message);
      }

      if (resolved) {
        for (const key of required) {
          if (!(key in vars)) {
            errors.push(`Missing required key: ${key}`);
          } else if (vars[key] === '' || vars[key] == null) {
            errors.push(`Required key is empty: ${key}`);
          }
        }
      }

      for (const [key, value] of Object.entries(vars)) {
        if (typeof value !== 'string') {
          errors.push(`Value for ${key} is not a string`);
        }
        if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
          warnings.push(
            `Non-standard key name: "${key}" (expected UPPER_CASE)`
          );
        }
        if (
          typeof value === 'string' &&
          !required.includes(key) &&
          SUSPICIOUS_VALUE_RE.test(value)
        ) {
          warnings.push(
            `Possible secret in non-required key "${key}" (looks like a private key or live token)`
          );
        }
      }

      return {
        success: true,
        data: {
          envName,
          varCount: Object.keys(vars).length,
          requiredCount: required.length,
          errors,
          warnings,
        },
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}
