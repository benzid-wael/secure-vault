import path from 'path';
import { EnvironmentVaultService } from '../../src/electron/services/EnvironmentVaultService.js';
import { EnvironmentVault } from '../../src/electron/models/EnvironmentVault.js';

console.log = () => {};
const envsDir = path.join(path.dirname(process.env.E2E_VAULTS_DIR), 'envs');
const vault = new EnvironmentVault();
vault.addEnvironment('prod');
vault.addVersion('prod', { API_KEY: 'sk-seeded', DB_URL: 'postgres://seed' });
const created = await EnvironmentVaultService.createVault(
  path.join(envsDir, 'app.env.vault'),
  'Env-Pass-7&',
  vault.toJSON()
);
if (!created.success) throw new Error(created.error);
