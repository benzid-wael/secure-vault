import path from 'path';
import { EnvironmentVaultService } from '../../src/electron/services/EnvironmentVaultService.js';
import { EnvironmentVault } from '../../src/electron/models/EnvironmentVault.js';

console.log = () => {};
const envsDir = path.join(path.dirname(process.env.E2E_VAULTS_DIR), 'envs');
const vault = new EnvironmentVault();
vault.addEnvironment('base');
vault.addVersion(
  'base',
  { LOG_LEVEL: 'debug' },
  { nonSensitive: ['LOG_LEVEL'] }
);
vault.addEnvironment('prod');
vault.addVersion('prod', { API_KEY: 'sk-seeded-secret-123' });
vault.setExtends('prod', 'base');
const created = await EnvironmentVaultService.createVault(
  path.join(envsDir, 'app.env.vault'),
  'Env-Pass-7&',
  vault.toJSON()
);
if (!created.success) throw new Error(created.error);
