// @vitest-environment node
// Recovering a vault that uses a key file (New-54 step 5, D2): its recovery
// key alone opens it, and a new password replaces the forgotten one, with a
// new key file or none.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { VaultService } from '../../../electron/services/VaultService.js';
import { RECOVERY_KEY, writeFormat2Vault } from '../../helpers/format2Vault.js';

const PW = 'Vault-Pass-12!';
const NEW_PW = 'Fresh-Pass-34!';
const ENTRY = { id: 'e1', title: 'Mail', username: 'me', password: 'secret' };
const NEW_KEY = Buffer.alloc(32, 9);

let dir;
let vs;
let keyFileKey;
let dek;
const vaultPath = () => path.join(dir, 'team.vault');
const file = () => fs.readJsonSync(vaultPath());
const entriesOf = (loaded) => loaded.data.entries;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-kf-recovery-'));
  vs = new VaultService(dir);
  ({ keyFileKey, dek } = await writeFormat2Vault(vs, 'team', {
    password: PW,
    entries: { e1: ENTRY },
  }));
});
afterEach(() => fs.remove(dir));

describe('openWithRecoveryKey', () => {
  it('opens the vault into its data key, typed any way', async () => {
    const opened = await vs.openWithRecoveryKey(
      'team',
      ` ${RECOVERY_KEY.toLowerCase().replace(/-/g, '')} `
    );
    expect(opened.success).toBe(true);
    expect(opened.credential.dek.equals(dek)).toBe(true);
  });

  it.each([
    ['a wrong recovery key', 'team', 'WXYZ-WXYZ-WXYZ-WXYZ', 'AUTH'],
    ['an empty one', 'team', '  ', 'AUTH'],
    ['a missing vault', 'ghost', RECOVERY_KEY, 'NOT_FOUND'],
  ])('refuses %s', async (_, name, key, code) => {
    expect(await vs.openWithRecoveryKey(name, key)).toMatchObject({
      success: false,
      code,
    });
  });

  it('refuses a vault without a key file, a newer one and a damaged one', async () => {
    await vs.createVault('plain', PW);
    expect(await vs.openWithRecoveryKey('plain', RECOVERY_KEY)).toMatchObject({
      code: 'NO_KEY_FILE',
    });
    const original = file();
    await fs.writeJson(vaultPath(), { ...original, version: 3 });
    expect(await vs.openWithRecoveryKey('team', RECOVERY_KEY)).toMatchObject({
      code: 'NEWER_FORMAT',
    });
    const slots = { ...original.slots };
    delete slots.recovery;
    await fs.writeJson(vaultPath(), { ...original, slots });
    expect(await vs.openWithRecoveryKey('team', RECOVERY_KEY)).toMatchObject({
      code: 'TAMPERED',
    });
  });

  it('tells a changed payload from a wrong key', async () => {
    await fs.writeJson(vaultPath(), { ...file(), authTag: '00'.repeat(16) });
    expect(await vs.openWithRecoveryKey('team', RECOVERY_KEY)).toMatchObject({
      code: 'TAMPERED',
    });
  });
});

describe('verifyRecoveryKey', () => {
  it('says a new password comes next, and changes nothing', async () => {
    const content = fs.readFileSync(vaultPath(), 'utf8');
    expect(await vs.verifyRecoveryKey('team', RECOVERY_KEY)).toEqual({
      success: true,
      keyFile: true,
    });
    expect(await vs.verifyRecoveryKey('team', 'WXYZ-WXYZ')).toMatchObject({
      success: false,
      code: 'AUTH',
      error: 'Invalid recovery key',
    });
    expect(fs.readFileSync(vaultPath(), 'utf8')).toBe(content);
  });
});

describe('resetWithRecoveryKey', () => {
  it('sets a new password and key file, keeping the recovery key and entries', async () => {
    const result = await vs.resetWithRecoveryKey(
      'team',
      RECOVERY_KEY,
      NEW_PW,
      NEW_KEY
    );
    expect(result.success).toBe(true);
    expect(result.credential.dek.equals(dek)).toBe(true);
    expect(result).not.toHaveProperty('recoveryKey');

    const opened = await vs.openWithKeyFile('team', NEW_PW, NEW_KEY);
    expect(opened.success).toBe(true);
    expect(entriesOf(await vs.loadVault('team', opened.credential))).toEqual({
      e1: expect.objectContaining({ title: 'Mail' }),
    });
    expect(await vs.openWithKeyFile('team', PW, NEW_KEY)).toMatchObject({
      code: 'AUTH',
    });
    expect(await vs.openWithKeyFile('team', NEW_PW, keyFileKey)).toMatchObject({
      code: 'KEY_FILE',
    });
    expect(await vs.openWithRecoveryKey('team', RECOVERY_KEY)).toMatchObject({
      success: true,
    });
  });

  it('without a key file, goes back to format 1 with a new recovery key', async () => {
    const result = await vs.resetWithRecoveryKey('team', RECOVERY_KEY, NEW_PW);
    expect(result).toMatchObject({
      success: true,
      recoveryKey: expect.stringMatching(/^[A-Z2-7]{4}(-[A-Z2-7]{1,4})+$/),
      recoveryKeyCreatedAt: expect.any(String),
    });
    expect(result).not.toHaveProperty('credential');
    expect(file().version).toBeUndefined();
    expect(await vs.usesKeyFile('team')).toBe(false);
    expect(entriesOf(await vs.loadVault('team', NEW_PW))).toEqual({
      e1: expect.objectContaining({ title: 'Mail' }),
    });
    expect(
      (await vs.loadVaultWithRecoveryKey('team', result.recoveryKey)).success
    ).toBe(true);
    expect(
      (await vs.loadVaultWithRecoveryKey('team', RECOVERY_KEY)).success
    ).toBe(false);
  });

  it.each([
    ['a weak password', RECOVERY_KEY, 'short', 'INVALID'],
    ['a wrong recovery key', 'WXYZ-WXYZ-WXYZ', NEW_PW, 'AUTH'],
  ])('refuses %s, changing nothing', async (_, key, password, code) => {
    const before = fs.readdirSync(dir).sort();
    const content = fs.readFileSync(vaultPath(), 'utf8');
    expect(
      await vs.resetWithRecoveryKey('team', key, password, NEW_KEY)
    ).toMatchObject({ success: false, code });
    expect(fs.readdirSync(dir).sort()).toEqual(before);
    expect(fs.readFileSync(vaultPath(), 'utf8')).toBe(content);
  });

  it('keeps the vault as it was when the write fails', async () => {
    const content = fs.readFileSync(vaultPath(), 'utf8');
    vs.fileService.atomicWriteVaultFile = async () => {
      throw Object.assign(new Error('/secret/path is full'), {
        code: 'ENOSPC',
      });
    };
    expect(
      await vs.resetWithRecoveryKey('team', RECOVERY_KEY, NEW_PW, NEW_KEY)
    ).toEqual({ success: false, error: 'Failed to recover the vault' });
    expect(fs.readFileSync(vaultPath(), 'utf8')).toBe(content);
  });
});
