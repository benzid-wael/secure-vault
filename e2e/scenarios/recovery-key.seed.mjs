// A vault plus the recovery key it was created with (test data only).
import fs from 'fs';
import path from 'path';
import { VaultService } from '../../src/electron/services/VaultService.js';

console.log = () => {};
const vs = new VaultService(process.env.E2E_VAULTS_DIR);
const created = await vs.createVault('locked-out', 'Forgotten-Pass-3#');
if (!created.success) throw new Error(created.error);
await vs.saveVault('locked-out', 'Forgotten-Pass-3#', {
  entries: {
    e1: {
      id: 'e1',
      title: 'Example Bank',
      entryType: 'password',
      category: 'finance',
    },
  },
});
fs.writeFileSync(
  path.join(process.env.E2E_OUT, 'recovery-key.txt'),
  created.recoveryKey.data.key
);
