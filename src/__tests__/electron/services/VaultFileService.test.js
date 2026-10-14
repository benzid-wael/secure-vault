// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { VaultFileService } from '../../../electron/services/VaultFileService.js';

describe('VaultFileService vault-name containment', () => {
  let root;
  let dir;
  let vfs;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-vfs-'));
    dir = path.join(root, 'vaults');
    vfs = new VaultFileService(dir);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('keeps ordinary names inside the vault directory', () => {
    expect(vfs.getVaultPath('main')).toBe(path.join(dir, 'main.vault'));
    expect(vfs.getBackupPath('my vault')).toBe(
      path.join(dir, 'my vault.vault.backup')
    );
    expect(vfs.getTempPath('a.b')).toBe(path.join(dir, 'a.b.vault.tmp'));
  });

  it.each([
    '../escape',
    '../../etc/passwd',
    'sub/dir',
    'sub\\dir',
    '/abs',
    '.',
    '..',
    '',
    'nul\0byte',
  ])('refuses %j', (name) => {
    expect(() => vfs.getVaultPath(name)).toThrow('Invalid vault name');
    expect(() => vfs.getBackupPath(name)).toThrow('Invalid vault name');
    expect(() => vfs.getTempPath(name)).toThrow('Invalid vault name');
  });

  it('refuses non-string names', () => {
    expect(() => vfs.getVaultPath(undefined)).toThrow('Invalid vault name');
    expect(() => vfs.getVaultPath({})).toThrow('Invalid vault name');
  });

  it('never writes outside the vault directory', async () => {
    await expect(vfs.writeVaultFile('../outside', { x: 1 })).rejects.toThrow(
      'Invalid vault name'
    );
    expect(fs.existsSync(path.join(root, 'outside.vault'))).toBe(false);
  });

  it('deleteVault refuses a traversal name before touching the disk', async () => {
    const victim = path.join(root, 'victim.vault');
    fs.writeFileSync(victim, '{}');
    await expect(vfs.deleteVault('../victim')).rejects.toThrow(
      'Invalid vault name'
    );
    expect(fs.existsSync(victim)).toBe(true);
  });
});

describe('VaultFileService.writeVaultFile', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-vfs-write-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes through a temp file and leaves none behind', async () => {
    const vfs = new VaultFileService(dir);
    await vfs.writeVaultFile('main', { v: 1 });
    await vfs.writeVaultFile('main', { v: 2 });
    expect(fs.readJSONSync(path.join(dir, 'main.vault'))).toEqual({ v: 2 });
    expect(fs.existsSync(path.join(dir, 'main.vault.tmp'))).toBe(false);
  });

  it('keeps the previous vault intact when a write crashes midway', async () => {
    const vfs = new VaultFileService(dir);
    await vfs.writeVaultFile('main', { v: 1 });

    // Simulate a crash: half the bytes land on disk, then the write throws.
    const spy = vi
      .spyOn(fs, 'writeJSON')
      .mockImplementation(async (file, data) => {
        const text = JSON.stringify(data);
        fs.writeFileSync(file, text.slice(0, text.length / 2));
        throw new Error('crash');
      });
    try {
      await expect(vfs.writeVaultFile('main', { v: 2 })).rejects.toThrow(
        'crash'
      );
    } finally {
      spy.mockRestore();
    }
    expect(fs.readJSONSync(path.join(dir, 'main.vault'))).toEqual({ v: 1 });
  });
});
