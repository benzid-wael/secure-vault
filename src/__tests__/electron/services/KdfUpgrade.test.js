// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { CryptographyService } from '../../../electron/services/CryptographyService.js';
import { VaultService } from '../../../electron/services/VaultService.js';
import { VaultSettingsService } from '../../../electron/services/VaultSettingsService.js';
import { VaultSession } from '../../../electron/services/VaultSession.js';
import { EnvironmentVaultService } from '../../../electron/services/EnvironmentVaultService.js';
import { KeyRecoveryService } from '../../../electron/services/recovery/KeyRecoveryService.js';
import { RecoveryData } from '../../../electron/services/recovery/IRecoveryMethod.js';

const PW = 'Correct-Horse-9!';
const NEW_PW = 'Battery-Staple-7?';
const { ITERATIONS, LEGACY_ITERATIONS } = CryptographyService;

/** Run `fn` as the code did before `kdf` existed: 100k, no header. */
async function asLegacy(fn) {
  const original = CryptographyService.ITERATIONS;
  CryptographyService.ITERATIONS = LEGACY_ITERATIONS;
  const spy = vi
    .spyOn(CryptographyService, 'kdfHeader')
    .mockReturnValue(undefined);
  try {
    return await fn();
  } finally {
    CryptographyService.ITERATIONS = original;
    spy.mockRestore();
  }
}

describe('CryptographyService KDF parameters', () => {
  it('uses 600k for new keys and records it', () => {
    expect(ITERATIONS).toBe(600000);
    expect(CryptographyService.kdfHeader()).toEqual({
      name: 'pbkdf2-sha512',
      iterations: 600000,
    });
  });

  it('reads records without a header at the legacy count', () => {
    expect(CryptographyService.iterationsOf({ salt: 'aa' })).toBe(100000);
    expect(CryptographyService.needsKdfUpgrade({ salt: 'aa' })).toBe(true);
    expect(
      CryptographyService.needsKdfUpgrade({
        salt: 'aa',
        kdf: CryptographyService.kdfHeader(),
      })
    ).toBe(false);
  });

  it.each([
    [{ name: 'scrypt', iterations: 600000 }],
    [{ name: 'pbkdf2-sha512', iterations: 1000 }],
    [{ name: 'pbkdf2-sha512', iterations: 1e9 }],
    [{ name: 'pbkdf2-sha512', iterations: '600000' }],
  ])('refuses unsupported or tampered parameters %j', (kdf) => {
    expect(() => CryptographyService.iterationsOf({ salt: 'aa', kdf })).toThrow(
      'Unsupported key derivation parameters'
    );
  });

  it('requires iterations explicitly', () => {
    expect(() => CryptographyService.deriveKey('pw', Buffer.alloc(32))).toThrow(
      'iterations is required'
    );
  });
});

