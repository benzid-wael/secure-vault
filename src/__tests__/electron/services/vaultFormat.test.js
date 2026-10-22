// @vitest-environment node
// Vault format check (GUI-ENV-BREAKDOWN New-29): a vault written by a newer
// SecureVault is read, but never overwritten by a build that would drop
// what it doesn't understand. Both vault kinds.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import {
  checkVaultFormat,
  envVaultFeatures,
  newerFormatError,
  UPGRADE_HINT,
  VAULT_FORMATS,
} from '../../../electron/utils/vaultFormat.js';
import { EnvironmentVaultService } from '../../../electron/services/EnvironmentVaultService.js';
import { EnvironmentVault } from '../../../electron/models/EnvironmentVault.js';
import { VaultService } from '../../../electron/services/VaultService.js';

const PW = 'Format-Pass-7&x';

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-format-'));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Rewrite a vault file's plaintext envelope, as a newer build would. */
const patchEnvelope = async (file, fields) =>
  fs.writeJSON(file, { ...(await fs.readJSON(file)), ...fields });

describe('checkVaultFormat', () => {
  it('accepts a vault with no marker (every vault written so far)', () => {
    expect(checkVaultFormat({}, 'env')).toEqual({
      readable: true,
      writable: true,
      version: 1,
      features: [],
      unknown: [],
    });
    expect(checkVaultFormat({ version: 1 }, 'password').writable).toBe(true);
  });

  it('accepts features it knows', () => {
    const check = checkVaultFormat({ features: ['comments'] }, 'env');
    expect(check).toMatchObject({ writable: true, unknown: [] });
  });

  it('reads but refuses writes with a feature it does not know', () => {
    const check = checkVaultFormat(
      { features: ['comments', 'expiry', 42] },
      'env',
      '/p/app.env.vault'
    );
    expect(check).toMatchObject({
      readable: true,
      writable: false,
      features: ['comments', 'expiry'],
      unknown: ['expiry'],
    });
    expect(check.message).toBe(
      "app.env.vault uses features this version of SecureVault doesn't " +
        'support (expiry). You can read it, but changes are refused: saving ' +
        `here would drop that data. ${UPGRADE_HINT}`
    );
  });

  it('refuses even reading a newer format version', () => {
    const check = checkVaultFormat({ version: 2 }, 'password', 'work');
    expect(check).toMatchObject({ readable: false, writable: false });
    expect(check.message).toMatch(
      /^work uses vault format 2; this version of SecureVault reads format 1 only/
    );
    expect(check.message).toContain('npm install -g');
  });

  it('knows comments for env vaults only', () => {
    expect(
      checkVaultFormat({ features: ['comments'] }, 'password')
    ).toMatchObject({ writable: false, unknown: ['comments'] });
    expect(Object.keys(VAULT_FORMATS.env.features)).toEqual(['comments']);
  });

  it('turns a check into an error callers can recognise', () => {
    const error = newerFormatError({ message: 'm' });
    expect(error.message).toBe('m');
    expect(/** @type {any} */ (error).code).toBe('NEWER_FORMAT');
  });
});

describe('envVaultFeatures', () => {
  it('marks comments only when a version has one', () => {
    const vault = new EnvironmentVault();
    vault.addEnvironment('dev');
    vault.addVersion('dev', { A: '1' });
    expect(envVaultFeatures(vault.toJSON())).toEqual([]);
    vault.addVersion('dev', { A: '2' }, { comments: { A: 'note' } });
    expect(envVaultFeatures(vault.toJSON())).toEqual(['comments']);
    expect(envVaultFeatures({})).toEqual([]);
  });
});

