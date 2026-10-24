import { VaultService } from '../../src/electron/services/VaultService.js';

console.log = () => {};
const created = await new VaultService(process.env.E2E_VAULTS_DIR).createVault(
  'team',
  'Team-Pass-6&'
);
if (!created.success) throw new Error(created.error);
