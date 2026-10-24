// @vitest-environment node
// Password vault format 2 in the services and the session (New-54, step 2):
// a key file + password open the vault into a data key, which loads, saves,
// edits settings, exports and makes a new recovery key. What later steps
// add is refused with UNSUPPORTED. Format 1 is untouched (its own tests).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { VaultService } from '../../../electron/services/VaultService.js';
import { VaultSettingsService } from '../../../electron/services/VaultSettingsService.js';
import { ImportExportService } from '../../../electron/services/ImportExportService.js';
import { VaultSession } from '../../../electron/services/VaultSession.js';
import {
  openPayload,
  recoveryKekOf,
  unwrapSlot,
} from '../../../electron/utils/passwordVaultEnvelope.js';
import {
  openVaultPayload,
  resealVaultPayload,
} from '../../../electron/utils/passwordVaultPayload.js';
import { RECOVERY_KEY, writeFormat2Vault } from '../../helpers/format2Vault.js';

const PW = 'Vault-Pass-12!';
const ENTRY = {
  id: 'e1',
  title: 'Mail',
  username: 'me',
  password: 'secret',
};

let dir;
let vs;
let keyFileKey;
let dek;
const file = () => fs.readJsonSync(path.join(dir, 'team.vault'));

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-format2-'));
  vs = new VaultService(dir);
  ({ keyFileKey, dek } = await writeFormat2Vault(vs, 'team', {
    password: PW,
    entries: { e1: ENTRY },
  }));
});
afterEach(() => fs.remove(dir));

describe('openWithKeyFile', () => {
  it('turns the password and key file into the data key', async () => {
    const opened = await vs.openWithKeyFile('team', PW, keyFileKey);
    expect(opened.success).toBe(true);
    expect(opened.credential.dek.equals(dek)).toBe(true);
    expect(opened).not.toHaveProperty('password');
  });

  it.each([
    ['a wrong key file', () => [PW, Buffer.alloc(32, 8)], 'KEY_FILE'],
    ['a wrong password', () => ['nope', keyFileKey], 'AUTH'],
  ])('refuses %s', async (_, args, code) => {
    const [password, key] = args();
    expect(await vs.openWithKeyFile('team', password, key)).toMatchObject({
      success: false,
      code,
    });
  });

  it('refuses a vault without a key file, a missing one, and a newer one', async () => {
    await vs.createVault('plain', PW);
    expect(await vs.openWithKeyFile('plain', PW, keyFileKey)).toMatchObject({
      code: 'NO_KEY_FILE',
    });
    expect(await vs.openWithKeyFile('ghost', PW, keyFileKey)).toMatchObject({
      code: 'NOT_FOUND',
    });
    await fs.writeJson(path.join(dir, 'team.vault'), { ...file(), version: 3 });
    expect(await vs.openWithKeyFile('team', PW, keyFileKey)).toMatchObject({
      code: 'NEWER_FORMAT',
    });
  });

  it('reports a changed header as tampered', async () => {
    await fs.writeJson(path.join(dir, 'team.vault'), {
      ...file(),
      features: [],
    });
    expect(await vs.openWithKeyFile('team', PW, keyFileKey)).toMatchObject({
      success: false,
      code: 'TAMPERED',
    });
  });

  it('reports an unreadable file', async () => {
    await fs.writeFile(path.join(dir, 'team.vault'), 'not json');
    expect(await vs.openWithKeyFile('team', PW, keyFileKey)).toMatchObject({
      success: false,
      code: 'ERROR',
    });
  });
});

