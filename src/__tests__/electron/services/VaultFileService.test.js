// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import {
  VaultFileService,
  DELETED_COPIES_KEPT,
} from '../../../electron/services/VaultFileService.js';

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

describe('VaultFileService.deleteVault copies', () => {
  let dir;
  let vfs;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-vfs-del-'));
    vfs = new VaultFileService(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const stamp = (day) =>
    `2026-01-${String(day).padStart(2, '0')}T00-00-00-000Z`;

  it('keeps only the newest copies of that vault name', async () => {
    for (let day = 1; day <= DELETED_COPIES_KEPT + 2; day += 1) {
      fs.writeFileSync(path.join(dir, `work.vault.deleted.${stamp(day)}`), '');
    }
    // Other vaults' copies and unrelated files are left alone.
    fs.writeFileSync(path.join(dir, `work.b.vault.deleted.${stamp(1)}`), '');
    fs.writeFileSync(path.join(dir, 'work.vault.deleted.notes'), '');
    fs.writeFileSync(path.join(dir, 'work.vault'), '{}');

    const kept = await vfs.deleteVault('work');

    const copies = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith('work.vault.deleted.2'))
      .sort();
    expect(copies).toHaveLength(DELETED_COPIES_KEPT);
    expect(copies).toContain(kept);
    expect(copies).not.toContain(`work.vault.deleted.${stamp(1)}`);
    expect(copies).not.toContain(`work.vault.deleted.${stamp(2)}`);
    expect(
      fs.existsSync(path.join(dir, `work.b.vault.deleted.${stamp(1)}`))
    ).toBe(true);
    expect(fs.existsSync(path.join(dir, 'work.vault.deleted.notes'))).toBe(
      true
    );
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

describe('concurrent vault writes', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-vfs-race-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const leftovers = () => fs.readdirSync(dir).filter((n) => n.includes('.tmp'));

  it('two writes in flight for one vault both succeed and leave no temp file', async () => {
    const vfs = new VaultFileService(dir);
    await Promise.all([
      vfs.writeVaultFile('main', { v: 1 }),
      vfs.writeVaultFile('main', { v: 2 }),
    ]);
    expect([1, 2]).toContain(fs.readJSONSync(path.join(dir, 'main.vault')).v);
    expect(leftovers()).toEqual([]);
  });

  it('the startup double-fetch creates one default vault without errors', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { VaultService } = await import(
      '../../../electron/services/VaultService.js'
    );
    const vs = new VaultService(dir);
    const createSpy = vi.spyOn(vs, 'createVault');

    const [a, b] = await Promise.all([
      vs.getAvailableVaults(),
      vs.getAvailableVaults(),
    ]);

    expect(a).toContain('default');
    expect(b).toContain('default');
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(leftovers()).toEqual([]);
    // Later calls see the existing vault and create nothing.
    await vs.getAvailableVaults();
    expect(createSpy).toHaveBeenCalledTimes(1);
  });
});
