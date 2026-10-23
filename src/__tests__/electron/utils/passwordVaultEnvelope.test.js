// @vitest-environment node
// Password vault format 2 (PASSWORD-VAULT-2FA-RFC.md, New-54): the key
// file, the data key's two slots, and the payload.
import { describe, it, expect } from 'vitest';

import {
  FORMAT_2,
  KEY_FILE_FEATURE,
  KEY_FILE_TYPE,
  PasswordEnvelopeError,
  checkKeyFile,
  createKeyFile,
  isFormat2,
  keyFileIdOf,
  mainKekOf,
  newDataKey,
  newHeader,
  openPayload,
  parseKeyFile,
  recoveryKekOf,
  sealPayload,
  slotCheckOf,
  unwrapSlot,
  wrapSlot,
} from '../../../electron/utils/passwordVaultEnvelope.js';
import { CryptographyService } from '../../../electron/services/CryptographyService.js';

const PASSWORD_KEY = Buffer.alloc(32, 0x11);
const KEY_FILE_KEY = Buffer.alloc(32, 0x22);
const SALT = '33'.repeat(32);
const KDF = { name: 'pbkdf2-sha512', iterations: 600000 };
const RECOVERY_KEK = Buffer.alloc(32, 0x44);
const DEK = Buffer.alloc(32, 0x55);

/**
 * Sealed once with the keys above (and DEK), then frozen: a build that
 * can't open it has changed the format.
 */
const FIXTURE = {
  version: 2,
  features: ['keyfile'],
  salt: SALT,
  kdf: KDF,
  keyFile: { id: '9f72ea0cf49536e3' },
  slots: {
    main: {
      check: 'aa8e0d7192c951a01bcadd88c7bc3b8f',
      iv: '03c780dd04a81d461a95c005',
      authTag: '6b5aa4f12bd5837d95476a33328943a5',
      wrapped:
        '491c126a9eb85edb54f7de77688fbeaf8d4135b224e4e34643e82b94816bd45f',
    },
    recovery: {
      salt: '66'.repeat(32),
      kdf: KDF,
      check: 'b03627bfc8d3424f1367fe9c35878e1b',
      iv: '7df8260142ae57f03f69382c',
      authTag: '7f56787e6b9db746110b02b59fd49020',
      wrapped:
        'bb1c7db2c62b237cae38cc48ef7d91d3391b5aa01e3be096b4f308010054cafe',
    },
  },
  encrypted:
    '77d69ac8e36f258ce01bdabe6b48b0a987e8a4a92cc79f91d69069dbfbe06e7d2b',
  authTag: '64f597d4dd83447dd1c6664229c26975',
  iv: 'be53c9556059806515157b17bdff713c',
};

const MAIN_KEK = mainKekOf(PASSWORD_KEY, KEY_FILE_KEY, SALT);

/** Expect `fn` to throw a PasswordEnvelopeError with `code`. */
const throwsCode = (fn, code) => {
  let error;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(PasswordEnvelopeError);
  expect(error.code).toBe(code);
  return error;
};

const fresh = (payload = { entries: [] }) => {
  const dek = newDataKey();
  let file = newHeader({
    salt: SALT,
    kdf: KDF,
    keyFileId: keyFileIdOf(KEY_FILE_KEY),
    recovery: { salt: '66'.repeat(32), kdf: KDF },
  });
  file = wrapSlot(file, 'main', dek, MAIN_KEK);
  file = wrapSlot(file, 'recovery', dek, RECOVERY_KEK);
  return { dek, file: sealPayload(file, payload, dek) };
};

describe('pinned derivations', () => {
  it('derives the main key, its check and the key file id as written', () => {
    expect(MAIN_KEK.toString('hex')).toBe(
      '050e79037b78aff8116c27b9acb6f52988308d5d30f8577487b12eaa67d044d3'
    );
    expect(slotCheckOf(MAIN_KEK)).toBe('aa8e0d7192c951a01bcadd88c7bc3b8f');
    expect(keyFileIdOf(KEY_FILE_KEY)).toBe('9f72ea0cf49536e3');
  });

  it('opens the frozen fixture through either slot', () => {
    checkKeyFile(FIXTURE, KEY_FILE_KEY);
    const viaMain = unwrapSlot(FIXTURE, 'main', MAIN_KEK);
    const viaRecovery = unwrapSlot(FIXTURE, 'recovery', RECOVERY_KEK);
    expect(viaMain.equals(DEK)).toBe(true);
    expect(viaRecovery.equals(DEK)).toBe(true);
    expect(openPayload(FIXTURE, viaMain)).toEqual({
      entries: [{ title: 'fixture' }],
    });
  });

  it('keys the main slot on the password and the key file both', () => {
    const otherFile = mainKekOf(PASSWORD_KEY, Buffer.alloc(32, 0x23), SALT);
    const otherPassword = mainKekOf(Buffer.alloc(32, 0x12), KEY_FILE_KEY, SALT);
    const otherSalt = mainKekOf(PASSWORD_KEY, KEY_FILE_KEY, '34'.repeat(32));
    for (const kek of [otherFile, otherPassword, otherSalt]) {
      expect(kek.equals(MAIN_KEK)).toBe(false);
    }
  });
});