describe('desktop vaults', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-kdf-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const readFile = (name = 'main') =>
    fs.readJSONSync(path.join(dir, `${name}.vault`));

  it('new vaults and their recovery metadata are written at 600k', async () => {
    const vs = new VaultService(dir);
    await vs.createVault('main', PW);
    const file = readFile();
    expect(file.kdf).toEqual(CryptographyService.kdfHeader());
    expect(file.recoveryMetadata.recoveryKey.kdf).toEqual(
      CryptographyService.kdfHeader()
    );
  });

  it('still opens a legacy vault', async () => {
    await asLegacy(() => new VaultService(dir).createVault('main', PW));
    expect(readFile().kdf).toBeUndefined();

    const vs = new VaultService(dir);
    expect((await vs.verifyPassword('main', PW)).success).toBe(true);
    expect((await vs.loadVault('main', PW)).success).toBe(true);
  });

  it('upgradeKdf re-keys a legacy vault, keeps its data and recovery key, drops previous-password metadata', async () => {
    const created = await asLegacy(async () => {
      const vs = new VaultService(dir);
      const result = await vs.createVault('main', PW);
      await vs.saveVault('main', PW, {
        entries: { a: { id: 'a', title: 'Gmail', password: 'x' } },
      });
      // A password change creates previous-password metadata (legacy too).
      await vs.changePassword('main', PW, NEW_PW);
      return result;
    });
    // Recovery key metadata was rebuilt at the change; keep its key.
    const legacy = readFile();
    expect(legacy.kdf).toBeUndefined();
    expect(legacy.recoveryMetadata.lastUsedPassword).toBeDefined();
    fs.writeJSONSync(path.join(dir, 'main.vault.backup'), legacy);

    const vs = new VaultService(dir);
    const upgrade = await vs.upgradeKdf('main', NEW_PW);
    expect(upgrade).toEqual({ success: true, upgraded: true });

    const file = readFile();
    expect(CryptographyService.iterationsOf(file)).toBe(ITERATIONS);
    expect(file.salt).not.toBe(legacy.salt);
    expect(file.recoveryMetadata.lastUsedPassword).toBeUndefined();
    expect(
      CryptographyService.iterationsOf(file.recoveryMetadata.recoveryKey)
    ).toBe(ITERATIONS);
    // The legacy backup would undo the upgrade, so it is gone.
    expect(fs.existsSync(path.join(dir, 'main.vault.backup'))).toBe(false);

    const loaded = await vs.loadVault('main', NEW_PW);
    expect(loaded.success).toBe(true);
    expect(Object.values(loaded.data.entries)[0].title).toBe('Gmail');

    // The recovery key the user saved at creation still recovers the vault.
    const recovered = await new KeyRecoveryService().recoverMasterPassword(
      'main',
      file.recoveryMetadata.recoveryKey,
      new RecoveryData({ data: { key: created.recoveryKey.data.key } })
    );
    expect(recovered).toMatchObject({ success: true, masterPassword: NEW_PW });

    // Idempotent.
    expect(await vs.upgradeKdf('main', NEW_PW)).toEqual({
      success: true,
      upgraded: false,
    });
  });

  it('upgradeKdf with a wrong password changes nothing', async () => {
    await asLegacy(() => new VaultService(dir).createVault('main', PW));
    const before = readFile();
    const result = await new VaultService(dir).upgradeKdf('main', 'wrong');
    expect(result.success).toBe(false);
    expect(readFile()).toEqual(before);
  });

  it('a save keeps salt and kdf once current, so the session key is reused', async () => {
    const vs = new VaultService(dir);
    await vs.createVault('main', PW);
    const { salt, kdf } = readFile();
    await vs.saveVault('main', PW, { entries: {} });
    expect(readFile()).toMatchObject({ salt, kdf });
  });

  it('a save on a legacy vault writes it at 600k', async () => {
    await asLegacy(() => new VaultService(dir).createVault('main', PW));
    const vs = new VaultService(dir);
    await vs.saveVault('main', PW, { entries: {} });
    expect(CryptographyService.iterationsOf(readFile())).toBe(ITERATIONS);
    expect((await vs.loadVault('main', PW)).success).toBe(true);
  });

  it('settings updates keep the kdf header of the file', async () => {
    await new VaultService(dir).createVault('main', PW);
    const { salt, kdf } = readFile();
    const result = await new VaultSettingsService(dir).updateVaultSettings(
      'main',
      PW,
      { autoLockMinutes: 5 }
    );
    expect(result.success).toBe(true);
    expect(readFile()).toMatchObject({ salt, kdf });
    expect((await new VaultService(dir).loadVault('main', PW)).success).toBe(
      true
    );
  });
});

