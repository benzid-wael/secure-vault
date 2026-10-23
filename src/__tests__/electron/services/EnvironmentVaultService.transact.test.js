// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { CryptographyService } from '../../../electron/services/CryptographyService.js';
import { EnvironmentVaultService } from '../../../electron/services/EnvironmentVaultService.js';
import { VaultLock } from '../../../electron/services/VaultLock.js';

const PW = 'Correct-Horse-9!';
const NEW_PW = 'Battery-Staple-7?';

const sha = (file) =>
  `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;

/** Write the vault as code did before `kdf` existed: legacy count, no header. */
async function asLegacy(fn) {
  const original = CryptographyService.ITERATIONS;
  CryptographyService.ITERATIONS = CryptographyService.LEGACY_ITERATIONS;
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

const setVar = (env, key, value) => (vault) => {
  if (!vault.listEnvironmentNames().includes(env)) vault.addEnvironment(env);
  const vars = { ...(vault.getActiveVersion(env)?.vars ?? {}) };
  vars[key] = value;
  vault.addVersion(env, vars);
};

describe('EnvironmentVaultService read / transact', () => {
  let dir;
  let vaultPath;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-tx-'));
    vaultPath = path.join(dir, '.env.vault');
    await EnvironmentVaultService.createVault(vaultPath, PW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const lockLeft = () => fs.existsSync(`${vaultPath}.lock`);

  describe('read', () => {
    it('returns the vault, its revision and reusable key material', async () => {
      const result = await EnvironmentVaultService.read(vaultPath, PW);

      expect(result.success).toBe(true);
      expect(result.vault.listEnvironmentNames()).toEqual([]);
      expect(result.revision).toBe(sha(vaultPath));
      expect(result.keyMaterial.key).toBeInstanceOf(Buffer);
      expect(result.keyMaterial.header.salt).toBe(
        fs.readJSONSync(vaultPath).salt
      );
    });

    it('opens with key material alone, without deriving', async () => {
      const { keyMaterial } = await EnvironmentVaultService.read(vaultPath, PW);
      const derive = vi.spyOn(CryptographyService, 'deriveKeyAsync');

      const result = await EnvironmentVaultService.read(vaultPath, {
        keyMaterial,
      });

      expect(result.success).toBe(true);
      expect(derive).not.toHaveBeenCalled();
    });

    it('reports NOT_FOUND, INVALID and AUTH', async () => {
      expect(
        await EnvironmentVaultService.read(path.join(dir, 'nope'), PW)
      ).toMatchObject({ success: false, code: 'NOT_FOUND' });

      fs.writeFileSync(path.join(dir, 'garbage'), '{not json');
      expect(
        await EnvironmentVaultService.read(path.join(dir, 'garbage'), PW)
      ).toMatchObject({ success: false, code: 'INVALID' });

      fs.writeJSONSync(path.join(dir, 'other'), { type: 'password-vault' });
      expect(
        await EnvironmentVaultService.read(path.join(dir, 'other'), PW)
      ).toMatchObject({ success: false, code: 'INVALID' });

      expect(
        await EnvironmentVaultService.read(vaultPath, 'Wrong-Password-1!')
      ).toMatchObject({ success: false, code: 'AUTH' });

      expect(await EnvironmentVaultService.read(vaultPath, {})).toMatchObject({
        success: false,
        code: 'AUTH',
      });
    });

    it('reports REKEYED for stale key material, and recovers with the password', async () => {
      const { keyMaterial } = await EnvironmentVaultService.read(vaultPath, PW);
      await EnvironmentVaultService.changePassword(vaultPath, PW, NEW_PW);

      expect(
        await EnvironmentVaultService.read(vaultPath, { keyMaterial })
      ).toMatchObject({ success: false, code: 'REKEYED' });

      const recovered = await EnvironmentVaultService.read(vaultPath, {
        keyMaterial,
        password: NEW_PW,
      });
      expect(recovered.success).toBe(true);
      expect(recovered.keyMaterial.header.salt).not.toBe(
        keyMaterial.header.salt
      );
    });
  });

  describe('transact', () => {
    it('applies the mutation, returns its result and the new revision', async () => {
      const before = sha(vaultPath);

      const result = await EnvironmentVaultService.transact(
        vaultPath,
        PW,
        (vault, ctx) => {
          setVar('dev', 'API_KEY', 's3cr3t')(vault);
          return ctx.revision;
        }
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe(before);
      expect(result.revision).toBe(sha(vaultPath));
      expect(result.revision).not.toBe(before);
      const reread = await EnvironmentVaultService.read(vaultPath, PW);
      expect(reread.vault.getActiveVersion('dev').vars.API_KEY).toBe('s3cr3t');
      expect(lockLeft()).toBe(false);
    });

    it('keeps .bak as the previous good state', async () => {
      const before = fs.readFileSync(vaultPath);

      await EnvironmentVaultService.transact(
        vaultPath,
        PW,
        setVar('dev', 'A', '1')
      );

      expect(fs.readFileSync(`${vaultPath}.bak`).equals(before)).toBe(true);
    });

    it('leaves no .bak when it creates the vault', async () => {
      const fresh = path.join(dir, 'fresh.env.vault');

      const result = await EnvironmentVaultService.transact(
        fresh,
        PW,
        setVar('dev', 'A', '1'),
        { create: true }
      );

      expect(result.success).toBe(true);
      expect(fs.existsSync(fresh)).toBe(true);
      expect(fs.existsSync(`${fresh}.bak`)).toBe(false);
    });

    it('refuses with STALE when the file moved past expectedRevision', async () => {
      const { revision } = await EnvironmentVaultService.read(vaultPath, PW);
      await EnvironmentVaultService.transact(
        vaultPath,
        PW,
        setVar('dev', 'A', '1')
      );
      const afterOther = fs.readFileSync(vaultPath);
      const mutate = vi.fn();

      const result = await EnvironmentVaultService.transact(
        vaultPath,
        PW,
        mutate,
        { expectedRevision: revision }
      );

      expect(result).toMatchObject({
        success: false,
        code: 'STALE',
        revision: sha(vaultPath),
      });
      expect(mutate).not.toHaveBeenCalled();
      expect(fs.readFileSync(vaultPath).equals(afterOther)).toBe(true);
      expect(lockLeft()).toBe(false);
    });

    it('writes when expectedRevision still matches', async () => {
      const { revision } = await EnvironmentVaultService.read(vaultPath, PW);

      const result = await EnvironmentVaultService.transact(
        vaultPath,
        PW,
        setVar('dev', 'A', '1'),
        { expectedRevision: revision }
      );

      expect(result.success).toBe(true);
    });

    it('writes nothing when the mutation throws', async () => {
      const before = fs.readFileSync(vaultPath);

      const result = await EnvironmentVaultService.transact(
        vaultPath,
        PW,
        () => {
          throw new Error("Environment 'prod' not found");
        }
      );

      expect(result).toMatchObject({
        success: false,
        code: 'ERROR',
        error: "Environment 'prod' not found",
      });
      expect(fs.readFileSync(vaultPath).equals(before)).toBe(true);
      expect(lockLeft()).toBe(false);
    });

    it('reports BUSY, writing nothing, while another writer holds the lock', async () => {
      const other = new VaultLock(vaultPath);
      await other.acquire();
      const before = fs.readFileSync(vaultPath);

      const result = await EnvironmentVaultService.transact(
        vaultPath,
        PW,
        setVar('dev', 'A', '1'),
        { lockTimeoutMs: 0 }
      );

      expect(result).toMatchObject({ success: false, code: 'BUSY' });
      expect(result.holder.pid).toBe(process.pid);
      expect(fs.readFileSync(vaultPath).equals(before)).toBe(true);
      await other.release();
    });

    it('serializes concurrent writers: neither update is lost', async () => {
      const results = await Promise.all([
        EnvironmentVaultService.transact(
          vaultPath,
          PW,
          setVar('dev', 'A', '1')
        ),
        EnvironmentVaultService.transact(
          vaultPath,
          PW,
          setVar('dev', 'B', '2')
        ),
      ]);

      expect(results.every((r) => r.success)).toBe(true);
      const shown = await EnvironmentVaultService.read(vaultPath, PW);
      expect(shown.vault.getActiveVersion('dev').vars).toEqual({
        A: '1',
        B: '2',
      });
    });

    it('refuses to write after losing its lock', async () => {
      vi.spyOn(VaultLock.prototype, 'lost', 'get').mockReturnValue(true);
      const before = fs.readFileSync(vaultPath);

      const result = await EnvironmentVaultService.transact(
        vaultPath,
        PW,
        setVar('dev', 'A', '1')
      );

      expect(result).toMatchObject({ success: false, code: 'ERROR' });
      expect(result.error).toContain('Lost the vault lock');
      expect(fs.readFileSync(vaultPath).equals(before)).toBe(true);
    });

    it('reports NOT_FOUND for a missing vault unless create is set', async () => {
      const missing = path.join(dir, 'new', 'deeper', '.env.vault');

      expect(
        await EnvironmentVaultService.transact(missing, PW, () => {})
      ).toMatchObject({ success: false, code: 'NOT_FOUND' });

      const created = await EnvironmentVaultService.transact(
        missing,
        PW,
        setVar('dev', 'A', '1'),
        { create: true }
      );
      expect(created.success).toBe(true);
      const read = await EnvironmentVaultService.read(missing, PW);
      expect(read.vault.getActiveVersion('dev').vars).toEqual({ A: '1' });
    });

    it('needs a password to create a vault', async () => {
      const { keyMaterial } = await EnvironmentVaultService.read(vaultPath, PW);
      const missing = path.join(dir, 'fresh.env.vault');

      const result = await EnvironmentVaultService.transact(
        missing,
        { keyMaterial },
        () => {},
        { create: true }
      );

      expect(result).toMatchObject({ success: false, code: 'AUTH' });
      expect(fs.existsSync(missing)).toBe(false);
    });

    it('writes with key material alone, keeping the salt', async () => {
      const { keyMaterial } = await EnvironmentVaultService.read(vaultPath, PW);
      const derive = vi.spyOn(CryptographyService, 'deriveKeyAsync');

      const result = await EnvironmentVaultService.transact(
        vaultPath,
        { keyMaterial },
        setVar('dev', 'A', '1')
      );

      expect(result.success).toBe(true);
      expect(derive).not.toHaveBeenCalled();
      expect(fs.readJSONSync(vaultPath).salt).toBe(keyMaterial.header.salt);
    });

    describe('a legacy-KDF vault (H3)', () => {
      beforeEach(async () => {
        fs.rmSync(vaultPath);
        await asLegacy(() =>
          EnvironmentVaultService.createVault(vaultPath, PW)
        );
      });

      it('is upgraded by a write with the password, and returns the new key', async () => {
        const opened = await EnvironmentVaultService.read(vaultPath, PW);
        expect(
          CryptographyService.needsKdfUpgrade(opened.keyMaterial.header)
        ).toBe(true);

        const first = await EnvironmentVaultService.transact(
          vaultPath,
          { keyMaterial: opened.keyMaterial, password: PW },
          setVar('dev', 'A', '1')
        );

        expect(first.success).toBe(true);
        expect(first.keyMaterial.header.kdf).toEqual(
          CryptographyService.kdfHeader()
        );
        expect(fs.readJSONSync(vaultPath).salt).toBe(
          first.keyMaterial.header.salt
        );
        // The H3 bug: a caller that kept the pre-upgrade key is now stale…
        expect(
          await EnvironmentVaultService.read(vaultPath, {
            keyMaterial: opened.keyMaterial,
          })
        ).toMatchObject({ code: 'REKEYED' });
        // …but the key `transact` returned keeps working, with no password.
        const second = await EnvironmentVaultService.transact(
          vaultPath,
          { keyMaterial: first.keyMaterial },
          setVar('dev', 'B', '2')
        );
        expect(second.success).toBe(true);
        // A re-key leaves no backup that opens with the old key.
        expect(fs.readJSONSync(`${vaultPath}.bak`).salt).not.toBe(
          opened.keyMaterial.header.salt
        );
      });

      it('is written at its old work factor by a key-only caller', async () => {
        const { keyMaterial } = await EnvironmentVaultService.read(
          vaultPath,
          PW
        );

        const result = await EnvironmentVaultService.transact(
          vaultPath,
          { keyMaterial },
          setVar('dev', 'A', '1')
        );

        expect(result.success).toBe(true);
        expect(result.keyMaterial.header).toEqual(keyMaterial.header);
        expect(fs.readJSONSync(vaultPath).kdf).toBeUndefined();
      });
    });
  });

  describe('on Windows, a target briefly held open (New-12)', () => {
    let realPlatform;

    beforeEach(() => {
      realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'win32' });
    });

    afterEach(() => {
      Object.defineProperty(process, 'platform', realPlatform);
    });

    /** Make the first `n` renames fail as if a scanner held the target. */
    const blockRenames = (n) => {
      const realRename = fs.rename.bind(fs);
      let left = n;
      return vi.spyOn(fs, 'rename').mockImplementation(async (...args) => {
        if (left-- > 0) {
          throw Object.assign(new Error('EPERM: operation not permitted'), {
            code: 'EPERM',
          });
        }
        return realRename(...args);
      });
    };

    it('saves after two blocked renames', async () => {
      const move = blockRenames(2);

      const result = await EnvironmentVaultService.transact(
        vaultPath,
        PW,
        setVar('dev', 'A', '1')
      );

      expect(result.success).toBe(true);
      expect(move).toHaveBeenCalledTimes(3);
      const reread = await EnvironmentVaultService.read(vaultPath, PW);
      expect(reread.vault.getActiveVersion('dev').vars).toEqual({ A: '1' });
    });

    it('after three blocked renames, fails with the vault intact and no .tmp left', async () => {
      blockRenames(3);
      const before = fs.readFileSync(vaultPath);

      const result = await EnvironmentVaultService.transact(
        vaultPath,
        PW,
        setVar('dev', 'A', '1')
      );

      expect(result).toMatchObject({ success: false, code: 'ERROR' });
      expect(result.error).toContain('EPERM');
      expect(fs.readFileSync(vaultPath).equals(before)).toBe(true);
      expect(fs.existsSync(`${vaultPath}.tmp`)).toBe(false);
      expect(lockLeft()).toBe(false);
    });
  });

  describe('revisionOf', () => {
    it('is the sha256 of the bytes', () => {
      expect(EnvironmentVaultService.revisionOf(Buffer.from('abc'))).toBe(
        'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
      );
    });
  });
});
