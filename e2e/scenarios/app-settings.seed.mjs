// An earlier run of the app: it saved a 30-minute idle time and remembered a
// project's env vault (Task 23, Task 14).
import fs from 'fs';
import path from 'path';
import { EnvironmentVaultService } from '../../src/electron/services/EnvironmentVaultService.js';

console.log = () => {};
const appData = path.dirname(process.env.E2E_VAULTS_DIR);
const project = path.join(process.env.E2E_OUT, 'shop', '.env.vault');
const created = await EnvironmentVaultService.createVault(
  project,
  'Env-Pass-7&'
);
if (!created.success) throw new Error(created.error);
fs.writeFileSync(
  path.join(appData, 'app-settings.json'),
  JSON.stringify({
    format: 1,
    settings: { idleMinutes: 30, rememberRecents: true },
  }),
  { mode: 0o600 }
);
fs.writeFileSync(
  path.join(appData, 'gui-env-recents.json'),
  JSON.stringify([{ path: project, lastOpened: new Date().toISOString() }]),
  { mode: 0o600 }
);
