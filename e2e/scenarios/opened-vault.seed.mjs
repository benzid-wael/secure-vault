import path from 'path';
import { VaultService } from '../../src/electron/services/VaultService.js';
import { EnvironmentVaultService } from '../../src/electron/services/EnvironmentVaultService.js';

console.log = () => {};
// A password vault in a folder the app doesn't own, and an env vault the
// open dialog must refuse.
const shared = path.join(process.env.E2E_OUT, 'shared');
const created = await new VaultService(shared).createVault(
  'team',
  'Team-Pass-6&'
);
if (!created.success) throw new Error(created.error);
const env = await EnvironmentVaultService.createVault(
  path.join(shared, '.env.vault'),
  'Team-Pass-6&'
);
if (!env.success) throw new Error(env.error);