describe('VaultSession.deriveKey', () => {
  it('derives each salt once for the session password', () => {
    const spy = vi.spyOn(CryptographyService, 'deriveKey');
    const session = new VaultSession();
    session.open('main', PW);
    const salt = CryptographyService.generateSalt();
    const a = session.deriveKey(PW, salt, 1000);
    const b = session.deriveKey(PW, salt, 1000);
    expect(a.equals(b)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('never caches another password and forgets keys on close', () => {
    const spy = vi.spyOn(CryptographyService, 'deriveKey');
    const session = new VaultSession();
    session.open('main', PW);
    const salt = CryptographyService.generateSalt();
    session.deriveKey('other', salt, 1000);
    session.deriveKey('other', salt, 1000);
    expect(spy).toHaveBeenCalledTimes(2);

    session.deriveKey(PW, salt, 1000);
    session.close();
    session.open('main', PW);
    session.deriveKey(PW, salt, 1000);
    expect(spy).toHaveBeenCalledTimes(4);
    spy.mockRestore();
  });

  it('hands out copies, so callers cannot corrupt the cache', () => {
    const session = new VaultSession();
    session.open('main', PW);
    const salt = CryptographyService.generateSalt();
    const first = session.deriveKey(PW, salt, 1000);
    const expected = Buffer.from(first);
    first.fill(0);
    expect(session.deriveKey(PW, salt, 1000).equals(expected)).toBe(true);
  });
});

describe('CLI environment vaults', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-kdf-env-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('opens a legacy env vault and upgrades it on the next save', async () => {
    const vaultPath = path.join(dir, '.env.vault');
    await asLegacy(() => EnvironmentVaultService.createVault(vaultPath, PW));
    expect(fs.readJSONSync(vaultPath).kdf).toBeUndefined();

    const loaded = await EnvironmentVaultService.loadVault(vaultPath, PW);
    expect(loaded.success).toBe(true);

    await EnvironmentVaultService.saveVault(vaultPath, PW, loaded.data);
    expect(fs.readJSONSync(vaultPath).kdf).toEqual(
      CryptographyService.kdfHeader()
    );
    expect(
      (await EnvironmentVaultService.loadVault(vaultPath, PW)).success
    ).toBe(true);
  });
});

describe('CLI environment vaults: key reuse', () => {
  let dir;
  let vaultPath;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-kdf-reuse-'));
    vaultPath = path.join(dir, '.env.vault');
    await EnvironmentVaultService.createVault(vaultPath, PW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a mutation derives the key once and keeps the salt', async () => {
    const { salt, kdf } = fs.readJSONSync(vaultPath);
    const spy = vi.spyOn(CryptographyService, 'deriveKey');

    const result = await EnvironmentVaultService.setEnv(
      vaultPath,
      PW,
      'dev',
      'TOKEN',
      'abc'
    );

    expect(result.success).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(fs.readJSONSync(vaultPath)).toMatchObject({ salt, kdf });
    const got = await EnvironmentVaultService.getEnv(
      vaultPath,
      PW,
      'dev',
      'TOKEN'
    );
    expect(got.success).toBe(true);
  });

  it('a password change still gets a fresh salt', async () => {
    const { salt } = fs.readJSONSync(vaultPath);
    const result = await EnvironmentVaultService.changePassword(
      vaultPath,
      PW,
      NEW_PW
    );
    expect(result.success).toBe(true);
    expect(fs.readJSONSync(vaultPath).salt).not.toBe(salt);
    expect(
      (await EnvironmentVaultService.loadVault(vaultPath, NEW_PW)).success
    ).toBe(true);
    expect(
      (await EnvironmentVaultService.loadVault(vaultPath, PW)).success
    ).toBe(false);
  });

  it('a legacy vault is upgraded (fresh 600k salt) by its first mutation', async () => {
    const legacyPath = path.join(dir, 'legacy.env.vault');
    await asLegacy(() => EnvironmentVaultService.createVault(legacyPath, PW));
    const { salt } = fs.readJSONSync(legacyPath);
    await EnvironmentVaultService.setEnv(legacyPath, PW, 'dev', 'K', 'v');
    const file = fs.readJSONSync(legacyPath);
    expect(file.salt).not.toBe(salt);
    expect(CryptographyService.iterationsOf(file)).toBe(ITERATIONS);
  });
});

describe('backups after a re-key', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-bak-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const opensWith = async (file, password) => {
    try {
      CryptographyService.decrypt(
        { encrypted: file.encrypted, authTag: file.authTag, iv: file.iv },
        CryptographyService.deriveKeyFor(password, file)
      );
      return true;
    } catch {
      return false;
    }
  };

  it('CLI: a normal write keeps the previous good state in .bak', async () => {
    const vaultPath = path.join(dir, '.env.vault');
    await EnvironmentVaultService.createVault(vaultPath, PW);
    await EnvironmentVaultService.setEnv(vaultPath, PW, 'dev', 'A', '1');
    const before = fs.readJSONSync(vaultPath);
    await EnvironmentVaultService.setEnv(vaultPath, PW, 'dev', 'B', '2');
    expect(fs.readJSONSync(`${vaultPath}.bak`)).toEqual(before);
  });

  it('CLI: after change-password, .bak no longer opens with the old password', async () => {
    const vaultPath = path.join(dir, '.env.vault');
    await EnvironmentVaultService.createVault(vaultPath, PW);
    await EnvironmentVaultService.setEnv(vaultPath, PW, 'dev', 'A', '1');

    const result = await EnvironmentVaultService.changePassword(
      vaultPath,
      PW,
      NEW_PW
    );
    expect(result.success).toBe(true);

    const bak = fs.readJSONSync(`${vaultPath}.bak`);
    expect(bak).toEqual(fs.readJSONSync(vaultPath));
    expect(await opensWith(bak, PW)).toBe(false);
    expect(await opensWith(bak, NEW_PW)).toBe(true);
  });

  it('CLI: after the 600k upgrade, .bak is not left at 100k', async () => {
    const vaultPath = path.join(dir, '.env.vault');
    await asLegacy(async () => {
      await EnvironmentVaultService.createVault(vaultPath, PW);
      await EnvironmentVaultService.setEnv(vaultPath, PW, 'dev', 'A', '1');
    });
    await EnvironmentVaultService.setEnv(vaultPath, PW, 'dev', 'B', '2');
    const bak = fs.readJSONSync(`${vaultPath}.bak`);
    expect(CryptographyService.iterationsOf(bak)).toBe(ITERATIONS);
  });

  it('desktop: a successful password change removes the backup', async () => {
    const vs = new VaultService(dir);
    await vs.createVault('main', PW);
    const result = await vs.changePassword('main', PW, NEW_PW);
    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(dir, 'main.vault.backup'))).toBe(false);
    expect(await vs.fileService.hasBackup('main')).toBe(false);
    expect((await vs.loadVault('main', NEW_PW)).success).toBe(true);
  });

  it('desktop: a rejected password change leaves the vault untouched', async () => {
    const vs = new VaultService(dir);
    await vs.createVault('main', PW);
    const before = fs.readJSONSync(path.join(dir, 'main.vault'));
    const result = await vs.changePassword('main', 'wrong-Current-1!', NEW_PW);
    expect(result.success).toBe(false);
    expect(fs.readJSONSync(path.join(dir, 'main.vault'))).toEqual(before);
    expect((await vs.loadVault('main', PW)).success).toBe(true);
  });
});
