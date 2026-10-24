// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { VaultService } from '../../../electron/services/VaultService.js';
import { VaultRecoveryService } from '../../../electron/services/VaultRecoveryService.js';
import { RECOVERY_KEY, writeFormat2Vault } from '../../helpers/format2Vault.js';

const PASSWORD = 'Correct-Horse-9!';

describe('VaultRecoveryService.recover', () => {
  let dir;
  let logSpy;
  let errSpy;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-recover-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const created = await new VaultService(dir).createVault('main', PASSWORD);
    expect(created.success).toBe(true);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes a recovered copy that opens with the master password', async () => {
    const ok = await new VaultRecoveryService(dir).recover('main', PASSWORD);
    expect(ok).toBe(true);

    const recovered = path.join(dir, 'main-recovered.vault');
    expect(fs.pathExistsSync(recovered)).toBe(true);
    const check = await new VaultService(dir).verifyPassword(
      'main',
      PASSWORD,
      recovered
    );
    expect(check.success).toBe(true);
  });

  it('never overwrites an earlier recovered copy', async () => {
    const svc = new VaultRecoveryService(dir);
    expect(await svc.recover('main', PASSWORD)).toBe(true);
    expect(await svc.recover('main', PASSWORD)).toBe(true);
    expect(fs.pathExistsSync(path.join(dir, 'main-recovered.vault'))).toBe(
      true
    );
    expect(fs.pathExistsSync(path.join(dir, 'main-recovered-1.vault'))).toBe(
      true
    );
  });

  it('returns false for a missing vault', async () => {
    const ok = await new VaultRecoveryService(dir).recover('nope', PASSWORD);
    expect(ok).toBe(false);
  });

  it('returns false for a wrong password', async () => {
    const ok = await new VaultRecoveryService(dir).recover('main', 'wrong');
    expect(ok).toBe(false);
  });

  it('does not log vault file contents or recovery metadata', async () => {
    const vaultFile = fs.readJSONSync(path.join(dir, 'main.vault'));
    await new VaultRecoveryService(dir).recover('main', PASSWORD);
    const logged = [...logSpy.mock.calls, ...errSpy.mock.calls]
      .flat()
      .map(String)
      .join('\n');
    expect(logged).not.toContain(vaultFile.encrypted);
    expect(logged).not.toContain(vaultFile.salt);
  });
});

describe('VaultService logging', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-log-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('loadVault does not log the vault file', async () => {
    const vs = new VaultService(dir);
    await vs.createVault('main', PASSWORD);
    const vaultFile = fs.readJSONSync(path.join(dir, 'main.vault'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await vs.loadVault('main', PASSWORD);
    const logged = logSpy.mock.calls.flat().map(String).join('\n');
    expect(logged).not.toContain(vaultFile.encrypted);
  });
});

// New-54 step 5: the CLI's `recover` for a vault that uses a key file.
describe('VaultRecoveryService.recoverWithRecoveryKey', () => {
  const NEW_PW = 'Fresh-Pass-34!';
  let dir;
  let vs;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-recover-kf-'));
    vs = new VaultService(dir);
    await writeFormat2Vault(vs, 'main', {
      password: PASSWORD,
      entries: { e1: { id: 'e1', title: 'Mail', password: 'secret' } },
    });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('writes a copy that opens with the new password alone, leaving the vault', async () => {
    const original = fs.readFileSync(path.join(dir, 'main.vault'), 'utf8');
    const svc = new VaultRecoveryService(dir);
    const result = await svc.recoverWithRecoveryKey(
      'main',
      RECOVERY_KEY,
      NEW_PW
    );
    expect(result).toEqual({
      success: true,
      fileName: 'main-recovered.vault',
      recoveryKey: expect.any(String),
    });
    expect(fs.readFileSync(path.join(dir, 'main.vault'), 'utf8')).toBe(
      original
    );
    const loaded = await vs.loadVault('main-recovered', NEW_PW);
    expect(loaded.data.entries.e1.title).toBe('Mail');
    expect(
      (await vs.loadVaultWithRecoveryKey('main-recovered', result.recoveryKey))
        .success
    ).toBe(true);
    expect(
      (await svc.recoverWithRecoveryKey('main', RECOVERY_KEY, NEW_PW)).fileName
    ).toBe('main-recovered-1.vault');
  });

  it.each([
    ['a wrong recovery key', 'main', 'WXYZ-WXYZ-WXYZ', NEW_PW, 'AUTH'],
    ['a weak password', 'main', RECOVERY_KEY, 'short', 'INVALID'],
    ['a missing vault', 'ghost', RECOVERY_KEY, NEW_PW, 'NOT_FOUND'],
  ])('refuses %s, leaving no copy', async (_, name, key, pw, code) => {
    const before = fs.readdirSync(dir).sort();
    expect(
      await new VaultRecoveryService(dir).recoverWithRecoveryKey(name, key, pw)
    ).toMatchObject({ success: false, code });
    expect(fs.readdirSync(dir).sort()).toEqual(before);
  });
});
