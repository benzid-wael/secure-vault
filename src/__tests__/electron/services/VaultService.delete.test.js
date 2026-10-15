// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { VaultService } from '../../../electron/services/VaultService.js';

const PASSWORD = 'Correct-Horse-9!';

describe('VaultService.deleteVault', () => {
  let dir;
  let vs;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-delete-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vs = new VaultService(dir);
    expect((await vs.createVault('work', PASSWORD)).success).toBe(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const vaultFile = () => path.join(dir, 'work.vault');

  it.each([undefined, null, ''])(
    'refuses without a password (%s)',
    async (password) => {
      const result = await vs.deleteVault('work', password);
      expect(result.success).toBe(false);
      expect(fs.existsSync(vaultFile())).toBe(true);
    }
  );

  it('refuses a wrong password', async () => {
    const result = await vs.deleteVault('work', 'Wrong-Horse-9!');
    expect(result).toEqual({
      success: false,
      error: 'Invalid password. Vault not deleted.',
    });
    expect(fs.existsSync(vaultFile())).toBe(true);
  });

  it('deletes with the right password and keeps a copy', async () => {
    const result = await vs.deleteVault('work', PASSWORD);
    expect(result.success).toBe(true);
    expect(fs.existsSync(vaultFile())).toBe(false);
    expect(fs.existsSync(path.join(dir, result.backupFile))).toBe(true);
  });
});
