// @vitest-environment node
// Recovery paths of VaultService on a real vault: the recovery key and the
// previous password. Also how they meet the format check (New-29).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { VaultService } from '../../../electron/services/VaultService.js';

const PASSWORD = 'Correct-Horse-9!';
const NEXT = 'Battery-Staple-8?';

describe('VaultService recovery', () => {
  let dir;
  let vs;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-recovery-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vs = new VaultService(dir);
    expect((await vs.createVault('work', PASSWORD)).success).toBe(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('recovery key', () => {
    it('generates a key that verifies and opens the vault', async () => {
      const generated = await vs.generateRecoveryKey('work', PASSWORD);
      expect(generated.success).toBe(true);
      expect(
        (await vs.verifyRecoveryKey('work', generated.recoveryKey)).success
      ).toBe(true);
      const loaded = await vs.loadVaultWithRecoveryKey(
        'work',
        generated.recoveryKey
      );
      expect(loaded).toMatchObject({ success: true, password: PASSWORD });
      expect(loaded.data.entries).toEqual({});
    });

    it('refuses a wrong key', async () => {
      await vs.generateRecoveryKey('work', PASSWORD);
      const wrong = 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH';
      expect((await vs.verifyRecoveryKey('work', wrong)).success).toBe(false);
      expect((await vs.loadVaultWithRecoveryKey('work', wrong)).success).toBe(
        false
      );
    });

    it('needs the master password to generate one', async () => {
      expect(await vs.generateRecoveryKey('work', 'Wrong-Horse-9!')).toEqual({
        success: false,
        error: 'Invalid master password',
      });
    });

    it('rejects a malformed key and a missing vault', async () => {
      expect((await vs.verifyRecoveryKey('work', 'k')).success).toBe(false);
      for (const call of [
        () => vs.verifyRecoveryKey('ghost', 'k'),
        () => vs.loadVaultWithRecoveryKey('ghost', 'k'),
        () => vs.generateRecoveryKey('ghost', PASSWORD),
        () => vs.loadVaultWithPassword('ghost', PASSWORD),
      ]) {
        expect((await call()).error).toBe('Vault not found');
      }
    });

    it('opens a vault from a newer version read-only', async () => {
      const { recoveryKey } = await vs.generateRecoveryKey('work', PASSWORD);
      const file = path.join(dir, 'work.vault');
      await fs.writeJSON(file, {
        ...(await fs.readJSON(file)),
        features: ['attachments'],
      });
      const loaded = await vs.loadVaultWithRecoveryKey('work', recoveryKey);
      expect(loaded).toMatchObject({ success: true, readOnly: true });
    });
  });

  describe('previous password', () => {
    it('opens with the current password as is', async () => {
      const loaded = await vs.loadVaultWithPassword('work', PASSWORD);
      expect(loaded).toMatchObject({ success: true, password: PASSWORD });
    });

    it('needs a password change before an old password can recover', async () => {
      const result = await vs.loadVaultWithPassword('work', 'Old-Horse-1!');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/^No recovery data available/);
    });

    it('recovers with the previous password after a change', async () => {
      expect((await vs.changePassword('work', PASSWORD, NEXT)).success).toBe(
        true
      );
      const loaded = await vs.loadVaultWithPassword('work', PASSWORD);
      expect(loaded).toMatchObject({ success: true, password: NEXT });
      expect(
        (await vs.loadVaultWithPassword('work', 'Never-Used-3#')).success
      ).toBe(false);
    });
  });
});
