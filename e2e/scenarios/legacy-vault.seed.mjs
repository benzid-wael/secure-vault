// A vault as a pre-600k install left it: 100k iterations, no `kdf` header,
// and previous-password metadata from a password change.
import { CryptographyService } from '../../src/electron/services/CryptographyService.js';
import { VaultService } from '../../src/electron/services/VaultService.js';

CryptographyService.ITERATIONS = CryptographyService.LEGACY_ITERATIONS;
CryptographyService.kdfHeader = () => undefined;
console.log = () => {};

const vs = new VaultService(process.env.E2E_VAULTS_DIR);
await vs.createVault('legacy', 'First-Pass-1!');
await vs.saveVault('legacy', 'First-Pass-1!', {
  entries: {
    e1: {
      id: 'e1',
      title: 'Example Mail',
      username: 'someone@example.com',
      password: 'not-a-real-secret',
      entryType: 'password',
      category: 'email',
    },
  },
});
const changed = await vs.changePassword(
  'legacy',
  'First-Pass-1!',
  'Second-Pass-2@'
);
if (!changed.success) throw new Error(changed.error);
