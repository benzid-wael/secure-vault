import path from 'path';
import os from 'os';

/**
 * Single source of truth for where SecureVault stores its data on disk.
 *
 * Both the desktop app (Electron main process) and the `vault` CLI must
 * resolve to the *same* directory so that vaults created in one are visible
 * in the other. We deliberately do NOT derive this from Electron's
 * `app.getPath('userData')` (which is based on the packaged productName
 * "Secure Password Manager") nor from package.json `name` — those diverge
 * between dev/packaged builds and the CLI. Keep this constant stable across
 * renames; changing it orphans existing vaults.
 */
export const APP_DATA_DIR_NAME = 'secure-password-manager';

function resolvePath(...segments) {
  return process.platform === 'win32'
    ? path.win32.join(...segments)
    : path.posix.join(...segments);
}

/** Absolute path to the application data directory for the current platform. */
export function getAppDataPath() {
  switch (process.platform) {
    case 'darwin':
      return resolvePath(
        os.homedir(),
        'Library',
        'Application Support',
        APP_DATA_DIR_NAME
      );
    case 'win32':
      return resolvePath(process.env.APPDATA, APP_DATA_DIR_NAME);
    case 'linux':
      return resolvePath(os.homedir(), `.${APP_DATA_DIR_NAME}`);
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

/** Directory holding the regular password vaults. */
export function getVaultsDir() {
  return resolvePath(getAppDataPath(), 'vaults');
}

/** Directory holding the environment (`.env`) vaults. */
export function getEnvsDir() {
  return resolvePath(getAppDataPath(), 'envs');
}