describe('a format-2 file', () => {
  it('has the header the RFC describes', () => {
    const { file } = fresh();
    expect(file).toMatchObject({
      version: FORMAT_2,
      features: [KEY_FILE_FEATURE],
      salt: SALT,
      kdf: KDF,
      keyFile: { id: '9f72ea0cf49536e3' },
      slots: { recovery: { salt: '66'.repeat(32), kdf: KDF } },
    });
    expect(Object.keys(file.slots.main).sort()).toEqual([
      'authTag',
      'check',
      'iv',
      'wrapped',
    ]);
    expect(isFormat2(file)).toBe(true);
    expect(isFormat2({ version: 1 })).toBe(false);
    expect(isFormat2({})).toBe(false);
  });

  it('round-trips a payload, with a fresh IV on every seal', () => {
    const { dek, file } = fresh({ entries: [{ title: 'a' }] });
    expect(openPayload(file, unwrapSlot(file, 'main', MAIN_KEK))).toEqual({
      entries: [{ title: 'a' }],
    });
    const again = sealPayload(file, { entries: [] }, dek);
    expect(again.iv).not.toBe(file.iv);
    expect(again.slots).toEqual(file.slots);
    expect(openPayload(again, dek)).toEqual({ entries: [] });
  });

  it('re-wraps one slot without the other slot’s key', () => {
    const { dek, file } = fresh();
    // A new password: a new salt, so a new main key; recovery untouched.
    const salt = '77'.repeat(32);
    const kek = mainKekOf(Buffer.alloc(32, 0x99), KEY_FILE_KEY, salt);
    let changed = wrapSlot({ ...file, salt }, 'main', dek, kek);
    changed = sealPayload(changed, openPayload(file, dek), dek);
    expect(unwrapSlot(changed, 'main', kek).equals(dek)).toBe(true);
    expect(unwrapSlot(changed, 'recovery', RECOVERY_KEK).equals(dek)).toBe(
      true
    );
    expect(openPayload(changed, dek)).toEqual({ entries: [] });

    // A new recovery key: new recovery settings; main untouched.
    const slots = {
      ...changed.slots,
      recovery: { salt: '88'.repeat(32), kdf: KDF },
    };
    const newRecovery = Buffer.alloc(32, 0x45);
    let rekeyed = wrapSlot({ ...changed, slots }, 'recovery', dek, newRecovery);
    rekeyed = sealPayload(rekeyed, {}, dek);
    expect(unwrapSlot(rekeyed, 'main', kek).equals(dek)).toBe(true);
    expect(unwrapSlot(rekeyed, 'recovery', newRecovery).equals(dek)).toBe(true);
    throwsCode(() => unwrapSlot(rekeyed, 'recovery', RECOVERY_KEK), 'AUTH');
  });
});

