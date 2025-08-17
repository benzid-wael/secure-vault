import fs from 'fs-extra';
import path from 'path';
import os from 'os';

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

  getVaultPath(vaultName) {
    return path.join(this.vaultDirectory, `${vaultName}.vault`);
  }

  getBackupPath(vaultName) {
    return path.join(this.vaultDirectory, `${vaultName}.vault.backup`);
  }

  getTempPath(vaultName) {
    return path.join(this.vaultDirectory, `${vaultName}.vault.tmp`);
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

  async writeVaultFile(vaultName, data) {
    const vaultPath = this.getVaultPath(vaultName);
    return fs.writeJSON(vaultPath, data, { spaces: 2 });
  }

  async atomicWriteVaultFile(vaultName, data) {
    const vaultPath = this.getVaultPath(vaultName);
    const tempPath = this.getTempPath(vaultName);

    // Write to temp file first
    await fs.writeJSON(tempPath, data, { spaces: 2 });

    // Verify temp file can be read
    await fs.readJSON(tempPath);

    // Move temp file to final location (atomic operation)
    await fs.move(tempPath, vaultPath, { overwrite: true });
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

  async hasBackup(vaultName) {
    return fs.pathExists(this.getBackupPath(vaultName));
  }

  async deleteVault(vaultName) {
    const vaultPath = this.getVaultPath(vaultName);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const deletedBackupPath = path.join(
      this.vaultDirectory,
      `${vaultName}.vault.deleted.${timestamp}`
    );

    // Create backup before deletion
    await fs.copy(vaultPath, deletedBackupPath);

    // Delete main vault file
    await fs.remove(vaultPath);

    // Clean up related files
    const relatedFiles = [
      this.getBackupPath(vaultName),
      this.getTempPath(vaultName),
      path.join(this.vaultDirectory, `${vaultName}.recovery`),
    ];

    for (const filePath of relatedFiles) {
      if (await fs.pathExists(filePath)) {
        await fs.remove(filePath);
      }
    }

    return path.basename(deletedBackupPath);
  }

  async listVaults() {
    try {
      const files = await fs.readdir(this.vaultDirectory);
      return files
        .filter((file) => file.endsWith('.vault'))
        .map((file) => file.replace('.vault', ''));
    } catch (error) {
      return [];
    }
  }
}
