// A vault that uses a key file, the key file lost, and the recovery key it
// was created with (test data only).
import fs from 'fs';
import path from 'path';
import { VaultService } from '../../src/electron/services/VaultService.js';

console.log = () => {};
const vs = new VaultService(process.env.E2E_VAULTS_DIR);
const created = await vs.createVault('locked-out', 'Forgotten-Pass-3#');
if (!created.success) throw new Error(created.error);
await vs.saveVault('locked-out', 'Forgotten-Pass-3#', {
  entries: {
    e1: { id: 'e1', title: 'Example Bank', entryType: 'password' },
  },
});
const lostKey = Buffer.alloc(32, 4); // never written anywhere: it's lost
const on = await vs.enableKeyFile('locked-out', 'Forgotten-Pass-3#', lostKey);
if (!on.success) throw new Error(on.error);
fs.writeFileSync(
  path.join(process.env.E2E_OUT, 'recovery-key.txt'),
  created.recoveryKey.data.key
);