describe('refusals', () => {
  it('reports a wrong password, recovery key or key file by name', () => {
    const { file } = fresh();
    const wrongPassword = mainKekOf(Buffer.alloc(32, 1), KEY_FILE_KEY, SALT);
    expect(
      throwsCode(() => unwrapSlot(file, 'main', wrongPassword), 'AUTH').message
    ).toBe('Invalid master password');
    expect(
      throwsCode(
        () => unwrapSlot(file, 'recovery', Buffer.alloc(32, 2)),
        'AUTH'
      ).message
    ).toBe('Invalid recovery key');
    throwsCode(() => checkKeyFile(file, Buffer.alloc(32, 3)), 'KEY_FILE');
    expect(() => checkKeyFile(file, KEY_FILE_KEY)).not.toThrow();
  });

  // Each edit against the slot whose tag covers it, with that slot's key.
  it.each([
    ['features', 'main', (f) => ({ ...f, features: [] })],
    ['version', 'recovery', (f) => ({ ...f, version: 3 })],
    [
      'the key file id',
      'main',
      (f) => ({ ...f, keyFile: { id: 'ffffffffffffffff' } }),
    ],
    ['the kdf', 'main', (f) => ({ ...f, kdf: { ...KDF, iterations: 1000 } })],
    [
      'the recovery kdf',
      'recovery',
      (f) => ({
        ...f,
        slots: {
          ...f.slots,
          recovery: { ...f.slots.recovery, kdf: { ...KDF, iterations: 1 } },
        },
      }),
    ],
  ])(
    'says a changed header (%s) is tampered, not a wrong key',
    (_, slot, edit) => {
      const { dek, file } = fresh();
      const edited = edit(file);
      const kek = slot === 'main' ? MAIN_KEK : RECOVERY_KEK;
      throwsCode(() => unwrapSlot(edited, slot, kek), 'TAMPERED');
      throwsCode(() => openPayload(edited, dek), 'TAMPERED');
    }
  );

  it('refuses a payload whose header changed, even with the right data key', () => {
    const { dek, file } = fresh();
    const edited = {
      ...file,
      slots: {
        ...file.slots,
        recovery: { ...file.slots.recovery, salt: '99'.repeat(32) },
      },
    };
    // The main slot doesn't cover recovery's settings; the payload does.
    expect(unwrapSlot(edited, 'main', MAIN_KEK).equals(dek)).toBe(true);
    throwsCode(() => openPayload(edited, dek), 'TAMPERED');
  });

  it('refuses slots swapped between main and recovery', () => {
    const { file } = fresh();
    const swapped = {
      ...file,
      slots: {
        main: { ...file.slots.recovery, salt: undefined, kdf: undefined },
        recovery: {
          ...file.slots.main,
          salt: file.slots.recovery.salt,
          kdf: KDF,
        },
      },
    };
    throwsCode(() => unwrapSlot(swapped, 'main', RECOVERY_KEK), 'TAMPERED');
    throwsCode(() => unwrapSlot(swapped, 'recovery', MAIN_KEK), 'TAMPERED');
  });

  it('refuses a missing or truncated slot', () => {
    const { file } = fresh();
    throwsCode(
      () =>
        unwrapSlot(
          { ...file, slots: { ...file.slots, main: {} } },
          'main',
          MAIN_KEK
        ),
      'TAMPERED'
    );
    throwsCode(
      () => unwrapSlot({ ...file, slots: undefined }, 'main', MAIN_KEK),
      'TAMPERED'
    );
    const short = wrapSlot(file, 'main', Buffer.alloc(16, 1), MAIN_KEK);
    throwsCode(() => unwrapSlot(short, 'main', MAIN_KEK), 'TAMPERED');
  });

  it('refuses a payload opened with another data key', () => {
    const { file } = fresh();
    throwsCode(() => openPayload(file, Buffer.alloc(32, 9)), 'TAMPERED');
  });
});

describe('key files', () => {
  it('creates a key file that parses back to its key', () => {
    const created = createKeyFile();
    expect(created).toMatchObject({ type: KEY_FILE_TYPE, version: 1 });
    const key = parseKeyFile(JSON.stringify(created));
    expect(key).toHaveLength(32);
    expect(parseKeyFile(Buffer.from(JSON.stringify(created))).equals(key)).toBe(
      true
    );
    expect(createKeyFile().key).not.toBe(created.key);
  });

  it.each([
    ['not JSON', 'hello'],
    ['another type', JSON.stringify({ type: 'x', version: 1, key: 'AAAA' })],
    [
      'another version',
      JSON.stringify({
        type: KEY_FILE_TYPE,
        version: 2,
        key: Buffer.alloc(32).toString('base64'),
      }),
    ],
    [
      'a short key',
      JSON.stringify({ type: KEY_FILE_TYPE, version: 1, key: 'AAAA' }),
    ],
    ['no key', JSON.stringify({ type: KEY_FILE_TYPE, version: 1 })],
    ['null', 'null'],
  ])('refuses %s', (_, text) => {
    expect(
      throwsCode(() => parseKeyFile(text), 'INVALID_KEY_FILE').message
    ).toBe("This isn't a SecureVault key file.");
  });
});

describe('the recovery slot key', () => {
  it('is PBKDF2 of the recovery key, typed with or without dashes', async () => {
    const slot = {
      salt: '66'.repeat(32),
      kdf: { name: 'pbkdf2-sha512', iterations: 2000 },
    };
    const a = await recoveryKekOf('abcd-efgh-ijkl', slot);
    const b = await recoveryKekOf('ABCDEFGHIJKL', slot);
    expect(a.equals(b)).toBe(true);
    expect(
      a.equals(
        CryptographyService.deriveKey(
          'ABCDEFGHIJKL',
          Buffer.from(slot.salt, 'hex'),
          2000
        )
      )
    ).toBe(true);
  });
});
