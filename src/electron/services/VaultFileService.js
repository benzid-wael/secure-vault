import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

import { CryptographyService } from './CryptographyService.js';
import { moveWithRetry } from '../utils/moveWithRetry.js';

/** Copies kept per vault name from deleting it; older ones are removed. */
export const DELETED_COPIES_KEPT = 5;

// The `<ts>` in `<name>.vault.deleted.<ts>`: an ISO time with `:` and `.`
// replaced, so names sort in time order.
const DELETED_STAMP = /^\d{4}-\d{2}-\d{2}T[\d-]+Z$/;

export class VaultFileService {
  constructor(vaultDirectory) {
    // Resolve tilde and ensure absolute path
    this.vaultDirectory = this._resolvePath(vaultDirectory);
    this._ensureVaultDirectory();
  }

  _resolvePath(inputPath) {
    if (inputPath.startsWith('~')) {
      return path.join(os.homedir(), inputPath.slice(1));
    }
    return path.resolve(inputPath);
  }

  _ensureVaultDirectory() {
    fs.ensureDirSync(this.vaultDirectory);
  }

  /**
   * The path of `<vaultName><suffix>` inside the vault directory. Vault names
   * reach here from the renderer and the CLI, so a name that would resolve
   * anywhere else (separators, `..`, NUL) is refused rather than cleaned up.
   */
  _pathFor(vaultName, suffix) {
    if (
      typeof vaultName !== 'string' ||
      vaultName.length === 0 ||
      vaultName === '.' ||
      vaultName === '..' ||
      /[/\\\0]/.test(vaultName)
    ) {
      throw new Error('Invalid vault name');
    }
    const filePath = path.resolve(this.vaultDirectory, `${vaultName}${suffix}`);
    if (path.dirname(filePath) !== this.vaultDirectory) {
      throw new Error('Invalid vault name');
    }
    return filePath;
  }

  getVaultPath(vaultName) {
    return this._pathFor(vaultName, '.vault');
  }

  getBackupPath(vaultName) {
    return this._pathFor(vaultName, '.vault.backup');
  }

  getTempPath(vaultName) {
    return this._pathFor(vaultName, '.vault.tmp');
  }

  async vaultExists(vaultName) {
    return fs.pathExists(this.getVaultPath(vaultName));
  }

  async readVaultPath(vaultPath) {
    return fs.readJSON(vaultPath);
  }

  async writeVaultPath(vaultPath, data) {
    return fs.writeJSON(vaultPath, data, { spaces: 2 });
  }

  async readVaultFile(vaultName) {
    const vaultPath = this.getVaultPath(vaultName);
    return this.readVaultPath(vaultPath);
  }

  /**
   * Every vault write is atomic: a crash mid-write leaves either the old file
   * or the new one, never a truncated vault.
   */
  async writeVaultFile(vaultName, data) {
    return this.atomicWriteVaultFile(vaultName, data);
  }

  async atomicWriteVaultFile(vaultName, data) {
    const vaultPath = this.getVaultPath(vaultName);
    // A temp file per write: two writes in flight for the same vault must not
    // share one, or the first rename pulls it out from under the second.
    const tempPath = `${this.getTempPath(vaultName)}.${process.pid}.${crypto
      .randomBytes(6)
      .toString('hex')}`;

    try {
      // Write to temp file first
      await fs.writeJSON(tempPath, data, { spaces: 2 });

      // Verify temp file can be read
      await fs.readJSON(tempPath);

      // Replace the vault in one step: it never stops existing.
      await moveWithRetry(tempPath, vaultPath);
    } catch (error) {
      await fs.remove(tempPath).catch(() => {});
      throw error;
    }
  }

  async createBackup(vaultName) {
    const vaultPath = this.getVaultPath(vaultName);
    const backupPath = this.getBackupPath(vaultName);

    if (await fs.pathExists(vaultPath)) {
      await fs.copy(vaultPath, backupPath);
    }
  }

  async restoreFromBackup(vaultName) {
    const vaultPath = this.getVaultPath(vaultName);
    const backupPath = this.getBackupPath(vaultName);

    if (await fs.pathExists(backupPath)) {
      await fs.copy(backupPath, vaultPath);
      await fs.remove(backupPath);
      return true;
    }
    return false;
  }

  async removeBackup(vaultName) {
    await fs.remove(this.getBackupPath(vaultName));
  }

  /** Delete the backup when it was keyed with the legacy work factor. */
  async removeLegacyBackup(vaultName) {
    const backupPath = this.getBackupPath(vaultName);
    if (!(await fs.pathExists(backupPath))) return false;
    try {
      const backup = await fs.readJSON(backupPath);
      if (!CryptographyService.needsKdfUpgrade(backup)) return false;
    } catch {
      // Unreadable or unsupported: not something to restore from either.
    }
    await fs.remove(backupPath);
    return true;
  }

  async hasBackup(vaultName) {
    return fs.pathExists(this.getBackupPath(vaultName));
  }

  async deleteVault(vaultName) {
    const vaultPath = this.getVaultPath(vaultName);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const deletedBackupPath = this._pathFor(
      vaultName,
      `.vault.deleted.${timestamp}`
    );

    // Create backup before deletion
    await fs.copy(vaultPath, deletedBackupPath);

    // Delete main vault file
    await fs.remove(vaultPath);

    // Clean up related files
    const relatedFiles = [
      this.getBackupPath(vaultName),
      this.getTempPath(vaultName),
      this._pathFor(vaultName, '.recovery'),
    ];

    for (const filePath of relatedFiles) {
      if (await fs.pathExists(filePath)) {
        await fs.remove(filePath);
      }
    }

    await this._pruneDeletedCopies(vaultName);

    return path.basename(deletedBackupPath);
  }

  /**
   * Keep only the newest DELETED_COPIES_KEPT `.vault.deleted.<ts>` copies of
   * a vault name, so re-creating and deleting a vault doesn't pile up old
   * encrypted copies (some under retired passwords) without limit.
   */
  async _pruneDeletedCopies(vaultName) {
    const prefix = `${vaultName}.vault.deleted.`;
    const copies = (await fs.readdir(this.vaultDirectory))
      .filter(
        (file) =>
          file.startsWith(prefix) &&
          DELETED_STAMP.test(file.slice(prefix.length))
      )
      .sort();
    for (const file of copies.slice(0, -DELETED_COPIES_KEPT)) {
      await fs.remove(path.join(this.vaultDirectory, file));
    }
  }

  async listVaults() {
    try {
      const files = await fs.readdir(this.vaultDirectory);
      return files
        .filter((file) => file.endsWith('.vault'))
        .map((file) => file.replace('.vault', ''));
    } catch (error) {
      console.error('Error listing vaults:', error);
      return [];
    }
  }
}
