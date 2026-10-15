import { VaultService } from '../../src/electron/services/VaultService.js';

console.log = () => {};
const vs = new VaultService(process.env.E2E_VAULTS_DIR);
const created = await vs.createVault('personal', 'Old-Pass-4$');
if (!created.success) throw new Error(created.error);
