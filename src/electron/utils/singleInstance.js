/**
 * One app process per user data folder (GUI-ENV-BREAKDOWN Task 11). A second
 * launch hands over to the running one, which shows its window, and quits:
 * two processes would each hold their own unlocked vaults and write the same
 * settings and recents files.
 *
 * Electron keys the lock on `app.getPath('userData')`, so separate user data
 * folders (e2e runs) each get their own instance.
 *
 * @param {{requestSingleInstanceLock: () => boolean, quit: () => void,
 *   on: Function}} app Electron's `app`.
 * @param {() => void} showWindow Called in the running instance when another
 *   launch is attempted.
 * @returns {boolean} True when this process is the one to run.
 */
export function claimSingleInstance(app, showWindow) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.on('second-instance', () => showWindow());
  return true;
}
