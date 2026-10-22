// A password vault and an earlier run that set a 1-minute idle time (Task 13).
import fs from 'fs';
import path from 'path';
import { VaultService } from '../../src/electron/services/VaultService.js';

console.log = () => {};
const vs = new VaultService(process.env.E2E_VAULTS_DIR);
const created = await vs.createVault('personal', 'Idle-Pass-6^');
if (!created.success) throw new Error(created.error);
fs.writeFileSync(
  path.join(path.dirname(process.env.E2E_VAULTS_DIR), 'app-settings.json'),
  JSON.stringify({
    format: 1,
    settings: { idleMinutes: 1, rememberRecents: true },
  }),
  { mode: 0o600 }
);