describe('with the data key', () => {
  const credential = () => ({ dek: Buffer.from(dek) });

  it('a password alone is refused, and says the key file is needed', async () => {
    const expected = {
      success: false,
      code: 'KEY_FILE_REQUIRED',
      error: 'This vault needs its key file as well as its password.',
    };
    expect(await vs.verifyPassword('team', PW)).toEqual(expected);
    expect(await vs.loadVault('team', PW)).toEqual(expected);
  });

  it('loads, and saves in place keeping the header and both slots', async () => {
    const loaded = await vs.loadVault('team', credential());
    expect(loaded.success).toBe(true);
    expect(loaded.data.entries.e1.title).toBe('Mail');

    const before = file();
    loaded.data.entries.e2 = { ...ENTRY, id: 'e2', title: 'Bank' };
    expect(await vs.saveVault('team', credential(), loaded.data)).toEqual({
      success: true,
    });
    const after = file();
    expect(after.slots).toEqual(before.slots);
    expect(after.keyFile).toEqual(before.keyFile);
    expect(after.version).toBe(2);
    expect(after.iv).not.toBe(before.iv);
    const reopened = await vs.openWithKeyFile('team', PW, keyFileKey);
    expect(
      Object.keys(openPayload(after, reopened.credential.dek).entries).sort()
    ).toEqual(['e1', 'e2']);
  });

  it('refuses a save with a password alone, leaving the file', async () => {
    const before = fs.readFileSync(path.join(dir, 'team.vault'), 'utf8');
    const result = await vs.saveVault('team', PW, { entries: {} });
    expect(result).toMatchObject({ success: false, code: 'KEY_FILE_REQUIRED' });
    expect(fs.readFileSync(path.join(dir, 'team.vault'), 'utf8')).toBe(before);
  });

  it('reads and writes settings', async () => {
    const settings = new VaultSettingsService(dir);
    expect(
      await settings.updateVaultSettings('team', credential(), {
        maxPasswordHistory: 7,
      })
    ).toEqual({ success: true });
    expect(
      (await settings.getVaultSettings('team', credential())).settings
        .maxPasswordHistory
    ).toBe(7);
    expect(file().slots).toBeDefined();
    expect(await settings.getVaultSettings('team', PW)).toMatchObject({
      success: false,
      code: 'KEY_FILE_REQUIRED',
    });
    expect(
      await settings.updateVaultSettings('team', PW, { maxPasswordHistory: 2 })
    ).toMatchObject({ success: false, code: 'KEY_FILE_REQUIRED' });
  });

  it('exports, and refuses to import the export for now', async () => {
    const io = new ImportExportService(dir);
    const target = path.join(dir, 'team.vault.json');
    expect(await io.exportVault('team', credential(), target)).toEqual({
      success: true,
    });
    const exported = fs.readJsonSync(target);
    expect(exported.originalVaultData.version).toBe(2);
    expect(exported.metadata.version).toBe('1.0');
    expect(await io.importVault(target, 'copy', PW)).toEqual({
      success: false,
      code: 'UNSUPPORTED',
      error: "Importing a vault that uses a key file isn't supported yet.",
    });
  });

  it('makes a new recovery key, re-wrapping the recovery slot only', async () => {
    const before = file();
    const made = await vs.generateRecoveryKey('team', credential());
    expect(made.success).toBe(true);
    expect(made.recoveryKey).toMatch(/^[A-Z0-9-]+$/);
    const after = file();
    expect(after.slots.main).toEqual(before.slots.main);
    expect(after.slots.recovery.salt).not.toBe(before.slots.recovery.salt);
    const kek = await recoveryKekOf(made.recoveryKey, after.slots.recovery);
    expect(unwrapSlot(after, 'recovery', kek).equals(dek)).toBe(true);
    const oldKek = await recoveryKekOf(RECOVERY_KEY, after.slots.recovery);
    expect(() => unwrapSlot(after, 'recovery', oldKek)).toThrow(
      'Invalid recovery key'
    );
    // Still opens with the password and key file.
    expect((await vs.openWithKeyFile('team', PW, keyFileKey)).success).toBe(
      true
    );
  });

  it('refuses a new recovery key without the data key', async () => {
    expect(await vs.generateRecoveryKey('team', PW)).toMatchObject({
      success: false,
      code: 'KEY_FILE_REQUIRED',
    });
    expect(
      await vs.generateRecoveryKey('team', { dek: Buffer.alloc(32, 1) })
    ).toMatchObject({ success: false, code: 'TAMPERED' });
  });

  it('skips the KDF upgrade', async () => {
    expect(await vs.upgradeKdf('team', credential())).toEqual({
      success: true,
      upgraded: false,
    });
    expect(await vs.upgradeKdf('team', PW)).toEqual({
      success: true,
      upgraded: false,
    });
  });
});

describe('without the key file', () => {
  it.each([
    [
      'a password change',
      () => vs.changePassword('team', PW, 'Other-Pass-34!'),
    ],
    ['a delete', () => vs.deleteVault('team', PW)],
  ])('refuses %s, changing nothing', async (_, act) => {
    const before = fs.readdirSync(dir).sort();
    const content = fs.readFileSync(path.join(dir, 'team.vault'), 'utf8');
    expect(await act()).toMatchObject({
      success: false,
      code: 'KEY_FILE_REQUIRED',
    });
    expect(fs.readdirSync(dir).sort()).toEqual(before);
    expect(fs.readFileSync(path.join(dir, 'team.vault'), 'utf8')).toBe(content);
  });
});

