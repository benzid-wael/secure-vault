import fs from 'fs';
import path from 'path';

/**
 * Chromium switches that expose the app's pages to whoever launched it: no
 * Electron fuse covers them (GUI-ENV-BREAKDOWN New-40).
 */
export const DEBUG_SWITCHES = [
  'remote-debugging-port',
  'remote-debugging-pipe',
];

/**
 * Whether this build was packaged to allow them: the release smoke test's
 * twin build sets `allowDebugPort` in its packaged package.json, which asar
 * integrity (New-38) keeps anyone from adding to the shipped build.
 * @param {string} appPath `app.getAppPath()`.
 */
export function readAllowDebugPort(appPath) {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(appPath, 'package.json'), 'utf8')
    );
    return pkg.allowDebugPort === true || pkg.allowDebugPort === 'true';
  } catch {
    return false;
  }
}

/**
 * The debugging switch this launch must be refused for, or null: any of
 * them, in a packaged build not made to allow them. Dev runs keep them.
 *
 * @param {{isPackaged: boolean, allowDebugPort: boolean,
 *   hasSwitch: (name: string) => boolean}} launch
 * @returns {string|null}
 */
export function refusedDebugSwitch({ isPackaged, allowDebugPort, hasSwitch }) {
  if (!isPackaged || allowDebugPort) return null;
  return DEBUG_SWITCHES.find((name) => hasSwitch(name)) ?? null;
}
