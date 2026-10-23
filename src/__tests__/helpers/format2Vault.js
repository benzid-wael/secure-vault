// Test-only: a password vault in format 2 (New-54), built with the
// envelope's functions, until the app can turn a key file on (step 3).
import { Vault } from '../../electron/models/Vault.js';
import { CryptographyService } from '../../electron/services/CryptographyService.js';
import {
  keyFileIdOf,
  mainKekOf,
  newDataKey,
  newHeader,
  recoveryKekOf,
  sealPayload,
  wrapSlot,
} from '../../electron/utils/passwordVaultEnvelope.js';

export const RECOVERY_KEY = 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX';

/**
 * Write vault `name` in format 2 through `vaultService`'s file service.
 * @returns {Promise<{keyFileKey: Buffer, recoveryKey: string, dek: Buffer}>}
 */
export async function writeFormat2Vault(
  vaultService,
  name,
  {
    password,
    keyFileKey = Buffer.alloc(32, 7),
    recoveryKey = RECOVERY_KEY,
    entries = {},
  }
) {
  // `name` isn't in Vault's inferred constructor type.
  const vault = new Vault(/** @type {any} */ ({ name, entries }));
  const salt = CryptographyService.generateSalt().toString('hex');
  const kdf = CryptographyService.kdfHeader();
  const recovery = {
    salt: CryptographyService.generateSalt().toString('hex'),
    kdf,
  };
  const dek = newDataKey();
  const passwordKey = CryptographyService.deriveKey(
    password,
    Buffer.from(salt, 'hex'),
    kdf.iterations
  );
  let file = newHeader({
    salt,
    kdf,
    keyFileId: keyFileIdOf(keyFileKey),
    recovery,
  });
  file = wrapSlot(file, 'main', dek, mainKekOf(passwordKey, keyFileKey, salt));
  file = wrapSlot(
    file,
    'recovery',
    dek,
    await recoveryKekOf(recoveryKey, recovery)
  );
  file = sealPayload(file, vault.toJSON(), dek);
  await vaultService.fileService.writeVaultFile(name, file);
  return { keyFileKey, recoveryKey, dek: Buffer.from(dek) };
}
