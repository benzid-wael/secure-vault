// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