describe('what later steps add', () => {
  it.each([
    [
      'recovery with the key',
      () => vs.loadVaultWithRecoveryKey('team', RECOVERY_KEY),
      'Recovery',
    ],
    [
      'checking a recovery key',
      () => vs.verifyRecoveryKey('team', RECOVERY_KEY),
      'Recovery',
    ],
    [
      'recovery with an old password',
      () => vs.loadVaultWithPassword('team', PW),
      'Recovery',
    ],
  ])('refuses %s, changing nothing', async (_, act, what) => {
    const before = fs.readdirSync(dir).sort();
    const content = fs.readFileSync(path.join(dir, 'team.vault'), 'utf8');
    expect(await act()).toEqual({
      success: false,
      code: 'UNSUPPORTED',
      error: `${what} isn't supported yet for a vault that uses a key file.`,
    });
    expect(fs.readdirSync(dir).sort()).toEqual(before);
    expect(fs.readFileSync(path.join(dir, 'team.vault'), 'utf8')).toBe(content);
  });
});

describe('the session with a data key', () => {
  it('owns a copy, hands each operation its own, and zeroes them', async () => {
    const session = new VaultSession();
    const given = Buffer.from(dek);
    session.open('team', { dek: given });
    given.fill(0); // the caller's copy: the session isn't affected
    let seen = Buffer.alloc(0);
    const result = await session.withPassword('team', async (credential) => {
      seen = credential.dek;
      expect(credential.dek.equals(dek)).toBe(true);
      return 'done';
    });
    expect(result).toBe('done');
    expect(seen).toHaveLength(32);
    expect(seen.every((b) => b === 0)).toBe(true);
    expect(session.isUnlocked('team')).toBe(true);
    session.close();
    expect(await session.withPassword('team', () => 'x')).toMatchObject({
      locked: true,
    });
  });

  it('a lock during a save never writes the vault under a zeroed key', async () => {
    const session = new VaultSession();
    session.open('team', { dek: Buffer.from(dek) });
    const loaded = await session.withPassword('team', (c) =>
      vs.loadVault('team', c)
    );
    await session.withPassword('team', async (credential) => {
      session.close(); // e.g. idle lock or sleep, mid-operation
      return vs.saveVault('team', credential, loaded.data);
    });
    const reopened = await vs.openWithKeyFile('team', PW, keyFileKey);
    expect(reopened.success).toBe(true);
    expect(openPayload(file(), reopened.credential.dek).entries.e1.title).toBe(
      'Mail'
    );
  });

  it('refuses a credential that is neither a password nor a data key', () => {
    const session = new VaultSession();
    expect(() =>
      session.open('team', /** @type {any} */ ({ dek: 'x' }))
    ).toThrow();
    expect(() => session.open('team', /** @type {any} */ (null))).toThrow();
  });

  it('caches no derived key while holding a data key', () => {
    const session = new VaultSession();
    session.open('team', { dek: Buffer.from(dek) });
    const salt = Buffer.alloc(32, 1);
    const a = session.deriveKey(PW, salt, 2000);
    a.fill(0);
    expect(session.deriveKey(PW, salt, 2000).every((b) => b === 0)).toBe(false);
  });
});

describe('the shared payload helpers', () => {
  it('refuse a data key for a format-1 vault', async () => {
    await vs.createVault('plain', PW);
    const plain = fs.readJsonSync(path.join(dir, 'plain.vault'));
    const derive = () => Buffer.alloc(32);
    expect(() => openVaultPayload(plain, { dek }, derive)).toThrow(
      'A format-1 vault is opened with its password'
    );
    expect(() => resealVaultPayload(plain, {}, { dek }, derive)).toThrow(
      'A format-1 vault is opened with its password'
    );
  });

  it('keep a format-1 header and its recovery data on reseal', async () => {
    await vs.createVault('plain', PW);
    const plain = fs.readJsonSync(path.join(dir, 'plain.vault'));
    const derive = (pw, salt, iterations) => vs.deriveKey(pw, salt, iterations);
    const payload = openVaultPayload(plain, PW, derive);
    const resealed = resealVaultPayload(plain, payload, PW, derive);
    expect(resealed.salt).toBe(plain.salt);
    expect(resealed.kdf).toEqual(plain.kdf);
    expect(resealed.recoveryMetadata).toEqual(plain.recoveryMetadata);
    expect(openVaultPayload(resealed, PW, derive)).toEqual(payload);
  });
});
