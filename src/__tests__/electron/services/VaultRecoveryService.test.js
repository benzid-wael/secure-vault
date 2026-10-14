// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { VaultService } from '../../../electron/services/VaultService.js';
import { VaultRecoveryService } from '../../../electron/services/VaultRecoveryService.js';

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

  it('createDefaultVault does not print the recovery key', async () => {
    const vs = new VaultService(dir);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await vs.createDefaultVault();
    expect(result.success).toBe(true);
    const logged = logSpy.mock.calls.flat().map(String).join('\n');
    expect(logged).not.toContain(result.recoveryKey);
  });
});
