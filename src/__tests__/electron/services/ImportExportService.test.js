// @vitest-environment node
// Export and import of password vaults, on real files; an export reads an
// opened vault from its own folder (GUI-ENV-BREAKDOWN New-53).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { ImportExportService } from '../../../electron/services/ImportExportService.js';
import { VaultService } from '../../../electron/services/VaultService.js';
import { OpenedVaults } from '../../../electron/services/OpenedVaults.js';
import { RECOVERY_KEY, writeFormat2Vault } from '../../helpers/format2Vault.js';

const PW = 'Vault-Pass-12!';

let dir;
let vaultsDir;
let service;
const at = (...parts) => path.join(dir, ...parts);

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-import-export-'));
  vaultsDir = at('vaults');
  await new VaultService(vaultsDir).createVault('work', PW);
  service = new ImportExportService(vaultsDir);
});
afterEach(() => fs.remove(dir));

describe('ImportExportService', () => {
  it('exports a vault and imports it under a new name', async () => {
    expect(
      await service.exportVault('work', PW, at('work.vault.json'))
    ).toEqual({
      success: true,
    });
    const exported = fs.readJsonSync(at('work.vault.json'));
    expect(exported).toMatchObject({
      exportVersion: '1.0',
      vaultName: 'work',
      metadata: { hasSettings: true },
    });

    const imported = await service.importVault(
      at('work.vault.json'),
      'copy',
      PW
    );
    expect(imported.success).toBe(true);
    expect(
      (await new VaultService(vaultsDir).verifyPassword('copy', PW)).success
    ).toBe(true);
    // Re-encrypted under a fresh salt.
    expect(fs.readJsonSync(path.join(vaultsDir, 'copy.vault')).salt).not.toBe(
      exported.originalVaultData.salt
    );
  });

  it('exports a vault opened from another folder, from its own file', async () => {
    await new VaultService(at('shared')).createVault('team', PW);
    const opened = new OpenedVaults({ file: at('data', 'opened.json') });
    await opened.add(at('shared', 'team.vault'));
    const linked = new ImportExportService(vaultsDir, { links: opened });
    expect(await linked.exportVault('team', PW, at('team.vault.json'))).toEqual(
      { success: true }
    );
    expect(fs.readJsonSync(at('team.vault.json')).originalVaultData.salt).toBe(
      fs.readJsonSync(at('shared', 'team.vault')).salt
    );
    // An import can't take an opened vault's name.
    expect(await linked.importVault(at('team.vault.json'), 'team', PW)).toEqual(
      { success: false, error: 'Vault with this name already exists' }
    );
  });

  it('refuses an export with a wrong password or of a missing vault', async () => {
    const wrong = await service.exportVault('work', 'nope', at('x.json'));
    expect(wrong.success).toBe(false);
    expect(wrong.error).toMatch(/^Invalid password/);
    expect(fs.existsSync(at('x.json'))).toBe(false);
    expect(await service.exportVault('ghost', PW, at('x.json'))).toEqual({
      success: false,
      error: 'Vault not found',
    });
  });

  it('expands ~ in the export path', async () => {
    const home = at('home');
    await fs.ensureDir(home);
    vi.spyOn(os, 'homedir').mockReturnValue(home);
    try {
      expect(
        (await service.exportVault('work', PW, '~/w.vault.json')).success
      ).toBe(true);
      expect(fs.existsSync(path.join(home, 'w.vault.json'))).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it.each([
    ['an existing name', 'work', 'Vault with this name already exists'],
    ['a missing file', 'new', 'Import file not found'],
  ])('refuses an import to %s', async (_, name, error) => {
    expect(await service.importVault(at('missing.json'), name, PW)).toEqual({
      success: false,
      error,
    });
  });

  it('refuses an import that is not an export, or has another password', async () => {
    await fs.writeJson(at('plain.json'), { hello: 1 });
    expect(await service.importVault(at('plain.json'), 'new', PW)).toEqual({
      success: false,
      error: 'Invalid import file format',
    });
    await service.exportVault('work', PW, at('work.vault.json'));
    expect(
      await service.importVault(at('work.vault.json'), 'new', 'nope')
    ).toEqual({ success: false, error: 'Invalid password for import file' });
    expect(fs.existsSync(path.join(vaultsDir, 'new.vault'))).toBe(false);
  });

  it('reports an unreadable import file', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await fs.writeFile(at('broken.json'), 'not json');
    expect(await service.importVault(at('broken.json'), 'new', PW)).toEqual({
      success: false,
      error: 'Failed to import vault',
    });
    spy.mockRestore();
  });
});

// New-55: an export of a vault that uses a key file.
describe('importing an export of a vault with a key file', () => {
  let vs;
  let keyFileKey;
  let dek;
  const exportPath = () => at('team.vault.json');

  beforeEach(async () => {
    vs = new VaultService(vaultsDir);
    ({ keyFileKey, dek } = await writeFormat2Vault(vs, 'team', {
      password: PW,
      entries: {
        e1: { id: 'e1', title: 'Mail' },
        e2: { id: 'e2', title: 'Bank' },
      },
    }));
    expect(
      (await service.exportVault('team', { dek }, exportPath())).success
    ).toBe(true);
  });

  it('counts the entries in the export', () => {
    expect(fs.readJsonSync(exportPath()).metadata.entryCount).toBe(2);
  });

  it('imports with the password and key file, as it was exported', async () => {
    const result = await service.importVault(exportPath(), 'copy', PW, {
      keyFileKey,
    });
    expect(result).toMatchObject({
      success: true,
      keyFile: true,
      metadata: { entryCount: 2 },
    });
    const opened = await vs.openWithKeyFile('copy', PW, keyFileKey);
    expect(opened.success).toBe(true);
    expect(
      Object.keys((await vs.loadVault('copy', opened.credential)).data.entries)
    ).toEqual(['e1', 'e2']);
    expect((await vs.openWithRecoveryKey('copy', RECOVERY_KEY)).success).toBe(
      true
    );
  });

  it('imports with the recovery key alone', async () => {
    const result = await service.importVault(exportPath(), 'copy', null, {
      recoveryKey: ` ${RECOVERY_KEY.toLowerCase()} `,
    });
    expect(result).toMatchObject({ success: true, keyFile: true });
    expect((await vs.openWithKeyFile('copy', PW, keyFileKey)).success).toBe(
      true
    );
  });

  it.each([
    ['neither key file nor recovery key', PW, () => ({}), 'KEY_FILE_REQUIRED'],
    [
      'a wrong key file',
      PW,
      () => ({ keyFileKey: Buffer.alloc(32, 1) }),
      'KEY_FILE',
    ],
    ['a wrong password', 'nope', () => ({ keyFileKey }), 'AUTH'],
    [
      'a wrong recovery key',
      null,
      () => ({ recoveryKey: 'WXYZ-WXYZ' }),
      'AUTH',
    ],
  ])('refuses %s, writing nothing', async (_, password, options, code) => {
    expect(
      await service.importVault(exportPath(), 'copy', password, options())
    ).toMatchObject({ success: false, code });
    expect(fs.existsSync(path.join(vaultsDir, 'copy.vault'))).toBe(false);
  });

  it('refuses a newer format and a damaged recovery slot', async () => {
    const data = fs.readJsonSync(exportPath());
    fs.writeJsonSync(exportPath(), {
      ...data,
      originalVaultData: { ...data.originalVaultData, version: 3 },
    });
    expect(
      await service.importVault(exportPath(), 'copy', PW, { keyFileKey })
    ).toMatchObject({ code: 'NEWER_FORMAT' });
    const slots = { ...data.originalVaultData.slots };
    delete slots.recovery;
    fs.writeJsonSync(exportPath(), {
      ...data,
      originalVaultData: { ...data.originalVaultData, slots },
    });
    expect(
      await service.importVault(exportPath(), 'copy', null, {
        recoveryKey: RECOVERY_KEY,
      })
    ).toMatchObject({ code: 'TAMPERED' });
  });
});