describe('env vaults', () => {
  let file;
  beforeEach(async () => {
    file = path.join(dir, 'app.env.vault');
    expect((await EnvironmentVaultService.createVault(file, PW)).success).toBe(
      true
    );
    await EnvironmentVaultService.setEnv(file, PW, 'dev', 'A', '1');
  });

  it('writes the marker only while a comment exists', async () => {
    expect((await fs.readJSON(file)).features).toBeUndefined();
    await EnvironmentVaultService.setEnv(file, PW, 'dev', 'A', '1', {
      comment: 'why',
    });
    expect((await fs.readJSON(file)).features).toEqual(['comments']);
    // Squashed down to a version without comments: the marker goes too.
    await EnvironmentVaultService.setEnv(file, PW, 'dev', 'A', '1', {
      comment: '',
    });
    await EnvironmentVaultService.squashEnv(file, PW, 'dev', 1);
    expect((await fs.readJSON(file)).features).toBeUndefined();
  });

  it('marks a vault created with comments', async () => {
    const vault = new EnvironmentVault();
    vault.addEnvironment('dev');
    vault.addVersion('dev', { A: '1' }, { comments: { A: 'c' } });
    const other = path.join(dir, 'other.env.vault');
    await EnvironmentVaultService.createVault(other, PW, vault.toJSON());
    expect((await fs.readJSON(other)).features).toEqual(['comments']);
  });

  it('reads a vault with an unknown feature and says it is read-only', async () => {
    await patchEnvelope(file, { features: ['expiry'] });
    const read = await EnvironmentVaultService.read(file, PW);
    expect(read.success).toBe(true);
    expect(read.format).toMatchObject({ writable: false, unknown: ['expiry'] });
    const loaded = await EnvironmentVaultService.loadVault(file, PW);
    expect(loaded.success).toBe(true);
    expect(loaded.format.writable).toBe(false);
  });

  it('refuses every write to it and leaves the file as it was', async () => {
    await patchEnvelope(file, { features: ['expiry'] });
    const before = await fs.readFile(file);
    const set = await EnvironmentVaultService.setEnv(file, PW, 'dev', 'B', '2');
    expect(set).toMatchObject({ success: false, code: 'NEWER_FORMAT' });
    expect(set.error).toMatch(/doesn't support \(expiry\)/);
    const rekey = await EnvironmentVaultService.changePassword(
      file,
      PW,
      'Another-Pass-9!'
    );
    expect(rekey.code).toBe('NEWER_FORMAT');
    expect(await fs.readFile(file)).toEqual(before);
  });

  it('does not read a newer format version', async () => {
    await patchEnvelope(file, { version: 2 });
    const read = await EnvironmentVaultService.read(file, PW);
    expect(read).toMatchObject({ success: false, code: 'NEWER_FORMAT' });
    const loaded = await EnvironmentVaultService.loadVault(file, PW);
    expect(loaded).toMatchObject({ success: false, code: 'NEWER_FORMAT' });
  });
});

describe('password vaults', () => {
  let vs;
  let file;
  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vs = new VaultService(dir);
    expect((await vs.createVault('work', PW)).success).toBe(true);
    file = path.join(dir, 'work.vault');
  });

  it('opens and saves a vault without a marker as before', async () => {
    const loaded = await vs.loadVault('work', PW);
    expect(loaded.success).toBe(true);
    expect(loaded.readOnly).toBeUndefined();
    expect((await vs.saveVault('work', PW, loaded.data)).success).toBe(true);
  });

  it('opens a vault with an unknown feature read-only and refuses writes', async () => {
    await patchEnvelope(file, { features: ['attachments'] });
    const before = await fs.readFile(file);

    expect(await vs.verifyPassword('work', PW)).toMatchObject({
      success: true,
      readOnly: true,
    });
    const loaded = await vs.loadVault('work', PW);
    expect(loaded).toMatchObject({ success: true, readOnly: true });
    expect(loaded.formatMessage).toMatch(
      /^work uses features .*\(attachments\)/
    );

    const saved = await vs.saveVault('work', PW, loaded.data);
    expect(saved).toMatchObject({ success: false, code: 'NEWER_FORMAT' });
    expect((await vs.changePassword('work', PW, 'Another-Pass-9!')).code).toBe(
      'NEWER_FORMAT'
    );
    expect((await vs.generateRecoveryKey('work', PW)).code).toBe(
      'NEWER_FORMAT'
    );
    expect(await fs.readFile(file)).toEqual(before);
  });

  it('does not open a newer format version, and says why', async () => {
    await patchEnvelope(file, { version: 2 });
    const verified = await vs.verifyPassword('work', PW);
    expect(verified).toMatchObject({ success: false, code: 'NEWER_FORMAT' });
    expect(verified.error).toMatch(/format 2/);
    expect((await vs.loadVault('work', PW)).code).toBe('NEWER_FORMAT');
  });

  it('still overwrites a file it cannot parse, as before', async () => {
    await fs.writeFile(file, 'not json');
    await expect(
      vs.fileService.atomicWriteVaultFile('work', { x: 1 })
    ).resolves.toBeUndefined();
  });
});
