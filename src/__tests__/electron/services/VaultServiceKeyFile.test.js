// @vitest-environment node
// Turning a key file on and off, changing it, and changing the password or
// deleting a vault that uses one (New-54, step 3), on real files.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { VaultService } from '../../../electron/services/VaultService.js';
import {
  openPayload,
  recoveryKekOf,
  unwrapSlot,
} from '../../../electron/utils/passwordVaultEnvelope.js';

const PW = 'Vault-Pass-12!';
const NEW_PW = 'Brand-New-Pass-42!';
const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 8);

let dir;
let vs;
let recoveryKey;
const vaultPath = () => path.join(dir, 'team.vault');
const file = () => fs.readJsonSync(vaultPath());

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-keyfile-'));
  vs = new VaultService(dir);
  // createVault hands back the RecoveryData object.
  recoveryKey = (await vs.createVault('team', PW)).recoveryKey.data.key;
  const loaded = await vs.loadVault('team', PW);
  loaded.data.entries = { e1: { id: 'e1', title: 'Mail' } };
  await vs.saveVault('team', PW, loaded.data);
});
afterEach(() => fs.remove(dir));

const entriesWith = async (password, key) => {
  const opened = await vs.openWithKeyFile('team', password, key);
  expect(opened.success).toBe(true);
  return openPayload(file(), opened.credential.dek).entries;
};

describe('enableKeyFile', () => {
  it('rewrites the vault as format 2, keeping its entries and recovery key', async () => {
    await vs.fileService.createBackup('team');
    const result = await vs.enableKeyFile('team', PW, KEY);
    expect(result.success).toBe(true);
    expect(result).not.toHaveProperty('recoveryKey');
    expect(result.credential.dek).toHaveLength(32);

    expect(file()).toMatchObject({ version: 2, features: ['keyfile'] });
    expect(file()).not.toHaveProperty('recoveryMetadata');
    expect(Object.keys(await entriesWith(PW, KEY))).toEqual(['e1']);
    expect(await vs.usesKeyFile('team')).toBe(true);
    // The recovery key the user saved still opens it.
    const kek = await recoveryKekOf(recoveryKey, file().slots.recovery);
    expect(
      unwrapSlot(file(), 'recovery', kek).equals(result.credential.dek)
    ).toBe(true);
    // The format-1 backup opened with the password alone: gone.
    expect(fs.existsSync(`${vaultPath()}.backup`)).toBe(false);
    expect(await vs.verifyPassword('team', PW)).toMatchObject({
      code: 'KEY_FILE_REQUIRED',
    });
  });

  it('makes a recovery key when the vault has none, and returns it', async () => {
    await fs.writeJson(vaultPath(), { ...file(), recoveryMetadata: {} });
    const result = await vs.enableKeyFile('team', PW, KEY);
    expect(result.recoveryKey).toMatch(/^[A-Z0-9-]+$/);
    const kek = await recoveryKekOf(result.recoveryKey, file().slots.recovery);
    expect(
      unwrapSlot(file(), 'recovery', kek).equals(result.credential.dek)
    ).toBe(true);
  });

  it('refuses a wrong password, or a vault that already uses one', async () => {
    const before = fs.readFileSync(vaultPath(), 'utf8');
    expect(await vs.enableKeyFile('team', 'nope', KEY)).toEqual({
      success: false,
      code: 'AUTH',
      error: 'Invalid master password',
    });
    expect(fs.readFileSync(vaultPath(), 'utf8')).toBe(before);
    await vs.enableKeyFile('team', PW, KEY);
    expect(await vs.enableKeyFile('team', PW, KEY)).toEqual({
      success: false,
      code: 'INVALID',
      error: 'This vault already uses a key file.',
    });
  });

  it('reports a vault it cannot read', async () => {
    expect(await vs.enableKeyFile('ghost', PW, KEY)).toEqual({
      success: false,
      code: 'NOT_FOUND',
      error: 'Vault not found',
    });
    await fs.writeFile(vaultPath(), 'not json');
    expect(await vs.enableKeyFile('team', PW, KEY)).toEqual({
      success: false,
      error: 'Failed to turn the key file on',
    });
  });
});

describe('disableKeyFile', () => {
  beforeEach(() => vs.enableKeyFile('team', PW, KEY));

  it('rewrites the vault as format 1 with a new recovery key', async () => {
    const result = await vs.disableKeyFile('team', PW, KEY);
    expect(result.success).toBe(true);
    expect(result.recoveryKey).toMatch(/^[A-Z0-9-]+$/);
    expect(file().version).toBeUndefined();
    expect(await vs.verifyPassword('team', PW)).toEqual({ success: true });
    expect(Object.keys((await vs.loadVault('team', PW)).data.entries)).toEqual([
      'e1',
    ]);
    expect(
      (await vs.verifyRecoveryKey('team', result.recoveryKey)).success
    ).toBe(true);
    expect(await vs.usesKeyFile('team')).toBe(false);
  });

  it.each([
    ['a wrong key file', PW, OTHER_KEY, 'KEY_FILE'],
    ['a wrong password', 'nope', KEY, 'AUTH'],
  ])('refuses %s, changing nothing', async (_, password, key, code) => {
    const before = fs.readFileSync(vaultPath(), 'utf8');
    expect(await vs.disableKeyFile('team', password, key)).toMatchObject({
      success: false,
      code,
    });
    expect(fs.readFileSync(vaultPath(), 'utf8')).toBe(before);
  });
});

describe('changeKeyFile', () => {
  beforeEach(() => vs.enableKeyFile('team', PW, KEY));

  it('moves the vault to the new key file, the recovery slot untouched', async () => {
    const before = file();
    expect(await vs.changeKeyFile('team', PW, KEY, OTHER_KEY)).toEqual({
      success: true,
    });
    expect(file().slots.recovery).toEqual(before.slots.recovery);
    expect(file().keyFile.id).not.toBe(before.keyFile.id);
    expect(Object.keys(await entriesWith(PW, OTHER_KEY))).toEqual(['e1']);
    expect(await vs.openWithKeyFile('team', PW, KEY)).toMatchObject({
      code: 'KEY_FILE',
    });
    const kek = await recoveryKekOf(recoveryKey, file().slots.recovery);
    expect(unwrapSlot(file(), 'recovery', kek)).toHaveLength(32);
  });

  it.each([
    ['the same key file', PW, KEY, KEY, 'INVALID'],
    [
      'a wrong current key file',
      PW,
      OTHER_KEY,
      Buffer.alloc(32, 9),
      'KEY_FILE',
    ],
    ['a wrong password', 'nope', KEY, OTHER_KEY, 'AUTH'],
  ])('refuses %s', async (_, password, current, next, code) => {
    const before = fs.readFileSync(vaultPath(), 'utf8');
    expect(
      await vs.changeKeyFile('team', password, current, next)
    ).toMatchObject({ success: false, code });
    expect(fs.readFileSync(vaultPath(), 'utf8')).toBe(before);
  });
});

describe('changePassword on a vault with a key file', () => {
  beforeEach(() => vs.enableKeyFile('team', PW, KEY));
  const change = (current, next, key = KEY) =>
    vs.changePassword('team', current, next, { keyFileKey: key });

  it('re-wraps the main slot under the new password', async () => {
    const before = file();
    expect(await change(PW, NEW_PW)).toEqual({ success: true });
    expect(file().salt).not.toBe(before.salt);
    expect(file().slots.recovery).toEqual(before.slots.recovery);
    expect(Object.keys(await entriesWith(NEW_PW, KEY))).toEqual(['e1']);
    expect(await vs.openWithKeyFile('team', PW, KEY)).toMatchObject({
      code: 'AUTH',
    });
    // The old password joins the history: changing back is refused.
    expect((await change(NEW_PW, PW)).error).toBe(
      'This password has been used before. Please choose a different password.'
    );
  });

  it.each([
    [
      'the same password',
      PW,
      PW,
      KEY,
      { error: 'New password must be different from current password' },
    ],
    ['a wrong current password', 'nope', NEW_PW, KEY, { code: 'AUTH' }],
    ['a wrong key file', PW, NEW_PW, OTHER_KEY, { code: 'KEY_FILE' }],
    ['a weak new password', PW, 'short', KEY, { success: false }],
  ])(
    'refuses %s, changing nothing',
    async (_, current, next, key, expected) => {
      const before = fs.readFileSync(vaultPath(), 'utf8');
      expect(await change(current, next, key)).toMatchObject({
        success: false,
        ...expected,
      });
      expect(fs.readFileSync(vaultPath(), 'utf8')).toBe(before);
    }
  );
});

describe('deleteVault on a vault with a key file', () => {
  beforeEach(() => vs.enableKeyFile('team', PW, KEY));

  it('deletes with the password and the key file', async () => {
    const result = await vs.deleteVault('team', PW, KEY);
    expect(result).toMatchObject({ success: true });
    expect(fs.existsSync(vaultPath())).toBe(false);
  });

  it('refuses a wrong key file or password, keeping the vault', async () => {
    expect(await vs.deleteVault('team', PW, OTHER_KEY)).toMatchObject({
      success: false,
      code: 'KEY_FILE',
      error: "This key file isn't the one this vault uses. Vault not deleted.",
    });
    expect(await vs.deleteVault('team', 'nope', KEY)).toMatchObject({
      success: false,
      code: 'AUTH',
    });
    expect(fs.existsSync(vaultPath())).toBe(true);
  });
});

describe('usesKeyFile', () => {
  it('is false for format 1 and a missing vault', async () => {
    expect(await vs.usesKeyFile('team')).toBe(false);
    expect(await vs.usesKeyFile('ghost')).toBe(false);
  });
});
